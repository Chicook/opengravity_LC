// El bucle debe pedir el historial con el tope del modelo, no con una constante
// igual para todos. Se comprueba sin red: el proveedor falso cuenta cuántos
// mensajes recibe y si se compactó.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { raiz } from './helpers.mjs';

const { runAgent } = await import(pathToFileURL(path.join(raiz, 'dist/agent/loop.js')).href);
const { ToolRegistry } = await import(pathToFileURL(path.join(raiz, 'dist/tools/registry.js')).href);

/** Proveedor que responde siempre lo mismo y anota el tamaño del historial. */
function proveedorQueAnota(registro) {
  return {
    id: 'openai',
    async *streamGenerate(req) {
      registro.push(req.messages.reduce((n, m) => n + (m.content ?? '').length, 0));
      yield { type: 'text', text: 'ok' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

test('el tope de contexto depende del modelo, no de una constante fija', async () => {
  const historial = 'x'.repeat(30_000);

  // Un modelo pequeño (8k tokens ≈ 24 000 caracteres) no cabe: debe compactar.
  const pequeno = [];
  const eventosPequeno = [];
  await runAgent(
    {
      provider: proveedorQueAnota(pequeno),
      model: 'llama3.2:8k',
      tools: new ToolRegistry(),
      initialMessages: [{ role: 'user', content: historial }],
      onEvent: (e) => eventosPequeno.push(e.type),
    },
    'sigue',
  );

  // El mismo historial con un modelo grande (1M tokens) cabe de sobra.
  const grande = [];
  const eventosGrande = [];
  await runAgent(
    {
      provider: proveedorQueAnota(grande),
      model: 'gemini-2.5-pro',
      tools: new ToolRegistry(),
      initialMessages: [{ role: 'user', content: historial }],
      onEvent: (e) => eventosGrande.push(e.type),
    },
    'sigue',
  );

  // Con 8k el envío se recorta; con Gemini el historial va entero.
  assert.ok(
    grande[0] > pequeno[0],
    `el modelo grande debe enviar más historial (${grande[0]} vs ${pequeno[0]})`,
  );
  assert.ok(eventosPequeno.includes('compacting'), 'el modelo pequeño debe compactar');
  assert.ok(!eventosGrande.includes('compacting'), 'el modelo grande no debe compactar');
});
