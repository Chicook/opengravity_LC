/**
 * Ajustes compartidos con la app.
 *
 * La app guarda `settings.json` en el `userData` de Electron. El CLI lee el
 * mismo fichero: proveedor, modelo, esfuerzo, preferencias de red/permisos y
 * claves que estén en claro. Las claves cifradas con `safeStorage` no se pueden
 * descifrar fuera de Electron; para esas se usan variables de entorno.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export interface PermissionsConfig {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

export interface AppPrefs {
  effort?: string;
  agentMode?: string;
  restrictToWorkspace?: boolean;
  networkRules?: unknown;
  toolPermissions?: Record<string, string>;
  permissions?: PermissionsConfig;
  apiKeys?: Record<string, string>;
  customProviders?: Record<string, { baseUrl?: string; apiKey?: string }>;
  [clave: string]: unknown;
}

export interface AppSettings {
  providerId?: string;
  model?: string;
  prefs?: AppPrefs;
  permissions?: PermissionsConfig;
}

/** Ruta del settings.json de la app. `OPENGRAVITY_SETTINGS` la sustituye. */
export function rutaSettingsApp(): string {
  if (process.env.OPENGRAVITY_SETTINGS) return process.env.OPENGRAVITY_SETTINGS;
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'Opengravity',
      'settings.json',
    );
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Opengravity', 'settings.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Opengravity', 'settings.json');
}

const requerir = createRequire(import.meta.url);

/** Binario de Electron disponible para descifrar con safeStorage. */
function binarioElectron(): string | null {
  const candidatos: string[] = [];
  if (process.env.ELECTRON_PATH) candidatos.push(process.env.ELECTRON_PATH);
  try {
    const electron = requerir('electron');
    if (typeof electron === 'string') candidatos.push(electron);
  } catch {
    // sin paquete electron
  }
  if (process.platform === 'win32') {
    candidatos.push(join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'));
    candidatos.push(join(dirname(process.execPath), 'electron.exe'));
  } else if (process.platform === 'darwin') {
    candidatos.push(join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
  } else {
    candidatos.push(join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron'));
  }
  return candidatos.find((ruta) => existsSync(ruta)) ?? null;
}

/**
 * Descifra `prefs.apiKeysEnc` lanzando el helper bajo Electron.
 * Devuelve null si no hay blob, no hay binario o falla.
 */
export async function descifrarClavesApp(
  ruta = rutaSettingsApp(),
  settings?: AppSettings,
): Promise<Record<string, string> | null> {
  if (!settings?.prefs?.apiKeysEnc) return null;
  const electron = binarioElectron();
  if (!electron) return null;
  const helper = fileURLToPath(new URL('../../electron/decrypt-keys.cjs', import.meta.url));
  if (!existsSync(helper)) return null;

  try {
    const salida = spawnSync(electron, [helper, ruta], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    const linea = String(salida.stdout ?? '').split('\n').find((texto) => texto.startsWith('KEYS:'));
    if (!linea) return null;
    const claves = JSON.parse(linea.slice(5)) as unknown;
    if (!claves || typeof claves !== 'object' || Array.isArray(claves)) return null;
    const limpias: Record<string, string> = {};
    for (const [id, valor] of Object.entries(claves)) {
      if (typeof valor === 'string' && valor.trim().length > 0) limpias[id] = valor.trim();
    }
    return Object.keys(limpias).length > 0 ? limpias : null;
  } catch {
    return null;
  }
}

export async function leerSettingsApp(): Promise<AppSettings> {
  try {
    const crudo = await readFile(rutaSettingsApp(), 'utf8');
    const datos = JSON.parse(crudo.replace(/^\uFEFF/, '')) as AppSettings;
    return datos && typeof datos === 'object' ? datos : {};
  } catch {
    return {};
  }
}

/**
 * Configuración de proveedores para el CLI. Las claves en claro y las
 * descifradas por `descifrarClavesApp` se fusionan; el entorno sigue mandando
 * en los adaptadores.
 */
export function configProveedor(
  settings: AppSettings,
  clavesDescifradas?: Record<string, string> | null,
): {
  apiKeys?: Record<string, string>;
  baseUrls?: Record<string, string>;
} {
  const apiKeys: Record<string, string> = {};
  const baseUrls: Record<string, string> = {};

  for (const [id, clave] of Object.entries(settings.prefs?.apiKeys ?? {})) {
    if (typeof clave === 'string' && clave.trim().length > 0) apiKeys[id] = clave.trim();
  }
  // La copia cifrada la escribió la app con safeStorage; manda sobre una clave
  // en claro antigua que pudiera haber quedado en el mismo fichero.
  Object.assign(apiKeys, clavesDescifradas ?? {});
  for (const [id, entrada] of Object.entries(settings.prefs?.customProviders ?? {})) {
    if (!entrada || typeof entrada !== 'object') continue;
    if (typeof entrada.baseUrl === 'string' && entrada.baseUrl.trim().length > 0) {
      baseUrls[id] = entrada.baseUrl.trim();
    }
    if (typeof entrada.apiKey === 'string' && entrada.apiKey.trim().length > 0) {
      apiKeys[id] = entrada.apiKey.trim();
    }
  }

  return {
    ...(Object.keys(apiKeys).length > 0 ? { apiKeys } : {}),
    ...(Object.keys(baseUrls).length > 0 ? { baseUrls } : {}),
  };
}
