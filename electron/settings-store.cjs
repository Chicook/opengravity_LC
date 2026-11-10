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
  await fsp.writeFile(temporal, JSON.stringify(payload, null, 2), 'utf8');
  await fsp.rename(temporal, ruta);
}

function guardarEnCola(ruta, payload) {
  const siguiente = cola.then(() => escribirAtomico(ruta, payload));
  // La cola no se envenena: un fallo llega al llamador, pero no bloquea al resto.
  cola = siguiente.catch(() => {});
  return siguiente;
}

module.exports = { escribirAtomico, guardarEnCola };
