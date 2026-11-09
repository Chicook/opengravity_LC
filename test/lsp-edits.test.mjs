import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { desplazamientoDe, aplicarEdiciones, aplicarWorkspaceEdit } = require('../electron/lsp-edits.cjs');

test('desplazamientoDe: inicio del texto', () => {
  assert.equal(desplazamientoDe('uno\ndos', { line: 0, character: 0 }), 0);
});

test('desplazamientoDe: dentro de la primera línea', () => {
  assert.equal(desplazamientoDe('uno\ndos', { line: 0, character: 2 }), 2);
});

test('desplazamientoDe: inicio de la segunda línea', () => {
  assert.equal(desplazamientoDe('uno\ndos', { line: 1, character: 0 }), 4);
});

test('desplazamientoDe: línea inexistente ancla al final', () => {
  assert.equal(desplazamientoDe('uno\ndos', { line: 9, character: 0 }), 7);
});

test('desplazamientoDe: carácter más allá de la línea se recorta', () => {
  assert.equal(desplazamientoDe('ab\ncd', { line: 0, character: 99 }), 5);
});

test('aplicarEdiciones: inserción pura', () => {
  const texto = 'const a = 1;';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// x\n' },
  ]);
  assert.equal(nuevo, '// x\nconst a = 1;');
});

test('aplicarEdiciones: reemplazo de un rango', () => {
  const texto = 'const a = 1;';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: 'b' },
  ]);
  assert.equal(nuevo, 'const b = 1;');
});

test('aplicarEdiciones: borrado con texto vacío', () => {
  const texto = 'uno dos tres';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } }, newText: '' },
  ]);
  // [3,8] cubre « dos », no el espacio anterior: quedan pegados.
  assert.equal(nuevo, 'unotres');
});

test('aplicarEdiciones: varias ediciones en la misma línea', () => {
  const texto = 'a b c';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'X' },
    { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, newText: 'Z' },
  ]);
  assert.equal(nuevo, 'X b Z');
});

test('aplicarEdiciones: varias líneas', () => {
  const texto = 'uno\ndos\ntres';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'UNO' },
    { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }, newText: 'TRES' },
  ]);
  assert.equal(nuevo, 'UNO\ndos\nTRES');
});

test('aplicarEdiciones: no muta el texto original', () => {
  const texto = 'abc';
  aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'x' },
  ]);
  assert.equal(texto, 'abc');
});

test('aplicarEdiciones: sin ediciones devuelve el mismo texto', () => {
  assert.equal(aplicarEdiciones('abc', []), 'abc');
  assert.equal(aplicarEdiciones('abc', null), 'abc');
});

test('aplicarEdiciones: forma antigua con insert', () => {
  const texto = 'abc';
  const nuevo = aplicarEdiciones(texto, [{ insert: { line: 0, character: 1 }, newText: 'X' }]);
  assert.equal(nuevo, 'aXbc');
});

test('aplicarEdiciones: orden inverso no rompe los desplazamientos', () => {
  const texto = 'aaa';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'C' },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'A' },
  ]);
  assert.equal(nuevo, 'AaC');
});

test('aplicarEdiciones: ediciones solapadas no duplican texto', () => {
  const texto = 'abcdef';
  const nuevo = aplicarEdiciones(texto, [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: 'X' },
    { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 6 } }, newText: 'Y' },
  ]);
  // Gana la que empieza antes; la otra queda cubierta y se descarta.
  assert.equal(nuevo, 'Xef');
});

test('aplicarWorkspaceEdit: aplica changes por uri', () => {
  const textos = new Map([
    ['file:///a.ts', 'const a = 1;'],
    ['file:///b.ts', 'const b = 2;'],
  ]);
  const cambios = aplicarWorkspaceEdit(textos, {
    changes: {
      'file:///a.ts': [
        { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: 'x' },
      ],
    },
  });
  assert.equal(cambios.get('file:///a.ts'), 'const x = 1;');
  assert.equal(cambios.has('file:///b.ts'), false);
});

test('aplicarWorkspaceEdit: ignora uris desconocidas', () => {
  const cambios = aplicarWorkspaceEdit(new Map(), {
    changes: { 'file:///z.ts': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }] },
  });
  assert.equal(cambios.size, 0);
});

test('aplicarWorkspaceEdit: soporta documentChanges', () => {
  const textos = new Map([['file:///a.ts', 'abc']]);
  const cambios = aplicarWorkspaceEdit(textos, {
    documentChanges: [
      {
        textDocument: { uri: 'file:///a.ts', version: 1 },
        edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'Z' }],
      },
    ],
  });
  assert.equal(cambios.get('file:///a.ts'), 'Zbc');
});

test('aplicarWorkspaceEdit: ignora operaciones de fichero', () => {
  const textos = new Map([['file:///a.ts', 'abc']]);
  const cambios = aplicarWorkspaceEdit(textos, {
    documentChanges: [{ kind: 'create', uri: 'file:///nuevo.ts' }],
  });
  assert.equal(cambios.size, 0);
});
