// Catálogo del CLI: reutiliza las herramientas de la app que no necesitan
// Electron y no registra navegador, Flow ni abrir URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { crearHerramientasCli } = await import('../dist/cli/tools.js');

test('el CLI tiene edición, búsqueda, comandos, tests y memoria', () => {
  const tools = crearHerramientasCli({ cwd: process.cwd(), prefs: {} });
  const nombres = new Set(tools.map((tool) => tool.name));

  for (const esperada of [
    'read_file',
    'edit_file',
    'multi_replace',
    'search_files',
    'file_search',
    'search_code',
    'run_command',
    'command_status',
    'run_tests',
    'view_code_item',
    'memory',
    'skill',
  ]) {
    assert.ok(nombres.has(esperada), `falta ${esperada}`);
  }

  for (const prohibida of ['browser_open', 'open_url', 'generate_image', 'browser_task']) {
    assert.equal(nombres.has(prohibida), false, `${prohibida} necesita Electron`);
  }
});
