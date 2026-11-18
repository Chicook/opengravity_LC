import test from 'node:test';
import assert from 'node:assert/strict';

const { renderPanelScreen } = await import('../dist/cli/tui-panels.js');

test('la pantalla de paneles pinta cabecera, pestañas y contenido', () => {
  const tabs = [
    { id: 'estado', title: 'Estado', lines: ['Modelo x', 'Modo default'] },
    { id: 'sesiones', title: 'Sesiones', lines: ['s1 — prueba'] },
  ];
  const texto = renderPanelScreen(tabs, { tab: 0, scroll: 0 }, 100, 24);

  assert.match(texto, /Opengravity · TUI/);
  assert.match(texto, /Estado/);
  assert.match(texto, /Modelo x/);
  assert.match(texto, /q salir/);
  const limpio = texto.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  assert.ok(limpio.split('\n').filter(Boolean).every((linea) => linea.length <= 100));
});

test('la pestaña activa cambia el contenido y el scroll recorta', () => {
  const tabs = [
    { id: 'a', title: 'A', lines: ['uno', 'dos'] },
    { id: 'b', title: 'B', lines: ['tres', 'cuatro'] },
  ];
  const pagina1 = renderPanelScreen(tabs, { tab: 1, scroll: 1 }, 100, 24);
  assert.match(pagina1, /cuatro/);
  assert.doesNotMatch(pagina1, /uno/);
});
