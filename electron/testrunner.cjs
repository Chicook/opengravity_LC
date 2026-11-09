// Detección de framework de tests y lectura de su salida.
//
// Es la parte del runner que se puede probar sin arrancar Electron: detectar qué
// comando lanzar y entender qué dijo. El disparo y la UI viven en main.cjs.
//
// No pretende cubrir todos los frameworks: cubre los que la gente usa de verdad y,
// cuando no reconoce la salida, devuelve `null` en vez de inventar cifras.

const fsp = require('node:fs/promises');
const path = require('node:path');

/** Frameworks conocidos, en orden de prioridad. */
const FRAMEWORKS = [
  {
    id: 'node',
    nombre: 'node:test',
    // El script de npm manda: si el proyecto ya define cómo se prueban, se respeta.
    comando: 'npm test',
    senal: (pkg) => typeof pkg?.scripts?.test === 'string' && pkg.scripts.test.includes('node --test'),
  },
  {
    id: 'vitest',
    nombre: 'Vitest',
    comando: 'npx vitest run',
    senal: (pkg) => Boolean(pkg?.devDependencies?.vitest ?? pkg?.dependencies?.vitest),
  },
  {
    id: 'jest',
    nombre: 'Jest',
    comando: 'npx jest',
    senal: (pkg) => Boolean(pkg?.devDependencies?.jest ?? pkg?.dependencies?.jest),
  },
  {
    id: 'mocha',
    nombre: 'Mocha',
    comando: 'npx mocha',
    senal: (pkg) => Boolean(pkg?.devDependencies?.mocha ?? pkg?.dependencies?.mocha),
  },
  {
    id: 'pytest',
    nombre: 'pytest',
    comando: 'python -m pytest -q',
    senal: null,
  },
  {
    id: 'cargo',
    nombre: 'cargo test',
    comando: 'cargo test',
    senal: null,
  },
  {
    id: 'go',
    nombre: 'go test',
    comando: 'go test ./...',
    senal: null,
  },
];

/** ¿Existe el fichero? */
async function existe(ruta) {
  try {
    await fsp.access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Lee y parsea un JSON, o devuelve null si no está. */
async function leerJson(ruta) {
  try {
    return JSON.parse(await fsp.readFile(ruta, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Detecta cómo se corren los tests en un proyecto.
 *
 * Devuelve `{ id, nombre, comando, motivo }` o `null` si no encuentra nada.
 */
async function detectarFramework(workspace) {
  if (!workspace) return null;

  const pkg = await leerJson(path.join(workspace, 'package.json'));

  if (pkg) {
    // Si hay script de test, es la respuesta correcta aunque no sepamos el framework.
    for (const framework of FRAMEWORKS) {
      if (framework.senal && framework.senal(pkg)) {
        return {
          id: framework.id,
          nombre: framework.nombre,
          comando: framework.comando,
          motivo: `detectado en package.json`,
        };
      }
    }

    if (typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim().length > 0 && !pkg.scripts.test.includes('no test specified')) {
      return {
        id: 'script',
        nombre: 'script de npm',
        comando: 'npm test',
        motivo: 'el proyecto define scripts.test',
      };
    }
  }

  if ((await existe(path.join(workspace, 'pyproject.toml'))) || (await existe(path.join(workspace, 'pytest.ini')))) {
    return { id: 'pytest', nombre: 'pytest', comando: 'python -m pytest -q', motivo: 'hay configuración de pytest' };
  }

  if (await existe(path.join(workspace, 'Cargo.toml'))) {
    return { id: 'cargo', nombre: 'cargo test', comando: 'cargo test', motivo: 'hay Cargo.toml' };
  }

  if (await existe(path.join(workspace, 'go.mod'))) {
    return { id: 'go', nombre: 'go test', comando: 'go test ./...', motivo: 'hay go.mod' };
  }

  return null;
}

/** Quita códigos de color ANSI, que rompen cualquier parseo. */
function sinColores(texto) {
  return String(texto ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

/** Busca el primer número que siga a una etiqueta. */
function numeroTras(texto, patron) {
  const coincidencia = texto.match(patron);
  if (!coincidencia) return null;
  const valor = Number(coincidencia[1]);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Extrae el resumen de la salida de un runner.
 *
 * Devuelve `{ pasan, fallan, total, fallos: [{ nombre, detalle }], reconocido }`.
 * `reconocido` en false significa que no supimos leer la salida: es distinto de
 * "0 fallos", y el llamante debe tratarlo como desconocido.
 */
function parsearSalida(salida) {
  const texto = sinColores(salida);
  const fallos = [];

  // --- Recuentos -----------------------------------------------------------
  const candidatos = [
    // node:test / tap
    () => ({
      pasan: numeroTras(texto, /^#\s*pass\s+(\d+)/m),
      fallan: numeroTras(texto, /^#\s*fail\s+(\d+)/m),
    }),
    // vitest / jest: "Tests: 3 failed, 184 passed" o "Tests  3 failed | 184 passed"
    // Se exige la línea que empieza por "Tests" para no confundirla con "Test Files".
    () => {
      const linea = texto.match(/^\s*Tests[:\s].*$/m);
      if (!linea) return { pasan: null, fallan: null };
      return {
        pasan: numeroTras(linea[0], /(\d+)\s+passed/),
        fallan: numeroTras(linea[0], /(\d+)\s+failed/),
      };
    },
    // mocha: "184 passing" / "3 failing"
    () => ({
      pasan: numeroTras(texto, /^\s*(\d+)\s+passing/m),
      fallan: numeroTras(texto, /^\s*(\d+)\s+failing/m),
    }),
    // pytest: la línea final "===== 184 passed, 3 failed in 2.31s ====="
    () => {
      const linea = texto.match(/(\d+)\s+passed(?:[^\n]*?in [\d.]+s)/);
      if (!linea) return { pasan: null, fallan: null };
      const fallan = texto.match(/(\d+)\s+failed[^\n]*?in [\d.]+s/);
      return { pasan: Number(linea[1]), fallan: fallan ? Number(fallan[1]) : 0 };
    },
    // cargo: "test result: ok. 5 passed; 0 failed"
    () => ({
      pasan: numeroTras(texto, /(\d+)\s+passed;/),
      fallan: numeroTras(texto, /(\d+)\s+failed;/),
    }),
  ];

  let pasan = null;
  let fallan = null;
  for (const intento of candidatos) {
    const resultado = intento();
    if (resultado.pasan !== null || resultado.fallan !== null) {
      pasan = resultado.pasan ?? 0;
      fallan = resultado.fallan ?? 0;
      break;
    }
  }

  // --- Fallos concretos ----------------------------------------------------
  // node:test: "not ok 3 - nombre del test"
  for (const coincidencia of texto.matchAll(/^not ok\s+\d+\s+-\s+(.+)$/gm)) {
    fallos.push({ nombre: coincidencia[1].trim().slice(0, 300), detalle: '' });
  }

  // vitest / jest: "✕ nombre" o "× nombre"
  if (fallos.length === 0) {
    for (const coincidencia of texto.matchAll(/^\s*[✕×]\s+(.+)$/gm)) {
      fallos.push({ nombre: coincidencia[1].trim().slice(0, 300), detalle: '' });
    }
  }

  // go: "--- FAIL: TestNombre"
  if (fallos.length === 0) {
    for (const coincidencia of texto.matchAll(/^\s*---\s+FAIL:\s+(\S+)/gm)) {
      fallos.push({ nombre: coincidencia[1], detalle: '' });
    }
  }

  return {
    pasan,
    fallan,
    total: pasan !== null && fallan !== null ? pasan + fallan : null,
    fallos: fallos.slice(0, 50),
    reconocido: pasan !== null || fallan !== null,
  };
}

/**
 * Decide si una ejecución fue bien.
 *
 * Se fía del código de salida antes que del texto: un runner puede imprimir un
 * resumen incompleto y aun así terminar con 0.
 */
function exito(codigoSalida, resumen) {
  if (Number(codigoSalida) !== 0) return false;
  if (resumen && resumen.fallan && resumen.fallan > 0) return false;
  return true;
}

/** Resumen en una línea, para mostrarlo en la UI. */
function resumirLinea(resumen, codigoSalida) {
  if (!resumen || !resumen.reconocido) {
    return Number(codigoSalida) === 0 ? 'Tests: sin resumen reconocible' : `Tests: falló (código ${codigoSalida})`;
  }
  const partes = [`${resumen.pasan} pasan`];
  if (resumen.fallan && resumen.fallan > 0) partes.push(`${resumen.fallan} fallan`);
  return `Tests: ${partes.join(', ')}`;
}

module.exports = { detectarFramework, parsearSalida, exito, resumirLinea, sinColores };
