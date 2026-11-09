// Skills de workspace.
//
// Replica el sistema que documenta el binario: una skill es una carpeta dentro de un
// `skills/` de la raíz de personalización (`.agents/skills/`), con un `SKILL.md`
// obligatorio y subcarpetas opcionales para scripts, ejemplos, recursos y referencias.
//
// La idea es la divulgación progresiva: el agente ve siempre **solo** el nombre y la
// descripción de cada skill, y carga el cuerpo cuando decide que le sirve. Así un
// proyecto puede tener veinte skills sin gastar contexto.

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/** Raíces donde se buscan skills, en orden de prioridad. */
const RAICES = [
  '.agents/skills',
  '.opengravity/skills',
  '.claude/skills',
];

/** Subcarpetas opcionales que documenta el binario. */
const SUBCARPETAS = ['scripts', 'examples', 'resources', 'references'];

const MAX_DESCRIPCION = 600;
const MAX_CUERPO = 40_000;

/**
 * Parsea el frontmatter YAML de un SKILL.md.
 *
 * Solo interesan `name` y `description`, así que no hace falta un parser completo:
 * se soportan valores en línea, entre comillas y los escalares plegados (`>-`, `|`).
 */
function parsearFrontmatter(contenido) {
  const texto = String(contenido ?? '');

  // El frontmatter tiene que empezar en la primera línea.
  const coincidencia = texto.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!coincidencia) return { datos: {}, cuerpo: texto };

  const bloque = coincidencia[1];
  const cuerpo = texto.slice(coincidencia[0].length);
  const datos = {};

  const lineas = bloque.split(/\r?\n/);
  let claveActual = null;
  let acumulado = [];
  let plegado = false;

  const volcar = () => {
    if (claveActual === null) return;
    const valor = plegado ? acumulado.join(' ').replace(/\s+/g, ' ').trim() : acumulado.join('\n').trim();
    datos[claveActual] = valor;
    claveActual = null;
    acumulado = [];
    plegado = false;
  };

  for (const linea of lineas) {
    // Continuación de un escalar plegado o de bloque.
    if (claveActual !== null && /^\s+\S/.test(linea)) {
      acumulado.push(linea.trim());
      continue;
    }

    const campo = linea.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!campo) continue;

    volcar();

    const clave = campo[1];
    let valor = campo[2].trim();

    // `>-`, `>`, `|-`, `|` anuncian un escalar multilínea.
    if (/^[>|][+-]?$/.test(valor)) {
      claveActual = clave;
      plegado = valor.startsWith('>');
      continue;
    }

    // Valores entre comillas.
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    // Lista en línea: [a, b, c]
    if (valor.startsWith('[') && valor.endsWith(']')) {
      datos[clave] = valor
        .slice(1, -1)
        .split(',')
        .map((parte) => parte.trim().replace(/^["']|["']$/g, ''))
        .filter((parte) => parte.length > 0);
      continue;
    }

    datos[clave] = valor;
  }

  volcar();
  return { datos, cuerpo };
}

/** Lista los ficheros de una subcarpeta, si existe. */
async function listarSubcarpeta(directorio, nombre) {
  const ruta = path.join(directorio, nombre);
  try {
    const entradas = await fsp.readdir(ruta, { withFileTypes: true });
    return entradas
      .filter((entrada) => !entrada.name.startsWith('.'))
      .slice(0, 40)
      .map((entrada) => path.posix.join(nombre, entrada.name));
  } catch {
    return [];
  }
}

/** Lee una skill de un directorio. Devuelve null si no tiene SKILL.md válido. */
async function leerSkill(directorio, raiz) {
  let contenido;
  try {
    contenido = await fsp.readFile(path.join(directorio, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }

  const { datos, cuerpo } = parsearFrontmatter(contenido);
  const carpeta = path.basename(directorio);
  const nombre = String(datos.name ?? carpeta).trim() || carpeta;
  const descripcion = String(datos.description ?? '').trim().slice(0, MAX_DESCRIPCION);

  const recursos = {};
  for (const sub of SUBCARPETAS) {
    const ficheros = await listarSubcarpeta(directorio, sub);
    if (ficheros.length > 0) recursos[sub] = ficheros;
  }

  return {
    name: nombre,
    description: descripcion,
    dir: directorio,
    raiz,
    cuerpo: cuerpo.slice(0, MAX_CUERPO),
    recursos,
    /** Ruta relativa al workspace, para mostrarla en la UI. */
    relative: path.relative(raiz, directorio).split(path.sep).join('/'),
  };
}

/**
 * Descubre las skills disponibles.
 *
 * Busca en el workspace y, después, en la carpeta global del usuario. Si dos skills
 * se llaman igual, gana la del workspace.
 */
async function descubrirSkills(workspace) {
  const encontradas = new Map();

  const buscarEn = async (base, raiz) => {
    for (const relativa of RAICES) {
      const directorio = path.join(base, relativa);
      let entradas;
      try {
        entradas = await fsp.readdir(directorio, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entrada of entradas) {
        if (!entrada.isDirectory() || entrada.name.startsWith('.')) continue;
        const skill = await leerSkill(path.join(directorio, entrada.name), raiz);
        if (!skill) continue;
        // El workspace gana: no se sobrescribe si ya existe.
        if (!encontradas.has(skill.name)) encontradas.set(skill.name, skill);
      }
    }
  };

  if (workspace) await buscarEn(workspace, workspace);
  await buscarEn(os.homedir(), os.homedir());

  return [...encontradas.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Busca una skill por nombre exacto, o por sufijo si no hay coincidencia exacta. */
function buscarSkill(skills, nombre) {
  const buscado = String(nombre ?? '').trim().toLowerCase();
  if (buscado.length === 0) return null;

  const exacta = skills.find((skill) => skill.name.toLowerCase() === buscado);
  if (exacta) return exacta;

  const parciales = skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(buscado) ||
      buscado.includes(skill.name.toLowerCase()),
  );

  return parciales.length === 1 ? parciales[0] : null;
}

/**
 * Construye el bloque de system prompt con el catálogo.
 *
 * Solo nombre y descripción: el cuerpo se carga con la herramienta cuando hace falta.
 */
function bloqueDeSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';

  const lineas = skills.map((skill) =>
    skill.description.length > 0 ? `- ${skill.name}: ${skill.description}` : `- ${skill.name}`,
  );

  return (
    '\n\n## Skills del proyecto\n\n' +
    'Estas skills existen en este workspace. Solo ves su nombre y para qué sirven; ' +
    'el contenido completo no está en contexto. Cuando una encaje con lo que tienes que ' +
    'hacer, cárgala con la herramienta `skill` (action "load") antes de actuar, y sigue ' +
    'sus instrucciones al pie de la letra.\n\n' +
    lineas.join('\n')
  );
}

/** Herramienta `skill` para el agente. */
function makeSkillTool(getSkills) {
  return {
    name: 'skill',
    description:
      'Lista o carga las skills del proyecto. Las skills son procedimientos concretos ' +
      'que el proyecto define en .agents/skills/. Carga una antes de seguir sus pasos.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'load'],
          description: 'list para ver las disponibles, load para cargar una entera.',
        },
        name: {
          type: 'string',
          description: 'Nombre de la skill a cargar. Obligatorio para load.',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const accion = String(args.action ?? 'list');
      const skills = await getSkills();

      if (skills.length === 0) {
        return {
          content:
            'No hay skills en este proyecto. Se definen en .agents/skills/<nombre>/SKILL.md ' +
            'con un frontmatter que tenga name y description.',
        };
      }

      if (accion === 'list') {
        const lineas = skills.map(
          (skill) =>
            `- ${skill.name} (${skill.relative})` +
            (skill.description ? `\n  ${skill.description}` : ''),
        );
        return { content: `Skills disponibles (${skills.length}):\n${lineas.join('\n')}` };
      }

      const skill = buscarSkill(skills, args.name);
      if (!skill) {
        return {
          content:
            `No existe la skill "${args.name}". Disponibles: ` +
            skills.map((s) => s.name).join(', '),
          isError: true,
        };
      }

      const partes = [
        `# Skill: ${skill.name}`,
        skill.description ? `\n${skill.description}` : '',
        `\nDirectorio: ${skill.relative}\n`,
        skill.cuerpo.trim(),
      ];

      for (const [sub, ficheros] of Object.entries(skill.recursos)) {
        partes.push(
          `\n## ${sub}\n` +
            ficheros.map((f) => `- ${path.posix.join(skill.relative, f)}`).join('\n'),
        );
      }

      return { content: partes.filter((p) => p.length > 0).join('\n') };
    },
  };
}

module.exports = {
  descubrirSkills,
  buscarSkill,
  bloqueDeSkills,
  makeSkillTool,
  parsearFrontmatter,
};
