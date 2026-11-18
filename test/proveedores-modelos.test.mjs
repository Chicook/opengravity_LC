import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../dist/providers/openai.js';
import { AnthropicProvider } from '../dist/providers/anthropic.js';
import { GeminiProvider } from '../dist/providers/gemini.js';
import { OllamaProvider } from '../dist/providers/ollama.js';
import {
  createProvider,
  detectAvailableProviders,
  findProvider,
  PROVIDER_CATALOG,
  soportaPensamiento,
} from '../dist/providers/registry.js';

/** Sustituye `fetch` durante una prueba y lo restaura siempre. */
async function conFetch(falso, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = falso;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('listModels usa el nombre legible, ordena y manda timeout', async () => {
  let init = null;
  const modelos = await conFetch(
    async (_url, opciones) => {
      init = opciones;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'zeta-model', name: 'Zeta Model' },
            { id: 'alpha-model', name: 'Alpha Model' },
          ],
        }),
        { status: 200 },
      );
    },
    async () => new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' }).listModels(),
  );

  assert.deepEqual(modelos.map((model) => model.id), ['alpha-model', 'zeta-model']);
  assert.equal(modelos[0].name, 'Alpha Model');
  assert.ok(init.signal instanceof AbortSignal, 'la petición debe llevar timeout');
});

test('listModels acepta una lista directa y cae al id si no hay nombre', async () => {
  const modelos = await conFetch(
    async () =>
      new Response(JSON.stringify([{ id: 'solo-id' }, { id: 'con-nombre', name: 'Con Nombre' }]), {
        status: 200,
      }),
    async () => new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' }).listModels(),
  );

  assert.deepEqual(modelos, [
    { id: 'con-nombre', name: 'Con Nombre' },
    { id: 'solo-id', name: 'solo-id' },
  ]);
});

test('listModels propaga el error HTTP con el detalle', async () => {
  await assert.rejects(
    conFetch(
      async () => new Response('{"error":{"message":"clave inválida"}}', { status: 401 }),
      async () => new OpenAIProvider({ apiKey: 'mala', baseUrl: 'https://ejemplo.test/v1' }).listModels(),
    ),
    /HTTP 401/,
  );
});

test('detectAvailableProviders cuenta la clave guardada, no solo el entorno', async () => {
  const disponibles = await conFetch(
    async (url) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { status: 200 });
      }
      throw new Error('sin conexión');
    },
    async () => detectAvailableProviders({ apiKeys: { openai: 'sk-guardada' } }),
  );

  assert.deepEqual(disponibles, ['openai']);
});

test('sin clave ni entorno, el proveedor no se consulta', async () => {
  // El entorno de la máquina manda: tener OPENAI_API_KEY exportada ponía en
  // rojo la suite aunque el código fuese correcto.
  const guardadas = new Map();
  for (const spec of PROVIDER_CATALOG) {
    if (!spec.envKey) continue;
    guardadas.set(spec.envKey, process.env[spec.envKey]);
    delete process.env[spec.envKey];
  }

  try {
    const llamadas = [];
    const disponibles = await conFetch(
      async (url) => {
        llamadas.push(String(url));
        return new Response(JSON.stringify({ data: [], models: [] }), { status: 200 });
      },
      async () => detectAvailableProviders({}),
    );

    assert.equal(disponibles.includes('openai'), false);
    assert.equal(llamadas.some((url) => url.includes('api.openai.com')), false);
  } finally {
    for (const [clave, valor] of guardadas) {
      if (valor !== undefined) process.env[clave] = valor;
    }
  }
});

test('Ollama manda las imágenes de un modelo de visión', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('{"done":true,"message":{"content":"ok"}}\n', { status: 200 });
    },
    async () => {
      const provider = new OllamaProvider({ baseUrl: 'http://local.test' });
      for await (const _chunk of provider.streamGenerate({
        model: 'llava',
        messages: [{
          role: 'user',
          content: '¿qué ves?',
          images: [{ mimeType: 'image/png', data: 'YWJj' }],
        }],
      })) {
        // consumir el stream
      }
    },
  );

  assert.deepEqual(cuerpo.messages[0].images, ['YWJj']);
});

test('Ollama recibe num_ctx y num_predict del presupuesto del agente', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('{"done":true,"message":{"content":"ok"}}\n', { status: 200 });
    },
    async () => {
      const provider = new OllamaProvider({ baseUrl: 'http://local.test' });
      for await (const _chunk of provider.streamGenerate({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hola' }],
        contextWindow: 8_192,
        maxTokens: 512,
      })) {
        // consumir el stream
      }
    },
  );

  assert.equal(cuerpo.options.num_ctx, 8_192);
  assert.equal(cuerpo.options.num_predict, 512);
});

test('Anthropic pide pensamiento con presupuesto y temperatura 1', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const _chunk of provider.streamGenerate({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hola' }],
        thinkingBudget: 4096,
      })) {
        // consumir el stream
      }
    },
  );

  assert.deepEqual(cuerpo.thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.ok(cuerpo.max_tokens >= 5120, 'max_tokens debe superar el presupuesto');
  assert.equal(cuerpo.temperature, 1);
});

test('Anthropic devuelve el bloque thinking con su firma para el siguiente paso', async () => {
  const eventos = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"pienso"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"firma"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"read_file"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.ts\\"}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
  ].join('');

  const chunks = [];
  await conFetch(
    async () => new Response(eventos, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const chunk of provider.streamGenerate({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'lee' }],
        thinkingBudget: 4096,
      })) {
        chunks.push(chunk);
      }
    },
  );

  const bloque = chunks.find((chunk) => chunk.type === 'thinking_block');
  assert.deepEqual(bloque.block, { thinking: 'pienso', signature: 'firma' });
  assert.ok(chunks.some((chunk) => chunk.type === 'tool_call' && chunk.call.name === 'read_file'));
});

test('Anthropic sin presupuesto no envía thinking', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const _chunk of provider.streamGenerate({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hola' }],
      })) {
        // consumir el stream
      }
    },
  );

  assert.equal(cuerpo.thinking, undefined);
});

test('Gemini 2.5 pide pensamientos y presupuesto; 1.5 no', async () => {
  const cuerpos = [];
  await conFetch(
    async (_url, init) => {
      cuerpos.push(JSON.parse(init.body));
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new GeminiProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1beta' });
      for (const model of ['gemini-2.5-pro', 'gemini-1.5-pro']) {
        for await (const _chunk of provider.streamGenerate({
          model,
          messages: [{ role: 'user', content: 'hola' }],
          thinkingBudget: 2048,
        })) {
          // consumir el stream
        }
      }
    },
  );

  assert.deepEqual(cuerpos[0].generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingBudget: 2048,
  });
  assert.equal(cuerpos[1].generationConfig?.thinkingConfig, undefined);
});

test('soportaPensamiento solo en los modelos que lo permiten', () => {
  assert.equal(soportaPensamiento('anthropic', 'claude-3-5-sonnet-20241022'), false);
  assert.equal(soportaPensamiento('anthropic', 'claude-3-7-sonnet-20250219'), true);
  assert.equal(soportaPensamiento('anthropic', 'claude-sonnet-4-5-20250929'), true);
  assert.equal(soportaPensamiento('anthropic', 'claude-opus-4-1'), true);
  assert.equal(soportaPensamiento('gemini', 'gemini-2.0-flash'), false);
  assert.equal(soportaPensamiento('gemini', 'gemini-2.5-pro'), true);
  assert.equal(soportaPensamiento('gemini', 'gemini-3-pro'), true);
  assert.equal(soportaPensamiento('openai', 'deepseek-v4.1-flash'), false);
  assert.equal(soportaPensamiento('ollama', 'llama3'), false);
});

test('los servidores propios admiten URL y token opcionales', () => {
  for (const id of ['lmstudio', 'vllm', 'llamacpp']) {
    const spec = findProvider(id);
    assert.ok(spec, `falta ${id} en el catálogo`);
    assert.equal(spec.selfHosted, true, `${id} debe admitir URL y token propios`);
    assert.equal(spec.envKey, null, `${id} no tiene variable de entorno`);
  }
  assert.equal(findProvider('ollama').selfHosted, undefined);
});

test('createProvider manda el token guardado de LM Studio como Bearer', async () => {
  let cabeceras = null;
  await conFetch(
    async (_url, init) => {
      cabeceras = init.headers;
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = createProvider('lmstudio', { apiKeys: { lmstudio: 'token-local' } });
      for await (const _chunk of provider.streamGenerate({
        model: 'qwen2.5-coder-7b',
        messages: [{ role: 'user', content: 'hola' }],
      })) {
        // consumir el stream
      }
    },
  );

  assert.equal(cabeceras.authorization, 'Bearer token-local');
});

test('sin token, LM Studio sigue funcionando y no manda Authorization', async () => {
  let cabeceras = null;
  const modelos = await conFetch(
    async (_url, init) => {
      cabeceras = init.headers;
      return new Response(JSON.stringify({ data: [{ id: 'modelo-local' }] }), { status: 200 });
    },
    async () => createProvider('lmstudio', {}).listModels(),
  );

  assert.deepEqual(modelos, [{ id: 'modelo-local', name: 'modelo-local' }]);
  assert.equal(cabeceras.authorization, undefined);
});

test('Anthropic pide pensamiento también con herramientas y conserva los bloques', async () => {
  // La API exige devolver los bloques thinking intactos al enviar un
  // tool_result. Message los transporta en `thinkingBlocks`, así que pedirlo
  // ya no rompe el segundo paso.
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const _chunk of provider.streamGenerate({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hola' }],
        thinkingBudget: 4096,
        tools: [{ name: 'read_file', description: 'lee', parameters: { type: 'object' } }],
      })) {
        // consumir el stream
      }
    },
  );

  assert.deepEqual(cuerpo.thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.equal(cuerpo.temperature, 1);
  assert.ok(Array.isArray(cuerpo.tools));
});

test('Anthropic reenvía los bloques thinking antes del tool_use', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const _chunk of provider.streamGenerate({
        model: 'claude-sonnet-4-5',
        messages: [
          { role: 'user', content: 'lee el fichero' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'a.ts' } }],
            thinkingBlocks: [{ thinking: 'necesito verlo', signature: 'firma' }],
          },
          { role: 'tool', content: 'contenido', toolCallId: 't1', name: 'read_file' },
        ],
      })) {
        // consumir el stream
      }
    },
  );

  assert.deepEqual(cuerpo.messages[1].content[0], {
    type: 'thinking',
    thinking: 'necesito verlo',
    signature: 'firma',
  });
  assert.equal(cuerpo.messages[1].content[1].type, 'tool_use');
});

test('Gemini 3 recibe los pensamientos pero no thinkingBudget', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new GeminiProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1beta' });
      for await (const _chunk of provider.streamGenerate({
        model: 'gemini-3-pro',
        messages: [{ role: 'user', content: 'hola' }],
        thinkingLevel: 'high',
      })) {
        // consumir el stream
      }
    },
  );

  assert.deepEqual(cuerpo.generationConfig.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'high',
  });
});

test('Gemini no enciende el pensamiento si no se pide', async () => {
  let cuerpo = null;
  await conFetch(
    async (_url, init) => {
      cuerpo = JSON.parse(init.body);
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new GeminiProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1beta' });
      for await (const _chunk of provider.streamGenerate({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hola' }],
      })) {
        // consumir el stream
      }
    },
  );

  assert.equal(cuerpo.generationConfig?.thinkingConfig, undefined);
});

test('soportaPensamiento no ofrece enabled a los Claude que solo aceptan adaptive', () => {
  assert.equal(soportaPensamiento('anthropic', 'claude-sonnet-4-6'), true);
  assert.equal(soportaPensamiento('anthropic', 'claude-opus-4-7'), false);
  assert.equal(soportaPensamiento('anthropic', 'claude-sonnet-5'), false);
  assert.equal(soportaPensamiento('anthropic', 'claude-3-5-sonnet-20241022'), false);
  assert.equal(soportaPensamiento('openai', 'gpt-5', 'openai'), true);
  assert.equal(soportaPensamiento('openai', 'o3', 'openai'), true);
  assert.equal(soportaPensamiento('openai', 'gpt-4o', 'openai'), false);
  assert.equal(soportaPensamiento('openai', 'o3', 'openrouter'), false);
});

test('Anthropic pide un tope de salida realista sin maxTokens explícito', async () => {
  const cuerpos = [];
  await conFetch(
    async (_url, init) => {
      cuerpos.push(JSON.parse(init.body));
      return new Response('data: [DONE]\n\n', { status: 200 });
    },
    async () => {
      const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for (const modelo of ['claude-sonnet-4-5', 'claude-3-opus-20240229']) {
        for await (const _chunk of provider.streamGenerate({
          model: modelo,
          messages: [{ role: 'user', content: 'hola' }],
        })) {
          // consumir el stream
        }
      }
    },
  );

  assert.equal(cuerpos[0].max_tokens, 8192, 'los modelos modernos admiten 8192');
  assert.equal(cuerpos[1].max_tokens, 4096, 'Claude 3 original solo admite 4096');
});

test('OpenAI tolera un delta con lista de partes y no escribe [object Object]', async () => {
  // Pasarelas compatibles devuelven `content` como lista de partes.
  const trozos = [
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"hola "}]},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"mundo"}]},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  let texto = '';
  await conFetch(
    async () => new Response(trozos, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    async () => {
      const provider = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://ejemplo.test/v1' });
      for await (const chunk of provider.streamGenerate({
        model: 'deepseek-v4',
        messages: [{ role: 'user', content: 'hola' }],
      })) {
        if (chunk.type === 'text') texto += chunk.text;
      }
    },
  );

  assert.equal(texto, 'hola mundo');
  assert.equal(texto.includes('[object Object]'), false);
});
