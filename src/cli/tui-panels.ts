/**
 * TUI de paneles a pantalla completa.
 *
 * Es una capa de solo lectura sobre el estado del CLI: pestañas, contenido
 * desplazable y teclado. No intenta ser un editor de pantalla completa; evita
 * que los paneles sean una salida de texto suelta.
 */

import { emitKeypressEvents } from 'node:readline';

export interface PanelTab {
  id: string;
  title: string;
  lines: string[];
}

export interface PanelViewState {
  tab: number;
  scroll: number;
}

const CLEAR = '\x1b[2J\x1b[H';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';
const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';

function recortar(texto: string, ancho: number): string {
  if (texto.length <= ancho) return texto.padEnd(ancho);
  return `${texto.slice(0, Math.max(0, ancho - 1))}…`;
}

function caja(arriba: string, medio: string, abajo: string, ancho: number): string[] {
  return [`${arriba}${'─'.repeat(ancho)}${abajo}`, `${medio}${' '.repeat(ancho)}${medio}`];
}

export function renderPanelScreen(
  tabs: PanelTab[],
  estado: PanelViewState,
  ancho: number,
  alto: number,
): string {
  const w = Math.max(60, ancho || 80);
  const h = Math.max(16, alto || 24);
  const activa = tabs[Math.min(estado.tab, tabs.length - 1)] ?? { title: '', lines: [] };
  const lateral = Math.min(24, Math.max(18, Math.floor(w * 0.22)));
  const contenido = Math.max(20, w - lateral - 5);

  const lineas: string[] = [];
  lineas.push(`╭${'─'.repeat(Math.max(0, w - 2))}╮`);
  const tituloPantalla = 'Opengravity · TUI';
  lineas.push(`│ ${tituloPantalla}${' '.repeat(Math.max(0, w - tituloPantalla.length - 3))}│`);
  lineas.push(`├${'─'.repeat(Math.max(0, w - 2))}┤`);

  // Cabecera de pestañas.
  const titulos = tabs.map((tab) => tab.title).join('  ');
  lineas.push(`│ ${recortar(titulos, w - 4)} │`);

  const filasContenido = h - 7;
  const izquierda = tabs.map((tab, i) => {
    const marca = i === estado.tab ? '▸' : ' ';
    return recortar(`${marca} ${tab.title}`, lateral - 2);
  });
  for (let i = 0; i < filasContenido; i += 1) {
    const izq = izquierda[i] ?? ' '.repeat(lateral);
    const linea = activa.lines[estado.scroll + i] ?? '';
    lineas.push(`│${recortar(izq, lateral)}│ ${recortar(linea, contenido)} │`);
  }

  lineas.push(`├${'─'.repeat(lateral)}┴${'─'.repeat(Math.max(0, w - lateral - 3))}┤`);
  const ayuda = '←/→ pestañas · ↑/↓ scroll · q salir';
  lineas.push(`│ ${recortar(ayuda, w - 4)} │`);
  lineas.push(`╰${'─'.repeat(Math.max(0, w - 2))}╯`);

  return `${CLEAR}${HIDE}${lineas.join('\n')}`;
}

/** Abre los paneles y espera a que el usuario salga con q, Esc o Ctrl+C. */
export async function abrirPanelInteractivo(
  tabs: PanelTab[],
  inicial = 0,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || tabs.length === 0) {
    const tab = tabs[Math.min(inicial, tabs.length - 1)];
    if (tab) process.stdout.write(`${tab.lines.join('\n')}\n`);
    return;
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const estado: PanelViewState = { tab: Math.min(inicial, tabs.length - 1), scroll: 0 };
  const anteriorRaw = stdin.isRaw === true;
  let resolver = () => {};
  let cerrado = false;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  const pintar = () => {
    stdout.write(renderPanelScreen(tabs, estado, stdout.columns ?? 80, stdout.rows ?? 24));
  };

  const limpiar = () => {
    if (cerrado) return;
    cerrado = true;
    stdin.pause();
    stdin.removeListener('keypress', alPulsar);
    stdout.write(`${SHOW}${ALT_OFF}`);
    try {
      stdin.setRawMode(anteriorRaw);
    } catch {
      // el terminal ya no está disponible
    }
    stdout.removeListener('resize', pintar);
    resolver();
  };

  const alPulsar = (
    _texto: string,
    tecla: { name?: string; ctrl?: boolean; shift?: boolean },
  ) => {
    const nombre = tecla.name ?? '';
    if (nombre === 'q' || nombre === 'escape' || (tecla.ctrl && nombre === 'c')) {
      limpiar();
      return;
    }
    if (nombre === 'right' || nombre === 'tab') {
      estado.tab = (estado.tab + (tecla.shift ? -1 : 1) + tabs.length) % tabs.length;
      estado.scroll = 0;
    } else if (nombre === 'left') {
      estado.tab = (estado.tab - 1 + tabs.length) % tabs.length;
      estado.scroll = 0;
    } else if (nombre === 'down') {
      estado.scroll = Math.min(
        Math.max(0, (tabs[estado.tab]?.lines.length ?? 0) - 1),
        estado.scroll + 1,
      );
    } else if (nombre === 'up') {
      estado.scroll = Math.max(0, estado.scroll - 1);
    } else if (nombre === 'pagedown') {
      estado.scroll = Math.min(
        Math.max(0, (tabs[estado.tab]?.lines.length ?? 0) - 1),
        estado.scroll + Math.max(1, (stdout.rows ?? 24) - 8),
      );
    } else if (nombre === 'pageup') {
      estado.scroll = Math.max(0, estado.scroll - Math.max(1, (stdout.rows ?? 24) - 8));
    } else if (nombre === 'home') {
      estado.scroll = 0;
    } else if (nombre === 'end') {
      estado.scroll = Math.max(0, (tabs[estado.tab]?.lines.length ?? 0) - 1);
    } else if (/^[1-9]$/.test(nombre)) {
      const indice = Number(nombre) - 1;
      if (indice < tabs.length) {
        estado.tab = indice;
        estado.scroll = 0;
      }
    }
    pintar();
  };

  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(ALT_ON);
  stdin.on('keypress', alPulsar);
  stdout.on('resize', pintar);
  pintar();

  await promesa;
}
