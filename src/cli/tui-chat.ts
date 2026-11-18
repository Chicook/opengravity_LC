/**
 * TUI de chat a pantalla completa.
 *
 * Chat + panel lateral de estado, con streaming del agente. Usa ANSI y raw mode
 * sin dependencias. La TUI de línea sigue existiendo como fallback para cuando
 * stdin/stdout no son un terminal.
 */

import { emitKeypressEvents } from 'node:readline';
import { runAgent } from '../agent/loop.js';
import type { Message } from '../providers/types.js';
import type { TuiOptions } from './tui.js';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CLEAR = '\x1b[2J\x1b[H';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

interface LineaChat {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
}

interface PermisoPendiente {
  tool: string;
  motivo: string;
  resolver: (valor: boolean) => void;
}

function recortar(texto: string, ancho: number): string {
  if (texto.length <= ancho) return texto.padEnd(ancho);
  return `${texto.slice(0, Math.max(0, ancho - 1))}…`;
}

function envolver(texto: string, ancho: number): string[] {
  const anchoUtil = Math.max(10, ancho);
  const salida: string[] = [];
  for (const parrafo of String(texto).split('\n')) {
    let resto = parrafo;
    if (resto.length === 0) {
      salida.push('');
      continue;
    }
    while (resto.length > anchoUtil) {
      let corte = resto.lastIndexOf(' ', anchoUtil);
      if (corte <= 0) corte = anchoUtil;
      salida.push(resto.slice(0, corte));
      resto = resto.slice(corte).trimStart();
    }
    salida.push(resto);
  }
  return salida;
}

function lineasIniciales(mensajes: Message[]): LineaChat[] {
  const salida: LineaChat[] = [];
  for (const mensaje of mensajes) {
    if (mensaje.role === 'user' && !mensaje.internal) {
      salida.push({ role: 'user', text: mensaje.content });
    } else if (mensaje.role === 'assistant' && mensaje.content) {
      salida.push({ role: 'assistant', text: mensaje.content });
    } else if (mensaje.role === 'tool') {
      salida.push({ role: 'tool', text: `${mensaje.name ?? 'tool'}: ${mensaje.content}` });
    }
  }
  return salida;
}

function prefijo(role: LineaChat['role']): string {
  if (role === 'user') return 'Tú  ';
  if (role === 'assistant') return 'IA  ';
  if (role === 'tool') return '  · ';
  return '  · ';
}

export async function correrTuiCompleta(options: TuiOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('La TUI completa necesita un terminal interactivo.\n');
    return 2;
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const rawAnterior = stdin.isRaw === true;
  let mensajes = options.initialMessages;
  let lineas = lineasIniciales(mensajes);
  let entrada = '';
  let historial: string[] = [];
  let historialIndice = -1;
  let ocupado = false;
  let aborto: AbortController | null = null;
  let permiso: PermisoPendiente | null = null;
  let scroll = 0;
  let cerrado = false;
  let resolver: () => void = () => {};
  let pintadoPendiente: NodeJS.Timeout | null = null;
  let spinner = 0;
  let turnos = options.numTurns;

  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  const pintar = () => {
    const cols = Math.max(70, stdout.columns ?? 100);
    const rows = Math.max(16, stdout.rows ?? 30);
    const lateral = Math.max(20, Math.min(30, Math.floor(cols * 0.25)));
    const anchoChat = cols - lateral - 3;
    const altoChat = rows - 7;

    const chat: string[] = [];
    for (const linea of lineas) {
      const partes = envolver(`${prefijo(linea.role)}${linea.text}`.trimEnd(), anchoChat);
      for (const parte of partes) chat.push(parte);
    }
    if (chat.length === 0) chat.push('Escribe un mensaje para empezar.');

    const maxScroll = Math.max(0, chat.length - altoChat);
    scroll = Math.min(maxScroll, Math.max(0, scroll));
    const fin = chat.length - scroll;
    const visibles = chat.slice(Math.max(0, fin - altoChat), fin);

    const lateralLineas = [
      `Modelo: ${options.estado.model}`,
      `Modo: ${options.estado.mode}`,
      `Plan: ${options.plan.fase}`,
      `Sesión: ${options.sessionId ?? 'sin guardar'}`,
      `Mensajes: ${mensajes.length}`,
      `Herramientas: ${options.tools.names().length}`,
      '',
      'Estado:',
      ocupado ? `  trabajando ${'.'.repeat((spinner % 3) + 1)}` : '  en espera',
      ...(permiso ? ['  permiso pendiente'] : []),
    ];

    const filas: string[] = [];
    const full = (texto: string) => `│${recortar(texto, cols - 2)}│`;
    const doble = (izquierda: string, derecha: string) =>
      `│${recortar(izquierda, anchoChat)}│${recortar(derecha, lateral)}│`;

    filas.push(`╭${'─'.repeat(cols - 2)}╮`);
    filas.push(full(` Opengravity · ${options.estado.model} · ${options.estado.mode}`));
    filas.push(`├${'─'.repeat(cols - 2)}┤`);
    for (let i = 0; i < altoChat; i += 1) {
      filas.push(doble(visibles[i] ?? '', lateralLineas[i] ?? ''));
    }
    filas.push(`├${'─'.repeat(cols - 2)}┤`);

    const pista = permiso
      ? `Permitir ${permiso.tool} (${permiso.motivo})? [y/N] `
      : '> ';
    const textoEntrada = permiso
      ? `${pista}${entrada}`
      : `${pista}${entrada}${ocupado ? '  [Ctrl+C abortar]' : ''}`;
    filas.push(full(` ${textoEntrada}▌`));
    filas.push(full(' Enter enviar · Esc salir · Ctrl+C abortar · PgUp/PgDn historial'));
    filas.push(`╰${'─'.repeat(cols - 2)}╯`);

    stdout.write(`${CLEAR}${HIDE}${filas.join('\n')}`);
  };

  const programarPintado = () => {
    if (pintadoPendiente) return;
    pintadoPendiente = setTimeout(() => {
      pintadoPendiente = null;
      if (!cerrado) pintar();
    }, 50);
  };

  const limpiar = () => {
    if (cerrado) return;
    cerrado = true;
    if (pintadoPendiente) clearTimeout(pintadoPendiente);
    clearInterval(temporizadorSpinner);
    stdin.pause();
    stdin.removeListener('keypress', alPulsar);
    stdout.removeListener('resize', programarPintado);
    stdout.write(`${SHOW}${ALT_OFF}`);
    try {
      stdin.setRawMode(rawAnterior);
    } catch {
      // terminal ya cerrado
    }
    resolver();
  };

  const responderPermiso = (aprobado: boolean) => {
    const pendiente = permiso;
    permiso = null;
    if (pendiente) pendiente.resolver(aprobado);
    entrada = '';
    pintar();
  };

  const enviar = async (texto: string) => {
    const limpio = texto.trim();
    if (limpio.length === 0 || ocupado) return;

    if (limpio === '/exit' || limpio === '/quit') {
      limpiar();
      return;
    }
    if (limpio === '/help') {
      lineas.push({
        role: 'system',
        text: '/exit · /clear · /model <id> · /mode <modo> · /tools',
      });
      entrada = '';
      scroll = 0;
      pintar();
      return;
    }
    if (limpio === '/clear') {
      lineas = [];
      entrada = '';
      scroll = 0;
      pintar();
      return;
    }
    if (limpio.startsWith('/model')) {
      const elegido = limpio.split(/\s+/)[1] ?? '';
      if (elegido && (options.modelos.length === 0 || options.modelos.includes(elegido))) {
        options.estado.model = elegido;
        lineas.push({ role: 'system', text: `Modelo: ${elegido}` });
      } else {
        lineas.push({ role: 'system', text: `Modelo actual: ${options.estado.model}` });
      }
      entrada = '';
      pintar();
      return;
    }
    if (limpio.startsWith('/mode')) {
      const elegido = limpio.split(/\s+/)[1] ?? '';
      if (['default', 'accept-edits', 'auto', 'plan'].includes(elegido)) {
        if (elegido === 'auto' && !options.sandbox) {
          options.estado.mode = 'default';
          options.aplicarModo('default');
          lineas.push({ role: 'system', text: 'auto requiere --sandbox; se usa default.' });
        } else {
          options.estado.mode = elegido;
          options.aplicarModo(elegido);
          lineas.push({ role: 'system', text: `Modo: ${elegido}` });
        }
      } else {
        lineas.push({ role: 'system', text: `Modo actual: ${options.estado.mode}` });
      }
      entrada = '';
      pintar();
      return;
    }
    if (limpio === '/tools') {
      lineas.push({ role: 'system', text: options.tools.names().join(', ') });
      entrada = '';
      pintar();
      return;
    }

    historial.push(limpio);
    historialIndice = -1;
    lineas.push({ role: 'user', text: limpio });
    const indiceAsistente = lineas.push({ role: 'assistant', text: '' }) - 1;
    entrada = '';
    scroll = 0;
    ocupado = true;
    aborto = new AbortController();
    const controlador = aborto;
    options.plan.reiniciar(options.estado.mode === 'plan');
    options.trayectoria?.marcarTurno(mensajes.length);
    turnos += 1;
    pintar();

    try {
      const sistemaBase = await options.sistemaPara(options.estado.mode);
      const sistema = options.plan.sistema(sistemaBase, options.estado.mode);
      const resultado = await runAgent(
        {
          provider: options.provider,
          model: options.estado.model,
          tools: options.tools,
          system: sistema,
          maxSteps: 40,
          contextWindow: options.ventanaPara(options.estado.model),
          toolGate: (call) => options.plan.compuerta(call),
          mensajeDeSistema: () => options.plan.mensajePendiente(),
          ...options.ajustes,
          ...(mensajes.length > 0 ? { initialMessages: mensajes } : {}),
          onEvent: (evento) => {
            const asistente = lineas[indiceAsistente];
            if (evento.type === 'text') {
              if (asistente) asistente.text += evento.text;
            } else if (evento.type === 'stream_reset') {
              if (asistente) asistente.text = '';
            } else if (evento.type === 'tool_start') {
              lineas.push({
                role: 'tool',
                text: `${evento.call.name} ${JSON.stringify(evento.call.arguments ?? {}).slice(0, 120)}`,
              });
            } else if (evento.type === 'tool_end') {
              const estado = evento.isError ? '✗' : '✓';
              const primera = String(evento.content ?? '').split('\n')[0] ?? '';
              lineas.push({
                role: 'tool',
                text: `${estado} ${evento.call?.name ?? 'tool'}: ${primera.slice(0, 160)}`,
              });
            } else if (evento.type === 'nudge') {
              lineas.push({ role: 'system', text: evento.text });
            }
            programarPintado();
          },
        },
        limpio,
        { cwd: options.cwd, signal: controlador.signal },
      );

      mensajes = resultado.messages;
      const asistenteFinal = lineas[indiceAsistente];
      if (asistenteFinal) asistenteFinal.text = resultado.text || asistenteFinal.text;
      if (options.sessionId && options.store) {
        try {
          await options.store.append(options.sessionId, resultado.appended);
        } catch (error) {
          lineas.push({
            role: 'system',
            text: `No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    } catch (error) {
      const mensaje = controlador.signal.aborted
        ? 'Turno cancelado.'
        : error instanceof Error
          ? error.message
          : String(error);
      lineas.push({ role: 'system', text: mensaje });
    } finally {
      ocupado = false;
      aborto = null;
      scroll = 0;
      pintar();
    }
  };

  const alPulsar = (
    texto: string,
    tecla: { name?: string; ctrl?: boolean; shift?: boolean },
  ) => {
    const nombre = tecla.name ?? '';

    if (permiso) {
      if (nombre === 'y' || (texto && texto.toLowerCase() === 'y')) {
        responderPermiso(true);
      } else if (nombre === 'n' || nombre === 'escape' || (texto && texto.toLowerCase() === 'n')) {
        responderPermiso(false);
      }
      return;
    }

    if (tecla.ctrl && nombre === 'c') {
      if (ocupado && aborto) {
        aborto.abort();
        lineas.push({ role: 'system', text: 'Cancelando…' });
        programarPintado();
      } else {
        limpiar();
      }
      return;
    }
    if (nombre === 'escape') {
      if (ocupado && aborto) aborto.abort();
      else limpiar();
      return;
    }
    if (nombre === 'return' || nombre === 'enter') {
      if (!ocupado) void enviar(entrada);
      return;
    }
    if (nombre === 'backspace') {
      entrada = entrada.slice(0, -1);
      programarPintado();
      return;
    }
    if (nombre === 'pageup') {
      scroll = Math.min(Math.max(0, lineas.length), scroll + Math.max(1, altoChat()));
      programarPintado();
      return;
    }
    if (nombre === 'pagedown') {
      scroll = Math.max(0, scroll - Math.max(1, altoChat()));
      programarPintado();
      return;
    }
    if (nombre === 'up') {
      if (historial.length > 0) {
        historialIndice = Math.min(historial.length - 1, historialIndice < 0 ? 0 : historialIndice + 1);
        entrada = historial[historial.length - 1 - historialIndice] ?? '';
        programarPintado();
      }
      return;
    }
    if (nombre === 'down') {
      if (historialIndice > 0) {
        historialIndice -= 1;
        entrada = historial[historial.length - 1 - historialIndice] ?? '';
      } else {
        historialIndice = -1;
        entrada = '';
      }
      programarPintado();
      return;
    }
    if (texto && !tecla.ctrl) {
      entrada += texto;
      programarPintado();
    }
  };

  const altoChat = () => Math.max(1, (stdout.rows ?? 30) - 7);

  options.preguntar.actual = (tool, _args, motivo) =>
    new Promise<boolean>((resolve) => {
      permiso = { tool, motivo, resolver: resolve };
      pintar();
    });

  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(ALT_ON);
  stdin.on('keypress', alPulsar);
  stdout.on('resize', programarPintado);
  const temporizadorSpinner = setInterval(() => {
    if (ocupado) {
      spinner += 1;
      programarPintado();
    }
  }, 350);
  temporizadorSpinner.unref?.();
  pintar();

  await promesa;
  return 0;
}
