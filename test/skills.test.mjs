// Skills de workspace: frontmatter, descubrimiento, búsqueda y catálogo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { modulo, temporal, escribir } from './helpers.mjs';

const { parsearFrontmatter, descubrirSkills, buscarSkill, bloqueDeSkills } = modulo('skills');

describe('parsearFrontmatter', () => {
  test('lee un escalar plegado y separa el cuerpo', () => {
    const { datos, cuerpo } = parsearFrontmatter(
      '---\nname: prueba\ndescription: >-\n  una linea\n  y otra\n---\ncuerpo',
    );
    assert.equal(datos.name, 'prueba');
    assert.equal(datos.description, 'una linea y otra');
    assert.equal(cuerpo, 'cuerpo');
  });

  test('lee un escalar de bloque literal', () => {
    const { datos } = parsearFrontmatter('---\ndescription: |\n  linea uno\n  linea dos\n---\n');
    assert.match(datos.description, /linea uno/);
    assert.match(datos.description, /linea dos/);
  });

  test('quita las comillas de un valor', () => {
    const { datos } = parsearFrontmatter('---\nname: "con comillas"\n---\n');
    assert.equal(datos.name, 'con comillas');
  });

  test('lee una lista en línea', () => {
    const { datos } = parsearFrontmatter('---\ntags: [a, b, c]\n---\n');
    assert.deepEqual(datos.tags, ['a', 'b', 'c']);
  });

  test('sin frontmatter devuelve todo como cuerpo', () => {
    const { datos, cuerpo } = parsearFrontmatter('# Solo cuerpo\nnada mas');
    assert.deepEqual(datos, {});
    assert.match(cuerpo, /^# Solo cuerpo/);
  });

  test('un frontmatter sin cerrar no se interpreta como tal', () => {
    const { datos, cuerpo } = parsearFrontmatter('---\nname: x\nsin cierre');
    assert.deepEqual(datos, {});
    assert.match(cuerpo, /sin cierre/);
  });
});

describe('descubrirSkills', () => {
  test('encuentra una skill con su descripción y sus recursos', async () => {
    const { dir, limpiar } = temporal('skills');
    try {
      escribir(
        path.join(dir, '.agents/skills/commits/SKILL.md'),
        '---\nname: commits\ndescription: Para preparar commits\n---\n# Commits\n\nHaz esto.',
      );
      escribir(path.join(dir, '.agents/skills/commits/scripts/valida.mjs'), 'console.log(1)');
      escribir(path.join(dir, '.agents/skills/commits/references/guia.md'), '# guia');

      const skills = await descubrirSkills(dir);
      const propia = skills.find((s) => s.name === 'commits');

      assert.ok(propia, 'debería encontrar la skill');
      assert.equal(propia.description, 'Para preparar commits');
      assert.match(propia.cuerpo, /Haz esto/);
      assert.deepEqual(propia.recursos.scripts, ['scripts/valida.mjs']);
      assert.deepEqual(propia.recursos.references, ['references/guia.md']);
      assert.equal(propia.relative, path.join('.agents', 'skills', 'commits').split(path.sep).join('/'));
    } finally {
      limpiar();
    }
  });

  test('usa el nombre de la carpeta si el frontmatter no trae name', async () => {
    const { dir, limpiar } = temporal('skills');
    try {
      escribir(path.join(dir, '.agents/skills/sin-nombre/SKILL.md'), '---\ndescription: x\n---\ncuerpo');
      const skills = await descubrirSkills(dir);
      assert.ok(skills.some((s) => s.name === 'sin-nombre'));
    } finally {
      limpiar();
    }
  });

  test('ignora carpetas sin SKILL.md', async () => {
    const { dir, limpiar } = temporal('skills');
    try {
      escribir(path.join(dir, '.agents/skills/vacia/otra-cosa.txt'), 'nada');
      const skills = await descubrirSkills(dir);
      assert.equal(skills.filter((s) => s.name === 'vacia').length, 0);
    } finally {
      limpiar();
    }
  });

  test('sin carpeta de skills devuelve una lista vacía, no falla', async () => {
    const { dir, limpiar } = temporal('skills');
    try {
      const skills = await descubrirSkills(dir);
      assert.ok(Array.isArray(skills));
    } finally {
      limpiar();
    }
  });
});

describe('buscarSkill', () => {
  const skills = [
    { name: 'commit-convencional', description: '', relative: '' },
    { name: 'revisar-codigo', description: '', relative: '' },
  ];

  test('encuentra por nombre exacto', () => {
    assert.equal(buscarSkill(skills, 'commit-convencional').name, 'commit-convencional');
  });

  test('encuentra por sufijo si es inequívoco', () => {
    assert.equal(buscarSkill(skills, 'convencional').name, 'commit-convencional');
  });

  test('no resuelve una búsqueda ambigua', () => {
    const ambiguas = [
      { name: 'revisar-codigo', description: '', relative: '' },
      { name: 'revisar-tests', description: '', relative: '' },
    ];
    assert.equal(buscarSkill(ambiguas, 'revisar'), null);
  });

  test('devuelve null si no hay nada', () => {
    assert.equal(buscarSkill(skills, 'inexistente'), null);
  });

  test('devuelve null con una búsqueda vacía', () => {
    assert.equal(buscarSkill(skills, '   '), null);
  });
});

describe('bloqueDeSkills', () => {
  test('solo incluye nombre y descripción, nunca el cuerpo', () => {
    const bloque = bloqueDeSkills([
      { name: 'commits', description: 'Para commits', cuerpo: 'SECRETO QUE NO DEBE SALIR' },
    ]);
    assert.match(bloque, /commits: Para commits/);
    assert.ok(!bloque.includes('SECRETO QUE NO DEBE SALIR'), 'el cuerpo no debe entrar en el prompt');
  });

  test('sin skills devuelve cadena vacía', () => {
    assert.equal(bloqueDeSkills([]), '');
    assert.equal(bloqueDeSkills(undefined), '');
  });

  test('una skill sin descripción aparece igual', () => {
    const bloque = bloqueDeSkills([{ name: 'sola', description: '' }]);
    assert.match(bloque, /- sola/);
  });
});
