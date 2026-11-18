/**
 * Almacén de sesiones en ficheros JSONL.
 *
 * Formato:
 *   <root>/sessions/<id>.jsonl   — una línea por mensaje, append-only
 *   <root>/index.json            — metadatos de todas las sesiones
 *
 * Por qué JSONL y no SQLite en esta etapa:
 *  - Cero dependencias y cero binarios nativos.
 *  - Se puede inspeccionar y reparar a mano (`tail`, `grep`).
 *  - Append-only: escribir un mensaje nunca reescribe el historial.
 *
 * Cuando haga falta consultar (búsqueda por contenido, muchas sesiones), este
 * módulo se sustituye por una implementación SQLite sin tocar el agente.
 */

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '../providers/types.js';
import type { Session, SessionInit, SessionMeta, SessionStore } from './types.js';

/** Raíz por defecto: `~/.agent-ide`, sobreescribible con `AGENT_IDE_HOME`. */
function defaultRoot(): string {
  return process.env['AGENT_IDE_HOME'] ?? join(homedir(), '.agent-ide');
}

interface StoredLine {
  at: string;
  message: Message;
}

export interface JsonlStoreOptions {
  /** Directorio raíz. Por defecto `~/.agent-ide`. */
  root?: string;
}

export class JsonlSessionStore implements SessionStore {
  private readonly root: string;
  private readonly sessionsDir: string;
  private readonly indexPath: string;

  constructor(options: JsonlStoreOptions = {}) {
    this.root = options.root ?? defaultRoot();
    this.sessionsDir = join(this.root, 'sessions');
    this.indexPath = join(this.root, 'index.json');
  }

  async create(init: SessionInit): Promise<SessionMeta> {
    await this.ensureDirs();

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: newSessionId(),
      title: init.title ?? 'Nueva conversación',
      createdAt: now,
      updatedAt: now,
      provider: init.provider,
      model: init.model,
      cwd: init.cwd,
      project: init.project === undefined ? init.cwd : init.project,
      messageCount: 0,
    };

    await writeFile(this.sessionPath(meta.id), '', 'utf8');

    const index = await this.readIndex();
    index.unshift(meta);
    await this.writeIndex(index);

    return meta;
  }

  async append(id: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    await this.ensureDirs();

    const index = await this.readIndex();
    const meta = index.find((entry) => entry.id === id);
    if (!meta) {
      throw new Error(`sesión no encontrada: ${id}`);
    }

    const now = new Date().toISOString();
    const lines: string[] = [];
    for (const message of messages) {
      const record: StoredLine = { at: now, message };
      lines.push(JSON.stringify(record));
    }

    await appendFile(this.sessionPath(id), `${lines.join('\n')}\n`, 'utf8');

    meta.messageCount += messages.length;
    meta.updatedAt = now;

    // El título se fija con el primer mensaje del usuario.
    if (meta.title === 'Nueva conversación') {
      const firstUser = messages.find((message) => message.role === 'user');
      if (firstUser) meta.title = titleFrom(firstUser.content);
    }

    index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.writeIndex(index);
  }

  async load(id: string): Promise<Session> {
    const index = await this.readIndex();
    const meta = index.find((entry) => entry.id === id);
    if (!meta) {
      throw new Error(`sesión no encontrada: ${id}`);
    }

    let raw = '';
    try {
      raw = await readFile(this.sessionPath(id), 'utf8');
    } catch {
      // Sesión en el índice sin fichero: se devuelve vacía en lugar de romper.
      return { meta, messages: [] };
    }

    const messages: Message[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const record = JSON.parse(trimmed) as StoredLine;
        if (record && record.message && typeof record.message.role === 'string') {
          messages.push(record.message);
        }
      } catch {
        // Línea corrupta (escritura interrumpida): se ignora, no se pierde el resto.
      }
    }

    return { meta, messages };
  }

  async list(): Promise<SessionMeta[]> {
    const index = await this.readIndex();
    return [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async rewrite(id: string, messages: Message[]): Promise<void> {
    await this.ensureDirs();

    const index = await this.readIndex();
    const meta = index.find((entry) => entry.id === id);
    if (!meta) {
      throw new Error(`sesión no encontrada: ${id}`);
    }

    const now = new Date().toISOString();
    const body = messages
      .map((message) => JSON.stringify({ at: now, message } satisfies StoredLine))
      .join('\n');

    const temporary = `${this.sessionPath(id)}.tmp`;
    await writeFile(temporary, body.length > 0 ? `${body}\n` : '', 'utf8');
    await rename(temporary, this.sessionPath(id));

    meta.messageCount = messages.length;
    meta.updatedAt = now;
    await this.writeIndex(index);
  }

  /** Cambia el título de una sesión en el índice. */
  async rename(id: string, title: string): Promise<void> {
    const index = await this.readIndex();
    const found = index.find((entry) => entry.id === id);
    if (!found) return;

    found.title = title;
    found.updatedAt = new Date().toISOString();
    await this.writeIndex(index);
  }

  /** Cambia el proyecto de una sesión sin tocar sus mensajes. */
  async setProject(id: string, project: string | null): Promise<void> {
    const index = await this.readIndex();
    const meta = index.find((entry) => entry.id === id);
    if (!meta) return;
    meta.project = project;
    meta.updatedAt = new Date().toISOString();
    await this.writeIndex(index);
  }

  async delete(id: string): Promise<void> {
    const index = await this.readIndex();
    const remaining = index.filter((entry) => entry.id !== id);

    if (remaining.length !== index.length) {
      await this.writeIndex(remaining);
    }

    await rm(this.sessionPath(id), { force: true });
  }

  async latest(): Promise<SessionMeta | undefined> {
    const sessions = await this.list();
    return sessions[0];
  }

  /**
   * Ruta del fichero de una sesión.
   *
   * El id se comprueba antes de montar la ruta: sin esto un id manipulado
   * (`../../algo`) haría que `delete` o `rewrite` escribieran o borraran fuera de
   * la carpeta de sesiones. Los ids los genera la app, así que un id con
   * separadores o `..` solo puede venir de fuera: se rechaza.
   */
  private sessionPath(id: string): string {
    const limpio = String(id ?? '');
    if (!/^[A-Za-z0-9._-]+$/.test(limpio) || limpio === '.' || limpio === '..') {
      throw new Error(`id de sesión no válido: ${limpio}`);
    }
    return join(this.sessionsDir, `${limpio}.jsonl`);
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * Repara sesiones guardadas con el contenido como `{ texto, encontrados }`.
   *
   * Una versión del redactor de secretos devolvía un objeto y se persistió tal
   * cual: al reabrir el hilo, cada mensaje se pintaba como `[object Object]`.
   * El texto sigue dentro (`texto`), así que se recupera y se reescribe el
   * fichero solo si hubo algo que arreglar. Idempotente: se puede llamar en
   * cada arranque sin coste cuando ya está limpio.
   */
  async repararContenidoObjeto(): Promise<{ ficheros: number; mensajes: number }> {
    await this.ensureDirs();
    let ficheros = 0;
    let mensajes = 0;

    const nombres = await readdir(this.sessionsDir).catch(() => [] as string[]);
    for (const nombre of nombres) {
      if (!nombre.endsWith('.jsonl')) continue;
      const ruta = join(this.sessionsDir, nombre);
      const crudo = await readFile(ruta, 'utf8').catch(() => null);
      if (crudo === null) continue;

      let tocado = 0;
      const lineas = crudo.split('\n').map((linea) => {
        const limpia = linea.trim();
        if (limpia.length === 0) return linea;

        let registro: StoredLine;
        try {
          registro = JSON.parse(limpia) as StoredLine;
        } catch {
          return linea;
        }

        const contenido: unknown = registro?.message?.content;
        if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) {
          return linea;
        }
        if (!('texto' in contenido)) return linea;
        const texto = contenido.texto;
        if (typeof texto !== 'string') return linea;

        registro.message.content = texto;
        tocado += 1;
        return JSON.stringify(registro);
      });

      if (tocado === 0) continue;

      const temporal = `${ruta}.tmp`;
      await writeFile(temporal, lineas.join('\n'), 'utf8');
      await rename(temporal, ruta);
      ficheros += 1;
      mensajes += tocado;
    }

    return { ficheros, mensajes };
  }

  private async readIndex(): Promise<SessionMeta[]> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as SessionMeta[]) : [];
    } catch {
      return [];
    }
  }

  /** Escribe el índice de forma atómica: temporal + rename. */
  private async writeIndex(index: SessionMeta[]): Promise<void> {
    await this.ensureDirs();
    const temporary = `${this.indexPath}.tmp`;
    await writeFile(temporary, JSON.stringify(index, null, 2), 'utf8');
    await rename(temporary, this.indexPath);
  }
}

/** Id legible y ordenable: `20260103-141230-ab12cd`. */
function newSessionId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${date}-${time}-${suffix}`;
}

/** Primer mensaje → título de una línea, recortado a 80 caracteres. */
/** Relleno que encabeza muchas peticiones y no aporta al título. */
const RELLENO_INICIAL = new RegExp(
  '^(?:' +
    [
      'hola[,!.]?\\s*',
      'buenas[,!.]?\\s*',
      'por favor[,]?\\s*',
      'puedes\\s+',
      'podr[ií]as\\s+',
      'me\\s+gustar[ií]a\\s+',
      'necesito\\s+(?:que\\s+)?',
      'quiero\\s+(?:que\\s+)?',
      'ay[uú]dame\\s+a\\s+',
      'usa(?:r)?\\s+(?:la\\s+)?(?:herramienta\\s+)?\\S+\\s+para\\s+',
      'usando\\s+',
      'ejecuta\\s+',
      'dime\\s+',
    ].join('|') +
    ')',
  'i',
);

/** Palabras que no describen la tarea. */
const VACIAS = new Set([
  'que','con','por','para','como','este','esta','estos','estas','los','las','una','unos','unas',
  'del','al','muy','mas','más','pero','sino','solo','sólo','todo','toda','todos','todas','hay',
  'sea','ser','son','fue','era','han','has','hemos','esta','está','estan','están','donde','cuando',
  'entonces','ademas','además','tambien','también','quiero','necesito','puedes','haz','hacer',
  'the','and','for','with','that','this','from','your','you','are','was','were','have','has',
  'can','could','would','should','please','into','about','what','when','where','which','will',
  // Verbos de petición: describen el acto de pedir, no la tarea.
  'dime','decir','decirme','di','muestra','muestrame','muéstrame','dame','dar','dar me',
  'presenta','presentar','ejecuta','ejecutalos','ejecutarlos','ejecutalas','hazlo','haz',
  'tiene','tienes','tener','ser','estar','hacer','puedes','podrias','podrías','ayuda',
  'escribe','escribir','crea','crear','anade','añade','anadir','añadir','cambia','cambiar',
]);

/**
 * Título corto a partir del primer mensaje del usuario.
 *
 * No llama al modelo: quita el relleno inicial, descarta palabras vacías y se
 * queda con las significativas. Es gratis e inmediato, y mucho mejor que
 * volcar 80 caracteres del prompt.
 */
function titleFrom(contenido: unknown): string {
  // Tolerante: un contenido que no sea texto no puede tumbar el guardado.
  const limpio = String(contenido ?? '').replace(/\s+/g, ' ').trim();
  if (limpio.length === 0) return 'Nueva conversación';

  // Quitar relleno inicial, encadenado (p. ej. «Hola, por favor puedes…»).
  let sinRelleno = limpio;
  for (let i = 0; i < 3; i += 1) {
    const siguiente = sinRelleno.replace(RELLENO_INICIAL, '').trim();
    if (siguiente === sinRelleno || siguiente.length === 0) break;
    sinRelleno = siguiente;
  }

  const vistas = new Set<string>();
  const palabras = sinRelleno
    .split(/\s+/)
    .map((palabra) => palabra.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((palabra) => palabra.length > 2 && !VACIAS.has(palabra.toLowerCase()))
    // Sin repetir la misma palabra: «cuántos … cuántos» no aporta.
    .filter((palabra) => {
      const clave = palabra.toLowerCase();
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });

  if (palabras.length === 0) {
    return limpio.length > 80 ? `${limpio.slice(0, 77)}…` : limpio;
  }

  // Hasta siete palabras y 48 caracteres, sin cortar a mitad de palabra.
  const elegidas: string[] = [];
  for (const palabra of palabras.slice(0, 7)) {
    const tentativa = [...elegidas, palabra].join(' ');
    if (tentativa.length > 48) break;
    elegidas.push(palabra);
  }

  const titulo = (elegidas.length > 0 ? elegidas : palabras.slice(0, 3)).join(' ');
  return titulo.charAt(0).toUpperCase() + titulo.slice(1);
}

/** Comprueba si un id existe en el índice sin cargar la sesión completa. */
export async function sessionExists(store: JsonlSessionStore, id: string): Promise<boolean> {
  const sessions = await store.list();
  return sessions.some((entry) => entry.id === id);
}
