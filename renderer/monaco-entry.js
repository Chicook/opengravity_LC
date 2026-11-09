/**
 * Punto de entrada de Monaco.
 *
 * Se empaqueta con esbuild a `renderer/monaco/monaco.js`. Los workers se
 * emiten como ficheros hermanos y se cargan por ruta relativa al documento.
 */

import * as monaco from 'monaco-editor';

// Workers: TypeScript/JavaScript, JSON, CSS y HTML.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    const workers = {
      typescript: 'ts.worker.js',
      javascript: 'ts.worker.js',
      json: 'json.worker.js',
      css: 'css.worker.js',
      scss: 'css.worker.js',
      less: 'css.worker.js',
      html: 'html.worker.js',
      handlebars: 'html.worker.js',
      razor: 'html.worker.js',
    };

    return new Worker(`monaco/${workers[label] ?? 'editor.worker.js'}`);
  },
};

// Tema oscuro con la paleta de la interfaz analizada.
monaco.editor.defineTheme('agent-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8292a2', fontStyle: 'italic' },
    { token: 'string', foreground: 'a6e22e' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'keyword', foreground: '66d9ef' },
    { token: 'type.identifier', foreground: 'e6db74' },
    { token: 'identifier', foreground: 'f8f8f2' },
    { token: 'delimiter', foreground: 'f8f8f2' },
    { token: 'tag', foreground: 'f92672' },
    { token: 'attribute.name', foreground: 'a6e22e' },
    { token: 'attribute.value', foreground: 'e6db74' },
  ],
  colors: {
    'editor.background': '#101010',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#4d4d4d',
    'editorLineNumber.activeForeground': '#9d9d9d',
    'editor.selectionBackground': '#264f78',
    'editor.lineHighlightBackground': '#151515',
    'editorCursor.foreground': '#cccccc',
    'editorWidget.background': '#191919',
    'editorWidget.border': '#222222',
    'editorSuggestWidget.background': '#191919',
    'editorSuggestWidget.border': '#222222',
    'editorSuggestWidget.selectedBackground': '#272727',
    'editorHoverWidget.background': '#191919',
    'editorHoverWidget.border': '#222222',
    'editorError.foreground': '#f87171',
    'editorWarning.foreground': '#fbbf24',
    'scrollbarSlider.background': '#27272780',
    'scrollbarSlider.hoverBackground': '#3a3a3a99',
  },
});

window.MonacoApp = { monaco };
