import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  crearBuscador,
  buscarEnContenido,
  reemplazarEnContenido,
  posicionDe,
  lineaEn,
  escaparRegex,
} = require('../electron/search.cjs');

test('crearBuscador: literal, sin distinguir mayúsculas por defecto', () => {
  const buscar = crearBuscador('Hola');
  assert.deepEqual(
    buscar('hola HOLA Hola').map((h) => h.texto),
    ['hola', 'HOLA', 'Hola'],
  );
});

test('crearBuscador: literal escapa metacaracteres', () => {
  const buscar = crearBuscador('a.b');
  assert.deepEqual(buscar('a.b axb').map((h) => h.texto), ['a.b']);
});

test('crearBuscador: distingue mayúsculas si se pide', () => {
  const buscar = crearBuscador('Hola', { sensibleAMayusculas: true });
  assert.deepEqual(buscar('hola HOLA Hola').map((h) => h.texto), ['Hola']);
});

test('crearBuscador: modo regex', () => {
  const buscar = crearBuscador('\\d+', { regex: true });
  assert.deepEqual(buscar('a1 b22 c333').map((h) => h.texto), ['1', '22', '333']);
});

test('crearBuscador: palabra completa', () => {
  const buscar = crearBuscador('mar', { palabraCompleta: true });
  assert.deepEqual(buscar('mar marea marcar mar').map((h) => h.texto), ['mar', 'mar']);
});

test('crearBuscador: consulta vacía no devuelve nada', () => {
  assert.deepEqual(crearBuscador('')('hola'), []);
});

test('crearBuscador: regex inválida no rompe', () => {
  const buscar = crearBuscador('([', { regex: true });
  assert.deepEqual(buscar('hola'), []);
});

test('crearBuscador: coincidencia vacía no cuelga el bucle', () => {
  const buscar = crearBuscador('a*', { regex: true });
  const hallazgos = buscar('bbb');
  assert.ok(hallazgos.length > 0);
});

test('escaparRegex: neutraliza metacaracteres', () => {
  assert.equal(escaparRegex('a.b*c'), 'a\\.b\\*c');
});

test('posicionDe: primera línea y columna', () => {
  assert.deepEqual(posicionDe('hola mundo', 0), { linea: 1, columna: 1 });
  assert.deepEqual(posicionDe('hola mundo', 5), { linea: 1, columna: 6 });
});

test('posicionDe: líneas siguientes', () => {
  const texto = 'uno\ndos\ntres';
  assert.deepEqual(posicionDe(texto, texto.indexOf('dos')), { linea: 2, columna: 1 });
  assert.deepEqual(posicionDe(texto, texto.indexOf('tres')), { linea: 3, columna: 1 });
});

test('lineaEn: devuelve solo la línea del índice', () => {
  const texto = 'uno\ndos\ntres';
  assert.equal(lineaEn(texto, texto.indexOf('dos')), 'dos');
  assert.equal(lineaEn(texto, texto.indexOf('tres')), 'tres');
});

test('buscarEnContenido: agrupa posición y texto de línea', () => {
  const buscar = crearBuscador('bug');
  const resultados = buscarEnContenido('sin nada\nun bug aqui', buscar, 'a.js');
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].ruta, 'a.js');
  assert.equal(resultados[0].linea, 2);
  assert.equal(resultados[0].columna, 4);
  assert.equal(resultados[0].texto, 'un bug aqui');
});

test('buscarEnContenido: respeta el límite', () => {
  const buscar = crearBuscador('x');
  const resultados = buscarEnContenido('x'.repeat(50), buscar, 'a.js', 10);
  assert.equal(resultados.length, 10);
});

test('reemplazarEnContenido: sustituye todas', () => {
  const buscar = crearBuscador('bug');
  const { contenido, cambios } = reemplazarEnContenido('bug y bug', buscar, 'fallo');
  assert.equal(contenido, 'fallo y fallo');
  assert.equal(cambios, 2);
});

test('reemplazarEnContenido: sin coincidencias no toca nada', () => {
  const buscar = crearBuscador('zzz');
  const { contenido, cambios } = reemplazarEnContenido('hola', buscar, 'x');
  assert.equal(contenido, 'hola');
  assert.equal(cambios, 0);
});

test('reemplazarEnContenido: conserva el texto de alrededor', () => {
  const buscar = crearBuscador('B');
  const { contenido } = reemplazarEnContenido('aBc', buscar, 'X');
  assert.equal(contenido, 'aXc');
});

test('reemplazarEnContenido: preserva mayúsculas cuando se pide', () => {
  const buscar = crearBuscador('color');
  const { contenido } = reemplazarEnContenido('color Color COLOR', buscar, 'colour', {
    preservarMayusculas: true,
  });
  assert.equal(contenido, 'colour Colour COLOUR');
});

test('reemplazarEnContenido: no sustituye dentro del reemplazo anterior', () => {
  const buscar = crearBuscador('a');
  const { contenido, cambios } = reemplazarEnContenido('aaa', buscar, 'aa');
  assert.equal(contenido, 'aaaaaa');
  assert.equal(cambios, 3);
});

test('reemplazarEnContenido: reemplazo vacío borra las coincidencias', () => {
  const buscar = crearBuscador('quita');
  const { contenido } = reemplazarEnContenido('quita esto', buscar, '');
  assert.equal(contenido, ' esto');
});

test('reemplazarEnContenido: multilínea con regex', () => {
  const buscar = crearBuscador('[ \\t]+$', { regex: true, multilinea: true });
  const { contenido } = reemplazarEnContenido('a  \nb\t\n', buscar, '');
  assert.equal(contenido, 'a\nb\n');
});

test('crearBuscador: multilinea hace que ^ valga por línea', () => {
  const buscar = crearBuscador('^dos', { regex: true, multilinea: true });
  assert.deepEqual(buscar('uno\ndos').map((h) => h.texto), ['dos']);
});

test('crearBuscador: sin multilinea ^ solo vale al principio', () => {
  const buscar = crearBuscador('^dos', { regex: true });
  assert.deepEqual(buscar('uno\ndos'), []);
});
