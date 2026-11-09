'use strict';

/**
 * Aplicación de `WorkspaceEdit` del protocolo LSP sobre texto plano.
 *
 * Las posiciones LSP son 0-based y se cuentan en unidades UTF-16, igual que
 * los índices de JavaScript sobre un string, así que la conversión es directa
 * una vez localizado el inicio de cada línea.
 */

/** Desplazamiento absoluto de una posición LSP dentro del texto. */
function desplazamientoDe(texto, posicion) {
  const linea = Math.max(0, posicion.line ?? 0);
  const caracter = Math.max(0, posicion.character ?? 0);

  let inicio = 0;
  let actual = 0;
  while (actual < linea) {
    const salto = texto.indexOf('\n', inicio);
    if (salto === -1) {
      // La línea pedida no existe: se ancla al final del texto.
      return texto.length;
    }
    inicio = salto + 1;
    actual += 1;
  }

  return Math.min(texto.length, inicio + caracter);
}

/** Aplica una lista de `TextEdit` a un texto. No muta la entrada. */
function aplicarEdiciones(texto, ediciones) {
  if (!Array.isArray(ediciones) || ediciones.length === 0) return texto;

  const resueltas = ediciones
    .map((edicion) => {
      // `range` es la forma moderna; `insert`/`replace` la antigua.
      if (edicion.range) {
        return {
          inicio: desplazamientoDe(texto, edicion.range.start),
          fin: desplazamientoDe(texto, edicion.range.end),
          nuevo: edicion.newText ?? '',
        };
      }
      if (typeof edicion.insert === 'object' && edicion.insert !== null) {
        const pos = desplazamientoDe(texto, edicion.insert);
        return { inicio: pos, fin: pos, nuevo: edicion.newText ?? '' };
      }
      return null;
    })
    .filter(Boolean);

  if (resueltas.length === 0) return texto;

  // De izquierda a derecha: se avanza un cursor y cada edición consume su
  // tramo. Si dos se solapan gana la que empieza antes, que es lo esperable.
  resueltas.sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);

  let salida = '';
  let cursor = 0;

  for (const { inicio, fin, nuevo } of resueltas) {
    if (inicio < cursor) continue; // solapa con el tramo ya consumido
    salida += texto.slice(cursor, inicio) + nuevo;
    cursor = fin;
  }

  return salida + texto.slice(cursor);
}

/**
 * Agrupa un `WorkspaceEdit` en el mapa uri → texto nuevo.
 * Acepta `changes` (mapa directo) y `documentChanges` (versión con
 * identificadores de documento).
 */
function aplicarWorkspaceEdit(textosPorUri, workspaceEdit) {
  const cambios = new Map();

  const porUri = new Map();
  const anotar = (uri, ediciones) => {
    if (!porUri.has(uri)) porUri.set(uri, []);
    porUri.get(uri).push(...ediciones);
  };

  if (workspaceEdit && workspaceEdit.changes) {
    for (const [uri, ediciones] of Object.entries(workspaceEdit.changes)) {
      anotar(uri, ediciones ?? []);
    }
  }

  if (workspaceEdit && Array.isArray(workspaceEdit.documentChanges)) {
    for (const cambio of workspaceEdit.documentChanges) {
      if (!cambio || cambio.kind) continue; // crear/renombrar/borrar: no soportado aquí
      const uri = cambio.textDocument?.uri;
      if (!uri) continue;
      anotar(uri, cambio.edits ?? []);
    }
  }

  for (const [uri, ediciones] of porUri) {
    const original = textosPorUri.get(uri);
    if (typeof original !== 'string') continue;
    cambios.set(uri, aplicarEdiciones(original, ediciones));
  }

  return cambios;
}

module.exports = { desplazamientoDe, aplicarEdiciones, aplicarWorkspaceEdit };
