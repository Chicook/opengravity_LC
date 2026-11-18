/**
 * Extremo a extremo sin red: el nivel elegido tiene que salir en el cuerpo que
 * el adaptador manda al proveedor, no quedarse en el módulo de la escala.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { raiz } from './helpers.mjs';

const { OpenAIProvider } = await import(
  pathToFileURL(path.join(raiz, 'dist/providers/openai.js')).href
);

/** Proveedor con `fetch` interceptado: devuelve el cuerpo que se envió. */
function capturarCuerpo(nivel, proveedor) {
  const cuerpos = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    cuerpos.push(JSON.parse(init.body));
    // Stream SSE mínimo y válido: un trozo de texto y el fin.
    const cuerpo = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(cuerpo, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  return { cuerpos, restaurar: () => { globalThis.fetch = original; } };
}

test('el nivel del composer sale en reasoning_effort del cuerpo enviado', async () => {
  const { OpenAIProvider: P } = await import(
    pathToFileURL(path.join(raiz, 'dist/providers/openai.js')).href
  );
  const p = new P({ id: 'openai', baseUrl: 'https://ejemplo.invalid/v1', apiKey: 'k' });

  const capturado = capturarCuerpo();
  try {
    for await (const _ of p.streamGenerate({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hola' }],
      reasoningEffort: 'high',
    })) {
      // se consume el stream
    }
  } finally {
    capturado.restaurar();
  }

  assert.equal(capturado.cuerpos.length, 1, 'debe hacerse una sola petición');
  assert.equal(capturado.cuerpos[0].reasoning_effort, 'high');
});

test('sin nivel no se manda reasoning_effort (el modelo usa su defecto)', async () => {
  const { OpenAIProvider: P } = await import(
    pathToFileURL(path.join(raiz, 'dist/providers/openai.js')).href
  );
  const p = new P({ id: 'openai', baseUrl: 'https://ejemplo.invalid/v1', apiKey: 'k' });

  const capturado = capturarCuerpo();
  try {
    for await (const _ of p.streamGenerate({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hola' }],
    })) {
      // se consume el stream
    }
  } finally {
    capturado.restaurar();
  }

  assert.equal('reasoning_effort' in capturado.cuerpos[0], false);
});
