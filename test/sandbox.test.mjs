// Sandbox de procesos fase 2: límites saneados y argumentos del guard.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const { limitesDeSandbox, prefijoPosix, argumentosGuardWin, argumentosHelperWin } = modulo('sandbox');

describe('límites de sandbox', () => {
  test('valores por defecto razonables', () => {
    assert.deepEqual(limitesDeSandbox({}), {
      memoryMB: 1024,
      maxProcesses: 32,
      cpuSeconds: 300,
    });
  });

  test('recorta valores fuera de rango', () => {
    assert.deepEqual(
      limitesDeSandbox({ sandboxMemoryMB: 1, sandboxMaxProcesses: 9999, sandboxCpuSeconds: 0 }),
      { memoryMB: 64, maxProcesses: 512, cpuSeconds: 1 },
    );
    assert.deepEqual(
      limitesDeSandbox({ sandboxMemoryMB: 999999, sandboxMaxProcesses: 0, sandboxCpuSeconds: 999999 }),
      { memoryMB: 16384, maxProcesses: 1, cpuSeconds: 86400 },
    );
  });
});

describe('prefijo POSIX', () => {
  test('limita CPU y procesos sin tocar la memoria virtual', () => {
    const prefijo = prefijoPosix({ memoryMB: 512, maxProcesses: 16, cpuSeconds: 120 });
    assert.match(prefijo, /ulimit -t 120/);
    assert.match(prefijo, /ulimit -u 16/);
    assert.ok(!prefijo.includes('ulimit -v'), 'ulimit -v rompe Node por la reserva virtual');
  });
});

describe('guard de Windows', () => {
  test('el lanzador nativo recibe cwd, límites, padre y comando', () => {
    const args = argumentosHelperWin({
      cwd: 'C:\\proyecto',
      limites: { memoryMB: 256, maxProcesses: 8, cpuSeconds: 30 },
      parentPid: 99,
      command: 'npm test',
    });
    assert.equal(args[args.indexOf('--cwd') + 1], 'C:\\proyecto');
    assert.equal(args[args.indexOf('--memory-mb') + 1], '256');
    assert.equal(args[args.indexOf('--max-processes') + 1], '8');
    assert.equal(args[args.indexOf('--cpu-seconds') + 1], '30');
    assert.equal(args[args.indexOf('--parent-pid') + 1], '99');
    assert.equal(args[args.indexOf('--command') + 1], 'npm test');
  });

  test('pasa PID, padre y límites como argumentos', () => {
    const args = argumentosGuardWin({
      pid: 1234,
      parentPid: 99,
      limites: { memoryMB: 256, maxProcesses: 8, cpuSeconds: 30 },
    });
    assert.ok(args.some((arg) => arg.endsWith('sandbox-win.ps1')));
    assert.equal(args[args.indexOf('-TargetPid') + 1], '1234');
    assert.equal(args[args.indexOf('-ParentPid') + 1], '99');
    assert.equal(args[args.indexOf('-MemoryMB') + 1], '256');
    assert.equal(args[args.indexOf('-MaxProcesses') + 1], '8');
    assert.equal(args[args.indexOf('-CpuSeconds') + 1], '30');
  });
});
