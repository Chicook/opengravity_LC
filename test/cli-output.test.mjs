// Contrato headless: text deja la respuesta en stdout y los diagnósticos en
// stderr; json devuelve un sobre; stream-json emite init, step_update y result.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { crearSalida } = await import('../dist/cli/output.js');

function capturar() {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  return {
    stdout,
    stderr,
    restaurar() {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    },
  };
}

const resultado = {
  text: 'respuesta',
  messages: [],
  appended: [],
  steps: 1,
  reason: 'stop',
};

test('json devuelve un solo sobre y no contamina stdout con el texto', () => {
  const cap = capturar();
  try {
    const salida = crearSalida({
      formato: 'json',
      conversationId: 'c1',
      cwd: '.',
      tools: ['read_file'],
      permissionMode: 'request-review',
      model: 'm',
      numTurns: 1,
    });
    salida.onEvent({ type: 'text', text: 'respuesta' });
    salida.final(resultado);
  } finally {
    cap.restaurar();
  }

  const lineas = cap.stdout.join('').trim().split('\n');
  assert.equal(lineas.length, 1);
  const sobre = JSON.parse(lineas[0]);
  assert.equal(sobre.conversation_id, 'c1');
  assert.equal(sobre.status, 'SUCCESS');
  assert.equal(sobre.response, 'respuesta');
});

test('stream-json emite init, eventos y result', () => {
  const cap = capturar();
  try {
    const salida = crearSalida({
      formato: 'stream-json',
      conversationId: 'c2',
      cwd: '.',
      tools: ['read_file'],
      permissionMode: 'accept-edits',
      model: 'm',
      numTurns: 1,
    });
    salida.onEvent({ type: 'step', index: 1 });
    salida.onEvent({ type: 'text', text: 'hola' });
    salida.final(resultado);
  } finally {
    cap.restaurar();
  }

  const eventos = cap.stdout.join('').trim().split('\n').map((linea) => JSON.parse(linea));
  assert.equal(eventos[0].event, 'init');
  assert.equal(eventos[0].init.permission_mode, 'accept-edits');
  assert.ok(eventos.some((evento) => evento.event === 'step_update'));
  assert.equal(eventos.at(-1).event, 'result');
  assert.equal(eventos.at(-1).result.response, 'respuesta');
});

test('varios turnos en stream-json comparten init y acumulan usage', () => {
  const cap = capturar();
  try {
    const salida = crearSalida({
      formato: 'stream-json',
      conversationId: 'c4',
      cwd: '.',
      tools: [],
      permissionMode: 'request-review',
      model: 'm',
      numTurns: 0,
    });
    salida.iniciarTurno();
    salida.onEvent({ type: 'usage', inputTokens: 10, outputTokens: 2 });
    salida.onEvent({ type: 'text', text: 'uno' });
    salida.final({ ...resultado, text: 'uno' }, undefined, undefined, 'SUCCESS', 1);
    salida.iniciarTurno();
    salida.onEvent({ type: 'usage', inputTokens: 5, outputTokens: 3 });
    salida.onEvent({ type: 'text', text: 'dos' });
    salida.final({ ...resultado, text: 'dos' }, undefined, undefined, 'SUCCESS', 2);
  } finally {
    cap.restaurar();
  }

  const eventos = cap.stdout.join('').trim().split('\n').map((linea) => JSON.parse(linea));
  assert.equal(eventos.filter((evento) => evento.event === 'init').length, 1);
  const resultados = eventos.filter((evento) => evento.event === 'result');
  assert.equal(resultados.length, 2);
  assert.equal(resultados[0].result.num_turns, 1);
  assert.equal(resultados[1].result.num_turns, 2);
  assert.deepEqual(resultados[1].result.usage, {
    input_tokens: 15,
    output_tokens: 5,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 20,
  });
});

test('text escribe la respuesta en stdout y los avisos en stderr', () => {
  const cap = capturar();
  try {
    const salida = crearSalida({
      formato: 'text',
      conversationId: 'c3',
      cwd: '.',
      tools: [],
      permissionMode: 'request-review',
      model: 'm',
      numTurns: 1,
    });
    salida.onEvent({ type: 'text', text: 'respuesta' });
    salida.onEvent({ type: 'tool_start', call: { id: '1', name: 'read_file', arguments: {} } });
    salida.final(resultado);
  } finally {
    cap.restaurar();
  }

  assert.equal(cap.stdout.join(''), 'respuesta\n');
  assert.match(cap.stderr.join(''), /read_file/);
});
