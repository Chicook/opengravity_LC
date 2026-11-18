/**
 * Presupuesto de contexto: cuánta conversación cabe antes de llamar al modelo.
 *
 * El bucle del agente mide el historial en caracteres y, si se pasa, compacta o
 * recorta antes de enviar. Ese tope (maxContextChars) tiene que corresponder a la
 * ventana real del modelo, o se pierde por los dos lados:
 *
 *  - Demasiado grande: el proveedor rechaza la petición entera por exceso de
 *    contexto. Se pierde el turno completo, no solo el trozo de más.
 *  - Demasiado pequeño: se compacta cuando aún cabía todo, y cada compactación
 *    cuesta una llamada extra al modelo (resumir) y pierde detalle útil.
 *
 * Antes este cálculo miraba solo al proveedor, nunca al modelo: un modelo local
 * de 8k y uno de 1M recibían el mismo tope. Aquí sí se mira el modelo, en este
 * orden de prioridad:
 *
 *  1. La ventana que el proveedor declara para ese modelo (`ModelInfo.contextWindow`).
 *     Es el dato bueno: lo dice quien sirve el modelo.
 *  2. La ventana que el propio nombre del modelo lleva escrita (`llama3.2:8k`,
 *     `...-32k`, `...-128k`, `...-1m`). Es metadato del que lo publicó, no una
 *     suposición nuestra.
 *  3. La ventana por defecto del proveedor, que es lo que había antes.
 *
 * No hay tabla de "este modelo tiene X" escrita a mano a propósito: eso sería
 * inventarse cifras que caducan con cada versión. Lo que no venga de (1), (2) o
 * (3) se queda en el defecto del proveedor, que es un valor conservador.
 */

'use strict';

/** Caracteres por token: media práctica para texto y código en inglés y español. */
const CARACTERES_POR_TOKEN = 4;

/**
 * Margen que se deja libre para la respuesta y para el prompt de sistema, que no
 * viaja en `messages` y por tanto no se descuenta del historial medido.
 */
const MARGEN_RESPUESTA = 0.75;

/**
 * Suelo de tokens. Por debajo de esto no cabe ni el prompt de sistema con sus
 * herramientas, así que un modelo que declare menos se trata como si tuviera esto:
 * es preferible intentar el turno (y que el recorte actúe) a no enviar nada.
 */
const VENTANA_MINIMA_TOKENS = 4_000;

/**
 * Ventanas por defecto cuando el modelo no dice otra cosa.
 *
 * Solo están los proveedores cuyo valor conocemos por el propio proyecto; el
 * resto cae en el defecto genérico. Anthropic y Gemini son los del catálogo;
 * los servidores locales y compatibles con OpenAI (LM Studio, vLLM, llama.cpp,
 * Ollama, OpenRouter…) varían tanto que un valor único grande fallaría más que
 * ayudar, así que se quedan en el genérico.
 */
const VENTANAS_POR_PROVEEDOR = {
  anthropic: 200_000,
  gemini: 1_000_000,
  /*
   * Servidores locales sin ventana declarada. Ollama, LM Studio y llama.cpp
   * arrancan con 4k-8k en una GPU normal: asumir 128k hacía que el turno
   * desbordara antes de la primera respuesta. Si el nombre del modelo o el
   * proveedor dicen más (`:32k`, `/api/show`), mandan ellos.
   */
  ollama: 8_192,
  lmstudio: 8_192,
  vllm: 8_192,
  llamacpp: 8_192,
};

/** Ventana genérica: la que asume un servidor compatible con OpenAI si no dice nada. */
const VENTANA_GENERICA = 128_000;

/**
 * Lee una ventana escrita en el nombre del modelo.
 *
 * Reconoce `8k`, `32K`, `128k`, `200k` y `1m`/`2m` (millones) cuando van como
 * cantidad separada, para no confundirlos con el tamaño en parámetros (`7b`), la
 * cuantización (`q4_K_M`) ni la versión (`2.5`).
 *
 * @param {string} modelId Identificador del modelo.
 * @returns {number|null} Tokens, o `null` si el nombre no la declara.
 */
function ventanaEnElNombre(modelId) {
  const id = String(modelId ?? '');
  if (id.length === 0) return null;

  /*
   * El número tiene que ir precedido por un separador (o el principio) y seguido
   * de `k`/`m` y otro separador (o el final). Así `q4_K_M` y `qwen2.5:7b` no
   * cuentan, pero `llama3.2:8k` y `qwen2.5-32k-instruct` sí.
   */
  const miles = /(?:^|[^a-z0-9])(\d{1,4})k(?![a-z0-9])/i.exec(id);
  if (miles) {
    const tokens = Number(miles[1]) * 1_000;
    if (Number.isFinite(tokens) && tokens >= VENTANA_MINIMA_TOKENS) return tokens;
  }

  const millones = /(?:^|[^a-z0-9])(\d{1,2})m(?![a-z0-9])/i.exec(id);
  if (millones) {
    const tokens = Number(millones[1]) * 1_000_000;
    if (Number.isFinite(tokens) && tokens >= VENTANA_MINIMA_TOKENS) return tokens;
  }

  return null;
}

/**
 * Cuántos tokens de contexto tiene el modelo.
 *
 * @param {object} opciones
 * @param {string} [opciones.providerId] Proveedor activo (`anthropic`, `ollama`…).
 * @param {string} [opciones.modelId] Modelo activo.
 * @param {number} [opciones.reportada] Ventana que declaró el proveedor, si la hay.
 * @returns {number} Tokens de ventana.
 */
function ventanaDeModelo({ providerId = '', modelId = '', reportada } = {}) {
  if (Number.isFinite(reportada) && reportada > 0) {
    return Math.max(VENTANA_MINIMA_TOKENS, Math.floor(reportada));
  }

  const delNombre = ventanaEnElNombre(modelId);
  if (delNombre !== null) return delNombre;

  const delProveedor = VENTANAS_POR_PROVEEDOR[String(providerId ?? '')];
  if (Number.isFinite(delProveedor) && delProveedor > 0) return delProveedor;

  return VENTANA_GENERICA;
}

/**
 * Tope de caracteres del historial para el modelo activo.
 *
 * @param {object} opciones Las mismas que `ventanaDeModelo`.
 * @returns {number} Caracteres, siempre entero y positivo.
 */
function presupuestoDeContexto(opciones = {}) {
  const tokens = ventanaDeModelo(opciones);
  return Math.floor(tokens * CARACTERES_POR_TOKEN * MARGEN_RESPUESTA);
}

/**
 * Saca la ventana de la respuesta de `POST /api/show` de Ollama.
 *
 * Ollama no la da en `/api/tags`, pero `/api/show` devuelve `model_info` con una
 * clave por arquitectura acabada en `context_length` (`llama.context_length`,
 * `qwen2.context_length`…). Se busca por sufijo en vez de por nombre exacto
 * porque la arquitectura cambia con cada familia: si algún día el campo cambia,
 * esto devuelve `null` y se usa el defecto, sin romper nada.
 *
 * @param {unknown} payload Cuerpo JSON de `/api/show`.
 * @returns {number|null} Tokens, o `null` si no aparece.
 */
function ventanaDeOllama(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const info = payload.model_info;
  if (!info || typeof info !== 'object') return null;

  for (const [clave, valor] of Object.entries(info)) {
    if (!clave.endsWith('context_length')) continue;
    const tokens = Number(valor);
    if (Number.isFinite(tokens) && tokens > 0) return Math.floor(tokens);
  }

  return null;
}

/**
 * Capacidades declaradas por Ollama en `/api/show`.
 *
 * Las versiones recientes devuelven `capabilities: ["completion", "tools",
 * "vision"]`. Si el campo no está, devuelve `null` y se asume lo que el modelo
 * acepte en la práctica; no se inventa una restricción.
 */
function capacidadesDeOllama(payload) {
  if (!payload || !Array.isArray(payload.capabilities)) return null;
  const capacidades = new Set(payload.capabilities.map((item) => String(item).toLowerCase()));
  return {
    tools: capacidades.has('tools'),
    vision: capacidades.has('vision'),
  };
}

module.exports = {
  CARACTERES_POR_TOKEN,
  MARGEN_RESPUESTA,
  VENTANA_MINIMA_TOKENS,
  VENTANA_GENERICA,
  VENTANAS_POR_PROVEEDOR,
  ventanaEnElNombre,
  ventanaDeModelo,
  presupuestoDeContexto,
  ventanaDeOllama,
  capacidadesDeOllama,
};
