// El entorno de un servidor MCP se sanea igual que el de run_command: si las dos
// listas de credenciales se separan, una de las dos vías filtra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { raiz } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { sanearEntorno } = require('../electron/hooks.cjs');
const { entornoSanitizado } = await import(
  pathToFileURL(path.join(raiz, 'dist/mcp/stdio-client.js')).href
);

const MUESTRA = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  OPENAI_API_KEY: 'sk-x',
  ANTHROPIC_API_KEY: 'sk-y',
  GITHUB_TOKEN: 'ghp_z',
  AWS_SECRET_ACCESS_KEY: 'aws',
  npm_config_secret: 's',
  MY_PASSWORD: 'p',
  SSH_AUTH_SOCK: '/tmp/agent',
  GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
  LANG: 'es_ES.UTF-8',
};

test('las dos listas de credenciales coinciden', () => {
  assert.deepEqual(entornoSanitizado(MUESTRA), sanearEntorno(MUESTRA));
});

test('el servidor MCP no hereda claves y conserva lo básico', () => {
  const limpio = entornoSanitizado(MUESTRA);
  assert.equal(limpio.PATH, '/usr/bin');
  assert.equal(limpio.HOME, '/home/u');
  assert.equal(limpio.LANG, 'es_ES.UTF-8');
  for (const clave of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK']) {
    assert.equal(limpio[clave], undefined, `${clave} no debe viajar`);
  }
});
