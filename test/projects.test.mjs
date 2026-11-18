import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  nombreProyecto,
  normalizarProyecto,
  normalizarProyectos,
  registrarEnLista,
} = require('../electron/projects.cjs');

const base = path.join(os.tmpdir(), 'opengravity-projects-test');

test('nombreProyecto usa la última carpeta de la ruta', () => {
  assert.equal(nombreProyecto(path.join(base, 'tienda')), 'tienda');
});

test('normalizarProyecto rechaza entradas sin ruta', () => {
  assert.equal(normalizarProyecto(null), null);
  assert.equal(normalizarProyecto({}), null);
  assert.equal(normalizarProyecto({ path: '   ' }), null);
});

test('normalizarProyectos elimina duplicados y conserva el más reciente', () => {
  const ruta = path.join(base, 'tienda');
  const viejo = { path: ruta, lastUsed: '2026-01-01T00:00:00.000Z' };
  const nuevo = { path: ruta, lastUsed: '2026-02-01T00:00:00.000Z' };
  const lista = normalizarProyectos([viejo, nuevo]);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].lastUsed, '2026-02-01T00:00:00.000Z');
});

test('registrarEnLista añade un proyecto sin tocar la lista original', () => {
  const original = [];
  const lista = registrarEnLista(original, path.join(base, 'nuevo'), '2026-03-01T00:00:00.000Z');
  assert.equal(original.length, 0);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].path, path.join(base, 'nuevo'));
  assert.equal(lista[0].name, 'nuevo');
  assert.equal(lista[0].lastUsed, '2026-03-01T00:00:00.000Z');
});

test('registrarEnLista actualiza el proyecto existente sin duplicarlo', () => {
  const ruta = path.join(base, 'nuevo');
  const lista = registrarEnLista(
    [{ path: ruta, name: 'nuevo', lastUsed: '2026-01-01T00:00:00.000Z' }],
    ruta,
    '2026-04-01T00:00:00.000Z',
  );
  assert.equal(lista.length, 1);
  assert.equal(lista[0].lastUsed, '2026-04-01T00:00:00.000Z');
});
