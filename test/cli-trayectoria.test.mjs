import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { configurarTrayectoria, crearTrayectoriaCli } = await import('../dist/cli/trayectoria.js');

function herramientaDeEscritura(cwd) {
  return {
    name: 'write_file',
    description: 'escribe',
    parameters: { type: 'object', properties: {} },
    async execute(args) {
      await writeFile(join(cwd, String(args.path)), String(args.content), 'utf8');
      return { content: `escrito ${args.path}` };
    },
  };
}

test('la trayectoria del CLI restaura el contenido anterior de un fichero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-tray-'));
  try {
    configurarTrayectoria(join(dir, 'trajectory'));
    await writeFile(join(dir, 'a.txt'), 'viejo', 'utf8');

    const trayectoria = crearTrayectoriaCli(`prueba-${Date.now()}`, dir);
    trayectoria.marcarTurno(0);
    const tool = trayectoria.envolver(herramientaDeEscritura(dir));

    await tool.execute({ path: 'a.txt', content: 'nuevo' }, { cwd: dir, callId: 'c1' });
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'nuevo');

    const reversion = await trayectoria.revertirTurno(0);
    assert.equal(reversion.ok, true);
    assert.equal(reversion.restaurados, 1);
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'viejo');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('la trayectoria del CLI borra un fichero que no existía antes del paso', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-tray-'));
  try {
    configurarTrayectoria(join(dir, 'trajectory'));
    const trayectoria = crearTrayectoriaCli(`prueba-${Date.now()}-nuevo`, dir);
    trayectoria.marcarTurno(0);
    const tool = trayectoria.envolver(herramientaDeEscritura(dir));

    await tool.execute({ path: 'nuevo.txt', content: 'hola' }, { cwd: dir, callId: 'c2' });
    const reversion = await trayectoria.revertirTurno(0);

    assert.equal(reversion.ok, true);
    await assert.rejects(readFile(join(dir, 'nuevo.txt'), 'utf8'), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('copiarA conserva los snapshots para el fork', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-tray-'));
  try {
    configurarTrayectoria(join(dir, 'trajectory'));
    await writeFile(join(dir, 'a.txt'), 'viejo', 'utf8');

    const origen = `origen-${Date.now()}`;
    const destino = `destino-${Date.now()}`;
    const primera = crearTrayectoriaCli(origen, dir);
    primera.marcarTurno(0);
    const tool = primera.envolver(herramientaDeEscritura(dir));
    await tool.execute({ path: 'a.txt', content: 'nuevo' }, { cwd: dir, callId: 'c3' });

    assert.equal(await primera.copiarA(destino), true);
    primera.cambiar(destino);
    const reversion = await primera.revertirTurno(0);

    assert.equal(reversion.ok, true);
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'viejo');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
