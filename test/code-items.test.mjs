// Localización de símbolos: TypeScript, JavaScript, Python y fallbacks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modulo } from './helpers.mjs';

const { listCodeItems, readCodeItem } = modulo('code-items');

const TS = `
export class Motor {
  private estado = 0;
  arrancar(): void { this.estado = 1; }
  parar(): void {
    this.estado = 0;
  }
  get activo() { return this.estado === 1; }
}
export function ayudante(x: number) { return x * 2; }
export interface Opciones { nombre: string }
export type Modo = 'a' | 'b';
export enum Color { Rojo, Azul }
export const flecha = (n: number) => n + 1;
`;

const PY = `import os

def uno():
    return 1

class Caja:
    def abrir(self):
        pass
    def cerrar(self):
        pass
`;

const GO = `package main

func principal() {
    println("hola")
}

type Cosa struct {
    Nombre string
}
`;

describe('listCodeItems en TypeScript', () => {
  const items = listCodeItems('motor.ts', TS);
  const rutas = items.map((i) => i.path);

  test('encuentra la clase, sus métodos y los tipos', () => {
    assert.ok(rutas.includes('Motor'), 'falta la clase');
    assert.ok(rutas.includes('Motor.arrancar'), 'falta el método');
    assert.ok(rutas.includes('Motor.parar'), 'falta el método');
    assert.ok(rutas.includes('Motor.activo'), 'falta el getter');
    assert.ok(rutas.includes('ayudante'), 'falta la función');
    assert.ok(rutas.includes('Opciones'), 'falta la interfaz');
    assert.ok(rutas.includes('Modo'), 'falta el tipo');
    assert.ok(rutas.includes('Color'), 'falta el enum');
    assert.ok(rutas.includes('flecha'), 'falta la arrow function');
  });

  test('no mete la propiedad que no es función', () => {
    assert.ok(!rutas.includes('Motor.estado'), 'estado es un número, no un método');
  });

  test('los rangos son coherentes', () => {
    for (const item of items) {
      assert.ok(item.startLine >= 1, `${item.path} empieza antes de la línea 1`);
      assert.ok(item.endLine >= item.startLine, `${item.path} acaba antes de empezar`);
    }
  });
});

describe('readCodeItem', () => {
  test('devuelve el texto exacto del símbolo', () => {
    const encontrado = readCodeItem('motor.ts', TS, 'Motor.parar');
    assert.ok(encontrado);
    assert.match(encontrado.texto, /parar\(\): void/);
    assert.match(encontrado.texto, /this\.estado = 0/);
    assert.ok(!encontrado.texto.includes('arrancar'), 'no debe tragarse el método anterior');
  });

  test('resuelve por sufijo cuando es inequívoco', () => {
    const encontrado = readCodeItem('motor.ts', TS, 'arrancar');
    assert.ok(encontrado);
    assert.equal(encontrado.path, 'Motor.arrancar');
  });

  test('devuelve null si no existe', () => {
    assert.equal(readCodeItem('motor.ts', TS, 'noExiste'), null);
  });

  test('devuelve null con una ruta vacía', () => {
    assert.equal(readCodeItem('motor.ts', TS, '   '), null);
  });
});

describe('lenguajes sin AST', () => {
  test('Python: rangos por indentación', () => {
    const items = listCodeItems('x.py', PY);
    const porNombre = Object.fromEntries(items.map((i) => [i.path, i]));

    assert.equal(porNombre.uno.startLine, 3);
    assert.equal(porNombre.uno.endLine, 4);
    assert.equal(porNombre.Caja.startLine, 6);
    assert.equal(porNombre.Caja.endLine, 10);
    assert.equal(porNombre.abrir.startLine, 7);
    assert.equal(porNombre.abrir.endLine, 8);
  });

  test('Go: funciones y tipos por llaves', () => {
    const items = listCodeItems('x.go', GO);
    const rutas = items.map((i) => i.path);
    assert.ok(rutas.includes('principal'));
    assert.ok(rutas.includes('Cosa'));
  });

  test('no desplaza las líneas por los saltos de línea', () => {
    // Regresión: `\s*` tras `^` se comía los saltos y desplazaba los números.
    const items = listCodeItems('x.py', 'import os\n\ndef uno():\n    return 1\n');
    const uno = items.find((i) => i.path === 'uno');
    assert.equal(uno.startLine, 3, 'la función empieza en la línea 3, no en la 2');
  });
});

describe('casos límite', () => {
  test('un fichero vacío no produce símbolos', () => {
    assert.deepEqual(listCodeItems('vacio.ts', ''), []);
  });

  test('un fichero sin símbolos no produce símbolos', () => {
    assert.deepEqual(listCodeItems('x.ts', 'const a = 1;\nconst b = 2;\n'), []);
  });

  test('no repite rutas', () => {
    const items = listCodeItems('motor.ts', TS);
    const rutas = items.map((i) => i.path);
    assert.equal(new Set(rutas).size, rutas.length);
  });
});
