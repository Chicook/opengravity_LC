/**
 * Comprueba si el paquete de release/ se puede entregar tal cual.
 *
 * Responde con hechos, no con una opinión: ¿el .exe lleva dentro el código de
 * hoy? ¿está firmado? ¿están las fuentes con su licencia? Sale con código 0
 * solo si todo lo que se puede comprobar aquí está bien.
 *
 * Trampa que ya nos costó un susto: dentro de un asar los nombres son un árbol,
 * no rutas completas, así que buscar 'dist/agent/loop.js' como texto falla
 * aunque el fichero esté. Lo fiable es comparar los BYTES de cada fichero.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const ASAR = 'release/win-unpacked/resources/app.asar';
const paquete = JSON.parse(readFileSync('package.json', 'utf8'));
const EXEs = [`release/Opengravity-Setup-${paquete.version}.exe`, `release/Opengravity-${paquete.version}.exe`];

const problemas = [];
const avisos = [];
const bien = [];

function apuntar(lista, texto) {
  lista.push(texto);
  const marca = lista === bien ? 'OK ' : lista === avisos ? 'AVISO' : 'FALLO';
  console.log(marca + '  ' + texto);
}

/** Todos los ficheros de una carpeta, sin seguir enlaces. */
function recorrer(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) recorrer(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

/** Los directorios que electron-builder copia al asar. */
const desempaquetados = (paquete.build?.asarUnpack ?? []).map((g) => g.replace(/\\/g, '/'));

/*
 * Los .d.ts son declaraciones de tipos: describen el código para el editor y
 * no los carga nadie al ejecutar la app. Se cuentan aparte para no dar un falso
 * "falta código" (nos pasó: 25 de los 152 ficheros eran .d.ts).
 */
let declaraciones = 0;

function estaDesempaquetado(ruta) {
  return desempaquetados.some((g) => {
    const base = g.replace('/**/*', '').replace('/*', '');
    return ruta === g || ruta.startsWith(base);
  });
}

if (!existsSync(ASAR)) {
  apuntar(problemas, 'no existe ' + ASAR + ': no hay paquete que comprobar');
} else {
  const asar = readFileSync(ASAR);

  // Lo que debe ir dentro, según package.json -> build.files.
  const candidatos = [];
  for (const carpeta of ['electron', 'dist', 'renderer', 'assets']) {
    candidatos.push(...recorrer(carpeta));
  }

  let dentro = 0;
  const faltan = [];
  for (const f of candidatos) {
    const rel = relative(RAIZ, f).replace(/\\/g, '/');
    if (estaDesempaquetado(rel)) continue;
    if (rel.endsWith('.d.ts')) {
      declaraciones++;
      continue;
    }
    let contenido;
    try {
      contenido = readFileSync(f);
    } catch {
      continue;
    }
    // Un fichero vacío siempre "está": no aporta prueba.
    if (contenido.length === 0) continue;
    if (asar.includes(contenido)) dentro++;
    else faltan.push(rel);
  }

  if (faltan.length === 0) {
    apuntar(
      bien,
      `el asar lleva los ${dentro} ficheros del código, idénticos byte a byte` +
        (declaraciones > 0 ? ` (más ${declaraciones} .d.ts ignorados: son tipos)` : ''),
    );
  } else {
    apuntar(
      problemas,
      `al asar le faltan ${faltan.length} de ${dentro + faltan.length} ficheros: ` +
        faltan.slice(0, 8).join(', ') +
        (faltan.length > 8 ? '…' : ''),
    );
  }

  // Los ejecutables tienen que ser posteriores al asar que envuelven.
  const tAsar = statSync(ASAR).mtimeMs;
  for (const exe of EXEs) {
    if (!existsSync(exe)) {
      apuntar(problemas, 'no existe ' + exe);
      continue;
    }
    const s = statSync(exe);
    if (s.mtimeMs + 1000 < tAsar) {
      apuntar(problemas, exe + ' es anterior al asar: envuelve código viejo');
    } else {
      apuntar(bien, exe + ' (' + Math.round(s.size / 1024) + ' KB) es posterior al asar');
    }

    // Firma Authenticode: el directorio de seguridad del PE (índice 4).
    const pe = readFileSync(exe);
    if (pe.length < 0x40 || pe.readUInt16LE(0) !== 0x5a4d) {
      apuntar(avisos, exe + ': no parece un PE válido');
      continue;
    }
    const lfanew = pe.readUInt32LE(0x3c);
    if (pe.toString('ascii', lfanew, lfanew + 4) !== 'PE\0\0') {
      apuntar(avisos, exe + ': cabecera PE ilegible');
      continue;
    }
    const opcional = lfanew + 24;
    const magia = pe.readUInt16LE(opcional);
    const dirs = opcional + (magia === 0x20b ? 112 : 96);
    const tamFirma = pe.readUInt32LE(dirs + 4 * 8 + 4);
    if (tamFirma === 0) {
      apuntar(
        avisos,
        exe + ': sin firma Authenticode — decisión para una app libre; se publica la huella SHA-256',
      );
    } else {
      apuntar(bien, exe + ': firmado (' + tamFirma + ' bytes de firma)');
    }
  }
}

// Licencia de las fuentes que sí se distribuyen.
const fuentes = recorrer('assets/fonts').filter((f) => f.endsWith('.woff2'));
if (fuentes.length === 0) {
  apuntar(avisos, 'no hay fuentes en assets/fonts');
} else if (!existsSync('assets/fonts/OFL.txt')) {
  apuntar(problemas, `hay ${fuentes.length} fuentes OFL pero falta assets/fonts/OFL.txt`);
} else {
  apuntar(bien, `${fuentes.length} fuentes con assets/fonts/OFL.txt al lado`);
}

/*
 * Sin firma de pago, lo que se puede dar al usuario es la huella del fichero:
 * publicada junto a la release, cualquiera comprueba que su descarga es la
 * nuestra y que no se ha tocado por el camino. Es lo que hace el software libre
 * que no paga un certificado.
 */
const sumas = [];
for (const exe of EXEs) {
  if (!existsSync(exe)) continue;
  const bytes = readFileSync(exe);
  const sha = createHash('sha256').update(bytes).digest('hex');
  sumas.push(`${sha}  ${exe.split('/').pop()}`);
}
if (sumas.length > 0) {
  writeFileSync('release/SHA256SUMS.txt', sumas.join('\n') + '\n', 'utf8');
  apuntar(bien, `huellas SHA-256 escritas en release/SHA256SUMS.txt (${sumas.length} ficheros)`);
  for (const linea of sumas) console.log('       ' + linea);
}

// El motor compilado, no solo el TypeScript.
for (const obligatorio of ['dist/index.js', 'dist/agent/loop.js']) {
  if (existsSync(obligatorio)) apuntar(bien, 'compilado: ' + obligatorio);
  else apuntar(problemas, 'falta el compilado ' + obligatorio + ' (npm run build)');
}

console.log('');
console.log(`Resumen: ${bien.length} bien, ${avisos.length} avisos, ${problemas.length} problemas`);
if (problemas.length > 0) {
  console.log('VEREDICTO: NO se puede entregar todavía.');
  process.exit(1);
}
if (avisos.length > 0) {
  console.log('VEREDICTO: entregable, con lo avisado a la vista.');
} else {
  console.log('VEREDICTO: entregable.');
}
