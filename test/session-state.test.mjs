import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resetSessionState } = require('../electron/session-state.cjs');

test('resetea la sesión y olvida los checkpoints anteriores', () => {
  const state = { sessionId: 'vieja', messages: [{ role: 'user', content: 'hola' }] };
  const checkpoints = new Map([[0, new Map([['A.txt', 'viejo']])]]);
  const cambios = [{ absolute: 'A.txt', original: 'viejo' }];

  resetSessionState(state, checkpoints, cambios);

  assert.equal(state.sessionId, null);
  assert.deepEqual(state.messages, []);
  assert.equal(checkpoints.size, 0);
  assert.deepEqual(cambios, []);
});
