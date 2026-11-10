import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guardarEnCola, escribirAtomico } = require('../electron/settings-store.cjs');

test('deja JSON válido y no deja temporales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  const ruta = join(dir, 'settings.json');

  await Promise.all([
    guardarEnCola(ruta, { version: 1 }),
    guardarEnCola(ruta, { version: 2 }),
  ]);

  const datos = JSON.parse(await readFile(ruta, 'utf8'));
  assert.ok([1, 2].includes(datos.version));
  assert.equal((await readdir(dir)).some((nombre) => nombre.endsWith('.tmp')), false);

  await rm(dir, { recursive: true, force: true });
});

test('serializa las escrituras: gana la última encolada', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  const ruta = join(dir, 'settings.json');

  const orden = [];
  await Promise.all(
    [101, 102, 103].map((version) =>
      guardarEnCola(ruta, { version }).then(() => orden.push(version)),
    ),
  );

  const datos = JSON.parse(await readFile(ruta, 'utf8'));
  assert.equal(datos.version, 103);
  assert.deepEqual(orden, [101, 102, 103]);

  await rm(dir, { recursive: true, force: true });
});

test('un fallo no rompe la cola y se propaga', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  const ruta = join(dir, 'settings.json');

  const circular = {};
  circular.yo = circular;
  await assert.rejects(guardarEnCola(ruta, circular));

  // La siguiente escritura debe funcionar y limpiar el temporal del fallo.
  await guardarEnCola(ruta, { version: 7 });
  assert.equal(JSON.parse(await readFile(ruta, 'utf8')).version, 7);
  assert.equal((await readdir(dir)).some((nombre) => nombre.endsWith('.tmp')), false);

  await rm(dir, { recursive: true, force: true });
});

test('escribirAtomico reemplaza un fichero existente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  const ruta = join(dir, 'settings.json');

  await escribirAtomico(ruta, { version: 1 });
  await escribirAtomico(ruta, { version: 2 });

  assert.equal(JSON.parse(await readFile(ruta, 'utf8')).version, 2);
  assert.equal((await readdir(dir)).some((nombre) => nombre.endsWith('.tmp')), false);

  await rm(dir, { recursive: true, force: true });
});

test('si el rename falla no queda temporal huérfano', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  // El destino es un directorio: el rename de un fichero sobre él falla.
  const ruta = join(dir, 'destino');
  await mkdir(ruta);

  await assert.rejects(escribirAtomico(ruta, { version: 1 }));
  assert.equal((await readdir(dir)).some((nombre) => nombre.endsWith('.tmp')), false);

  await rm(dir, { recursive: true, force: true });
});
