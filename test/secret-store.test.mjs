import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cifrarClaves, descifrarClaves } = require('../electron/secret-store.cjs');

const falso = {
  isEncryptionAvailable: () => true,
  encryptString: (texto) => Buffer.from(`x${texto}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').slice(1),
};

test('cifra y descifra el mapa de claves', () => {
  const claves = { 'opencode-go': 'sk-prueba' };
  const cifrado = cifrarClaves(claves, falso);

  assert.equal(typeof cifrado, 'string');
  assert.deepEqual(descifrarClaves(cifrado, falso), claves);
});

test('devuelve null si no hay cifrado disponible', () => {
  assert.equal(cifrarClaves({ a: 'b' }, { isEncryptionAvailable: () => false }), null);
});

test('no cifra un mapa vacío ni ausente', () => {
  assert.equal(cifrarClaves({}, falso), null);
  assert.equal(cifrarClaves(null, falso), null);
  assert.equal(cifrarClaves(undefined, falso), null);
});

test('devuelve null ante texto vacío, no string o base64 corrupto', () => {
  assert.equal(descifrarClaves('', falso), null);
  assert.equal(descifrarClaves(null, falso), null);
  assert.equal(descifrarClaves(undefined, falso), null);
  assert.equal(descifrarClaves('no-es-base64-valido', falso), null);
  assert.equal(descifrarClaves('bm8gZXMgdW4ganNvbg==', falso), null);
});

test('conserva mapas con varios proveedores y caracteres no ASCII', () => {
  const claves = { 'opencode-go': 'sk-ñandú', local: 'clave con espacios' };
  assert.deepEqual(descifrarClaves(cifrarClaves(claves, falso), falso), claves);
});
