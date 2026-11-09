import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { aplicarReemplazos, inicioDeLinea, textoDelRango, contarLineas } = require('../electron/multi-replace.cjs');

test('contarLineas: una sola línea', () => {
  assert.equal(contarLineas('hola'), 1);
});

test('contarLineas: tres líneas', () => {
  assert.equal(contarLineas('a\nb\nc'), 3);
});

test('inicioDeLinea: primera línea es 0', () => {
  assert.equal(inicioDeLinea('uno\ndos\ntres', 1), 0);
});

test('inicioDeLinea: líneas siguientes', () => {
  const texto = 'uno\ndos\ntres';
  assert.equal(inicioDeLinea(texto, 2), 4);
  assert.equal(inicioDeLinea(texto, 3), 8);
});

test('inicioDeLinea: línea fuera de rango ancla al final', () => {
  assert.equal(inicioDeLinea('uno\ndos', 99), 7);
});

test('textoDelRango: recorta el tramo pedido', () => {
  const texto = 'uno\ndos\ntres';
  const { inicio, fin } = textoDelRango(texto, 2, 2);
  assert.equal(texto.slice(inicio, fin), 'dos\n');
});

test('aplicarReemplazos: un trozo', () => {
  const texto = 'const a = 1;\nconst b = 2;';
  const r = aplicarReemplazos(texto, [
    { startLine: 2, endLine: 2, targetContent: 'const b = 2;', replacementContent: 'const b = 20;' },
  ]);
  assert.equal(r.texto, 'const a = 1;\nconst b = 20;');
  assert.equal(r.aplicados, 1);
});

test('aplicarReemplazos: varios trozos en orden', () => {
  const texto = 'uno\ndos\ntres';
  const r = aplicarReemplazos(texto, [
    { startLine: 1, endLine: 1, targetContent: 'uno', replacementContent: 'UNO' },
    { startLine: 3, endLine: 3, targetContent: 'tres', replacementContent: 'TRES' },
  ]);
  assert.equal(r.texto, 'UNO\ndos\nTRES');
  assert.equal(r.aplicados, 2);
});

test('aplicarReemplazos: el segundo ve el resultado del primero', () => {
  const texto = 'a';
  const r = aplicarReemplazos(texto, [
    { startLine: 1, endLine: 1, targetContent: 'a', replacementContent: 'b' },
    { startLine: 1, endLine: 1, targetContent: 'b', replacementContent: 'c' },
  ]);
  assert.equal(r.texto, 'c');
});

test('aplicarReemplazos: si uno falla no se aplica ninguno', () => {
  const texto = 'uno\ndos';
  const r = aplicarReemplazos(texto, [
    { startLine: 1, endLine: 1, targetContent: 'uno', replacementContent: 'UNO' },
    { startLine: 2, endLine: 2, targetContent: 'NO EXISTE', replacementContent: 'x' },
  ]);
  assert.ok(r.error);
  assert.equal(r.indice, 1);
  assert.equal(r.texto, undefined);
});

test('aplicarReemplazos: objetivo repetido en la ventana es error', () => {
  const texto = 'x x';
  const r = aplicarReemplazos(texto, [
    { startLine: 1, endLine: 1, targetContent: 'x', replacementContent: 'y' },
  ]);
  assert.ok(r.error);
  assert.match(r.error, /más de una vez/);
});

test('aplicarReemplazos: el mismo texto fuera de la ventana no molesta', () => {
  const texto = 'x\nx';
  const r = aplicarReemplazos(texto, [
    { startLine: 2, endLine: 2, targetContent: 'x', replacementContent: 'y' },
  ]);
  assert.equal(r.texto, 'x\ny');
});

test('aplicarReemplazos: sin targetContent es error', () => {
  const r = aplicarReemplazos('abc', [{ startLine: 1, endLine: 1, replacementContent: 'x' }]);
  assert.ok(r.error);
});

test('aplicarReemplazos: rango inválido es error', () => {
  const r = aplicarReemplazos('abc', [
    { startLine: 3, endLine: 1, targetContent: 'abc', replacementContent: 'x' },
  ]);
  assert.ok(r.error);
  assert.match(r.error, /rango inválido/);
});

test('aplicarReemplazos: sin trozos es error', () => {
  assert.ok(aplicarReemplazos('abc', []).error);
  assert.ok(aplicarReemplazos('abc', null).error);
});

test('aplicarReemplazos: borrar con reemplazo vacío', () => {
  const texto = 'uno\ndos';
  const r = aplicarReemplazos(texto, [
    { startLine: 1, endLine: 1, targetContent: 'uno', replacementContent: '' },
  ]);
  assert.equal(r.texto, '\ndos');
});

test('aplicarReemplazos: sin endLine busca en todo el fichero', () => {
  const texto = 'a\nb\nc';
  const r = aplicarReemplazos(texto, [{ startLine: 1, targetContent: 'c', replacementContent: 'C' }]);
  assert.equal(r.texto, 'a\nb\nC');
});

test('aplicarReemplazos: multilínea dentro del rango', () => {
  const texto = 'inicio\nA\nB\nfin';
  const r = aplicarReemplazos(texto, [
    { startLine: 2, endLine: 3, targetContent: 'A\nB', replacementContent: 'AB' },
  ]);
  assert.equal(r.texto, 'inicio\nAB\nfin');
});
