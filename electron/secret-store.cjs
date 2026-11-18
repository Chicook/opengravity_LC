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

  // Sin claves en memoria no hay nada que decidir: el fichero se deja igual.
  if (!claves) return prefsParaDisco;

  /*
   * Sin cifrado disponible no se escriben claves nuevas en claro: se quedan
   * solo en memoria y el usuario las vuelve a pegar si reinicia. Las que ya
   * estaban en claro en disco (versión anterior) se conservan tal cual para no
   * perderlas.
   */
  const enClaro = {};
  for (const [id, valor] of Object.entries(claves)) {
    if (previo?.apiKeys?.[id] === valor) enClaro[id] = valor;
  }
  if (Object.keys(enClaro).length > 0) prefsParaDisco.apiKeys = enClaro;
  else delete prefsParaDisco.apiKeys;

  // Un blob que ya se descifró en este arranque es viejo: no guarda nada nuevo.
  if (!actuales.apiKeysEnc) delete prefsParaDisco.apiKeysEnc;
  return prefsParaDisco;
}

module.exports = { cifrarClaves, descifrarClaves, prepararPrefsParaDisco };
