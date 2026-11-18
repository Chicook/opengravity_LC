/**
 * Contrato de proveedor de modelo.
 *
 * Esta es la abstracción central del proyecto: todo lo que hable con un LLM
 * implementa `ModelProvider`, y el resto del sistema (agente, UI, herramientas)
 * no sabe ni le importa quién está detrás.
 *
 * Adaptadores previstos: Ollama (local), OpenAI, Anthropic, Gemini.
 * Añadir uno nuevo = un fichero más en `src/providers/`, cero cambios aguas arriba.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Una llamada a herramienta solicitada por el modelo. */
export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos ya deserializados. Si el modelo devuelve JSON inválido, `{}`. */
  arguments: Record<string, unknown>;
  /**
   * Datos que el proveedor exige devolver junto a la llamada en el siguiente
   * turno (por ejemplo, `thoughtSignature` de Gemini 3). No se interpretan.
   */
  providerMeta?: Record<string, unknown>;
}

/**
 * Bloque de razonamiento de Anthropic.
 *
 * La API exige reenviarlo intacto, con su firma, cuando el asistente pidió
 * herramientas. Sin esto, el segundo paso del turno falla con un 400.
 */
export interface ThinkingBlock {
  thinking: string;
  signature?: string;
}

/** Imagen adjunta a un mensaje, ya codificada en base64. */
export interface ImagePart {
  /** Tipo MIME: image/png, image/jpeg… */
  mimeType: string;
  /** Contenido binario en base64, sin el prefijo data:. */
  data: string;
}

/** Un mensaje del historial de conversación. */
export interface Message {
  role: Role;
  content: string;
  /** Imágenes adjuntas (solo en mensajes de usuario). */
  images?: ImagePart[];
  /** Presente cuando `role === 'assistant'` y el modelo pidió herramientas. */
  toolCalls?: ToolCall[];
  /** Bloques de pensamiento que hay que devolver al proveedor tal cual. */
  thinkingBlocks?: ThinkingBlock[];
  /** Presente cuando `role === 'tool'`: a qué llamada responde. */
  toolCallId?: string;
  /** Presente cuando `role === 'tool'`: nombre de la herramienta. */
  name?: string;
  /**
   * Nota interna del bucle (nudge, revisión de plan, cierre forzado). Viaja al
   * modelo, pero no debe pintarse como mensaje del usuario ni guardarse.
   */
  internal?: boolean;
}

/** Esquema JSON de los parámetros de una herramienta. */
export type JSONSchema = Record<string, unknown>;

/** Definición de herramienta expuesta al modelo. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** Petición de generación. Es el único input del proveedor. */
export interface GenerateRequest {
  model: string;
  messages: Message[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Ventana de contexto del modelo en tokens. Los adaptadores que pueden
   * configurarla en el servidor (Ollama) la usan; el resto la ignora.
   */
  contextWindow?: number;
  /** Instrucción de sistema; se prepende como mensaje `system` si existe. */
  system?: string;
  /**
   * Marca el prompt como cacheable. Solo interesa a partir del segundo paso:
   * la escritura de caché cuesta más que una lectura normal.
   */
  cachePrompt?: boolean;
  /**
   * Presupuesto de pensamiento extendido, en tokens. `0`/ausente = no se pide.
   * Lo envían los adaptadores que lo expresan así (Anthropic, Gemini 2.5).
   */
  thinkingBudget?: number;
  /**
   * Esfuerzo de razonamiento con nombre, para la API de OpenAI y sus copias
   * (`reasoning_effort`: minimal / low / medium / high).
   */
  reasoningEffort?: string;
  /**
   * Nivel de pensamiento con nombre de Gemini 3 y posteriores
   * (`thinkingLevel`: low / medium / high).
   */
  thinkingLevel?: string;
}

/** Motivo de fin de generación, normalizado entre proveedores. */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

/**
 * Fragmento emitido por `streamGenerate`.
 *
 * Los adaptadores traducen sus eventos nativos (SSE de OpenAI, NDJSON de Ollama,
 * eventos de Anthropic…) a esta forma única.
 */
export type Chunk =
  | { type: 'text'; text: string }
  /** Razonamiento del modelo (no forma parte de la respuesta visible). */
  | { type: 'reasoning'; text: string }
  /** Bloque de pensamiento completo, con la firma que exige el proveedor. */
  | { type: 'thinking_block'; block: ThinkingBlock }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; finishReason: FinishReason };

/** Modelo disponible en un proveedor. */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
}

/** Qué sabe hacer un proveedor. El agente lo consulta antes de pedir herramientas. */
export interface Capabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
}

/**
 * Interfaz que implementa cada backend de modelo.
 *
 * `streamGenerate` es siempre un `AsyncIterable`: el consumidor hace `for await`
 * y recibe los fragmentos según llegan. Nada de callbacks ni promesas que
 * resuelven al final.
 */
export interface ModelProvider {
  /** Identificador corto: `ollama`, `openai`, `anthropic`, `gemini`. */
  readonly id: string;
  readonly capabilities: Capabilities;

  /** Catálogo de modelos. Puede consultar el backend o devolver una lista fija. */
  listModels(): Promise<ModelInfo[]>;

  /** Generación con streaming. */
  streamGenerate(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<Chunk>;
}

/** Error tipado de proveedor, para distinguir fallos de red de fallos de API. */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly status: number | undefined;

  constructor(providerId: string, status: number | undefined, message: string) {
    super(`[${providerId}] ${message}`);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.status = status;
  }
}
