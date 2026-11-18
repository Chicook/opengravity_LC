// Pruebas del esquema propio `app://`.
//
// El renderer se sirve bajo `app://` porque Chromium bloquea los workers desde
// `file://` y Monaco los necesita. Ese esquema es una puerta de LECTURA: sin
// contención, una página podía pedir `app://local/..%5C..%5CUsers%5Cx` y leer
// ficheros fuera de la aplicación. Estas pruebas fijan la frontera.
//
// Nota medida: el parser de URL ya colapsa los segmentos `..` antes de que los
// veamos (`app://local/../../x` llega como `/x`). El agujero real era la barra
// invertida codificada, que `path.join` sí interpreta como separador en Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { modulo } from './helpers.mjs';

const { resolverRutaApp } = modulo('protocol-path');

const RAIZ = path.resolve('C:/proyectos/app/resources/app.asar');

test('sirve un fichero de la aplicación', () => {
  const destino = resolverRutaApp(RAIZ, 'app://local/renderer/index.html');
  assert.equal(destino, path.join(RAIZ, 'renderer', 'index.html'));
});

test('sirve la raíz y las rutas con espacios codificados', () => {
  assert.equal(resolverRutaApp(RAIZ, 'app://local/'), RAIZ);
  assert.equal(resolverRutaApp(RAIZ, 'app://local/a%20b.js'), path.join(RAIZ, 'a b.js'));
});

test('el parser de URL ya colapsa los ../ antes de resolver', () => {
  const destino = resolverRutaApp(RAIZ, 'app://local/../../secreto.txt');
  assert.equal(destino, path.join(RAIZ, 'secreto.txt'));
});

test('rechaza la salida con barra invertida codificada (Windows)', () => {
  // `..%5C..%5C` es la variante que se colaba: el parser de URL no la mira y
  // `path.join` la trata como separador, así que subía dos niveles.
  assert.equal(resolverRutaApp(RAIZ, 'app://local/..%5C..%5CUsers%5Csecreto.txt'), null);
});

test('rechaza una ruta absoluta colada en la URL', () => {
  // Sin contención, `path.resolve` con una ruta absoluta descarta la raíz.
  assert.equal(resolverRutaApp(RAIZ, 'app://local/C:%5CWindows%5Cwin.ini'), null);
});

test('rechaza secuencias de escape mal formadas', () => {
  assert.equal(resolverRutaApp(RAIZ, 'app://local/%zz'), null);
});
