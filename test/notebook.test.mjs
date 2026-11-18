import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { aplicarAccion, textoDeCelda, fuenteDesde } = require('../electron/notebook.cjs');

const cuaderno = (celdas) => ({ cells: celdas, metadata: {}, nbformat: 4, nbformat_minor: 5 });
const code = (texto) => ({ cell_type: 'code', metadata: {}, source: fuenteDesde(texto), outputs: [], execution_count: null });

test('fuenteDesde: una línea sin salto final', () => {
  assert.deepEqual(fuenteDesde('hola'), ['hola']);
});

test('fuenteDesde: varias líneas con salto salvo la última', () => {
  assert.deepEqual(fuenteDesde('a\nb'), ['a\n', 'b']);
});

test('textoDeCelda: une el source', () => {
  assert.equal(textoDeCelda(code('a\nb')), 'a\nb');
});

test('list: numera las celdas con su tipo', () => {
  const r = aplicarAccion(cuaderno([code('uno'), code('dos')]), { action: 'list' });
  assert.equal(r.salida.length, 2);
  assert.match(r.salida[0], /^0 \[code\] uno/);
  assert.match(r.salida[1], /^1 \[code\] dos/);
});

test('list: cuaderno vacío', () => {
  const r = aplicarAccion(cuaderno([]), { action: 'list' });
  assert.match(r.mensaje, /no tiene celdas/);
});

test('get: devuelve el texto de la celda', () => {
  const r = aplicarAccion(cuaderno([code('uno'), code('dos')]), { action: 'get', cellIndex: 1 });
  assert.equal(r.salida[0], 'dos');
});

test('get: índice fuera de rango es error', () => {
  const r = aplicarAccion(cuaderno([code('uno')]), { action: 'get', cellIndex: 5 });
  assert.ok(r.error);
});

test('add: inserta al final por defecto', () => {
  const c = cuaderno([code('uno')]);
  aplicarAccion(c, { action: 'add', cellContent: 'dos' });
  assert.equal(c.cells.length, 2);
  assert.equal(textoDeCelda(c.cells[1]), 'dos');
});

test('add: inserta en la posición indicada', () => {
  const c = cuaderno([code('uno'), code('tres')]);
  aplicarAccion(c, { action: 'add', cellIndex: 1, cellContent: 'dos' });
  assert.equal(textoDeCelda(c.cells[1]), 'dos');
  assert.equal(textoDeCelda(c.cells[2]), 'tres');
});

test('add: markdown no lleva outputs', () => {
  const c = cuaderno([]);
  aplicarAccion(c, { action: 'add', cellType: 'markdown', cellContent: '# título' });
  assert.equal(c.cells[0].cell_type, 'markdown');
  assert.equal(c.cells[0].outputs, undefined);
});

test('add: una celda de código nace sin salida', () => {
  const c = cuaderno([]);
  aplicarAccion(c, { action: 'add', cellContent: 'print(1)' });
  assert.deepEqual(c.cells[0].outputs, []);
  assert.equal(c.cells[0].execution_count, null);
});

test('update: cambia el contenido y limpia la salida', () => {
  const c = cuaderno([{ ...code('viejo'), outputs: [{ x: 1 }], execution_count: 3 }]);
  aplicarAccion(c, { action: 'update', cellIndex: 0, cellContent: 'nuevo' });
  assert.equal(textoDeCelda(c.cells[0]), 'nuevo');
  assert.deepEqual(c.cells[0].outputs, []);
  assert.equal(c.cells[0].execution_count, null);
});

test('update: cambia el tipo', () => {
  const c = cuaderno([code('x')]);
  aplicarAccion(c, { action: 'update', cellIndex: 0, cellType: 'markdown' });
  assert.equal(c.cells[0].cell_type, 'markdown');
});

test('delete: quita la celda', () => {
  const c = cuaderno([code('uno'), code('dos')]);
  aplicarAccion(c, { action: 'delete', cellIndex: 0 });
  assert.equal(c.cells.length, 1);
  assert.equal(textoDeCelda(c.cells[0]), 'dos');
});

test('create: solo sobre un cuaderno vacío', () => {
  const c = cuaderno([]);
  const r = aplicarAccion(c, { action: 'create', cellContent: 'x' });
  assert.ok(!r.error);
  assert.equal(c.cells.length, 1);

  const lleno = cuaderno([code('x')]);
  assert.ok(aplicarAccion(lleno, { action: 'create' }).error);
});

test('acción desconocida es error', () => {
  assert.ok(aplicarAccion(cuaderno([]), { action: 'borrar-todo' }).error);
});

test('sin acción es error', () => {
  assert.ok(aplicarAccion(cuaderno([]), {}).error);
});

test('create no sobrescribe un cuaderno existente', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const { makeEditNotebookTool } = require('../electron/notebook.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  const ruta = path.join(dir, 'analisis.ipynb');
  const previo = JSON.stringify(cuaderno([code('celda-importante')]), null, 1);
  fs.writeFileSync(ruta, previo, 'utf8');

  try {
    const tool = makeEditNotebookTool(() => dir);
    const resultado = await tool.execute({ path: 'analisis.ipynb', action: 'create' });

    assert.equal(resultado.isError, true);
    assert.match(resultado.content, /ya existe/);
    assert.equal(fs.readFileSync(ruta, 'utf8'), previo, 'el cuaderno no debe cambiar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create escribe cuando el cuaderno no existe', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const { makeEditNotebookTool } = require('../electron/notebook.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  const ruta = path.join(dir, 'nuevo.ipynb');

  try {
    const tool = makeEditNotebookTool(() => dir);
    const resultado = await tool.execute({ path: 'nuevo.ipynb', action: 'create', content: 'print(1)' });

    assert.equal(resultado.isError, undefined);
    const escrito = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.equal(escribido_cells(escrito), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function escribido_cells(cuadernoEscrito) {
  return Array.isArray(cuadernoEscrito.cells) ? cuadernoEscrito.cells.length : 0;
}
