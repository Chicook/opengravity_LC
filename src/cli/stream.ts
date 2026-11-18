/**
 * Entrada `--input-format stream-json`.
 *
 * Un proceso, una conversación: cada línea `{"event":"user",...}` ejecuta un
 * turno completo y emite su propio `result`. El `init` sale una sola vez.
 */

import { createInterface } from 'node:readline';
import { runAgent } from '../agent/loop.js';
import type { JsonlSessionStore } from '../persistence/jsonl-store.js';
import type { Message, ModelProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Salida } from './output.js';

export interface StreamJsonOptions {
  salida: Salida;
  provider: ModelProvider;
  model: string;
  tools: ToolRegistry;
  system: string;
  contextWindow: number;
  ajustes: {
    thinkingBudget?: number;
    reasoningEffort?: string;
    thinkingLevel?: string;
  };
  initialMessages: Message[];
  sessionId?: string;
  store?: JsonlSessionStore;
  numTurns: number;
  jsonSchema?: unknown;
  validar?: (data: unknown) => string | null;
  printTimeoutMs: number;
}

interface MensajeEntrada {
  event?: unknown;
  message?: { content?: unknown };
}

/** Extrae texto de un `content` string o de una lista de bloques text. */
function contenidoDeMensaje(payload: MensajeEntrada): { texto?: string; error?: string } {
  const contenido = payload.message?.content;
  if (typeof contenido === 'string') {
    return contenido.trim().length > 0 ? { texto: contenido } : { error: 'content vacío' };
  }
  if (Array.isArray(contenido)) {
    const partes: string[] = [];
    for (const bloque of contenido) {
      const registro = bloque as { type?: unknown; text?: unknown };
      if (registro?.type !== 'text') {
        return { error: `bloque no soportado: ${String(registro?.type)}` };
      }
      if (typeof registro.text !== 'string') return { error: 'bloque text sin texto' };
      partes.push(registro.text);
    }
    const texto = partes.join('\n');
    return texto.trim().length > 0 ? { texto } : { error: 'content vacío' };
  }
  return { error: 'falta message.content' };
}

const COMANDOS_DE_CLI: Record<string, true> = {
  '/model': true,
  '/usage': true,
  '/help': true,
  '/config': true,
  '/exit': true,
  '/quit': true,
  '/clear': true,
  '/resume': true,
  '/tools': true,
};

/**
 * Ejecuta la sesión de entrada hasta que se cierra stdin.
 * Devuelve el código de salida (0 limpio, 1 error de datos, 2 comando no válido).
 */
export async function correrStreamJson(options: StreamJsonOptions): Promise<number> {
  let mensajes = options.initialMessages;
  let turnos = options.numTurns;

  const terminar = (
    mensaje: string,
    estado: 'ERROR' | 'CANCELED',
    codigo: number,
  ): number => {
    options.salida.final(null, mensaje, undefined, estado, turnos);
    process.exitCode = codigo;
    return codigo;
  };

  const lineas = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const linea of lineas) {
    const limpia = linea.trim();
    if (limpia.length === 0) continue;

    let payload: MensajeEntrada;
    try {
      payload = JSON.parse(limpia) as MensajeEntrada;
    } catch {
      lineas.close();
      return terminar('JSON inválido en la entrada stream-json.', 'ERROR', 1);
    }

    if (payload.event === undefined) {
      lineas.close();
      return terminar('Falta el campo event en la entrada stream-json.', 'ERROR', 1);
    }

    if (payload.event === 'control_request' || payload.event === 'control_response') {
      lineas.close();
      return terminar(
        'Los eventos control_request/control_response no están soportados.',
        'ERROR',
        2,
      );
    }

    if (payload.event !== 'user') {
      process.stderr.write(
        `aviso: se ignora el evento de entrada "${String(payload.event)}"\n`,
      );
      continue;
    }

    const contenido = contenidoDeMensaje(payload);
    if (contenido.error || !contenido.texto) {
      lineas.close();
      return terminar(`Entrada inválida: ${contenido.error ?? 'sin texto'}.`, 'ERROR', 1);
    }

    const primero = contenido.texto.trim().split(/\s+/)[0] ?? '';
    if (COMANDOS_DE_CLI[primero] === true) {
      lineas.close();
      return terminar(
        `${primero} lo responde el CLI fuera del stream; ejecútalo como un comando aparte.`,
        'ERROR',
        2,
      );
    }

    turnos += 1;
    options.salida.iniciarTurno();

    const controlador = new AbortController();
    let tiempoAgotado = false;
    const temporizador =
      options.printTimeoutMs > 0
        ? setTimeout(() => {
            tiempoAgotado = true;
            controlador.abort();
          }, options.printTimeoutMs)
        : undefined;

    try {
      const resultado = await runAgent(
        {
          provider: options.provider,
          model: options.model,
          tools: options.tools,
          system: options.system,
          maxSteps: 40,
          contextWindow: options.contextWindow,
          ...options.ajustes,
          ...(mensajes.length > 0 ? { initialMessages: mensajes } : {}),
          onEvent: options.salida.onEvent,
        },
        contenido.texto,
        { cwd: process.cwd(), signal: controlador.signal },
      );

      mensajes = resultado.messages;

      if (options.sessionId && options.store) {
        try {
          await options.store.append(options.sessionId, resultado.appended);
        } catch (error) {
          process.stderr.write(
            `No se pudo guardar el turno: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }

      let estructurado: unknown;
      let error: string | undefined;
      let estado: 'SUCCESS' | 'ERROR' = 'SUCCESS';
      if (options.jsonSchema) {
        try {
          estructurado = JSON.parse(resultado.text);
          const fallo = options.validar?.(estructurado);
          if (fallo) {
            error = fallo;
            estado = 'ERROR';
          }
        } catch {
          error = 'La respuesta no es JSON válido para --json-schema.';
          estado = 'ERROR';
        }
      }

      options.salida.final(resultado, error, estructurado, estado, turnos);
      if (estado !== 'SUCCESS') {
        lineas.close();
        process.exitCode = 1;
        return 1;
      }
    } catch (error) {
      const mensaje = tiempoAgotado
        ? `Tiempo de espera agotado (${options.printTimeoutMs} ms).`
        : error instanceof Error
          ? error.message
          : String(error);
      lineas.close();
      return terminar(mensaje, tiempoAgotado ? 'CANCELED' : 'ERROR', 1);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  process.exitCode = 0;
  return 0;
}
