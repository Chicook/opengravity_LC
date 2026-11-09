// Localiza símbolos dentro de un fichero y devuelve su rango exacto.
//
// Es lo que hace `view_code_item` en Antigravity: leer un símbolo concreto en vez
// del fichero entero. Para TypeScript/JavaScript usa el AST de verdad; para el resto
// de lenguajes cae a un localizador por bloques (llaves o indentación).

const path = require('node:path');

let tsCache = null;
function cargarTypeScript() {
  if (tsCache !== null) return tsCache;
  try {
    tsCache = require('typescript');
  } catch {
    tsCache = false;
  }
  return tsCache;
}

const EXTENSIONES_TS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/** Convierte un desplazamiento de carácter en número de línea (1-indexado). */
function lineaEn(contenido, desplazamiento) {
  let linea = 1;
  for (let i = 0; i < desplazamiento && i < contenido.length; i += 1) {
    if (contenido.charCodeAt(i) === 10) linea += 1;
  }
  return linea;
}

/** Índice de líneas para no recorrer el fichero en cada símbolo. */
function creadorDeLineas(contenido) {
  const inicios = [0];
  for (let i = 0; i < contenido.length; i += 1) {
    if (contenido.charCodeAt(i) === 10) inicios.push(i + 1);
  }
  return (desplazamiento) => {
    let bajo = 0;
    let alto = inicios.length - 1;
    while (bajo < alto) {
      const medio = Math.ceil((bajo + alto) / 2);
      if (inicios[medio] <= desplazamiento) bajo = medio;
      else alto = medio - 1;
    }
    return bajo + 1;
  };
}

function scriptKindDe(extension) {
  const ts = cargarTypeScript();
  if (!ts) return null;
  switch (extension) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/** Símbolos de un fichero TypeScript/JavaScript, con rutas anidadas. */
function itemsDeTypeScript(contenido, extension) {
  const ts = cargarTypeScript();
  if (!ts) return null;

  const fuente = ts.createSourceFile(
    'modulo' + extension,
    contenido,
    ts.ScriptTarget.Latest,
    true,
    scriptKindDe(extension) ?? ts.ScriptKind.TS,
  );
  const lineaDe = creadorDeLineas(contenido);
  const items = [];

  const nombreDe = (nodo) => {
    if (!nodo.name) return null;
    if (ts.isIdentifier(nodo.name) || ts.isPrivateIdentifier(nodo.name)) return nodo.name.text;
    if (ts.isStringLiteral(nodo.name)) return nodo.name.text;
    return null;
  };

  const registrar = (ruta, tipo, nodo) => {
    const desde = nodo.getStart(fuente);
    const hasta = nodo.getEnd();
    items.push({
      path: ruta,
      kind: tipo,
      startLine: lineaDe(desde),
      endLine: lineaDe(Math.max(desde, hasta - 1)),
    });
  };

  const visitarMiembroDeClase = (miembro, prefijo) => {
    const nombre = nombreDe(miembro);
    if (!nombre) return;
    if (
      ts.isMethodDeclaration(miembro) ||
      ts.isMethodSignature(miembro) ||
      ts.isGetAccessor(miembro) ||
      ts.isSetAccessor(miembro) ||
      ts.isConstructorDeclaration(miembro)
    ) {
      registrar(`${prefijo}.${nombre}`, 'method', miembro);
    } else if (ts.isPropertyDeclaration(miembro) || ts.isPropertySignature(miembro)) {
      // Solo propiedades cuyo valor es una función: son las que interesa leer.
      const inicializador = miembro.initializer;
      if (inicializador && (ts.isArrowFunction(inicializador) || ts.isFunctionExpression(inicializador))) {
        registrar(`${prefijo}.${nombre}`, 'method', miembro);
      }
    }
  };

  const visitar = (nodo, prefijo) => {
    // Funciones y clases con nombre.
    if (ts.isFunctionDeclaration(nodo)) {
      const nombre = nombreDe(nodo);
      if (nombre) {
        const ruta = prefijo ? `${prefijo}.${nombre}` : nombre;
        registrar(ruta, 'function', nodo);
      }
    } else if (ts.isClassDeclaration(nodo)) {
      const nombre = nombreDe(nodo);
      if (nombre) {
        const ruta = prefijo ? `${prefijo}.${nombre}` : nombre;
        registrar(ruta, 'class', nodo);
        for (const miembro of nodo.members) visitarMiembroDeClase(miembro, ruta);
      }
    } else if (ts.isInterfaceDeclaration(nodo)) {
      const nombre = nombreDe(nodo);
      if (nombre) registrar(prefijo ? `${prefijo}.${nombre}` : nombre, 'interface', nodo);
    } else if (ts.isTypeAliasDeclaration(nodo) || ts.isEnumDeclaration(nodo)) {
      const nombre = nombreDe(nodo);
      if (nombre) {
        registrar(
          prefijo ? `${prefijo}.${nombre}` : nombre,
          ts.isEnumDeclaration(nodo) ? 'enum' : 'type',
          nodo,
        );
      }
    } else if (ts.isVariableDeclaration(nodo)) {
      const nombre = nombreDe(nodo);
      const inicializador = nodo.initializer;
      if (
        nombre &&
        inicializador &&
        (ts.isArrowFunction(inicializador) || ts.isFunctionExpression(inicializador))
      ) {
        registrar(prefijo ? `${prefijo}.${nombre}` : nombre, 'function', nodo);
      }
    }

    ts.forEachChild(nodo, (hijo) => visitar(hijo, prefijo));
  };

  visitar(fuente, '');
  return items;
}

// --- Fallback para lenguajes sin AST -----------------------------------------

const PATRONES_GENERICOS = [
  {
    tipo: 'class',
    re: /^[ \t]*(?:export[ \t]+)?(?:public[ \t]+|private[ \t]+|abstract[ \t]+)*class[ \t]+([A-Za-z_][\w$]*)/gm,
  },
  {
    tipo: 'function',
    re: /^[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?(?:def|func|fn|function)[ \t]+([A-Za-z_][\w$]*)/gm,
  },
  {
    tipo: 'interface',
    re: /^[ \t]*(?:export[ \t]+)?interface[ \t]+([A-Za-z_][\w$]*)/gm,
  },
  {
    tipo: 'type',
    re: /^[ \t]*(?:export[ \t]+)?type[ \t]+([A-Za-z_][\w$]*)/gm,
  },
];

/** Encuentra el final del bloque que empieza en `desde`, contando llaves. */
function finDeBloquePorLlaves(contenido, desde) {
  let profundidad = 0;
  let visto = false;
  for (let i = desde; i < contenido.length; i += 1) {
    const c = contenido[i];
    if (c === '{') {
      profundidad += 1;
      visto = true;
    } else if (c === '}') {
      profundidad -= 1;
      if (visto && profundidad === 0) return i + 1;
    }
  }
  return contenido.length;
}

/** Encuentra el final del bloque por indentación (Python, YAML). */
function finDeBloquePorIndentacion(lineas, indiceInicial, sangria) {
  let fin = indiceInicial;
  for (let i = indiceInicial + 1; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (linea.trim().length === 0) continue;
    const actual = linea.length - linea.trimStart().length;
    if (actual <= sangria) break;
    fin = i;
  }
  return fin;
}

function itemsGenericos(contenido, extension) {
  const lineas = contenido.split('\n');
  const items = [];
  const esPython = extension === '.py';

  for (const { tipo, re } of PATRONES_GENERICOS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(contenido)) !== null) {
      const nombre = m[1];
      if (!nombre) continue;
      const inicio = lineaEn(contenido, m.index);
      let fin;

      if (esPython) {
        const sangria = lineas[inicio - 1].length - lineas[inicio - 1].trimStart().length;
        fin = finDeBloquePorIndentacion(lineas, inicio - 1, sangria) + 1;
      } else {
        const hasta = finDeBloquePorLlaves(contenido, m.index + m[0].length);
        fin = lineaEn(contenido, Math.max(m.index, hasta - 1));
      }

      items.push({ path: nombre, kind: tipo, startLine: inicio, endLine: fin });
    }
  }

  return items;
}

/** Lista los símbolos de un fichero. */
function listCodeItems(filePath, contenido) {
  const extension = path.extname(filePath).toLowerCase();
  let items = null;

  if (EXTENSIONES_TS.has(extension)) items = itemsDeTypeScript(contenido, extension);
  if (items === null || items.length === 0) items = itemsGenericos(contenido, extension);

  // Sin duplicados por ruta, quedándose con el primero.
  const vistos = new Set();
  return items.filter((item) => {
    if (vistos.has(item.path)) return false;
    vistos.add(item.path);
    return true;
  });
}

/** Devuelve el texto de un símbolo, buscando por ruta exacta o por sufijo. */
function readCodeItem(filePath, contenido, rutaPedida) {
  const items = listCodeItems(filePath, contenido);
  if (items.length === 0) return null;

  const buscada = String(rutaPedida ?? '').trim();
  if (buscada.length === 0) return null;

  let encontrado = items.find((item) => item.path === buscada);

  // Si no coincide exacto, acepta un sufijo: `metodo` encuentra `Clase.metodo`.
  if (!encontrado) {
    const candidatos = items.filter(
      (item) => item.path.endsWith(`.${buscada}`) || item.path === buscada,
    );
    if (candidatos.length === 1) encontrado = candidatos[0];
    else if (candidatos.length > 1) {
      return { ambiguo: true, candidatos: candidatos.map((c) => c.path) };
    }
  }

  if (!encontrado) return null;

  const lineas = contenido.split('\n');
  const texto = lineas.slice(encontrado.startLine - 1, encontrado.endLine).join('\n');

  return { ...encontrado, texto };
}

module.exports = { listCodeItems, readCodeItem };
