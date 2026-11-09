// Tests del planificador de avisos: modos, cancelOn y jitter.
//
// La lógica de disparo vive dentro de `main.cjs`, que necesita Electron, así que aquí
// se prueba el módulo de cron y la forma de las tareas a través de un doble del
// almacén: lo que se puede probar sin arrancar la app.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const { compilarCron, siguienteEjecucion } = modulo('cron');

/** Simula la reprogramación que hace el planificador al disparar una tarea cron. */
function reprogramar(tarea, ahora = new Date()) {
  const proxima = siguienteEjecucion(compilarCron(tarea.cron), ahora);
  const base = proxima ?? new Date(ahora.getTime() + 60000);
  const dispersion = Number(tarea.jitterSeconds ?? 0);
  if (dispersion > 0) {
    base.setSeconds(base.getSeconds() + Math.floor(Math.random() * dispersion));
  }
  return base;
}

describe('reprogramación de una tarea cron', () => {
  const base = new Date(2026, 10, 4, 10, 7, 0, 0);

  test('sin jitter cae exactamente en la próxima marca', () => {
    const tarea = { cron: '*/5 * * * *', jitterSeconds: 0 };
    assert.equal(reprogramar(tarea, base).getTime(), new Date(2026, 10, 4, 10, 10).getTime());
  });

  test('con jitter la próxima marca queda dentro de la ventana', () => {
    const tarea = { cron: '*/5 * * * *', jitterSeconds: 30 };
    const marca = new Date(2026, 10, 4, 10, 10).getTime();

    // Se repite para cubrir el azar sin volver el test frágil.
    for (let i = 0; i < 30; i += 1) {
      const obtenido = reprogramar(tarea, base).getTime();
      assert.ok(obtenido >= marca, 'nunca antes de la marca');
      assert.ok(obtenido < marca + 30000, 'como mucho 30 s después');
    }
  });

  test('el jitter no cambia la marca base de un cron diario', () => {
    const tarea = { cron: '0 9 * * *', jitterSeconds: 5 };
    const marca = new Date(2026, 10, 5, 9, 0).getTime();
    const obtenido = reprogramar(tarea, base).getTime();
    assert.ok(obtenido >= marca && obtenido < marca + 5000);
  });
});

describe('cancelOn', () => {
  /** Reproduce la regla de `cancelarAvisosPendientes`. */
  const debeCancelarse = (tarea) =>
    tarea.mode === 'once' && tarea.enabled !== false && tarea.cancelOn === 'any';

  test('cancela un aviso único con cancelOn "any"', () => {
    assert.equal(debeCancelarse({ mode: 'once', enabled: true, cancelOn: 'any' }), true);
  });

  test('no cancela uno con cancelOn "never"', () => {
    assert.equal(debeCancelarse({ mode: 'once', enabled: true, cancelOn: 'never' }), false);
  });

  test('no cancela uno sin cancelOn', () => {
    assert.equal(debeCancelarse({ mode: 'once', enabled: true }), false);
  });

  test('no toca los recurrentes aunque tengan cancelOn', () => {
    assert.equal(debeCancelarse({ mode: 'cron', enabled: true, cancelOn: 'any' }), false);
    assert.equal(debeCancelarse({ mode: 'interval', enabled: true, cancelOn: 'any' }), false);
  });

  test('no vuelve a cancelar uno ya apagado', () => {
    assert.equal(debeCancelarse({ mode: 'once', enabled: false, cancelOn: 'any' }), false);
  });
});
