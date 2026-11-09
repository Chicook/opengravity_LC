/**
 * Utilidades compartidas por los adaptadores de proveedor.
 * Sin dependencias externas: solo `fetch` nativo de Node 20+.
 */

import { ProviderError } from './types.js';

/**
 * Lee un cuerpo `text/event-stream` y entrega cada evento `data:` ya parseado.
 *
 * OpenAI, Anthropic y Gemini usan SSE. En vez de repetir el parser en cada
 * adaptador, se centraliza aquí.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  providerId: string,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Los eventos SSE se separan por línea en blanco.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload.length === 0) continue;
          if (payload === '[DONE]') return;

          yield payload;
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Resto sin terminador: algunos servidores no cierran con línea en blanco.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload.length > 0 && payload !== '[DONE]') yield payload;
  }
}

/**
 * Lee un cuerpo NDJSON (una línea = un objeto JSON).
 * Ollama usa este formato en `/api/chat`.
 */
export async function* readNDJSON(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) yield line;
        newline = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  const tail = buffer.trim();
  if (tail.length > 0) yield tail;
}

/** Parsea JSON sin lanzar; devuelve `undefined` si el texto no es JSON válido. */
export function tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Convierte los argumentos de una herramienta a objeto.
 * Algunos modelos devuelven string JSON en lugar de objeto.
 */
export function coerceArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const parsed = tryParseJSON(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return {};
}

/** Lanza `ProviderError` si la respuesta HTTP no es 2xx, con el cuerpo como detalle. */
export async function ensureOk(
  response: Response,
  providerId: string,
): Promise<void> {
  if (response.ok) return;

  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = '<sin cuerpo>';
  }
  throw new ProviderError(providerId, response.status, `HTTP ${response.status}: ${detail}`);
}

/** Códigos HTTP que merece la pena reintentar. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Espera entre reintentos: base exponencial con algo de jitter. */
function backoffDelay(attempt: number, baseMs: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseMs * 0.5;
  return Math.min(exponential + jitter, 20_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta una petición HTTP con reintentos.
 *
 * Reintenta errores de red y códigos transitorios (429, 5xx). Respeta
 * `Retry-After` si el servidor lo envía. Un 4xx distinto de 408/429 no se
 * reintenta: la petición está mal y repetirla no ayuda.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  providerId: string,
  options: { retries?: number; baseMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const baseMs = options.baseMs ?? 700;
  const signal = options.signal ?? init.signal ?? undefined;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    if (signal?.aborted) throw new ProviderError(providerId, undefined, 'petición cancelada');

    try {
      const response = await fetch(input, init);

      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt > retries) {
        return response;
      }

      // 429/503 pueden pedir una espera concreta.
      const retryAfter = Number(response.headers.get('retry-after') ?? '');
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoffDelay(attempt, baseMs);

      lastError = new ProviderError(
        providerId,
        response.status,
        `HTTP ${response.status} (reintento ${attempt}/${retries})`,
      );

      await sleep(waitMs);
    } catch (error) {
      // Errores de red (DNS, conexión cortada): reintentar tiene sentido.
      if (signal?.aborted) throw error;

      lastError = error;
      if (attempt > retries) break;
      await sleep(backoffDelay(attempt, baseMs));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(providerId, undefined, 'la petición falló tras varios intentos');
}

/** Base URL por defecto de cada proveedor, sobreescribible por configuración. *//** Base URL por defecto de cada proveedor, sobreescribible por configuración. */
export const DEFAULT_BASE_URLS = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
} as const;
