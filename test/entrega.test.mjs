/**
 * Entrega: lo que se distribuye tiene que poder justificarse.
 *
 * Tres reglas que ya se rompieron una vez y no deben romperse en silencio:
 * las fuentes viajan con su licencia, el verificador de paquete existe y sabe a
 * qué atenerse, y el documento de estado sigue ahí con lo que falta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const leer = (p) => readFileSync(p, 'utf8');

test('las fuentes que se distribuyen van con la licencia OFL al lado', () => {
  const fuentes = readdirSync('assets/fonts').filter((n) => n.endsWith('.woff2'));
  assert.ok(fuentes.length > 0, 'debe haber fuentes');

  assert.ok(existsSync('assets/fonts/OFL.txt'), 'falta assets/fonts/OFL.txt');
  const licencia = leer('assets/fonts/OFL.txt');
  assert.match(licencia, /SIL OPEN FONT LICENSE Version 1\.1/);
  // La OFL pide que viaje el texto, no solo una mención.
  assert.match(licencia, /PERMISSION & CONDITIONS/);
  assert.ok(statSync('assets/fonts/OFL.txt').size > 3000, 'la licencia no puede ser un resumen');
});

test('los ejecutables de windows incluyen la carpeta de fuentes', () => {
  const paquete = JSON.parse(leer('package.json'));
  const ficheros = paquete.build?.files ?? [];
  assert.ok(
    ficheros.some((g) => g.startsWith('assets/')),
    'sin assets/**/* el instalador saldría sin fuentes ni iconos',
  );
  assert.equal(paquete.license, 'MIT');
});

test('existe una comprobación de entrega y está enlazada en el README', () => {
  const paquete = JSON.parse(leer('package.json'));
  const script = paquete.scripts?.['verify:release'];
  assert.ok(script, 'falta npm run verify:release');
  const ruta = script.replace(/^node\s+/, '').trim();
  assert.ok(existsSync(ruta), 'el script de verificación no existe: ' + ruta);
  assert.match(leer('README.md'), /verify:release/);
});

test('el verificador compara contenido, no nombres ni fechas', () => {
  // Dentro de un asar los nombres son un árbol, no rutas completas: buscar
  // 'dist/agent/loop.js' como texto falla aunque el fichero esté. Lo único
  // fiable es comparar bytes, y esa es la regla que dejamos escrita.
  const codigo = leer('scripts/verificar-entrega.mjs');
  assert.match(codigo, /includes\(contenido\)/);
  assert.match(codigo, /\.d\.ts/, 'los .d.ts son tipos y no deben contar como código que falta');
});

test('el documento de estado dice qué falta, no solo lo que va bien', () => {
  assert.ok(existsSync('docs/estado.md'));
  const estado = leer('docs/estado.md');
  // Los tres bloqueos reales, por nombre, para que nadie los olvide.
  assert.match(estado, /confinad/i, 'debe nombrar el acceso a ficheros sin confinar');
  assert.match(estado, /firma|firmad/i, 'debe nombrar la falta de firma');
  assert.match(estado, /no al 100 %|no al 100%/i, 'debe responder sin adornos');
  assert.match(leer('README.md'), /docs\/estado\.md/);
});
