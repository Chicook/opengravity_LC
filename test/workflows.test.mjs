import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeRunWorkflowTool, validarArgsWorkflow, esquemaDeWorkflow } = require('../electron/tools-extra.cjs');

test('workflow: acepta inputSchema y valida argumentos', () => {
  const meta = {
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  };
  assert.deepEqual(esquemaDeWorkflow(meta), meta.inputSchema);
  assert.equal(validarArgsWorkflow(meta, { name: 'Ada' }), null);
  assert.match(validarArgsWorkflow(meta, {}), /required property 'name'/);
});

test('workflow: admite args como mapa de propiedades', () => {
  const meta = { args: { count: { type: 'number' } } };
  assert.equal(esquemaDeWorkflow(meta).type, 'object');
  assert.equal(validarArgsWorkflow(meta, { count: 2 }), null);
  assert.match(validarArgsWorkflow(meta, { count: 'dos' }), /must be number/);
});

test('workflow: sin esquema no valida', () => {
  assert.equal(esquemaDeWorkflow({ description: 'libre' }), null);
  assert.equal(validarArgsWorkflow({}, { anything: true }), null);
});


test('workflow: no ejecuta si los argumentos no cumplen workflow.json', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'opengravity-workflow-'));
  try {
    const carpeta = path.join(cwd, '.opengravity', 'workflows');
    await fs.mkdir(carpeta, { recursive: true });
    await fs.writeFile(path.join(carpeta, 'saludar.py'), 'print("hola")', 'utf8');
    await fs.writeFile(
      path.join(carpeta, 'saludar.workflow.json'),
      JSON.stringify({ inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }),
      'utf8',
    );

    let ejecutado = false;
    const tool = makeRunWorkflowTool(
      () => cwd,
      async () => {
        ejecutado = true;
        return { content: 'ok', isError: false };
      },
    );

    const invalido = await tool.execute({ name: 'saludar', args: {} }, { cwd });
    assert.equal(invalido.isError, true);
    assert.equal(ejecutado, false);

    const valido = await tool.execute({ name: 'saludar', args: { name: 'Ada' } }, { cwd });
    assert.equal(valido.content, 'ok');
    assert.equal(ejecutado, true);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
