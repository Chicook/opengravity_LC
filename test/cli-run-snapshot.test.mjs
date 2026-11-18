import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { configurarTrayectoria, crearTrayectoriaCli } = await import('../dist/cli/trayectoria.js');

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
}

function comandoQueCambia(dir) {
  return {
    name: 'run_command',
    description: 'comando',
    parameters: { type: 'object', properties: {} },
    async execute() {
      await writeFile(join(dir, 'a.txt'), 'nuevo', 'utf8');
      await writeFile(join(dir, 'u.txt'), 'no seguido nuevo', 'utf8');
      await writeFile(join(dir, 'nuevo.txt'), 'creado', 'utf8');
      return { content: 'ok' };
    },
  };
}

test('run_command snapshotea cambios de ficheros seguidos y no seguidos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-run-snap-'));
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'prueba@example.com']);
    git(dir, ['config', 'user.name', 'Prueba']);
    await writeFile(join(dir, 'a.txt'), 'viejo', 'utf8');
    await writeFile(join(dir, 'u.txt'), 'no seguido viejo', 'utf8');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-m', 'inicial']);

    configurarTrayectoria(join(dir, 'trajectory'));
    const trayectoria = crearTrayectoriaCli(`run-${Date.now()}`, dir);
    trayectoria.marcarTurno(0);
    const tool = trayectoria.envolver(comandoQueCambia(dir));

    await tool.execute({ command: 'falso' }, { cwd: dir, callId: 'cmd-1' });
    const reversion = await trayectoria.revertirTurno(0);

    assert.equal(reversion.ok, true);
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'viejo');
    assert.equal(await readFile(join(dir, 'u.txt'), 'utf8'), 'no seguido viejo');
    assert.equal(existsSync(join(dir, 'nuevo.txt')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
