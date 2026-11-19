import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { notasDe, esPortable, porcentaje } = require('../electron/update-utils.cjs');

test('notasDe acepta texto y listas de electron-updater', () => {
  assert.equal(notasDe({ releaseNotes: 'Hola' }), 'Hola');
  assert.equal(
    notasDe({ releaseNotes: [{ note: 'Uno' }, { note: 'Dos' }, 'Tres'] }),
    'Uno\n\nDos\n\nTres',
  );
  assert.equal(notasDe(null), null);
});

test('esPortable detecta el entorno de electron-builder', () => {
  assert.equal(esPortable({ PORTABLE_EXECUTABLE_FILE: 'x.exe' }), true);
  assert.equal(esPortable({ PORTABLE_EXECUTABLE_DIR: 'x' }), true);
  assert.equal(esPortable({}), false);
});

test('porcentaje acota valores anómalos', () => {
  assert.equal(porcentaje(42.6), 43);
  assert.equal(porcentaje(-10), 0);
  assert.equal(porcentaje(150), 100);
  assert.equal(porcentaje('no-numero'), 0);
});
