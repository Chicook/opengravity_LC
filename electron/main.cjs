'use strict';

/**
 * Proceso principal de la app de escritorio.
 *
 * Reproduce la arquitectura que documentamos en docs/analysis:
 *
 *   renderer (UI)  ──IPC──▶  main (esta capa)  ──▶  motor del agente
 *
 * El renderer no tiene acceso a Node (`nodeIntegration: false`,
 * `contextIsolation: true`). Todo pasa por los canales IPC que expone
 * `preload.cjs`. Los nombres siguen el patrón `dominio:accion`.
 *
 * El motor (providers, agente, MCP, persistencia) está compilado en `dist/` y
 * se carga con `import()` dinámico, así este fichero puede ser CommonJS.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const http = require('node:http');
const {
  isUrlAllowed,
  makeFetchUrlTool,
  makeOpenUrlTool,
  openBuiltInBrowser,
  browserEvaluate,
  makeSearchFilesTool,
  makeEditFileTool,
  makeMultiReplaceTool,
  makeRunCommandTool,
  makeCommandStatusTool,
  makeManageTaskTool,
  makeSearchWebTool,
  makeViewCodeItemTool,
  makeEditNotebookTool,
  makeGenerateImageTool,
  makeRunWorkflowTool,
  makeBrowserTools,
} = require('./tools-extra.cjs');
const { diffLines, compactDiff } = require('./diff.cjs');
const { conMonitorDeSeguridad } = require('./guardian.cjs');
const { conHooks, aplicarHooksDeTexto, aplicarHooksDeRazonamiento } = require('./hooks.cjs');
const trayectoria = require('./trajectory.cjs');
const { CicloDePlan, PROMPT_PLANNER, PROMPT_EXECUTOR, HERRAMIENTAS_DE_LECTURA } = require('./plan-mode.cjs');
const { descubrirSkills, bloqueDeSkills, makeSkillTool } = require('./skills.cjs');
const { compilarCron, siguienteEjecucion, describirCron } = require('./cron.cjs');
const subagentes = require('./subagents.cjs');
const worktreeMod = require('./worktree.cjs');
const testrunner = require('./testrunner.cjs');
const { AlmacenDeMemoria, makeMemoryTool, bloqueDeMemorias } = require('./memory.cjs');

/**
 * Esquema propio `app://`.
 *
 * Necesario para que los workers de Monaco carguen: Chromium bloquea los
 * workers desde `file://`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** Motor cargado una sola vez. */
let engine = null;

async function getEngine() {
  if (engine) return engine;

  const [loop, storeModule, registry, toolRegistry, fsTools] = await Promise.all([
    import('../dist/agent/loop.js'),
    import('../dist/persistence/jsonl-store.js'),
    import('../dist/providers/registry.js'),
    import('../dist/tools/registry.js'),
    import('../dist/tools/fs.js'),
  ]);

  engine = {
    runAgent: loop.runAgent,
    JsonlSessionStore: storeModule.JsonlSessionStore,
    createProvider: registry.createProvider,
    detectAvailableProviders: registry.detectAvailableProviders,
    PROVIDER_CATALOG: registry.PROVIDER_CATALOG,
    ToolRegistry: toolRegistry.ToolRegistry,
    fileSystemTools: fsTools.fileSystemTools,
  };

  return engine;
}

/** Estado de la sesión de trabajo. */
const state = {
  /** Raíz del workspace abierto. */
  cwd: process.cwd(),
  providerId: null,
  model: null,
  sessionId: null,
  /** Historial de la conversación actual. */
  messages: [],
  busy: false,
  /** Preferencias de la UI (permisos, apariencia, notificaciones…). */
  prefs: {},
};

// ---------------------------------------------------------------------------
// Preferencias persistentes (proveedor y modelo elegidos)
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Almacén de memoria entre conversaciones. */
let almacenMemoria = null;
function getMemoria() {
  if (!almacenMemoria) {
    almacenMemoria = new AlmacenDeMemoria(path.join(app.getPath('userData'), 'memories.json'));
  }
  return almacenMemoria;
}

// La carpeta de trayectorias depende de `app.getPath`, que solo existe tras el arranque.
app.whenReady().then(() => {
  try {
    trayectoria.configurar(path.join(app.getPath('userData'), 'trajectory'));
    subagentes.configurar(path.join(app.getPath('userData'), 'subagents.json'));
    // Poda de trayectorias viejas al arrancar: no crecen sin límite.
    const dias = Number(state.prefs.trajectoryRetentionDays ?? 30);
    trayectoria.podarAntiguas(dias).catch(() => {});
  } catch {
    // sin persistencia se sigue funcionando en memoria
  }
});

async function loadSettings() {
  try {
    const raw = await fsp.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.providerId === 'string') state.providerId = parsed.providerId;
    if (parsed && typeof parsed.model === 'string') state.model = parsed.model;
    if (parsed && typeof parsed.lastWorkspace === 'string') state.cwd = parsed.lastWorkspace;
    if (parsed && parsed.prefs && typeof parsed.prefs === 'object') state.prefs = parsed.prefs;
  } catch {
    // sin preferencias guardadas: se usan los valores por defecto
  }
}

async function saveSettings() {
  try {
    await fsp.mkdir(app.getPath('userData'), { recursive: true });

    // Se parte de lo que ya había en disco: si un valor es nulo ahora mismo
    // (por ejemplo el modelo aún no elegido), no se borra el que estaba.
    let previo = {};
    try {
      previo = JSON.parse(await fsp.readFile(settingsPath(), 'utf8')) ?? {};
    } catch {
      previo = {};
    }

    const payload = {
      providerId: state.providerId ?? previo.providerId ?? null,
      model: state.model ?? previo.model ?? null,
      lastWorkspace: state.cwd ?? previo.lastWorkspace ?? null,
      prefs: { ...(previo.prefs ?? {}), ...(state.prefs ?? {}) },
    };

    await fsp.writeFile(settingsPath(), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // guardar preferencias es best-effort
  }
}

/**
 * Construye las sobrescrituras que espera `createProvider` a partir de los
 * proveedores personalizables guardados en las preferencias.
 */
function buildProviderConfig() {
  const baseUrls = {};
  const apiKeys = {};

  // Claves guardadas desde la UI (valen para cualquier proveedor).
  for (const [id, value] of Object.entries(state.prefs.apiKeys ?? {})) {
    if (typeof value === 'string' && value.trim().length > 0) {
      apiKeys[id] = value.trim();
    }
  }

  // Proveedores personalizables: URL y clave propios.
  for (const [id, entry] of Object.entries(state.prefs.customProviders ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.baseUrl === 'string' && entry.baseUrl.trim().length > 0) {
      baseUrls[id] = entry.baseUrl.trim();
    }
    if (typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0) {
      apiKeys[id] = entry.apiKey.trim();
    }
  }

  return { baseUrls, apiKeys };
}

/*
 * Entorno: sin esto el agente no sabe en qué sistema está y usa comandos de Unix
 * en Windows (`find /`, `/c/Users/...`), que fallan. Medido en una sesión real:
 * eso lo llevó a 32 pasos de bucle intentando averiguar por qué no encontraba el
 * proyecto, cuando el problema era que sus órdenes no existían en este sistema.
 */
const ENTORNO =
  process.platform === 'win32'
    ? 'Entorno: Windows. La shell de run_command es PowerShell. Usa rutas con barra ' +
      'invertida o relativa (src\\carrito.mjs), NO rutas tipo /c/Users/... y NO ' +
      'comandos de Unix como find, grep, ls o cd con rutas absolutas: no existen. ' +
      'Para listar usa list_directory; para buscar, search_files; para rutas, ' +
      'relativas al directorio de trabajo.'
    : `Entorno: ${process.platform}. Shell POSIX.`;

const SYSTEM_PROMPT = ENTORNO + `

Eres un asistente de programación integrado en un IDE.

Reglas:
- Inspecciona el código antes de afirmar cosas sobre él.
- Cita rutas de fichero concretas cuando hables de código.
- Si algo no lo has comprobado, dilo explícitamente en lugar de suponerlo.
- Responde en el idioma del usuario.

Comprueba la premisa antes de trabajar (importante):
- Muchas tareas afirman algo que puede no ser cierto: "los tests fallan", "esto
  está roto", "el bug está en X". Compruébalo en los primeros pasos.
- Si lo que observas contradice la premisa, PARA y dilo. No busques otra
  explicación ni supongas tests ocultos, otra rama u otro fichero.
- Un ejemplo real: te dicen que falla una suite, la ejecutas y pasa. La respuesta
  correcta es "la suite pasa ahora mismo; ¿esperabas otro resultado?" y terminar.
  No es seguir buscando un bug que no existe: eso quema pasos y no encuentra nada.
- Vale más una respuesta de dos líneas diciendo que la premisa no se cumple, que
  veinte pasos explorando una hipótesis que ya sabes que es falsa.

Eficiencia (importante):
- Cada llamada a herramienta cuesta un paso. Tienes un presupuesto limitado.
- Cuando ya tengas suficiente información para responder, DEJA de usar herramientas y responde.
- No leas ficheros que no necesites para la pregunta. No repitas una llamada que ya hiciste.
- Si la pregunta es general ("¿qué es esto?", "analiza el proyecto"), bastan 2-4 lecturas: estructura, README y el fichero de entrada.
- Si llevas muchas llamadas y aún no has respondido, para y contesta con lo que sepas, indicando qué falta.

Herramientas de código:
- search_files busca una expresión regular en el proyecto. Úsala para encontrar dónde se usa algo antes de leer ficheros a ciegas.
- edit_file reemplaza un fragmento exacto. Prefiérelo siempre a write_file: conserva el resto del fichero.
- multi_replace hace VARIOS reemplazos acotados por rango en una sola llamada. Si vas a cambiar
  el mismo fichero en más de un sitio —renombrar un parámetro, cambiar varias firmas, ajustar
  varios tramos—, usa multi_replace y NO write_file. Reescribir el fichero entero para tocar
  cuatro líneas es el camino más frágil: si te falta un byte, lo pierdes.
- run_command ejecuta comandos (tests, build, git). Úsala para comprobar que tu cambio funciona.
- write_file solo para ficheros nuevos o reescrituras completas deliberadas. Si la tarea dice
  «en una sola operación» sobre un fichero existente, es multi_replace, no write_file.

Navegador:
- browser_open abre una URL en el navegador integrado y espera a que cargue.
- browser_read devuelve el texto visible y el título de la página.
- browser_click hace clic en un selector CSS; browser_eval ejecuta JavaScript.
- Respeta las reglas de red: los dominios denegados no se abren.`;

/**
 * Instrucción extra según la política de revisión de planes.
 * Es una preferencia real: cambia lo que el agente hace, no solo lo que se guarda.
 */
/** Traduce el nivel de esfuerzo del composer a una instrucción del sistema. */
/**
 * Presupuesto de contexto en caracteres para el modelo activo.
 * Se asume ~4 caracteres por token y se deja un 25% de margen para la respuesta.
 */
/**
 * Configuración de embeddings según lo que esté disponible.
 *
 * Prioridad: proveedor activo si sabe hacer embeddings, luego Ollama local.
 * Si no hay nada, el índice sigue funcionando en modo léxico.
 */
function embeddingConfig() {
  const preferido = state.prefs.embeddingProvider ?? 'auto';
  const url = state.prefs.embeddingUrl;
  const model = state.prefs.embeddingModel;
  const peso = Number.isFinite(Number(state.prefs.embeddingWeight))
    ? Number(state.prefs.embeddingWeight)
    : 0.45;

  if (preferido === 'openai') {
    return {
      provider: 'openai',
      url: url ?? state.prefs.embeddingBaseUrl ?? 'https://api.openai.com/v1',
      model: model ?? 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY ?? state.prefs.embeddingApiKey ?? '',
      weight: peso,
    };
  }

  if (preferido === 'gemini') {
    return {
      provider: 'gemini',
      url: url ?? 'https://generativelanguage.googleapis.com/v1beta',
      model: model ?? 'text-embedding-004',
      apiKey: process.env.GEMINI_API_KEY ?? '',
      weight: peso,
    };
  }

  return {
    provider: 'ollama',
    url: url ?? 'http://127.0.0.1:11434',
    model: model ?? 'nomic-embed-text',
    weight: peso,
  };
}

function contextBudget(modelId) {
  const ventanas = {
    anthropic: 200_000,
    gemini: 1_000_000,
  };

  const provider = state.providerId ?? '';
  const tokens = ventanas[provider] ?? 128_000;
  return Math.floor(tokens * 4 * 0.75);
}

function effortInstruction(effort) {
  const map = {
    Low: 'Responde de forma directa y breve, con los mínimos pasos necesarios.',
    Medium: 'Equilibra brevedad y rigor: explica lo justo antes de actuar.',
    High: 'Razona con detalle, verifica cada paso y revisa el resultado antes de responder.',
  };

  const hint = map[effort];
  return hint ? `\n\n[Esfuerzo de razonamiento: ${effort}] ${hint}` : '';
}

function planReviewInstruction(policy) {
  switch (policy) {
    case 'Always Review':
      return (
        '\n\n## Plan mode (obligatorio)' +
        '\nAntes de usar cualquier otra herramienta, llama a `present_plan` con los pasos que vas a seguir.' +
        '\nEspera la respuesta. Si el usuario aprueba, ejecuta los pasos en orden.' +
        '\nSi la rechaza, lee su motivo, ajusta el plan y vuelve a llamar a `present_plan`.' +
        '\nNo toques ficheros ni ejecutes comandos antes de la aprobación.'
      );

    case 'Never':
      return (
        '\n\n## Plan mode (desactivado)' +
        '\nProcede directamente sin presentar planes, incluso si el cambio afecta a varios ficheros.'
      );

    default:
      // 'Always Ask': decide según la forma de la tarea, con una regla concreta.
      return (
        '\n\n## Plan mode (según la tarea)' +
        '\nLlama a `present_plan` antes de actuar cuando se cumpla cualquiera de estas condiciones:' +
        '\n- la tarea requiere 3 o más pasos con herramientas,' +
        '\n- vas a modificar o borrar ficheros,' +
        '\n- vas a ejecutar comandos que cambian el estado del proyecto.' +
        '\nPara preguntas, lecturas y consultas de una sola herramienta, responde directamente sin plan.'
      );
  }
}

/** Skills disponibles: se inyectan en el prompt si están activadas. */
const SKILL_CATALOG = [
  {
    id: 'spanish',
    name: 'Responder en español',
    description: 'Fuerza el idioma de las respuestas.',
    body: 'Responde siempre en español, incluidos los mensajes de estado.',
  },
  {
    id: 'concise',
    name: 'Respuestas concisas',
    description: 'Sin rodeos ni resúmenes innecesarios.',
    body: 'Sé breve. No repitas el código que acabas de escribir ni resumas lo obvio.',
  },
  {
    id: 'tests',
    name: 'Proponer tests',
    description: 'Sugiere pruebas al cambiar lógica.',
    body: 'Cuando modifiques lógica de negocio, propón al menos un test que la cubra.',
  },
  {
    id: 'explain',
    name: 'Explicar el razonamiento',
    description: 'Justifica cada decisión de diseño.',
    body: 'Antes de aplicar un cambio no trivial, explica en una frase por qué es la opción correcta.',
  },
];

/** Bloque de prompt con las skills activadas y el perfil del usuario. */
function buildPromptExtras(prefs) {
  const parts = [];

  const profile = prefs.profile ?? {};
  if (typeof profile.name === 'string' && profile.name.trim().length > 0) {
    parts.push(`El usuario se llama ${profile.name.trim()}.`);
  }

  const enabled = prefs.skills ?? {};
  const active = SKILL_CATALOG.filter((skill) => enabled[skill.id] === true);
  if (active.length > 0) {
    parts.push('Instrucciones adicionales:\n' + active.map((skill) => `- ${skill.body}`).join('\n'));
  }

  return parts.length > 0 ? `\n\n${parts.join('\n')}` : '';
}

/** Presets que no piden confirmación para escribir. */
const AUTO_APPROVE_PRESETS = new Set(['Auto (Preview)', 'Turbo']);

/**
 * Envuelve una herramienta con la puerta de permisos.
 *
 * Precedencia: permiso explícito por herramienta > preset global.
 *   - `deny`  → nunca se ejecuta.
 *   - `allow` → se ejecuta sin preguntar.
 *   - `ask`   → siempre pregunta.
 *   - `inherit` (o sin valor) → decide el preset.
 */
function guardTool(tool, preset, prefs, getWindow) {
  // Plan y subagente tienen su propio flujo: sus herramientas ya piden permiso.
  if (tool.name === 'present_plan' || tool.name === 'browser_task') return tool;

  const explicit = prefs.toolPermissions?.[tool.name] ?? 'inherit';

  if (explicit === 'deny') {
    return {
      ...tool,
      async execute() {
        return { content: `La herramienta ${tool.name} está denegada en Ajustes › Tool Permissions.`, isError: true };
      },
    };
  }

  if (explicit === 'allow') return tool;

  const writes = tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'multi_replace';
  const isCommand = tool.name === 'run_command';
  const presetAsks =
    preset === 'Request Review' || (preset === 'Default' && (writes || isCommand));
  const needsAsk = explicit === 'ask' || (explicit === 'inherit' && presetAsks);

  if (!needsAsk && !writes) return tool;

  return {
    ...tool,
    async execute(args, ctx) {
      // Las escrituras pasan por una tarjeta de diff, no por un diálogo nativo.
      if (writes) {
        if (!needsAsk) {
          // Sin revisión previa, pero con snapshot para poder deshacer después.
          await registrarSnapshotDeEscritura(args, ctx);
          return tool.execute(args, ctx);
        }
        return executeWriteWithDiff(tool, args, ctx, getWindow(), needsAsk);
      }

      const approved = await askPermission(
        getWindow(),
        `El agente quiere ejecutar «${tool.name}»`,
        JSON.stringify(args, null, 2).slice(0, 400),
      );

      if (!approved) {
        return { content: `El usuario denegó la herramienta ${tool.name}.`, isError: true };
      }

      return tool.execute(args, ctx);
    },
  };
}

/**
 * Calcula el diff de una escritura, lo muestra en el hilo y aplica el cambio
 * solo si el usuario lo acepta (o si el preset lo permite automáticamente).
 */
/**
 * Registra el snapshot de un fichero antes de escribirlo, sin preguntar nada.
 *
 * Hace falta porque en los presets que no piden revisión el flujo del diff no se
 * ejecuta, y sin esto no habría nada que deshacer.
 */
async function registrarSnapshotDeEscritura(args, ctx) {
  const relativa = String(args.path ?? '');
  if (relativa.length === 0) return;

  const absoluta = path.resolve(ctx.cwd, relativa);
  try {
    const antes = await fsp.readFile(absoluta, 'utf8');
    recordCheckpoint(absoluta, antes);
  } catch {
    // El fichero no existe todavía: se marca como nuevo.
    recordCheckpoint(absoluta, null);
  }
}

async function executeWriteWithDiff(tool, args, ctx, win, needsAsk) {
  const relative = String(args.path ?? '');
  const absolute = path.resolve(ctx.cwd, relative);

  let before = '';
  let isNew = false;

  try {
    before = await fsp.readFile(absolute, 'utf8');
  } catch {
    isNew = true;
  }

  // Para edit_file el resultado se calcula aplicando el reemplazo.
  let proposed;
  if (tool.name === 'edit_file') {
    const oldText = String(args.oldText ?? '');
    const newText = String(args.newText ?? '');
    if (oldText.length === 0 || !before.includes(oldText)) {
      return { content: `oldText no aparece en ${relative}.`, isError: true };
    }
    proposed = before.replace(oldText, newText);
  } else {
    proposed = String(args.content ?? '');
  }

  recordCheckpoint(absolute, isNew ? null : before);

  const { rows, additions, removals, approximate } = diffLines(before, proposed);
  const payload = {
    path: relative,
    rows: compactDiff(rows),
    additions,
    removals,
    approximate,
    isNew,
  };

  if (needsAsk) {
    const accepted = await requestDiffApproval(win, payload);
    if (!accepted) {
      return { content: `El usuario rechazó el cambio en ${relative}.`, isError: true };
    }
  } else if (win && !win.isDestroyed()) {
    win.webContents.send('diff:applied', payload);
  }

  const applied = await tool.execute(args, ctx);
  if (!applied.isError) scheduleIndexRefresh();
  return applied;
}

// ---------------------------------------------------------------------------
// Índice de código
// ---------------------------------------------------------------------------

const { CodeIndex } = require('./indexer.cjs');

/** Índice de código del workspace. */
const codeIndex = new CodeIndex({ root: process.cwd() });

/** Construye (o refresca) el índice. */
ipcMain.handle('index:build', async () => {
  codeIndex.root = state.cwd;
  const stats = await codeIndex.build(state.cwd);
  return { ok: true, ...stats };
});

/** Reindexado automático con retardo, tras guardar un fichero. */
let indexRefreshTimer = null;

function scheduleIndexRefresh() {
  if (indexRefreshTimer) clearTimeout(indexRefreshTimer);
  indexRefreshTimer = setTimeout(async () => {
    indexRefreshTimer = null;
    try {
      codeIndex.root = state.cwd;
      await codeIndex.build(state.cwd);
    } catch {
      // el refresco es best-effort
    }
  }, 1500);
}

/** Ruta del caché de embeddings. */
function embeddingsPath() {
  return path.join(app.getPath('userData'), 'embeddings.json');
}

/** Precalcula embeddings de los ficheros del índice. */
ipcMain.handle('index:warm', async () => {
  if (codeIndex.size === 0) await codeIndex.build(state.cwd);

  const ollamaUrl = state.prefs.embeddingUrl ?? 'http://127.0.0.1:11434';
  const model = state.prefs.embeddingModel ?? 'nomic-embed-text';

  const config = embeddingConfig();
  const result = await codeIndex.warmEmbeddings(config, 300);
  await codeIndex.saveEmbeddings(embeddingsPath());

  return { ok: true, ...result };
});

/** Dónde se usa un símbolo del índice. */
ipcMain.handle('index:references', async (_event, name) => {
  if (codeIndex.size === 0) return { ok: false, results: [] };
  const results = codeIndex.findReferences(String(name ?? ''), 20);
  return { ok: true, results };
});

/** Estado del índice. *//** Estado del índice. */
ipcMain.handle('index:status', async () => {
  return { ok: true, root: state.cwd, ...codeIndex.stats() };
});

/** Búsqueda en el índice: símbolos, léxico o híbrido. */
ipcMain.handle('index:search', async (_event, payload) => {
  const query = String(payload?.query ?? '').trim();
  if (query.length === 0) return { ok: false, error: 'consulta vacía', results: [] };

  if (codeIndex.size === 0) {
    await codeIndex.build(state.cwd);
  }

  const mode = String(payload?.mode ?? 'auto');
  const limit = Math.min(40, Number(payload?.limit ?? 15));

  if (mode === 'symbol') {
    return { ok: true, mode: 'symbol', results: codeIndex.searchSymbols(query, limit) };
  }

  const results = codeIndex.searchLexical(query, limit);

  if (mode === 'lexical') {
    return { ok: true, mode: 'lexical', results };
  }

  // Híbrido: reordena combinando BM25 con similitud semántica.
  const reranked = await codeIndex.rerankWithEmbeddings(query, results, embeddingConfig());

  return { ok: true, mode: 'hybrid', results: reranked };
});

// ---------------------------------------------------------------------------
// LSP
// ---------------------------------------------------------------------------

const { LspClient, languageForPath, DEFAULT_SERVERS } = require('./lsp.cjs');
const { pathToFileURL } = require('node:url');
const fsSync = require('node:fs');

/** Clientes LSP por lenguaje. */
const lspClients = new Map();

/** Resuelve el servidor de TypeScript incluido en el proyecto. */
function bundledTsServer() {
  const cli = path.join(app.getAppPath(), 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
  return fsSync.existsSync(cli) ? { command: 'node', args: [cli, '--stdio'] } : null;
}

/** Comando del servidor para un lenguaje, con sobrescritura del usuario. */
function serverFor(language) {
  const custom = state.prefs.lspServers?.[language];
  if (custom && typeof custom.command === 'string' && custom.command.trim().length > 0) {
    return {
      command: custom.command.trim(),
      args: Array.isArray(custom.args) ? custom.args.map(String) : [],
    };
  }

  if (language === 'typescript' || language === 'javascript') {
    const bundled = bundledTsServer();
    if (bundled) return bundled;
  }

  return DEFAULT_SERVERS[language] ?? null;
}

/** Obtiene (o arranca) el cliente LSP del lenguaje del fichero. */
async function ensureLspClient(filePath) {
  const language = languageForPath(filePath);
  if (!language) return { ok: false, error: 'lenguaje sin servidor LSP' };

  const existing = lspClients.get(language);
  if (existing && existing.ready) return { ok: true, client: existing, language };

  const server = serverFor(language);
  if (!server) return { ok: false, error: `no hay servidor LSP para ${language}` };

  const client = new LspClient({
    language,
    rootPath: state.cwd,
    onDiagnostics: (uri, diagnostics) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lsp:diagnostics', { uri, diagnostics });
      }
    },
    onLog: (text) => console.error(`[lsp ${language}] ${text}`),
  });

  client.setServerCommand(server);

  try {
    await client.start();
    lspClients.set(language, client);
    return { ok: true, client, language };
  } catch (error) {
    client.stop();
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `no se pudo arrancar ${server.command}: ${message}` };
  }
}

/** Abre un documento en el servidor del lenguaje. */
ipcMain.handle('lsp:open', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = path.resolve(state.cwd, filePath);

  const ensured = await ensureLspClient(absolute);
  if (!ensured.ok) return ensured;

  const uri = pathToFileURL(absolute).href;
  ensured.client.didOpen(uri, content);

  return {
    ok: true,
    language: ensured.language,
    uri,
    diagnostics: ensured.client.diagnosticsFor(uri),
  };
});

/** Notifica cambios de contenido. */
ipcMain.handle('lsp:change', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = path.resolve(state.cwd, filePath);

  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  client.didChange(pathToFileURL(absolute).href, content);
  return { ok: true };
});

/** Autocompletado en una posición. */
ipcMain.handle('lsp:complete', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP', items: [] };

  try {
    const result = await client.completion(
      pathToFileURL(absolute).href,
      Number(payload?.line ?? 0),
      Number(payload?.character ?? 0),
    );

    const list = Array.isArray(result) ? result : (result?.items ?? []);
    const items = list.slice(0, 50).map((item) => ({
      label: String(item.label ?? ''),
      kind: item.kind ?? 0,
      detail: item.detail ?? null,
    }));

    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error.message, items: [] };
  }
});

/** Ir a definición. */
ipcMain.handle('lsp:definition', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  try {
    const result = await client.definition(
      pathToFileURL(absolute).href,
      Number(payload?.line ?? 0),
      Number(payload?.character ?? 0),
    );

    const first = Array.isArray(result) ? result[0] : result;
    if (!first || !first.uri) return { ok: false, error: 'sin definición' };

    return {
      ok: true,
      path: first.uri.replace(/^file:\/\//, '').replace(/\//g, path.sep),
      line: first.range?.start?.line ?? 0,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Convierte una posición LSP (línea/carácter) a índice de cadena. */
function positionToOffset(content, line, character) {
  let offset = 0;
  let currentLine = 0;

  while (currentLine < line) {
    const next = content.indexOf('\n', offset);
    if (next === -1) return content.length;
    offset = next + 1;
    currentLine += 1;
  }

  return Math.min(content.length, offset + character);
}

/** Aplica una lista de TextEdits a un contenido, de atrás hacia delante. */
function applyTextEdits(content, edits) {
  const sorted = [...edits].sort((a, b) => {
    const al = a.range.start.line;
    const bl = b.range.start.line;
    if (al !== bl) return bl - al;
    return b.range.start.character - a.range.start.character;
  });

  let result = content;
  for (const edit of sorted) {
    const start = positionToOffset(result, edit.range.start.line, edit.range.start.character);
    const end = positionToOffset(result, edit.range.end.line, edit.range.end.character);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

/** Renombra un símbolo en todo el workspace. */
ipcMain.handle('lsp:rename', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  const newName = String(payload?.newName ?? '').trim();
  if (newName.length === 0) return { ok: false, error: 'nombre vacío' };

  try {
    const result = await client.request('textDocument/rename', {
      textDocument: { uri: pathToFileURL(absolute).href },
      position: { line: Number(payload?.line ?? 0), character: Number(payload?.character ?? 0) },
      newName,
    });

    const changes = result?.changes ?? {};
    const entries = Object.entries(changes);

    if (entries.length === 0) return { ok: false, error: 'el servidor no propuso cambios' };

    let touched = 0;

    for (const [uri, edits] of entries) {
      // file:///c:/ruta -> c:/ruta en Windows
      let target = decodeURIComponent(String(uri).replace(/^file:\/\//, ''));
      if (/^\/[A-Za-z]:/.test(target)) target = target.slice(1);
      try {
        const current = await fsp.readFile(target, 'utf8');
        await fsp.writeFile(target, applyTextEdits(current, edits), 'utf8');
        touched += 1;
      } catch {
        // fichero ilegible: se omite
      }
    }

    return { ok: true, files: touched };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Formatea un documento. */
ipcMain.handle('lsp:format', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  try {
    const edits = await client.request('textDocument/formatting', {
      textDocument: { uri: pathToFileURL(absolute).href },
      options: { tabSize: 2, insertSpaces: true },
    });

    if (!Array.isArray(edits) || edits.length === 0) {
      return { ok: true, content: String(payload?.content ?? ''), changed: false };
    }

    return {
      ok: true,
      content: applyTextEdits(String(payload?.content ?? ''), edits),
      changed: true,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Estado de los servidores LSP. */
ipcMain.handle('lsp:status', async () => {
  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'json'];
  return languages.map((language) => ({
    language,
    running: Boolean(lspClients.get(language)?.ready),
    server: serverFor(language),
  }));
});

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Ejecuta git en el workspace y devuelve la salida. */
/**
 * Prueba un servidor MCP: arranca el proceso, pide su lista de herramientas
 * y lo cierra. Sirve para validar la configuración desde Ajustes.
 */
ipcMain.handle('mcp:probe', async (_event, server) => {
  if (!server || !server.command) {
    return { ok: false, error: 'falta el comando' };
  }

  let client = null;

  try {
    const { StdioMcpClient } = await import('../dist/mcp/stdio-client.js');

    client = await StdioMcpClient.start({
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env ?? {},
      cwd: state.cwd,
    });

    const tools = await client.listTools();
    return {
      ok: true,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client?.close().catch(() => {});
  }
});

/** Estado de los servidores MCP configurados, sin arrancarlos. */
ipcMain.handle('mcp:list', async () => {
  const plugins = state.prefs.plugins ?? [];
  return plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    command: plugin.command,
    args: plugin.args ?? [],
    enabled: plugin.enabled !== false,
  }));
});

/** Tipo MIME de una imagen por su extensión, o null si no lo es. */
function imageMimeType(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return map[ext] ?? null;
}

function runGit(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const { execFile } = require('node:child_process');

    execFile(
      'git',
      args,
      { cwd: state.cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || (error ? error.message : ''),
        });
      },
    );
  });
}

/** Estado del repositorio: rama y ficheros modificados. */
/** Envía los commits locales a la rama remota. */
ipcMain.handle('git:push', async (_event, options = {}) => {
  const args = ['push'];
  if (options.setUpstream) args.push('-u', 'origin', 'HEAD');
  const result = await runGit(args, 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Trae y fusiona los cambios del remoto. */
ipcMain.handle('git:pull', async () => {
  const result = await runGit(['pull', '--no-edit'], 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Trae referencias del remoto sin fusionar. */
ipcMain.handle('git:fetch', async () => {
  const result = await runGit(['fetch', '--all', '--prune'], 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Estado de seguimiento respecto al remoto. */
ipcMain.handle('git:tracking', async () => {
  const result = await runGit(['status', '--porcelain=v1', '-b']);
  if (!result.ok) return { ok: false, ahead: 0, behind: 0, upstream: null, remote: false };

  const line = result.stdout.split('\n').find((entry) => entry.startsWith('##')) ?? '';
  const ahead = Number(/ahead (\d+)/.exec(line)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(line)?.[1] ?? 0);
  const upstream = /\.\.\.(\S+)/.exec(line)?.[1] ?? null;

  const remotes = await runGit(['remote']);
  const remote = remotes.ok && remotes.stdout.trim().length > 0;

  return { ok: true, ahead, behind, upstream, remote, detached: line.includes('HEAD detached') };
});

/** Resuelve un conflicto aceptando una de las dos versiones. */
ipcMain.handle('git:resolve', async (_event, filePath, side) => {
  const flag = side === 'ours' ? '--ours' : '--theirs';
  const checkout = await runGit(['checkout', flag, '--', filePath]);
  if (!checkout.ok) return { ok: false, output: checkout.stderr.trim() };

  const add = await runGit(['add', '--', filePath]);
  return { ok: add.ok, output: (checkout.stdout + add.stderr).trim() };
});

/** Aborta una fusión en curso. */
ipcMain.handle('git:abort-merge', async () => {
  const result = await runGit(['merge', '--abort']);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

ipcMain.handle('git:status', async () => {
  const result = await runGit(['status', '--porcelain=v1', '-b']);

  if (!result.ok) {
    return { ok: false, error: result.stderr.trim() || 'git no disponible', branch: null, files: [] };
  }

  let branch = null;
  const files = [];

  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('##')) {
      branch = line.slice(2).trim().split('...')[0].trim();
      continue;
    }
    if (line.length < 4) continue;

    const stagedCode = line[0];
    const unstagedCode = line[1];
    const path = line.slice(3).trim();

    files.push({
      path,
      staged: stagedCode !== ' ' && stagedCode !== '?',
      status: stagedCode !== ' ' && stagedCode !== '?' ? stagedCode : unstagedCode,
      untracked: stagedCode === '?',
    });
  }

  return { ok: true, branch, files };
});

/** Diff unificado de un fichero (o de todo el repo). */
ipcMain.handle('git:diff', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;

  const args = ['diff', '--no-color', '-U3'];
  if (staged) args.push('--cached');
  if (relative.length > 0) args.push('--', relative);

  let result = await runGit(args);

  // Fichero sin seguimiento: git diff no muestra nada.
  if (result.ok && result.stdout.trim().length === 0 && relative.length > 0) {
    const tracked = await runGit(['ls-files', '--error-unmatch', relative]);
    if (!tracked.ok) {
      const fspLocal = require('node:fs/promises');
      try {
        const content = await fspLocal.readFile(path.resolve(state.cwd, relative), 'utf8');
        const lines = content.split('\n').map((text, index) => ({
          type: 'add',
          text,
          oldLine: null,
          newLine: index + 1,
        }));
        return { ok: true, rows: lines.slice(0, 500), untracked: true };
      } catch {
        return { ok: false, error: 'no se pudo leer el fichero' };
      }
    }
  }

  if (!result.ok) {
    return { ok: false, error: result.stderr.trim() || 'git diff falló' };
  }

  const rows = [];
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }
    if (line.startsWith('@@')) {
      rows.push({ type: 'gap', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ type: 'add', text: line.slice(1), oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('-')) {
      rows.push({ type: 'remove', text: line.slice(1), oldLine: null, newLine: null });
      continue;
    }
    rows.push({ type: 'context', text: line.slice(1), oldLine: null, newLine: null });
  }

  return { ok: true, rows: rows.slice(0, 2000) };
});

/** Añade ficheros al índice. */
ipcMain.handle('git:stage', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  if (list.length === 0) return { ok: false, error: 'sin ficheros' };
  const result = await runGit(['add', '--', ...list]);
  return result.ok ? { ok: true } : { ok: false, error: result.stderr.trim() };
});

/** Quita ficheros del índice. */
ipcMain.handle('git:unstage', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  if (list.length === 0) return { ok: false, error: 'sin ficheros' };
  const result = await runGit(['reset', 'HEAD', '--', ...list]);
  return result.ok ? { ok: true } : { ok: false, error: result.stderr.trim() };
});

/** Lista de ramas locales. */
ipcMain.handle('git:branches', async () => {
  const result = await runGit(['branch', '--format=%(refname:short)%09%(HEAD)']);
  if (!result.ok) return { ok: false, error: result.stderr.trim(), branches: [] };

  const branches = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split('\t');
      return { name, current: head === '*' };
    });

  return { ok: true, branches };
});

/** Cambia de rama. */
ipcMain.handle('git:checkout', async (_event, branch) => {
  const name = String(branch ?? '').trim();
  if (name.length === 0) return { ok: false, error: 'rama vacía' };

  const result = await runGit(['checkout', name], 30000);
  return result.ok
    ? { ok: true, output: result.stdout.trim() }
    : { ok: false, error: (result.stderr || result.stdout).trim() };
});

/** Historial reciente. */
ipcMain.handle('git:log', async (_event, payload) => {
  const limit = Math.min(50, Number(payload?.limit ?? 15));

  const result = await runGit([
    'log',
    `-${limit}`,
    '--pretty=format:%h%x09%an%x09%ar%x09%s',
  ]);

  if (!result.ok) return { ok: false, error: result.stderr.trim(), commits: [] };

  const commits = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, author, when, subject] = line.split('\t');
      return { hash, author, when, subject };
    });

  return { ok: true, commits };
});

/** Diff por hunks de un fichero, para poder prepararlos de uno en uno. */
ipcMain.handle('git:diff-hunks', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;

  const args = ['diff', '--no-color', '-U3'];
  if (staged) args.push('--cached');
  args.push('--', relative);

  const result = await runGit(args);
  if (!result.ok) return { ok: false, error: result.stderr.trim(), hunks: [] };

  // Fichero sin seguimiento: no hay diff. Se ofrece el contenido completo como
  // un único bloque, y el stage se resuelve con `git add`.
  if (result.stdout.trim().length === 0 && relative.length > 0) {
    const tracked = await runGit(['ls-files', '--error-unmatch', relative]);
    if (!tracked.ok) {
      try {
        const content = await fsp.readFile(path.resolve(state.cwd, relative), 'utf8');
        const all = content.split('\n').slice(0, 400);
        return {
          ok: true,
          untracked: true,
          header: '',
          hunks: [
            {
              index: 0,
              header: `@@ fichero nuevo (${all.length} líneas) @@`,
              additions: all.length,
              removals: 0,
              preview: all.map((text) => `+${text}`),
              patch: '',
            },
          ],
        };
      } catch {
        return { ok: true, header: '', hunks: [] };
      }
    }
  }

  const lines = result.stdout.split('\n');
  const header = [];
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [line], additions: 0, removals: 0 };
      continue;
    }

    if (!current) {
      // Cabecera del diff (diff --git, index, ---, +++)
      if (line.length > 0) header.push(line);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.removals += 1;
    current.lines.push(line);
  }

  if (current) hunks.push(current);

  return {
    ok: true,
    header: header.join('\n'),
    hunks: hunks.map((hunk, index) => ({
      index,
      header: hunk.header,
      additions: hunk.additions,
      removals: hunk.removals,
      preview: hunk.lines.slice(0, 40),
      patch: hunk.lines.join('\n'),
    })),
  };
});

/** Prepara o revierte un solo hunk. */
ipcMain.handle('git:apply-hunk', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;
  const patch = String(payload?.patch ?? '');
  const header = String(payload?.header ?? '');

  if (patch.length === 0 || header.length === 0) {
    return { ok: false, error: 'hunk vacío' };
  }

  const fullPatch = `${header}\n${patch}\n`;

  const args = ['apply', '--cached', '--unidiff-zero'];
  if (staged) args.push('--reverse');

  const { execFile } = require('node:child_process');

  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd: state.cwd, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String(stderr || error.message).trim() });
        return;
      }
      resolve({ ok: true, output: String(stdout).trim() });
    });

    try {
      child.stdin.write(fullPatch);
      child.stdin.end();
    } catch {
      resolve({ ok: false, error: 'no se pudo enviar el parche' });
    }
  });
});

/** Crea un commit con lo que haya en el índice. */
ipcMain.handle('git:commit', async (_event, message) => {
  const text = String(message ?? '').trim();
  if (text.length === 0) return { ok: false, error: 'mensaje vacío' };

  const result = await runGit(['commit', '-m', text], 60000);
  return result.ok
    ? { ok: true, output: result.stdout.trim() }
    : { ok: false, error: (result.stderr || result.stdout).trim() };
});

// ---------------------------------------------------------------------------
// Terminal integrada (PTY real si está disponible)
// ---------------------------------------------------------------------------

/** node-pty es opcional: si no carga, se usa el ejecutor de comandos. */
let nodePty = null;
try {
  // eslint-disable-next-line global-require
  nodePty = require('@lydell/node-pty');
} catch {
  nodePty = null;
}


/**
 * Sesiones PTY abiertas, indexadas por id. Antes había una sola variable
 * global: con varias terminales cada una necesita su proceso y su ciclo de vida.
 */
const ptySesiones = new Map();

/** Id por defecto cuando el renderer no manda ninguno. */
const PTY_POR_DEFECTO = 'terminal-1';

/** Cierra todas las sesiones PTY. Se llama al salir de la app. */
function cerrarTodasLasPty() {
  for (const sesion of ptySesiones.values()) {
    try {
      sesion.child.kill();
    } catch {
      // ya cerrada
    }
  }
  ptySesiones.clear();
}

ipcMain.handle('terminal:pty-status', async () => ({
  available: Boolean(nodePty),
  running: ptySesiones.size > 0,
  sesiones: [...ptySesiones.keys()],
}));

/** Arranca una shell interactiva en un PTY nuevo. */
ipcMain.handle('terminal:start-pty', async (event, payload = {}) => {
  if (!nodePty) return { ok: false, error: 'PTY no disponible' };

  const id = String(payload?.id ?? PTY_POR_DEFECTO);
  if (ptySesiones.has(id)) return { ok: true, id };

  const shell =
    process.platform === 'win32'
      ? 'powershell.exe'
      : process.env.SHELL || '/bin/bash';

  const args = process.platform === 'win32' ? ['-NoLogo'] : [];

  try {
    const child = nodePty.spawn(shell, args, {
      name: 'xterm-color',
      cols: Math.max(20, Number(payload?.cols ?? state.prefs.terminalCols ?? 100)),
      rows: Math.max(5, Number(payload?.rows ?? state.prefs.terminalRows ?? 24)),
      cwd: currentTerminalCwd(),
      env: process.env,
    });

    child.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', { chunk: data, raw: true, id });
      }
    });

    child.onExit(({ exitCode }) => {
      ptySesiones.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:done', { code: exitCode, id });
      }
    });

    ptySesiones.set(id, { child, shell });
    return { ok: true, id, shell };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Escribe en un PTY (teclas o texto). */
ipcMain.handle('terminal:pty-write', async (_event, payload) => {
  const id = typeof payload === 'object' && payload !== null ? String(payload.id ?? PTY_POR_DEFECTO) : PTY_POR_DEFECTO;
  const datos = typeof payload === 'object' && payload !== null ? payload.data : payload;

  const sesion = ptySesiones.get(id);
  if (!sesion) return { ok: false, error: 'PTY no iniciado' };

  try {
    sesion.child.write(String(datos ?? ''));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Redimensiona un PTY. */
ipcMain.handle('terminal:pty-resize', async (_event, payload) => {
  const id = String(payload?.id ?? PTY_POR_DEFECTO);
  const sesion = ptySesiones.get(id);
  if (!sesion) return { ok: false };

  try {
    sesion.child.resize(
      Math.max(20, Number(payload?.cols ?? 100)),
      Math.max(5, Number(payload?.rows ?? 24)),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

/** Cierra un PTY concreto, o todos si no se indica ninguno. */
ipcMain.handle('terminal:pty-kill', async (_event, payload) => {
  const id = payload?.id;

  if (id === undefined) {
    cerrarTodasLasPty();
    return { ok: true };
  }

  const clave = String(id);
  const sesion = ptySesiones.get(clave);
  if (!sesion) return { ok: false };

  try {
    sesion.child.kill();
  } catch {
    // ya cerrada
  }
  ptySesiones.delete(clave);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Terminal integrada
// ---------------------------------------------------------------------------

/** Directorio actual de la terminal (persiste entre comandos). */
let terminalCwd = null;

/** Proceso de terminal en curso. */
let terminalProcess = null;

function currentTerminalCwd() {
  return terminalCwd ?? state.cwd;
}

/**
 * Ejecuta un comando en la terminal y transmite su salida por `terminal:data`.
 * No es un PTY: no hay aplicaciones de pantalla completa ni control de cursor.
 */
ipcMain.handle('terminal:run', async (event, payload) => {
  if (terminalProcess) {
    return { ok: false, error: 'ya hay un comando en ejecución' };
  }

  const command = String(payload?.command ?? '').trim();
  if (command.length === 0) return { ok: false, error: 'comando vacío' };

  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, data);
  };

  // `cd` se resuelve aquí para que persista entre comandos.
  const cdMatch = command.match(/^cd(?:\s+(.+))?$/);
  if (cdMatch) {
    const target = (cdMatch[1] ?? '').replace(/^["']|["']$/g, '').trim();
    const next = path.resolve(currentTerminalCwd(), target.length > 0 ? target : '.');

    try {
      const info = await fsp.stat(next);
      if (!info.isDirectory()) return { ok: false, error: 'no es un directorio' };
      terminalCwd = next;
      send('terminal:data', { chunk: `${next}\n` });
      send('terminal:done', { code: 0 });
      return { ok: true };
    } catch {
      send('terminal:data', { chunk: `cd: no existe ${next}\n` });
      send('terminal:done', { code: 1 });
      return { ok: true };
    }
  }

  if (command === 'clear' || command === 'cls') {
    send('terminal:clear', {});
    send('terminal:done', { code: 0 });
    return { ok: true };
  }

  const { spawn } = require('node:child_process');

  terminalProcess = spawn(command, {
    cwd: currentTerminalCwd(),
    shell: true,
    windowsHide: true,
  });

  terminalProcess.stdout.on('data', (chunk) => {
    send('terminal:data', { chunk: chunk.toString() });
  });
  terminalProcess.stderr.on('data', (chunk) => {
    send('terminal:data', { chunk: chunk.toString() });
  });

  terminalProcess.on('error', (error) => {
    send('terminal:data', { chunk: `${error.message}\n` });
  });

  terminalProcess.on('close', (code) => {
    terminalProcess = null;
    send('terminal:done', { code: code ?? 0 });
  });

  return { ok: true };
});

/** Interrumpe el comando en curso. */
ipcMain.handle('terminal:kill', async () => {
  if (!terminalProcess) return { ok: false };
  try {
    terminalProcess.kill('SIGKILL');
  } catch {
    // ya terminado
  }
  terminalProcess = null;
  return { ok: true };
});

/** Directorio actual de la terminal. */
ipcMain.handle('terminal:cwd', async () => currentTerminalCwd());

/**
 * Herramienta del agente: buscar en el índice de código.
 * Mucho mejor que un grep: ordena por relevancia y conoce los símbolos.
 */
function makeCodeSearchTool() {
  return {
    name: 'search_code',
    description:
      'Busca en el índice del proyecto y devuelve los ficheros más relevantes con sus símbolos. ' +
      'Ordénalo por relevancia, no por texto literal. Úsalo antes de explorar a ciegas.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué buscas, en lenguaje natural o un nombre.' },
        mode: {
          type: 'string',
          description: 'symbol (nombres), lexical (palabras) o auto (híbrido).',
        },
        limit: { type: 'number', description: 'Máximo de resultados. Por defecto 10.' },
      },
      required: ['query'],
    },
    async execute(args) {
      const query = String(args.query ?? '').trim();
      if (query.length === 0) return { content: 'Consulta vacía.', isError: true };

      if (codeIndex.size === 0) await codeIndex.build(state.cwd);

      const mode = String(args.mode ?? 'auto');
      const limit = Math.min(30, Number(args.limit ?? 10));

      const results =
        mode === 'symbol'
          ? codeIndex.searchSymbols(query, limit)
          : codeIndex.searchLexical(query, limit);

      if (results.length === 0) {
        return { content: `Sin resultados para «${query}».` };
      }

      const lines = results.map((entry) => {
        if (mode === 'symbol') {
          return `${entry.file}:${entry.line} — ${entry.kind} ${entry.name}`;
        }
        const symbols = entry.symbols.length > 0 ? `\n    ${entry.symbols.join(', ')}` : '';
        return `${entry.file} (score ${entry.score})${symbols}`;
      });

      return { content: lines.join('\n') };
    },
  };
}

/** Propuesta de cambio pendiente de aprobación. */
const turnCheckpoints = new Map();

/** Turno en curso (clave de checkpoint). */
let currentTurnKey = null;

/**
 * Guarda el estado original de un fichero antes de modificarlo.
 * Solo se guarda la primera vez por turno: es el estado al inicio del turno.
 */
function recordCheckpoint(absolutePath, originalContent) {
  // Registro plano para la tarjeta de revisión del turno.
  if (!cambiosDelTurno.some((entrada) => entrada.absolute === absolutePath)) {
    cambiosDelTurno.push({ absolute: absolutePath, original: originalContent });
  }

  // La trayectoria guarda el snapshot por paso; los checkpoints por turno siguen
  // sirviendo para el revert rápido de todo el turno.
  trayectoria.anotarEscritura(claveDeTrayectoria(), absolutePath, originalContent);

  if (currentTurnKey === null) return;
  const snapshot = turnCheckpoints.get(currentTurnKey);
  if (!snapshot || snapshot.has(absolutePath)) return;
  snapshot.set(absolutePath, originalContent);
}

/** Clave de trayectoria de la conversación en curso. */
function claveDeTrayectoria() {
  return String(state.sessionId ?? 'actual');
}

/** Contador monótono de pasos dentro del turno. */
let indiceDePaso = 0;

/**
 * Quick fixes del LSP para la posición o el diagnóstico indicado.
 * Devuelve solo acciones aplicables aquí: las que traen ediciones propias o un
 * comando que sabemos ejecutar.
 */
ipcMain.handle('lsp:code-actions', async (_event, payload = {}) => {
  const filePath = String(payload.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP', acciones: [] };

  const uri = pathToFileURL(absolute).href;
  const rango = payload.range ?? {
    start: { line: Number(payload.line ?? 0), character: 0 },
    end: { line: Number(payload.line ?? 0), character: 999 },
  };

  // Diagnósticos del rango pedido: el servidor los usa para afinar la respuesta.
  const diagnosticos = (client.diagnosticsFor(uri) ?? []).filter((d) => {
    const linea = d.range?.start?.line ?? -1;
    return linea >= (rango.start.line ?? 0) && linea <= (rango.end.line ?? 0);
  });

  try {
    const resultado = await client.codeAction(uri, rango, diagnosticos);
    const acciones = (Array.isArray(resultado) ? resultado : [])
      .filter((a) => a && (a.edit || a.command))
      .map((a, indice) => ({
        id: `${indice}:${a.title ?? ''}`,
        titulo: a.title ?? '(sin título)',
        kind: a.kind ?? '',
        tieneEdiciones: Boolean(a.edit),
        comando: a.command ? { command: a.command.command, arguments: a.command.arguments ?? [] } : null,
      }));

    return { ok: true, acciones, diagnosticos: diagnosticos.length };
  } catch (error) {
    return { ok: false, error: error.message ?? String(error), acciones: [] };
  }
});

/**
 * Aplica una acción de código concreta: vuelve a pedir la lista, toma la del
 * índice pedido, aplica sus ediciones y guarda.
 */
ipcMain.handle('lsp:apply-action', async (_event, payload = {}) => {
  const { aplicarWorkspaceEdit } = require('./lsp-edits.cjs');

  const filePath = String(payload.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  const uri = pathToFileURL(absolute).href;
  const rango = payload.range ?? {
    start: { line: Number(payload.line ?? 0), character: 0 },
    end: { line: Number(payload.line ?? 0), character: 999 },
  };

  const diagnosticos = (client.diagnosticsFor(uri) ?? []).filter((d) => {
    const linea = d.range?.start?.line ?? -1;
    return linea >= (rango.start.line ?? 0) && linea <= (rango.end.line ?? 0);
  });

  try {
    const resultado = await client.codeAction(uri, rango, diagnosticos);
    const acciones = (Array.isArray(resultado) ? resultado : []).filter((a) => a && (a.edit || a.command));
    const accion = acciones[Number(payload.indice ?? 0)];
    if (!accion) return { ok: false, error: 'la acción ya no está disponible' };

    // Comando sin ediciones: lo ejecuta el servidor.
    if (!accion.edit && accion.command) {
      await client.executeCommand(accion.command.command, accion.command.arguments);
      return { ok: true, ficheros: 0, comando: true };
    }

    // Ediciones: se leen los ficheros afectados, se aplican y se guardan.
    const textos = new Map();
    const rutas = new Map();

    const uris = new Set(Object.keys(accion.edit?.changes ?? {}));
    for (const cambio of accion.edit?.documentChanges ?? []) {
      if (cambio?.textDocument?.uri) uris.add(cambio.textDocument.uri);
    }

    for (const u of uris) {
      const destino = decodeURIComponent(String(u).replace(/^file:\/\//, ''));
      try {
        textos.set(u, await fsp.readFile(destino, 'utf8'));
        rutas.set(u, destino);
      } catch {
        // Fichero ilegible: se omite.
      }
    }

    const cambios = aplicarWorkspaceEdit(textos, accion.edit);
    let ficheros = 0;

    for (const [u, contenido] of cambios) {
      const destino = rutas.get(u);
      if (!destino) continue;
      recordCheckpoint(destino, textos.get(u) ?? '');
      await fsp.writeFile(destino, contenido, 'utf8');
      ficheros += 1;

      // Mantener el servidor al día con lo que acabamos de escribir.
      try {
        client.notify('textDocument/didChange', {
          textDocument: { uri: u, version: null },
          contentChanges: [{ text: contenido }],
        });
      } catch {
        // Si falla la notificación, el servidor se resincroniza al reabrir.
      }
    }

    return { ok: true, ficheros };
  } catch (error) {
    return { ok: false, error: error.message ?? String(error) };
  }
});

/**
 * Buscar y reemplazar en todo el proyecto.
 * Recorre el workspace con las mismas exclusiones que el índice y devuelve las
 * coincidencias agrupadas por fichero.
 */
ipcMain.handle('search:run', async (_event, payload = {}) => {
  const { buscarEnContenido, crearBuscador, listarFicheros } = require('./search.cjs');

  const consulta = String(payload.consulta ?? '');
  if (consulta.length === 0) return { resultados: [], ficheros: 0, truncado: false };

  const buscar = crearBuscador(consulta, payload.opciones ?? {});
  const raiz = state.cwd;
  const rutas = await listarFicheros(raiz);

  const resultados = [];
  const limite = 500;

  for (const relativa of rutas) {
    if (resultados.length >= limite) break;
    let contenido;
    try {
      contenido = await fsp.readFile(path.join(raiz, relativa), 'utf8');
    } catch {
      continue;
    }
    const hallazgos = buscarEnContenido(contenido, buscar, relativa, limite - resultados.length);
    resultados.push(...hallazgos);
  }

  return {
    resultados: resultados.map(({ indice, longitud, ...resto }) => resto),
    ficheros: new Set(resultados.map((r) => r.ruta)).size,
    truncado: resultados.length >= limite,
  };
});

/** Reemplaza en todo el proyecto. Devuelve cuántos ficheros y coincidencias tocó. */
ipcMain.handle('search:replace', async (_event, payload = {}) => {
  const { crearBuscador, listarFicheros, reemplazarEnContenido } = require('./search.cjs');

  const consulta = String(payload.consulta ?? '');
  if (consulta.length === 0) return { ficheros: 0, cambios: 0 };

  const buscar = crearBuscador(consulta, payload.opciones ?? {});
  const reemplazo = String(payload.reemplazo ?? '');
  const raiz = state.cwd;

  let ficheros = 0;
  let cambios = 0;

  for (const relativa of await listarFicheros(raiz)) {
    const absoluta = path.join(raiz, relativa);
    let contenido;
    try {
      contenido = await fsp.readFile(absoluta, 'utf8');
    } catch {
      continue;
    }

    const resultado = reemplazarEnContenido(contenido, buscar, reemplazo, payload.opciones ?? {});
    if (resultado.cambios === 0) continue;

    // Snapshot antes de tocar: así el cambio también se puede deshacer.
    recordCheckpoint(absoluta, contenido);

    try {
      await fsp.writeFile(absoluta, resultado.contenido, 'utf8');
      ficheros += 1;
      cambios += resultado.cambios;
    } catch {
      // Sin permisos o fichero bloqueado: se ignora ese fichero.
    }
  }

  return { ficheros, cambios };
});

/**
 * Cambios del turno en curso: ruta y contenido previo de cada fichero escrito.
 * `turnCheckpoints` se indexa por el turno y se limpia al revertir; esto es un
 * registro plano que sobrevive hasta el final del turno para poder pintar la
 * tarjeta de revisión.
 */
let cambiosDelTurno = [];

/**
 * Restaura los ficheros a su estado en el punto indicado.
 * Se aplican los snapshots del más nuevo al más antiguo, de modo que el
 * resultado final sea el estado del turno más antiguo que se revierte.
 */
async function restoreCheckpoints(keepCount) {
  const keys = [...turnCheckpoints.keys()]
    .filter((key) => key >= keepCount)
    .sort((a, b) => b - a);

  let restored = 0;

  for (const key of keys) {
    const snapshot = turnCheckpoints.get(key);
    if (snapshot) {
      for (const { absolute, original } of cambiosDelTurno) {
        try {
          if (original === null) {
            await fsp.rm(absolute, { force: true });
          } else {
            await fsp.writeFile(absolute, original, 'utf8');
          }
          restored += 1;
        } catch {
          // si falla un fichero, se sigue con el resto
        }
      }
    }
    turnCheckpoints.delete(key);
  }

  /*
   * Sin checkpoints en memoria —tras reiniciar la app— se restaura desde la
   * trayectoria persistida. Antes el revert truncaba los mensajes y devolvía
   * `restoredFiles: 0`: el usuario veía deshecha la conversación pero los
   * ficheros seguían modificados, que es el peor resultado posible.
   */
  if (restored === 0 && state.sessionId) {
    try {
      await trayectoria.asegurar(state.sessionId);
      const plan = trayectoria.planDeReversion(state.sessionId, keepCount);
      if (plan.ok) {
        for (const cambio of plan.cambios ?? []) {
          try {
            if (cambio.accion === 'borrar') {
              await fsp.rm(cambio.ruta, { force: true });
            } else {
              if (typeof cambio.contenido === 'string') {
                await fsp.writeFile(cambio.ruta, cambio.contenido, 'utf8');
                restored += 1;
              }
            }
          } catch {
            // si falla un fichero, se sigue con el resto
          }
        }
      }
    } catch {
      // sin trayectoria no hay nada que restaurar
    }
  }

  return restored;
}

/** Propuestas de diff esperando respuesta del usuario. */
const pendingDiffs = new Map();

/**
 * Envía una propuesta de diff al renderer y espera aceptación o rechazo.
 * Si nadie responde en 10 minutos, se rechaza.
 */
function requestDiffApproval(win, payload) {
  return new Promise((resolve) => {
    const id = `diff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingDiffs.delete(id);
      resolve(false);
    }, 10 * 60 * 1000);

    pendingDiffs.set(id, (accepted) => {
      clearTimeout(timer);
      resolve(accepted);
    });

    win.webContents.send('diff:proposal', { id, ...payload });
  });
}

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------

/** Planes esperando revisión del usuario. */
const pendingPlans = new Map();

/** Muestra una tarjeta de plan y espera la decisión del usuario. */
function requestPlanApproval(win, plan) {
  return new Promise((resolve) => {
    const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingPlans.delete(id);
      resolve({ approved: false, feedback: 'tiempo de espera agotado' });
    }, 10 * 60 * 1000);

    pendingPlans.set(id, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });

    win.webContents.send('plan:proposal', { id, ...plan });
  });
}

/** El renderer responde a una propuesta de plan. */
ipcMain.handle('plan:respond', async (_event, payload) => {
  const id = String(payload?.id ?? '');
  const entry = pendingPlans.get(id);
  if (!entry) return { ok: false, error: 'plan no encontrado' };

  pendingPlans.delete(id);
  entry({
    approved: payload.approved === true,
    feedback: typeof payload.feedback === 'string' ? payload.feedback.slice(0, 2000) : '',
    // El plan que vuelve es el que el usuario editó, no el que propuso el agente.
    steps: Array.isArray(payload.steps)
      ? payload.steps.slice(0, 40).map((step) => ({
          title: String(step?.title ?? '').slice(0, 400),
          detail: step?.detail ? String(step.detail).slice(0, 800) : '',
        }))
      : null,
  });
  return { ok: true };
});

/** Preguntas esperando respuesta del usuario. */
const pendingQuestions = new Map();

/** Muestra una tarjeta de preguntas y espera la respuesta del usuario. */
function requestUserQuestion(win, preguntas) {
  return new Promise((resolve) => {
    const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingQuestions.delete(id);
      resolve(null);
    }, 10 * 60 * 1000);

    pendingQuestions.set(id, (respuesta) => {
      clearTimeout(timer);
      resolve(respuesta);
    });

    win.webContents.send('question:ask', { id, questions: preguntas });
  });
}

/** El renderer responde a una tarjeta de preguntas. */
ipcMain.handle('question:respond', async (_event, payload) => {
  const id = String(payload?.id ?? '');
  const entry = pendingQuestions.get(id);
  if (!entry) return { ok: false, error: 'pregunta no encontrada' };

  pendingQuestions.delete(id);
  entry(payload?.answers ?? null);
  return { ok: true };
});

/** Lista los pasos de la trayectoria de la conversación en curso. */
ipcMain.handle('trajectory:list', async () => {
  // La carga es perezosa: hay que asegurarla antes de leer.
  await trayectoria.asegurar(claveDeTrayectoria());
  return { pasos: trayectoria.listarPasos(claveDeTrayectoria()) };
});

/** Prepara la reversión a un paso: qué se restauraría y qué se borraría. */
ipcMain.handle('trajectory:preview', async (_event, payload) => {
  await trayectoria.asegurar(claveDeTrayectoria());
  const indice = Number(payload?.indice ?? 0);
  const plan = trayectoria.planDeReversion(claveDeTrayectoria(), indice);
  if (!plan.ok) return plan;

  return {
    ok: true,
    indice,
    pasosDeshacer: plan.pasosDeshacer,
    mensaje: plan.mensaje,
    cambios: plan.cambios.map((cambio) => ({
      path: path.relative(state.cwd, cambio.ruta) || cambio.ruta,
      action: cambio.accion,
    })),
  };
});

/** Revierte la conversación a un paso concreto. */
ipcMain.handle('trajectory:revert', async (_event, payload) => {
  await trayectoria.asegurar(claveDeTrayectoria());
  const indice = Number(payload?.indice ?? 0);
  const resultado = await trayectoria.revertirA(claveDeTrayectoria(), indice);
  if (!resultado.ok) return resultado;

  /*
   * Solo se restauran ficheros. El historial NO se recorta aquí: durante el turno
   * `state.messages` todavía no refleja lo que el bucle tiene en memoria, así que el
   * índice guardado no es fiable y recortar borraría la conversación entera. Para
   * deshacer también los mensajes está el revert por turno, que sí conoce su corte.
   */
  return resultado;
});

/** El renderer responde a una propuesta de diff. */
ipcMain.handle('diff:respond', async (_event, payload) => {
  const entry = pendingDiffs.get(String(payload?.id ?? ''));
  if (!entry) return { ok: false, error: 'propuesta no encontrada' };
  pendingDiffs.delete(String(payload.id));
  entry(payload.accepted === true);
  return { ok: true };
});

/** Diálogo nativo de permiso. Devuelve `true` si el usuario acepta. */
async function askPermission(win, message, detail) {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Permitir', 'Denegar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Permiso del agente',
    message,
    detail,
  });
  return result.response === 0;
}

// ---------------------------------------------------------------------------
// Almacén de sesiones
// ---------------------------------------------------------------------------

/** Instancia perezosa del almacén de sesiones. */
let store = null;

async function getStore() {
  if (store) return store;
  const { JsonlSessionStore } = await getEngine();
  store = new JsonlSessionStore();
  return store;
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

/** Ventana principal de la aplicación. */
let mainWindow = null;

function createWindow() {
  // Sin menú nativo: la app tiene su propia barra de título.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#191a1c',
    icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    show: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL('app://local/renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  // Si ready-to-show tarda por carga de recursos, forzar show
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1000);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/** Estado inicial que necesita la UI para pintarse. */
ipcMain.handle('app:state', async () => {
  const { detectAvailableProviders } = await getEngine();

  let providers = [];
  try {
    providers = await detectAvailableProviders();
  } catch {
    providers = [];
  }

  let models = [];
  if (state.providerId) {
    try {
      const { createProvider } = await getEngine();
      models = await createProvider(state.providerId).listModels();
    } catch {
      models = [];
    }
  }

  return {
    cwd: state.cwd,
    providerId: state.providerId,
    model: state.model,
    providers,
    models: models.map((model) => ({ id: model.id, name: model.name })),
    sessionId: state.sessionId,
    busy: state.busy,
  };
});

/** Detecta el framework de tests del proyecto. */
ipcMain.handle('tests:detect', async () => testrunner.detectarFramework(state.cwd));

/** Ejecuta la suite de tests y devuelve el resumen ya parseado. */
ipcMain.handle('tests:run', async () => {
  const detectado = await testrunner.detectarFramework(state.cwd);
  if (!detectado) {
    return { ok: false, error: 'no se encontró cómo correr los tests en este proyecto' };
  }

  const ejecutar = makeRunCommandTool(() => state.cwd);
  const salida = await ejecutar.execute({
    command: detectado.comando,
    cwd: state.cwd,
    waitDurationSeconds: 10000,
    taskName: 'Test run',
  });

  const resumen = testrunner.parsearSalida(salida.content);
  const codigo = Number((salida.content.match(/exit code: (-?\d+)/) ?? [])[1] ?? (salida.isError ? 1 : 0));

  const resultado = {
    framework: detectado.nombre,
    comando: detectado.comando,
    resumen,
    bien: testrunner.exito(codigo, resumen),
    cuando: new Date().toISOString(),
    salida: resumen.reconocido ? undefined : salida.content.slice(0, 20000),
  };

  state.ultimosTests = resultado;
  mainWindow?.webContents.send('chat:event', { type: 'tests_result', ...resultado });
  return { ok: true, ...resultado };
});

/** Catálogo de proveedores con disponibilidad y modelos. */
ipcMain.handle('providers:list', async () => {
  const { createProvider, PROVIDER_CATALOG } = await getEngine();
  const config = buildProviderConfig();

  const result = [];
  for (const spec of PROVIDER_CATALOG) {
    let available = false;
    let models = [];
    let reason = null;

    const hasBaseUrl = !spec.custom || Boolean(config.baseUrls[spec.id]);
    const savedKey = config.apiKeys[spec.id];
    const envValue = spec.envKey ? process.env[spec.envKey] : null;

    // Los locales no necesitan clave; el resto sí (guardada o del entorno).
    const hasKey = spec.envKey === null && !spec.custom ? true : Boolean(savedKey || envValue);

    if (!hasBaseUrl) {
      reason = 'configura la URL del endpoint';
    } else if (!hasKey) {
      reason = spec.envKey ? `falta ${spec.envKey} o una clave guardada` : 'falta la clave de API';
    } else {
      try {
        const provider = createProvider(spec.id, config);
        const listed = await provider.listModels();
        models = listed.map((model) => ({ id: model.id, name: model.name }));
        available = models.length > 0;
        if (!available) reason = 'no reporta modelos';
      } catch (cause) {
        reason = cause instanceof Error ? cause.message : String(cause);
      }
    }

    result.push({
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      local: Boolean(spec.local),
      custom: Boolean(spec.custom),
      envKey: spec.envKey,
      needsKey: spec.envKey !== null || Boolean(spec.custom),
      hasKey,
      hasEnvKey: Boolean(envValue),
      note: spec.note ?? null,
      baseUrl: config.baseUrls[spec.id] ?? spec.baseUrl,
      available,
      models,
      reason,
    });
  }

  return result;
});

/** Abre un directorio como workspace. */
ipcMain.handle('workspace:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Abrir carpeta',
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  state.cwd = result.filePaths[0];
  terminalCwd = null;
  await saveSettings();
  return { cwd: state.cwd };
});

/** Abre el diálogo de selección de fichero. */
ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Abrir fichero',
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/** Abre el diálogo de selección de imagen. */
ipcMain.handle('dialog:open-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Adjuntar imagen',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/** Ruta relativa al workspace. */
ipcMain.handle('fs:relative', (_event, target) => {
  if (!target) return '';
  return path.relative(state.cwd, target) || path.basename(target);
});

/** Lista un directorio del workspace. */
ipcMain.handle('fs:list', async (_event, dirPath) => {
  const target = path.resolve(state.cwd, dirPath || '.');
  const entries = await fsp.readdir(target, { withFileTypes: true });

  return entries
    .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath || '.', entry.name),
      isDirectory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
});

/** Lee un fichero del workspace. */
ipcMain.handle('fs:read', async (_event, filePath) => {
  const target = path.resolve(state.cwd, filePath);
  const info = await fsp.stat(target);

  if (info.size > 2_000_000) {
    throw new Error(`fichero demasiado grande (${Math.round(info.size / 1024)} KB)`);
  }

  const content = await fsp.readFile(target, 'utf8');
  return { path: filePath, content };
});

/** Escribe un fichero del workspace (guardado del editor). */
ipcMain.handle('fs:write', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = path.resolve(state.cwd, relative);

  await fsp.writeFile(absolute, content, 'utf8');
  scheduleIndexRefresh();
  return { ok: true, path: relative };
});

/** Índice de ficheros del workspace, acotado, para menciones y explorador. */
ipcMain.handle('fs:index', async () => {
  const IGNORED = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
    'target', 'bin', 'obj', '.venv', 'venv', '__pycache__',
  ]);
  const MAX_FILES = 3000;

  const files = [];

  async function walk(directory, depth) {
    if (files.length >= MAX_FILES || depth > 8) return;

    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED.has(entry.name)) continue;

      const absolute = path.join(directory, entry.name);
      const relative = path.relative(state.cwd, absolute).split(path.sep).join('/');

      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await walk(state.cwd, 0);
  return files.sort();
});

/** Cambia proveedor y/o modelo. */
ipcMain.handle('settings:set', async (_event, payload) => {
  if (payload && typeof payload.provider === 'string') {
    state.providerId = payload.provider;
    state.model = null;
  }
  if (payload && typeof payload.model === 'string') {
    state.model = payload.model;
  }
  await saveSettings();
  return { providerId: state.providerId, model: state.model };
});

/** Lee las preferencias de la UI. */
ipcMain.handle('prefs:get', async () => state.prefs);
/** Actualiza preferencias (merge superficial) y las persiste. */
ipcMain.handle('prefs:set', async (_event, patch) => {
  if (patch && typeof patch === 'object') {
    state.prefs = { ...state.prefs, ...patch };
    await saveSettings();
  }
  return state.prefs;
});

/** Borra una conversación. */
ipcMain.handle('sessions:delete', async (_event, id) => {
  const sessions = await getStore();
  await sessions.delete(String(id));
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Controles de ventana
// ---------------------------------------------------------------------------

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggle-maximize', async () => {
  if (!mainWindow) return false;

  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();

  // El cambio es asíncrono en Windows: espera al evento antes de responder.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:toggle-devtools', () => {
  mainWindow?.webContents.toggleDevTools();
});

ipcMain.handle('window:zoom', (_event, delta) => {
  const contents = mainWindow?.webContents;
  if (!contents) return 0;
  if (delta === 0) contents.setZoomLevel(0);
  else contents.setZoomLevel(contents.getZoomLevel() + Number(delta));
  return contents.getZoomLevel();
});

/** Estado de la ventana: sirve para comprobar que sigue siendo redimensionable. */
ipcMain.handle('window:info', () => {
  if (!mainWindow) return null;
  return {
    resizable: mainWindow.isResizable(),
    maximizable: mainWindow.isMaximizable(),
    minimizable: mainWindow.isMinimizable(),
    isMaximized: mainWindow.isMaximized(),
    bounds: mainWindow.getBounds(),
  };
});

/** Redimensiona la ventana (solo para comprobaciones). */
ipcMain.handle('window:set-size', (_event, width, height) => {
  if (!mainWindow) return null;
  mainWindow.setSize(Math.round(width), Math.round(height));
  return mainWindow.getBounds();
});

ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

/**
 * Conexión con la cuenta de Google.
 *
 * `generate_image` usa Flow, que necesita una sesión de Google. En vez de pedir
 * claves, se abre el navegador integrado para que el usuario inicie sesión una
 * vez: la partición `persist:opengravity-browser` conserva las cookies entre
 * arranques, así que después ya no hay que repetirlo.
 */
/**
 * Despertar reactivo.
 *
 * El blueprint de Antigravity insiste en que no debe haber polling: cuando una
 * tarea de fondo termina, el motor **despierta** al agente e inyecta el
 * resultado. Sin esto, el agente deja una tarea viva y solo se entera si se le
 * ocurre preguntar con `command_status` — si no, muere en el vacío.
 *
 * Si el turno sigue abierto, el resultado entra como nota de sistema en el
 * siguiente paso. Si ya terminó, se arranca un turno nuevo con el resultado.
 */
function alTerminarUnaTarea(tarea) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const salida = `${tarea.stdout ?? ''}${tarea.stderr ?? ''}`.trim();
  const recorte = salida.length > 4000 ? `${salida.slice(0, 4000)}\n[recortado]` : salida;
  const codigo = tarea.exitCode ?? 'desconocido';

  const texto =
    `[tarea terminada] «${tarea.nombre}» acabó con código ${codigo}.\n\n` +
    (recorte.length > 0 ? recorte : '(sin salida)');

  mainWindow.webContents.send('task:finished', {
    id: tarea.id,
    nombre: tarea.nombre,
    exitCode: tarea.exitCode,
    salida: recorte,
  });

  // Con el turno abierto, la nota entra en el siguiente paso del bucle.
  notaDeTareaPendiente = texto;

  // Con el turno cerrado, se despierta uno nuevo.
  if (!state.busy) {
    notaDeTareaPendiente = null;
    mainWindow.webContents.send('task:wake', { texto });
  }
}

/** Nota de una tarea que terminó mientras el turno seguía abierto. */
let notaDeTareaPendiente = null;

/**
 * Devuelve una imagen local como data URL para pintarla en el hilo.
 *
 * Las imágenes que genera Flow se sirven desde su dominio y necesitan la sesión
 * del navegador oculto: el hilo no la tiene, así que `<img src="https://…">`
 * sale roto. Se lee el fichero ya guardado y se entrega embebido.
 */
ipcMain.handle('image:as-data-url', async (_event, rutaRelativa) => {
  try {
    const absoluta = path.resolve(state.cwd, String(rutaRelativa ?? ''));
    const datos = await fsp.readFile(absoluta);

    const extension = path.extname(absoluta).toLowerCase();
    const tipo =
      extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.gif'
            ? 'image/gif'
            : 'image/png';

    return { ok: true, dataUrl: `data:${tipo};base64,${datos.toString('base64')}` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/**
 * Genera una imagen con Flow.
 *
 * Vive aquí y no solo en el agente para poder probarlo aislado: cuando el agente
 * se atasca en un bucle, esta llamada sigue diciendo si Flow funciona o no.
 */
ipcMain.handle('image:generate', async (_event, payload) => {
  try {
    const { generarEnFlow, URL_FLOW } = require('./flow.cjs');

    const prompt = String(payload?.prompt ?? '').trim();
    if (prompt.length === 0) return { ok: false, error: 'falta el prompt' };

    let navegador = require('./tools-extra.cjs').navegadorIntegrado();
    if (!navegador) {
      openBuiltInBrowser(URL_FLOW, { oculto: true });
      await new Promise((r) => setTimeout(r, 8000));
      navegador = require('./tools-extra.cjs').navegadorIntegrado();
    }
    if (!navegador) return { ok: false, error: 'no se pudo abrir el navegador integrado' };

    const destino = payload?.path ? path.resolve(state.cwd, String(payload.path)) : null;

    return await generarEnFlow(navegador, {
      prompt,
      destino,
      aspectRatio: payload?.aspectRatio,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/**
 * Usar el Chrome del usuario.
 *
 * Se lanza SU Chrome con depuración sobre su perfil real: hereda la sesión sin
 * tocar nada cifrado. Requiere que esté cerrado del todo.
 */
ipcMain.handle('chrome:status', async () => {
  try {
    return { ok: true, ...(await require('./chrome.cjs').estado()) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('chrome:launch', async () => {
  try {
    return await require('./chrome.cjs').lanzarChrome();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('chrome:disconnect', async () => {
  require('./chrome.cjs').desconectar();
  return { ok: true };
});

ipcMain.handle('google:status', async () => {
  const { session } = require('electron');
  try {
    const sesion = session.fromPartition('persist:opengravity-browser');
    const cookies = await sesion.cookies.get({ domain: '.google.com' });
    // Con la cookie de sesión de Google basta para considerar la cuenta conectada.
    const conectada = cookies.some((c) => /^(SID|SAPISID|__Secure-1PSID)$/.test(c.name));
    return { conectada, cookies: cookies.length };
  } catch (error) {
    return { conectada: false, cookies: 0, error: String(error) };
  }
});

/** Abre el navegador integrado para iniciar sesión en Google. */
ipcMain.handle('google:connect', async () => {
  const { openBuiltInBrowser } = require('./tools-extra.cjs');
  try {
    await openBuiltInBrowser('https://accounts.google.com/');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/** Cierra la sesión de Google borrando las cookies de esa partición. */
ipcMain.handle('google:disconnect', async () => {
  const { session } = require('electron');
  try {
    const sesion = session.fromPartition('persist:opengravity-browser');
    await sesion.clearStorageData({ storages: ['cookies'] });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/** Herramientas disponibles con su permiso efectivo. */
ipcMain.handle('tools:list', async () => {
  const { fileSystemTools } = await getEngine();
  const all = [
    ...fileSystemTools,
    makeSearchFilesTool(() => state.cwd),
    makeCodeSearchTool(),
    makeEditFileTool(() => state.cwd),
    makeMultiReplaceTool(() => state.cwd),
    makeEditNotebookTool(() => state.cwd),
    makeGenerateImageTool(() => state.cwd),
    makeRunCommandTool(() => state.cwd),
    makeCommandStatusTool(),
    makeManageTaskTool(),
    makeSearchWebTool(() => state.prefs),
    makeViewCodeItemTool(() => state.cwd),
    makeEditNotebookTool(() => state.cwd),
    makeMemoryTool(getMemoria(), () => state.cwd),
    makeSkillTool(() => descubrirSkills(state.cwd)),
    makeRunWorkflowTool(() => state.cwd, (a) => makeRunCommandTool(() => state.cwd).execute(a)),
    ...makeBrowserTools(() => state.prefs, (message, detail) =>
      askPermission(mainWindow, message, detail),
    ),
    makeFetchUrlTool(() => state.prefs),
    makeOpenUrlTool(() => state.prefs),
  ];

  // Las dos que tienen flujo propio también aparecen en Ajustes.
  all.push(
    {
      name: 'present_plan',
      description: 'Presenta un plan de pasos y espera la aprobación del usuario.',
    },
    {
      name: 'ask_user_question',
      description: 'Hace preguntas al usuario con opciones y espera su respuesta.',
    },
    {
      name: 'browser_task',
      description: 'Delega una tarea de navegación a un subagente con su propio contexto.',
    },
    {
      name: 'send_message',
    description:
      'Envía un mensaje a un subagente que está trabajando, para corregirle el rumbo sin ' +
      'matarlo ni relanzarlo. Llega a su conversación entre pasos. Usa `@children` para ' +
      'difundir a todos los que estén corriendo.',
    parameters: {
      type: 'object',
      properties: {
        recipientId: {
          type: 'string',
          description: 'Id del subagente (por ejemplo `sub-3`), o `@children` para todos.',
        },
        message: { type: 'string', description: 'Qué quieres decirle.' },
      },
      required: ['recipientId', 'message'],
    },
    async execute(args) {
      const entregados = subagentes.enviarMensaje(
        String(args.recipientId ?? '@children'),
        String(args.message ?? ''),
      );

      if (entregados === 0) {
        const vivos = subagentes.listarEnEjecucion();
        return {
          content:
            vivos.length === 0
              ? 'No hay ningún subagente corriendo ahora mismo.'
              : `No encontré ese destinatario. Vivos: ${vivos.map((v) => `${v.id} (${v.nombre})`).join(', ')}.`,
          isError: true,
        };
      }

      return { content: `Mensaje entregado a ${entregados} subagente(s).` };
    },
  },
  {
    name: 'invoke_subagent',
      description: 'Lanza varios subagentes en paralelo, cada uno con su propio contexto.',
    },
    {
      name: 'notify_user',
      description: 'Programa un aviso para más tarde, una vez o repetido con una expresión cron.',
    },
    {
      name: 'define_subagent',
      description: 'Guarda un subagente reutilizable con nombre, rol y system prompt propio.',
    },
    {
      name: 'manage_subagent',
      description: 'Lista o cancela los subagentes en ejecución.',
    },
    {
      name: 'run_tests',
      description: 'Ejecuta la suite de tests del proyecto y devuelve un resumen.',
    },
  );

  return all.map((tool) => ({
    name: tool.name,
    description: tool.description,
    permission: state.prefs.toolPermissions?.[tool.name] ?? 'inherit',
  }));
});

/** Catálogo de skills con su estado. */
ipcMain.handle('skills:list', async () => {
  const enabled = state.prefs.skills ?? {};

  // Skills del proyecto, leídas del disco.
  let delProyecto = [];
  try {
    delProyecto = await descubrirSkills(state.cwd);
  } catch {
    delProyecto = [];
  }

  const fijas = SKILL_CATALOG.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: enabled[skill.id] === true,
    source: 'app',
  }));

  const disco = delProyecto.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description || skill.relative,
    enabled: true,
    source: 'workspace',
    relative: skill.relative,
  }));

  return [...disco, ...fijas];
});

/** Perfil local. */
ipcMain.handle('profile:get', async () => state.prefs.profile ?? { name: '', email: '' });

/** Abre una URL en el navegador del sistema. */
ipcMain.handle('shell:open-external', async (_event, url) => {
  const verdict = isUrlAllowed(String(url), state.prefs.networkRules);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };
  await shell.openExternal(String(url));
  return { ok: true };
});

/** Abre una URL en el navegador integrado. */
ipcMain.handle('browser:open', async (_event, url) => {
  const verdict = isUrlAllowed(String(url), state.prefs.networkRules);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };
  openBuiltInBrowser(String(url));
  return { ok: true };
});

/** Ejecuta JavaScript en el navegador integrado (sujeto a política). */
ipcMain.handle('browser:evaluate', async (_event, script) => {
  return browserEvaluate(String(script), state.prefs, (message, detail) =>
    askPermission(mainWindow, message, detail),
  );
});

// ---------------------------------------------------------------------------
// Control remoto
// ---------------------------------------------------------------------------

/** Servidor HTTP de control remoto, cuando está activo. */
let remoteServer = null;
let remoteInfo = null;

function stopRemote() {
  return new Promise((resolve) => {
    if (!remoteServer) {
      remoteInfo = null;
      resolve();
      return;
    }
    remoteServer.close(() => {
      remoteServer = null;
      remoteInfo = null;
      resolve();
    });
  });
}

/**
 * Levanta un servidor HTTP local que permite enviar prompts desde fuera.
 *
 *   POST /prompt   { "text": "...", "token": "..." }
 *   GET  /status   → { ok, url, hasToken }
 */
async function startRemote() {
  if (remoteServer) return remoteInfo;

  const port = Number(state.prefs.remotePort ?? 4789);
  const token = String(state.prefs.remoteToken ?? '').trim();

  remoteServer = http.createServer((req, res) => {
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'GET' && req.url === '/status') {
      send(200, { ok: true, url: remoteInfo?.url ?? null, hasToken: token.length > 0 });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/prompt') {
      send(404, { ok: false, error: 'ruta no encontrada' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        send(400, { ok: false, error: 'JSON no válido' });
        return;
      }

      if (token.length > 0 && payload.token !== token) {
        send(401, { ok: false, error: 'token incorrecto' });
        return;
      }

      const text = String(payload.text ?? '').trim();
      if (text.length === 0) {
        send(400, { ok: false, error: 'falta el campo text' });
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remote:prompt', text);
      }

      send(200, { ok: true, accepted: true });
    });
  });

  await new Promise((resolve, reject) => {
    remoteServer.once('error', reject);
    remoteServer.listen(port, '127.0.0.1', resolve);
  });

  remoteInfo = { url: `http://127.0.0.1:${port}`, hasToken: token.length > 0 };
  return remoteInfo;
}

ipcMain.handle('remote:status', async () => ({
  running: remoteServer !== null,
  url: remoteInfo?.url ?? null,
  hasToken: String(state.prefs.remoteToken ?? '').trim().length > 0,
  port: Number(state.prefs.remotePort ?? 4789),
}));

ipcMain.handle('remote:start', async () => {
  try {
    const info = await startRemote();
    return { ok: true, ...info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('remote:stop', async () => {
  await stopRemote();
  return { ok: true };
});

/** Lista sesiones guardadas. */
/** Exporta una conversación a Markdown en el disco. */
ipcMain.handle('sessions:export', async (_event, id) => {
  const sessions = await getStore();
  const session = await sessions.load(id);

  const lines = [`# ${session.meta.title}`, ''];
  for (const message of session.messages) {
    const who = message.role === 'user' ? 'Usuario' : message.role === 'assistant' ? 'Agente' : message.role;
    lines.push(`## ${who}`, '');
    const content = Array.isArray(message.content)
      ? message.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join('\n')
      : String(message.content ?? '');
    lines.push(content, '');
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar conversación',
    defaultPath: `${session.meta.title.replace(/[^\w\s-]/g, '').trim() || 'conversacion'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  if (result.canceled || !result.filePath) return { ok: false };
  await fsp.writeFile(result.filePath, lines.join('\n'), 'utf8');
  return { ok: true, path: result.filePath };
});

/** Renombra una conversación. */
ipcMain.handle('sessions:rename', async (_event, id, title) => {
  const sessions = await getStore();
  await sessions.rename(id, String(title ?? '').slice(0, 120));
  return { ok: true };
});

/**
 * Borra las conversaciones más antiguas que la retención configurada.
 * `retentionDays` puede ser «Nunca», que desactiva la limpieza.
 */
async function applyRetention() {
  const pref = state.prefs.retentionDays ?? '30';
  if (String(pref) === 'Nunca') return { ok: true, removed: 0, skipped: true };

  const days = Number(pref);
  if (!Number.isFinite(days) || days <= 0) return { ok: true, removed: 0, skipped: true };

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = await getStore();
  const all = await sessions.list();

  let removed = 0;

  for (const meta of all) {
    const when = new Date(meta.updatedAt ?? meta.createdAt ?? 0).getTime();
    if (!Number.isFinite(when) || when >= cutoff) continue;

    // La conversación abierta no se toca.
    if (meta.id === state.sessionId) continue;

    try {
      await sessions.delete(meta.id);
      removed += 1;
    } catch {
      // si una falla, se sigue con el resto
    }
  }

  return { ok: true, removed, days };
}

/** Aplica la retención ahora y devuelve cuántas se borraron. */
ipcMain.handle('sessions:apply-retention', async () => applyRetention());

ipcMain.handle('sessions:list', async () => {
  const sessions = await getStore();
  return sessions.list();
});

/** Carga una sesión en el estado actual. */
ipcMain.handle('sessions:load', async (_event, id) => {
  const sessions = await getStore();
  const loaded = await sessions.load(id);

  state.sessionId = loaded.meta.id;
  state.messages = loaded.messages;
  state.providerId = loaded.meta.provider;
  state.model = loaded.meta.model;

  return { meta: loaded.meta, messages: loaded.messages };
});

/// Control de cancelación de la ejecución en curso.
let currentAbort = null;

/**
 * Deshace hasta el mensaje indicado: trunca el historial y reescribe la sesión.
 * Equivale al botón «Undo to this point» de Antigravity.
 */
// ---------------------------------------------------------------------------
// Tareas programadas
// ---------------------------------------------------------------------------

/** Ruta del fichero de tareas programadas. */
function scheduledPath() {
  return path.join(app.getPath('userData'), 'scheduled.json');
}

/** Lee las tareas programadas del disco. */
async function readScheduled() {
  try {
    const raw = await fsp.readFile(scheduledPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Guarda las tareas programadas. */
async function writeScheduled(tasks) {
  await fsp.writeFile(scheduledPath(), JSON.stringify(tasks, null, 2), 'utf8');
}

/** Lista las tareas programadas. */
ipcMain.handle('scheduled:list', async () => {
  const tasks = await readScheduled();
  return tasks.map((task) => ({
    ...task,
    due: task.enabled !== false && new Date(task.nextRunAt ?? 0).getTime() <= Date.now(),
  }));
});

/** Crea o actualiza una tarea programada. */
ipcMain.handle('scheduled:save', async (_event, task) => {
  const tasks = await readScheduled();
  const id = task.id ?? `t${Date.now().toString(36)}`;

  const modo = task.mode === 'once' || task.mode === 'cron' ? task.mode : 'interval';

  let nextRunAt = task.nextRunAt ?? new Date().toISOString();

  if (modo === 'once' && task.at) {
    nextRunAt = new Date(task.at).toISOString();
  } else if (modo === 'cron' && task.cron) {
    try {
      const proxima = siguienteEjecucion(compilarCron(task.cron));
      nextRunAt = (proxima ?? new Date()).toISOString();
    } catch {
      return { ok: false, error: 'expresión cron inválida' };
    }
  }

  const next = {
    id,
    prompt: String(task.prompt ?? '').slice(0, 4000),
    mode: modo,
    every: Math.max(1, Math.floor(Number(task.every ?? 60))),
    unit: task.unit === 'hours' ? 'hours' : 'minutes',
    cron: modo === 'cron' ? String(task.cron ?? '') : null,
    at: modo === 'once' ? String(task.at ?? '') : null,
    maxTriggers: Number.isFinite(Number(task.maxTriggers)) ? Number(task.maxTriggers) : null,
    triggers: Number(task.triggers ?? 0),
    createdBy: task.createdBy === 'agent' ? 'agent' : 'user',
    enabled: task.enabled !== false,
    nextRunAt,
    lastRunAt: task.lastRunAt ?? null,
  };

  const index = tasks.findIndex((entry) => entry.id === id);
  if (index >= 0) tasks[index] = { ...tasks[index], ...next };
  else tasks.push(next);

  await writeScheduled(tasks);
  return { ok: true, id };
});

/** Borra una tarea programada. */
ipcMain.handle('scheduled:delete', async (_event, id) => {
  const tasks = await readScheduled();
  await writeScheduled(tasks.filter((task) => task.id !== id));
  return { ok: true };
});

/** Activa o desactiva una tarea. */
ipcMain.handle('scheduled:toggle', async (_event, id, enabled) => {
  const tasks = await readScheduled();
  const found = tasks.find((task) => task.id === id);
  if (found) {
    found.enabled = Boolean(enabled);
    await writeScheduled(tasks);
  }
  return { ok: true };
});

/** Ejecuta ahora una tarea, sin esperar a su hora. */
ipcMain.handle('scheduled:run', async (_event, id) => {
  const tasks = await readScheduled();
  const found = tasks.find((task) => task.id === id);
  if (!found) return { ok: false, error: 'tarea no encontrada' };

  mainWindow?.webContents.send('scheduled:fire', { id: found.id, prompt: found.prompt });
  return { ok: true };
});

/** Cancela los avisos únicos marcados con cancelOn "any". */
async function cancelarAvisosPendientes() {
  const tareas = await readScheduled();
  let cambiado = false;

  for (const tarea of tareas) {
    if (tarea.mode !== 'once') continue;
    if (tarea.enabled === false) continue;
    if (tarea.cancelOn !== 'any') continue;

    tarea.enabled = false;
    tarea.canceladoEn = new Date().toISOString();
    cambiado = true;
  }

  if (cambiado) await writeScheduled(tareas);
  return cambiado;
}

/** Comprueba cada minuto si hay tareas vencidas. */
function startScheduler() {
  setInterval(async () => {
    if (state.busy) return;

    const tasks = await readScheduled();
    let changed = false;

    for (const task of tasks) {
      if (task.enabled === false) continue;
      if (new Date(task.nextRunAt ?? 0).getTime() > Date.now()) continue;

      task.lastRunAt = new Date().toISOString();
      task.triggers = Number(task.triggers ?? 0) + 1;

      /*
       * Historial de ejecuciones, como el suyo («Runs show up here»).
       * Se guardan las últimas 20 para no engordar el fichero.
       */
      if (!Array.isArray(task.runs)) task.runs = [];
      task.runs.push({ at: task.lastRunAt, ok: true });
      if (task.runs.length > 20) task.runs = task.runs.slice(-20);

      changed = true;

      // Un aviso de una sola vez se apaga al dispararse.
      if (task.mode === 'once') {
        task.enabled = false;
      } else if (task.mode === 'cron' && task.cron) {
        try {
          const proxima = siguienteEjecucion(compilarCron(task.cron));
          const base = proxima ?? new Date(Date.now() + 60000);
          // El jitter dispersa el disparo para que varias tareas de la misma hora no
          // salgan todas en el mismo segundo.
          const dispersion = Number(task.jitterSeconds ?? 0);
          if (dispersion > 0) base.setSeconds(base.getSeconds() + Math.floor(Math.random() * dispersion));
          task.nextRunAt = base.toISOString();
        } catch {
          task.enabled = false;
        }
      } else {
        const step = (task.unit === 'hours' ? 3600000 : 60000) * Number(task.every ?? 60);
        task.nextRunAt = new Date(Date.now() + step).toISOString();
      }

      // Tope de disparos: se apaga al llegar.
      if (Number.isFinite(task.maxTriggers) && task.maxTriggers !== null) {
        if (task.triggers >= Number(task.maxTriggers)) task.enabled = false;
      }

      mainWindow?.webContents.send('scheduled:fire', { id: task.id, prompt: task.prompt });
    }

    if (changed) await writeScheduled(tasks);
  }, 60000).unref?.();
}

/**
 * Cambios del turno en curso: cuántos ficheros se tocaron y cuántas líneas se
 * añadieron y quitaron. Se compara el snapshot del checkpoint con el contenido
 * actual, así que vale tanto si hubo tarjeta de diff como si no.
 */
ipcMain.handle('chat:turn-changes', async () => {
  if (cambiosDelTurno.length === 0) {
    return { files: 0, additions: 0, removals: 0, paths: [] };
  }

  const { diffLines } = require('./diff.cjs');
  let additions = 0;
  let removals = 0;
  const paths = [];

  for (const { absolute, original } of cambiosDelTurno) {
    let actual = '';
    try {
      actual = await fsp.readFile(absolute, 'utf8');
    } catch {
      actual = '';
    }

    const antes = original ?? '';
    if (antes === actual) continue;

    const stats = diffLines(antes, actual);
    additions += stats.additions ?? 0;
    removals += stats.removals ?? 0;
    paths.push(path.relative(state.cwd, absolute) || absolute);
  }

  return { files: paths.length, additions, removals, paths };
});

/** Vista previa de lo que deshará `chat:revert`. */
ipcMain.handle('chat:revert-preview', async (_event, keepCount) => {
  const keep = Math.max(0, Math.floor(Number(keepCount)));

  const keys = [...turnCheckpoints.keys()]
    .filter((key) => key >= keep)
    .sort((a, b) => b - a);

  const files = new Map();

  for (const key of keys) {
    const snapshot = turnCheckpoints.get(key);
    if (!snapshot) continue;

    for (const [absolute, original] of snapshot) {
      // Gana el snapshot más antiguo: es el estado al que se vuelve.
      files.set(absolute, {
        path: path.relative(state.cwd, absolute) || path.basename(absolute),
        action: original === null ? 'delete' : 'restore',
      });
    }
  }

  /*
   * Si no hay checkpoints en memoria —el caso normal tras reiniciar la app— se
   * consulta la trayectoria persistida. Antes el preview devolvía una lista de
   * ficheros vacía tras reiniciar aunque la trayectoria estuviera en disco, así
   * que el usuario veía «no hay nada que deshacer» cuando sí lo había.
   */
  if (files.size === 0 && state.sessionId) {
    try {
      await trayectoria.asegurar(state.sessionId);
      const plan = trayectoria.planDeReversion(state.sessionId, keep);
      if (plan.ok) {
        for (const cambio of plan.cambios ?? []) {
          files.set(cambio.ruta, {
            path: path.relative(state.cwd, cambio.ruta) || path.basename(cambio.ruta),
            action: cambio.accion === 'borrar' ? 'delete' : 'restore',
          });
        }
      }
    } catch {
      // Sin trayectoria: se queda la lista vacía.
    }
  }

  return {
    ok: true,
    messages: state.messages.length - keep,
    files: [...files.values()],
  };
});

ipcMain.handle('chat:revert', async (_event, keepCount) => {
  if (state.busy) {
    return { ok: false, error: 'espera a que el agente termine' };
  }

  const keep = Math.max(0, Math.floor(Number(keepCount)));
  const restored = await restoreCheckpoints(keep);
  state.messages = state.messages.slice(0, keep);

  if (state.sessionId) {
    try {
      const sessions = await getStore();
      await sessions.rewrite(state.sessionId, state.messages);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { ok: true, messages: state.messages.length, restoredFiles: restored };
});

/** Cancela la ejecución actual del agente. */
ipcMain.handle('chat:abort', async () => {
  if (currentAbort) {
    currentAbort.abort();
    return { ok: true };
  }
  return { ok: false };
});

/** Envía un turno al agente y transmite los eventos por `chat:event`. */
ipcMain.handle('chat:send', async (event, payload) => {
  if (state.busy) {
    return { ok: false, error: 'el agente ya está trabajando' };
  }

  const text = typeof payload === 'string' ? payload : String(payload?.text ?? '');
  const mentions = Array.isArray(payload?.mentions) ? payload.mentions.slice(0, 20) : [];

  // Esfuerzo de razonamiento y preset llegan desde el composer.
  const effort = typeof payload?.effort === 'string' ? payload.effort : 'Medium';
  if (typeof payload?.preset === 'string') {
    state.prefs.permissionPreset = payload.preset;
  }

  let input = text.trim();
  if (input.length === 0) {
    return { ok: false, error: 'mensaje vacío' };
  }

  // Un aviso pendiente con cancelOn "any" se cancela en cuanto el usuario escribe:
  // para eso estaba, para no avisar de algo que ya se está hablando.
  try {
    await cancelarAvisosPendientes();
  } catch {
    // si falla la cancelación, el mensaje sigue su curso
  }

  // Adjunta el contenido de los ficheros mencionados con @.
  // Las imágenes no se leen como texto: van como partes binarias al modelo.
  const images = [];
  if (mentions.length > 0) {
    const blocks = [];
    for (const relative of mentions) {
      const absolute = path.resolve(state.cwd, String(relative));
      const mime = imageMimeType(relative);

      if (mime) {
        try {
          const buffer = await fsp.readFile(absolute);
          if (buffer.length > 8 * 1024 * 1024) {
            blocks.push(`### ${relative}\n(imagen demasiado grande, máx. 8 MB)`);
            continue;
          }
          images.push({ mimeType: mime, data: buffer.toString('base64') });
          blocks.push(`### ${relative}\n(imagen adjunta)`);
        } catch {
          blocks.push(`### ${relative}\n(no se pudo leer la imagen)`);
        }
        continue;
      }

      try {
        const content = await fsp.readFile(absolute, 'utf8');
        const bounded = content.length > 40000 ? `${content.slice(0, 40000)}\n[truncado]` : content;
        blocks.push(`### ${relative}\n\`\`\`\n${bounded}\n\`\`\``);
      } catch {
        blocks.push(`### ${relative}\n(no se pudo leer)`);
      }
    }
    input = `${input}\n\nFicheros adjuntos:\n\n${blocks.join('\n\n')}`;
  }

  const { runAgent, createProvider, ToolRegistry, fileSystemTools } = await getEngine();

  if (!state.providerId) {
    return { ok: false, error: 'selecciona un proveedor de modelo' };
  }

  const provider = createProvider(state.providerId, buildProviderConfig());

  if (!state.model) {
    try {
      const models = await provider.listModels();
      state.model = models[0] ? models[0].id : null;
    } catch {
      state.model = null;
    }
  }

  if (!state.model) {
    return { ok: false, error: 'el proveedor no reporta modelos' };
  }

  // Sesión: se crea la primera vez, salvo que el historial esté desactivado.
  if (!state.sessionId && state.prefs.saveHistory !== false) {
    try {
      const sessions = await getStore();
      const created = await sessions.create({
        provider: state.providerId,
        model: state.model,
        cwd: state.cwd,
      });
      state.sessionId = created.id;
    } catch {
      state.sessionId = null;
    }
  }

  const preset = state.prefs.permissionPreset ?? 'Turbo';
  const prefs = state.prefs;

  /*
   * Herramientas que ve el AGENTE. `tools:list` (el catálogo de Ajustes) es otra
   * lista distinta: añadir algo solo allí lo deja invisible para el agente.
   * Pasó con `edit_notebook` y `generate_image`.
   */
  // El gancho de despertar se registra una vez, junto a las herramientas.
  try {
    require('./tools-extra.cjs').setAlTerminarTarea(alTerminarUnaTarea);
  } catch {
    // sin gancho, el agente sigue funcionando con command_status
  }

  const baseTools = [
    ...fileSystemTools,
    makeSearchFilesTool(() => state.cwd),
    makeEditFileTool(() => state.cwd),
    makeMultiReplaceTool(() => state.cwd),
    makeEditNotebookTool(() => state.cwd),
    makeGenerateImageTool(() => state.cwd),
    makeRunCommandTool(() => state.cwd),
    makeCommandStatusTool(),
    makeManageTaskTool(),
    makeSearchWebTool(() => state.prefs),
    makeViewCodeItemTool(() => state.cwd),
    makeMemoryTool(getMemoria(), () => state.cwd),
    makeSkillTool(() => descubrirSkills(state.cwd)),
    makeRunWorkflowTool(() => state.cwd, (a) => makeRunCommandTool(() => state.cwd).execute(a)),
    ...makeBrowserTools(() => state.prefs, (message, detail) =>
      askPermission(mainWindow, message, detail),
    ),
    makeFetchUrlTool(() => state.prefs),
    makeOpenUrlTool(() => state.prefs),
  ];

  // Subagente de navegador: bucle propio, contexto propio.
  // La tarea entra como texto y sale un resumen; sus pasos no contaminan el hilo principal.
  const browserSubagent = {
    name: 'browser_task',
    description:
      'Delega una tarea de navegación a un subagente con su propio contexto. ' +
      'Úsala para investigar en la web, rellenar formularios o extraer datos de una página. ' +
      'Devuelve un resumen del resultado, no la transcripción completa.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Qué debe conseguir el subagente, en una frase concreta.',
        },
        url: {
          type: 'string',
          description: 'Página por la que empezar (opcional).',
        },
      },
      required: ['task'],
    },
    async execute(args) {
      const task = String(args?.task ?? '').trim();
      if (task.length === 0) return { content: 'Falta la tarea.', isError: true };

      const startUrl = typeof args?.url === 'string' ? args.url : '';
      const entrada = startUrl ? `${task}\n\nEmpieza en: ${startUrl}` : task;

      const subTools = new ToolRegistry().registerAll(
        makeBrowserTools(() => state.prefs, (message, detail) =>
          askPermission(mainWindow, message, detail),
        ),
      );

      const subSend = (event) => {
        // Los pasos del subagente se marcan para que la UI los anide.
        send({ ...event, subagent: 'browser' });
      };

      try {
        const result = await runAgent(
          {
            provider,
            model: state.model,
            tools: subTools,
            system:
              'Eres un subagente de navegador. Completa la tarea usando solo las herramientas de navegador. ' +
              'Cuando termines, responde con un resumen conciso de lo que encontraste o hiciste: ' +
              'hechos, datos y URLs relevantes. No incluyas la transcripción de cada clic.',
            maxSteps: 14,
            onEvent: subSend,
          },
          entrada,
          { cwd: state.cwd, signal: controller.signal },
        );

        const resumen = (result.text ?? '').trim();
        return {
          content: resumen.length > 0 ? resumen : 'El subagente terminó sin producir un resumen.',
          isError: false,
        };
      } catch (error) {
        return {
          content: `El subagente falló: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };

  // Preguntas al usuario: bloquea el turno hasta que responda.
  const askUserTool = {
    name: 'ask_user_question',
    description:
      'Hace una o varias preguntas al usuario con opciones concretas y espera su respuesta. ' +
      'Úsala cuando falte una decisión que no puedes tomar tú y no hay una opción obviamente correcta.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description:
            'Las preguntas a hacer. Puedes hacer varias a la vez si son independientes.',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description:
                  'La pregunta completa, terminada en signo de interrogación. No añadas ' +
                  '"selecciona todas las que apliquen" ni texto parecido: lo pone la interfaz.',
              },
              header: {
                type: 'string',
                description: 'Etiqueta muy corta de la pregunta (máximo 16 caracteres).',
              },
              options: {
                type: 'array',
                description:
                  'De 2 a 4 opciones. No añadas una opción "Otro": la interfaz ya la pone. ' +
                  'Si recomiendas una, ponla la primera y añade "(Recommended)" al final de ' +
                  'su etiqueta, con una razón corta en recommendedReason.',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Texto corto de la opción (1-5 palabras).' },
                    description: {
                      type: 'string',
                      description: 'Qué significa esta opción y su contrapartida.',
                    },
                    recommendedReason: {
                      type: 'string',
                      description:
                        'Una frase corta de por qué la recomiendas. Solo en la opción recomendada.',
                    },
                  },
                  required: ['label', 'description'],
                },
              },
              allowMultiple: {
                type: 'boolean',
                description: 'Si el usuario puede marcar varias opciones.',
              },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
    async execute(args) {
      const preguntas = Array.isArray(args?.questions) ? args.questions : [];
      if (preguntas.length === 0) {
        return { content: 'No hay preguntas que hacer.', isError: true };
      }

      const respuesta = await requestUserQuestion(mainWindow, preguntas);
      if (respuesta === null) {
        return {
          content: 'El usuario no respondió (se agotó el tiempo de espera).',
          isError: true,
        };
      }

      const lineas = preguntas.map((pregunta, indice) => {
        const dada = respuesta[indice];
        const texto = Array.isArray(dada) ? dada.join(', ') : String(dada ?? '');
        return `- ${pregunta.question} → ${texto.length > 0 ? texto : '(sin respuesta)'}`;
      });

      return { content: `Respuestas del usuario:\n${lineas.join('\n')}` };
    },
  };

  // Plan mode: el agente propone pasos y el usuario decide antes de ejecutar.
  const planTool = {
    name: 'present_plan',
    description:
      'Presenta un plan de pasos al usuario y espera su aprobación antes de ejecutar nada. ' +
      'Úsala al empezar una tarea con varios pasos cuando la política de revisión lo pida.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título corto del plan.' },
        steps: {
          type: 'array',
          description: 'Pasos ordenados del plan.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Qué se hará.' },
              detail: { type: 'string', description: 'Detalle opcional.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['title', 'steps'],
    },
    async execute(args) {
      const plan = {
        title: String(args?.title ?? 'Plan'),
        steps: Array.isArray(args?.steps)
          ? args.steps.slice(0, 40).map((step) => ({
              title: String(step?.title ?? ''),
              detail: step?.detail ? String(step.detail) : '',
            }))
          : [],
      };

      const decision = await requestPlanApproval(mainWindow, plan);

      if (!decision.approved) {
        const motivo = decision.feedback ? ` Motivo: ${decision.feedback}` : '';
        return {
          content: `El usuario rechazó el plan.${motivo} Propón uno revisado.`,
          isError: true,
        };
      }

      // El usuario puede haber editado los pasos: ese es el plan vigente.
      const definitivo = Array.isArray(decision.steps) && decision.steps.length > 0
        ? decision.steps
        : plan.steps;

      const cambiado =
        definitivo.length !== plan.steps.length ||
        definitivo.some((paso, i) => paso.title !== (plan.steps[i]?.title ?? ''));

      // El plan aprobado arranca el ciclo: a partir de aquí se cuenta para la revisión.
      ciclo.entregarPlan({ steps: definitivo });

      const listado = definitivo
        .map((paso, i) => `${i + 1}. ${paso.title}${paso.detail ? ` — ${paso.detail}` : ''}`)
        .join('\n');

      return {
        content:
          `Plan aprobado por el usuario (${definitivo.length} pasos). ` +
          (cambiado ? 'OJO: el usuario lo editó, este es el plan vigente, no el que propusiste.\n\n' : '') +
          `${listado}\n\nEjecútalo en este orden.` +
          PROMPT_EXECUTOR,
        isError: false,
      };
    },
  };

  // Modo `llm` = estático + clasificador con el modelo (cuesta tokens).
  const modoSeguridad = prefs.securityMonitor ?? 'block';
  const modoMonitor = modoSeguridad === 'llm' ? 'block' : modoSeguridad;
  const usarClasificador = modoSeguridad === 'llm';

  /** Trayectoria reciente, para el nivel 2 del clasificador. */
  const trayectoriaReciente = () => {
    const pasos = [];
    for (const mensaje of state.messages.slice(-24)) {
      if (mensaje.role === 'assistant' && Array.isArray(mensaje.toolCalls)) {
        for (const call of mensaje.toolCalls) {
          pasos.push({ herramienta: call.name, argumentos: call.arguments ?? {} });
        }
      } else if (mensaje.role === 'tool') {
        const ultimo = pasos[pasos.length - 1];
        if (ultimo && ultimo.resultado === undefined) {
          ultimo.resultado = String(mensaje.content ?? '').slice(0, 800);
          ultimo.esError = false;
        }
      }
    }
    return pasos;
  };

  const clasificarConModelo = usarClasificador
    ? async (info) => {
        try {
          const { clasificarAccion } = await import('../dist/agent/classifier.js');
          const resultado = await clasificarAccion(
            { herramienta: info.herramienta, argumentos: info.argumentos },
            trayectoriaReciente(),
            {
              provider,
              model: state.model,
              modeloRapido: prefs.classifierModel || undefined,
              umbralNivel1: Number(prefs.classifierThreshold ?? 1),
              timeoutMs: Number(prefs.classifierTimeoutMs ?? 20000),
            },
          );
          return resultado;
        } catch {
          return null;
        }
      }
    : undefined;

  // Orden de envoltura: hooks (pre reescribe args) → monitor (evalúa lo que de
  // verdad se va a ejecutar) → permisos → herramienta. La salida vuelve al revés.




  /** Herramienta: guardar un subagente reutilizable. */
  const defineSubagentTool = {
    name: 'define_subagent',
    description:
      'Define un subagente reutilizable con nombre, rol y system prompt propio. Después ' +
      'puedes lanzarlo con invoke_subagent pasando solo su nombre y la tarea.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Nombre único. Empieza por letra o número y usa solo letras, números, _, - y .',
        },
        role: {
          type: 'string',
          description: 'Su papel en 2-5 palabras, como un puesto de trabajo.',
        },
        description: {
          type: 'string',
          description: 'Qué hace y cuándo usarlo. Es lo que lees tú para decidir invocarlo.',
        },
        systemPrompt: {
          type: 'string',
          description:
            'Su instrucción de sistema completa. Si lo omites se usa el prompt genérico de ' +
            'subagente con el rol que hayas dado.',
        },
        allowWrites: {
          type: 'boolean',
          description: 'Darle también escritura y ejecución. Por defecto solo lee.',
        },
        allowMcp: {
          type: 'boolean',
          description:
            'Darle acceso a las herramientas de los servidores MCP conectados. ' +
            'Por defecto no las tiene.',
        },
      },
      required: ['name', 'role', 'description'],
    },
    async execute(args) {
      try {
        const entrada = await subagentes.definir(args ?? {});
        return {
          content:
            `Subagente definido: ${entrada.name} (${entrada.role}). ` +
            `Puedes lanzarlo con invoke_subagent indicando definition: "${entrada.name}".`,
        };
      } catch (error) {
        return {
          content: `No se pudo definir: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };

  /** Herramienta: gestionar los subagentes en ejecución. */
  const manageSubagentTool = {
    name: 'manage_subagent',
    description:
      'Gestiona los subagentes: list (los que están corriendo), list_peers (los hermanos), ' +
      'kill (cancelar unos) y kill_all (cancelar todos).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'list_peers', 'kill', 'kill_all'],
          description: 'La acción a realizar.',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids de los subagentes a matar. Obligatorio para kill.',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const accion = String(args?.action ?? 'list');

      if (accion === 'list' || accion === 'list_peers') {
        const vivos = subagentes.listarEnEjecucion();
        if (vivos.length === 0) {
          return { content: 'No hay subagentes en ejecución.' };
        }
        const lineas = vivos.map(
          (s) => `- ${s.id} · ${s.nombre} (${s.rol}) · ${s.estado} · ${s.segundos}s`,
        );
        return {
          content:
            `${vivos.length} subagente(s)${accion === 'list_peers' ? ' hermanos' : ''}:\n` +
            lineas.join('\n'),
        };
      }

      if (accion === 'kill') {
        const ids = Array.isArray(args?.ids) ? args.ids.map(String) : [];
        if (ids.length === 0) return { content: 'kill necesita ids.', isError: true };
        const muertos = subagentes.matar(ids);
        return {
          content: muertos > 0 ? `Cancelados ${muertos} subagente(s).` : 'No se encontró ninguno de esos ids.',
          isError: muertos === 0,
        };
      }

      const muertos = subagentes.matar([]);
      return {
        content: muertos > 0 ? `Cancelados ${muertos} subagente(s).` : 'No había ninguno en ejecución.',
      };
    },
  };


  // -------------------------------------------------------------------------
  // Runner de tests
  // -------------------------------------------------------------------------

  /** Último resultado, para que la UI lo muestre sin volver a correr nada. */
  state.ultimosTests = state.ultimosTests ?? null;

  const runTestsTool = {
    name: 'run_tests',
    description:
      'Ejecuta la suite de tests del proyecto y devuelve un resumen: cuántos pasan, ' +
      'cuántos fallan y qué tests fallan. Detecta el framework solo. Úsala antes de dar ' +
      'un cambio por bueno.',
    parameters: {
      type: 'object',
      properties: {
        waitDurationSeconds: {
          type: 'number',
          description:
            'Milisegundos a esperar a que termine antes de pasarlo a segundo plano ' +
            '(0–10000). Por defecto 10000.',
        },
      },
    },
    async execute(args) {
      const detectado = await testrunner.detectarFramework(state.cwd);
      if (!detectado) {
        return {
          content:
            'No he encontrado cómo se corren los tests en este proyecto: no hay ' +
            'scripts.test en package.json ni configuración de pytest, cargo o go.',
          isError: true,
        };
      }

      const ejecutar = makeRunCommandTool(() => state.cwd);
      const salida = await ejecutar.execute({
        command: detectado.comando,
        cwd: state.cwd,
        waitDurationSeconds: Number(args?.waitDurationSeconds ?? 10000),
        taskName: 'Test run',
      });

      const resumen = testrunner.parsearSalida(salida.content);
      const codigo = Number((salida.content.match(/exit code: (-?\d+)/) ?? [])[1] ?? (salida.isError ? 1 : 0));
      const bien = testrunner.exito(codigo, resumen);

      state.ultimosTests = {
        framework: detectado.nombre,
        comando: detectado.comando,
        resumen,
        bien,
        cuando: new Date().toISOString(),
      };
      send({ type: 'tests_result', ...state.ultimosTests });

      if (!resumen.reconocido) {
        // Sin resumen legible se devuelve la salida cruda: mejor eso que inventar cifras.
        return {
          content:
            `${detectado.nombre} terminó con código ${codigo}. No supe leer el resumen, ` +
            `así que aquí está la salida:\n\n${salida.content.slice(0, 4000)}`,
          isError: !bien,
        };
      }

      const partes = [
        `${detectado.nombre}: ${resumen.pasan} pasan, ${resumen.fallan} fallan` +
          (resumen.total !== null ? ` (${resumen.total} en total)` : ''),
        bien ? 'La suite pasa.' : 'La suite falla.',
      ];

      if (resumen.fallos.length > 0) {
        partes.push('Fallos:\n' + resumen.fallos.map((f) => `- ${f.nombre}`).join('\n'));
      }

      return { content: partes.join('\n'), isError: !bien };
    },
  };

  // -------------------------------------------------------------------------
  // notify_user: temporizadores y cron
  // -------------------------------------------------------------------------

  /**
   * Herramienta con la que el agente se programa a sí mismo.
   *
   * Un aviso crea una tarea en el planificador de siempre, así que dispara igual que
   * las que crea el usuario: conversación nueva con el mensaje dentro.
   */
  const notifyUserTool = {
    name: 'notify_user',
    description:
      'Programa un aviso: un mensaje que te llegará más tarde, una vez o repetido. ' +
      'Úsala cuando el usuario pida que le avises en un rato, o para revisar algo cada cierto tiempo.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'El mensaje que te llegará cuando se dispare. Escríbelo como una instrucción ' +
            'para ti, no como un texto para el usuario: tiene que entenderse sin esta conversación.',
        },
        durationSeconds: {
          type: 'number',
          description:
            'Segundos a esperar para un aviso único. Mutuamente excluyente con cronExpression.',
        },
        cronExpression: {
          type: 'string',
          description:
            'Expresión cron de 5 campos para un aviso recurrente, por ejemplo "*/5 * * * *" ' +
            'cada cinco minutos o "0 9 * * 1-5" a las 9 de lunes a viernes. ' +
            'Mutuamente excluyente con durationSeconds.',
        },
        maxTriggers: {
          type: 'number',
          description: 'Cuántas veces puede dispararse antes de apagarse. Por defecto, sin límite.',
        },
        isStanding: {
          type: 'boolean',
          description:
            'true solo si es un trabajo independiente que debe seguir disparándose cuando ' +
            'esta tarea ya haya terminado. Por defecto false.',
        },
        cancelOn: {
          type: 'string',
          enum: ['never', 'any'],
          description:
            'Para un aviso único: "any" lo cancela si el usuario escribe antes de que ' +
            'llegue. "never" (por defecto) lo deja llegar siempre. ' +
            'La cancelación por remitente concreto aún no está disponible: no hay canal ' +
            'de mensajes entrantes de subagentes.',
        },
        jitterSeconds: {
          type: 'number',
          description:
            'Solo para cron: dispersa hasta N segundos el disparo, para que varias tareas ' +
            'programadas a la misma hora no salgan todas de golpe.',
        },
      },
      required: ['message'],
    },
    async execute(args) {
      const mensaje = String(args?.message ?? '').trim();
      if (mensaje.length === 0) return { content: 'Falta el mensaje.', isError: true };

      const tieneDuracion = Number.isFinite(Number(args?.durationSeconds));
      const tieneCron = typeof args?.cronExpression === 'string' && args.cronExpression.trim().length > 0;

      if (tieneDuracion === tieneCron) {
        return {
          content: 'Da exactamente uno de durationSeconds o cronExpression.',
          isError: true,
        };
      }

      const tareas = await readScheduled();
      const id = `n${Date.now().toString(36)}`;

      if (tieneDuracion) {
        const segundos = Math.max(5, Math.min(30 * 24 * 3600, Number(args.durationSeconds)));
        const cancelOn = typeof args?.cancelOn === 'string' ? args.cancelOn.trim() : 'never';

        tareas.push({
          id,
          prompt: mensaje,
          mode: 'once',
          at: new Date(Date.now() + segundos * 1000).toISOString(),
          nextRunAt: new Date(Date.now() + segundos * 1000).toISOString(),
          triggers: 0,
          maxTriggers: 1,
          cancelOn: cancelOn.length > 0 ? cancelOn : 'never',
          createdBy: 'agent',
          enabled: true,
          lastRunAt: null,
        });

        await writeScheduled(tareas);

        const cuando = new Date(Date.now() + segundos * 1000);
        return {
          content:
            `Aviso programado (${id}) para dentro de ${segundos} s, a las ${cuando.toLocaleString()}. ` +
            'Se disparará en una conversación nueva con tu mensaje.',
        };
      }

      let compilado;
      try {
        compilado = compilarCron(args.cronExpression);
      } catch (error) {
        return { content: `Expresión cron inválida: ${error.message}`, isError: true };
      }

      const proxima = siguienteEjecucion(compilado);
      if (!proxima) {
        return {
          content: 'Esa expresión no se cumple nunca en los próximos dos años.',
          isError: true,
        };
      }

      const jitter = Math.max(0, Math.min(600, Number(args?.jitterSeconds ?? 0) || 0));

      tareas.push({
        id,
        prompt: mensaje,
        mode: 'cron',
        cron: compilado.expresion,
        nextRunAt: proxima.toISOString(),
        triggers: 0,
        maxTriggers: Number.isFinite(Number(args?.maxTriggers)) ? Number(args.maxTriggers) : null,
        jitterSeconds: jitter,
        createdBy: 'agent',
        enabled: true,
        lastRunAt: null,
      });

      await writeScheduled(tareas);

      return {
        content:
          `Aviso recurrente programado (${id}): ${compilado.expresion}. ` +
          `${describirCron(compilado.expresion)}. ` +
          (args?.isStanding === true
            ? 'Es un trabajo independiente: seguirá aunque termine la tarea actual.'
            : 'Se apagará cuando la tarea actual termine si no lo mantienes.'),
      };
    },
  };

  /*
   * Herramientas MCP en crudo, para poder dárselas a un subagente que tenga
   * `allowMcp`. Se rellena en el bucle de plugins, que corre más abajo.
   */
  const mcpToolDefs = [];

  // -------------------------------------------------------------------------
  // Subagentes en paralelo
  // -------------------------------------------------------------------------

  /**
   * Herramienta general de delegación: lanza varios subagentes a la vez, cada uno
   * con su propio contexto, y devuelve solo sus resúmenes.
   *
   * Por defecto solo llevan herramientas de lectura. Escribir en el proyecto desde
   * un subagente es algo que se pide explícitamente, no lo que pasa por defecto.
   */
  const invokeSubagentTool = {
    name: 'invoke_subagent',
    description:
      'Lanza uno o varios subagentes en paralelo. Cada uno tiene su propio contexto y ' +
      'devuelve solo un resumen, así que sirve para investigar o verificar varias cosas ' +
      'a la vez sin llenar tu contexto. Por defecto solo pueden leer. ' +
      'IMPORTANTE: el subagente no comparte tu contexto. En `prompt` dale la RUTA COMPLETA ' +
      'de cada fichero relativa al directorio de trabajo (por ejemplo ' +
      '`prueba-nucleo/src/carrito.mjs`, no `src/carrito.mjs`) y dile exactamente qué debe ' +
      'devolverte. Si la ruta es ambigua, el subagente fallará y gastará pasos buscándola.',
    parameters: {
      type: 'object',
      properties: {
        subagents: {
          type: 'array',
          description: 'Los subagentes a lanzar. Se ejecutan a la vez.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Nombre corto, para identificar su resultado.',
              },
              role: {
                type: 'string',
                description:
                  'Su papel en 2-5 palabras, como un puesto de trabajo. ' +
                  'Ejemplos: "Codebase Researcher", "Database Debugger".',
              },
              prompt: {
                type: 'string',
                description:
                  'La tarea concreta. Sé específico sobre qué debe averiguar y qué debe devolver.',
              },
              allowWrites: {
                type: 'boolean',
                description:
                  'true para darle también escritura y ejecución. Úsalo solo si de verdad ' +
                  'necesitas que un subagente modifique algo.',
              },
              workspace: {
                type: 'string',
                enum: ['inherit', 'share'],
                description:
                  'inherit (por defecto): trabaja en tu mismo directorio. share: trabaja en un ' +
                  'git worktree aislado, con su propia rama, y sus cambios no tocan tu rama. ' +
                  'Úsalo cuando varios subagentes con escritura puedan pisarse. Si el proyecto ' +
                  'no es un repo git, se queda en inherit.',
              },
            },
            required: ['name', 'prompt'],
          },
        },
      },
      required: ['subagents'],
    },
    async execute(args) {
      const pedidos = Array.isArray(args?.subagents) ? args.subagents.slice(0, 5) : [];
      if (pedidos.length === 0) {
        return { content: 'No hay subagentes que lanzar.', isError: true };
      }

      // Herramientas de solo lectura, envueltas con el guard de permisos.
      const deLectura = baseTools.filter((tool) => HERRAMIENTAS_DE_LECTURA.has(tool.name));
      const deEscritura = baseTools.filter((tool) => !HERRAMIENTAS_DE_LECTURA.has(tool.name));

      const lanzar = async (sub, indice) => {
        // Si viene `definition`, se resuelve contra las guardadas con define_subagent.
        let definicion = null;
        const referencia = sub?.definition ?? sub?.name;
        if (typeof referencia === 'string' && sub?.prompt === undefined) {
          definicion = await subagentes.buscar(referencia);
          if (!definicion) {
            return {
              nombre: String(referencia),
              rol: '',
              resumen: '',
              error: `no existe la definición de subagente "${referencia}"`,
            };
          }
        } else if (typeof sub?.definition === 'string') {
          definicion = await subagentes.buscar(sub.definition);
        }

        const nombre = String(definicion?.name ?? sub?.name ?? `subagente-${indice + 1}`);
        const rol = String(definicion?.role ?? sub?.role ?? 'investigador');
        const tarea = String(sub?.prompt ?? definicion?.description ?? '').trim();
        const permiteEscritura = sub?.allowWrites === true || definicion?.allowWrites === true;

        if (tarea.length === 0) {
          return { nombre, rol, resumen: '', error: 'sin tarea' };
        }

        const permiteMcp = sub?.allowMcp === true || definicion?.allowMcp === true;

        let disponibles = permiteEscritura ? [...deLectura, ...deEscritura] : deLectura;
        if (permiteMcp) disponibles = [...disponibles, ...mcpToolDefs];
        const herramientas = new ToolRegistry().registerAll(
          disponibles.map((tool) =>
            // En un subagente el monitor bloquea sin preguntar: no debe abrir diálogos.
            conMonitorDeSeguridad(guardTool(tool, preset, prefs, () => mainWindow), {
              modo: modoMonitor === 'off' ? 'off' : 'block',
              confirmar: async () => false,
            }),
          ),
        );

        /*
         * Aislamiento de workspace.
         *
         * Un subagente con escritura que comparte directorio se pisa con sus
         * hermanos y con el padre. Con `share` trabaja sobre un git worktree con
         * su propia rama, y lo que escriba no toca la rama de trabajo.
         */
        let worktree = null;
        let cwdSubagente = state.cwd;
        if (sub?.workspace === 'share' || definicion?.workspace === 'share') {
          const creado = await worktreeMod.crear(state.cwd, `${nombre}`);
          if (creado.ok) {
            worktree = creado;
            cwdSubagente = creado.ruta;
          } else {
            // Sin worktree el subagente sigue, pero en el directorio común.
            send({
              type: 'notice',
              level: 'warn',
              text: `«${nombre}» no pudo aislarse (${creado.motivo}); trabajará en el directorio común.`,
            });
          }
        }

        const controlador = new AbortController();
        const identificador = subagentes.registrar({ nombre, rol, controller: controlador });
        const emitir = (payload) => {
          if (payload.type === 'text' || payload.type === 'reasoning') return;
          send({
            ...payload,
            subagent: identificador,
            subagentLabel: nombre,
            ...(enTurnoDelPlanner ? { planner: true } : {}),
          });
        };

        try {
          const resultado = await runAgent(
            {
              provider,
              model: state.model,
              tools: herramientas,
              system:
                (definicion?.systemPrompt && definicion.systemPrompt.length > 0
                  ? definicion.systemPrompt
                  : `Eres un subagente con el papel de ${rol}. Trabajas para otro agente, no ` +
                    'para el usuario. Completa la tarea con las herramientas que tienes y ' +
                    'responde con un resumen conciso de lo que encontraste: hechos, rutas y ' +
                    'datos concretos. No incluyas la transcripción de cada paso.') +
                (permiteEscritura
                  ? ''
                  : ' No puedes modificar ficheros ni ejecutar comandos: si algo requiere ' +
                    'cambiarlo, dilo en el resumen y no lo intentes.') +
                (permiteMcp || mcpToolDefs.length === 0
                  ? ''
                  : ' Tampoco tienes acceso a las herramientas de los servidores MCP.'),
              maxSteps: Number(prefs.subagentMaxSteps ?? 10),
              /*
               * Un subagente que agota los pasos sin concluir deja al padre sin
               * respuesta. Medido: uno de dos no devolvió resumen y el principal
               * tuvo que leer el fichero él mismo, perdiendo el paralelismo.
               */
              mensajeFinalObligatorio:
                'Te quedan pocos pasos. Responde AHORA con lo que hayas averiguado, ' +
                'aunque sea parcial: qué encontraste, qué rutas y qué no pudiste ver.',
              maxContextChars: contextBudget(state.model),
              onEvent: emitir,
              // Recoge lo que le manden con send_message entre pasos.
              mensajeDeSistema: () => subagentes.recogerMensajes(identificador),
            },
            tarea,
            { cwd: cwdSubagente, signal: controlador.signal },
          );

          subagentes.marcarTerminado(identificador, 'terminado');

          let notaWorktree = '';
          if (worktree) {
            const cierre = await worktreeMod.cerrar(state.cwd, worktree);
            if (cierre.conservado) notaWorktree = `\n\n${cierre.nota}`;
          }

          return {
            nombre,
            rol,
            resumen: `${(resultado.text ?? '').trim()}${notaWorktree}`,
            error: null,
          };
        } catch (error) {
          subagentes.marcarTerminado(identificador, 'error');
          if (worktree) await worktreeMod.cerrar(state.cwd, worktree).catch(() => {});
          return {
            nombre,
            rol,
            resumen: '',
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          // Se deja un rato en el registro para que manage_subagent lo vea, y se libera.
          setTimeout(() => subagentes.liberar(identificador), 60_000).unref?.();
        }
      };

      const resultados = await Promise.all(pedidos.map(lanzar));

      const partes = resultados.map((r) =>
        r.error
          ? `## ${r.nombre} (${r.rol}) — FALLÓ\n${r.error}`
          : `## ${r.nombre} (${r.rol})\n${r.resumen.length > 0 ? r.resumen : '(sin resumen)'}`,
      );

      const fallos = resultados.filter((r) => r.error).length;
      return {
        content:
          `${resultados.length} subagente(s) en paralelo` +
          (fallos > 0 ? `, ${fallos} con error` : '') +
          `:\n\n${partes.join('\n\n')}`,
        isError: fallos === resultados.length,
      };
    },
  };

  // -------------------------------------------------------------------------
  // Plan mode como ciclo planner ↔ executor
  // -------------------------------------------------------------------------

  const ciclo = new CicloDePlan({
    cada: Number(prefs.planReviewInterval ?? 8),
    maxRevisiones: Number(prefs.maxPlanReviews ?? 6),
    // Con 'Always Review' el turno empieza planificando: sin plan no se escribe.
    empezarPlanificando: (prefs.planReviewPolicy ?? 'Always Ask') === 'Always Review',
  });

  /** Lo que devuelve el turno del planner, si llega a entregar. */
  let entregaDelPlanner = null;

  /** true mientras corre el turno del planner, para etiquetar sus eventos. */
  let enTurnoDelPlanner = false;

  /** Herramienta del planner: entregar el plan y devolver el control. */
  const exitPlanTool = {
    name: 'exit_plan_mode',
    description:
      'Entrega el plan al ejecutor y le devuelve el control. Úsala cuando ya hayas ' +
      'revisado la ejecución: con los pasos que quedan, con un plan revisado, o parando.',
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          enum: ['continuar', 'revisar', 'parar'],
          description:
            'continuar: la ejecución va bien, entrega los pasos que quedan. ' +
            'revisar: se ha desviado, entrega un plan nuevo. parar: está terminada o el usuario pidió parar.',
        },
        summary: {
          type: 'string',
          description: 'Qué le dices al ejecutor en una o dos frases.',
        },
        steps: {
          type: 'array',
          description: 'Pasos que quedan por hacer (para continuar o revisar).',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Qué se hará.' },
              detail: { type: 'string', description: 'Detalle opcional.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['decision', 'summary'],
    },
    async execute(args) {
      entregaDelPlanner = {
        decision: String(args?.decision ?? 'continuar'),
        summary: String(args?.summary ?? ''),
        steps: Array.isArray(args?.steps)
          ? args.steps.slice(0, 40).map((paso) => ({
              title: String(paso?.title ?? ''),
              detail: paso?.detail ? String(paso.detail) : '',
            }))
          : [],
      };
      return { content: 'Entregado al ejecutor.' };
    },
  };

  /** Herramienta del ejecutor: devolver el control al planificador. */
  const enterPlanTool = {
    name: 'enter_plan_mode',
    description:
      'Devuelve el control al planificador con un informe de estado. Obligatoria cuando ' +
      'hay una revisión pendiente: hasta que la llames, ninguna otra herramienta funciona.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Informe de estado: qué pasos están hechos, qué verificaciones se ejecutaron y ' +
            'qué mostraron, los fallos repetidos, el trabajo fuera del plan, y qué queda.',
        },
      },
      required: ['reason'],
    },
    async execute(args) {
      const informe = String(args?.reason ?? '').slice(0, 4000);
      const handback = ciclo.devolverControl(informe);

      send({ type: 'plan_handoff', fase: 'revisando' });

      // Turno real del planner: otro system prompt y solo herramientas de lectura.
      entregaDelPlanner = null;
      const herramientasDelPlanner = new ToolRegistry().registerAll(
        [
          exitPlanTool,
          // El planner puede mandar verificaciones en paralelo sin ejecutar él nada.
          invokeSubagentTool,
          ...baseTools.filter((t) => HERRAMIENTAS_DE_LECTURA.has(t.name)),
        ].map((tool) => guardTool(tool, preset, prefs, () => mainWindow)),
      );

      enTurnoDelPlanner = true;
      try {
        await runAgent(
          {
            provider,
            model: state.model,
            tools: herramientasDelPlanner,
            system: SYSTEM_PROMPT + PROMPT_PLANNER + handback,
            maxSteps: 6,
            maxContextChars: contextBudget(state.model),
            onEvent: (payload) => {
              // Todo el turno del planner se marca para que la UI lo agrupe.
              if (payload.type === 'usage' || payload.type === 'done') return;
              if (payload.type === 'tool_start' || payload.type === 'tool_end') {
                send({ ...payload, planner: true });
                return;
              }
              send({ ...payload, planner: true });
            },
          },
          'Revisa la ejecución y entrega con exit_plan_mode.',
          { cwd: state.cwd, signal: controller.signal },
        );
      } catch (error) {
        return {
          content:
            'El planificador falló: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. Continúa con el plan actual y avisa al usuario.',
          isError: true,
        };
      } finally {
        enTurnoDelPlanner = false;
      }

      const entrega = entregaDelPlanner;
      send({ type: 'plan_handoff', fase: 'entregado', decision: entrega?.decision ?? null });

      if (!entrega) {
        return {
          content:
            'El planificador no entregó nada. Continúa con el plan actual y avisa al usuario.',
          isError: true,
        };
      }

      if (entrega.decision === 'parar') {
        return {
          content:
            `El planificador decidió PARAR: ${entrega.summary}\n\n` +
            'No sigas ejecutando. Informa al usuario de que la tarea está terminada o detenida.',
          isError: false,
        };
      }

      const pasos = entrega.steps.length > 0 ? entrega.steps : (ciclo.plan?.steps ?? []);
      ciclo.entregarPlan({ steps: pasos });

      const listado = pasos
        .map((paso, i) => `${i + 1}. ${paso.title}${paso.detail ? ` — ${paso.detail}` : ''}`)
        .join('\n');

      return {
        content:
          `El planificador respondió (${entrega.decision}): ${entrega.summary}\n\n` +
          `Plan vigente:\n${listado}\n\nContinúa desde ahí.`,
        isError: false,
      };
    },
  };

  const guardedTools = [planTool, askUserTool, enterPlanTool, invokeSubagentTool, defineSubagentTool, manageSubagentTool, notifyUserTool, runTestsTool, browserSubagent, ...baseTools].map((tool) =>
    conHooks(conMonitorDeSeguridad(guardTool(tool, preset, prefs, () => mainWindow), {
      modo: modoMonitor,
      ...(clasificarConModelo ? { clasificar: clasificarConModelo } : {}),
      alClasificar: (info) => {
        if (info.fase === 'inicio') {
          send({ type: 'guardian_check', herramienta: info.herramienta });
        } else if (info.clasificacion) {
          send({
            type: 'guardian_result',
            herramienta: info.herramienta,
            severidad: info.clasificacion.severity,
            motivo: info.clasificacion.reason,
            nivel: info.clasificacion.nivel,
            cacheado: info.clasificacion.cacheado,
          });
        } else {
          send({ type: 'guardian_result', herramienta: info.herramienta, fallo: true });
        }
      },
      confirmar: async (info) => {
        const ventana = mainWindow;
        if (!ventana) return false;

        const detalle =
          `Severidad ${info.severidad}/10\n\n` +
          `Señales detectadas:\n${info.senales.map((s) => `· ${s}`).join('\n') || '· (ninguna)'}\n\n` +
          `Argumentos:\n${JSON.stringify(info.args, null, 2).slice(0, 600)}`;

        const respuesta = await dialog.showMessageBox(ventana, {
          type: 'warning',
          buttons: ['Cancelar', 'Permitir igualmente'],
          defaultId: 0,
          cancelId: 0,
          title: 'Monitor de seguridad',
          message: `El monitor de seguridad ha marcado «${info.herramienta}»`,
          detail: detalle,
        });

        return respuesta.response === 1;
      },
    }), {
      getCwd: () => state.cwd,
      getReglas: () => prefs.hookRules ?? [],
      getLimite: () => Number(prefs.toolOutputLimit ?? 16000),
    }),
  );

  const tools = new ToolRegistry().registerAll(guardedTools);

  // `send` se define antes que nada que lo use: el bucle de plugins y las
  // herramientas de MCP ya lo necesitan al construirse.
  const send = (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:event', payload);
    }
  };

  // Plugins: servidores MCP definidos por el usuario y activados.
  const pluginClients = [];
  /** Clientes MCP por nombre, para las herramientas de recursos y prompts. */
  const mcpClients = new Map();

  for (const plugin of (prefs.plugins ?? []).filter((entry) => entry.enabled !== false)) {
    try {
      const { StdioMcpClient } = await import('../dist/mcp/stdio-client.js');
      const { toolsFromMcpServer } = await import('../dist/tools/mcp-adapter.js');

      const client = await StdioMcpClient.start({
        command: plugin.command,
        args: Array.isArray(plugin.args) ? plugin.args : [],
        onStderr: (chunk) => console.error(`[plugin ${plugin.name}] ${chunk}`),
      });
      pluginClients.push(client);
      mcpClients.set(String(plugin.name ?? plugin.id), client);

      const pluginTools = await toolsFromMcpServer(client);
      mcpToolDefs.push(...pluginTools);
      for (const tool of pluginTools) {
        const name = tools.has(tool.name) ? `${plugin.id}_${tool.name}` : tool.name;
        tools.register(guardTool({ ...tool, name }, preset, prefs, () => mainWindow));
      }

      send({ type: 'tool_start', call: { id: `plugin-${plugin.id}`, name: `plugin:${plugin.name}`, arguments: { tools: pluginTools.length } } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send({ type: 'error', message: `Plugin ${plugin.name}: ${message}` });
    }
  }
  // Recursos y prompts de MCP: herramientas genéricas que reciben el servidor.
  if (mcpClients.size > 0) {
    const resolver = (nombre) => {
      const buscado = String(nombre ?? '').trim();
      if (buscado.length === 0) return mcpClients.size === 1 ? [...mcpClients.values()][0] : null;
      for (const [clave, cliente] of mcpClients) {
        if (clave.toLowerCase() === buscado.toLowerCase()) return cliente;
      }
      return null;
    };

    const nombres = () => [...mcpClients.keys()].join(', ');

    tools.register(
      guardTool(
        {
          name: 'list_resources',
          description:
            'Lista los recursos que exponen los servidores MCP conectados. ' +
            'Si hay varios servidores, indica cuál te interesa.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP. Opcional.' },
            },
          },
          async execute(args) {
            const buscado = String(args?.server ?? '').trim();
            const objetivos = buscado.length > 0
              ? [[buscado, resolver(buscado)]]
              : [...mcpClients.entries()];

            const partes = [];
            for (const [nombre, cliente] of objetivos) {
              if (!cliente) {
                return { content: `No existe el servidor MCP "${nombre}". Hay: ${nombres()}`, isError: true };
              }
              try {
                const recursos = await cliente.listResources();
                partes.push(
                  recursos.length === 0
                    ? `## ${nombre}\n(sin recursos)`
                    : `## ${nombre}\n` +
                        recursos
                          .map((r) => `- ${r.uri} · ${r.name}${r.description ? ` — ${r.description}` : ''}`)
                          .join('\n'),
                );
              } catch (error) {
                partes.push(`## ${nombre}\nError: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
            return { content: partes.join('\n\n') };
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ),
    );

    tools.register(
      guardTool(
        {
          name: 'read_resource',
          description:
            'Lee un recurso concreto de un servidor MCP: un fichero, una tabla o cualquier ' +
            'dato que el servidor exponga por URI. Primero lista con `list_resources` para ' +
            'saber qué hay y con qué URI.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP.' },
              uri: { type: 'string', description: 'URI del recurso, tal como la lista list_resources.' },
            },
            required: ['server', 'uri'],
          },
          async execute(args) {
            const cliente = resolver(args?.server);
            if (!cliente) {
              return { content: `No existe el servidor MCP "${args?.server}". Hay: ${nombres()}`, isError: true };
            }
            try {
              const leido = await cliente.readResource(String(args?.uri ?? ''));
              return {
                content:
                  `Recurso ${args.uri}` +
                  (leido.mimeType ? ` (${leido.mimeType})` : '') +
                  `:\n\n${leido.text}`,
              };
            } catch (error) {
              return {
                content: `No se pudo leer: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
              };
            }
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ),
    );

    tools.register(
      guardTool(
        {
          name: 'list_prompts',
          description: 'Lista las plantillas de prompt que exponen los servidores MCP.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP. Opcional.' },
            },
          },
          async execute(args) {
            const buscado = String(args?.server ?? '').trim();
            const objetivos = buscado.length > 0 ? [[buscado, resolver(buscado)]] : [...mcpClients.entries()];

            const partes = [];
            for (const [nombre, cliente] of objetivos) {
              if (!cliente) {
                return { content: `No existe el servidor MCP "${nombre}". Hay: ${nombres()}`, isError: true };
              }
              try {
                const prompts = await cliente.listPrompts();
                partes.push(
                  prompts.length === 0
                    ? `## ${nombre}\n(sin prompts)`
                    : `## ${nombre}\n` +
                        prompts
                          .map((p) => {
                            const argsTexto = (p.arguments ?? [])
                              .map((a) => `${a.name}${a.required ? '*' : ''}`)
                              .join(', ');
                            return `- ${p.name}${argsTexto ? ` (${argsTexto})` : ''}${p.description ? ` — ${p.description}` : ''}`;
                          })
                          .join('\n'),
                );
              } catch (error) {
                partes.push(`## ${nombre}\nError: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
            return { content: partes.join('\n\n') };
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ),
    );

    tools.register(
      guardTool(
        {
          name: 'use_prompt',
          description: 'Obtiene una plantilla de prompt de un servidor MCP, ya rellenada con sus argumentos.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP.' },
              name: { type: 'string', description: 'Nombre del prompt, tal como lo lista list_prompts.' },
              arguments: {
                type: 'object',
                description: 'Valores de los argumentos del prompt. Todos como texto.',
              },
            },
            required: ['server', 'name'],
          },
          async execute(args) {
            const cliente = resolver(args?.server);
            if (!cliente) {
              return { content: `No existe el servidor MCP "${args?.server}". Hay: ${nombres()}`, isError: true };
            }
            const valores = {};
            for (const [clave, valor] of Object.entries(args?.arguments ?? {})) {
              valores[clave] = String(valor);
            }
            try {
              const prompt = await cliente.getPrompt(String(args?.name ?? ''), valores);
              return { content: prompt.text };
            } catch (error) {
              return {
                content: `No se pudo obtener: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
              };
            }
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ),
    );
  }


  const controller = new AbortController();
  currentAbort = controller;

  // Memoria entre conversaciones: solo se inyecta al empezar un hilo, no en cada
  // turno, para no reenviar los mismos recuerdos una y otra vez.
  let bloqueMemorias = '';
  if (state.messages.length === 0 && state.prefs.memoryEnabled !== false) {
    try {
      const recuerdos = await getMemoria().relevant(
        state.cwd,
        Number(state.prefs.memoriesToConsider ?? 6),
      );
      bloqueMemorias = bloqueDeMemorias(recuerdos);
      if (recuerdos.length > 0) {
        await getMemoria().marcarUsadas(recuerdos.map((m) => m.id));
      }
    } catch {
      bloqueMemorias = '';
    }
  }

  const initialCount = state.messages.length;
  currentTurnKey = initialCount;
  indiceDePaso = 0;
  cambiosDelTurno = [];

  // Acumuladores para los hooks de texto.
  let textoDelTurno = '';
  let razonamientoDelTurno = '';

  // Skills del workspace: solo el catálogo entra en contexto, el cuerpo se carga
  // bajo demanda con la herramienta `skill`.
  let skillsDelProyecto = [];
  try {
    skillsDelProyecto = await descubrirSkills(state.cwd);
  } catch {
    skillsDelProyecto = [];
  }
  if (!turnCheckpoints.has(initialCount)) turnCheckpoints.set(initialCount, new Map());

  state.busy = true;
  send({ type: 'busy', busy: true });

  try {
    const result = await runAgent(
      {
        provider,
        model: state.model,
        tools,
        system:
          SYSTEM_PROMPT +
          planReviewInstruction(state.prefs.planReviewPolicy ?? 'Always Ask') +
          bloqueDeSkills(skillsDelProyecto) +
          effortInstruction(effort) +
          buildPromptExtras(state.prefs) +
          bloqueMemorias,
        maxSteps: Number(state.prefs.maxSteps ?? 40),
        maxContextChars: contextBudget(state.model),
        maxToolChars: 16_000,
        toolTimeoutMs: Number(state.prefs.toolTimeoutMs ?? 120_000),
        // Plan mode: la compuerta rechaza herramientas según la fase del ciclo.
        toolGate: (call) => {
          const rechazo = ciclo.compuerta(call);
          if (!rechazo) ciclo.contarInvocacion();
          return rechazo;
        },
        mensajeDeSistema: () => {
          // Una tarea terminada mientras el turno seguía abierto entra aquí.
          if (notaDeTareaPendiente) {
            const nota = notaDeTareaPendiente;
            notaDeTareaPendiente = null;
            return nota;
          }
          return ciclo.mensajePendiente();
        },
        ...(images.length > 0 ? { images } : {}),
        ...(state.messages.length > 0 ? { initialMessages: state.messages } : {}),
        onEvent: (payload) => {
          /*
           * Hooks sobre el texto del modelo. Los deltas se muestran tal cual para no
           * romper el streaming; al terminar se aplican las reglas y, si algo cambió,
           * se manda el texto definitivo para que la UI lo repinte.
           */
          if (payload.type === 'text') {
            textoDelTurno += payload.text;
          } else if (payload.type === 'reasoning') {
            razonamientoDelTurno += payload.text;
            const recorte = aplicarHooksDeRazonamiento(razonamientoDelTurno, {
              limite: Number(prefs.reasoningLimit ?? 20000),
            });
            if (recorte.recortado) {
              razonamientoDelTurno = recorte.texto;
              send({ type: 'reasoning_replace', text: recorte.texto });
              return;
            }
          } else if (payload.type === 'done') {
            const aplicado = aplicarHooksDeTexto(textoDelTurno, {
              reglas: prefs.textHooks ?? [],
              quitarRelleno: prefs.stripBoilerplate === true,
            });
            if (aplicado.notas.length > 0 && aplicado.texto !== textoDelTurno) {
              send({ type: 'text_replace', text: aplicado.texto });
            }
          }

          // El monitor de ritmo se muestra como nota del sistema, no como mensaje.
          if (payload.type === 'nudge') {
            send({ type: 'system_note', text: payload.text });
            return;
          }

          // Trayectoria: cada llamada a herramienta es un paso con sus snapshots.
          if (payload.type === 'tool_start') {
            indiceDePaso += 1;
            trayectoria.abrirPaso(claveDeTrayectoria(), {
              indice: indiceDePaso,
              herramienta: payload.call?.name ?? '',
              argumentos: payload.call?.arguments ?? {},
              mensaje: null,
            });
            // La fila de la UI necesita saber a qué paso corresponde para el revert.
            send({ ...payload, stepIndex: indiceDePaso });
            return;
          } else if (payload.type === 'tool_end') {
            trayectoria.cerrarPaso(claveDeTrayectoria(), {
              contenido: payload.content,
              esError: payload.isError,
            });
          }

          send(payload);
        },
      },
      input,
      { cwd: state.cwd, signal: controller.signal },
    );

    state.messages = result.messages;

    // `saveHistory` desactivado = la conversación vive solo en memoria.
    if (state.sessionId && state.prefs.saveHistory !== false) {
      try {
        const sessions = await getStore();
        await sessions.append(state.sessionId, result.messages.slice(initialCount));
      } catch {
        // guardar es best-effort: no rompe la conversación
      }
    }

    send({
      type: 'final',
      reason: result.reason,
      steps: result.steps,
      maxSteps: Number(state.prefs.maxSteps ?? 40),
      keepCount: initialCount,
      sessionId: state.sessionId,
    });

    if (state.prefs.notifications === true) {
      try {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          new Notification({
            title: 'Opengravity',
            body: result.reason === 'error' ? 'El agente terminó con errores.' : 'El agente ha terminado.',
          }).show();
        }
      } catch {
        // las notificaciones son best-effort
      }
    }
    return { ok: true, sessionId: state.sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'error', message });
    return { ok: false, error: message };
  } finally {
    currentAbort = null;
    currentTurnKey = null;
    state.busy = false;
    send({ type: 'busy', busy: false });
    await Promise.all(pluginClients.map((client) => client.close().catch(() => {})));
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Precarga el motor para que el primer turno no pague el coste de import().
  try {
    await getEngine();
  } catch (error) {
    console.error('No se pudo cargar el motor:', error);
  }

  await loadSettings();

  // Tareas programadas: revisa cada minuto.
  startScheduler();

  // Retención de historial: al arrancar y cada 6 horas.
  applyRetention().catch(() => {});
  setInterval(() => applyRetention().catch(() => {}), 6 * 60 * 60 * 1000).unref?.();

  // Cache de embeddings del índice.
  try {
    await codeIndex.loadEmbeddings(embeddingsPath());
  } catch {
    // sin cache previa
  }

  // Sirve el renderer bajo app:// para habilitar workers.
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.join(app.getAppPath(), relative);
    return net.fetch(pathToFileURL(filePath).href);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Los snapshots de trayectoria se vuelcan aquí para no perder el último turno.
  trayectoria.volcarTodo().catch(() => {});
  void stopRemote();
  cerrarTodasLasPty();
  for (const [, client] of lspClients) {
    try {
      client.stop();
    } catch {
      // ya cerrado
    }
  }
  lspClients.clear();
});
