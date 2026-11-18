'use strict';

/**
 * Descifra `prefs.apiKeysEnc` con `safeStorage` de Electron.
 *
 * El CLI corre en Node y no puede usar safeStorage directamente; lanza este
 * helper con el binario de Electron y lee el JSON por stdout. El userData se
 * fija al directorio del settings para que la clave sea la de la app.
 *
 * Uso: electron decrypt-keys.cjs <ruta-settings.json>
 * Salida: KEYS:<json> o NO_ENC; los errores van a stderr.
 */

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const rutaSettings = process.argv[process.argv.length - 1];
try {
  app.setName('Opengravity');
  app.setPath('userData', path.dirname(rutaSettings));
} catch {
  // sin userData no se puede descifrar; el llamador sigue con env/claves claras
}

app.whenReady().then(() => {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaSettings, 'utf8'));
    const cifrado = datos?.prefs?.apiKeysEnc;
    if (!cifrado) {
      process.stdout.write('NO_ENC');
    } else if (!safeStorage.isEncryptionAvailable()) {
      process.stdout.write('NO_ENC');
    } else {
      const texto = safeStorage.decryptString(Buffer.from(String(cifrado), 'base64'));
      process.stdout.write(`KEYS:${texto}`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    app.quit();
  }
});
