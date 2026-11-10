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
  const ruta = comando.match(/"([^"]+\.mjs)"/)?.[1];
  assert.ok(ruta, 'el comando debe apuntar al script temporal');
  const script = await readFile(ruta, 'utf8');
  assert.match(script, /const args = JSON\.parse/);
  await unlink(ruta).catch(() => {});
});
