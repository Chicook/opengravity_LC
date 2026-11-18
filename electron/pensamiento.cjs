/**
 * Niveles de pensamiento.
 *
 * El nivel que elige el usuario en el composer tiene que llegar al proveedor,
 * no quedarse en una frase del prompt. Cada familia de modelos expresa el
 * esfuerzo de una forma distinta:
 *
 *  - OpenAI y los que copian su API: `reasoning_effort`.
 *  - Anthropic: un presupuesto de tokens de pensamiento (`budget_tokens`).
 *  - Gemini 2.5: un presupuesto de tokens; Gemini 3+: un nivel con nombre.
 *
 * La escala es la que usa Antigravity (observada en su `language_server.exe`:
 * MINIMAL, LOW, MEDIUM, HIGH, XHIGH, MAX), más `MODEL_DEFAULT` para no forzar
 * nada. Los niveles que un proveedor no conoce se acercan al más próximo, en
 * vez de ignorarse en silencio.
 *
 * Este fichero es CommonJS y sin dependencias a propósito: lo usan a la vez el
 * proceso principal de Electron y el CLI compilado.
 */

/** Escala, de menos a más esfuerzo. */
const NIVELES = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Valor por defecto cuando no se elige nada. */
const NIVEL_POR_DEFECTO = 'medium';

/**
 * Presupuesto de pensamiento en tokens por nivel.
 *
 * Son techos, no gasto: el modelo puede pensar menos. Se quedan por debajo del
 * límite de salida habitual de cada modelo para no convertir el pensamiento en
 * un error de longitud.
 */
const TOKENS_POR_NIVEL = {
  minimal: 1024,
  low: 4096,
  medium: 12000,
  high: 24000,
  xhigh: 48000,
  max: 96000,
};

/** `reasoning_effort` que acepta la API de OpenAI, por nivel. */
const ESFUERZO_OPENAI = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  // OpenAI no tiene escalones por encima de `high`: se queda en el máximo.
  xhigh: 'high',
  max: 'high',
};

/** Nivel con nombre que acepta Gemini 3 y posteriores. */
const NIVEL_GEMINI = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

/** Normaliza lo que llega del composer (`High`, `xhigh`, `MAX`…) a la escala. */
function normalizarNivel(nivel) {
  if (typeof nivel !== 'string') return null;
  const limpio = nivel.trim().toLowerCase();
  if (!limpio) return null;
  if (limpio === 'model_default' || limpio === 'default' || limpio === 'unspecified') return null;
  return NIVELES.includes(limpio) ? limpio : null;
}

/**
 * Qué mandar al proveedor para este nivel.
 *
 * Devuelve `{}` cuando no hay nada que enviar (sin nivel, o un proveedor que no
 * acepta el campo): en ese caso el modelo usa lo que tenga por defecto.
 *
 * @param {{ nivel?: string, tipo?: string, proveedor?: string, modelo?: string }} opciones
 *   `nivel`: lo elegido en el composer. `tipo`: el `kind` del proveedor
 *   (`openai`, `anthropic`, `gemini`, `ollama`…). `proveedor`: su id, que es lo
 *   único que separa un servidor local de un servicio en la nube, porque los
 *   locales también declaran `kind: 'openai'`. `modelo`: id del modelo.
 */
function ajustesDePensamiento({ nivel, tipo, proveedor, modelo } = {}) {
  const elegido = normalizarNivel(nivel);
  if (!elegido) return {};

  const familia = typeof tipo === 'string' ? tipo.toLowerCase() : '';
  const id = typeof modelo === 'string' ? modelo : '';
  const quien = typeof proveedor === 'string' ? proveedor.toLowerCase() : '';

  if (familia === 'anthropic') {
    return { thinkingBudget: TOKENS_POR_NIVEL[elegido] };
  }

  if (familia === 'gemini') {
    /*
     * `thinkingBudget` solo existe hasta 2.5. En Gemini 3+ el campo está
     * deprecado (se controla con `thinkingLevel`) y en Gemini 4 devuelve 400,
     * así que cada generación recibe el campo que entiende.
     */
    if (/gemini-[3-9]/i.test(id)) {
      return { thinkingLevel: NIVEL_GEMINI[elegido] };
    }
    return { thinkingBudget: TOKENS_POR_NIVEL[elegido] };
  }

  /*
   * `reasoning_effort` solo lo aceptan los modelos de razonamiento de OpenAI.
   * Mandarlo a gpt-4o, a Groq, a Mistral o a un servidor local devuelve 400
   * en las APIs estrictas, así que se exige proveedor y familia conocidos.
   * Los locales se excluyen por id, no por `kind`: LM Studio, vLLM y llama.cpp
   * también se declaran `openai`.
   */
  const LOCALES = new Set(['ollama', 'lmstudio', 'vllm', 'llamacpp']);
  if (LOCALES.has(quien) || familia === 'ollama') return {};
  if (quien !== 'openai' || !/^(o[134]|gpt-5)/i.test(id)) return {};

  // o1/o3 no tienen `minimal`; se les manda el escalón más bajo que aceptan.
  const esfuerzo = elegido === 'minimal' && !/^gpt-5/i.test(id)
    ? 'low'
    : ESFUERZO_OPENAI[elegido];
  return { reasoningEffort: esfuerzo };
}

/** Etiqueta legible de un nivel, para el registro y la interfaz. */
function etiquetaDeNivel(nivel) {
  const elegido = normalizarNivel(nivel);
  if (!elegido) return 'Modelo por defecto';
  return elegido.toUpperCase();
}

module.exports = {
  NIVELES,
  NIVEL_POR_DEFECTO,
  TOKENS_POR_NIVEL,
  ESFUERZO_OPENAI,
  NIVEL_GEMINI,
  normalizarNivel,
  ajustesDePensamiento,
  etiquetaDeNivel,
};
