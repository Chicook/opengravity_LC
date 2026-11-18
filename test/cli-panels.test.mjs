import test from 'node:test';
import assert from 'node:assert/strict';

const { caja, panelEstado, panelSesiones } = await import('../dist/cli/panels.js');

test('las cajas mantienen el ancho de 78 caracteres', () => {
  const texto = caja('Prueba', ['Modelo  uno', 'Modo    default']);
  const lineas = texto.split('\n');
  assert.equal(lineas[0].length, 78);
  assert.equal(lineas.at(-1).length, 78);
  assert.ok(lineas.slice(1, -1).every((linea) => linea.length === 78));
  assert.match(texto, /Modelo/);
});

test('el panel de estado resume modelo, permisos y catálogo', () => {
  const texto = panelEstado({
    modelo: 'modelo-x',
    modo: 'default',
    ventana: 128000,
    mensajes: 3,
    herramientas: ['read_file', 'edit_file'],
    sandbox: false,
    permisos: { allow: ['command(git)'], deny: ['write_file(.env)'] },
    mcp: ['filesystem'],
    skills: [{ name: 'skill-a' }],
    agentes: [{ name: 'lector', role: 'Reader' }],
    sesion: 'sesion-1',
    planFase: 'libre',
  });
  assert.match(texto, /modelo-x/);
  assert.match(texto, /read_file/);
  assert.match(texto, /allow 1/);
  assert.match(texto, /skill-a/);
  assert.match(texto, /lector/);
});

test('el panel de sesiones vacío lo dice y el lleno lista ids', () => {
  assert.match(panelSesiones([]), /No hay conversaciones/);
  const texto = panelSesiones([
    { id: 's1', title: 'Una conversación', updatedAt: '2026-11-17T00:00:00Z', messageCount: 2 },
  ]);
  assert.match(texto, /s1/);
  assert.match(texto, /Una conversación/);
});
