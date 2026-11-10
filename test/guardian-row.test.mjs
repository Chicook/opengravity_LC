import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * `renderer/` cuelga de un paquete `"type": "module"`, así que el fichero se
 * carga como ESM y no rellena `module.exports`. Se publica igual que en la
 * ventana, en `globalThis.GuardianRow`.
 */
import '../renderer/guardian-row.js';

const { chooseRow } = globalThis.GuardianRow;

test('elige la última fila en ejecución de la herramienta', () => {
  const primera = { tool: 'run_command', running: false };
  const segunda = { tool: 'run_command', running: true };
  const otra = { tool: 'read_file', running: true };

  assert.equal(chooseRow([primera, segunda, otra], 'run_command'), segunda);
});

test('prefiere la que sigue en ejecución aunque después haya una terminada', () => {
  const enMarcha = { tool: 'run_command', running: true };
  const terminada = { tool: 'run_command', running: false };

  assert.equal(chooseRow([enMarcha, terminada], 'run_command'), enMarcha);
});

test('si ya terminó, usa la última fila de esa herramienta', () => {
  const primera = { tool: 'read_file', running: false };
  const segunda = { tool: 'read_file', running: false };

  assert.equal(chooseRow([primera, segunda], 'read_file'), segunda);
  assert.equal(chooseRow([], 'run_command'), null);
});

test('el id de llamada manda sobre el orden y el estado', () => {
  const primera = { tool: 'run_command', callId: 'call-1', running: true };
  const segunda = { tool: 'run_command', callId: 'call-2', running: true };

  assert.equal(chooseRow([primera, segunda], 'run_command', 'call-1'), primera);
  assert.equal(chooseRow([primera, segunda], 'run_command', 'call-2'), segunda);
});

test('un id desconocido cae en la preferencia por herramienta', () => {
  const primera = { tool: 'run_command', callId: 'call-1', running: false };
  const segunda = { tool: 'run_command', callId: 'call-2', running: false };

  assert.equal(chooseRow([primera, segunda], 'run_command', 'call-9'), segunda);
});
