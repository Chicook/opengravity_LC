// Presupuesto de contexto por modelo.
//
// Antes el tope era el mismo para todos (~100k tokens): un modelo local de 8k
// fallaba el turno entero por exceso de contexto y uno de 1M compactaba sin
// necesidad, gastando una llamada extra en resumir. Estas pruebas fijan que la
// ventana salga del modelo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const contexto = modulo('contexto');
const {
  ventanaEnElNombre,
  ventanaDeModelo,
  presupuestoDeContexto,
  ventanaDeOllama,
  VENTANA_GENERICA,
  VENTANA_MINIMA_TOKENS,
} = contexto;

test('la ventana declarada por el proveedor manda sobre todo lo demás', () => {
  const tokens = ventanaDeModelo({ providerId: 'ollama', modelId: 'llama3.2:8k', reportada: 64_000 });
  assert.equal(tokens, 64_000);
});

test('una ventana declarada absurda se ignora', () => {
  for (const reportada of [0, -1, Number.NaN, undefined, null]) {
    const tokens = ventanaDeModelo({ providerId: 'ollama', modelId: 'llama3.2:8k', reportada });
    assert.equal(tokens, 8_000, `reportada=${String(reportada)} debe caer al nombre`);
  }
});

test('lee la ventana escrita en el nombre del modelo', () => {
  assert.equal(ventanaEnElNombre('llama3.2:8k'), 8_000);
  assert.equal(ventanaEnElNombre('qwen2.5-32k-instruct'), 32_000);
  assert.equal(ventanaEnElNombre('mistral-128k'), 128_000);
  assert.equal(ventanaEnElNombre('gemini-2m'), 2_000_000);
});

test('no confunde el tamaño en parámetros ni la cuantización con la ventana', () => {
  // 7b son parámetros, q4_K_M es cuantización, 2.5 es versión.
  assert.equal(ventanaEnElNombre('qwen2.5:7b'), null);
  assert.equal(ventanaEnElNombre('llama3.2:latest'), null);
  assert.equal(ventanaEnElNombre('q4_K_M'), null);
  assert.equal(ventanaEnElNombre(''), null);
});

test('sin datos del modelo se usa la ventana por defecto del proveedor', () => {
  assert.equal(ventanaDeModelo({ providerId: 'anthropic', modelId: 'claude-x' }), 200_000);
  assert.equal(ventanaDeModelo({ providerId: 'gemini', modelId: 'gemini-x' }), 1_000_000);
  assert.equal(ventanaDeModelo({ providerId: 'openai', modelId: 'gpt-x' }), VENTANA_GENERICA);
  assert.equal(ventanaDeModelo({}), VENTANA_GENERICA);
  // Un servidor local sin ventana declarada no puede asumir 128k.
  assert.equal(ventanaDeModelo({ providerId: 'lmstudio', modelId: 'qwen-local' }), 8_192);
  assert.equal(ventanaDeModelo({ providerId: 'vllm', modelId: 'modelo-local' }), 8_192);
});

test('nunca baja del suelo: un modelo con ventana mínima no da presupuesto cero', () => {
  const tokens = ventanaDeModelo({ reportada: 1, modelId: 'x' });
  assert.equal(tokens, VENTANA_MINIMA_TOKENS);
  assert.ok(presupuestoDeContexto({ reportada: 1 }) > 0);
});

test('el presupuesto en caracteres respeta la proporción y deja margen', () => {
  // ~4 caracteres por token, con un 25% libre para la respuesta.
  assert.equal(presupuestoDeContexto({ reportada: 8_000 }), 24_000);
  // Un modelo grande da más presupuesto que uno pequeño: era justo lo que no pasaba.
  assert.ok(
    presupuestoDeContexto({ reportada: 1_000_000 }) > presupuestoDeContexto({ reportada: 8_000 }),
  );
});

test('lee las capacidades declaradas por Ollama', () => {
  const { capacidadesDeOllama } = contexto;
  assert.deepEqual(
    capacidadesDeOllama({ capabilities: ['completion', 'tools', 'vision'] }),
    { tools: true, vision: true },
  );
  assert.deepEqual(capacidadesDeOllama({ capabilities: ['completion'] }), {
    tools: false,
    vision: false,
  });
  assert.equal(capacidadesDeOllama({}), null);
  assert.equal(capacidadesDeOllama(null), null);
});

test('lee la ventana de la respuesta de /api/show de Ollama', () => {
  const payload = { model_info: { 'llama.context_length': 8_192, 'general.x': 'y' } };
  assert.equal(ventanaDeOllama(payload), 8_192);
  // La arquitectura cambia con la familia: se busca por sufijo, no por nombre.
  assert.equal(ventanaDeOllama({ model_info: { 'qwen2.context_length': 32_768 } }), 32_768);
  assert.equal(ventanaDeOllama({ model_info: {} }), null);
  assert.equal(ventanaDeOllama({}), null);
  assert.equal(ventanaDeOllama(null), null);
});
