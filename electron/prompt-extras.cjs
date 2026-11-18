'use strict';

/**
 * Bloques de prompt que dependen de las preferencias del usuario.
 *
 * Vive aparte de `main.cjs` para poder probarlo sin arrancar Electron: es una
 * función pura de `prefs` a texto.
 */

const { bloqueDePersona } = require('./personas.cjs');

/** Skills disponibles: se inyectan en el prompt si están activadas. */
const SKILL_CATALOG = [
  {
    id: 'spanish',
    name: 'Responder en español',
    description: 'Fuerza el idioma de las respuestas.',
    body: 'Responde siempre en español, incluidos los mensajes de estado.',
  },
  {
    id: 'concise',
    name: 'Respuestas concisas',
    description: 'Sin rodeos ni resúmenes innecesarios.',
    body: 'Sé breve. No repitas el código que acabas de escribir ni resumas lo obvio.',
  },
  {
    id: 'tests',
    name: 'Proponer tests',
    description: 'Sugiere pruebas al cambiar lógica.',
    body: 'Cuando modifiques lógica de negocio, propón al menos un test que la cubra.',
  },
  {
    id: 'explain',
    name: 'Explicar el razonamiento',
    description: 'Justifica cada decisión de diseño.',
    body: 'Antes de aplicar un cambio no trivial, explica en una frase por qué es la opción correcta.',
  },
];

/**
 * Bloque de prompt con el perfil del usuario, la persona elegida y las skills.
 *
 * El orden importa: la persona va antes que las skills para que una instrucción
 * concreta («responde en español») gane a una general del perfil.
 */
function buildPromptExtras(prefs) {
  const parts = [];

  const profile = prefs?.profile ?? {};
  if (typeof profile.name === 'string' && profile.name.trim().length > 0) {
    parts.push(`El usuario se llama ${profile.name.trim()}.`);
  }

  const persona = bloqueDePersona(prefs?.persona);
  if (persona.trim().length > 0) parts.push(persona);

  const enabled = prefs?.skills ?? {};
  const active = SKILL_CATALOG.filter((skill) => enabled[skill.id] === true);
  if (active.length > 0) {
    parts.push('Instrucciones adicionales:\n' + active.map((skill) => `- ${skill.body}`).join('\n'));
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
}

module.exports = { SKILL_CATALOG, buildPromptExtras };
