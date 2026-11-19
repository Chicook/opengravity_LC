'use strict';

/** Utilidades puras del actualizador; no tocan Electron ni la red. */

/** Normaliza notas de release de electron-updater (texto o lista). */
function notasDe(info) {
  const notas = info?.releaseNotes;
  if (typeof notas === 'string') return notas;
  if (Array.isArray(notas)) {
    return notas
      .map((entrada) => (typeof entrada === 'string' ? entrada : entrada?.note ?? ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return null;
}

/** Detecta el ejecutable portable de electron-builder sin depender de `app`. */
function esPortable(env = process.env) {
  return Boolean(env?.PORTABLE_EXECUTABLE_FILE || env?.PORTABLE_EXECUTABLE_DIR);
}

/** Porcentaje de descarga acotado a 0–100. */
function porcentaje(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.max(0, Math.min(100, Math.round(numero)));
}

module.exports = { notasDe, esPortable, porcentaje };
