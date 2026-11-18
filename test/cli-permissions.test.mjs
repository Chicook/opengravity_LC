import { test } from 'node:test';
import assert from 'node:assert/strict';

const { decidirPorReglas } = await import('../dist/cli/permissions.js');

test('deny gana sobre allow y ask', () => {
  const permisos = {
    allow: ['command(*)'],
    ask: ['command(git)'],
    deny: ['command(regex:^rm )'],
  };
  assert.equal(
    decidirPorReglas('run_command', { command: 'rm -rf /' }, permisos),
    'deny',
  );
  assert.equal(decidirPorReglas('run_command', { command: 'git status' }, permisos), 'ask');
  assert.equal(decidirPorReglas('run_command', { command: 'npm test' }, permisos), 'allow');
});

test('write_file(src/) solo cubre ese prefijo', () => {
  const permisos = { allow: ['write_file(src/)'] };
  assert.equal(decidirPorReglas('write_file', { path: 'src/a.ts' }, permisos), 'allow');
  assert.equal(decidirPorReglas('write_file', { path: 'tests/a.ts' }, permisos), null);
});

test('command(prefix) respeta tokens y rechaza constructos peligrosos', () => {
  const permisos = { allow: ['command(git)'] };
  assert.equal(decidirPorReglas('run_command', { command: 'git status && git log' }, permisos), 'allow');
  assert.equal(decidirPorReglas('run_command', { command: 'gitlab status' }, permisos), null);
  assert.equal(decidirPorReglas('run_command', { command: 'git log $(whoami)' }, permisos), null);
});

test('write_file implica read_file y deny read bloquea write', () => {
  assert.equal(
    decidirPorReglas('read_file', { path: 'src/a.ts' }, { allow: ['write_file(src/)'] }),
    'allow',
  );
  assert.equal(
    decidirPorReglas('write_file', { path: 'src/a.ts' }, { deny: ['read_file(src/)'] }),
    'deny',
  );
});

test('read_url cubre subdominios y mcp cubre server/*', () => {
  assert.equal(
    decidirPorReglas('fetch_url', { url: 'https://mail.google.com/x' }, { allow: ['read_url(google.com)'] }),
    'allow',
  );
  assert.equal(decidirPorReglas('linter_tool', {}, { allow: ['mcp(linter/*)'] }), 'allow');
});

test('sin reglas no decide', () => {
  assert.equal(decidirPorReglas('read_file', { path: 'a.ts' }, undefined), null);
});
