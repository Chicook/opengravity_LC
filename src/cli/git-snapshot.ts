/**
 * Snapshot mínimo para `run_command`.
 *
 * Un comando de shell puede cambiar ficheros que no sabemos de antemano. En un
 * repo git usamos `git stash create` (no toca el working tree) como foto de los
 * ficheros seguidos y copiamos el contenido de los no seguidos antes de correr.
 * Al terminar, anotamos en la trayectoria solo lo que cambió.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

export interface GitSnapshot {
  /** Commit temporal con el estado de los ficheros seguidos, o null si no hay. */
  base: string | null;
  /** Contenido anterior de los ficheros no seguidos. */
  noSeguidos: Map<string, string>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await ejecutar('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function listaNul(texto: string): string[] {
  return texto.split('\0').map((ruta) => ruta.trim()).filter(Boolean);
}

/** Un snapshot de texto no puede restaurar binarios sin corromperlos. */
function esBinario(texto: string): boolean {
  return texto.includes('\0');
}

/** Prepara la foto. Devuelve null si no es un repo utilizable. */
export async function prepararSnapshotGit(cwd: string): Promise<GitSnapshot | null> {
  try {
    const dentro = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (dentro !== 'true') return null;

    const stash = (await git(cwd, ['stash', 'create'])).trim();
    let base: string | null = stash.length > 0 ? stash : null;
    if (!base) {
      try {
        base = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
      } catch {
        base = null;
      }
    }

    const noSeguidos = new Map<string, string>();
    try {
      const salida = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
      for (const ruta of listaNul(salida)) {
        if (noSeguidos.size >= 200) break;
        try {
          const contenido = await readFile(resolve(cwd, ruta), 'utf8');
          if (contenido.length <= 2_000_000 && !esBinario(contenido)) {
            noSeguidos.set(ruta, contenido);
          }
        } catch {
          // Un fichero que no se puede leer no se puede restaurar; se omite.
        }
      }
    } catch {
      // Sin lista de no seguidos se sigue con los seguidos.
    }

    return { base, noSeguidos };
  } catch {
    return null;
  }
}

/**
 * Anota en la trayectoria los ficheros que el comando cambió.
 * Devuelve cuántos snapshots añadió.
 */
export async function anotarCambiosGit(
  snapshot: GitSnapshot,
  cwd: string,
  conversacion: string,
  llamadaId: string | undefined,
  trayectoria: {
    anotarEscritura: (
      conversacion: string,
      ruta: string,
      contenido: string | null,
      llamadaId?: string,
    ) => boolean;
  },
): Promise<number> {
  let anotados = 0;
  const anotar = (ruta: string, contenido: string | null) => {
    if (trayectoria.anotarEscritura(conversacion, resolve(cwd, ruta), contenido, llamadaId)) {
      anotados += 1;
    }
  };

  if (snapshot.base) {
    try {
      const salida = await git(cwd, ['diff', '--name-only', snapshot.base]);
      for (const ruta of salida.split('\n').map((linea) => linea.trim()).filter(Boolean)) {
        let anterior: string | null = null;
        try {
          anterior = await git(cwd, ['show', `${snapshot.base}:${ruta}`]);
        } catch {
          // El fichero no existía en la foto: el revert lo borra.
        }
        if (anterior === null || !esBinario(anterior)) anotar(ruta, anterior);
      }
    } catch {
      // Si git falla después del comando, no se inventa una restauración.
    }
  }

  // Ficheros no seguidos: los que había antes se comparan, los nuevos se borran.
  let despues = new Set<string>();
  try {
    const salida = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
    despues = new Set(listaNul(salida));
  } catch {
    // sin lista no se tocan los no seguidos
  }

  for (const [ruta, anterior] of snapshot.noSeguidos) {
    let actual: string | null = null;
    try {
      actual = await readFile(resolve(cwd, ruta), 'utf8');
    } catch {
      actual = null;
    }
    if (actual !== anterior) anotar(ruta, anterior);
  }
  for (const ruta of despues) {
    if (!snapshot.noSeguidos.has(ruta)) anotar(ruta, null);
  }

  return anotados;
}
