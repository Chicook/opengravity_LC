// Las herramientas deben resolver contra `ctx.cwd`, no contra el workspace del
// padre: es lo que hace que un subagente con worktree no escriba en la rama
// principal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modulo } from './helpers.mjs';

const herramientas = modulo('tools-extra');

test('edit_file resuelve contra ctx.cwd, no contra el cierre del padre', async () => {
  const padre = await mkdtemp(join(tmpdir(), 'og-padre-'));
  const worktree = await mkdtemp(join(tmpdir(), 'og-worktree-'));
  try {
    await writeFile(join(padre, 'x.txt'), 'PADRE', 'utf8');
    await writeFile(join(worktree, 'x.txt'), 'WORKTREE', 'utf8');

    const tool = herramientas.makeEditFileTool(() => padre);
    const resultado = await tool.execute(
      { path: 'x.txt', oldText: 'WORKTREE', newText: 'CAMBIADO' },
      { cwd: worktree },
    );

    assert.equal(resultado.isError, undefined);
    assert.equal(await readFile(join(worktree, 'x.txt'), 'utf8'), 'CAMBIADO');
    assert.equal(await readFile(join(padre, 'x.txt'), 'utf8'), 'PADRE');
  } finally {
    await rm(padre, { recursive: true, force: true });
    await rm(worktree, { recursive: true, force: true });
  }
});

test('run_command usa PowerShell en Windows', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('solo Windows');
    return;
  }
  const tool = herramientas.makeRunCommandTool(() => process.cwd(), () => ({}));
  try {
    const resultado = await tool.execute(
      { command: 'Write-Output PS_OK', waitDurationSeconds: 5000, taskName: 'PowerShell check' },
      { cwd: process.cwd() },
    );
    assert.match(resultado.content, /PS_OK/);
  } finally {
    await herramientas.matarTodasLasTareas();
  }
});

test('file_search busca en ctx.cwd', async () => {
  const padre = await mkdtemp(join(tmpdir(), 'og-padre-'));
  const worktree = await mkdtemp(join(tmpdir(), 'og-worktree-'));
  try {
    await mkdir(join(worktree, 'src'));
    await writeFile(join(worktree, 'src', 'carrito.test.ts'), '', 'utf8');
    await writeFile(join(padre, 'otro.txt'), '', 'utf8');

    const tool = herramientas.makeFileSearchTool(() => padre);
    const resultado = await tool.execute({ query: '*.test.ts' }, { cwd: worktree });

    assert.match(resultado.content, /src\/carrito\.test\.ts/);
    assert.doesNotMatch(resultado.content, /otro\.txt/);
  } finally {
    await rm(padre, { recursive: true, force: true });
    await rm(worktree, { recursive: true, force: true });
  }
});
