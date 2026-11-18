// Ajustes compartidos app/CLI y configuración de proveedores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { leerSettingsApp, configProveedor } = await import('../dist/cli/settings.js');

test('lee provider/model/prefs del settings de la app', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-cli-settings-'));
  const ruta = join(dir, 'settings.json');
  await writeFile(
    ruta,
    JSON.stringify({
      providerId: 'openai',
      model: 'gpt-4o-mini',
      prefs: {
        effort: 'high',
        agentMode: 'accept-edits',
        restrictToWorkspace: true,
        permissions: { allow: ['command(git)'], deny: ['write_file(.env)'] },
      },
    }),
    'utf8',
  );

  const previo = process.env.OPENGRAVITY_SETTINGS;
  process.env.OPENGRAVITY_SETTINGS = ruta;
  try {
    const settings = await leerSettingsApp();
    assert.equal(settings.providerId, 'openai');
    assert.equal(settings.model, 'gpt-4o-mini');
    assert.equal(settings.prefs?.effort, 'high');
    assert.equal(settings.prefs?.agentMode, 'accept-edits');
    assert.deepEqual(settings.prefs?.permissions?.allow, ['command(git)']);
  } finally {
    if (previo === undefined) delete process.env.OPENGRAVITY_SETTINGS;
    else process.env.OPENGRAVITY_SETTINGS = previo;
  }
});

test('extrae claves en claro y custom providers, pero no apiKeysEnc', () => {
  const config = configProveedor({
    prefs: {
      apiKeys: { openai: 'sk-1', groq: ' ' },
      customProviders: {
        'openai-compatible': { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'local' },
      },
      apiKeysEnc: 'blob',
    },
  });

  assert.deepEqual(config.apiKeys, { openai: 'sk-1', 'openai-compatible': 'local' });
  assert.deepEqual(config.baseUrls, { 'openai-compatible': 'http://127.0.0.1:1234/v1' });
});

test('las claves descifradas mandan sobre las antiguas en claro', () => {
  const config = configProveedor(
    { prefs: { apiKeys: { openai: 'vieja', groq: 'gsk' } } },
    { openai: 'nueva', anthropic: 'sk-ant' },
  );

  assert.deepEqual(config.apiKeys, { openai: 'nueva', groq: 'gsk', anthropic: 'sk-ant' });
});
