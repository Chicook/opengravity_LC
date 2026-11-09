/**
 * Empaqueta Monaco y sus workers con esbuild.
 *
 * Salida:
 *   renderer/monaco/monaco.js          editor + lenguajes
 *   renderer/monaco/*.worker.js        workers por lenguaje
 *
 * Uso: npm run build:monaco
 */

import { build } from 'esbuild';
import { rm, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const outdir = join(projectRoot, 'renderer', 'monaco');

await rm(outdir, { recursive: true, force: true });

// xterm.js para la terminal
await rm(join(projectRoot, 'renderer', 'xterm'), { recursive: true, force: true });

await build({
  entryPoints: {
    xterm: join(projectRoot, 'renderer', 'xterm-entry.js'),
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outdir: join(projectRoot, 'renderer', 'xterm'),
  entryNames: '[name]',
  logLevel: 'info',
  minify: false,
  sourcemap: false,
});

await build({
  entryPoints: {
    monaco: join(projectRoot, 'renderer', 'monaco-entry.js'),
    'editor.worker': join(projectRoot, 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js'),
    'ts.worker': join(projectRoot, 'node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js'),
    'json.worker': join(projectRoot, 'node_modules/monaco-editor/esm/vs/language/json/json.worker.js'),
    'css.worker': join(projectRoot, 'node_modules/monaco-editor/esm/vs/language/css/css.worker.js'),
    'html.worker': join(projectRoot, 'node_modules/monaco-editor/esm/vs/language/html/html.worker.js'),
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outdir,
  entryNames: '[name]',
  loader: { '.ttf': 'file' },
  logLevel: 'info',
  minify: false,
  sourcemap: false,
});

// Copia el CSS de xterm junto a su bundle.
await mkdir(join(projectRoot, 'renderer', 'xterm'), { recursive: true });
await copyFile(
  join(projectRoot, 'node_modules/@xterm/xterm/css/xterm.css'),
  join(projectRoot, 'renderer', 'xterm', 'xterm.css'),
);

console.log('Monaco y xterm empaquetados en renderer/');
