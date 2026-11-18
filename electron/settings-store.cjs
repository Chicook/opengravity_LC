'use strict';

/**
 * Escritura atómica y serializada del fichero de ajustes.
 *
 * `rename` dentro del mismo sistema de ficheros es atómico: un lector ve el
 * contenido viejo o el nuevo, nunca un JSON a medias. La cola evita que dos
 * escrituras simultáneas compartan el temporal.
 */

const fsp = require('node:fs/promises');

let cola = Promise.resolve();

async function escribirAtomico(ruta, payload) {
  const temporal = `${ruta}.tmp`;
  try {
    // 0600: el fichero puede contener claves y no debe leerlo otra cuenta local.
    await fsp.writeFile(temporal, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporal, ruta);
  } catch (err) {
    // Sin esto un fallo de rename deja el temporal huérfano en userData.
    await fsp.rm(temporal, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Encola una tarea que toca el mismo fichero: lectura, cambio y escritura
 * seguidas, sin que otra escritura se cuele en medio.
 */
function serializar(tarea) {
  const siguiente = cola.then(tarea);
  // La cola no se envenena: un fallo llega al llamador, pero no bloquea al resto.
  cola = siguiente.catch(() => {});
  return siguiente;
}

function guardarEnCola(ruta, payload) {
  return serializar(() => escribirAtomico(ruta, payload));
}

module.exports = { escribirAtomico, guardarEnCola, serializar };
