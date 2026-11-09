// Detección de framework y lectura de la salida de tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { modulo, temporal, escribir } from './helpers.mjs';

const { detectarFramework, parsearSalida, exito, resumirLinea } = modulo('testrunner');

describe('detectarFramework', () => {
  test('detecta node:test por el script de npm', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(
        path.join(dir, 'package.json'),
        JSON.stringify({ scripts: { test: 'node --test test/*.test.mjs' } }),
      );
      const detectado = await detectarFramework(dir);
      assert.equal(detectado.id, 'node');
      assert.equal(detectado.comando, 'npm test');
    } finally {
      limpiar();
    }
  });

  test('detecta vitest por la dependencia', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2' } }));
      const detectado = await detectarFramework(dir);
      assert.equal(detectado.id, 'vitest');
      assert.equal(detectado.comando, 'npx vitest run');
    } finally {
      limpiar();
    }
  });

  test('jest y mocha también', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
      assert.equal((await detectarFramework(dir)).id, 'jest');
    } finally {
      limpiar();
    }
  });

  test('un script de test desconocido usa npm test', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'ava' } }));
      const detectado = await detectarFramework(dir);
      assert.equal(detectado.id, 'script');
      assert.equal(detectado.comando, 'npm test');
    } finally {
      limpiar();
    }
  });

  test('ignora el placeholder de npm init', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(
        path.join(dir, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      );
      assert.equal(await detectarFramework(dir), null);
    } finally {
      limpiar();
    }
  });

  test('detecta pytest por pyproject.toml', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"');
      const detectado = await detectarFramework(dir);
      assert.equal(detectado.id, 'pytest');
    } finally {
      limpiar();
    }
  });

  test('detecta cargo y go por su manifiesto', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      escribir(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"');
      assert.equal((await detectarFramework(dir)).id, 'cargo');

      const otro = temporal('tr');
      try {
        escribir(path.join(otro.dir, 'go.mod'), 'module x');
        assert.equal((await detectarFramework(otro.dir)).id, 'go');
      } finally {
        otro.limpiar();
      }
    } finally {
      limpiar();
    }
  });

  test('un proyecto sin nada devuelve null', async () => {
    const { dir, limpiar } = temporal('tr');
    try {
      assert.equal(await detectarFramework(dir), null);
    } finally {
      limpiar();
    }
  });

  test('sin workspace devuelve null', async () => {
    assert.equal(await detectarFramework(''), null);
  });
});

describe('parsearSalida', () => {
  test('lee el resumen de node:test', () => {
    const salida = '...\n# tests 187\n# pass 184\n# fail 3\n';
    const resumen = parsearSalida(salida);
    assert.equal(resumen.pasan, 184);
    assert.equal(resumen.fallan, 3);
    assert.equal(resumen.total, 187);
    assert.equal(resumen.reconocido, true);
  });

  test('lee el resumen de vitest', () => {
    const salida = ' Test Files  2 failed | 10 passed (12)\n      Tests  3 failed | 184 passed | 1 skipped (188)\n';
    const resumen = parsearSalida(salida);
    assert.equal(resumen.pasan, 184);
    assert.equal(resumen.fallan, 3);
  });

  test('lee el resumen de mocha', () => {
    const resumen = parsearSalida('  184 passing (2s)\n  3 failing\n');
    assert.equal(resumen.pasan, 184);
    assert.equal(resumen.fallan, 3);
  });

  test('lee el resumen de pytest', () => {
    const resumen = parsearSalida('===== 184 passed, 3 failed in 2.31s =====');
    assert.equal(resumen.pasan, 184);
    assert.equal(resumen.fallan, 3);
  });

  test('lee el resumen de cargo', () => {
    const resumen = parsearSalida('test result: FAILED. 5 passed; 2 failed; 0 ignored');
    assert.equal(resumen.pasan, 5);
    assert.equal(resumen.fallan, 2);
  });

  test('quita los códigos de color antes de parsear', () => {
    const resumen = parsearSalida('\u001B[32m# pass 10\u001B[0m\n\u001B[31m# fail 1\u001B[0m');
    assert.equal(resumen.pasan, 10);
    assert.equal(resumen.fallan, 1);
  });

  test('lista los fallos de node:test', () => {
    const resumen = parsearSalida('not ok 3 - compilarCron\nnot ok 4 - otra cosa\n# pass 1\n# fail 2\n');
    assert.equal(resumen.fallos.length, 2);
    assert.equal(resumen.fallos[0].nombre, 'compilarCron');
  });

  test('lista los fallos de go', () => {
    const resumen = parsearSalida('--- FAIL: TestSuma (0.00s)\n--- PASS: TestResta\n');
    assert.equal(resumen.fallos.length, 1);
    assert.equal(resumen.fallos[0].nombre, 'TestSuma');
  });

  test('una salida sin resumen se marca como no reconocida', () => {
    const resumen = parsearSalida('todo bien, confía en mí');
    assert.equal(resumen.reconocido, false);
    assert.equal(resumen.pasan, null);
    assert.equal(resumen.fallan, null);
  });

  test('una salida vacía no rompe', () => {
    const resumen = parsearSalida('');
    assert.equal(resumen.reconocido, false);
    assert.deepEqual(resumen.fallos, []);
  });
});

describe('exito', () => {
  test('código 0 sin fallos es éxito', () => {
    assert.equal(exito(0, { fallan: 0 }), true);
  });

  test('código distinto de 0 es fallo', () => {
    assert.equal(exito(1, { fallan: 0 }), false);
  });

  test('código 0 pero con fallos contados es fallo', () => {
    assert.equal(exito(0, { fallan: 3 }), false);
  });

  test('código 0 sin resumen se acepta', () => {
    assert.equal(exito(0, null), true);
  });
});

describe('resumirLinea', () => {
  test('resume un caso con fallos', () => {
    assert.equal(resumirLinea({ reconocido: true, pasan: 184, fallan: 3 }, 1), 'Tests: 184 pasan, 3 fallan');
  });

  test('resume un caso limpio', () => {
    assert.equal(resumirLinea({ reconocido: true, pasan: 187, fallan: 0 }, 0), 'Tests: 187 pasan');
  });

  test('avisa cuando no reconoce la salida', () => {
    assert.match(resumirLinea({ reconocido: false }, 0), /sin resumen/);
  });
});
