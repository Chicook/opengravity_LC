'use strict';

/**
 * Resolución de peticiones del esquema propio `app://`.
 *
 * Vive en su módulo (y no dentro de `main.cjs`) para poder probarla sin
 * arrancar Electron: es la frontera entre «sirve un fichero de la aplicación» y
 * «sirve un fichero cualquiera del disco».
 *
 * El renderer se sirve bajo `app://` porque Chromium bloquea los workers desde
 * `file://` y Monaco los necesita. Ese esquema es, por tanto, una puerta de
 * lectura: si no se contiene, una página puede pedir `app://local/../x` y leer
 * fuera.
 */

const path = require('node:path');

/**
 * Traduce una URL `app://` a la ruta absoluta que hay que servir.
 *
 * @param {string} raiz Raíz de la aplicación (normalmente `app.getAppPath()`).
 * @param {string} requestUrl URL pedida, por ejemplo `app://local/renderer/index.html`.
 * @returns {string|null} Ruta absoluta dentro de `raiz`, o `null` si se sale.
 */
function resolverRutaApp(raiz, requestUrl) {
  const raizAbs = path.resolve(String(raiz ?? ''));

  let pathname;
  try {
    pathname = new URL(String(requestUrl)).pathname;
  } catch {
    return null;
  }

  let relativa;
  try {
    relativa = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    // Secuencias de escape mal formadas (%zz): se rechazan, no se adivinan.
    return null;
  }

  const destino = path.resolve(raizAbs, relativa);

  /*
   * La comparación es de prefijo CON separador: sin él, una raíz `C:\app` daría
   * por bueno `C:\app-otra\secreto`. En Windows la ruta no distingue mayúsculas.
   */
  const normalizar = (valor) =>
    process.platform === 'win32' ? valor.toLowerCase() : valor;

  const destinoNorm = normalizar(destino);
  const raizNorm = normalizar(raizAbs);

  if (destinoNorm !== raizNorm && !destinoNorm.startsWith(raizNorm + path.sep)) {
    return null;
  }

  return destino;
}

module.exports = { resolverRutaApp };
