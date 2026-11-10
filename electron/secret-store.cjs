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

module.exports = { cifrarClaves, descifrarClaves };
