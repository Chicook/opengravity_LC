'use strict';

/**
 * Sandbox de procesos, fase 2.
 *
 * Windows usa un Job Object (sandbox-win.ps1) para limitar memoria y número de
 * procesos y para terminar el árbol cuando el comando o la app desaparecen.
 * POSIX usa un grupo de procesos propio y `ulimit` (memoria, CPU y procesos).
 * No hay servicios ni dependencias externas: solo APIs del sistema.
 */

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

/**
 * Convierte una ruta dentro de app.asar a su copia desempaquetada.
 *
 * Los ficheros de sandbox están en `asarUnpack`: Node los puede leer por la ruta
 * del asar, pero PowerShell y csc son procesos externos y necesitan la ruta
 * real de `app.asar.unpacked`.
 */
function fueraDelAsar(ruta) {
  return ruta.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

const GUARD_WIN = fueraDelAsar(path.join(__dirname, 'sandbox-win.ps1'));
const FUENTE_HELPER = fueraDelAsar(path.join(__dirname, 'sandbox-run.cs'));

let helperPromesa = null;

function rutaCsc() {
  const windows = process.env.WINDIR ?? 'C:\\Windows';
  for (const base of ['Framework64', 'Framework']) {
    const candidato = path.join(windows, 'Microsoft.NET', base, 'v4.0.30319', 'csc.exe');
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

/**
 * Compila (una vez) el lanzador nativo y devuelve su ruta.
 *
 * Se compila en un directorio temporal sin espacios y con rutas relativas: el
 * csc de Windows se rompe con rutas absolutas que contienen espacios. Si no hay
 * csc o falla la compilación, devuelve null y el llamador usa el guard PowerShell.
 */
function obtenerHelperWin() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (helperPromesa) return helperPromesa;

  helperPromesa = (async () => {
    const dir = path.join(os.tmpdir(), 'opengravity-sandbox');
    const fuente = path.join(dir, 'sandbox-run.cs');
    const exe = path.join(dir, 'og-sandbox.exe');

    try {
      await fsp.mkdir(dir, { recursive: true });
      const origenStat = await fsp.stat(FUENTE_HELPER);
      let exeStat = null;
      try {
        exeStat = await fsp.stat(exe);
      } catch {
        exeStat = null;
      }

      if (!exeStat || exeStat.mtimeMs < origenStat.mtimeMs) {
        // readFile/writeFile funciona dentro del asar; copyFile no siempre.
        const codigo = await fsp.readFile(FUENTE_HELPER);
        await fsp.writeFile(fuente, codigo);
        const csc = rutaCsc();
        if (!csc) return null;
        const compilado = spawnSync(
          csc,
          ['/nologo', '/optimize+', '/target:exe', '/out:og-sandbox.exe', 'sandbox-run.cs'],
          { cwd: dir, windowsHide: true, timeout: 60_000, encoding: 'utf8' },
        );
        if (compilado.status !== 0) return null;
      }

      return fs.existsSync(exe) ? exe : null;
    } catch {
      return null;
    }
  })();

  return helperPromesa;
}

/** Argumentos del lanzador nativo. El comando va como un único argumento. */
function argumentosHelperWin({ cwd, limites, parentPid, command }) {
  return [
    '--cwd',
    cwd,
    '--memory-mb',
    String(limites.memoryMB),
    '--max-processes',
    String(limites.maxProcesses),
    '--cpu-seconds',
    String(limites.cpuSeconds),
    '--parent-pid',
    String(parentPid),
    '--command',
    command,
  ];
}

/** Límites saneados desde las preferencias. */
function limitesDeSandbox(prefs = {}) {
  const entero = (valor, defecto, min, max) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.min(max, Math.max(min, Math.round(numero))) : defecto;
  };

  return {
    memoryMB: entero(prefs.sandboxMemoryMB, 1024, 64, 16384),
    maxProcesses: entero(prefs.sandboxMaxProcesses, 32, 1, 512),
    cpuSeconds: entero(prefs.sandboxCpuSeconds, 300, 1, 86400),
  };
}

/**
 * Prefijo POSIX para limitar CPU y procesos.
 *
 * No se usa `ulimit -v`: en Linux/macOS limita memoria VIRTUAL y Node/V8
 * reservan varios GB de espacio de direcciones, así que un límite de 1 GB
 * rompe comandos normales. La memoria se limita en Windows con el Job Object;
 * en POSIX haría falta cgroups (fase 3).
 */
function prefijoPosix(limites) {
  return (
    `ulimit -t ${limites.cpuSeconds} 2>/dev/null; ` +
    `ulimit -u ${limites.maxProcesses} 2>/dev/null; `
  );
}

/** Argumentos del guard de Windows. La ruta va como un único argumento. */
function argumentosGuardWin({ pid, parentPid, limites }) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    GUARD_WIN,
    '-TargetPid',
    String(pid),
    '-ParentPid',
    String(parentPid),
    '-MemoryMB',
    String(limites.memoryMB),
    '-MaxProcesses',
    String(limites.maxProcesses),
    '-CpuSeconds',
    String(limites.cpuSeconds),
  ];
}

module.exports = {
  GUARD_WIN,
  limitesDeSandbox,
  prefijoPosix,
  argumentosGuardWin,
  obtenerHelperWin,
  argumentosHelperWin,
};
