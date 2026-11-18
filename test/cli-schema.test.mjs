import { test } from 'node:test';
import assert from 'node:assert/strict';

const { compilarValidador } = await import('../dist/cli/schema.js');

test('acepta una respuesta que cumple el esquema', () => {
  const validar = compilarValidador({
    type: 'object',
    properties: {
      major: { type: 'integer' },
      minor: { type: 'integer' },
    },
    required: ['major', 'minor'],
    additionalProperties: false,
  });

  assert.equal(validar({ major: 2, minor: 14 }), null);
});

test('rechaza tipos y campos que no cumplen', () => {
  const validar = compilarValidador({
    type: 'object',
    properties: { major: { type: 'integer' } },
    required: ['major'],
  });

  assert.match(validar({ major: '2' }) ?? '', /json-schema/);
  assert.match(validar({}) ?? '', /json-schema/);
});
