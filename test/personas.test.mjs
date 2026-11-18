// Perfiles de producto («Interface Layout»): el bloque de comportamiento llega
// al prompt y cualquier id desconocido cae en ingeniería, nunca en vacío.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PERFILES, perfilDe, bloqueDePersona } = require('../electron/personas.cjs');
const { buildPromptExtras, SKILL_CATALOG } = require('../electron/prompt-extras.cjs');

test('cada perfil tiene instrucciones reales', () => {
  assert.ok(PERFILES.length >= 2);
  for (const perfil of PERFILES) {
    assert.ok(perfil.id.length > 0);
    assert.ok(perfil.bloque.length > 40, `el perfil ${perfil.id} necesita instrucciones reales`);
  }
});

test('el bloque del prompt cambia con el perfil', () => {
  const ingenieria = bloqueDePersona('engineering');
  const conocimiento = bloqueDePersona('knowledge-work');
  assert.notEqual(ingenieria, conocimiento);
  assert.match(ingenieria, /código/i);
  assert.match(conocimiento, /documento/);
});

test('un id desconocido cae en ingeniería', () => {
  assert.equal(perfilDe('no-existe').id, 'engineering');
  assert.equal(perfilDe(undefined).id, 'engineering');
  assert.equal(bloqueDePersona('otro'), bloqueDePersona('engineering'));
});

test('el prompt de sistema incluye persona, nombre y skills en ese orden', () => {
  const prompt = buildPromptExtras({
    persona: 'knowledge-work',
    profile: { name: 'Dani' },
    skills: { concise: true },
  });

  const usuario = prompt.indexOf('Dani');
  const persona = prompt.indexOf('Perfil de trabajo');
  const skills = prompt.indexOf('Instrucciones adicionales');
  assert.ok(usuario >= 0 && persona > usuario && skills > persona, prompt);
  assert.match(prompt, /documento/);
  assert.match(prompt, /Sé breve/);
});

test('sin perfil ni skills, el prompt lleva solo el bloque de la persona', () => {
  assert.equal(buildPromptExtras({}), '\n\n' + bloqueDePersona('engineering'));
  assert.equal(buildPromptExtras({ persona: 'engineering' }), '\n\n' + bloqueDePersona('engineering'));
});

test('las skills del catálogo siguen teniendo cuerpo', () => {
  assert.ok(SKILL_CATALOG.length >= 4);
  for (const skill of SKILL_CATALOG) {
    assert.ok(skill.id && skill.name && skill.body);
  }
});
