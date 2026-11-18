import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeSearchFilesTool } = require('../electron/tools-extra.cjs');

async function montar() {
  const dir = await mkdtemp(join(tmpdir(), 'og-search-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'const foo = 1;\nconst Foo = 2;\n');
  await writeFile(join(dir, 'src', 'b.test.ts'), 'foo en test\n');
  await writeFile(join(dir, 'src', 'literal.txt'), 'a.b y axb\n');
  await writeFile(join(dir, 'docs', 'a.md'), 'foo en docs\n');
  return dir;
}

test('search_files filtra por includes/excludes y distingue mayúsculas', async () => {
  const dir = await montar();
  try {
    const tool = makeSearchFilesTool(() => dir);
    const resultado = await tool.execute({
      pattern: 'foo',
      includes: ['src/**/*.ts'],
      excludes: ['**/*.test.ts'],
      caseSensitive: true,
    });

    assert.match(resultado.content, /src\/a\.ts:1:/);
    assert.doesNotMatch(resultado.content, /Foo/);
    assert.doesNotMatch(resultado.content, /b\.test/);
    assert.doesNotMatch(resultado.content, /docs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search_files con matchPerLine=false devuelve rutas únicas', async () => {
  const dir = await montar();
  try {
    const tool = makeSearchFilesTool(() => dir);
    const resultado = await tool.execute({
      pattern: 'foo',
      includes: ['src/**/*.ts'],
      excludes: ['**/*.test.ts'],
      matchPerLine: false,
    });

    assert.equal(resultado.content, 'src/a.ts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search_files con isRegex=false busca el punto literal', async () => {
  const dir = await montar();
  try {
    const tool = makeSearchFilesTool(() => dir);
    const resultado = await tool.execute({
      pattern: 'a.b',
      isRegex: false,
      matchPerLine: false,
    });

    assert.equal(resultado.content, 'src/literal.txt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file_search filtra por globs y puede devolver rutas absolutas', async () => {
  const dir = await montar();
  try {
    const { makeFileSearchTool } = require('../electron/tools-extra.cjs');
    const tool = makeFileSearchTool(() => dir);
    const resultado = await tool.execute({
      query: '.ts',
      includes: ['src/**/*.ts'],
      excludes: ['**/*.test.ts'],
      fullPath: true,
    });

    assert.equal(resultado.content, join(dir, 'src', 'a.ts'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
