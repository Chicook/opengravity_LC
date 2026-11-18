// Subagentes en paralelo con presupuesto de espera: el turno no debe quedarse
// colgado del más lento, y lo que llegue a tiempo tiene que fusionarse igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { correrEnParalelo } = require('../electron/subagent-merge.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('las tareas corren a la vez, no una detrás de otra', async () => {
  const inicio = Date.now();
  const { resultados, ms } = await correrEnParalelo([
    { nombre: 'a', ejecutar: async () => { await espera(120); return 'A'; } },
    { nombre: 'b', ejecutar: async () => { await espera(120); return 'B'; } },
    { nombre: 'c', ejecutar: async () => { await espera(120); return 'C'; } },
  ]);

  const pared = Date.now() - inicio;
  assert.deepEqual(resultados.map((r) => r.valor), ['A', 'B', 'C']);
  assert.ok(pared < 330, `tres tareas de 120 ms no deben tardar ${pared} ms`);
  assert.ok(ms >= 100);
});

test('la tarea lenta se corta al presupuesto y las demás se fusionan', async () => {
  const { resultados, vencidos, fallos } = await correrEnParalelo(
    [
      { nombre: 'rapida', ejecutar: async () => 'lista' },
      {
        nombre: 'lenta',
        ejecutar: (signal) =>
          new Promise((resolver, rechazar) => {
            const t = setTimeout(() => resolver('nunca'), 5000);
            signal.addEventListener('abort', () => {
              clearTimeout(t);
              rechazar(new Error('abortada'));
            });
          }),
      },
    ],
    { presupuestoMs: 80 },
  );

  assert.equal(vencidos, 1);
  assert.equal(fallos, 0, 'una tarea vencida no es un fallo del modelo');
  const porNombre = Object.fromEntries(resultados.map((r) => [r.nombre, r]));
  assert.equal(porNombre.rapida.valor, 'lista');
  assert.match(porNombre.lenta.error, /80 ms|0 s|no terminó/);
  assert.equal(porNombre.lenta.vencido, true);
});

test('un error real se informa como error, no como vencido', async () => {
  const { resultados, fallos, vencidos } = await correrEnParalelo([
    { nombre: 'rota', ejecutar: async () => { throw new Error('sin acceso'); } },
  ]);
  assert.equal(fallos, 1);
  assert.equal(vencidos, 0);
  assert.match(resultados[0].error, /sin acceso/);
});

test('sin presupuesto no se corta nada', async () => {
  const { resultados, vencidos } = await correrEnParalelo([
    { nombre: 'lenta', ejecutar: async () => { await espera(150); return 'ok'; } },
  ]);
  assert.equal(vencidos, 0);
  assert.equal(resultados[0].valor, 'ok');
});

test('lista vacía no rompe', async () => {
  const { resultados, vencidos, fallos } = await correrEnParalelo([]);
  assert.deepEqual(resultados, []);
  assert.equal(vencidos, 0);
  assert.equal(fallos, 0);
});
