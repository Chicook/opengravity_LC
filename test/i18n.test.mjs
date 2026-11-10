import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load() {
  const codigo = await readFile(new URL('../renderer/i18n-strings.js', import.meta.url), 'utf8');
  const contexto = { window: {} };
  vm.runInNewContext(codigo, contexto);
  return contexto.window;
}

test('el diccionario tiene ambos idiomas y no hay claves contradictorias', async () => {
  const { I18N_STRINGS } = await load();
  assert.ok(Array.isArray(I18N_STRINGS));
  assert.ok(I18N_STRINGS.length >= 550);

  const pares = new Set();
  for (const entrada of I18N_STRINGS) {
    assert.equal(typeof entrada.en, 'string');
    assert.equal(typeof entrada.es, 'string');
    assert.ok(entrada.en.trim().length > 0);
    assert.ok(entrada.es.trim().length > 0);
    const par = `${entrada.en}\u0000${entrada.es}`;
    assert.equal(pares.has(par), false, `par duplicado: ${entrada.en}`);
    pares.add(par);
  }

  for (const necesario of ['Settings', 'New Conversation', 'Language', 'Workspace']) {
    assert.ok(I18N_STRINGS.some((entrada) => entrada.en === necesario), necesario);
  }
});

test('los patrones dinámicos cubren ambos sentidos', async () => {
  const { I18N_PATTERNS } = await load();
  assert.ok(Array.isArray(I18N_PATTERNS));
  const worked = I18N_PATTERNS.find((patron) => patron.re.test('Worked for 3s'));
  assert.equal('Worked for 3s'.replace(worked.re, worked.toEs), 'Trabajó durante 3 s');
  const workedEs = I18N_PATTERNS.find((patron) => patron.re.test('Trabajó durante 3 s'));
  assert.equal('Trabajó durante 3 s'.replace(workedEs.re, workedEs.toEn), 'Worked for 3s');
});


test('el renderer carga el motor antes de app.js y declara lang en', async () => {
  const html = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en">/);
  const strings = html.indexOf('i18n-strings.js');
  const engine = html.indexOf('i18n.js');
  const app = html.indexOf('app.js');
  assert.ok(strings > 0 && engine > strings && app > engine);
});
