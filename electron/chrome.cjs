'use strict';

/**
 * Usar el Chrome del usuario, con su sesión ya iniciada.
 *
 * Por qué así y no copiando cookies: desde Chrome 127 las cookies están
 * protegidas con App-Bound Encryption, cuya clave solo desenvuelve un servicio
 * de Chrome que comprueba quién llama. Copiar el perfil tampoco sirve (desde
 * Chrome 136 un `--user-data-dir` distinto usa claves distintas). Las
 * herramientas que lo consiguen lo hacen inyectando código en el proceso del
 * navegador, y eso no va en una app que la gente instala.
 *
 * Lo que sí funciona: arrancar SU Chrome con depuración remota sobre su perfil
 * real y conducirlo por CDP. Hereda su sesión sin tocar nada cifrado.
 *
 * Condición: Chrome tiene que estar cerrado del todo. Una instancia ya abierta
 * ignora la bandera y no expone el puerto.
 */

const { spawn, execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/** Puerto de depuración. Uno propio para no chocar con otras herramientas. */
const PUERTO = 9222;

/** Endpoint HTTP de depuración. */
const ENDPOINT = `http://127.0.0.1:${PUERTO}`;

let procesoLanzado = null;
let clienteCdp = null;

/** Rutas habituales de Chrome en cada sistema. */
function rutasDeChrome() {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

  if (process.platform === 'win32') {
    return [
      path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }

  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
}

/** Primer ejecutable de Chrome que exista, o null. */
async function rutaDeChrome() {
  for (const ruta of rutasDeChrome()) {
    try {
      await fsp.access(ruta);
      return ruta;
    } catch {
      // se prueba la siguiente
    }
  }
  return null;
}

/** Directorio de datos real del usuario. */
function perfilDeUsuario() {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

  if (process.platform === 'win32') return path.join(local, 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(os.homedir(), '.config', 'google-chrome');
}

/** ¿Está Chrome corriendo ahora mismo? */
function chromeAbierto() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      execFile('pgrep', ['-x', 'chrome'], (error, stdout) => resolve(!error && stdout.trim().length > 0));
      return;
    }

    execFile('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(/chrome\.exe/i.test(stdout));
    });
  });
}

/** Pregunta al endpoint de depuración si ya hay algo escuchando. */
async function hayDepuracion() {
  try {
    const respuesta = await fetch(`${ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return respuesta.ok;
  } catch {
    return false;
  }
}

/** Espera a que el puerto de depuración responda. */
async function esperarDepuracion(limiteMs = 20_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (await hayDepuracion()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Lanza el Chrome del usuario con depuración remota sobre su perfil real.
 * Devuelve `{ ok }` o `{ ok: false, error }` con el motivo.
 */
async function lanzarChrome() {
  const exe = await rutaDeChrome();
  if (!exe) return { ok: false, error: 'No encontré Chrome instalado en este equipo.' };

  if (await hayDepuracion()) return { ok: true, yaEstaba: true };

  if (await chromeAbierto()) {
    return {
      ok: false,
      error:
        'Chrome está abierto. Ciérralo del todo y vuelve a intentarlo: una instancia en marcha ' +
        'ignora la bandera de depuración.',
    };
  }

  try {
    procesoLanzado = spawn(
      exe,
      [`--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfilDeUsuario()}`],
      { detached: true, stdio: 'ignore' },
    );
    procesoLanzado.unref();
  } catch (error) {
    return { ok: false, error: `No se pudo lanzar Chrome: ${error.message}` };
  }

  const listo = await esperarDepuracion();
  if (!listo) {
    return {
      ok: false,
      error:
        'Chrome arrancó pero el puerto de depuración no respondió. Puede que una política del ' +
        'equipo lo bloquee.',
    };
  }

  return { ok: true, yaEstaba: false };
}

/** Conecta al primer destino de tipo page y guarda el cliente. */
async function conectar() {
  if (clienteCdp) return clienteCdp;

  const { connectToPage } = await import('../dist/editor/cdp.js');
  clienteCdp = await connectToPage(ENDPOINT);
  return clienteCdp;
}

/** Ejecuta JS en la pestaña activa del Chrome del usuario. */
async function evaluar(script) {
  const cliente = await conectar();
  // El cliente ya lanza si la página devuelve una excepción.
  return cliente.evaluate(script, { awaitPromise: true });
}

/** Navega la pestaña activa. */
async function navegar(url) {
  const cliente = await conectar();
  await cliente.send('Page.navigate', { url });
}

/** Estado actual de la conexión con el Chrome del usuario. */
async function estado() {
  const exe = await rutaDeChrome();
  const abierto = await chromeAbierto();
  const depuracion = await hayDepuracion();

  return {
    instalado: Boolean(exe),
    chromeAbierto: abierto,
    depuracion,
    conectado: Boolean(clienteCdp) && depuracion,
  };
}

/** Suelta el cliente CDP sin cerrar el navegador del usuario. */
function desconectar() {
  try {
    clienteCdp?.close?.();
  } catch {
    // ya cerrado
  }
  clienteCdp = null;
}

module.exports = {
  PUERTO,
  ENDPOINT,
  rutaDeChrome,
  perfilDeUsuario,
  chromeAbierto,
  hayDepuracion,
  lanzarChrome,
  conectar,
  evaluar,
  navegar,
  estado,
  desconectar,
};
