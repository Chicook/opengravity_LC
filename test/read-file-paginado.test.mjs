import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { readFileTool } = await import('../dist/tools/fs.js');

async function conFichero(lineas) {
  const dir = await mkdtemp(join(tmpdir(), 'ogp-read-'));
  const ruta = join(dir, 'datos.txt');
  await writeFile(ruta, lineas.join('\n'), 'utf8');
  return { dir, ruta };
}

test('sin rango devuelve el fichero entero', async () => {
  const { dir } = await conFichero(['uno', 'dos', 'tres']);
  const r = await readFileTool.execute({ path: 'datos.txt' }, { cwd: dir });
  assert.equal(r.content, 'uno\ndos\ntres');
});

test('startLine/endLine devuelve solo ese tramo, 1-based e incluido', async () => {
  const { dir } = await conFichero(['uno', 'dos', 'tres', 'cuatro', 'cinco']);
  const r = await readFileTool.execute({ path: 'datos.txt', startLine: 2, endLine: 4 }, { cwd: dir });
  assert.match(r.content, /líneas 2-4 de 5/);
  assert.match(r.content, /\ndos\ntres\ncuatro/);
  assert.doesNotMatch(r.content, /uno/);
  assert.doesNotMatch(r.content, /cinco/);
});

test('la cabecera dice cuántas líneas quedan y desde dónde pedir', async () => {
  const { dir } = await conFichero(Array.from({ length: 10 }, (_, i) => `l${i + 1}`));
  const r = await readFileTool.execute({ path: 'datos.txt', startLine: 1, endLine: 3 }, { cwd: dir });
  assert.match(r.content, /quedan 7 líneas; pide desde 4/);
});

test('solo startLine devuelve una página de 200 líneas', async () => {
  const { dir } = await conFichero(Array.from({ length: 300 }, (_, i) => `l${i + 1}`));
  const r = await readFileTool.execute({ path: 'datos.txt', startLine: 1 }, { cwd: dir });
  assert.match(r.content, /líneas 1-200 de 300/);
});

test('un rango invertido es error, no texto vacío', async () => {
  const { dir } = await conFichero(['a', 'b', 'c']);
  const r = await readFileTool.execute({ path: 'datos.txt', startLine: 3, endLine: 1 }, { cwd: dir });
  assert.equal(r.isError, true);
  assert.match(r.content, /Rango vacío/);
});

test('endLine mayor que el fichero se recorta al final real', async () => {
  const { dir } = await conFichero(['a', 'b', 'c']);
  const r = await readFileTool.execute({ path: 'datos.txt', startLine: 2, endLine: 999 }, { cwd: dir });
  assert.match(r.content, /líneas 2-3 de 3/);
  assert.doesNotMatch(r.content, /quedan/);
});

test('al truncar por bytes avisa de que se puede paginar', async () => {
  const { dir } = await conFichero(Array.from({ length: 50 }, (_, i) => `linea-${i}-relleno`));
  const r = await readFileTool.execute({ path: 'datos.txt', maxBytes: 60 }, { cwd: dir });
  assert.match(r.content, /truncado/);
  assert.match(r.content, /startLine\/endLine/);
});
