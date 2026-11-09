// Definiciones de subagente, búsqueda y registro de los que están corriendo.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { modulo, recargar, temporal } from './helpers.mjs';

function montar(prefijo = 'subs') {
  const { dir, limpiar } = temporal(prefijo);
  const archivo = path.join(dir, 'subagents.json');
  const sub = recargar('subagents');
  sub.configurar(archivo);
  return { dir, archivo, sub, limpiar };
}

describe('definir', () => {
  let ctx;
  beforeEach(() => {
    ctx = montar();
  });

  test('guarda una definición completa', async () => {
    const entrada = await ctx.sub.definir({
      name: 'revisor',
      role: 'Code Reviewer',
      description: 'Revisa cambios',
      systemPrompt: 'Eres revisor.',
      allowWrites: true,
    });

    assert.equal(entrada.name, 'revisor');
    assert.equal(entrada.role, 'Code Reviewer');
    assert.equal(entrada.allowWrites, true);
    assert.ok(entrada.actualizadoEn);
  });

  test('guarda allowMcp y lo devuelve al buscar', async () => {
    await ctx.sub.definir({
      name: 'con-mcp',
      role: 'Tools User',
      description: 'x',
      allowMcp: true,
    });
    const encontrada = await ctx.sub.buscar('con-mcp');
    assert.equal(encontrada.allowMcp, true);
    assert.equal(encontrada.allowWrites, false, 'no debe conceder escritura de paso');
  });

  test('por defecto no da escritura', async () => {
    const entrada = await ctx.sub.definir({ name: 'lector', role: 'Reader', description: 'x' });
    assert.equal(entrada.allowWrites, false);
    assert.equal(entrada.allowMcp, false);
  });

  test('redefine sin duplicar', async () => {
    await ctx.sub.definir({ name: 'revisor', role: 'Uno', description: 'a' });
    await ctx.sub.definir({ name: 'revisor', role: 'Dos', description: 'b' });
    const todas = await ctx.sub.listarDefiniciones();
    assert.equal(todas.length, 1);
    assert.equal(todas[0].role, 'Dos');
  });

  const invalidos = ['con espacio', '', '-empieza-mal', 'a'.repeat(60), 'ñandú'];
  for (const nombre of invalidos) {
    test(`rechaza el nombre ${JSON.stringify(nombre).slice(0, 20)}`, async () => {
      await assert.rejects(() => ctx.sub.definir({ name: nombre, role: 'x', description: 'x' }));
    });
  }

  test('persiste en disco y sobrevive a un reinicio', async () => {
    await ctx.sub.definir({ name: 'revisor', role: 'Code Reviewer', description: 'x' });
    assert.ok(fs.existsSync(ctx.archivo));

    const reiniciado = recargar('subagents');
    reiniciado.configurar(ctx.archivo);
    const todas = await reiniciado.listarDefiniciones();
    assert.equal(todas.length, 1);
    assert.equal(todas[0].name, 'revisor');
  });
});

describe('buscar', () => {
  let ctx;
  beforeEach(async () => {
    ctx = montar();
    await ctx.sub.definir({ name: 'revisor-codigo', role: 'A', description: 'x' });
    await ctx.sub.definir({ name: 'buscador', role: 'B', description: 'x' });
  });

  test('por nombre exacto', async () => {
    assert.equal((await ctx.sub.buscar('revisor-codigo')).name, 'revisor-codigo');
  });

  test('por sufijo inequívoco', async () => {
    assert.equal((await ctx.sub.buscar('buscador')).name, 'buscador');
  });

  test('no resuelve ambigüedades', async () => {
    await ctx.sub.definir({ name: 'revisor-tests', role: 'C', description: 'x' });
    assert.equal(await ctx.sub.buscar('revisor'), null);
  });

  test('devuelve null si no existe', async () => {
    assert.equal(await ctx.sub.buscar('inexistente'), null);
  });

  test('devuelve null con nombre vacío', async () => {
    assert.equal(await ctx.sub.buscar('  '), null);
  });
});

describe('borrarDefinicion', () => {
  test('borra y persiste', async () => {
    const { sub, archivo, limpiar } = montar();
    try {
      await sub.definir({ name: 'temporal', role: 'x', description: 'x' });
      assert.equal(await sub.borrarDefinicion('temporal'), true);
      assert.equal((await sub.listarDefiniciones()).length, 0);

      const reiniciado = recargar('subagents');
      reiniciado.configurar(archivo);
      assert.equal((await reiniciado.listarDefiniciones()).length, 0);
    } finally {
      limpiar();
    }
  });

  test('borrar algo que no existe devuelve false', async () => {
    const { sub, limpiar } = montar();
    try {
      assert.equal(await sub.borrarDefinicion('nada'), false);
    } finally {
      limpiar();
    }
  });
});

describe('registro de ejecución', () => {
  test('registra, lista y libera', () => {
    const { sub, limpiar } = montar();
    try {
      const id = sub.registrar({ nombre: 'revisor', rol: 'Reviewer', controller: new AbortController() });
      assert.match(id, /^sub-\d+$/);

      const vivos = sub.listarEnEjecucion();
      assert.equal(vivos.length, 1);
      assert.equal(vivos[0].estado, 'corriendo');

      sub.marcarTerminado(id, 'terminado');
      assert.equal(sub.listarEnEjecucion()[0].estado, 'terminado');

      sub.liberar(id);
      assert.equal(sub.listarEnEjecucion().length, 0);
    } finally {
      limpiar();
    }
  });

  test('matar cancela solo los ids pedidos', () => {
    const { sub, limpiar } = montar();
    try {
      const c1 = new AbortController();
      const id1 = sub.registrar({ nombre: 'a', rol: '', controller: c1 });
      const c2 = new AbortController();
      sub.registrar({ nombre: 'b', rol: '', controller: c2 });

      assert.equal(sub.matar([id1]), 1);
      assert.equal(c1.signal.aborted, true);
      assert.equal(c2.signal.aborted, false, 'el otro debe seguir vivo');
    } finally {
      limpiar();
    }
  });

  test('matar sin ids cancela todos', () => {
    const { sub, limpiar } = montar();
    try {
      const c1 = new AbortController();
      const c2 = new AbortController();
      sub.registrar({ nombre: 'a', rol: '', controller: c1 });
      sub.registrar({ nombre: 'b', rol: '', controller: c2 });

      assert.equal(sub.matar([]), 2);
      assert.equal(c1.signal.aborted, true);
      assert.equal(c2.signal.aborted, true);
    } finally {
      limpiar();
    }
  });

  test('matar un id inexistente no rompe', () => {
    const { sub, limpiar } = montar();
    try {
      assert.equal(sub.matar(['sub-999']), 0);
    } finally {
      limpiar();
    }
  });
});

describe('bandeja de mensajes', () => {
  test('entrega a un id y se vacía al recogerlo', () => {
    const { sub, limpiar } = montar();
    try {
      const id = sub.registrar({ nombre: 'a', rol: 'Researcher', controller: new AbortController() });

      assert.equal(sub.enviarMensaje(id, 'cambia el enfoque'), 1);
      const recibido = sub.recogerMensajes(id);
      assert.match(recibido, /cambia el enfoque/);
      assert.equal(sub.recogerMensajes(id), undefined, 'la bandeja queda vacía');
    } finally {
      limpiar();
    }
  });

  test('@children difunde a todos los vivos', () => {
    const { sub, limpiar } = montar();
    try {
      const a = sub.registrar({ nombre: 'a', rol: '', controller: new AbortController() });
      const b = sub.registrar({ nombre: 'b', rol: '', controller: new AbortController() });

      assert.equal(sub.enviarMensaje('@children', 'aviso general'), 2);
      assert.match(sub.recogerMensajes(a), /aviso general/);
      assert.match(sub.recogerMensajes(b), /aviso general/);
    } finally {
      limpiar();
    }
  });

  test('un destinatario inexistente o un mensaje vacío no entrega nada', () => {
    const { sub, limpiar } = montar();
    try {
      sub.registrar({ nombre: 'a', rol: '', controller: new AbortController() });
      assert.equal(sub.enviarMensaje('sub-999', 'hola'), 0);
      assert.equal(sub.enviarMensaje('@children', '   '), 0);
    } finally {
      limpiar();
    }
  });
});

describe('grant de herramientas', () => {
  test('se guarda sin duplicados y sin vacíos', async () => {
    const { sub, limpiar } = montar();
    try {
      const entrada = await sub.definir({
        name: 'lector',
        role: 'Reader',
        description: 'solo lee',
        tools: ['read_file', ' read_file ', 'search_files', ''],
      });
      assert.deepEqual(entrada.tools, ['read_file', 'search_files']);
    } finally {
      limpiar();
    }
  });

  test('vacío deja todas; una lista filtra; no puede añadir herramientas', () => {
    const { sub, limpiar } = montar();
    try {
      const catalogo = [{ name: 'read_file' }, { name: 'run_command' }, { name: 'write_file' }];
      assert.equal(sub.filtrarPorGrant(catalogo, []).length, 3);
      assert.deepEqual(
        sub.filtrarPorGrant(catalogo, ['read_file', 'write_file']).map((t) => t.name),
        ['read_file', 'write_file'],
      );
      assert.equal(sub.filtrarPorGrant(catalogo, ['mcp_inexistente']).length, 0);
    } finally {
      limpiar();
    }
  });
});

describe('jerarquía y delegación', () => {
  test('guarda allowSubagents y lo devuelve al buscar', async () => {
    const { sub, limpiar } = montar();
    try {
      const entrada = await sub.definir({
        name: 'jefe',
        role: 'Lead',
        description: 'coordina',
        allowSubagents: true,
      });
      assert.equal(entrada.allowSubagents, true);
      assert.equal((await sub.buscar('jefe')).allowSubagents, true);
    } finally {
      limpiar();
    }
  });

  test('el registro guarda padre y profundidad', () => {
    const { sub, limpiar } = montar();
    try {
      const id = sub.registrar({
        nombre: 'hijo',
        rol: '',
        controller: new AbortController(),
        padre: 'sub-1',
        profundidad: 1,
      });
      const [vivo] = sub.listarEnEjecucion();
      assert.equal(vivo.id, id);
      assert.equal(vivo.padre, 'sub-1');
      assert.equal(vivo.profundidad, 1);
    } finally {
      limpiar();
    }
  });
});
