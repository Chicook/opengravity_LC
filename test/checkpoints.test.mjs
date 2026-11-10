import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { restoreSnapshots } = require('../electron/checkpoints.cjs');

test('restaura cada snapshot con el contenido de ese turno', async () => {
  const escritos = new Map();
  const checkpoints = new Map([
    [0, new Map([['A.txt', 'A-viejo']])],
    [2, new Map([['B.txt', 'B-viejo']])],
  ]);

  const resultado = await restoreSnapshots({
    keys: [0, 2],
    checkpoints,
    writeFile: async (ruta, contenido) => escritos.set(ruta, contenido),
    rm: async () => {},
  });

  assert.deepEqual([...escritos], [
    ['B.txt', 'B-viejo'],
    ['A.txt', 'A-viejo'],
  ]);
  assert.deepEqual(resultado, { restored: 2, failures: [] });
  assert.equal(checkpoints.size, 0);
});

test('devuelve el fallo y conserva el snapshot para reintentar', async () => {
  const checkpoints = new Map([[0, new Map([['A.txt', 'A-viejo']])]]);

  const resultado = await restoreSnapshots({
    keys: [0],
    checkpoints,
    writeFile: async () => {
      throw new Error('EACCES');
    },
    rm: async () => {},
  });

  assert.equal(resultado.restored, 0);
  assert.equal(resultado.failures[0].path, 'A.txt');
  assert.equal(checkpoints.size, 1);
});
