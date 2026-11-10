import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/*
 * `renderer/` cuelga de un paquete `"type": "module"`, así que Node carga este
 * fichero como ESM y no rellena `module.exports`. El helper se publica igual
 * que en la ventana, en `globalThis.GuardianRow`, y de ahí lo leemos.
 */
require('../renderer/guardian-row.js');
const { chooseRow } = globalThis.GuardianRow;

test('elige la última fila en ejecución de la herramienta', () => {
  const primera = { tool: 'run_command', running: false };
  const segunda = { tool: 'run_command', running: true };
  const otra = { tool: 'read_file', running: true };

  assert.equal(chooseRow([primera, segunda, otra], 'run_command'), segunda);
});

test('si ya terminó, usa la última fila de esa herramienta', () => {
  const primera = { tool: 'read_file', running: false };
  const segunda = { tool: 'read_file', running: false };

  assert.equal(chooseRow([primera, segunda], 'read_file'), segunda);
  assert.equal(chooseRow([], 'run_command'), null);
});
