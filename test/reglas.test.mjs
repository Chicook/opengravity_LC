import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import reglas from '../electron/rules.cjs';

const { descubrirReglas, bloqueDeReglas } = reglas;

/** Crea un workspace temporal con los ficheros indicados. */
async function conWorkspace(ficheros, fn) {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'og-reglas-'));
  try {
    for (const [ruta, contenido] of Object.entries(ficheros)) {
      const destino = path.join(raiz, ruta);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, contenido, 'utf8');
    }
    return await fn(raiz);
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
}

test('descubre AGENTS.md y las reglas de .agents/rules, en orden', async () => {
  const halladas = await conWorkspace(
    {
      'AGENTS.md': 'Regla de la raíz.',
      '.agents/rules/b-segunda.md': 'Segunda.',
      '.agents/rules/a-primera.md': 'Primera.',
      '.agents/rules/grupo/anidada.md': 'Anidada.',
      '.agents/rules/notas.txt': 'no es markdown',
    },
    async (raiz) => descubrirReglas(raiz),
  );

  assert.deepEqual(
    halladas.map((regla) => regla.ruta),
    ['AGENTS.md', '.agents/rules/a-primera.md', '.agents/rules/b-segunda.md', '.agents/rules/grupo/anidada.md'],
  );
  assert.equal(halladas[0].contenido, 'Regla de la raíz.');
});

test('sin ficheros de reglas devuelve lista vacía y no falla', async () => {
  const halladas = await conWorkspace({}, async (raiz) => descubrirReglas(raiz));
  assert.deepEqual(halladas, []);
  assert.equal(bloqueDeReglas(halladas, 80_000), '');
});

test('el bloque incluye la cabecera y el contenido', async () => {
  const bloque = bloqueDeReglas(
    [{ ruta: 'AGENTS.md', contenido: 'Usa commits convencionales.' }],
    80_000,
  );

  assert.match(bloque, /Reglas del workspace/);
  assert.match(bloque, /### AGENTS\.md/);
  assert.match(bloque, /Usa commits convencionales\./);
});

test('una regla que no cabe se recorta y apunta a su ruta', async () => {
  const contenido = 'x'.repeat(5000);
  const bloque = bloqueDeReglas([{ ruta: 'AGENTS.md', contenido }], 1200);

  assert.ok(bloque.length <= 1400, `bloque de ${bloque.length} caracteres`);
  assert.match(bloque, /regla recortada por presupuesto/);
  assert.match(bloque, /AGENTS\.md/);
});

test('sin presupuesto no se inyecta nada', () => {
  assert.equal(bloqueDeReglas([{ ruta: 'AGENTS.md', contenido: 'algo' }], 0), '');
});

test('muchos punteros no multiplican el presupuesto', () => {
  const reglas = Array.from({ length: 80 }, (_, i) => ({
    ruta: `.agents/rules/r${i}-muy-largo.md`,
    contenido: 'x'.repeat(2000),
  }));

  const bloque = bloqueDeReglas(reglas, 1200);
  assert.ok(bloque.length <= 1200, `bloque de ${bloque.length} caracteres`);
});

test('un fichero de reglas enorme se lee solo hasta el tope', async () => {
  const grande = 'y'.repeat(300 * 1024);
  const halladas = await conWorkspace({ 'AGENTS.md': grande }, (raiz) => descubrirReglas(raiz));

  assert.equal(halladas.length, 1);
  assert.ok(halladas[0].contenido.length < grande.length, 'no debe leerlo entero');
  assert.match(halladas[0].contenido, /regla recortada/);
});
