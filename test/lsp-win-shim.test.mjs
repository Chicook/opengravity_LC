import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { resolverShimWindows, citarParaCmd } = require('../electron/lsp.cjs');

test('citarParaCmd deja intacto un argumento simple', () => {
  assert.equal(citarParaCmd('--stdio'), '--stdio');
});

test('citarParaCmd protege rutas con espacios y comillas', () => {
  assert.equal(citarParaCmd('C:\\Program Files\\Go\\bin'), '"C:\\Program Files\\Go\\bin"');
  assert.equal(citarParaCmd('a"b'), '"a""b"');
});

test('resolverShimWindows reconoce un .cmd absoluto', { skip: process.platform !== 'win32' }, () => {
  const shim = path.join('C:\\', 'herramientas', 'pyright-langserver.cmd');
  assert.equal(resolverShimWindows(shim), shim);
});

test('resolverShimWindows ignora un .exe absoluto', { skip: process.platform !== 'win32' }, () => {
  assert.equal(resolverShimWindows('C:\\Go\\bin\\go.exe'), null);
});

test('resolverShimWindows no inventa un comando fuera de PATH', { skip: process.platform !== 'win32' }, () => {
  assert.equal(resolverShimWindows('opengravity-servidor-que-no-existe-12345'), null);
});
