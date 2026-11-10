import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeRunExtensionCodeTool } = require('../electron/tools-extra.cjs');

test('run_extension_code inyecta args y ejecuta el wrapper', async () => {
  let comando = '';
  const tool = makeRunExtensionCodeTool(
    () => process.cwd(),
    async (args) => {
      comando = args.command;
      return { content: 'ok' };
    },
  );

  const resultado = await tool.execute({
    code: 'console.log(args.valor);',
    args: { valor: 7 },
  });

  assert.equal(resultado.content, 'ok');
  const rutas = [...comando.matchAll(/"([^"]+\.(?:mjs|json))"/g)].map((m) => m[1]);
  assert.equal(rutas.length, 2, 'el comando debe apuntar al script y a los args temporales');
  try {
    const script = await readFile(rutas[0], 'utf8');
    assert.match(script, /const args = JSON\.parse/);
    const args = JSON.parse(await readFile(rutas[1], 'utf8'));
    assert.deepEqual(args, { valor: 7 });
  } finally {
    await Promise.all(rutas.map((p) => unlink(p).catch(() => {})));
  }
});
