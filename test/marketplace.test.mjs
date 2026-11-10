import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cargarCatalogo, normalizarEntrada, entradaAPlugin } = require('../electron/marketplace.cjs');

test('el catálogo empaquetado tiene entradas válidas y sin ids repetidos', () => {
  const catalogo = cargarCatalogo();
  assert.ok(catalogo.length >= 4);

  const ids = new Set();
  for (const entrada of catalogo) {
    assert.match(entrada.id, /^[a-z0-9-]+$/);
    assert.ok(entrada.name.length > 0);
    assert.ok(entrada.command.length > 0);
    assert.ok(Array.isArray(entrada.args));
    assert.equal(ids.has(entrada.id), false, `id repetido: ${entrada.id}`);
    ids.add(entrada.id);
  }
});

test('normalizarEntrada descarta entradas incompletas', () => {
  assert.equal(normalizarEntrada(null), null);
  assert.equal(normalizarEntrada({ id: 'x', name: '', command: 'npx', args: [] }), null);
  assert.equal(normalizarEntrada({ id: 'x', name: 'X', command: '', args: [] }), null);
  assert.equal(normalizarEntrada({ id: 'x', name: 'X', command: 'npx', args: [1] }), null);
});

test('entradaAPlugin produce un plugin habilitado con id propio', () => {
  const args = ['-y', 'server'];
  const env = { A: '1' };
  const plugin = entradaAPlugin({
    id: 'filesystem',
    name: 'Filesystem',
    command: 'npx',
    args,
    env,
  });
  assert.deepEqual(plugin, {
    id: 'mcp-filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', 'server'],
    env: { A: '1' },
    enabled: true,
  });
  plugin.args.push('otro');
  assert.equal(args.length, 2);
});
