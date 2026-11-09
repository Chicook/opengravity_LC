/**
 * Registro de proveedores.
 *
 * Punto único de creación: el resto del sistema pide un `ModelProvider` por id
 * y no conoce las clases concretas. Los endpoints viven en `catalog.ts`.
 */

import { AnthropicProvider, type AnthropicOptions } from './anthropic.js';
import { PROVIDER_CATALOG, findProvider, hasCredentials, resolveApiKey, resolveBaseUrl } from './catalog.js';
import { GeminiProvider, type GeminiOptions } from './gemini.js';
import { OllamaProvider, type OllamaOptions } from './ollama.js';
import { OpenAIProvider, type OpenAIOptions } from './openai.js';
import type { ModelProvider } from './types.js';

/** Identificador de proveedor. Los del catálogo, o uno propio. */
export type ProviderId = string;

/**
 * Identificador de sesión estable por proceso.
 * OpenCode lo usa para enrutar y cachear prompts; enviar uno distinto en cada
 * petición empeora el rendimiento.
 */
const SESSION_ID = `agent-ide-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/** Sobrescrituras por proveedor (opcional; el catálogo ya trae los valores). */
export interface ProviderConfig {
  ollama?: OllamaOptions;
  openai?: OpenAIOptions;
  anthropic?: AnthropicOptions;
  gemini?: GeminiOptions;
  /** Sobrescritura de endpoint para cualquier id del catálogo. */
  baseUrls?: Record<string, string>;
  /** Sobrescritura de clave para cualquier id del catálogo. */
  apiKeys?: Record<string, string>;
}

/**
 * Crea un proveedor por id resolviendo endpoint y clave.
 *
 * @example
 * const provider = createProvider('openrouter');
 * const models = await provider.listModels();
 */
export function createProvider(id: ProviderId, config: ProviderConfig = {}): ModelProvider {
  const spec = findProvider(id);
  if (!spec) {
    const known = PROVIDER_CATALOG.map((entry) => entry.id).join(', ');
    throw new Error(`proveedor desconocido: "${id}". Disponibles: ${known}`);
  }

  const baseUrl = (config.baseUrls?.[id] ?? resolveBaseUrl(spec)).replace(/\/+$/, '');
  const apiKey = config.apiKeys?.[id] ?? resolveApiKey(spec);

  if (baseUrl.length === 0) {
    throw new Error(
      `el proveedor "${id}" necesita una URL de endpoint. Configúrala en Settings › Models.`,
    );
  }

  // Cabeceras fijas del catálogo + cabecera de sesión de OpenCode.
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  if (spec.opencode) headers['x-opencode-session'] = SESSION_ID;

  switch (spec.kind) {
    case 'ollama':
      return new OllamaProvider({ ...config.ollama, baseUrl });

    case 'openai':
      return new OpenAIProvider({ ...config.openai, baseUrl, apiKey, headers });

    case 'anthropic':
      return new AnthropicProvider({ ...config.anthropic, baseUrl, apiKey, headers });

    case 'gemini':
      return new GeminiProvider({ ...config.gemini, baseUrl, apiKey });

    default: {
      const exhaustive: never = spec.kind;
      throw new Error(`tipo de proveedor no soportado: ${String(exhaustive)}`);
    }
  }
}

/** Proveedores del catálogo que tienen credenciales ahora mismo. */
export function providersWithCredentials(): string[] {
  return PROVIDER_CATALOG.filter(hasCredentials).map((entry) => entry.id);
}

/**
 * Detecta qué proveedores responden de verdad.
 *
 * Comprueba credenciales primero (barato) y solo entonces consulta el listado
 * de modelos. Los locales se prueban siempre: si no están corriendo, fallan.
 */
export async function detectAvailableProviders(
  config: ProviderConfig = {},
): Promise<string[]> {
  const available: string[] = [];

  for (const spec of PROVIDER_CATALOG) {
    if (!hasCredentials(spec)) continue;
    // Los personalizables solo se prueban si el usuario ya puso una URL.
    if (spec.custom && !(config.baseUrls?.[spec.id] ?? resolveBaseUrl(spec))) continue;

    try {
      const provider = createProvider(spec.id, config);
      const models = await provider.listModels();
      if (models.length > 0) available.push(spec.id);
    } catch {
      // sin respuesta: el proveedor queda fuera
    }
  }

  return available;
}

export { AnthropicProvider, GeminiProvider, OllamaProvider, OpenAIProvider };
export type { AnthropicOptions, GeminiOptions, OllamaOptions, OpenAIOptions };
export { PROVIDER_CATALOG, findProvider } from './catalog.js';
