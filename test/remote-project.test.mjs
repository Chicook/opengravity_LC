import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { RemoteProject } = require('../electron/remote-project.cjs');

test('workspace remoto: descarga, vigila y sube cambios', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'opengravity-remote-'));
  const subidas = [];
  const workspace = {
    async descargar(_remote, local) {
      await fs.mkdir(local, { recursive: true });
      await fs.writeFile(path.join(local, 'README.md'), 'remoto\n', 'utf8');
    },
    async subir(local, remote) {
      subidas.push({ local, remote, content: await fs.readFile(local, 'utf8') });
    },
    async unlink() {},
  };
  const project = new RemoteProject(workspace);
  try {
    const mirror = await project.abrir(
      { host: 'example', port: 22, user: 'u', remotePath: '/srv/app' },
      userData,
    );
    assert.equal(await fs.readFile(path.join(mirror.root, 'README.md'), 'utf8'), 'remoto\n');

    await fs.writeFile(path.join(mirror.root, 'README.md'), 'local\n', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(subidas.length > 0, true);
    assert.equal(subidas.at(-1).remote, '/srv/app/README.md');
    assert.equal(subidas.at(-1).content, 'local\n');
  } finally {
    project.cerrar();
    await fs.rm(userData, { recursive: true, force: true });
  }
});
