import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { puedeRenombrarAutomatico } = require('../electron/title-policy.cjs');

test('no pisa un título renombrado a mano', () => {
  const manuales = new Set(['sesion-1']);
  assert.equal(puedeRenombrarAutomatico(manuales, 'sesion-1'), false);
  assert.equal(puedeRenombrarAutomatico(manuales, 'sesion-2'), true);
});
