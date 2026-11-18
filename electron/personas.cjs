'use strict';

/**
 * Perfiles de producto: lo que Antigravity llama «Interface Layout».
 *
 * Cada perfil es un bloque de instrucciones para el agente, en texto plano. No
 * toca la interfaz ni las herramientas: medido en el original, cambiar de perfil
 * no reestructura el DOM y no bloquea `run_command`. Lo que cambia es cómo
 * responde.
 *
 * El texto es nuestro: el mecanismo se replica, el contenido no se copia. Los
 * bloques son cortos a propósito: funcionan igual en un 7B local que en un
 * modelo de razonamiento.
 *
 * Los títulos y descripciones de las tarjetas viven en la interfaz
 * (`renderer/settings.js` + `i18n-strings.js`), no aquí: una sola fuente.
 */

const PERFILES = [
  {
    id: 'knowledge-work',
    bloque: [
      'Perfil de trabajo: conocimiento, no solo código.',
      'Tu entrega es un documento, no una propuesta de cambio de código. Cuando la tarea sea',
      'comunicar, resumir o planificar, escribe el texto final completo (con título, apartados',
      'y una lista de siguientes pasos) y no abras ficheros de código salvo que te lo pidan.',
      'Si un dato no está en el proyecto, dilo como «no consta» en vez de afirmarlo.',
      'Cita la fuente de cada dato que no venga del propio proyecto.',
    ].join('\n'),
  },
  {
    id: 'engineering',
    bloque: [
      'Perfil de trabajo: ingeniería de software.',
      'Trabaja sobre el código como fuente de verdad: ábrelo antes de afirmar nada y cita',
      'rutas concretas. Cuando la tarea sea revisar o arreglar, ejecuta la comprobación más',
      'pequeña que la cubra en vez de escribir un documento sobre ella.',
      'Respuestas cortas y accionables: qué está roto, dónde, y qué cambias.',
    ].join('\n'),
  },
];

/** Perfil activo; cualquier id desconocido cae en ingeniería. */
function perfilDe(id) {
  return PERFILES.find((perfil) => perfil.id === id) ?? PERFILES[PERFILES.length - 1];
}

/** Bloque listo para pegar al prompt de sistema. */
function bloqueDePersona(id) {
  return perfilDe(id).bloque;
}

module.exports = { PERFILES, perfilDe, bloqueDePersona };
