/**
 * Salida del CLI: texto limpio, un JSON al final o NDJSON por evento.
 *
 * Sigue el contrato de `agy -p`: en `text` la respuesta va a stdout y los
 * diagnósticos a stderr; en `json`/`stream-json` stdout es solo JSON.
 */

import type { AgentEvent, AgentResult } from '../agent/loop.js';

export type FormatoSalida = 'text' | 'json' | 'stream-json';

export interface SalidaOptions {
  formato: FormatoSalida;
  conversationId: string;
  cwd: string;
  tools: string[];
  permissionMode: string;
  model: string;
  effort?: string;
  numTurns: number;
  jsonSchema?: unknown;
}

export interface Salida {
  /** Prepara un turno nuevo conservando el uso acumulado de la sesión. */
  iniciarTurno: () => void;
  onEvent: (event: AgentEvent) => void;
  final: (
    resultado: AgentResult | null,
    error?: string,
    structuredOutput?: unknown,
    status?: 'SUCCESS' | 'ERROR' | 'CANCELED',
    numTurns?: number,
  ) => void;
}

/**
 * Construye el emisor. El `init` de `stream-json` sale al construirlo, antes
 * de la primera petición al modelo.
 */
export function crearSalida(options: SalidaOptions): Salida {
  const inicio = Date.now();
  let textoTurno = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let inputPrevios = 0;
  let outputPrevios = 0;
  let indicePaso = 0;

  const escribirEvento = (payload: unknown): void => {
    if (options.formato === 'stream-json') {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
  };

  if (options.formato === 'stream-json') {
    escribirEvento({
      event: 'init',
      conversation_id: options.conversationId,
      init: {
        cwd: options.cwd,
        tools: options.tools,
        permission_mode: options.permissionMode,
        model: options.model,
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.jsonSchema ? { json_schema: options.jsonSchema } : {}),
      },
    });
  }

  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'text':
        textoTurno += event.text;
        if (options.formato === 'text') {
          process.stdout.write(event.text);
        } else if (options.formato === 'stream-json') {
          escribirEvento({
            event: 'step_update',
            step_update: {
              conversation_id: options.conversationId,
              step_index: indicePaso,
              state: 'ACTIVE',
              step_type: 'agent_response',
              text_delta: event.text,
            },
          });
        }
        break;

      case 'step':
        indicePaso = Math.max(0, event.index - 1);
        if (options.formato === 'stream-json') {
          escribirEvento({
            event: 'step_update',
            step_update: {
              conversation_id: options.conversationId,
              step_index: indicePaso,
              state: 'DONE',
              step_type: event.index === 1 ? 'user_input' : 'agent_response',
            },
          });
        }
        break;

      case 'tool_start':
        if (options.formato === 'text') {
          process.stderr.write(`\n  → ${event.call.name}(${JSON.stringify(event.call.arguments)})\n`);
        } else if (options.formato === 'stream-json') {
          escribirEvento({
            event: 'step_update',
            step_update: {
              conversation_id: options.conversationId,
              step_index: indicePaso,
              state: 'ACTIVE',
              step_type: 'tool',
              tool_name: event.call.name,
              tool_info: { name: event.call.name, parameters: event.call.arguments },
            },
          });
        }
        break;

      case 'tool_end':
        if (options.formato === 'text') {
          process.stderr.write(`  ← ${event.isError ? 'error' : 'ok'}\n`);
        } else if (options.formato === 'stream-json') {
          escribirEvento({
            event: 'step_update',
            step_update: {
              conversation_id: options.conversationId,
              step_index: indicePaso,
              state: 'DONE',
              step_type: 'tool',
              tool_name: event.call.name,
              tool_info: {
                name: event.call.name,
                parameters: event.call.arguments,
                output: event.content,
                ...(event.isError ? { error: { type: 'tool_error', message: event.content } } : {}),
              },
            },
          });
        }
        break;

      case 'usage':
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        break;

      case 'nudge':
      case 'system_step':
        if (options.formato === 'text') {
          process.stderr.write(`\n[${event.type === 'nudge' ? 'ritmo' : 'sistema'}] ${event.text}\n`);
        }
        break;

      default:
        break;
    }
  };

  const iniciarTurno = (): void => {
    inputPrevios += inputTokens;
    outputPrevios += outputTokens;
    inputTokens = 0;
    outputTokens = 0;
    textoTurno = '';
  };

  const final = (
    resultado: AgentResult | null,
    error?: string,
    structuredOutput?: unknown,
    statusFinal?: 'SUCCESS' | 'ERROR' | 'CANCELED',
    numTurns?: number,
  ): void => {
    const status = statusFinal ?? (error ? 'ERROR' : 'SUCCESS');
    const response = resultado?.text ?? textoTurno;
    const duracion = (Date.now() - inicio) / 1000;
    const entrada = inputPrevios + inputTokens;
    const salida = outputPrevios + outputTokens;
    const uso = {
      input_tokens: entrada,
      output_tokens: salida,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: entrada + salida,
    };

    const envelope = {
      conversation_id: options.conversationId,
      status,
      response,
      ...(error ? { error } : {}),
      duration_seconds: duracion,
      num_turns: numTurns ?? options.numTurns,
      ...(structuredOutput !== undefined ? { structured_output: structuredOutput } : {}),
      ...(options.jsonSchema ? { json_schema: options.jsonSchema } : {}),
      usage: uso,
    };

    if (options.formato === 'text') {
      if (!response.endsWith('\n')) process.stdout.write('\n');
      if (error) process.stderr.write(`${error}\n`);
      return;
    }

    if (options.formato === 'stream-json') {
      escribirEvento({ event: 'result', result: envelope });
    } else {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    }
  };

  return { iniciarTurno, onEvent, final };
}
