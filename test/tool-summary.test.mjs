import test from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/tool-summary.js';

const { resumirHerramientas, estadisticasDeCambio, lineDiffStats } = globalThis.ToolSummary;

test('resume por intención como Antigravity', () => {
  assert.equal(
    resumirHerramientas(['search_files', 'run_command', 'run_command', 'edit_file', 'edit_file']),
    'Explored file, ran commands, edited files',
  );
  assert.equal(
    resumirHerramientas(['search_files', 'run_command', 'edit_file']),
    'Explored file, ran command, edited file',
  );
  assert.equal(resumirHerramientas(['run_command', 'run_command']), 'Ran commands');
  assert.equal(resumirHerramientas(['search_files']), 'Explored file');
});

test('cuenta líneas de un fichero creado', () => {
  assert.deepEqual(estadisticasDeCambio('write_file', { content: 'a\nb\n' }), {
    additions: 2,
    removals: 0,
  });
});

test('calcula altas y bajas de una edición', () => {
  assert.deepEqual(lineDiffStats('a\nb\nc', 'a\nc'), { additions: 0, removals: 1 });
  assert.deepEqual(
    estadisticasDeCambio('edit_file', { oldText: 'a\nb', newText: 'a\nb\nc' }),
    { additions: 1, removals: 0 },
  );
});

test('suma varias ediciones y no inventa stats para comandos', () => {
  const stats = estadisticasDeCambio('multi_replace', {
    edits: [
      { targetContent: 'a', replacementContent: 'a\nb' },
      { targetContent: 'c\nd', replacementContent: 'c' },
    ],
  });
  assert.deepEqual(stats, { additions: 1, removals: 1 });
  assert.equal(estadisticasDeCambio('run_command', { command: 'echo' }), null);
});
