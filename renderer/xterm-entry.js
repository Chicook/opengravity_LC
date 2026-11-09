/**
 * Punto de entrada de xterm.js.
 *
 * Se empaqueta a `renderer/xterm/xterm.js`. Expone `window.XtermApp` con el
 * terminal y el addon de ajuste.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

window.XtermApp = { Terminal, FitAddon };
