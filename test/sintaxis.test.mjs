/**
 * Comprobación de sintaxis de todos los módulos de `electron/`.
 *
 * Tres veces seguidas rompí `flow.cjs` escribiendo un backtick dentro de un
 * comentario que vive dentro de una plantilla de JavaScript. El error aparecía
 * al ejecutar, no al editar, y `npm test` lo destapaba tarde y de refilón.
 *
 * Esta prueba lo dice en un segundo y con el fichero exacto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const DIR = fileURLToPath(new URL('../electron/', import.meta.url));

async function modulos() {
  const entradas = await readdir(DIR);
  return entradas.filter((n) => n.endsWith('.cjs') || n.endsWith('.mjs')).map((n) => join(DIR, n));
}

test('todos los módulos de electron/ tienen sintaxis válida', async () => {
  const ficheros = await modulos();
  assert.ok(ficheros.length > 10, 'no encontré los módulos de electron/');

  const rotos = [];
  for (const fichero of ficheros) {
    try {
      await ejecutar(process.execPath, ['--check', fichero]);
    } catch (error) {
      const salida = String(error.stderr || error.message);
      const linea = salida.match(/:(\d+)\s*\n/);
      rotos.push(`${fichero.split(/[\\/]/).pop()}${linea ? `:${linea[1]}` : ''} — ${salida.split('\n').find((l) => l.includes('Error')) || 'error'}`);
    }
  }

  assert.deepEqual(rotos, [], `módulos con sintaxis rota:\n  ${rotos.join('\n  ')}`);
});

/*
 * Aquí hubo una segunda prueba que buscaba backticks en comentarios. Se quitó
 * porque no detectaba el caso real: escribí un PAR de backticks dentro de un
 * comentario (`así`), que es par y aun así cierra la plantilla. Para saber si un
 * backtick está dentro de una plantilla hay que parsear el fichero, y eso ya lo
 * hace `node --check` — que además da el fichero y la línea exactos.
 */
