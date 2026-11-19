import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configuracion } = require('../electron/ssh.cjs');

test('SSH: normaliza la configuración y acota el puerto', () => {
  const cfg = configuracion({
    ssh: { host: ' 127.0.0.1 ', user: ' root ', port: 2222, remotePath: ' /root ', keyPath: ' C:/k ' },
  });
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.user, 'root');
  assert.equal(cfg.port, 2222);
  assert.equal(cfg.remotePath, '/root');
  assert.equal(cfg.keyPath, 'C:/k');
  assert.equal(configuracion({ ssh: { host: 'h', user: 'u', port: 99999 } }).port, 65535);
});

test('SSH: exige host y usuario', () => {
  assert.throws(() => configuracion({ ssh: { host: '', user: 'root' } }), /host y usuario/);
  assert.throws(() => configuracion({ ssh: { host: 'h', user: '' } }), /host y usuario/);
});
