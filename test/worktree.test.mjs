import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const wt = await import('../electron/worktree.cjs');

async function repoConCommit() {
  const dir = await mkdtemp(join(tmpdir(), 'ogp-wt-'));
  const run = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  run('init', '-q');
  run('config', 'user.email', 'prueba@ejemplo.com');
  run('config', 'user.name', 'Prueba');
  await writeFile(join(dir, 'base.txt'), 'contenido base', 'utf8');
  run('add', '.');
  run('commit', '-qm', 'inicial');
  return dir;
}

test('un directorio que no es repo se rechaza con motivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogp-norepo-'));
  const r = await wt.esRepoGit(dir);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no es un repositorio git/);
});

test('un repo sin commits se rechaza: no hay HEAD del que partir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogp-vacio-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const r = await wt.esRepoGit(dir);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /ningún commit/);
});

test('crear devuelve un worktree real con el contenido del proyecto', async () => {
  const dir = await repoConCommit();
  const r = await wt.crear(dir, 'Codebase Researcher');
  assert.equal(r.ok, true);
  assert.match(r.rama, /^subagente-codebase-researcher$/);
  assert.equal(await readFile(join(r.ruta, 'base.txt'), 'utf8'), 'contenido base');
});

test('dos worktrees del mismo nombre no chocan', async () => {
  const dir = await repoConCommit();
  const a = await wt.crear(dir, 'revisor');
  const b = await wt.crear(dir, 'revisor');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.ruta, b.ruta);
  assert.notEqual(a.rama, b.rama);
});

test('sin cambios, cerrar borra el worktree y la rama', async () => {
  const dir = await repoConCommit();
  const w = await wt.crear(dir, 'limpio');
  const c = await wt.cerrar(dir, w);
  assert.equal(c.ok, true);
  assert.equal(c.conservado, false);
  assert.equal(await wt.tieneCambios(w.ruta), false);
  assert.equal((await wt.listar(dir)).length, 1);
});

test('con cambios, cerrar CONSERVA el worktree y avisa', async () => {
  const dir = await repoConCommit();
  const w = await wt.crear(dir, 'escribe');
  await writeFile(join(w.ruta, 'nuevo.txt'), 'cambio del subagente', 'utf8');
  const c = await wt.cerrar(dir, w);
  assert.equal(c.conservado, true);
  assert.equal(c.rama, w.rama);
  assert.match(c.nota, /no se ha tocado tu rama de trabajo/);
  // El trabajo sigue ahí.
  assert.equal(await readFile(join(w.ruta, 'nuevo.txt'), 'utf8'), 'cambio del subagente');
});

test('el worktree NO contamina el directorio del padre', async () => {
  const dir = await repoConCommit();
  const w = await wt.crear(dir, 'aislado');
  await writeFile(join(w.ruta, 'solo-aqui.txt'), 'x', 'utf8');
  await assert.rejects(readFile(join(dir, 'solo-aqui.txt'), 'utf8'));
});

test('ramaDe limpia acentos, espacios y símbolos', () => {
  assert.equal(wt.ramaDe('Revisor de Código'), 'subagente-revisor-de-codigo');
  assert.equal(wt.ramaDe('  ¿Qué?  '), 'subagente-que');
  assert.equal(wt.ramaDe(''), 'subagente-tarea');
  assert.equal(wt.ramaDe('a'.repeat(80)).length, 'subagente-'.length + 40);
});
