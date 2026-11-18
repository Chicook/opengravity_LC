/**
 * Catálogo de proveedores.
 *
 * Cada entrada describe cómo hablar con un backend. Añadir un proveedor nuevo
 * es una línea aquí: no hay que escribir adaptador si habla el protocolo de
 * OpenAI, que es el caso de la mayoría.
 *
 * `kind` selecciona el adaptador; `baseUrl` es el endpoint exacto.
 */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface ProviderSpec {
  /** Identificador corto y estable, usado en CLI y ajustes. */
  id: string;
  label: string;
  kind: ProviderKind;
  /** Endpoint exacto, sin barra final. Vacío en los proveedores personalizables. */
  baseUrl: string;
  /** Variable de entorno con la clave. `null` si no necesita. */
  envKey: string | null;
  /** `true` si el endpoint de listado es público (se puede consultar sin clave). */
  publicModels?: boolean;
  /** `true` si el proveedor corre en local. */
  local?: boolean;
  /** Nota breve para la UI. */
  note?: string;
  /** `true` si el usuario debe aportar la URL y la clave desde los ajustes. */
  custom?: boolean;
  /**
   * `true` en servidores que arranca el usuario: la URL se puede cambiar desde
   * los ajustes (puerto propio) y el token es opcional, porque muchos solo lo
   * exigen si se activa la autenticación (LM Studio ≥ 0.4, vLLM --api-key…).
   */
  selfHosted?: boolean;
  /** `true` si requiere la cabecera de sesión de OpenCode. */
  opencode?: boolean;
  /** Cabeceras extra fijas. */
  headers?: Record<string, string>;
}

/**
 * Orden pensado para la UI: primero local, luego los grandes, luego el resto.
 */
export const PROVIDER_CATALOG: ProviderSpec[] = [
  // --- Locales (sin clave) -------------------------------------------------
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    envKey: null,
    local: true,
    note: 'Modelos locales. Requiere `ollama serve`.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    envKey: null,
    local: true,
    selfHosted: true,
    note: 'Servidor local de LM Studio (API compatible con OpenAI).',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    envKey: null,
    local: true,
    selfHosted: true,
    note: 'Servidor vLLM local.',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    envKey: null,
    local: true,
    selfHosted: true,
    note: 'llama-server de llama.cpp.',
  },

  // --- Grandes proveedores -------------------------------------------------
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_API_KEY',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    publicModels: true,
    note: 'Cientos de modelos de varios vendors con una sola clave.',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    envKey: 'FIREWORKS_API_KEY',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    envKey: 'CEREBRAS_API_KEY',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    envKey: 'PERPLEXITY_API_KEY',
    note: 'Modelos con búsqueda web integrada.',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    envKey: 'MOONSHOT_API_KEY',
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    kind: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    envKey: 'ZAI_API_KEY',
  },

  // --- OpenCode (Zen y Go) -------------------------------------------------
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    envKey: 'OPENCODE_API_KEY',
    opencode: true,
    note: 'Pasarela con pago por uso. Una clave sirve para Zen y Go.',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    envKey: 'OPENCODE_API_KEY',
    opencode: true,
    note: 'Suscripción con modelos de código. Misma clave que Zen.',
  },

  // --- Personalizables (el usuario aporta URL y clave) ---------------------
  {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    kind: 'openai',
    baseUrl: '',
    envKey: null,
    custom: true,
    note: 'Cualquier endpoint que hable /chat/completions. Indica la URL y la clave.',
  },
  {
    id: 'anthropic-compatible',
    label: 'Anthropic Compatible',
    kind: 'anthropic',
    baseUrl: '',
    envKey: null,
    custom: true,
    note: 'Cualquier endpoint que hable /v1/messages. Indica la URL y la clave.',
  },
];

/** Busca una entrada del catálogo por id. */
export function findProvider(id: string): ProviderSpec | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === id);
}

/**
 * Base URL efectiva: la del catálogo, salvo que el usuario la sobrescriba con
 * `<ID>_BASE_URL` (por ejemplo `OPENROUTER_BASE_URL` o `OLLAMA_BASE_URL`).
 *
 * En los proveedores personalizables la URL solo puede venir del override o de
 * los ajustes; el catálogo la deja vacía a propósito.
 */
export function resolveBaseUrl(spec: ProviderSpec): string {
  const override = process.env[`${spec.id.toUpperCase().replace(/-/g, '_')}_BASE_URL`];
  const value = override && override.trim().length > 0 ? override.trim() : spec.baseUrl;
  return value.replace(/\/+$/, '');
}

/** Clave efectiva del proveedor, leída del entorno. */
export function resolveApiKey(spec: ProviderSpec): string {
  if (!spec.envKey) return '';
  return process.env[spec.envKey] ?? '';
}

/**
 * `true` si el proveedor puede usarse ahora mismo.
 * Los locales no requieren clave; el resto sí (salvo que solo se listen modelos).
 */
export function hasCredentials(spec: ProviderSpec): boolean {
  if (spec.envKey === null) return true;
  return resolveApiKey(spec).length > 0;
}
