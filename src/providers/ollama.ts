/**
 * Adaptador Ollama — modelos locales, sin API key, sin coste.
 *
 * Es el adaptador de referencia para desarrollar: permite validar todo el
 * bucle del agente sin gastar tokens ni configurar credenciales.
 *
 * API: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
 */

import {
  ProviderError,
  type Capabilities,
  type Chunk,
  type GenerateRequest,
  type Message,
  type ModelInfo,
  type ModelProvider,
  type ToolCall,
} from './types.js';
import { DEFAULT_BASE_URLS, coerceArguments, ensureOk, fetchWithRetry, readNDJSON, tryParseJSON } from './http.js';

export interface OllamaOptions {
  baseUrl?: string;
  /** Modelo por defecto si la petición no especifica uno. */
  defaultModel?: string;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: unknown };
  }>;
}

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama';
  readonly capabilities: Capabilities = {
    streaming: true,
    tools: true,
    vision: false,
  };

  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URLS.ollama).replace(/\/+$/, '');
    this.defaultModel = options.defaultModel ?? 'llama3.2';
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    await ensureOk(response, this.id);

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string; details?: { parameter_size?: string } }>;
    };

    return (payload.models ?? [])
      .map((entry) => {
        const id = entry.model ?? entry.name;
        if (!id) return undefined;
        const size = entry.details?.parameter_size;
        return { id, name: size ? `${id} (${size})` : id } satisfies ModelInfo;
      })
      .filter((model): model is ModelInfo => model !== undefined);
  }

  async *streamGenerate(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<Chunk> {
    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel,
      messages: toOllamaMessages(req),
      stream: true,
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    if (req.temperature !== undefined) {
      body.options = { temperature: req.temperature };
    }

    const response = await fetchWithRetry(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }, this.id, { signal, retries: 3 });
    await ensureOk(response, this.id);

    if (!response.body) {
      throw new ProviderError(this.id, undefined, 'respuesta sin cuerpo');
    }

    let sawToolCall = false;

    for await (const line of readNDJSON(response.body)) {
      const event = tryParseJSON(line) as
        | {
            message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          }
        | undefined;

      if (!event) continue;

      if (event.error) {
        throw new ProviderError(this.id, undefined, event.error);
      }

      const text = event.message?.content;
      if (text && text.length > 0) {
        yield { type: 'text', text };
      }

      for (const raw of event.message?.tool_calls ?? []) {
        sawToolCall = true;
        const call: ToolCall = {
          id: `call_${crypto.randomUUID()}`,
          name: raw.function.name,
          arguments: coerceArguments(raw.function.arguments),
        };
        yield { type: 'tool_call', call };
      }

      if (event.done) {
        if (event.prompt_eval_count !== undefined || event.eval_count !== undefined) {
          yield {
            type: 'usage',
            inputTokens: event.prompt_eval_count ?? 0,
            outputTokens: event.eval_count ?? 0,
          };
        }

        yield {
          type: 'done',
          finishReason: sawToolCall ? 'tool_calls' : mapFinishReason(event.done_reason),
        };
        return;
      }
    }

    yield { type: 'done', finishReason: sawToolCall ? 'tool_calls' : 'stop' };
  }
}

function mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'error' {
  switch (reason) {
    case 'length':
      return 'length';
    case 'error':
      return 'error';
    default:
      return 'stop';
  }
}

function toOllamaMessages(req: GenerateRequest): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [];

  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  for (const message of req.messages) {
    messages.push(toOllamaMessage(message));
  }

  return messages;
}

function toOllamaMessage(message: Message): OllamaChatMessage {
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }

  if (message.role === 'tool') {
    return { role: 'tool', content: message.content };
  }

  return { role: message.role as 'system' | 'user' | 'assistant', content: message.content };
}
