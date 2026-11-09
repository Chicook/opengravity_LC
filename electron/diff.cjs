'use strict';

/**
 * Diff de líneas.
 *
 * LCS clásico con memoria acotada. Devuelve una lista de filas que el renderer
 * pinta con colores: contexto, añadido, eliminado.
 *
 * Límite: si alguno de los lados supera MAX_LINES, no se calcula LCS (coste
 * cuadrático) y se devuelve un diff "todo reemplazado" marcado como aproximado.
 */

const MAX_LINES = 4000;

/**
 * @param {string} before contenido actual ('' si el fichero no existe)
 * @param {string} after contenido propuesto
 * @returns {{ rows: Array<{type: 'context'|'add'|'remove', text: string, oldLine: number|null, newLine: number|null}>, additions: number, removals: number, approximate: boolean }}
 */
function diffLines(before, after) {
  const a = before.length === 0 ? [] : before.split('\n');
  const b = after.length === 0 ? [] : after.split('\n');

  const rows = [];
  let additions = 0;
  let removals = 0;

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    a.forEach((text, index) => {
      rows.push({ type: 'remove', text, oldLine: index + 1, newLine: null });
      removals += 1;
    });
    b.forEach((text, index) => {
      rows.push({ type: 'add', text, oldLine: null, newLine: index + 1 });
      additions += 1;
    });
    return { rows, additions, removals, approximate: true };
  }

  // Tabla LCS
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: 'remove', text: a[i], oldLine: i + 1, newLine: null });
      removals += 1;
      i += 1;
    } else {
      rows.push({ type: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      additions += 1;
      j += 1;
    }
  }

  while (i < n) {
    rows.push({ type: 'remove', text: a[i], oldLine: i + 1, newLine: null });
    removals += 1;
    i += 1;
  }

  while (j < m) {
    rows.push({ type: 'add', text: b[j], oldLine: null, newLine: j + 1 });
    additions += 1;
    j += 1;
  }

  return { rows, additions, removals, approximate: false };
}

/**
 * Recorta el diff a las filas cercanas a un cambio, para no pintar ficheros
 * enteros. Mantiene `context` líneas alrededor de cada bloque modificado.
 */
function compactDiff(rows, context = 3) {
  const keep = new Set();

  rows.forEach((row, index) => {
    if (row.type === 'context') return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k += 1) {
      keep.add(k);
    }
  });

  const result = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (skipped > 0) {
        result.push({ type: 'gap', text: `… ${skipped} líneas sin cambios …`, oldLine: null, newLine: null });
        skipped = 0;
      }
      result.push(row);
    } else {
      skipped += 1;
    }
  });

  if (skipped > 0 && result.length > 0) {
    result.push({ type: 'gap', text: `… ${skipped} líneas sin cambios …`, oldLine: null, newLine: null });
  }

  return result;
}

module.exports = { diffLines, compactDiff, MAX_LINES };
