// Memoria por patrón de fichero (`CORTEX_MEMORY_TRIGGER_GLOB`): el patrón
// decide, y solo entra lo que encaja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AlmacenDeMemoria, coincideGlob } = require('../electron/memory.cjs');

function almacenTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  return { dir, almacen: new AlmacenDeMemoria(path.join(dir, 'memorias.json')) };
}

test('el patrón respeta segmentos, profundidad y comodines', () => {
  assert.equal(coincideGlob('src/*.ts', 'src/index.ts'), true);
  assert.equal(coincideGlob('src/*.ts', 'src/deep/index.ts'), false);
  assert.equal(coincideGlob('src/**/*.ts', 'src/deep/index.ts'), true);
  assert.equal(coincideGlob('**/*.test.ts', 'test/a.test.ts'), true);
  assert.equal(coincideGlob('*.json', 'config/package.json'), true);
  assert.equal(coincideGlob('src\\api\\*.ts', 'src/api/user.ts'), true);
  assert.equal(coincideGlob('api.?s', 'api.js'), true);
  assert.equal(coincideGlob('', 'src/a.ts'), false);
});

test('una memoria con globs se activa con la ruta que encaja', async () => {
  const { dir, almacen } = almacenTemporal();
  try {
    await almacen.add({ texto: 'La API usa snake_case en los campos.', globs: ['src/api/*.ts'] });
    await almacen.add({ texto: 'Las pruebas usan node:test.', globs: ['test/*.mjs'] });
    await almacen.add({ texto: 'Sin patrón, solo entra al empezar el hilo.' });

    const encontradas = await almacen.porGlob(['src/api/users.ts', 'README.md']);
    assert.equal(encontradas.length, 1);
    assert.equal(encontradas[0].ruta, 'src/api/users.ts');
    assert.match(encontradas[0].texto, /snake_case/);

    assert.equal((await almacen.porGlob(['src/otra/cosa.ts'])).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('los patrones se limpian y el duplicado no los pierde', async () => {
  const { dir, almacen } = almacenTemporal();
  try {
    const creada = await almacen.add({
      texto: 'El indexador corre en el hilo principal.',
      globs: ['  src/indexer.cjs  ', '', 'src/*.ts'],
    });
    assert.deepEqual(creada.globs, ['src/indexer.cjs', 'src/*.ts']);

    const repetida = await almacen.add({
      texto: 'El indexador corre en el hilo principal.',
      globs: ['electron/*.cjs'],
    });
    assert.equal(repetida.duplicada, true);
    assert.deepEqual(repetida.globs.sort(), ['electron/*.cjs', 'src/indexer.cjs', 'src/*.ts'].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sin globs no se activa por fichero, pero sigue entrando al abrir el hilo', async () => {
  const { dir, almacen } = almacenTemporal();
  try {
    await almacen.add({ texto: 'Preferencia: respuestas breves.' });
    assert.equal((await almacen.porGlob(['src/a.ts'])).length, 0);
    const relevantes = await almacen.relevant('global', 6);
    assert.ok(relevantes.some((m) => /respuestas breves/.test(m.texto)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
