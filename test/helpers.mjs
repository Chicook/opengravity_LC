// Utilidades compartidas por los tests.
//
// El proyecto mezcla CJS (`electron/*.cjs`) con ESM compilado (`dist/*.js`), así que
// los tests son ESM y cargan los CJS con `createRequire` para no depender de cómo
// resuelve Node los exports de CommonJS.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const require = createRequire(import.meta.url);
export const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Carga un módulo de `electron/` por nombre, sin la extensión. */
export function modulo(nombre) {
  return require(path.join(raiz, 'electron', `${nombre}.cjs`));
}

/** Crea un directorio temporal y devuelve su ruta y una función para limpiarlo. */
export function temporal(prefijo = 'opengravity-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefijo}-`));
  return {
    dir,
    limpiar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Escribe un fichero creando las carpetas que falten. */
export function escribir(ruta, contenido) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido, 'utf8');
  return ruta;
}

/**
 * Recarga un módulo CJS desde cero, para simular un reinicio de la app.
 *
 * Se borran también sus dependencias directas si se pasan, porque un módulo que
 * guarda estado en otro (como la trayectoria con sus snapshots) no se reinicia de
 * verdad si su dependencia sigue cacheada.
 */
export function recargar(nombre, dependencias = []) {
  const rutas = [nombre, ...dependencias].map((n) => require.resolve(path.join(raiz, 'electron', `${n}.cjs`)));
  for (const ruta of rutas) delete require.cache[ruta];
  return modulo(nombre);
}
