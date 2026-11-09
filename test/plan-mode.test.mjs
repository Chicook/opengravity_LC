// Ciclo de plan: fases, compuerta de herramientas y mensajes inyectados.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const { CicloDePlan, peticionDeRevision, peticionPorInterrupcion, handback } = modulo('plan-mode');

/** Ciclo recién creado, sin plan aprobado. */
const libre = () => new CicloDePlan({ cada: 3 });

describe('fase libre (sin plan)', () => {
  test('deja pasar cualquier herramienta', () => {
    const ciclo = libre();
    assert.equal(ciclo.fase, 'libre');
    assert.equal(ciclo.compuerta({ name: 'write_file' }), null);
    assert.equal(ciclo.compuerta({ name: 'run_command' }), null);
  });

  test('no inyecta mensajes ni cuenta invocaciones', () => {
    const ciclo = libre();
    assert.equal(ciclo.mensajePendiente(), null);
    ciclo.contarInvocacion();
    assert.equal(ciclo.invocaciones, 0);
  });
});

describe('fase planificando', () => {
  const planificando = () => new CicloDePlan({ cada: 3, empezarPlanificando: true });

  test('permite leer y entregar el plan', () => {
    const ciclo = planificando();
    assert.equal(ciclo.fase, 'planificando');
    assert.equal(ciclo.compuerta({ name: 'read_file' }), null);
    assert.equal(ciclo.compuerta({ name: 'present_plan' }), null);
  });

  test('bloquea lo que modifica', () => {
    const ciclo = planificando();
    for (const nombre of ['write_file', 'edit_file', 'run_command']) {
      const rechazo = ciclo.compuerta({ name: nombre });
      assert.ok(rechazo, `${nombre} debería bloquearse`);
      assert.match(rechazo, /present_plan/);
    }
  });

  test('rechaza devolver el control sin plan aprobado', () => {
    const rechazo = planificando().compuerta({ name: 'enter_plan_mode' });
    assert.ok(rechazo);
    assert.match(rechazo, /todavía no hay plan/i);
  });

  test('el agente puede consultar una skill para planificar', () => {
    assert.equal(planificando().compuerta({ name: 'skill' }), null);
  });
});

describe('fase ejecutando', () => {
  const ejecutando = () => {
    const ciclo = new CicloDePlan({ cada: 3 });
    ciclo.entregarPlan({ steps: [{ title: 'a' }] });
    return ciclo;
  };

  test('deja pasar todo y cuenta invocaciones', () => {
    const ciclo = ejecutando();
    assert.equal(ciclo.fase, 'ejecutando');
    for (let i = 0; i < 2; i += 1) {
      assert.equal(ciclo.compuerta({ name: 'write_file' }), null);
      ciclo.contarInvocacion();
    }
    assert.equal(ciclo.invocaciones, 2);
    assert.equal(ciclo.mensajePendiente(), null, 'aún no toca revisión');
  });

  test('al llegar a la cadencia pide revisión', () => {
    const ciclo = ejecutando();
    for (let i = 0; i < 3; i += 1) ciclo.contarInvocacion();
    const mensaje = ciclo.mensajePendiente();
    assert.ok(mensaje);
    assert.match(mensaje, /revisión de plan/);
    assert.equal(ciclo.revisionPendiente, true);
  });

  test('con la revisión pendiente solo pasa enter_plan_mode', () => {
    const ciclo = ejecutando();
    for (let i = 0; i < 3; i += 1) ciclo.contarInvocacion();
    ciclo.mensajePendiente();

    assert.equal(ciclo.compuerta({ name: 'enter_plan_mode' }), null);
    for (const nombre of ['write_file', 'read_file', 'run_command']) {
      assert.ok(ciclo.compuerta({ name: nombre }), `${nombre} debería bloquearse`);
    }
  });

  test('una interrupción del usuario pide revisión aunque no toque', () => {
    const ciclo = ejecutando();
    ciclo.interrupcion = true;
    const mensaje = ciclo.mensajePendiente();
    assert.ok(mensaje);
    assert.match(mensaje, /ha escrito mientras trabajabas/);
    assert.equal(ciclo.revisionPendiente, true);
  });
});

describe('devolver el control y volver a ejecutar', () => {
  test('devolverControl pasa a revisando y reinicia el contador', () => {
    const ciclo = new CicloDePlan({ cada: 2 });
    ciclo.entregarPlan({ steps: [{ title: 'a' }] });
    ciclo.contarInvocacion();
    ciclo.contarInvocacion();
    ciclo.mensajePendiente();

    const texto = ciclo.devolverControl('paso 1 hecho, paso 2 falla');

    assert.equal(ciclo.fase, 'revisando');
    assert.equal(ciclo.invocaciones, 0);
    assert.equal(ciclo.revisionPendiente, false);
    assert.equal(ciclo.revisiones, 1);
    assert.match(texto, /paso 1 hecho, paso 2 falla/);
  });

  test('en revisando no se puede escribir', () => {
    const ciclo = new CicloDePlan({ cada: 2 });
    ciclo.entregarPlan({ steps: [{ title: 'a' }] });
    ciclo.contarInvocacion();
    ciclo.contarInvocacion();
    ciclo.mensajePendiente();
    ciclo.devolverControl('informe');

    assert.ok(ciclo.compuerta({ name: 'write_file' }));
    assert.equal(ciclo.compuerta({ name: 'read_file' }), null);
    assert.equal(ciclo.compuerta({ name: 'exit_plan_mode' }), null, 'el planner entrega así');
  });

  test('entregarPlan vuelve a ejecutar con el contador a cero', () => {
    const ciclo = new CicloDePlan({ cada: 2 });
    ciclo.entregarPlan({ steps: [{ title: 'a' }] });
    ciclo.contarInvocacion();
    ciclo.contarInvocacion();
    ciclo.mensajePendiente();
    ciclo.devolverControl('informe');
    ciclo.entregarPlan({ steps: [{ title: 'b' }] });

    assert.equal(ciclo.fase, 'ejecutando');
    assert.equal(ciclo.invocaciones, 0);
    assert.equal(ciclo.revisionPendiente, false);
    assert.equal(ciclo.compuerta({ name: 'write_file' }), null);
  });
});

describe('límites', () => {
  test('el resumen expone el estado', () => {
    const ciclo = new CicloDePlan({ cada: 4 });
    const resumen = ciclo.resumen;
    assert.equal(resumen.cada, 4);
    assert.equal(resumen.fase, 'libre');
  });

  test('sinRevisiones se cumple al llegar al tope', () => {
    const ciclo = new CicloDePlan({ cada: 1, maxRevisiones: 2 });
    assert.equal(ciclo.sinRevisiones(), false);
    ciclo.entregarPlan({ steps: [] });
    ciclo.contarInvocacion();
    ciclo.mensajePendiente();
    ciclo.devolverControl('x');
    assert.equal(ciclo.sinRevisiones(), false);
    ciclo.entregarPlan({ steps: [] });
    ciclo.contarInvocacion();
    ciclo.mensajePendiente();
    ciclo.devolverControl('y');
    assert.equal(ciclo.sinRevisiones(), true);
  });
});

describe('plantillas', () => {
  test('la petición de revisión incluye la cadencia', () => {
    const texto = peticionDeRevision({ desde: 5, cada: 5 });
    assert.match(texto, /5 invocaciones/);
    assert.match(texto, /enter_plan_mode/);
  });

  test('la interrupción dice que no actúe sobre el mensaje', () => {
    const texto = peticionPorInterrupcion();
    assert.match(texto, /No actúes/);
  });

  test('el handback incluye el informe del ejecutor', () => {
    const texto = handback({ informe: 'INFORME DE PRUEBA' });
    assert.match(texto, /INFORME DE PRUEBA/);
    assert.match(texto, /exit_plan_mode/);
  });
});
