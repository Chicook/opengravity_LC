'use strict';

/**
 * Resaltado de sintaxis.
 *
 * Sin dependencias: un tokenizador por expresiones regulares que cubre los
 * lenguajes habituales en un chat de código.
 *
 * Los colores salen del tema oscuro de la interfaz analizada (Monokai), leídos
 * de sus variables `--syntax-*`. Aquí solo se emiten clases; el color lo pone
 * el CSS.
 *
 * Se expone como `window.Highlight.render(code, lang)`.
 */

(function () {
  const KEYWORDS = new Set([
    // JS/TS
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class',
    'new', 'await', 'async', 'import', 'export', 'from', 'default', 'try', 'catch', 'finally',
    'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false',
    'extends', 'super', 'switch', 'case', 'break', 'continue', 'delete', 'void', 'yield',
    'static', 'interface', 'type', 'enum', 'implements', 'public', 'private', 'protected',
    'readonly', 'as', 'satisfies', 'declare', 'namespace', 'abstract', 'keyof', 'infer',
    // Python
    'def', 'elif', 'lambda', 'pass', 'raise', 'with', 'global', 'nonlocal', 'assert', 'not',
    'and', 'or', 'is', 'None', 'True', 'False', 'self',
    // Shell
    'then', 'fi', 'done', 'esac', 'echo', 'exit', 'local', 'export', 'source', 'cd',
    // C-like
    'struct', 'typedef', 'sizeof', 'goto', 'extern', 'inline', 'unsigned', 'signed', 'long',
    'short', 'float', 'double', 'char', 'int', 'bool', 'auto', 'template', 'typename',
  ]);

  const BUILTINS = new Set([
    'console', 'window', 'document', 'process', 'require', 'module', 'exports', 'JSON',
    'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set',
    'Error', 'Date', 'RegExp', 'Symbol', 'BigInt', 'globalThis', 'Buffer', 'fetch',
    'print', 'len', 'range', 'str', 'int', 'dict', 'list', 'open',
  ]);

  const LANG_ALIASES = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    py: 'python',
    yml: 'yaml',
    md: 'markdown',
    htm: 'html',
  };

  /** Escapa HTML. */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function span(cls, text) {
    return `<span class="tok-${cls}">${text}</span>`;
  }

  /**
   * Tokenizador genérico.
   * Prioriza comentarios y cadenas para que no se partan por dentro.
   */
  function tokenize(code, language) {
    const isMarkup = language === 'html' || language === 'xml' || language === 'svg';
    const isCss = language === 'css' || language === 'scss';
    const isJson = language === 'json';
    const isBash = language === 'bash';
    const isPython = language === 'python';

    const out = [];
    let index = 0;
    const length = code.length;

    const commentStart = isBash || isPython ? '#' : '//';

    while (index < length) {
      const rest = code.slice(index);

      // Comentario de línea
      if (rest.startsWith(commentStart)) {
        const end = code.indexOf('\n', index);
        const stop = end === -1 ? length : end;
        out.push(span('comment', escapeHtml(code.slice(index, stop))));
        index = stop;
        continue;
      }

      // Comentario de bloque
      if (rest.startsWith('/*')) {
        const end = code.indexOf('*/', index + 2);
        const stop = end === -1 ? length : end + 2;
        out.push(span('comment', escapeHtml(code.slice(index, stop))));
        index = stop;
        continue;
      }

      // Cadenas
      const quote = rest[0];
      if (quote === '"' || quote === "'" || quote === '`') {
        let cursor = index + 1;
        while (cursor < length) {
          if (code[cursor] === '\\') {
            cursor += 2;
            continue;
          }
          if (code[cursor] === quote) {
            cursor += 1;
            break;
          }
          if (code[cursor] === '\n' && quote !== '`') break;
          cursor += 1;
        }
        out.push(span('string', escapeHtml(code.slice(index, cursor))));
        index = cursor;
        continue;
      }

      // Números
      const number = rest.match(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
      if (number) {
        out.push(span('number', number[0]));
        index += number[0].length;
        continue;
      }

      // Identificadores
      const word = rest.match(/^[A-Za-z_$][\w$]*/);
      if (word) {
        const value = word[0];
        const after = code.slice(index + value.length).match(/^\s*\(/);
        const before = code.slice(Math.max(0, index - 2), index);

        if (isMarkup && (before.endsWith('<') || before.endsWith('</'))) {
          out.push(span('tag', value));
        } else if (isCss && /^\s*:/.test(code.slice(index + value.length))) {
          out.push(span('property', value));
        } else if (isJson && /^\s*:/.test(code.slice(index + value.length))) {
          out.push(span('property', value));
        } else if (KEYWORDS.has(value)) {
          out.push(span('keyword', value));
        } else if (BUILTINS.has(value)) {
          out.push(span('builtin', value));
        } else if (after) {
          out.push(span('function', value));
        } else if (/^[A-Z]/.test(value) && !isMarkup) {
          out.push(span('class-name', value));
        } else {
          out.push(escapeHtml(value));
        }

        index += value.length;
        continue;
      }

      // Operadores y puntuación
      const op = rest.match(/^[{}()[\];,.:=+\-*/%<>!&|^~?@\\]+/);
      if (op) {
        out.push(span('operator', escapeHtml(op[0])));
        index += op[0].length;
        continue;
      }

      // Cualquier otra cosa (espacios, saltos, unicode)
      out.push(escapeHtml(rest[0]));
      index += 1;
    }

    return out.join('');
  }

  /**
   * Devuelve el HTML resaltado de un bloque de código.
   * Si el lenguaje no está soportado, devuelve el texto escapado.
   */
  function render(code, lang) {
    const raw = String(code ?? '');
    const language = LANG_ALIASES[String(lang ?? '').toLowerCase()] ?? String(lang ?? '').toLowerCase();

    if (raw.length === 0) return '';
    if (raw.length > 60000) return escapeHtml(raw); // demasiado grande: sin resaltar

    const supported = new Set([
      'javascript', 'typescript', 'json', 'bash', 'python', 'html', 'xml', 'svg', 'css',
      'scss', 'yaml', 'java', 'go', 'rust', 'c', 'cpp', 'sql', 'markdown',
    ]);

    if (!supported.has(language)) return escapeHtml(raw);

    try {
      return tokenize(raw, language);
    } catch {
      return escapeHtml(raw);
    }
  }

  window.Highlight = { render };
})();
