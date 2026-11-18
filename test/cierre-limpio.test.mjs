/**
 * Cierre limpio: matar una tarea tiene que esperar a que el árbol muera, y
 * matar todas tiene que esperarlas todas.
 *
 * Es la regla que faltaba. `before-quit` lanzaba `taskkill` y salía sin mirar,
 * así que la app moría antes que sus hijos y estos quedaban vivos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);
const extra = requerir('../electron/tools-extra.cjs');

test('matarTarea devuelve una promesa, para poder esperarla', () => {
  const resultado = extra.matarTarea(null);
  assert.ok(resultado instanceof Promise, 'debe ser esperable, no fuego y olvido');
  return resultado;
});

test('matarTodasLasTareas devuelve una promesa que resuelve', async () => {
  const resultado = extra.matarTodasLasTareas();
  assert.ok(resultado instanceof Promise);
  await resultado;
});

test('matar varias tareas sin pid no deja promesas rechazadas', async () => {
  // Tareas sin pid: se cierran por el guard o no hacen nada, pero ninguna debe
  // reventar la limpieza de salida.
  await extra.matarTodasLasTareas();
});

test('las dos funciones siguen exportadas', () => {
  assert.equal(typeof extra.matarTarea, 'function');
  assert.equal(typeof extra.matarTodasLasTareas, 'function');
});
