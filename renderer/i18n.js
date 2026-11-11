'use strict';

/**
 * Motor de idioma de la interfaz.
 *
 * La app históricamente mezclaba inglés y español en el DOM y en el código.
 * Para no reescribir cientos de literales, el motor traduce los nodos de texto
 * y los atributos visibles por su contenido: cada entrada de I18N_STRINGS tiene
 * el texto en inglés y en español, y el motor busca por cualquiera de los dos.
 *
 * El contenido del usuario y del agente nunca se traduce: se excluyen los
 * mensajes, el markdown, el editor, la terminal y los títulos de conversación.
 */
(function () {
  const SKIP = [
    '.msg',
    '.markdown',
    '.cm-editor',
    '.monaco-editor',
    '.xterm',
    'pre',
    'code',
    'textarea',
    '[contenteditable="true"]',
    '.conversation__title',
    '.pane__title',
    '.work-row__cmd',
    '.work-row__output',
  ].join(',');

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const patterns = Array.isArray(window.I18N_PATTERNS) ? window.I18N_PATTERNS : [];
  const entries = Array.isArray(window.I18N_STRINGS) ? window.I18N_STRINGS : [];
  const lookup = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.en !== 'string' || typeof entry.es !== 'string') continue;
    const en = normalizar(entry.en);
    const es = normalizar(entry.es);
    if (en.length === 0 || es.length === 0) continue;
    lookup.set(en, entry);
    lookup.set(es, entry);
  }

  let language = 'en';
  let observer = null;
  let scheduled = false;
  const pendientes = new Set();

  function normalizar(texto) {
    return String(texto).replace(/\s+/g, ' ').trim();
  }

  function traducir(texto) {
    const normalizado = normalizar(texto);
    const entrada = lookup.get(normalizado);
    if (entrada) return entrada[language] ?? texto;

    for (const patron of patterns) {
      const regex = patron.re;
      if (!(regex instanceof RegExp) || !regex.test(normalizado)) continue;
      const plantilla = language === 'es' ? patron.toEs : patron.toEn;
      if (typeof plantilla === 'string') return normalizado.replace(regex, plantilla);
    }

    // Los errores de proveedores se generan como una sola frase con nombres
    // de variables; se traducen aquí para no dejar media frase en inglés.
    if (language === 'en' && normalizado.startsWith('Ningún proveedor disponible.')) {
      return normalizado
        .replace('Ningún proveedor disponible.', 'No provider available.')
        .replace(/falta ([A-Z0-9_]+) o una clave guardada/g, 'missing $1 or a saved key')
        .replace(/no disponible/g, 'unavailable')
        .replace(/sin clave/g, 'no key');
    }
    if (language === 'es' && normalizado.startsWith('No provider available.')) {
      return normalizado
        .replace('No provider available.', 'Ningún proveedor disponible.')
        .replace(/missing ([A-Z0-9_]+) or a saved key/g, 'falta $1 o una clave guardada')
        .replace(/unavailable/g, 'no disponible')
        .replace(/no key/g, 'sin clave');
    }

    return texto;
  }

  /** Traduce una cadena y sustituye {variables}. */
  function t(texto, variables) {
    let salida = traducir(String(texto));
    if (variables && typeof variables === 'object') {
      salida = salida.replace(/\{(\w+)\}/g, (_, clave) =>
        Object.prototype.hasOwnProperty.call(variables, clave) ? String(variables[clave]) : `{${clave}}`,
      );
    }
    return salida;
  }

  function omitido(nodo) {
    const el = nodo.nodeType === Node.ELEMENT_NODE ? nodo : nodo.parentElement;
    return Boolean(el && el.closest(SKIP));
  }

  function traducirNodoTexto(nodo) {
    if (omitido(nodo)) return;
    const original = nodo.nodeValue;
    if (!original || !/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(original)) return;
    const partes = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!partes) return;
    const traducido = traducir(partes[2]);
    if (traducido !== partes[2]) nodo.nodeValue = `${partes[1]}${traducido}${partes[3]}`;
  }

  function traducirAtributos(elemento) {
    // Los placeholders viven en inputs/textarea, que se omiten para el texto.
    for (const nombre of ATTRS) {
      if (!elemento.hasAttribute(nombre)) continue;
      const valor = elemento.getAttribute(nombre);
      const traducido = traducir(valor);
      if (traducido !== valor) elemento.setAttribute(nombre, traducido);
    }
  }

  function traducirArbol(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === Node.TEXT_NODE) {
      traducirNodoTexto(raiz);
      return;
    }
    if (!(raiz instanceof Element)) return;
    traducirAtributos(raiz);
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let nodo = walker.nextNode();
    while (nodo) {
      traducirNodoTexto(nodo);
      nodo = walker.nextNode();
    }
    for (const elemento of raiz.querySelectorAll('*')) traducirAtributos(elemento);
  }

  function programar(raiz) {
    pendientes.add(raiz);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const raices = [...pendientes];
      pendientes.clear();
      for (const raiz of raices) traducirArbol(raiz);
    });
  }

  function iniciarObservador() {
    if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
    observer = new MutationObserver((mutaciones) => {
      for (const mutacion of mutaciones) {
        if (mutacion.type === 'characterData') {
          traducirNodoTexto(mutacion.target);
          continue;
        }
        for (const nodo of mutacion.addedNodes) {
          if (nodo.nodeType === Node.TEXT_NODE) traducirNodoTexto(nodo);
          else if (nodo.nodeType === Node.ELEMENT_NODE) programar(nodo);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function setLanguage(siguiente) {
    language = siguiente === 'es' ? 'es' : 'en';
    document.documentElement.lang = language;
    traducirArbol(document.documentElement);
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { language } }));
    return language;
  }

  function resolveLanguage(preferencia) {
    if (preferencia === 'en' || preferencia === 'es') return preferencia;
    const sistema = String(navigator.language || 'en').toLowerCase();
    return sistema.startsWith('es') ? 'es' : 'en';
  }

  window.I18n = {
    t,
    setLanguage,
    resolveLanguage,
    translateDom: (raiz = document.documentElement) => traducirArbol(raiz),
    start: () => {
      traducirArbol(document.documentElement);
      iniciarObservador();
    },
    get language() {
      return language;
    },
  };

  // Los scripts se cargan al final del body; si el DOM ya está listo, arranca.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.I18n.start(), { once: true });
  } else {
    window.I18n.start();
  }
})();
