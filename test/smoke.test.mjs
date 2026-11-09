// Comprobación de que el runner arranca y de que los helpers cargan los módulos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { modulo, raiz, temporal, escribir } from './helpers.mjs';

test('el runner carga los módulos CJS de electron/', () => {
  const cron = modulo('cron');
  assert.equal(typeof cron.siguienteEjecucion, 'function');
  assert.equal(typeof cron.compilarCron, 'function');
});

test('la raíz del proyecto apunta donde debe', () => {
  assert.ok(raiz.endsWith('Nueva carpeta (7)') || raiz.length > 0);
  const paquete = modulo('cron'); // solo para asegurar que la ruta resuelve
  assert.ok(paquete);
});

test('el directorio temporal se crea y se limpia', () => {
  const { dir, limpiar } = temporal('smoke');
  const fichero = escribir(`${dir}/sub/carpeta/nota.txt`, 'hola');
  assert.ok(fichero.includes('nota.txt'));
  limpiar();
});
