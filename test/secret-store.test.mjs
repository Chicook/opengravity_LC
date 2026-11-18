import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cifrarClaves, descifrarClaves, prepararPrefsParaDisco } = require('../electron/secret-store.cjs');

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

// --- prefs para disco -------------------------------------------------------

const sinCifrado = { isEncryptionAvailable: () => false };

test('conserva el blob ilegible aunque apiKeys llegue vacío', () => {
  // Descifrado falló al cargar: `apiKeysEnc` sigue en memoria. Un `{}`
  // incidental (blur del campo) no debe borrarlo.
  const prefs = { apiKeys: {}, apiKeysEnc: 'blob-ilegible' };
  assert.deepEqual(prepararPrefsParaDisco(prefs, {}, falso), { apiKeysEnc: 'blob-ilegible' });
});

test('borra el blob viejo cuando el mapa se vacía y no hay cifrado ilegible', () => {
  const prefs = { apiKeys: {}, tema: 'Dark' };
  const previo = { apiKeysEnc: 'blob-viejo', tema: 'Light' };
  const disco = prepararPrefsParaDisco(prefs, previo, falso);

  assert.equal(disco.apiKeysEnc, undefined);
  assert.equal(disco.apiKeys, undefined);
  assert.equal(disco.tema, 'Dark');
});

test('con claves y cifrado escribe apiKeysEnc y no apiKeys', () => {
  const prefs = { apiKeys: { 'opencode-go': 'sk-prueba' }, tema: 'Dark' };
  const disco = prepararPrefsParaDisco(prefs, { apiKeysEnc: 'blob-viejo' }, falso);

  assert.equal(typeof disco.apiKeysEnc, 'string');
  assert.equal('apiKeys' in disco, false);
  assert.deepEqual(descifrarClaves(disco.apiKeysEnc, falso), prefs.apiKeys);
  assert.equal(disco.tema, 'Dark');
});

test('sin cifrado disponible no escribe claves nuevas en claro', () => {
  // Se quedan solo en memoria: escribirlas en claro dejaba la clave legible
  // por otra cuenta local. El blob ya descifrado era viejo y se descarta.
  const prefs = { apiKeys: { a: 'b' } };
  const disco = prepararPrefsParaDisco(prefs, { apiKeysEnc: 'blob-viejo' }, sinCifrado);

  assert.equal('apiKeys' in disco, false);
  assert.equal(disco.apiKeysEnc, undefined);
});

test('sin cifrado conserva las claves que ya estaban en claro', () => {
  // Fichero de una versión anterior: no se pierden al guardar sin cifrado.
  const prefs = { apiKeys: { a: 'b' }, tema: 'Dark' };
  const disco = prepararPrefsParaDisco(prefs, { apiKeys: { a: 'b' } }, sinCifrado);

  assert.deepEqual(disco.apiKeys, { a: 'b' });
});

test('sin claves en memoria no toca lo que había en disco', () => {
  const disco = prepararPrefsParaDisco({ tema: 'Dark' }, { apiKeysEnc: 'blob' }, falso);

  assert.equal(disco.apiKeysEnc, 'blob');
  assert.equal('apiKeys' in disco, false);
});
