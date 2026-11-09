// Trayectoria: pasos, snapshots, plan de reversión, persistencia y poda.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { modulo, recargar, temporal, escribir } from './helpers.mjs';

/** Prepara un almacén limpio con su carpeta y un fichero de trabajo. */
function montar(prefijo = 'tray') {
  const { dir, limpiar } = temporal(prefijo);
  const carpeta = path.join(dir, 'trajectory');
  const trayecto = recargar('trajectory');
  trayecto.configurar(carpeta);

  const objetivo = path.join(dir, 'objetivo.txt');
  escribir(objetivo, 'ORIGINAL');

  return { dir, carpeta, trayecto, objetivo, limpiar };
}

describe('pasos y snapshots', () => {
  let ctx;
  beforeEach(() => {
    ctx = montar();
  });

  test('abre y cierra pasos con su herramienta', () => {
    const { trayecto } = ctx;
    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
    trayecto.cerrarPaso('c1', { contenido: 'leyó' });
    trayecto.abrirPaso('c1', { indice: 2, herramienta: 'write_file' });
    trayecto.cerrarPaso('c1', { contenido: 'ok' });

    const pasos = trayecto.listarPasos('c1');
    assert.equal(pasos.length, 2);
    assert.equal(pasos[0].herramienta, 'read_file');
    assert.equal(pasos[1].herramienta, 'write_file');
  });

  test('guarda el contenido anterior de un fichero', () => {
    const { trayecto, objetivo } = ctx;
    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'write_file' });
    const anotado = trayecto.anotarEscritura('c1', objetivo, 'ORIGINAL');
    assert.equal(anotado, true);
    assert.deepEqual(trayecto.listarPasos('c1')[0].ficheros, [objetivo]);
  });

  test('solo guarda el snapshot la primera vez dentro del paso', () => {
    const { trayecto, objetivo } = ctx;
    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'write_file' });
    assert.equal(trayecto.anotarEscritura('c1', objetivo, 'primero'), true);
    assert.equal(trayecto.anotarEscritura('c1', objetivo, 'segundo'), false);
    assert.equal(trayecto.listarPasos('c1')[0].ficheros.length, 1);
  });

  test('marca como nuevo un fichero que no existía', () => {
    const { trayecto, dir } = ctx;
    const nuevo = path.join(dir, 'nuevo.txt');
    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'write_file' });
    trayecto.anotarEscritura('c1', nuevo, null);
    assert.deepEqual(trayecto.listarPasos('c1')[0].ficheros, [nuevo]);
  });

  test('anotar sin paso abierto no hace nada', () => {
    const { trayecto, objetivo } = ctx;
    assert.equal(trayecto.anotarEscritura('sin-pasos', objetivo, 'x'), false);
  });
});

describe('planDeReversion', () => {
  let ctx;
  beforeEach(() => {
    ctx = montar();
  });

  test('distingue restaurar de borrar', () => {
    const { trayecto, objetivo, dir } = ctx;
    const nuevo = path.join(dir, 'nuevo.txt');

    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
    trayecto.cerrarPaso('c1', {});

    trayecto.abrirPaso('c1', { indice: 2, herramienta: 'write_file' });
    trayecto.anotarEscritura('c1', objetivo, 'ORIGINAL');
    trayecto.anotarEscritura('c1', nuevo, null);
    trayecto.cerrarPaso('c1', {});

    const plan = trayecto.planDeReversion('c1', 1);
    assert.equal(plan.ok, true);
    assert.equal(plan.pasosDeshacer, 1);

    const porRuta = Object.fromEntries(plan.cambios.map((c) => [path.basename(c.ruta), c.accion]));
    assert.equal(porRuta['objetivo.txt'], 'restaurar');
    assert.equal(porRuta['nuevo.txt'], 'borrar');
  });

  test('se niega si no hay pasos posteriores', () => {
    const { trayecto } = ctx;
    trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
    const plan = trayecto.planDeReversion('c1', 1);
    assert.equal(plan.ok, false);
    assert.match(plan.error, /no hay pasos posteriores/);
  });

  test('se niega si no hay trayectoria', () => {
    const plan = ctx.trayecto.planDeReversion('inexistente', 1);
    assert.equal(plan.ok, false);
  });
});

describe('revertirA', () => {
  test('restaura el contenido y borra lo creado', async () => {
    const { trayecto, objetivo, dir, limpiar } = montar();
    try {
      const nuevo = path.join(dir, 'nuevo.txt');

      trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
      trayecto.cerrarPaso('c1', {});

      trayecto.abrirPaso('c1', { indice: 2, herramienta: 'write_file' });
      trayecto.anotarEscritura('c1', objetivo, fs.readFileSync(objetivo, 'utf8'));
      trayecto.anotarEscritura('c1', nuevo, null);
      escribir(objetivo, 'MODIFICADO');
      escribir(nuevo, 'creado');
      trayecto.cerrarPaso('c1', {});

      const resultado = await trayecto.revertirA('c1', 1);

      assert.equal(resultado.ok, true);
      assert.equal(resultado.restaurados, 2);
      assert.equal(fs.readFileSync(objetivo, 'utf8'), 'ORIGINAL');
      assert.equal(fs.existsSync(nuevo), false);
      assert.equal(trayecto.listarPasos('c1').length, 1, 'la trayectoria se recorta');
    } finally {
      limpiar();
    }
  });

  test('revertir dos veces seguidas se niega la segunda', async () => {
    const { trayecto, objetivo, limpiar } = montar();
    try {
      trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
      trayecto.abrirPaso('c1', { indice: 2, herramienta: 'write_file' });
      trayecto.anotarEscritura('c1', objetivo, 'ORIGINAL');
      escribir(objetivo, 'MODIFICADO');

      assert.equal((await trayecto.revertirA('c1', 1)).ok, true);
      assert.equal((await trayecto.revertirA('c1', 1)).ok, false);
    } finally {
      limpiar();
    }
  });
});

describe('persistencia', () => {
  test('sobrevive a un reinicio y el revert sigue funcionando', async () => {
    const { trayecto, carpeta, objetivo, limpiar } = montar('tray-persist');
    try {
      trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
      trayecto.cerrarPaso('c1', {});
      trayecto.abrirPaso('c1', { indice: 2, herramienta: 'write_file' });
      trayecto.anotarEscritura('c1', objetivo, fs.readFileSync(objetivo, 'utf8'));
      escribir(objetivo, 'MODIFICADO');
      trayecto.cerrarPaso('c1', {});

      await trayecto.volcar('c1');
      assert.ok(fs.existsSync(path.join(carpeta, 'c1.json')), 'debería haber escrito el fichero');

      // Reinicio: módulo desde cero, sin estado en memoria.
      const reiniciado = recargar('trajectory');
      reiniciado.configurar(carpeta);
      assert.equal(reiniciado.listarPasos('c1').length, 0, 'aún no debe haber cargado nada');

      await reiniciado.asegurar('c1');
      assert.equal(reiniciado.listarPasos('c1').length, 2);

      const resultado = await reiniciado.revertirA('c1', 1);
      assert.equal(resultado.ok, true);
      assert.equal(fs.readFileSync(objetivo, 'utf8'), 'ORIGINAL');
    } finally {
      limpiar();
    }
  });

  test('podarAntiguas borra lo viejo y respeta lo vivo', async () => {
    const { trayecto, carpeta, limpiar } = montar('tray-poda');
    try {
      const viejo = path.join(carpeta, 'vieja.json');
      escribir(viejo, JSON.stringify({ version: 1, conversacion: 'vieja', pasos: [] }));
      const hace40Dias = new Date(Date.now() - 40 * 86_400_000);
      fs.utimesSync(viejo, hace40Dias, hace40Dias);

      // Una conversación viva, aunque su fichero sea viejo, no se toca.
      const viva = path.join(carpeta, 'viva.json');
      escribir(viva, JSON.stringify({ version: 1, conversacion: 'viva', pasos: [] }));
      fs.utimesSync(viva, hace40Dias, hace40Dias);
      trayecto.abrirPaso('viva', { indice: 1, herramienta: 'read_file' });

      const borradas = await trayecto.podarAntiguas(30);

      assert.equal(borradas, 1);
      assert.equal(fs.existsSync(viejo), false);
      assert.equal(fs.existsSync(viva), true, 'una conversación viva no se poda');
    } finally {
      limpiar();
    }
  });

  test('olvidarTrayectoria borra también el fichero', async () => {
    const { trayecto, carpeta, limpiar } = montar('tray-olvido');
    try {
      trayecto.abrirPaso('c1', { indice: 1, herramienta: 'read_file' });
      await trayecto.volcar('c1');
      assert.ok(fs.existsSync(path.join(carpeta, 'c1.json')));

      await trayecto.olvidarTrayectoria('c1');
      assert.equal(fs.existsSync(path.join(carpeta, 'c1.json')), false);
      assert.equal(trayecto.listarPasos('c1').length, 0);
    } finally {
      limpiar();
    }
  });
});
