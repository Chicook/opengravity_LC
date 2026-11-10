import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cargarCatalogo, normalizarEntrada } = require('../electron/marketplace.cjs');

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

test('cada servidor fija una versión exacta', () => {
  for (const entrada of cargarCatalogo()) {
    const paquete = entrada.args.find((arg) => arg.startsWith('@modelcontextprotocol/'));
    assert.match(paquete, /@\d+\.\d+\.\d+$/, `sin versión exacta: ${paquete}`);
  }
});

test('normalizarEntrada descarta entradas incompletas', () => {
  assert.equal(normalizarEntrada(null), null);
  assert.equal(normalizarEntrada({ id: 'x', name: '', command: 'npx', args: [] }), null);
  assert.equal(normalizarEntrada({ id: 'x', name: 'X', command: '', args: [] }), null);
  assert.equal(normalizarEntrada({ id: 'x', name: 'X', command: 'npx', args: [1] }), null);
});

