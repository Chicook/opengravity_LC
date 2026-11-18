// Memoria entre conversaciones.
//
// Replica el `memory` de Antigravity (`max_global_cascade_memories`,
// `num_memories_to_consider`, `add_user_memories_to_system_prompt`): hechos que
// sobreviven al final de una conversación y se inyectan en el system prompt de las
// siguientes cuando son relevantes.
//
// El emparejamiento es léxico, no por embeddings, a propósito: recuperar memoria en
// cada turno con un modelo costaría tokens y esto tiene que ser gratis.

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MEMORIAS = 500;
const MAX_TEXTO = 1200;

const PALABRAS_VACIAS = new Set([
  'de','la','el','los','las','un','una','unos','unas','y','o','que','en','con','por','para',
  'del','al','es','son','fue','ser','está','estan','este','esta','estos','estas','como','más',
  'the','a','an','of','to','in','on','for','and','or','is','are','was','be','this','that',
  'it','as','at','by','with','from','my','me','i','you','we','they',
]);

/**
 * ¿La ruta encaja con el patrón? Es el `CORTEX_MEMORY_TRIGGER_GLOB` del original.
 *
 * Cubre lo necesario sin traer una librería: `*` dentro de un segmento, `**`
 * para cualquier profundidad y `?` para un carácter. Las barras invertidas de
 * Windows se normalizan a `/`.
 */
function coincideGlob(patron, ruta) {
  const normal = (v) => String(v ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const p = normal(patron).trim();
  const r = normal(ruta).trim();
  if (p.length === 0 || r.length === 0) return false;

  const escapar = (t) => t.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const cuerpo = p
    .split('**')
    .map((trozo) => escapar(trozo).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*');
  // Un patrón sin barra vale con el nombre del fichero a cualquier profundidad.
  const ancla = p.includes('/') ? `^${cuerpo}$` : `(^|.*/)${cuerpo}$`;
  return new RegExp(ancla, 'i').test(r);
}

/** Normaliza la lista de patrones: cortos, sin vacíos y sin duplicados. */
function limpiarGlobs(globs) {
  if (!Array.isArray(globs)) return [];
  return [...new Set(globs.map((g) => String(g ?? '').trim()).filter((g) => g.length > 0 && g.length <= 120))].slice(
    0,
    5,
  );
}

/** Convierte un texto en términos comparables. */
function terminos(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2 && !PALABRAS_VACIAS.has(t));
}

/** Puntúa una memoria contra una consulta. 0 significa irrelevante. */
function puntuar(memoria, consultaTerminos, ahora) {
  const propios = new Set([...terminos(memoria.texto), ...(memoria.tags ?? []).flatMap(terminos)]);
  if (propios.size === 0) return 0;

  let coincidencias = 0;
  for (const termino of consultaTerminos) {
    if (propios.has(termino)) {
      coincidencias += 1;
      continue;
    }
    // Coincidencia parcial: "indexador" contra "indexación".
    for (const propio of propios) {
      if (propio.startsWith(termino.slice(0, 5)) || termino.startsWith(propio.slice(0, 5))) {
        coincidencias += 0.5;
        break;
      }
    }
  }

  if (coincidencias === 0) return 0;

  const cobertura = coincidencias / consultaTerminos.length;

  // Refresco: una memoria usada hace poco vale algo más, pero no puede sola.
  const dias = (ahora - new Date(memoria.creadoEn).getTime()) / 86_400_000;
  const frescura = 1 / (1 + Math.max(0, dias) / 60);

  const uso = Math.min(1, (memoria.usos ?? 0) / 10);

  return cobertura * 3 + frescura + uso * 0.5;
}

class AlmacenDeMemoria {
  constructor(archivo) {
    this.archivo = archivo;
    this.memorias = [];
    this.cargado = false;
  }

  async cargar() {
    if (this.cargado) return this;
    try {
      const crudo = await fsp.readFile(this.archivo, 'utf8');
      const datos = JSON.parse(crudo);
      this.memorias = Array.isArray(datos?.memorias) ? datos.memorias : [];
    } catch {
      this.memorias = [];
    }
    this.cargado = true;
    return this;
  }

  async guardar() {
    await fsp.mkdir(path.dirname(this.archivo), { recursive: true });
    await fsp.writeFile(
      this.archivo,
      JSON.stringify({ version: 1, memorias: this.memorias }, null, 2),
      'utf8',
    );
  }

  /** Añade una memoria. Devuelve la entrada creada o la existente si era duplicada. */
  async add({ texto, tags = [], ambito = 'global', globs = [] }) {
    await this.cargar();

    const limpio = String(texto ?? '').trim().slice(0, MAX_TEXTO);
    if (limpio.length === 0) throw new Error('la memoria está vacía');

    // Duplicado exacto: se refresca en vez de acumular ruido.
    const existente = this.memorias.find(
      (m) => m.texto.toLowerCase() === limpio.toLowerCase() && m.ambito === ambito,
    );
    if (existente) {
      existente.actualizadoEn = new Date().toISOString();
      existente.tags = [...new Set([...(existente.tags ?? []), ...tags])].slice(0, 12);
      existente.globs = [...new Set([...(existente.globs ?? []), ...limpiarGlobs(globs)])].slice(0, 5);
      await this.guardar();
      return { ...existente, duplicada: true };
    }

    const entrada = {
      id: `mem_${crypto.randomBytes(6).toString('hex')}`,
      texto: limpio,
      tags: [...new Set(tags)].slice(0, 12),
      ...(limpiarGlobs(globs).length > 0 ? { globs: limpiarGlobs(globs) } : {}),
      ambito,
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
      usos: 0,
    };

    this.memorias.push(entrada);

    // Tope global: se descartan las menos usadas y más antiguas.
    if (this.memorias.length > MAX_MEMORIAS) {
      this.memorias.sort((a, b) => {
        const usoA = a.usos ?? 0;
        const usoB = b.usos ?? 0;
        if (usoA !== usoB) return usoB - usoA;
        return new Date(b.creadoEn) - new Date(a.creadoEn);
      });
      this.memorias = this.memorias.slice(0, MAX_MEMORIAS);
    }

    await this.guardar();
    return entrada;
  }

  /** Busca memorias relevantes para una consulta. */
  async search(consulta, { limite = 5, ambito } = {}) {
    await this.cargar();

    const consultaTerminos = terminos(consulta);
    const ahora = Date.now();

    const candidatas = ambito
      ? this.memorias.filter((m) => m.ambito === ambito || m.ambito === 'global')
      : this.memorias;

    const puntuadas = candidatas
      .map((m) => ({ memoria: m, puntos: puntuar(m, consultaTerminos, ahora) }))
      .filter((entrada) => entrada.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, limite);

    return puntuadas.map((entrada) => entrada.memoria);
  }

  /** Memorias para inyectar al principio de una conversación. */
  async relevant(ambito, limite = 6) {
    await this.cargar();

    const ahora = Date.now();
    return this.memorias
      .filter((m) => m.ambito === 'global' || m.ambito === ambito)
      .map((m) => {
        const dias = (ahora - new Date(m.creadoEn).getTime()) / 86_400_000;
        return { memoria: m, puntos: Math.min(1, (m.usos ?? 0) / 5) + 1 / (1 + dias / 60) };
      })
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, limite)
      .map((entrada) => entrada.memoria);
  }

  /**
   * Memorias que se activan al tocar un fichero: las que declaran `globs` y
   * alguno encaja con las rutas dadas. Devuelve la lista con su `ruta` para que
   * el llamante pueda avisar de por qué aparece.
   */
  async porGlob(rutas, limite = 3) {
    await this.cargar();
    const lista = (Array.isArray(rutas) ? rutas : [rutas]).map((r) => String(r ?? '')).filter(Boolean);
    if (lista.length === 0) return [];

    const salida = [];
    for (const memoria of this.memorias) {
      const globs = memoria.globs ?? [];
      if (globs.length === 0) continue;
      const ruta = lista.find((r) => globs.some((g) => coincideGlob(g, r)));
      if (!ruta) continue;
      salida.push({ ...memoria, ruta });
      if (salida.length >= limite) break;
    }
    return salida;
  }

  async list({ limite = 50 } = {}) {
    await this.cargar();
    return [...this.memorias]
      .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn))
      .slice(0, limite);
  }

  async forget(id) {
    await this.cargar();
    const antes = this.memorias.length;
    this.memorias = this.memorias.filter((m) => m.id !== id);
    if (this.memorias.length === antes) return false;
    await this.guardar();
    return true;
  }

  /** Marca memorias como usadas, para que el ranking aprenda. */
  async marcarUsadas(ids) {
    await this.cargar();
    const conjunto = new Set(ids);
    let cambiado = false;
    for (const memoria of this.memorias) {
      if (conjunto.has(memoria.id)) {
        memoria.usos = (memoria.usos ?? 0) + 1;
        memoria.ultimoUso = new Date().toISOString();
        cambiado = true;
      }
    }
    if (cambiado) await this.guardar();
  }
}

/** Construye el bloque de system prompt con las memorias relevantes. */
function bloqueDeMemorias(memorias) {
  if (!Array.isArray(memorias) || memorias.length === 0) return '';

  const lineas = memorias.map((m) => `- ${m.texto}`);
  return (
    '\n\n## Lo que recuerdas de conversaciones anteriores\n\n' +
    'Estos hechos los guardaste tú en sesiones previas. Úsalos si vienen al caso; ' +
    'no los repitas al usuario salvo que sea pertinente, y no los contradigas sin comprobarlo.\n\n' +
    lineas.join('\n')
  );
}

/** Herramienta `memory` para el agente. */
function makeMemoryTool(almacen, getAmbito) {
  return {
    name: 'memory',
    description:
      'Guarda y consulta hechos que deben sobrevivir entre conversaciones: preferencias ' +
      'del usuario, decisiones de arquitectura, cómo está montado el proyecto. ' +
      'Úsala cuando el usuario te diga algo que querrás recordar la próxima vez.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'search', 'list', 'forget'],
          description: 'Qué hacer: guardar, buscar, listar o borrar.',
        },
        text: {
          type: 'string',
          description:
            'El hecho a recordar, en una frase autosuficiente. Obligatorio para add. ' +
            'Escríbelo para que se entienda sin el contexto de esta conversación.',
        },
        query: { type: 'string', description: 'Texto a buscar. Obligatorio para search.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Etiquetas cortas para agrupar memorias relacionadas.',
        },
        globs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Patrones de fichero que activan esta memoria (por ejemplo `src/api/*.ts`). ' +
            'Se inyecta sola cuando el agente toca uno de esos ficheros.',
        },
        id: { type: 'string', description: 'Id de la memoria a borrar. Obligatorio para forget.' },
        limit: { type: 'number', description: 'Cuántas devolver. Por defecto 5.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const accion = String(args.action ?? 'search');
      const ambito = getAmbito() ?? 'global';

      if (accion === 'add') {
        const texto = String(args.text ?? '').trim();
        if (texto.length === 0) return { content: 'Falta el texto a recordar.', isError: true };

        const entrada = await almacen.add({
          texto,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          globs: Array.isArray(args.globs) ? args.globs.map(String) : [],
          ambito: args.global === true ? 'global' : ambito,
        });

        const conGlobs =
          entrada.globs && entrada.globs.length > 0
            ? ` Se activará al tocar: ${entrada.globs.join(', ')}.`
            : '';
        return {
          content:
            (entrada.duplicada
              ? `Ya lo recordaba (${entrada.id}); he refrescado la fecha.`
              : `Guardado como ${entrada.id}.`) + conGlobs,
        };
      }

      if (accion === 'list') {
        const memorias = await almacen.list({ limite: Number(args.limit ?? 50) });
        if (memorias.length === 0) return { content: 'No hay memorias guardadas.' };
        const lineas = memorias.map((m) => `- ${m.id} · ${m.texto}`);
        return { content: `Memorias (${memorias.length}):\n${lineas.join('\n')}` };
      }

      if (accion === 'forget') {
        const id = String(args.id ?? '');
        if (id.length === 0) return { content: 'Falta el id.', isError: true };
        const borrada = await almacen.forget(id);
        return {
          content: borrada ? `Borrada ${id}.` : `No existe la memoria ${id}.`,
          isError: !borrada,
        };
      }

      // search
      const consulta = String(args.query ?? args.text ?? '').trim();
      if (consulta.length === 0) {
        const memorias = await almacen.list({ limite: Number(args.limit ?? 10) });
        if (memorias.length === 0) return { content: 'No hay memorias guardadas.' };
        return {
          content: `No diste consulta; estas son las más recientes:\n${memorias
            .map((m) => `- ${m.id} · ${m.texto}`)
            .join('\n')}`,
        };
      }

      const encontradas = await almacen.search(consulta, {
        limite: Number(args.limit ?? 5),
        ambito,
      });

      if (encontradas.length === 0) {
        return { content: `No recuerdo nada sobre "${consulta}".` };
      }

      await almacen.marcarUsadas(encontradas.map((m) => m.id));

      return {
        content:
          `Recuerdos sobre "${consulta}":\n` +
          encontradas.map((m) => `- ${m.texto}`).join('\n'),
      };
    },
  };
}

module.exports = { AlmacenDeMemoria, makeMemoryTool, bloqueDeMemorias, terminos, coincideGlob };
