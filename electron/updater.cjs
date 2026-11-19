'use strict';

/**
 * Actualizaciones desde GitHub Releases.
 *
 * `electron-updater` descarga el NSIS y verifica el sha512 de `latest.yml`.
 * Aquí solo se expone un estado pequeño a la UI y se decide cuándo comprobar,
 * descargar e instalar. Sin telemetría y sin red fuera de GitHub.
 */

const { app, shell } = require('electron');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { notasDe, esPortable, porcentaje } = require('./update-utils.cjs');

const RELEASE_URL = 'https://github.com/dario90vlc/opengravity/releases/latest';
const SIX_HOURS = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let onState = () => {};
let timer = null;
let checkTimer = null;

const state = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseName: null,
  releaseNotes: null,
  progress: 0,
  error: null,
  portable: false,
};

/** Copia serializable del estado. */
function snapshot() {
  return { ...state };
}

function publicar(parcial = {}) {
  Object.assign(state, parcial);
  onState(snapshot());
}

/** Verifica la huella SHA-256 publicada además del sha512 de latest.yml. */
async function verificarSha256(info) {
  const archivo = info?.downloadedFile;
  const version = info?.version;
  if (!archivo || !version) throw new Error('el actualizador no indicó el fichero descargado');

  const base = String(process.env.OPENGRAVITY_UPDATE_URL ?? '').replace(/\/+$/, '');
  const checksumsUrl = base
    ? `${base}/SHA256SUMS.txt`
    : `https://github.com/dario90vlc/opengravity/releases/download/v${version}/SHA256SUMS.txt`;
  const respuesta = await fetch(checksumsUrl, { headers: { Accept: 'text/plain' } });
  if (!respuesta.ok) throw new Error(`no se pudo leer SHA256SUMS.txt (${respuesta.status})`);
  const lineas = (await respuesta.text()).split(/\r?\n/);
  const archivoInfo = info?.files?.[0];
  const urlInfo = archivoInfo?.url ? new URL(archivoInfo.url, 'https://github.com').pathname : '';
  const nombreInstalador = path.basename(
    String(archivoInfo?.name ?? (urlInfo ? decodeURIComponent(path.basename(urlInfo)) : '')),
  );
  const candidata = lineas.find((linea) => {
    if (!/^[a-f0-9]{64}\s+/i.test(linea)) return false;
    if (nombreInstalador && linea.includes(nombreInstalador)) return true;
    return linea.includes(`Setup ${version}`) || linea.includes(`Opengravity ${version}`);
  });
  if (!candidata) throw new Error('SHA256SUMS.txt no contiene este instalador');
  const esperado = candidata.slice(0, 64).toLowerCase();
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(archivo);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const real = hash.digest('hex');
  if (real !== esperado) throw new Error('la huella SHA-256 del instalador no coincide');
}

/** Configura los eventos. En desarrollo o portable no se descarga nada. */
function configurar(handlers = {}) {
  onState = typeof handlers.onState === 'function' ? handlers.onState : () => {};
  publicar({ currentVersion: app.getVersion() });

  if (!app.isPackaged) {
    publicar({ status: 'development' });
    return snapshot();
  }

  if (process.platform !== 'win32') {
    publicar({ status: 'unsupported' });
    return snapshot();
  }

  if (esPortable()) {
    publicar({ status: 'portable', portable: true });
    return snapshot();
  }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    publicar({ status: 'error', error: `No se pudo cargar el actualizador: ${error?.message ?? error}` });
    return snapshot();
  }

  /*
   * Solo test local: permite apuntar a un feed genérico sin publicar una
   * release. En producción se usa app-update.yml (GitHub).
   */
  if (process.env.OPENGRAVITY_UPDATE_URL) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: String(process.env.OPENGRAVITY_UPDATE_URL),
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.fullChangelog = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    publicar({ status: 'checking', error: null });
  });
  autoUpdater.on('update-available', (info) => {
    publicar({
      status: 'available',
      availableVersion: info?.version ?? null,
      releaseName: info?.releaseName ?? null,
      releaseNotes: notasDe(info),
      progress: 0,
      error: null,
    });
  });
  autoUpdater.on('update-not-available', () => {
    publicar({
      status: 'up-to-date',
      availableVersion: null,
      releaseName: null,
      releaseNotes: null,
      progress: 0,
      error: null,
    });
  });
  autoUpdater.on('download-progress', (info) => {
    publicar({ status: 'downloading', progress: porcentaje(info?.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publicar({
      status: 'verifying',
      availableVersion: info?.version ?? state.availableVersion,
      progress: 100,
      error: null,
    });
    void verificarSha256(info)
      .then(() => {
        publicar({
          status: 'downloaded',
          availableVersion: info?.version ?? state.availableVersion,
          progress: 100,
          error: null,
        });
      })
      .catch((error) => {
        publicar({ status: 'error', error: String(error?.message ?? error) });
      });
  });
  autoUpdater.on('error', (error) => {
    publicar({ status: 'error', error: String(error?.message ?? error ?? 'error de actualización') });
  });

  const comprobar = () => {
    if (state.status === 'checking' || state.status === 'downloading') return;
    if (state.status === 'available' || state.status === 'downloaded') return;
    void check();
  };

  checkTimer = setTimeout(comprobar, 5000);
  checkTimer.unref?.();
  timer = setInterval(comprobar, SIX_HOURS);
  timer.unref?.();

  return snapshot();
}

async function check() {
  if (!autoUpdater) return snapshot();
  if (state.status === 'checking' || state.status === 'downloading') return snapshot();
  try {
    publicar({ status: 'checking', error: null });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publicar({ status: 'error', error: String(error?.message ?? error ?? 'error de actualización') });
  }
  return snapshot();
}

async function download() {
  if (!autoUpdater) return snapshot();
  if (state.status !== 'available' && state.status !== 'downloaded') return snapshot();
  if (state.status === 'downloaded') return snapshot();
  try {
    publicar({ status: 'downloading', progress: 0, error: null });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publicar({ status: 'error', error: String(error?.message ?? error ?? 'error de descarga') });
  }
  return snapshot();
}

function install() {
  if (!autoUpdater || state.status !== 'downloaded') return snapshot();
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    publicar({ status: 'error', error: String(error?.message ?? error ?? 'error al instalar') });
  }
  return snapshot();
}

function openRelease() {
  void shell.openExternal(RELEASE_URL);
}

function getState() {
  return snapshot();
}

function stop() {
  if (timer) clearInterval(timer);
  if (checkTimer) clearTimeout(checkTimer);
  timer = null;
  checkTimer = null;
}

module.exports = { configurar, check, download, install, openRelease, getState, stop, esPortable, RELEASE_URL };
