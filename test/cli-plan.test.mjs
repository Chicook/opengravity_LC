import test from 'node:test';
import assert from 'node:assert/strict';

const { PlanSession } = await import('../dist/cli/plan.js');
const { makePresentPlanTool } = await import('../dist/cli/subagents.js');

test('el plan bloquea escritura hasta que se aprueba', () => {
  const plan = new PlanSession(true);
  assert.equal(plan.fase, 'planificando');
  assert.match(plan.compuerta({ name: 'write_file' }) ?? '', /bloqueadas/);
  assert.equal(plan.compuerta({ name: 'read_file' }), null);

  plan.entregarPlan({ steps: [{ title: 'Hacer algo' }] });
  assert.equal(plan.ejecutando(), true);
  assert.equal(plan.compuerta({ name: 'write_file' }), null);
});

test('present_plan aprobado mueve el ciclo a ejecución', async () => {
  const plan = new PlanSession(true);
  const herramienta = makePresentPlanTool({ actual: async () => true }, plan);
  const resultado = await herramienta.execute({
    title: 'Plan',
    steps: [{ title: 'Paso 1' }],
  });

  assert.match(resultado.content, /Plan aprobado/);
  assert.equal(plan.ejecutando(), true);
});

test('present_plan rechazado no abre la ejecución', async () => {
  const plan = new PlanSession(true);
  const herramienta = makePresentPlanTool({ actual: async () => false }, plan);
  const resultado = await herramienta.execute({
    title: 'Plan',
    steps: [{ title: 'Paso 1' }],
  });

  assert.equal(resultado.isError, true);
  assert.equal(plan.ejecutando(), false);
});
