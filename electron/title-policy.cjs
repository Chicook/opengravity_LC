'use strict';

/** Un título puesto a mano no se sobrescribe con el generado automáticamente. */
function puedeRenombrarAutomatico(manuales, sessionId) {
  return !manuales.has(sessionId);
}

module.exports = { puedeRenombrarAutomatico };
