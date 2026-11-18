import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../dist/providers/http.js';

test('readSSE cancela el cuerpo al recibir [DONE]', async () => {
  const encoder = new TextEncoder();
  let cancelado = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"ok":true}\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      // El servidor no cierra el cuerpo: si readSSE no lo cancela, el
      // consumidor se queda con la conexión ocupada.
    },
    cancel() {
      cancelado = true;
    },
  });

  const eventos = [];
  for await (const evento of readSSE(body, 'test')) eventos.push(evento);

  assert.deepEqual(eventos, ['{"ok":true}']);
  assert.equal(cancelado, true);
});

test('readSSE acepta eventos separados por CRLF', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n'));
      controller.close();
    },
  });

  const eventos = [];
  for await (const evento of readSSE(body, 'test')) eventos.push(evento);

  assert.deepEqual(eventos, ['{"a":1}', '{"a":2}']);
});
