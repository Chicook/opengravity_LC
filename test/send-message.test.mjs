import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const subagentes = require('../electron/subagents.cjs');

test('enviarMensaje: entrega a un subagente concreto', () => {
  const id = subagentes.registrar({ nombre: 'uno', rol: 'test' });
  const n = subagentes.enviarMensaje(id, 'cambia de rumbo');
  assert.equal(n, 1);
  assert.match(subagentes.recogerMensajes(id) ?? '', /cambia de rumbo/);
});

test('recogerMensajes: la bandeja se vacía al leerla', () => {
  const id = subagentes.registrar({ nombre: 'dos', rol: 'test' });
  subagentes.enviarMensaje(id, 'hola');
  assert.ok(subagentes.recogerMensajes(id));
  assert.equal(subagentes.recogerMensajes(id), undefined);
});

test('enviarMensaje: @children difunde a todos los vivos', () => {
  const a = subagentes.registrar({ nombre: 'a', rol: 'test' });
  const b = subagentes.registrar({ nombre: 'b', rol: 'test' });
  const n = subagentes.enviarMensaje('@children', 'aviso general');
  assert.ok(n >= 2);
  assert.match(subagentes.recogerMensajes(a) ?? '', /aviso general/);
  assert.match(subagentes.recogerMensajes(b) ?? '', /aviso general/);
});

test('enviarMensaje: un destinatario inexistente no entrega nada', () => {
  assert.equal(subagentes.enviarMensaje('sub-inexistente', 'hola'), 0);
});

test('enviarMensaje: un mensaje vacío no entrega nada', () => {
  const id = subagentes.registrar({ nombre: 'c', rol: 'test' });
  assert.equal(subagentes.enviarMensaje(id, '   '), 0);
});

test('enviarMensaje: varios mensajes llegan juntos', () => {
  const id = subagentes.registrar({ nombre: 'd', rol: 'test' });
  subagentes.enviarMensaje(id, 'primero');
  subagentes.enviarMensaje(id, 'segundo');
  const texto = subagentes.recogerMensajes(id) ?? '';
  assert.match(texto, /primero/);
  assert.match(texto, /segundo/);
});

test('liberar: borra también la bandeja', () => {
  const id = subagentes.registrar({ nombre: 'e', rol: 'test' });
  subagentes.enviarMensaje(id, 'pendiente');
  subagentes.liberar(id);
  assert.equal(subagentes.recogerMensajes(id), undefined);
});

test('un subagente terminado ya no recibe mensajes', () => {
  const id = subagentes.registrar({ nombre: 'f', rol: 'test' });
  subagentes.liberar(id);
  assert.equal(subagentes.enviarMensaje(id, 'tarde'), 0);
});
