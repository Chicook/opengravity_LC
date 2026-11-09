// Expresiones cron: parseo, validación y cálculo de la próxima ejecución.
//
// Las fechas esperadas se construyen en hora local a propósito, para que el test no
// dependa de la zona horaria de la máquina que lo ejecute.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const { compilarCron, siguienteEjecucion, describirCron } = modulo('cron');

/** Miércoles 4 de noviembre de 2026, 10:07 en hora local. */
const BASE = new Date(2026, 10, 4, 10, 7, 0, 0);

describe('compilarCron', () => {
  const validas = [
    ['* * * * *', 'todos los comodines'],
    ['*/5 * * * *', 'paso con comodín'],
    ['0 9 * * *', 'hora y minuto fijos'],
    ['0 9 * * 1-5', 'rango en día de la semana'],
    ['30 2 1 * *', 'día del mes concreto'],
    ['0 8,12,18 * * *', 'lista de horas'],
    ['0 0-20/5 * * *', 'rango con paso'],
  ];

  for (const [expresion, descripcion] of validas) {
    test(`acepta "${expresion}" (${descripcion})`, () => {
      const compilado = compilarCron(expresion);
      assert.equal(typeof compilado, 'object');
      assert.equal(compilado.expresion, expresion);
    });
  }

  const invalidas = [
    ['0 9 * *', 'cuatro campos'],
    ['0 9 * * * *', 'seis campos'],
    ['99 * * * *', 'minuto fuera de rango'],
    ['* 24 * * *', 'hora fuera de rango'],
    ['* * 0 * *', 'día del mes fuera de rango'],
    ['* * * 13 *', 'mes fuera de rango'],
    ['* * * * 7', 'día de la semana fuera de rango'],
    ['*/0 * * * *', 'paso cero'],
    ['5-1 * * * *', 'rango invertido'],
    ['', 'vacía'],
  ];

  for (const [expresion, motivo] of invalidas) {
    test(`rechaza "${expresion}" (${motivo})`, () => {
      assert.throws(() => compilarCron(expresion));
    });
  }
});

describe('siguienteEjecucion', () => {
  /** Comprueba que la próxima ejecución es exactamente la fecha esperada. */
  const comprobar = (expresion, esperado) => {
    const obtenido = siguienteEjecucion(expresion, BASE);
    assert.ok(obtenido, `"${expresion}" no devolvió ninguna fecha`);
    assert.equal(obtenido.getTime(), esperado.getTime(), `"${expresion}" dio ${obtenido.toLocaleString()}`);
  };

  test('cada 5 minutos desde las 10:07 son las 10:10', () => {
    comprobar('*/5 * * * *', new Date(2026, 10, 4, 10, 10));
  });

  test('las 9 de la mañana, si ya pasaron, son mañana', () => {
    comprobar('0 9 * * *', new Date(2026, 10, 5, 9, 0));
  });

  test('de lunes a viernes salta el fin de semana', () => {
    // 4 nov 2026 es miércoles; la siguiente es el jueves.
    comprobar('0 9 * * 1-5', new Date(2026, 10, 5, 9, 0));
  });

  test('el día 1 de cada mes salta al mes siguiente', () => {
    comprobar('30 2 1 * *', new Date(2026, 11, 1, 2, 30));
  });

  test('una lista de horas elige la siguiente del día', () => {
    comprobar('0 8,12,18 * * *', new Date(2026, 10, 4, 12, 0));
  });

  test('una fecha imposible devuelve null en vez de colgarse', () => {
    assert.equal(siguienteEjecucion('0 0 31 2 *', BASE), null);
  });

  test('acepta una expresión ya compilada', () => {
    const compilado = compilarCron('*/15 * * * *');
    const obtenido = siguienteEjecucion(compilado, BASE);
    assert.equal(obtenido.getTime(), new Date(2026, 10, 4, 10, 15).getTime());
  });

  test('nunca devuelve el mismo instante de partida', () => {
    const exacto = new Date(2026, 10, 4, 10, 10, 0, 0);
    const obtenido = siguienteEjecucion('*/5 * * * *', exacto);
    assert.ok(obtenido.getTime() > exacto.getTime());
  });
});

describe('describirCron', () => {
  test('describe un intervalo en minutos', () => {
    assert.match(describirCron('*/10 * * * *'), /cada 10 min/);
  });

  test('describe una hora concreta', () => {
    assert.match(describirCron('0 9 * * 1-5'), /09:00/);
  });

  test('avisa de una expresión inválida en vez de lanzar', () => {
    assert.match(describirCron('no es cron'), /inválida/);
  });
});
