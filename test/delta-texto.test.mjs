// Un delta puede llegar como cadena, como lista de partes o como objeto.
// Concatenar el objeto tal cual escribía «[object Object]» en el hilo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { raiz } from './helpers.mjs';

const { textoDeDelta } = await import(
  pathToFileURL(path.join(raiz, 'dist/providers/http.js')).href
);

describe('textoDeDelta', () => {
  test('una cadena pasa intacta', () => {
    assert.equal(textoDeDelta('hola'), 'hola');
    assert.equal(textoDeDelta(''), '');
  });

  test('una lista de partes se concatena', () => {
    assert.equal(
      textoDeDelta([{ type: 'text', text: 'uno ' }, { type: 'text', text: 'dos' }]),
      'uno dos',
    );
    assert.equal(textoDeDelta(['a', 'b']), 'ab');
    assert.equal(textoDeDelta([{ content: 'solo content' }]), 'solo content');
  });

  test('un objeto con text o content devuelve su texto', () => {
    assert.equal(textoDeDelta({ text: 'objeto' }), 'objeto');
    assert.equal(textoDeDelta({ content: 'contenido' }), 'contenido');
  });

  test('lo que no es texto devuelve cadena vacía, no basura', () => {
    for (const valor of [null, undefined, 42, true, {}, { text: 1 }, [], [{}]]) {
      assert.equal(textoDeDelta(valor), '', JSON.stringify(valor));
    }
  });

  test('el literal [object Object] no puede salir de un objeto', () => {
    const basura = [{ type: 'text' }, { type: 'tool' }];
    assert.equal(textoDeDelta(basura).includes('[object Object]'), false);
  });
});
