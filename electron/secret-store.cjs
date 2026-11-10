'use strict';

/**
 * Cifrado en reposo de las claves API con `safeStorage` de Electron.
 *
 * Las claves se guardan como un único blob base64 (`prefs.apiKeysEnc`) en
 * `settings.json`; en memoria siguen viviendo en claro en `prefs.apiKeys`.
 */

function cifrarClaves(apiKeys, safeStorage) {
  if (!apiKeys || Object.keys(apiKeys).length === 0) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(JSON.stringify(apiKeys)).toString('base64');
}

function descifrarClaves(texto, safeStorage) {
  if (typeof texto !== 'string' || texto.length === 0) return null;
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(texto, 'base64')));
  } catch {
    return null;
  }
}

/**
 * Prefs tal como deben quedar en disco (sin claves en claro si se puede).
 *
 * `prefs` es el estado en memoria y `previo` lo que ya había en el fichero.
 * Un `apiKeysEnc` que sobrevive en `prefs` es un cifrado que no se pudo leer:
 * solo se descarta cuando hay `apiKeys` en memoria y no queda ese blob.
 */
function prepararPrefsParaDisco(prefs, previo, safeStorage) {
  const actuales = prefs ?? {};
  const prefsParaDisco = { ...(previo ?? {}), ...actuales };
  const claves = actuales.apiKeys;
  const cifrado = cifrarClaves(claves, safeStorage);

  if (cifrado) {
    prefsParaDisco.apiKeysEnc = cifrado;
    delete prefsParaDisco.apiKeys;
    return prefsParaDisco;
  }

  // Sin blob nuevo: el viejo solo sirve si es lo único que guarda las claves.
  if (claves && !actuales.apiKeysEnc) delete prefsParaDisco.apiKeysEnc;
  // Un mapa vacío no aporta nada al fichero.
  if (claves && Object.keys(claves).length === 0) delete prefsParaDisco.apiKeys;
  return prefsParaDisco;
}

module.exports = { cifrarClaves, descifrarClaves, prepararPrefsParaDisco };
