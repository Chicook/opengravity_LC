/**
 * Guardia contra las tres regresiones que más se han repetido en este proyecto:
 *
 *  1. Una variable CSS autorreferente (`--x: var(--x)`) se resuelve a vacío y deja
 *     el elemento sin estilo, sin ningún error visible.
 *  2. Un `var(--token)` con una errata no falla: cae al valor inicial en silencio.
 *  3. Un literal oscuro fuera de `:root` sin override para el tema claro se queda
 *     oscuro sobre fondo claro.
 *
 * El tercero se ha arreglado varias veces a mano; aquí queda fijado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CSS = new URL('../renderer/styles.css', import.meta.url);

/**
 * Literales oscuros legítimos: no dependen del tema.
 *
 * Cada uno tiene que llevar su motivo, porque una lista de excepciones sin
 * explicación se convierte en un cajón donde esconder el fallo siguiente.
 */
const EXCEPCIONES = new Map([
  // Rojo fijo de la X de cerrar de Windows. No es un color del tema.
  ['#c42b1c', 'rojo de la X de cerrar de Windows: es fijo, no del tema'],
  // `#000` en un gradiente de máscara significa «opaco», no «negro».
  ['#000', 'en mask-image, negro significa opaco: no es un color'],
]);

/** Texto sin comentarios, conservando los saltos de línea para poder situar líneas. */
async function leerSinComentarios() {
  const crudo = await readFile(CSS, 'utf8');
  return crudo.replace(/\/\*[\s\S]*?\*\//g, (m) => ' ' + '\n'.repeat(m.split('\n').length - 1));
}

/** Luminancia aproximada de un hex; null si no es un hex de 3 o 6 dígitos. */
function luminancia(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pares selector/cuerpo de todas las reglas. */
function reglas(css) {
  const salida = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    salida.push({ selector: m[1].trim().replace(/\s+/g, ' '), cuerpo: m[2] });
  }
  return salida;
}

/** Nombre de la regla sin el prefijo de tema, para emparejar claro con oscuro. */
function selectorBase(selector) {
  return selector.replace(/:root\[data-theme='light'\]\s*/g, '').trim();
}

/**
 * Parte una lista de selectores en sus partes.
 *
 * Comparar la lista entera da falsos positivos: una regla
 * `.a, .b { }` y su override `.a { }` sí se corresponden.
 */
function partes(selector) {
  return selector.split(',').map((s) => selectorBase(s.trim())).filter(Boolean);
}

test('ninguna variable CSS se declara con referencia a sí misma', async () => {
  const css = await leerSinComentarios();
  const malas = [];

  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const nombre = m[1];
    const valor = m[2];
    if (new RegExp(`var\\(\\s*${nombre}(?![a-z0-9-])`).test(valor)) {
      malas.push(`${nombre}: ${valor.trim()}`);
    }
  }

  assert.deepEqual(malas, [], `variables autorreferentes:\n  ${malas.join('\n  ')}`);
});

test('todo var() apunta a un token declarado en algún sitio', async () => {
  const css = await leerSinComentarios();

  /*
   * Ojo: `.sidebar__action--accent:hover` parece una declaración y no lo es. Una
   * declaración vive al principio de una sentencia, dentro del cuerpo de la regla.
   */
  const declarados = new Set();
  for (const m of css.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
    for (const sentencia of m[1].split(';')) {
      const t = sentencia.match(/^\s*(--[a-z0-9-]+)\s*:/);
      if (t) declarados.add(t[1]);
    }
  }

  const huerfanas = new Set();
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
    // Con respaldo (`var(--x, algo)`) un token ausente no rompe nada.
    if (m[2] === ')' && !declarados.has(m[1])) huerfanas.add(m[1]);
  }

  assert.deepEqual(
    [...huerfanas],
    [],
    `var() sobre tokens que no existen (una errata aquí no da error, se ignora):\n  ${[...huerfanas].join('\n  ')}`,
  );
});

test('todo literal oscuro fuera de :root tiene su versión de tema claro', async () => {
  const css = await leerSinComentarios();
  const todas = reglas(css);

  // Selectores que el tema claro redefine.
  const claros = new Set(
    todas.filter((r) => r.selector.includes("data-theme='light'")).flatMap((r) => partes(r.selector)),
  );

  const sinOverride = [];
  for (const { selector, cuerpo } of todas) {
    if (selector.startsWith(':root')) continue;

    for (const hex of cuerpo.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const valor = hex[0].toLowerCase();
      const l = luminancia(valor);
      if (l === null || l >= 0.35) continue;
      if (EXCEPCIONES.has(valor)) continue;
      if (partes(selector).some((p) => claros.has(p))) continue;

      sinOverride.push(`${valor} en «${selector}»`);
    }
  }

  assert.deepEqual(
    sinOverride,
    [],
    'literales oscuros que se quedarían oscuros en el tema claro ' +
      '(dale un token, o añade el override claro, o justifícalo en EXCEPCIONES):\n  ' +
      sinOverride.join('\n  '),
  );
});

test('las excepciones de color están justificadas y siguen existiendo', async () => {
  const css = await leerSinComentarios();

  for (const [color, motivo] of EXCEPCIONES) {
    assert.ok(motivo.length > 10, `la excepción ${color} no explica por qué lo es`);
    assert.ok(
      css.toLowerCase().includes(color),
      `la excepción ${color} ya no aparece en el CSS: quítala de la lista`,
    );
  }
});

/*
 * Aquí hubo una quinta prueba que marcaba overrides claros «sin regla base». Se
 * quitó porque mentía: en CSS un selector más específico o descendiente es válido
 * sin que exista la regla base. Marcaba `aside.sidebar` como muerto cuando solo
 * sube la especificidad de `.sidebar`, y no hay forma fiable de distinguirlo sin
 * un motor de selectores. Una prueba que da falsos positivos acaba desactivada.
 */
