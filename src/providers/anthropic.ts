/**
 * Adaptador Anthropic — Messages API con streaming SSE.
 *
 * Diferencias clave con OpenAI que este adaptador absorbe:
 *  - `system` va como campo aparte, no como mensaje.
 *  - Los tool calls son bloques `tool_use` dentro de `content`.
 *  - Los resultados de herramientas son bloques `tool_result` en un mensaje `user`.
 *
 * API: https://docs.anthropic.com/en/api/messages
 */

import {
  ProviderError,
  type Capabilities,
  type Chunk,
  type FinishReason,
  type GenerateRequest,
  type Message,
  type ModelInfo,
  type ModelProvider,
  type ToolCall,
} from './types.js';
import { DEFAULT_BASE_URLS, coerceArguments, ensureOk, fetchWithRetry, readSSE, tryParseJSON } from './http.js';

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Versión de API requerida por la cabecera `anthropic-version`. */
  apiVersion?: string;
  /** Cabeceras extra (proxies, gateways, cabeceras de sesión). */
  headers?: Record<string, string>;
}

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200_000 },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200_000 },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200_000 },
];

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic';
  readonly capabilities: Capabilities = {
    streaming: true,
    tools: true,
    vision: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: AnthropicOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URLS.anthropic).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.apiVersion = options.apiVersion ?? '2023-06-01';
    this.extraHeaders = options.headers ?? {};
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
      ...this.extraHeaders,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return FALLBACK_MODELS;

    try {
      const response = await fetch(`${this.baseUrl}/models?limit=100`, {
        headers: this.headers(),
      });

      if (!response.ok) return FALLBACK_MODELS;

      const payload = (await response.json()) as {
        data?: Array<{ id?: string; display_name?: string; created_at?: string }>;
      };

      const models: ModelInfo[] = [];
      for (const entry of payload.data ?? []) {
        if (typeof entry.id !== 'string') continue;
        models.push({ id: entry.id, name: entry.display_name ?? entry.id });
      }

      return models.length > 0 ? models : FALLBACK_MODELS;
    } catch {
      // sin red o endpoint no disponible: se usa la lista curada
      return FALLBACK_MODELS;
    }
  }

  async *streamGenerate(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<Chunk> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: toAnthropicMessages(req.messages),
      stream: true,
    };

    // Caché de prompt solo si el llamante lo pide: escribir caché cuesta 1,25×,
    // así que en un turno de un solo paso saldría más caro que no usarla.
    if (req.system) {
      body.system = req.cachePrompt
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
        : req.system;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;

    if (req.tools && req.tools.length > 0) {
      const tools = req.tools;
      body.tools = tools.map((tool, index) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...(req.cachePrompt && index === tools.length - 1
          ? { cache_control: { type: 'ephemeral' } }
          : {}),
      }));
    }

    const response = await fetchWithRetry(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }, this.id, { signal, retries: 3 });
    await ensureOk(response, this.id);

    if (!response.body) {
      throw new ProviderError(this.id, undefined, 'respuesta sin cuerpo');
    }

    // Acumuladores por índice de bloque de contenido.
    const textBlocks = new Map<number, string>();
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    let finishReason: FinishReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const payload of readSSE(response.body, this.id)) {
      const event = tryParseJSON(payload) as
        | {
            type?: string;
            index?: number;
            content_block?: { type?: string; id?: string; name?: string };
            delta?: {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
              stop_reason?: string;
            };
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
            error?: { message?: string };
          }
        | undefined;

      if (!event) continue;

      if (event.error?.message) {
        throw new ProviderError(this.id, undefined, event.error.message);
      }

      switch (event.type) {
        case 'message_start':
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;

        case 'content_block_start': {
          const index = event.index ?? 0;
          if (event.content_block?.type === 'tool_use') {
            toolBlocks.set(index, {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              json: '',
            });
          }
          break;
        }

        case 'content_block_delta': {
          const index = event.index ?? 0;
          // Bloques de razonamiento extendido (thinking).
          if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            yield { type: 'reasoning', text: event.delta.thinking };
            break;
          }

          if (event.delta?.type === 'text_delta' && event.delta.text) {
            textBlocks.set(index, (textBlocks.get(index) ?? '') + event.delta.text);
            yield { type: 'text', text: event.delta.text };
          }
          if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            const slot = toolBlocks.get(index);
            if (slot) slot.json += event.delta.partial_json;
          }
          break;
        }

        case 'message_delta':
          if (event.delta?.stop_reason) {
            finishReason = mapFinishReason(event.delta.stop_reason);
          }
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          break;

        default:
          break;
      }
    }

    for (const slot of toolBlocks.values()) {
      if (slot.name.length === 0) continue;
      const call: ToolCall = {
        id: slot.id || `call_${crypto.randomUUID()}`,
        name: slot.name,
        arguments: coerceArguments(slot.json),
      };
      yield { type: 'tool_call', call };
    }

    if (toolBlocks.size > 0) finishReason = 'tool_calls';

    if (inputTokens > 0 || outputTokens > 0) {
      yield { type: 'usage', inputTokens, outputTokens };
    }

    yield { type: 'done', finishReason };
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

function toAnthropicMessages(messages: Message[]): unknown[] {
  const result: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue; // va en `system`, no aquí

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      result.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      });
      continue;
    }

    if (message.role === 'tool') {
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId ?? '',
            content: message.content,
          },
        ],
      });
      continue;
    }

    // Mensaje de usuario con imágenes: Anthropic usa bloques `image`.
    if (message.role === 'user' && message.images && message.images.length > 0) {
      const blocks: unknown[] = [];
      for (const image of message.images) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mimeType, data: image.data },
        });
      }
      blocks.push({ type: 'text', text: message.content });
      result.push({ role: 'user', content: blocks });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
}
