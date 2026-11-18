/**
 * Niveles de pensamiento: que el nivel elegido llegue al campo correcto de cada
 * proveedor, y que a los que no lo aceptan no se les mande nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);
const p = requerir('../electron/pensamiento.cjs');

test('la escala tiene los seis niveles del motor', () => {
  assert.deepEqual(p.NIVELES, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
});

test('normaliza lo que llega del composer, en cualquier caja', () => {
  assert.equal(p.normalizarNivel('High'), 'high');
  assert.equal(p.normalizarNivel('XHIGH'), 'xhigh');
  assert.equal(p.normalizarNivel('Max'), 'max');
  assert.equal(p.normalizarNivel('minimal'), 'minimal');
});

test('lo vacío o desconocido no fuerza nada', () => {
  assert.equal(p.normalizarNivel(''), null);
  assert.equal(p.normalizarNivel(null), null);
  assert.equal(p.normalizarNivel('Modelo por defecto'), null);
  assert.equal(p.normalizarNivel('turbo'), null);
  assert.deepEqual(p.ajustesDePensamiento({ nivel: 'raro', tipo: 'openai' }), {});
});

test('OpenAI recibe reasoning_effort solo en modelos de razonamiento', () => {
  assert.deepEqual(
    p.ajustesDePensamiento({
      nivel: 'low',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'o3',
    }),
    { reasoningEffort: 'low' },
  );
  // gpt-4o no acepta el campo: mandarlo devuelve 400.
  assert.deepEqual(
    p.ajustesDePensamiento({
      nivel: 'Medium',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'gpt-4o',
    }),
    {},
  );
  // Groq y las pasarelas compatibles tampoco tienen por qué aceptarlo.
  assert.deepEqual(
    p.ajustesDePensamiento({ nivel: 'Medium', tipo: 'openai', proveedor: 'groq' }),
    {},
  );
});

test('o1/o3 no reciben minimal; gpt-5 sí', () => {
  assert.equal(
    p.ajustesDePensamiento({
      nivel: 'minimal',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'o3',
    }).reasoningEffort,
    'low',
  );
  assert.equal(
    p.ajustesDePensamiento({
      nivel: 'minimal',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'gpt-5',
    }).reasoningEffort,
    'minimal',
  );
});

test('por encima de high, OpenAI se queda en high', () => {
  // La API no tiene escalones más altos: no se inventa un valor que rechazaría.
  assert.equal(
    p.ajustesDePensamiento({
      nivel: 'max',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'o3',
    }).reasoningEffort,
    'high',
  );
  assert.equal(
    p.ajustesDePensamiento({
      nivel: 'xhigh',
      tipo: 'openai',
      proveedor: 'openai',
      modelo: 'o3',
    }).reasoningEffort,
    'high',
  );
});

test('Anthropic recibe un presupuesto en tokens que crece con el nivel', () => {
  const bajo = p.ajustesDePensamiento({ nivel: 'minimal', tipo: 'anthropic' }).thinkingBudget;
  const alto = p.ajustesDePensamiento({ nivel: 'max', tipo: 'anthropic' }).thinkingBudget;
  assert.ok(alto > bajo, `max (${alto}) debe superar a minimal (${bajo})`);
  assert.equal(alto, p.TOKENS_POR_NIVEL.max);
});

test('Gemini 2.5 usa presupuesto y Gemini 3+ usa thinkingLevel', () => {
  const viejo = p.ajustesDePensamiento({
    nivel: 'high',
    tipo: 'gemini',
    modelo: 'gemini-2.5-pro',
  });
  assert.equal(typeof viejo.thinkingBudget, 'number');
  assert.equal(viejo.thinkingLevel, undefined);

  const nuevo = p.ajustesDePensamiento({
    nivel: 'high',
    tipo: 'gemini',
    modelo: 'gemini-3-pro',
  });
  assert.equal(nuevo.thinkingLevel, 'high');
  assert.equal(nuevo.thinkingBudget, undefined);
});

test('los modelos locales no reciben un campo que rechazarían', () => {
  // LM Studio, vLLM y llama.cpp se declaran kind 'openai' pero son servidores
  // locales: `reasoning_effort` les devuelve 400.
  for (const proveedor of ['ollama', 'lmstudio', 'vllm', 'llamacpp']) {
    const ajustes = p.ajustesDePensamiento({
      nivel: 'high',
      tipo: proveedor === 'ollama' ? 'ollama' : 'openai',
      proveedor,
    });
    assert.deepEqual(ajustes, {}, `${proveedor} no debe recibir ajustes`);
  }
});
