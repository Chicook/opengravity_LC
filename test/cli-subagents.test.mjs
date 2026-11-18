import { test } from 'node:test';
import assert from 'node:assert/strict';

const { makeInvokeSubagentTool, makePresentPlanTool } = await import('../dist/cli/subagents.js');

function proveedorFalso(texto) {
  return {
    id: 'falso',
    capabilities: { streaming: true, tools: true, vision: false },
    async listModels() {
      return [];
    },
    async *streamGenerate() {
      yield { type: 'text', text: texto };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

test('invoke_subagent devuelve el resumen y no comparte historial', async () => {
  const tool = makeInvokeSubagentTool({
    cwd: process.cwd(),
    prefs: {},
    provider: proveedorFalso('resumen del subagente'),
    model: 'falso',
    contextWindow: 8_000,
    ajustes: {},
  });

  const resultado = await tool.execute(
    { subagents: [{ name: 'lector', role: 'Reader', prompt: 'lee algo' }] },
    { cwd: process.cwd() },
  );

  assert.match(resultado.content, /resumen del subagente/);
  assert.equal(resultado.isError, false);
});

test('un modelo inexistente se reintenta con el default, un fallo real no', async () => {
  const modelos = [];
  const proveedor = {
    id: 'falso',
    capabilities: { streaming: true, tools: true, vision: false },
    async listModels() {
      return [];
    },
    async *streamGenerate(peticion) {
      modelos.push(peticion.model);
      if (peticion.model === 'modelo-inexistente') {
        throw new Error('model not found: modelo-inexistente');
      }
      yield { type: 'text', text: `respondió ${peticion.model || 'default'}` };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  const tool = makeInvokeSubagentTool({
    cwd: process.cwd(),
    prefs: {},
    provider: proveedor,
    model: 'modelo-inexistente',
    contextWindow: 8_000,
    ajustes: {},
  });
  const resultado = await tool.execute(
    { subagents: [{ name: 'lector', prompt: 'lee algo' }] },
    { cwd: process.cwd() },
  );
  assert.match(resultado.content, /respondió default/);
  assert.equal(modelos.at(-1), '');
  assert.ok(modelos.slice(0, -1).every((modelo) => modelo === 'modelo-inexistente'));

  modelos.length = 0;
  const falloReal = {
    ...proveedor,
    async *streamGenerate(peticion) {
      modelos.push(peticion.model);
      throw new Error('permiso denegado');
    },
  };
  const toolFallo = makeInvokeSubagentTool({
    cwd: process.cwd(),
    prefs: {},
    provider: falloReal,
    model: 'modelo-inexistente',
    contextWindow: 8_000,
    ajustes: {},
  });
  const resultadoFallo = await toolFallo.execute(
    { subagents: [{ name: 'lector', prompt: 'lee algo' }] },
    { cwd: process.cwd() },
  );
  assert.match(resultadoFallo.content, /FALLÓ/);
  assert.ok(modelos.length > 0);
  assert.ok(!modelos.includes(''));
});

test('present_plan pide aprobación si hay TUI y la rechaza si no', async () => {
  const sinTui = makePresentPlanTool({});
  const aceptado = await sinTui.execute({
    title: 'Plan',
    steps: [{ title: 'Paso 1' }],
  });
  assert.match(aceptado.content, /Plan presentado/);

  const conTui = makePresentPlanTool({
    actual: async () => true,
  });
  const aprobado = await conTui.execute({
    title: 'Plan',
    steps: [{ title: 'Paso 1' }],
  });
  assert.match(aprobado.content, /Plan aprobado/);
});
