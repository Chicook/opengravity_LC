/**
 * Herramientas de editor basadas en CDP.
 *
 * Dan al agente acceso al editor vivo (el renderer de Electron): leer lo que se
 * ve, ejecutar comandos y abrir ficheros. Es el equivalente al puente que un IDE
 * con agentes necesita para "tocar" la interfaz.
 *
 * Limitación honesta: `editor_open_file` depende del atajo Ctrl+P del workbench.
 * Si el editor cambia sus keybindings, deja de funcionar. `editor_evaluate` es
 * el escape cuando eso pasa.
 */

import { defineTool, type Tool } from '../tools/types.js';
import type { CdpClient } from './cdp.js';

/** Modificador Ctrl en `Input.dispatchKeyEvent`. */
const MODIFIER_CTRL = 2;

/** Envía una pulsación completa (down + up). */
async function pressKey(
  cdp: CdpClient,
  key: string,
  code: string,
  virtualKeyCode: number,
  modifiers = 0,
): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
}

/** Escribe texto en el elemento con foco. */
async function typeText(cdp: CdpClient, text: string): Promise<void> {
  await cdp.send('Input.insertText', { text });
}

/** Conjunto de herramientas de editor para un cliente CDP ya conectado. */
export function editorTools(cdp: CdpClient): Tool[] {
  return [
    defineTool({
      name: 'editor_evaluate',
      description:
        'Ejecuta JavaScript en el contexto del editor y devuelve el resultado. ' +
        'Úsalo para inspeccionar el DOM o invocar APIs del workbench. ' +
        'La expresión se evalúa tal cual: no ejecutes nada destructivo sin motivo.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Expresión JavaScript. Su valor de retorno se devuelve como JSON.',
          },
        },
        required: ['expression'],
      },
      async execute(args) {
        const expression = String(args['expression'] ?? '');
        if (expression.length === 0) {
          return { content: 'Falta el parámetro `expression`.', isError: true };
        }

        const value = await cdp.evaluate(expression);
        const serialized = JSON.stringify(value, null, 2) ?? 'undefined';

        return {
          content: serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}\n[truncado]` : serialized,
        };
      },
    }),

    defineTool({
      name: 'editor_visible_text',
      description:
        'Devuelve el texto visible del editor (lo que el usuario ve en pantalla). ' +
        'Útil para saber en qué fichero está y qué hay alrededor del cursor.',
      parameters: {
        type: 'object',
        properties: {
          maxChars: {
            type: 'number',
            description: 'Máximo de caracteres a devolver. Por defecto 8000.',
          },
        },
        required: [],
      },
      async execute(args) {
        const maxChars = Number(args['maxChars'] ?? 8_000);

        const text = await cdp.evaluate<string>(
          'document.body ? document.body.innerText : ""',
        );

        const trimmed = (text ?? '').trim();
        if (trimmed.length === 0) {
          return { content: '(no hay texto visible)' };
        }

        return {
          content: trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n[truncado]` : trimmed,
        };
      },
    }),

    defineTool({
      name: 'editor_open_file',
      description:
        'Abre un fichero en el editor usando el diálogo de búsqueda rápida (Ctrl+P). ' +
        'Acepta rutas absolutas o relativas al workspace. ' +
        'Depende del keybinding por defecto del editor.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta del fichero a abrir.' },
        },
        required: ['path'],
      },
      async execute(args) {
        const path = String(args['path'] ?? '');
        if (path.length === 0) {
          return { content: 'Falta el parámetro `path`.', isError: true };
        }

        // Ctrl+P abre el quick open.
        await pressKey(cdp, 'p', 'KeyP', 80, MODIFIER_CTRL);
        await new Promise((resolve) => setTimeout(resolve, 250));

        await typeText(cdp, path);
        await new Promise((resolve) => setTimeout(resolve, 250));

        await pressKey(cdp, 'Enter', 'Enter', 13);
        await new Promise((resolve) => setTimeout(resolve, 250));

        return { content: `Abierto ${path} en el editor.` };
      },
    }),

    defineTool({
      name: 'editor_current_file',
      description:
        'Devuelve la ruta del fichero activo y el título de la ventana, si el editor lo expone en el DOM.',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        const info = await cdp.evaluate<{ title: string; activeTab: string | null }>(`(() => {
          const active = document.querySelector('.tab.active .label-name, .tabs-container .tab.active');
          return {
            title: document.title,
            activeTab: active ? (active.textContent || '').trim() : null,
          };
        })()`);

        return {
          content: JSON.stringify(info, null, 2),
        };
      },
    }),
  ];
}
