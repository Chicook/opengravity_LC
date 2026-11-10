'use strict';

/**
 * Lógica del renderer.
 *
 * Sin frameworks y sin build: DOM directo. Toda la comunicación con el motor
 * pasa por `window.api` (ver electron/preload.cjs).
 */

const $ = (id) => document.getElementById(id);

const els = {
  projectName: $('project-name'),
  projectPill: $('project-pill-label'),
  conversationList: $('conversation-list'),
  thread: $('thread'),
  threadInner: $('thread-inner'),
  threadEmpty: $('thread-empty'),
  input: $('composer-input'),
  form: $('composer-form'),
  send: $('btn-send'),
  modelLabel: $('model-label'),
  effortLabel: $('effort-label'),
  btnNew: $('btn-new-conversation'),
  btnNew2: $('btn-new-conversation-2'),
  btnNewLogo: $('btn-new-conversation-3'),
  btnNewSection: $('btn-new-conversation-4'),
  btnToggleSidebar: $('btn-toggle-sidebar'),
  btnGoBack: $('btn-go-back'),
  btnGoForward: $('btn-go-forward'),
  btnDisplayOptions: $('btn-display-options'),
  btnOpenWorkspace: $('btn-open-workspace'),
  btnSettings: $('btn-settings'),
  btnModel: $('btn-model-selector'),
  btnSearch: $('btn-search'),
  btnProjectSelector: $('btn-project-selector'),

  modelPopover: $('model-popover'),
  modelPopoverBody: $('model-popover-body'),
  commandPopover: $('command-popover'),
  commandPopoverBody: $('command-popover-body'),
  mentionPopover: $('mention-popover'),
  mentionPopoverBody: $('mention-popover-body'),

  auxPanel: $('aux-panel'),
  terminalXterm: $('terminal-xterm'),
  terminalLegacy: $('terminal-legacy'),
  terminalOutput: $('terminal-output'),
  terminalInput: $('terminal-input'),
  terminalCwd: $('terminal-cwd'),

  editorPane: $('editor-pane'),
  overviewPanel: $('overview-panel'),
  editorTabs: $('editor-tabs'),
  editorPath: $('editor-path'),
  editorState: $('editor-state'),
  editorLsp: $('editor-lsp'),

  menubar: $('menubar'),
  sidebar: document.querySelector('.sidebar'),
  divider: document.querySelector('.divider'),
  btnToggleTop: $('btn-toggle-sidebar-top'),
  sidebarSearch: $('sidebar-search'),
  searchInput: $('search-input'),
  contextMenu: $('context-menu'),

  settingsModal: $('settings-modal'),
};

/** Estado local de la UI. */
const ui = {
  busy: false,
  // Despertares de tareas que llegaron con el turno ocupado.
  despertaresPendientes: [],
  activeConversation: null,
  streamingEl: null,
  /** Catálogo de proveedores con disponibilidad y modelos. */
  providers: [],
  providerId: null,
  model: null,
  cwd: null,
  /** Sesiones cargadas, para filtrar sin volver a consultar. */
  sessions: [],
  /** Texto del buscador de conversaciones. */
  query: '',
  /** Barra lateral colapsada. */
  sidebarCollapsed: false,
  effort: 'Medium',
  overviewView: null,
  dictation: null,
  pendingImages: [],
  reasoningEl: null,
  reasoningText: '',
  reasoningStartedAt: 0,
  subagentGroups: new Map(),
  referencesRegistered: false,
  tabs: [],
  activeTab: null,
  editors: [null, null],
  activeGroup: 0,
  split: false,
  /** Preferencias activas (contraste, sonido, cola…). */
  prefs: {},
  /** Mensajes pendientes cuando el agente está ocupado. */
  queue: [],
  /** Catálogo de herramientas con su permiso. */
  tools: [],
  /** Catálogo de skills. */
  skills: [],
  /** Estado del servidor de control remoto. */
  remote: { running: false, url: null },
  /** Texto acumulado del mensaje en curso, para re-renderizar el markdown. */
  streamingText: '',
  /** Grupo colapsable "Worked for" de la ejecución en curso. */
  toolGroup: null,
  /** Resumen del turno que envuelve pensamiento y herramientas. */
  workWrapper: null,
  /** Archivos que el agente ha tocado en esta conversación. */
  touchedFiles: new Map(),
  /** Panel de overview visible. */
  overviewOpen: false,
  /** Elemento del indicador de carga en curso. */
  loadingEl: null,
  /** Temporizador del indicador. */
  loadingTimer: null,
  /** Índice seleccionado en la paleta de comandos. */
  commandIndex: 0,
  /** Comandos que coinciden con lo escrito. */
  commandMatches: [],
  /** Índice de ficheros del workspace. */
  fileIndex: [],
  /** Menciones que coinciden con lo escrito. */
  mentionMatches: [],
  /** Índice seleccionado en la paleta de menciones. */
  mentionIndex: 0,
  /** Fichero abierto en el editor. */
  editorPath: null,
  /** Contenido original, para detectar cambios sin guardar. */
  editorOriginal: '',
  /** Diagnósticos LSP del fichero abierto. */
  diagnostics: [],
  /** Entradas de autocompletado visibles. */
  completions: [],
  /** Índice seleccionado en el autocompletado. */
  completionIndex: 0,
  /** Temporizador del aviso de cambios al LSP. */
  lspChangeTimer: null,
};

/**
 * Comandos del composer, invocados escribiendo `/`.
 * Es lo que promete el placeholder «/ for actions».
 */
const COMMANDS = [
  { id: 'plan', label: '/plan', hint: 'Pedir un plan numerado antes de cambiar código' },
  { id: 'model', label: '/model', hint: 'Cambiar de modelo' },
  { id: 'clear', label: '/clear', hint: 'Empezar una conversación nueva' },
  { id: 'settings', label: '/settings', hint: 'Abrir los ajustes' },
  { id: 'browser', label: '/browser <url>', hint: 'Abrir una URL en el navegador integrado' },
  { id: 'stop', label: '/stop', hint: 'Detener la ejecución en curso' },
  { id: 'help', label: '/help', hint: 'Ver todos los comandos' },
];

/**
 * Etiquetas legibles de las herramientas.
 * Antigravity no muestra el nombre técnico: muestra qué hizo.
 */
/*
 * Etiquetas de herramienta en lenguaje natural, como las suyas: describen la
 * intención («list files in current directory»), no la función.
 * Medido en su DOM: el nivel de cada llamada es una fila de 32 px, radio 8,
 * 4px 8px, 14/20, en `--muted-foreground`, con sangrado de 12 px por nivel.
 */
const TOOL_LABELS = {
  read_file: 'read file',
  list_directory: 'list directory contents',
  write_file: 'write file',
  edit_file: 'edit file',
  multi_replace: 'edit several parts of file',
  run_command: 'run command',
  run_tests: 'run tests',
  command_status: 'check command status',
  search_files: 'search in files',
  search_code: 'search code',
  search_web: 'search the web',
  fetch_url: 'fetch URL',
  open_url: 'open URL',
  view_code_item: 'read a symbol',
  list_resources: 'list MCP resources',
  read_resource: 'read MCP resource',
  list_prompts: 'list MCP prompts',
  use_prompt: 'use MCP prompt',
  define_subagent: 'define a subagent',
  invoke_subagent: 'launch subagents',
  manage_subagent: 'manage subagents',
  send_message: 'message a subagent',
  manage_task: 'manage background tasks',
  ask_user_question: 'ask the user',
  notify_user: 'schedule a notice',
  present_plan: 'present a plan',
  run_workflow: 'run a workflow',
  browser_open: 'open the browser',
  browser_read: 'read the page',
  browser_click: 'click on the page',
  browser_eval: 'run JS on the page',
};

/**
 * Texto de la llamada, como el suyo: «Ran <acción en palabras>».
 *
 * Medido en su DOM: cada fila de llamada dice «Ran list files in current
 * directory» o «Ran count files including hidden» — una frase que describe la
 * intención, no el nombre de la herramienta.
 */
function friendlyTool(name, args) {
  const a = args ?? {};
  const base = TOOL_LABELS[name] ?? String(name).replace(/_/g, ' ');

  const detalle =
    a.path ?? a.TargetFile ?? a.file ?? a.query ?? a.Query ?? a.url ?? a.Url ?? a.command ?? a.CommandLine;

  const corto =
    typeof detalle === 'string' && detalle.length > 0 && detalle.length <= 60 ? detalle : null;

  switch (name) {
    case 'list_directory':
      return corto && corto !== '.' ? `Ran list files in ${corto}` : 'Ran list files in current directory';
    case 'read_file':
      return corto ? `Ran read ${corto}` : 'Ran read file';
    case 'run_command':
      // Antigravity separa la etiqueta del comando: «Ran» + la tarjeta con el
      // comando. Meter el comando también en la etiqueta lo duplicaba.
      return 'Ran';
    case 'search_files':
    case 'search_code':
      return corto ? `Ran search for ${corto}` : 'Ran search';
    case 'write_file':
      return corto ? `Ran write ${corto}` : 'Ran write file';
    case 'edit_file':
      return corto ? `Ran edit ${corto}` : 'Ran edit file';
    case 'multi_replace':
      return corto ? `Ran edit several parts of ${corto}` : 'Ran edit several parts of a file';
    case 'run_tests':
      return 'Ran the test suite';
    case 'fetch_url':
    case 'open_url':
      return corto ? `Ran open ${corto}` : 'Ran open URL';
    default:
      return corto ? `Ran ${base}: ${corto}` : `Ran ${base}`;
  }
}

// ---------------------------------------------------------------------------
// Render de conversaciones
// ---------------------------------------------------------------------------

async function refreshConversations() {
  try {
    ui.sessions = await window.api.listSessions();
  } catch {
    ui.sessions = [];
  }

  renderConversations();
  renderPaneTitle();
}

function renderConversations() {
  els.conversationList.replaceChildren();

  const query = ui.query.trim().toLowerCase();

  /*
   * Medido: 5 de 43 conversaciones eran «Nueva conversación» sin usar, y su
   * interfaz no las lista. Se descartan salvo que estén abiertas o que el
   * usuario esté buscando algo.
   */
  const sinUsar = (session) =>
    (session.title ?? '') === 'Nueva conversación' && session.id !== ui.activeConversation;

  const visible = (query
    ? ui.sessions.filter((session) => (session.title ?? '').toLowerCase().includes(query))
    : ui.sessions
  ).filter((session) => !sinUsar(session));

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar__empty';
    empty.textContent = query ? 'Sin resultados' : 'Sin conversaciones';
    els.conversationList.append(empty);
    return;
  }

  /*
   * Medido en su DOM: las conversaciones de un proyecto van anidadas bajo su
   * fila, con `padding-left: 30px` (título en x=38). Las demás van en la lista
   * de «Conversations». Se separan por `cwd`.
   */
  const delProyecto = visible.filter((s) => ui.cwd && s.cwd === ui.cwd);
  const otras = visible.filter((s) => !ui.cwd || s.cwd !== ui.cwd);

  const listaProyecto = document.getElementById('project-conversations');
  if (listaProyecto) listaProyecto.replaceChildren();

  const crearFila = (session, anidada) => {
    const row = document.createElement('div');
    row.className = anidada ? 'conversation conversation--project-child' : 'conversation';
    if (session.id === ui.activeConversation) row.classList.add('is-active');
    row.title = session.title;

    const title = document.createElement('span');
    title.className = 'conversation__title';
    title.textContent = session.title;
    row.append(title);

    // Hora relativa a la derecha, como en su interfaz (12m, 1h, 9d).
    const time = document.createElement('span');
    time.className = 'conversation__time';
    time.textContent = relativeTime(session.updatedAt ?? session.createdAt);
    row.append(time);

    const kebab = document.createElement('button');
    kebab.className = 'conversation__kebab';
    kebab.textContent = '⋯';
    kebab.title = 'Opciones';
    kebab.addEventListener('click', (event) => {
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, [
        {
          label: 'Abrir',
          onClick: () => openConversation(session.id),
        },
        {
          label: 'Borrar conversación',
          danger: true,
          onClick: () => deleteConversation(session.id),
        },
      ]);
    });
    row.append(kebab);

    row.addEventListener('click', () => openConversation(session.id));
    return row;
  };

  // Anidadas bajo el proyecto, y el resto en «Conversations».
  for (const session of delProyecto) {
    const fila = crearFila(session, true);
    (listaProyecto ?? els.conversationList).append(fila);
  }
  for (const session of otras) {
    els.conversationList.append(crearFila(session, false));
  }

  // Si no queda ninguna conversación suelta, el bloque de «Conversations» se oculta.
  const seccion = els.conversationList.closest('.sidebar__section');
  if (seccion) seccion.hidden = otras.length === 0;
}

async function deleteConversation(id) {
  try {
    await window.api.deleteSession(id);
    if (ui.activeConversation === id) newConversation();
    await refreshConversations();
  } catch (error) {
    console.error('No se pudo borrar la conversación:', error);
  }
}

// ---------------------------------------------------------------------------
// Menú contextual
// ---------------------------------------------------------------------------

function openContextMenu(x, y, items) {
  const menu = els.contextMenu;
  menu.replaceChildren();

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'menu__item';
    btn.textContent = item.label;
    if (item.selected) btn.classList.add('is-selected');
    if (item.danger) btn.style.color = 'var(--danger)';
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.onClick();
    });
    menu.append(btn);
  }

  menu.removeAttribute('hidden');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Ajuste si se sale por la derecha o por abajo.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight - 8) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function closeContextMenu() {
  els.contextMenu.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Barra lateral
// ---------------------------------------------------------------------------

function setSidebarCollapsed(collapsed) {
  ui.sidebarCollapsed = collapsed;
  els.sidebar.classList.toggle('is-collapsed', collapsed);
  els.divider.classList.toggle('is-collapsed', collapsed);
  // La rejilla del cuerpo es la que anima el ancho de la columna.
  document.querySelector('.body')?.classList.toggle('is-sidebar-collapsed', collapsed);
  window.api.setPrefs({ sidebarCollapsed: collapsed }).catch(() => {});
}

function toggleSidebar() {
  setSidebarCollapsed(!ui.sidebarCollapsed);
}

function toggleSearch(force) {
  const show = force ?? els.sidebarSearch.hasAttribute('hidden');
  if (show) {
    els.sidebarSearch.removeAttribute('hidden');
    els.searchInput.focus();
    els.searchInput.select();
  } else {
    els.sidebarSearch.setAttribute('hidden', '');
    ui.query = '';
    els.searchInput.value = '';
    renderConversations();
  }
}

// ---------------------------------------------------------------------------
// Menús de la barra de título
// ---------------------------------------------------------------------------

function closeMenus() {
  for (const panel of document.querySelectorAll('.menu__panel')) {
    panel.setAttribute('hidden', '');
  }
  for (const btn of document.querySelectorAll('[data-menu]')) {
    btn.classList.remove('is-open');
  }
}

function toggleMenu(name) {
  const panel = document.querySelector(`[data-panel="${name}"]`);
  const button = document.querySelector(`[data-menu="${name}"]`);
  if (!panel || !button) return;

  const wasOpen = !panel.hasAttribute('hidden');
  closeMenus();
  if (!wasOpen) {
    panel.removeAttribute('hidden');
    button.classList.add('is-open');
  }
}

async function runMenuAction(action) {
  closeMenus();

  switch (action) {
    case 'open-workspace':
      await changeWorkspace();
      break;
    case 'reload':
      window.location.reload();
      break;
    case 'settings':
      window.SettingsUI.open();
      break;
    case 'settings-models':
      window.SettingsUI.open('models');
      break;
    case 'settings-appearance':
      window.SettingsUI.open('appearance');
      break;
    case 'settings-notifications':
      window.SettingsUI.open('notifications');
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'search':
      if (ui.sidebarCollapsed) setSidebarCollapsed(false);
      toggleSearch(true);
      break;
    case 'minimize':
      await window.api.minimize();
      break;
    case 'toggle-maximize':
      await window.api.toggleMaximize();
      break;
    case 'close':
      await window.api.closeWindow();
      break;
    case 'zoom-in':
      await window.api.zoom(0.5);
      break;
    case 'zoom-out':
      await window.api.zoom(-0.5);
      break;
    case 'zoom-reset':
      await window.api.zoom(0);
      break;
    case 'devtools':
      await window.api.toggleDevTools();
      break;
    default:
      console.warn('acción de menú desconocida:', action);
  }
}

async function changeWorkspace() {
  const result = await window.api.openWorkspace();
  if (!result) return;
  ui.cwd = result.cwd;
  els.projectName.textContent = basename(result.cwd);
  if (els.projectPill) els.projectPill.textContent = basename(result.cwd);
  const inline = document.getElementById('project-inline-label');
  if (inline) inline.textContent = basename(result.cwd);
  window.SettingsUI.refresh();
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

function clearThread() {
  els.threadInner.replaceChildren();
  ui.streamingEl = null;
  ui.toolGroup = null;
  ui.workWrapper = null;
  ui.subagentGroups = new Map();
  ui.plannerGroup = null;
  ui.reasoningEl = null;
  ui.reasoningText = '';
  ui.touchedFiles = new Map();
  renderNavigator();
  renderOverview();
  updateEmptyState();
}

function addUserMessage(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg--user';

  // Estructura medida en su DOM: burbuja ancha con texto y barra flotante.
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';

  const inner = document.createElement('div');
  inner.className = 'msg__bubble-inner';
  inner.textContent = text;

  const bar = document.createElement('div');
  bar.className = 'msg__hover-bar';

  const now = new Date();
  const time = document.createElement('span');
  time.className = 'msg__hover-time';
  time.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'msg__hover-btn';
  copyBtn.setAttribute('aria-label', 'Copy');
  copyBtn.innerHTML = window.Icon('copy', 14);
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).catch(() => {});
  });

  const revertBtn = document.createElement('button');
  revertBtn.type = 'button';
  revertBtn.className = 'msg__hover-btn';
  revertBtn.setAttribute('aria-label', 'Undo to this point');
  revertBtn.dataset.testid = 'revert-button';
  revertBtn.innerHTML = window.Icon('undo', 14);
  revertBtn.addEventListener('click', () => {
    const messages = [...els.threadInner.querySelectorAll('.msg')];
    const index = messages.indexOf(wrap);
    if (index >= 0) revertTo(index);
  });

  bar.append(time, copyBtn, revertBtn);
  bubble.append(inner, bar);

  wrap.append(bubble);
  els.threadInner.append(wrap);
  renderNavigator();
  updateEmptyState();
  scrollToBottom();
}

function addAssistantMessage() {
  // Un marcador de imagen de un turno anterior no debe quedarse colgado.
  document.querySelectorAll('[data-image-loading]').forEach((m) => m.remove());

  const wrap = document.createElement('div');
  wrap.className = 'msg msg--assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble msg__bubble--md';
  bubble.textContent = '';

  wrap.append(bubble);
  els.threadInner.append(wrap);
  ui.streamingEl = bubble;
  ui.streamingText = '';
  scrollToBottom();
  return bubble;
}

/**
 * Tarjeta de diff.
 *
 * Muestra el cambio propuesto por el agente. Con `proposalId` pide aprobación;
 * sin él, solo informa de un cambio ya aplicado.
 */
function addDiffCard(payload, proposalId) {
  const card = document.createElement('div');
  card.className = 'diff-card';

  const header = document.createElement('div');
  header.className = 'diff-card__header';

  const title = document.createElement('span');
  title.className = 'diff-card__path';
  title.textContent = payload.path;
  title.title = payload.path;

  const stats = document.createElement('span');
  stats.className = 'diff-card__stats';
  const add = document.createElement('span');
  add.className = 'diff-card__add';
  add.textContent = `+${payload.additions}`;
  const del = document.createElement('span');
  del.className = 'diff-card__del';
  del.textContent = `−${payload.removals}`;
  stats.append(add, del);

  header.append(title, stats);
  if (payload.isNew) {
    const badge = document.createElement('span');
    badge.className = 'diff-card__badge';
    badge.textContent = 'nuevo';
    header.append(badge);
  }

  const body = document.createElement('div');
  body.className = 'diff-card__body';

  for (const row of payload.rows ?? []) {
    const line = document.createElement('div');
    line.className = `diff-line diff-line--${row.type}`;

    const num = document.createElement('span');
    num.className = 'diff-line__num';
    num.textContent = row.type === 'add' ? String(row.newLine ?? '') : String(row.oldLine ?? '');

    const sign = document.createElement('span');
    sign.className = 'diff-line__sign';
    sign.textContent = row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' ';

    const text = document.createElement('span');
    text.className = 'diff-line__text';
    text.textContent = row.text;

    line.append(num, sign, text);
    body.append(line);
  }

  card.append(header, body);

  if (proposalId) {
    const actions = document.createElement('div');
    actions.className = 'diff-card__actions';

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'btn';
    reject.textContent = 'Rechazar';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'btn btn--primary';
    accept.textContent = 'Aplicar';

    const resolve = async (accepted) => {
      accept.disabled = true;
      reject.disabled = true;
      actions.replaceChildren(rowText(accepted ? 'Aplicado' : 'Rechazado'));
      await window.api.respondDiff(proposalId, accepted);
    };

    reject.addEventListener('click', () => resolve(false));
    accept.addEventListener('click', () => resolve(true));

    actions.append(reject, accept);
    card.append(actions);
  } else {
    const note = document.createElement('div');
    note.className = 'diff-card__applied';
    note.textContent = 'Aplicado';
    card.append(note);
  }

  els.threadInner.append(card);
  scrollToBottom();
  return card;
}

/**
 * Barra de acciones bajo una respuesta, como la de Antigravity:
 * marca de tiempo + copiar + deshacer.
 */
function addMessageToolbar(keepCount, markdown, etiquetaDeTiempo) {
  const bar = document.createElement('div');
  bar.className = 'msg__toolbar';

  const time = document.createElement('span');
  time.className = 'msg__time';
  time.textContent = etiquetaDeTiempo ?? 'just now';

  const actions = document.createElement('div');
  actions.className = 'msg__actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'msg__action';
  copyBtn.title = 'Copiar';
  copyBtn.setAttribute('aria-label', 'Copiar');
  copyBtn.innerHTML = window.Icon('copy', 16);
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown ?? '');
      copyBtn.style.color = 'var(--success)';
      setTimeout(() => {
        copyBtn.style.color = '';
      }, 1200);
    } catch {
      // portapapeles no disponible
    }
  });

  actions.append(copyBtn);

  // Reacciones 👍 / 👎 persistidas por turno.
  const reactionKey = `${ui.activeConversation ?? 'new'}:${keepCount ?? 'x'}`;
  const stored = (ui.prefs.reactions ?? {})[reactionKey] ?? null;

  const makeReaction = (kind, symbol, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg__action';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = window.Icon(symbol, 16);
    if (stored === kind) btn.classList.add('is-active');

    btn.addEventListener('click', () => {
      const all = { ...(ui.prefs.reactions ?? {}) };
      const next = all[reactionKey] === kind ? null : kind;
      if (next) all[reactionKey] = next;
      else delete all[reactionKey];

      ui.prefs.reactions = all;
      window.api.setPrefs({ reactions: all }).catch(() => {});

      for (const sibling of actions.querySelectorAll('[data-reaction]')) {
        sibling.classList.toggle('is-active', sibling.dataset.reaction === next);
      }
    });

    btn.dataset.reaction = kind;
    return btn;
  };

  actions.append(
    makeReaction('up', 'thumbUp', 'Buena respuesta'),
    makeReaction('down', 'thumbDown', 'Mala respuesta'),
  );

  if (typeof keepCount === 'number' && keepCount >= 0) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'msg__action';
    undoBtn.title = 'Deshacer hasta aquí';
    undoBtn.setAttribute('aria-label', 'Deshacer hasta aquí');
    undoBtn.innerHTML = window.Icon('undo', 16);
    undoBtn.addEventListener('click', () => revertTo(keepCount));
    actions.append(undoBtn);
  }

  bar.append(time, actions);
  els.threadInner.append(bar);
  return bar;
}

/**
 * Muestra el indicador de trabajo con tiempo transcurrido.
 * Equivale a `agent-loading` de Antigravity.
 */
function showLoading() {
  hideLoading();

  const row = document.createElement('div');
  row.className = 'agent-loading';

  const spinner = document.createElement('span');
  spinner.className = 'agent-loading__spinner';

  const label = document.createElement('span');
  label.className = 'agent-loading__label';
  label.textContent = 'Trabajando…';

  const elapsed = document.createElement('span');
  elapsed.className = 'agent-loading__elapsed';
  elapsed.textContent = '0s';

  row.append(spinner, label, elapsed);
  els.threadInner.append(row);
  ui.loadingEl = row;

  const startedAt = Date.now();
  ui.loadingTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    elapsed.textContent = `${seconds}s`;
  }, 1000);

  scrollToBottom();
}

/** Retira el indicador de trabajo. */
function hideLoading() {
  if (ui.loadingTimer) {
    clearInterval(ui.loadingTimer);
    ui.loadingTimer = null;
  }
  if (ui.loadingEl) {
    ui.loadingEl.remove();
    ui.loadingEl = null;
  }
}

/** Convierte el botón de enviar en botón de parar mientras el agente trabaja. */
function setSendMode(busy) {
  if (!els.send) return;

  if (busy) {
    els.send.disabled = false;
    els.send.classList.add('is-stop');
    els.send.title = 'Detener';
    els.send.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>';
  } else {
    els.send.classList.remove('is-stop');
    els.send.title = 'Enviar';
    els.send.innerHTML = window.Icon('send', 16);
  }
}

/** Anota el archivo que tocó una herramienta, para el panel de Files. */
function noteTouchedFile(call) {
  const path = call.arguments && call.arguments.path;
  if (typeof path !== 'string' || path.length === 0) return;

  const kind = call.name === 'write_file' ? 'written' : 'read';
  const previous = ui.touchedFiles.get(path);
  if (!previous || kind === 'written') {
    ui.touchedFiles.set(path, kind);
  }
  renderOverview();
}

// ---------------------------------------------------------------------------
// Navegador de turnos
// ---------------------------------------------------------------------------

/** Tiempo relativo corto: 12m, 1h, 9d. */
function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return `${Math.floor(days / 7)}w`;
}

/** Abre el gestor de tareas programadas. */
async function openScheduled() {
  const modal = document.getElementById('scheduled-modal');
  if (!modal) return;

  modal.removeAttribute('hidden');
  await renderScheduled();
}

/** Abre la vista de Automations, como la suya: a página completa. */
async function openAutomations() {
  const vista = document.getElementById('automations-view');
  const main = document.querySelector('.content__main');
  if (!vista || !main) return;

  /*
   * Si ya está abierta, no se vuelve a ocultar el hilo: la segunda pasada
   * guardaba como estado original `hidden` (ya oculto) y al cerrar dejaba el
   * área de contenido en blanco, sin hilo ni composer.
   */
  if (!vista.hidden) {
    await renderAutomations();
    return;
  }

  // La vista sustituye al hilo y al composer mientras está abierta.
  vista.hidden = false;
  for (const hijo of main.children) {
    if (hijo === vista) continue;
    // Solo se guarda el estado original una vez.
    if (hijo.dataset.ocultoPorAutomations === undefined) {
      hijo.dataset.ocultoPorAutomations = hijo.hidden ? '1' : '0';
    }
    hijo.hidden = true;
  }

  await renderAutomations();
}

/** Cierra la vista de Automations y devuelve el hilo. */
function closeAutomations() {
  const vista = document.getElementById('automations-view');
  const main = document.querySelector('.content__main');
  if (!vista || !main) return;

  vista.hidden = true;
  for (const hijo of main.children) {
    if (hijo === vista) continue;
    if (hijo.dataset.ocultoPorAutomations === undefined) continue;
    hijo.hidden = hijo.dataset.ocultoPorAutomations === '1';
    delete hijo.dataset.ocultoPorAutomations;
  }

  // Una pregunta que llegó con la vista abierta se muestra ahora.
  const askHost = document.getElementById('ask-host');
  if (askHost?.dataset.preguntaPendiente === '1') {
    askHost.hidden = false;
    delete askHost.dataset.preguntaPendiente;
  }
}

/** Pinta la lista de automatizaciones o su estado vacío. */
async function renderAutomations() {
  const cuerpo = document.getElementById('automations-body');
  if (!cuerpo) return;

  cuerpo.replaceChildren();

  let tareas = [];
  try {
    tareas = (await window.api.listScheduled?.()) ?? [];
  } catch {
    tareas = [];
  }

  if (!Array.isArray(tareas) || tareas.length === 0) {
    const titulo = document.createElement('p');
    titulo.className = 'automations__empty-title';
    titulo.textContent = 'No automations yet';

    const desc = document.createElement('p');
    desc.className = 'automations__empty-desc';
    desc.textContent =
      "Run a prompt on a schedule, like a morning summary of yesterday's changes. " +
      'Runs show up here.';

    cuerpo.append(titulo, desc);
    return;
  }

  for (const tarea of tareas) {
    const fila = document.createElement('div');
    fila.className = 'automations__row';

    const texto = document.createElement('div');
    texto.className = 'automations__row-text';
    texto.textContent = tarea.prompt ?? tarea.message ?? '(sin texto)';

    const cuando = document.createElement('span');
    cuando.className = 'automations__row-when';
    // Las tareas guardan `nextRunAt` o `at`, no un texto de programación.
    const fecha = tarea.nextRunAt ?? tarea.at ?? null;
    cuando.textContent =
      tarea.mode === 'cron'
        ? (tarea.cron ?? 'recurrente')
        : fecha
          ? new Date(fecha).toLocaleString('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

    fila.append(texto, cuando);

    /*
     * Historial de ejecuciones, como su «Runs show up here»: las últimas veces
     * que se disparó, con su hora.
     */
    const runs = Array.isArray(tarea.runs) ? tarea.runs.slice(-3).reverse() : [];
    if (runs.length > 0) {
      const historial = document.createElement('div');
      historial.className = 'automations__runs';
      for (const run of runs) {
        const linea = document.createElement('span');
        linea.className = 'automations__run';
        linea.textContent = run.ok === false ? 'falló' : 'ejecutada';
        const hora = document.createElement('span');
        hora.className = 'automations__run-when';
        hora.textContent = run.at
          ? new Date(run.at).toLocaleString('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        linea.append(' ', hora);
        historial.append(linea);
      }
      texto.append(historial);
    }

    cuerpo.append(fila);
  }
}

/** Cierra el gestor de tareas programadas. */
function closeScheduled() {
  document.getElementById('scheduled-modal')?.setAttribute('hidden', '');
}

/** Pinta la lista de tareas programadas. */
async function renderScheduled() {
  const list = document.getElementById('scheduled-list');
  if (!list) return;

  let tasks = [];
  try {
    tasks = await window.api.listScheduled();
  } catch {
    tasks = [];
  }

  list.replaceChildren();

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scheduled__empty';
    empty.textContent = 'Sin tareas programadas.';
    list.append(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = task.enabled === false ? 'scheduled__item is-off' : 'scheduled__item';

    const text = document.createElement('span');
    text.className = 'scheduled__prompt-text';
    text.textContent = task.prompt;
    text.title = task.prompt;

    const meta = document.createElement('span');
    meta.className = 'scheduled__meta';
    const unidad = task.unit === 'hours' ? 'h' : 'min';
    meta.textContent = `cada ${task.every}${unidad}`;

    const actions = document.createElement('div');
    actions.className = 'scheduled__item-actions';

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn';
    run.textContent = 'Ejecutar';
    run.addEventListener('click', async () => {
      await window.api.runScheduled(task.id);
      closeScheduled();
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn';
    toggle.textContent = task.enabled === false ? 'Activar' : 'Pausar';
    toggle.addEventListener('click', async () => {
      await window.api.toggleScheduled(task.id, task.enabled === false);
      await renderScheduled();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'Borrar';
    remove.addEventListener('click', async () => {
      await window.api.deleteScheduled(task.id);
      await renderScheduled();
    });

    actions.append(run, toggle, remove);
    row.append(text, meta, actions);
    list.append(row);
  }
}

/**
 * Convierte la salida de una herramienta en algo legible.
 * Cada tipo tiene su representación: árbol, terminal, código, imagen…
 */
function renderToolOutput(name, content, isError) {
  // El aviso de hooks es para el modelo, no para la interfaz.
  const limpio = String(content ?? '').replace(/\n*\[hooks\][^\n]*/g, '').trimEnd();
  if (isError) return monoBlock(limpio, 'tool-out tool-out--error');

  switch (name) {
    case 'list_directory':
      // Su bloque de terminal muestra el listado como texto plano, sin árbol
      // ni iconos: es una salida de shell, no un explorador.
      return monoBlock(limpio, 'tool-out tool-out--ok');
    case 'run_command':
      return renderTerminal(limpio);
    case 'read_file':
      return renderCode(limpio);
    case 'write_file':
    case 'edit_file':
      return monoBlock(limpio, 'tool-out tool-out--ok');
    case 'search_files':
    case 'search_code':
      return renderSearchResults(limpio);
    case 'browser_read':
    case 'browser_open':
      return renderBrowserResult(limpio);
    default:
      return monoBlock(content, 'tool-out');
  }
}

/**
 * Pinta en el hilo la imagen que generó `generate_image`.
 *
 * Se usa tanto al terminar la herramienta como al abrir una conversación
 * guardada: el historial solo trae el texto «Guardada en …», así que sin esto
 * la imagen desaparece al reiniciar la app.
 *
 * Se prefiere el fichero guardado: la URL de Flow exige la sesión del navegador
 * oculto y el CSP del hilo (`img-src 'self' data:`) bloquea las remotas. Se
 * pide su contenido como data URL.
 */
function pintarImagenGenerada(content) {
  const guardada = /Guardada en (.+?)\.?\s*$/m.exec(String(content ?? ''))?.[1]?.trim();
  const urlRemota = /URL:\s*(https?:\/\/\S+)/.exec(String(content ?? ''))?.[1];
  if (!guardada && !urlRemota) return;

  const img = document.createElement('img');
  img.className = 'generated-image';
  img.alt = 'Imagen generada';
  // Sin tamaño hasta que cargue: evita un hueco roto mientras llega el data URL.
  img.style.visibility = 'hidden';
  img.onload = () => {
    img.style.visibility = '';
    scrollToBottom();
  };
  img.onerror = () => img.remove();
  insertarAntesDeLaRespuesta(img);

  if (guardada) {
    window.api
      .imageAsDataUrl?.(guardada)
      .then((r) => {
        if (r?.ok && r.dataUrl) img.src = r.dataUrl;
        else img.remove();
      })
      .catch(() => img.remove());
  } else {
    img.src = urlRemota;
  }

  scrollToBottom();
}

/** Bloque monoespaciado simple. */
function monoBlock(text, className) {
  const pre = document.createElement('pre');
  pre.className = className;
  pre.textContent = text;
  return pre;
}

/** Árbol de directorio: las entradas que acaban en «/» son carpetas. */
function renderTree(content) {
  const box = document.createElement('div');
  box.className = 'tool-tree';

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    box.append(monoBlock('(vacío)', 'tool-out'));
    return box;
  }

  for (const line of lines) {
    const isDir = line.endsWith('/');
    const row = document.createElement('div');
    row.className = 'tool-tree__row';

    const icon = document.createElement('span');
    icon.className = 'tool-tree__icon';
    icon.innerHTML = window.Icon(isDir ? 'project' : 'files', 14);

    const label = document.createElement('span');
    label.className = isDir ? 'tool-tree__name is-dir' : 'tool-tree__name';
    label.textContent = line.replace(/\/$/, '');

    row.append(icon, label);
    box.append(row);
  }

  return box;
}

/** Salida de terminal: separa stdout y stderr con su color. */
function renderTerminal(content) {
  const box = document.createElement('pre');
  box.className = 'tool-out tool-terminal';

  const parts = content.split(/^--- (stdout|stderr) ---$/m);
  if (parts.length === 1) {
    box.textContent = content;
    return box;
  }

  for (let i = 1; i < parts.length; i += 2) {
    const kind = parts[i];
    const body = (parts[i + 1] ?? '').trim();
    if (body.length === 0) continue;

    const section = document.createElement('span');
    section.className = kind === 'stderr' ? 'tool-terminal__err' : 'tool-terminal__out';
    section.textContent = body + '\n';
    box.append(section);
  }

  return box;
}

/** Código con números de línea (máximo 40 líneas visibles). */
function renderCode(content) {
  const box = document.createElement('div');
  box.className = 'tool-code';

  const lines = content.split('\n');
  const shown = lines.slice(0, 40);

  shown.forEach((line, index) => {
    const row = document.createElement('div');
    row.className = 'tool-code__row';

    const num = document.createElement('span');
    num.className = 'tool-code__num';
    num.textContent = String(index + 1);

    const text = document.createElement('span');
    text.className = 'tool-code__text';
    text.textContent = line.length > 0 ? line : ' ';

    row.append(num, text);
    box.append(row);
  });

  if (lines.length > shown.length) {
    const more = document.createElement('div');
    more.className = 'tool-code__more';
    more.textContent = `… ${lines.length - shown.length} líneas más`;
    box.append(more);
  }

  return box;
}

/** Resultados de búsqueda agrupados por fichero. */
function renderSearchResults(content) {
  const box = document.createElement('div');
  box.className = 'tool-search';

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return monoBlock('Sin resultados', 'tool-out');

  for (const line of lines) {
    const match = /^([^:]+):(\d+):\s?(.*)$/.exec(line);

    const row = document.createElement('div');
    row.className = 'tool-search__row';

    if (match) {
      const file = document.createElement('span');
      file.className = 'tool-search__file';
      file.textContent = `${match[1]}:${match[2]}`;

      const text = document.createElement('span');
      text.className = 'tool-search__text';
      text.textContent = match[3];

      row.append(file, text);
    } else {
      const text = document.createElement('span');
      text.className = 'tool-search__text';
      text.textContent = line;
      row.append(text);
    }

    box.append(row);
  }

  return box;
}

/** Resultado del navegador: si trae una captura en base64, la dibuja. */
function renderBrowserResult(content) {
  const base64 = /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]{200,})/.exec(content);
  if (base64) {
    const box = document.createElement('div');
    box.className = 'tool-shot';

    const img = document.createElement('img');
    img.className = 'tool-shot__img';
    img.src = `data:image/${base64[1]};base64,${base64[2]}`;
    img.alt = 'Captura del navegador';

    const link = document.createElement('a');
    link.className = 'tool-shot__link';
    link.href = img.src;
    link.textContent = 'Abrir captura';
    link.addEventListener('click', (event) => event.stopPropagation());

    box.append(img, link);
    return box;
  }

  return monoBlock(content, 'tool-out');
}

/** Deja constancia del plan en el hilo, con la decisión tomada. */
function addPlanBlock(plan, approved, feedback) {
  const wrap = document.createElement('div');
  wrap.className = 'plan-block';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', 'false');
  header.dataset.testid = 'plan-block';

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = approved ? `Plan aprobado · ${plan.steps?.length ?? 0} pasos` : 'Plan rechazado';

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';
  body.hidden = true;

  const title = document.createElement('div');
  title.className = 'plan-block__title';
  title.textContent = plan.title ?? 'Plan';
  body.append(title);

  const list = document.createElement('ol');
  list.className = 'plan-block__steps';
  for (const step of plan.steps ?? []) {
    const item = document.createElement('li');
    item.textContent = step.title;
    if (step.detail) {
      const detail = document.createElement('div');
      detail.className = 'plan__step-detail';
      detail.textContent = step.detail;
      item.append(detail);
    }
    list.append(item);
  }
  body.append(list);

  if (!approved && feedback) {
    const note = document.createElement('div');
    note.className = 'plan-block__feedback';
    note.textContent = `Motivo: ${feedback}`;
    body.append(note);
  }

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  wrap.classList.toggle('is-rejected', !approved);
  wrap.append(header, body);
  els.threadInner.append(wrap);
  scrollToBottom();
}

/** Muestra la tarjeta de plan y devuelve la decisión del usuario. */
function showPlanCard(plan) {
  const modal = document.getElementById('plan-modal');
  const title = document.getElementById('plan-title');
  const list = document.getElementById('plan-steps');
  const feedback = document.getElementById('plan-feedback');
  if (!modal || !title || !list) return;

  title.textContent = plan.title ?? 'Plan';
  feedback.value = '';
  list.replaceChildren();

  /** Lee los pasos tal como están ahora en la tarjeta. */
  const leerPasos = () =>
    [...list.querySelectorAll('.plan__step')].map((item) => ({
      title: item.querySelector('.plan__input')?.value.trim() ?? '',
      detail: item.querySelector('.plan__detail')?.value.trim() ?? '',
    })).filter((paso) => paso.title.length > 0);

  /** Crea la fila editable de un paso. */
  const crearFila = (paso) => {
    const item = document.createElement('div');
    item.className = 'plan__step';

    const numero = document.createElement('span');
    numero.className = 'plan__num';

    const campos = document.createElement('div');
    campos.className = 'plan__fields';

    const entrada = document.createElement('input');
    entrada.type = 'text';
    entrada.className = 'plan__input';
    entrada.value = paso.title ?? '';
    entrada.placeholder = 'Qué se hará';

    const detalle = document.createElement('input');
    detalle.type = 'text';
    detalle.className = 'plan__detail';
    detalle.value = paso.detail ?? '';
    detalle.placeholder = 'Detalle (opcional)';

    campos.append(entrada, detalle);

    const acciones = document.createElement('div');
    acciones.className = 'plan__row-actions';

    const boton = (texto, titulo, onClick, clase) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `plan__icon-btn ${clase ?? ''}`.trim();
      b.title = titulo;
      b.textContent = texto;
      b.onclick = onClick;
      return b;
    };

    acciones.append(
      boton('↑', 'Subir', () => {
        const anterior = item.previousElementSibling;
        if (anterior) {
          list.insertBefore(item, anterior);
          renumerar();
        }
      }),
      boton('↓', 'Bajar', () => {
        const siguiente = item.nextElementSibling;
        if (siguiente) {
          list.insertBefore(siguiente, item);
          renumerar();
        }
      }),
      boton('✕', 'Quitar este paso', () => {
        item.remove();
        renumerar();
      }, 'is-remove'),
    );

    item.append(numero, campos, acciones);
    return item;
  };

  const renumerar = () => {
    [...list.querySelectorAll('.plan__step')].forEach((item, indice) => {
      const numero = item.querySelector('.plan__num');
      if (numero) numero.textContent = String(indice + 1);
    });
  };

  for (const step of plan.steps ?? []) list.append(crearFila(step));
  renumerar();

  // Añadir un paso nuevo al final.
  const addBtn = document.getElementById('plan-add-step');
  if (addBtn) {
    addBtn.onclick = () => {
      const fila = crearFila({ title: '', detail: '' });
      list.append(fila);
      renumerar();
      fila.querySelector('.plan__input')?.focus();
    };
  }

  modal.removeAttribute('hidden');

  const respond = (approved) => {
    const pasos = leerPasos();
    modal.setAttribute('hidden', '');
    addPlanBlock({ ...plan, steps: pasos }, approved, feedback.value);
    window.api
      .respondPlan({ id: plan.id, approved, feedback: feedback.value, steps: pasos })
      .catch(() => {});
  };

  const approve = document.getElementById('plan-approve');
  const reject = document.getElementById('plan-reject');
  approve.onclick = () => respond(true);
  reject.onclick = () => respond(false);

  feedback.focus();
}

/** Muestra la tarjeta de preguntas y devuelve las respuestas del usuario. */
/**
 * Tarjeta de decisión, **en línea dentro del hilo**, como la suya.
 *
 * Medido en su DOM: 766 px de ancho (todo el hilo), radio **20**, fondo
 * `rgb(19,19,23)`, `padding: 6px`; cabecera con icono de 20×21, la pregunta a
 * 14/20 y un botón de plegar de 24×24; opciones en filas de **30 px** numeradas
 * («1 (Recommended) Daily») y un único botón **Submit**.
 *
 * Antes era un overlay centrado que tapaba la app: se leía como un diálogo
 * aparte cuando en realidad es parte de la conversación.
 */
function showQuestionCard(payload) {
  const preguntas = Array.isArray(payload?.questions) ? payload.questions : [];
  if (preguntas.length === 0) return;

  const seleccion = preguntas.map(() => new Set());
  const escritas = preguntas.map(() => '');

  const card = document.createElement('div');
  card.className = 'ask-card';

  const responder = (respuestas) => {
    // Se anima la salida antes de quitarla: 120ms, el mismo fade al revés.
    card.classList.add('is-closing');
    setTimeout(() => {
      const host = document.getElementById('ask-host');
      if (host) {
        host.replaceChildren();
        host.hidden = true;
        delete host.dataset.preguntaPendiente;
      }
      card.remove();
    }, 120);
    window.api.respondQuestion({ id: payload.id, answers: respuestas }).catch(() => {});
  };

  preguntas.forEach((pregunta, indice) => {
    const head = document.createElement('div');
    head.className = 'ask-card__head';

    const icono = document.createElement('span');
    icono.className = 'ask-card__icon';
    icono.dataset.testid = 'ask-question-header-icon';
    icono.textContent = '?';

    const texto = document.createElement('span');
    texto.className = 'ask-card__question';
    texto.dataset.testid = 'ask-question-header-text';
    texto.textContent = pregunta.question ?? '';

    const plegar = document.createElement('button');
    plegar.type = 'button';
    plegar.className = 'ask-card__collapse';
    plegar.dataset.testid = 'ask-question-collapse-button';
    plegar.setAttribute('aria-label', 'Plegar');
    plegar.innerHTML = window.Icon('chevron', 16);

    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'ask-card__collapse';
    cerrar.setAttribute('aria-label', 'Cerrar');
    cerrar.innerHTML = window.Icon('close', 16);
    cerrar.onclick = () => responder(null);

    head.append(icono, texto, plegar, cerrar);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'ask-card__body';

    plegar.addEventListener('click', () => {
      const abierto = cuerpo.hidden === false;
      cuerpo.hidden = abierto;
      plegar.classList.toggle('is-collapsed', abierto);
    });

    const filas = [];
    const opciones = pregunta.options ?? [];

    opciones.forEach((opcion, posicion) => {
      const fila = document.createElement('button');
      fila.type = 'button';
      fila.className = 'ask-card__option';

      const numero = document.createElement('span');
      numero.className = 'ask-card__num';
      numero.textContent = String(posicion + 1);

      const etiqueta = document.createElement('span');
      etiqueta.className = 'ask-card__label';
      /*
       * Su formato es «1 (Recommended) Daily»: la marca va ANTES de la etiqueta,
       * no después.
       */
      const recomendada = /recommended/i.test(opcion.label ?? '') || opcion.recommended === true;
      const limpia = String(opcion.label ?? '').replace(/\s*\(recommended\)\s*/i, ' ').trim();
      etiqueta.textContent = recomendada ? `(Recommended) ${limpia}` : limpia;

      fila.append(numero, etiqueta);

      if (opcion.description) {
        const detalle = document.createElement('span');
        detalle.className = 'ask-card__desc';
        detalle.textContent = opcion.description;
        fila.append(detalle);
      }

      fila.onclick = () => {
        if (pregunta.allowMultiple === true) {
          if (seleccion[indice].has(opcion.label)) seleccion[indice].delete(opcion.label);
          else seleccion[indice].add(opcion.label);
        } else {
          seleccion[indice].clear();
          seleccion[indice].add(opcion.label);
        }
        for (const otra of filas) otra.classList.remove('is-selected');
        for (const otra of filas) {
          const etiquetaOtra = otra.querySelector('.ask-card__label')?.textContent ?? '';
          if ([...seleccion[indice]].some((s) => etiquetaOtra.startsWith(s))) {
            otra.classList.add('is-selected');
          }
        }
      };

      filas.push(fila);
      cuerpo.append(fila);
    });

    /*
     * «Other (write your answer)» es la ÚLTIMA OPCIÓN, no un campo aparte: al
     * pulsarla se convierte en una fila de texto, como en su tarjeta.
     */
    const otra = document.createElement('button');
    otra.type = 'button';
    otra.className = 'ask-card__option ask-card__option--other';

    const numOtra = document.createElement('span');
    numOtra.className = 'ask-card__num';
    numOtra.textContent = String(opciones.length + 1);

    const etiquetaOtra = document.createElement('span');
    etiquetaOtra.className = 'ask-card__label';
    etiquetaOtra.textContent = 'Other (write your answer)';

    otra.append(numOtra, etiquetaOtra);

    const libre = document.createElement('input');
    libre.type = 'text';
    libre.className = 'ask-card__input';
    libre.placeholder = 'Escribe tu respuesta';
    libre.hidden = true;
    libre.oninput = () => {
      escritas[indice] = libre.value;
    };

    otra.onclick = () => {
      libre.hidden = false;
      otra.classList.add('is-selected');
      libre.focus();
    };

    cuerpo.append(otra, libre);

    const pie = document.createElement('div');
    pie.className = 'ask-card__foot';

    const micro = document.createElement('button');
    micro.type = 'button';
    micro.className = 'ask-card__mic';
    micro.setAttribute('aria-label', 'Dictar');
    micro.innerHTML = window.Icon('mic', 16);
    micro.onclick = () => libre.focus();

    const omitir = document.createElement('button');
    omitir.type = 'button';
    omitir.className = 'ask-card__skip';
    omitir.textContent = 'Skip';
    omitir.onclick = () => responder(null);

    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.className = 'ask-card__submit';
    enviar.textContent = 'Submit ⏎';
    enviar.onclick = () => {
      const respuestas = preguntas.map((_, i) => {
        const elegidas = [...seleccion[i]];
        if (escritas[i].trim().length > 0) elegidas.push(escritas[i].trim());
        return elegidas;
      });
      responder(respuestas);
    };

    pie.append(micro, omitir, enviar);
    cuerpo.append(pie);

    card.append(head, cuerpo);
  });

  /*
   * Se ancla sobre el composer, como la suya: no va en el flujo del hilo, sino
   * fija encima del campo de escritura.
   */
  const host = document.getElementById('ask-host');
  if (host) {
    host.replaceChildren(card);
    /*
     * La vista de Automations sustituye al hilo y al composer. Si la pregunta
     * llega mientras está abierta, no debe flotar encima de esa vista: se deja
     * guardada y aparece al volver a la conversación.
     */
    const automationsAbierta = document.getElementById('automations-view')?.hidden === false;
    host.hidden = automationsAbierta;
    if (automationsAbierta) host.dataset.preguntaPendiente = '1';
  } else {
    els.threadInner.append(card);
  }
  card.querySelector('.ask-card__input')?.focus();
}

/**
 * Tarjeta de revisión del turno: «N files changed +X -Y · Review».
 * Equivalente a la que muestra Antigravity bajo la respuesta.
 */
async function addTurnReviewCard() {
  let cambios;
  try {
    cambios = await window.api.turnChanges();
  } catch {
    return;
  }
  if (!cambios || !cambios.files) return;

  const yaHay = document.querySelector('.turn-review');
  if (yaHay) yaHay.remove();

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'turn-review';

  const izquierda = document.createElement('span');
  izquierda.className = 'turn-review__left';

  const etiqueta = document.createElement('span');
  etiqueta.className = 'turn-review__files';
  etiqueta.textContent = `${cambios.files} file${cambios.files === 1 ? '' : 's'} changed`;

  const mas = document.createElement('span');
  mas.className = 'turn-review__add';
  mas.textContent = `+${cambios.additions}`;

  const menos = document.createElement('span');
  menos.className = 'turn-review__del';
  menos.textContent = `-${cambios.removals}`;

  izquierda.append(etiqueta, mas, menos);

  const accion = document.createElement('span');
  accion.className = 'turn-review__action';
  const icono = document.createElement('span');
  icono.className = 'turn-review__action-icon';
  icono.innerHTML = window.Icon('review', 14);
  const textoAccion = document.createElement('span');
  textoAccion.textContent = 'Review';
  accion.append(icono, textoAccion);

  card.append(izquierda, accion);
  card.addEventListener('click', () => {
    if (typeof selectOverviewView === 'function') {
      toggleOverview(true, 'auto');
      selectOverviewView('review');
    }
  });

  // Antes del pie del mensaje: tarjeta, y debajo hora y acciones.
  const pies = els.threadInner.querySelectorAll('.msg__toolbar');
  const ultimoPie = pies[pies.length - 1];
  if (ultimoPie) els.threadInner.insertBefore(card, ultimoPie);
  else els.threadInner.append(card);
  scrollToBottom();
}

/** Muestra un aviso en la barra de título. */
function showAnnouncement(text, action) {
  const box = document.getElementById('titlebar-announce');
  const label = document.getElementById('announce-text');
  const button = document.getElementById('announce-action');
  if (!box || !label) return;

  label.textContent = text;
  box.removeAttribute('hidden');

  if (button) {
    if (action && action.label) {
      button.hidden = false;
      button.textContent = action.label;
      button.onclick = () => {
        box.setAttribute('hidden', '');
        action.onClick?.();
      };
    } else {
      button.hidden = true;
      button.onclick = null;
    }
  }
}

/** Oculta el aviso de la barra de título. */
function hideAnnouncement() {
  document.getElementById('titlebar-announce')?.setAttribute('hidden', '');
}

/** Comandos que ofrece la paleta (Ctrl+K). */
const PALETTE_COMMANDS = [
  { label: 'Nueva conversación', hint: 'Ctrl+N', run: () => newConversation() },
  { label: 'Buscar conversaciones', hint: 'Ctrl+M', run: () => toggleSearch(true) },
  { label: 'Ajustes', hint: '', run: () => window.SettingsUI.open() },
  { label: 'Modelos', hint: '', run: () => window.SettingsUI.open('models') },
  { label: 'Apariencia', hint: '', run: () => window.SettingsUI.open('appearance') },
  { label: 'Mostrar u ocultar barra lateral', hint: '', run: () => toggleSidebar() },
  {
    label: 'Ejecutar los tests',
    hint: '',
    run: async () => {
      const resultado = await window.api.testsRun();
      if (!resultado?.ok) {
        showAnnouncement(resultado?.error ?? 'No se pudieron ejecutar los tests.');
      }
    },
  },
  { label: 'Mostrar u ocultar terminal', hint: 'Ctrl+`', run: () => toggleTerminal() },
  { label: 'Mostrar u ocultar panel de resumen', hint: '', run: () => toggleOverview() },
  { label: 'Abrir fichero…', hint: '', run: () => runNewTabAction('open-file') },
  { label: 'Adjuntar fichero al mensaje', hint: '', run: () => attachFile() },
  { label: 'Reconstruir índice', hint: '', run: () => document.getElementById('index-build')?.click() },
  { label: 'Recargar ventana', hint: '', run: () => window.location.reload() },
  { label: 'Herramientas de desarrollo', hint: '', run: () => window.api.toggleDevTools() },
];

let paletteItems = [];
let paletteIndex = 0;

/** Abre la paleta de comandos. */
function openPalette() {
  const modal = document.getElementById('palette-modal');
  const input = document.getElementById('palette-input');
  if (!modal || !input) return;

  modal.removeAttribute('hidden');
  input.value = '';
  renderPalette('');
  input.focus();
}

/** Cierra la paleta. */
function closePalette() {
  document.getElementById('palette-modal')?.setAttribute('hidden', '');
}

/** Pinta los comandos que coinciden con el filtro. */
function renderPalette(query) {
  const list = document.getElementById('palette-list');
  if (!list) return;

  const q = query.trim().toLowerCase();
  paletteItems = q
    ? PALETTE_COMMANDS.filter((command) => command.label.toLowerCase().includes(q))
    : PALETTE_COMMANDS;

  paletteIndex = 0;
  list.replaceChildren();

  if (paletteItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette__empty';
    empty.textContent = 'Ningún comando coincide.';
    list.append(empty);
    return;
  }

  paletteItems.forEach((command, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'palette__item';
    if (index === 0) item.classList.add('is-active');

    const label = document.createElement('span');
    label.textContent = command.label;
    item.append(label);

    if (command.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette__hint';
      hint.textContent = command.hint;
      item.append(hint);
    }

    item.addEventListener('click', () => {
      closePalette();
      command.run();
    });

    list.append(item);
  });
}

/** Mueve la selección dentro de la paleta. */
function movePaletteSelection(delta) {
  if (paletteItems.length === 0) return;

  paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
  const nodes = document.querySelectorAll('.palette__item');
  nodes.forEach((node, index) => node.classList.toggle('is-active', index === paletteIndex));
  nodes[paletteIndex]?.scrollIntoView({ block: 'nearest' });
}

/** Muestra u oculta el panel auxiliar (editor / nueva pestaña). */
function toggleEditorPane(force) {
  const open = force ?? els.editorPane.hidden;

  // Los dos paneles laterales no caben a la vez sin ahogar el chat.
  if (open && !els.overviewPanel.hidden) toggleOverview(false);

  els.editorPane.hidden = !open;

  const button = document.getElementById('toggle-aux-pane');
  if (button) button.setAttribute('aria-pressed', String(open));

  if (open) renderEditorTabs();
}

/** Acciones de la vista de nueva pestaña del panel auxiliar. */
async function runNewTabAction(action) {
  switch (action) {
    case 'open-file': {
      const filePath = await window.api.openFileDialog();
      if (filePath) await openInEditor(filePath);
      break;
    }
    case 'terminal':
      await toggleTerminal(true);
      break;
    case 'review':
      await toggleOverview(true);
      selectOverviewView('review');
      break;
    case 'browser':
      await window.api.openBrowser('https://duckduckgo.com');
      break;
    default:
      break;
  }
}

/** Renombra la conversación activa. */
async function renameConversation() {
  if (!ui.activeConversation) return;

  const session = ui.sessions.find((item) => item.id === ui.activeConversation);
  const actual = session?.title ?? '';
  const nuevo = window.prompt('Nuevo nombre para la conversación', actual);
  if (!nuevo || nuevo.trim() === actual) return;

  await window.api.renameSession(ui.activeConversation, nuevo.trim());
  await refreshConversations();
  renderPaneTitle();
}

/** Archiva (quita de la lista) la conversación activa. */
async function archiveConversation() {
  if (!ui.activeConversation) return;

  await window.api.deleteSession(ui.activeConversation);
  newConversation();
  await refreshConversations();
}

/** Exporta la conversación activa a Markdown. */
async function exportConversation() {
  if (!ui.activeConversation) return;

  const result = await window.api.exportSession(ui.activeConversation);
  if (result?.ok) addNotice(`Conversación exportada a ${result.path}`, 'info');
}

/** Pinta el título de la conversación en la barra del panel. */
function renderPaneTitle() {
  const el = document.getElementById('pane-title');
  if (!el) return;

  const session = ui.sessions.find((item) => item.id === ui.activeConversation);
  el.textContent = session?.title ?? 'Nueva conversación';
}

/** Presets de permisos, los mismos que ofrece Ajustes. */
const PRESETS = ['Request Review', 'Default', 'Auto (Preview)', 'Turbo'];

/** Pinta el nombre del preset en la píldora del composer. */
function renderPresetLabel() {
  const label = document.getElementById('preset-label');
  if (label) label.textContent = ui.prefs.permissionPreset ?? 'Turbo';
}

/** Cambia el preset de permisos y lo persiste. */
async function setPermissionPreset(preset) {
  ui.prefs.permissionPreset = preset;
  renderPresetLabel();

  // Avisos de arranque: primero lo que bloquea, luego lo opcional.
  const disponibles = ui.providers.filter((entry) => entry.available);
  if (disponibles.length === 0) {
    showAnnouncement('No hay ningún proveedor disponible. Configura una clave o arranca Ollama.', {
      label: 'Abrir modelos',
      onClick: () => window.SettingsUI.open('models'),
    });
  } else if (!ui.providers.some((entry) => entry.id === ui.providerId)) {
    showAnnouncement('El proveedor guardado ya no está disponible. Elige otro modelo.', {
      label: 'Elegir modelo',
      onClick: () => window.SettingsUI.open('models'),
    });
  }
  window.SettingsUI?.refresh();

  try {
    await window.api.setPrefs({ permissionPreset: preset });
  } catch (error) {
    console.error('No se pudo guardar el preset:', error);
  }
}

/** Abre un fichero del disco y lo añade como mención al mensaje. */
async function attachFile() {
  try {
    const filePath = await window.api.openFileDialog();
    if (!filePath) return;

    const relative = await window.api.relativePath(filePath).catch(() => filePath);
    insertIntoInput(`@${relative} `);
  } catch (error) {
    console.error('No se pudo adjuntar el fichero:', error);
  }
}

/** Adjunta una imagen: se guarda en la carpeta temporal y se menciona. */
async function attachImage() {
  try {
    const filePath = await window.api.openImageDialog();
    if (!filePath) return;

    const relative = await window.api.relativePath(filePath).catch(() => filePath);
    insertIntoInput(`@${relative} `);
    ui.pendingImages = [...(ui.pendingImages ?? []), relative];
    addNotice(`Imagen adjunta: ${relative}. Se enviará al modelo con el mensaje.`, 'info');
  } catch (error) {
    console.error('No se pudo adjuntar la imagen:', error);
  }
}

/** Abre el selector de menciones con "@". */
function insertMentionTrigger() {
  insertIntoInput('@');
}

/** Inserta texto en la posición del cursor. */
function insertIntoInput(text) {
  const start = els.input.selectionStart ?? els.input.value.length;
  const end = els.input.selectionEnd ?? start;
  const value = els.input.value;

  els.input.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const caret = start + text.length;
  els.input.setSelectionRange(caret, caret);
  els.input.focus();
  autoGrow();
  updateSendState();
}

/** Dictado por voz con la API de reconocimiento del navegador. */
function toggleDictation() {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

  if (!Recognition) {
    addNotice('Este sistema no ofrece reconocimiento de voz.', 'warning');
    return;
  }

  if (ui.dictation) {
    ui.dictation.stop();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = 'es-ES';
  recognition.continuous = false;
  recognition.interimResults = true;

  const base = els.input.value;
  const button = document.getElementById('btn-voice');
  button?.classList.add('is-recording');

  recognition.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      text += event.results[i][0].transcript;
    }
    els.input.value = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${text}`;
    autoGrow();
    updateSendState();
  };

  recognition.onerror = (event) => {
    if (event.error !== 'aborted') {
      addNotice(`No se pudo dictar: ${event.error}`, 'warning');
    }
  };

  recognition.onend = () => {
    ui.dictation = null;
    button?.classList.remove('is-recording');
    els.input.focus();
  };

  ui.dictation = recognition;
  recognition.start();
}

/** Cambia la vista del panel de overview. */
function selectOverviewView(name) {
  ui.overviewView = name;

  for (const row of document.querySelectorAll('.overview-row')) {
    row.classList.toggle('is-active', row.dataset.panel === name);
  }

  for (const view of document.querySelectorAll('.overview-panel__body > [data-view]')) {
    view.hidden = view.dataset.view !== name;
  }

  // Sin selección el cuerpo queda vacío, como su panel recién abierto.
  const body = document.getElementById('overview-body');
  if (body) body.hidden = !name;

  // La fila Terminal abre la terminal real.
  if (name === 'terminal') toggleTerminal(true);
}

/** Marca el área principal como vacía para centrar el composer. */
function updateEmptyState() {
  const main = document.querySelector('.content__main');
  if (!main) return;

  const hasMessages = els.thread.querySelector('.msg') !== null;
  main.classList.toggle('is-empty', !hasMessages);

  /*
   * Medido en su DOM: en conversación nueva el panel de resumen no existe
   * (`overview-panel` ni siquiera está en el árbol). Con mensajes, sí aparece.
   * Si el usuario lo cierra a mano, se respeta y no se vuelve a abrir solo.
   */
  if (!hasMessages) {
    if (ui.overviewOpen) toggleOverview(false, 'auto');
  } else if (!ui.overviewUserClosed && !ui.overviewOpen) {
    toggleOverview(true, 'auto');
  }

  // El estado vacío desaparece en cuanto entra el primer mensaje.
  const empty = document.getElementById('thread-empty');
  if (empty && hasMessages) empty.remove();
}

/** Pinta los puntos de navegación a la izquierda del hilo. */
function renderNavigator() {
  const nav = $('conversation-navigator');
  if (!nav) return;

  const turns = [...els.thread.querySelectorAll('.msg--user')];
  nav.replaceChildren();

  if (turns.length === 0) {
    nav.hidden = true;
    return;
  }

  nav.hidden = false;
  const list = document.createElement('ol');
  list.className = 'nav-dots';

  turns.forEach((turn, index) => {
    const li = document.createElement('li');
    li.className = 'nav-dots__item';

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'nav-dots__dot';
    dot.setAttribute('aria-label', `Turno ${index + 1} de ${turns.length}`);
    dot.title = `Turno ${index + 1}`;

    dot.addEventListener('click', () => {
      turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    li.append(dot);
    list.append(li);
  });

  nav.append(list);
}

// ---------------------------------------------------------------------------
// Panel de overview
// ---------------------------------------------------------------------------

/** Muestra u oculta el panel lateral derecho. */
function toggleOverview(force) {
  // Mutuamente excluyente con el panel auxiliar.
  if (force === true && !els.editorPane.hidden) toggleEditorPane(false);
  // Solo un cierre explícito del usuario se recuerda. El ocultado automático del
  // estado vacío no cuenta, o el panel no volvería a abrirse nunca.
  if (arguments[1] !== 'auto') {
    if (force === false) ui.overviewUserClosed = true;
    if (force === true) ui.overviewUserClosed = false;
  }
  const open = force ?? !ui.overviewOpen;
  ui.overviewOpen = open;

  const panel = $('overview-panel');
  const host = document.getElementById('overview-host');
  const toggle = $('toggle-overview-panel');
  if (!panel) return;

  // El panel vive dentro de una tarjeta flotante: se oculta la tarjeta.
  if (host) host.hidden = !open;
  panel.hidden = false;
  if (toggle) toggle.setAttribute('aria-pressed', String(open));
  if (open) renderOverview();
}

/** Rellena el panel con archivos, plugins, revisión y terminal. */
function renderOverview() {
  const panel = $('overview-panel');
  const host = document.getElementById('overview-host');
  if (!panel || !ui.overviewOpen || (host && host.hidden)) return;

  void refreshGit();
  void refreshGitLog();
  void refreshIndexStatus();
  renderFileTree();

  const filesBody = $('overview-files');
  const pluginsBody = $('overview-plugins');
  const reviewBody = $('overview-review');

  if (filesBody) {
    filesBody.replaceChildren();
    if (ui.touchedFiles.size === 0) {
      filesBody.append(rowText('Sin archivos todavía'));
    } else {
      for (const [path, kind] of ui.touchedFiles) {
        const row = document.createElement('div');
        row.className = 'overview-item';
        const name = document.createElement('span');
        name.className = 'overview-item__name';
        name.textContent = path;
        name.title = path;
        const badge = document.createElement('span');
        badge.className = kind === 'written' ? 'overview-item__badge is-write' : 'overview-item__badge';
        badge.textContent = kind === 'written' ? 'editado' : 'leído';
        row.append(name, badge);
        row.style.cursor = 'pointer';
        row.title = `${path} — clic para abrir en el editor`;
        row.addEventListener('click', () => openInEditor(path));
        filesBody.append(row);
      }
    }
  }

  if (pluginsBody) {
    pluginsBody.replaceChildren();
    const plugins = ui.prefs.plugins ?? [];
    if (plugins.length === 0) {
      pluginsBody.append(rowText('Sin plugins MCP'));
    } else {
      for (const plugin of plugins) {
        const row = document.createElement('div');
        row.className = 'overview-item';
        const name = document.createElement('span');
        name.className = 'overview-item__name';
        name.textContent = plugin.name;
        const badge = document.createElement('span');
        badge.className = 'overview-item__badge';
        badge.textContent = plugin.enabled === false ? 'off' : 'on';
        row.append(name, badge);
        pluginsBody.append(row);
      }
    }
  }

  if (reviewBody) {
    reviewBody.replaceChildren();
    const writes = [...ui.touchedFiles.values()].filter((kind) => kind === 'written').length;
    const preset = ui.prefs.permissionPreset ?? 'Turbo';
    reviewBody.append(rowText(`Preset: ${preset}`));
    reviewBody.append(rowText(`${writes} escrituras en esta conversación`));
  }
}

function rowText(text) {
  const el = document.createElement('div');
  el.className = 'overview-empty';
  el.textContent = text;
  return el;
}

/** Añade a una fila de herramienta el botón para deshacer hasta ese paso. */
function añadirBotonDeshacer(row) {
  const indice = Number(row.dataset.stepIndex);
  if (!Number.isFinite(indice) || indice <= 0) return;
  if (row.querySelector('.work-row__undo')) return;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'work-row__undo';
  boton.title = 'Deshacer hasta aquí';
  boton.textContent = 'Deshacer hasta aquí';
  boton.onclick = (evento) => {
    evento.stopPropagation();
    revertToStep(indice);
  };

  row.append(boton);
}

/** Muestra el plan de reversión a un paso y, si se confirma, lo aplica. */
async function revertToStep(indice) {
  let plan;
  try {
    plan = await window.api.trajectoryPreview(indice);
  } catch {
    plan = { ok: false };
  }

  const modal = document.getElementById('revert-modal');
  const desc = document.getElementById('revert-desc');
  const list = document.getElementById('revert-list');
  const confirm = document.getElementById('revert-confirm');

  if (!plan?.ok) {
    showAnnouncement(plan?.error ?? 'No hay nada que deshacer hasta ese paso.');
    return;
  }

  if (modal && desc && list && confirm) {
    desc.textContent =
      `Se desharán ${plan.pasosDeshacer} paso(s) y se tocarán ${plan.cambios.length} fichero(s) en disco.`;

    list.replaceChildren();
    for (const cambio of plan.cambios) {
      const fila = document.createElement('div');
      fila.className = 'revert__row';

      const etiqueta = document.createElement('span');
      etiqueta.className = cambio.action === 'borrar' ? 'revert__tag is-delete' : 'revert__tag';
      etiqueta.textContent = cambio.action;

      const nombre = document.createElement('span');
      nombre.className = 'revert__path';
      nombre.textContent = cambio.path;
      nombre.title = cambio.path;

      fila.append(etiqueta, nombre);
      list.append(fila);
    }

    modal.removeAttribute('hidden');

    confirm.onclick = async () => {
      modal.setAttribute('hidden', '');
      const resultado = await window.api.trajectoryRevert(indice);
      if (resultado?.ok) {
        // Se recarga la conversación, igual que hace el revert por turno.
        if (ui.activeConversation) {
          await openConversation(ui.activeConversation);
        } else {
          clearThread();
        }
        addNotice(
          `Deshechos ${resultado.pasosDeshacer} paso(s). ` +
            `Se restauraron ${resultado.restaurados} fichero(s) en disco. ` +
            'La conversación no se recorta; para eso usa el revert por turno.',
          'info',
        );
      } else {
        addNotice(resultado?.error ?? 'No se pudo deshacer hasta ese paso.', 'error');
      }
    };
  }
}

/** Muestra la vista previa y, si se confirma, deshace hasta ese punto. */
async function revertTo(keepCount) {
  let preview;
  try {
    preview = await window.api.revertPreview(keepCount);
  } catch {
    preview = { ok: false, files: [], messages: 0 };
  }

  const modal = document.getElementById('revert-modal');
  const desc = document.getElementById('revert-desc');
  const list = document.getElementById('revert-list');
  const confirm = document.getElementById('revert-confirm');

  if (modal && desc && list && confirm) {
    const files = preview?.files ?? [];
    desc.textContent = files.length
      ? `Se quitarán ${preview.messages} mensaje(s) y se restaurarán ${files.length} fichero(s) en disco.`
      : `Se quitarán ${preview?.messages ?? 0} mensaje(s). No hay ficheros que restaurar.`;

    list.replaceChildren();
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'revert__row';

      const tag = document.createElement('span');
      tag.className = file.action === 'delete' ? 'revert__tag is-delete' : 'revert__tag';
      tag.textContent = file.action === 'delete' ? 'borrar' : 'restaurar';

      const name = document.createElement('span');
      name.className = 'revert__path';
      name.textContent = file.path;
      name.title = file.path;

      row.append(tag, name);
      list.append(row);
    }

    modal.removeAttribute('hidden');

    confirm.onclick = async () => {
      modal.setAttribute('hidden', '');
      await applyRevert(keepCount);
    };
    return;
  }

  await applyRevert(keepCount);
}

/** Aplica la reversión ya confirmada. */
async function applyRevert(keepCount) {
  const result = await window.api.revertChat(keepCount);
  if (!result.ok) {
    addNotice(`No se pudo deshacer: ${result.error}`, 'error');
    return;
  }

  if (ui.activeConversation) {
    await openConversation(ui.activeConversation);
  } else {
    clearThread();
  }

  const files = Number(result.restoredFiles ?? 0);
  addNotice(
    files > 0
      ? `Deshecho hasta ese punto. Se restauraron ${files} ${files === 1 ? 'fichero' : 'ficheros'} en disco.`
      : 'Deshecho hasta ese punto.',
    'info',
  );
}

/** Aviso al pie del turno cuando el agente no llegó a responder. */
function showFinalNotice(event) {
  const reason = event.reason;

  if (reason === 'max_steps') {
    addNotice(
      `Se alcanzó el límite de ${event.maxSteps ?? '?'} pasos y el agente se detuvo sin responder. ` +
        'Pídele que continúe, o divide la tarea en partes más pequeñas.',
      'warning',
    );
    return;
  }

  if (reason === 'error') {
    addNotice('El turno terminó con errores.', 'error');
  }
}

/** Bloque de aviso dentro del hilo. */
function addNotice(message, kind) {
  const el = document.createElement('div');
  el.className = `msg__notice msg__notice--${kind ?? 'info'}`;
  el.textContent = message;
  els.threadInner.append(el);
  scrollToBottom();
}

/** Pinta el markdown acumulado en el mensaje en curso. */
function renderStreamingMarkdown() {
  if (!ui.streamingEl) return;
  ui.streamingEl.innerHTML = window.Markdown.render(ui.streamingText);
}

/** Crea (o reutiliza) el grupo del subagente de navegador. */
function ensureSubagentGroup(id, opciones = {}) {
  const clave = id ?? 'browser';
  ui.subagentGroups = ui.subagentGroups ?? new Map();
  const existente = ui.subagentGroups.get(clave);
  if (existente) return existente;

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', 'true');
  header.dataset.testid = 'subagent-group';

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = opciones.label ?? 'Browser subagent';

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  wrap.append(header, body);

  // Por defecto dentro del grupo del turno; si se indica padre, dentro de él.
  (opciones.parent ?? ensureToolGroup()).body.append(wrap);

  const grupo = { wrap, header, label, body, rows: new Map() };
  ui.subagentGroups.set(clave, grupo);
  return grupo;
}

/** Añade texto del planificador a su grupo, como una nota atenuada. */
function appendPlannerText(texto) {
  const grupo = ensurePlannerGroup();
  let linea = grupo.body.querySelector('.planner-text');
  if (!linea) {
    linea = document.createElement('div');
    linea.className = 'planner-text';
    grupo.body.append(linea);
  }
  linea.textContent += texto;
  scrollToBottom();
}

/** Grupo del turno del planificador, para colgar de él sus herramientas. */
function ensurePlannerGroup() {
  if (ui.plannerGroup) return ui.plannerGroup;

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', 'true');
  header.dataset.testid = 'planner-group';

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = 'Planificador';

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  wrap.append(header, body);
  ensureToolGroup().body.append(wrap);

  const grupo = { wrap, header, label, body, rows: new Map() };
  ui.plannerGroup = grupo;
  return grupo;
}

/**
 * Inserta un bloque de trabajo antes de la respuesta en curso.
 *
 * Antigravity apila pensamiento y herramientas ENCIMA del texto final. Si el
 * primer `text` del turno ya creó la burbuja, añadir al final dejaría los pasos
 * debajo de la respuesta.
 */
function insertarAntesDeLaRespuesta(nodo) {
  const respuesta = ui.streamingEl?.parentElement;
  if (respuesta && respuesta.parentElement === els.threadInner) {
    els.threadInner.insertBefore(nodo, respuesta);
  } else {
    els.threadInner.append(nodo);
  }
}

/**
 * Crea un colapsable con la forma exacta de los suyos.
 *
 * Medido en su DOM: el resumen del turno (`worked-for`) nace ABIERTO y los
 * bloques internos (`tool-group`, `thinking`) nacen CERRADOS.
 */
function crearColapsable(texto, testid, abiertoPorDefecto = false) {
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', String(abiertoPorDefecto));
  if (testid) header.dataset.testid = testid;

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = texto;

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';
  body.hidden = !abiertoPorDefecto;

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  return { header, label, body };
}

/**
 * Crea el resumen del turno («Working…» → «Worked for Ns»).
 *
 * En Antigravity este bloque envuelve el pensamiento y los grupos de
 * herramientas: el pensamiento no es una fila de primer nivel. Se crea con el
 * primer paso (razonamiento o herramienta) y se finaliza al cerrar el turno.
 */
function ensureWorkWrapper() {
  if (ui.workWrapper) return ui.workWrapper;

  const wrap = document.createElement('div');
  wrap.className = 'work-group';
  const outer = crearColapsable('Working…', 'worked-for-collapsible', true);
  wrap.append(outer.header, outer.body);
  insertarAntesDeLaRespuesta(wrap);

  ui.workWrapper = {
    wrap,
    header: outer.header,
    label: outer.label,
    body: outer.body,
    startedAt: Date.now(),
  };
  return ui.workWrapper;
}

/** Crea el colapsable «Thought for Ns» dentro del resumen del turno. */
function ensureReasoningBlock() {
  if (ui.reasoningEl) return ui.reasoningEl;

  const wrapper = ensureWorkWrapper();
  const block = crearColapsable('Thinking', 'thinking-collapsible-trigger');

  const text = document.createElement('div');
  text.className = 'reasoning__text';
  block.body.append(text);

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';
  wrap.append(block.header, block.body);
  wrapper.body.append(wrap);

  ui.reasoningEl = { wrap, header: block.header, label: block.label, body: block.body, text };
  ui.reasoningText = '';
  ui.reasoningStartedAt = Date.now();

  return ui.reasoningEl;
}

/**
 * Quita los escapes de JSON que a veces llegan en el razonamiento.
 *
 * Medido en una sesión real: el bloque mostraba `\"renombra el parametro...\"`
 * con las barras invertidas a la vista, porque el texto venía escapado.
 */
function desescapar(texto) {
  return String(texto)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/** Cierra el bloque de razonamiento con su duración. */
function finishReasoningBlock() {
  const block = ui.reasoningEl;
  if (!block) return;

  const seconds = Math.max(1, Math.round((Date.now() - ui.reasoningStartedAt) / 1000));
  block.label.textContent = `Thought for ${seconds}s`;
  /*
   * No se reabre al terminar: en su DOM el bloque queda cerrado. Abrirlo aquí
   * anulaba el estado inicial cerrado y convertía el hilo en una pared de texto.
   */
  block.header.setAttribute('aria-expanded', 'false');
  block.body.hidden = true;

  ui.reasoningEl = null;
}

function ensureToolGroup() {
  if (ui.toolGroup) return ui.toolGroup;

  const wrapper = ensureWorkWrapper();

  /*
   * Antigravity cuelga las filas «Ran …» directamente del grupo «Worked for»;
   * un grupo intermedio «Ran commands» añadía una etiqueta que su interfaz no
   * tiene. El resumen del turno ya es el encabezado.
   */
  ui.toolGroup = {
    wrap: wrapper.wrap,
    header: wrapper.header,
    label: wrapper.label,
    body: wrapper.body,
    inner: null,
    startedAt: wrapper.startedAt,
    rows: new Map(),
  };

  return ui.toolGroup;
}

/** Qué se escribió en la «terminal» de la tarjeta: el comando, o la llamada. */
function descripcionDeComando(name, args) {
  const a = args ?? {};
  const comando = a.command ?? a.CommandLine ?? a.query ?? a.Query ?? a.path ?? a.TargetFile ?? a.url ?? a.Url;
  if (typeof comando === 'string' && comando.length > 0) return comando.slice(0, 200);
  if (a && Object.keys(a).length > 0) return `${name} ${JSON.stringify(a).slice(0, 160)}`;
  return name;
}

/**
 * Añade una acción al grupo de trabajo.
 * Formato de Antigravity: «Ran <descripción legible>», desplegable con la salida.
 */
function addToolRow(name, args, callId, target, stepIndex) {
  const group = target ?? ensureToolGroup();

  const row = document.createElement('div');
  row.className = 'work-row is-running';
  if (Number.isFinite(stepIndex)) row.dataset.stepIndex = String(stepIndex);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'work-row__header';
  btn.setAttribute('aria-expanded', 'false');

  const etiqueta = friendlyTool(name, args);
  const what = document.createElement('span');
  what.className = 'work-row__what';
  what.textContent = etiqueta;
  what.title = etiqueta;

  const chevron = document.createElement('span');
  chevron.className = 'work-row__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  btn.append(what, chevron);

  /*
   * Tarjeta de terminal, como la suya: cabecera con `$` y el comando en mono
   * (6px 12px, 12/16, con borde inferior) y la salida debajo. Medido: radio 8,
   * fondo el del lienzo, borde y sombra suave.
   */
  const terminal = document.createElement('div');
  terminal.className = 'work-row__terminal';
  terminal.hidden = true;

  const cmd = document.createElement('div');
  cmd.className = 'work-row__cmd';
  const prompt = document.createElement('span');
  prompt.className = 'work-row__prompt';
  prompt.textContent = '$';
  cmd.append(prompt, document.createTextNode(descripcionDeComando(name, args)));

  const out = document.createElement('pre');
  out.className = 'work-row__output';

  terminal.append(cmd, out);

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    terminal.hidden = open;
  });

  row.append(btn, terminal);
  group.body.append(row);

  const entrada = { row, out, cmd, name };
  if (callId) group.rows.set(callId, entrada);
  if (args && Object.keys(args).length > 0) {
    out.textContent = JSON.stringify(args, null, 2);
  }

  return entrada;

  scrollToBottom();
  return row;
}

function formatArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args).slice(0, 2);
  if (entries.length === 0) return '';

  return (
    '(' +
    entries
      .map(([key, value]) => {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const short = raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
        return `${key}: ${short}`;
      })
      .join(', ') +
    ')'
  );
}

function scrollToBottom() {
  els.thread.scrollTop = els.thread.scrollHeight;
}

// ---------------------------------------------------------------------------
// Eventos del agente
// ---------------------------------------------------------------------------

/** Última fila de herramienta con ese nombre, para colgarle el veredicto. */
function buscarFilaDeHerramienta(nombre) {
  const filas = [...document.querySelectorAll('.work-row')];
  for (let i = filas.length - 1; i >= 0; i -= 1) {
    const texto = filas[i].querySelector('.work-row__what')?.textContent ?? '';
    if (texto === friendlyTool(nombre)) return filas[i];
  }
  return null;
}

/** Pinta el veredicto del monitor en la fila de la herramienta. */
function marcarGuardian(fila, texto, clase) {
  let nota = fila.querySelector('.work-row__guardian');
  if (!nota) {
    nota = document.createElement('div');
    nota.className = 'work-row__guardian';
    fila.append(nota);
  }
  nota.className = `work-row__guardian ${clase}`;
  nota.textContent = texto;
}

/** Añade una nota del sistema al hilo (por ejemplo, el monitor de ritmo). */
function addSystemNote(texto) {
  if (!ui.streamingEl) return;
  const nota = document.createElement('div');
  nota.className = 'system-note';
  nota.textContent = texto.replace(/^\[monitor de ritmo\]\s*/, '');
  ui.streamingEl.append(nota);
}

function handleChatEvent(event) {
  switch (event.type) {
    case 'text': {
      if (event.planner) {
        // El texto del planificador no es la respuesta al usuario: va en su grupo.
        appendPlannerText(event.text);
        break;
      }
      finishReasoningBlock();
      if (!ui.streamingEl) addAssistantMessage();
      ui.streamingText += event.text;
      renderStreamingMarkdown();
      scrollToBottom();
      break;
    }

    case 'guardian_check': {
      // El clasificador con modelo está evaluando esta acción.
      const fila = buscarFilaDeHerramienta(event.herramienta);
      if (fila) fila.classList.add('is-checking');
      break;
    }

    case 'guardian_result': {
      const fila = buscarFilaDeHerramienta(event.herramienta);
      if (!fila) break;
      fila.classList.remove('is-checking');

      if (event.fallo) {
        marcarGuardian(fila, 'El monitor no pudo clasificar esta acción', 'is-neutral');
        break;
      }

      if (Number(event.severidad) >= 2) {
        marcarGuardian(
          fila,
          `Monitor de seguridad: ${event.severidad}/10 — ${event.motivo}` +
            (event.cacheado ? ' (en caché)' : ''),
          Number(event.severidad) >= 5 ? 'is-danger' : 'is-warn',
        );
      }
      break;
    }

    case 'text_replace': {
      // Los hooks de texto reescribieron la respuesta: se repinta la definitiva.
      if (!ui.streamingEl) break;
      ui.streamingText = event.text;
      renderStreamingMarkdown();
      break;
    }

    case 'reasoning_replace': {
      // El razonamiento se recortó por tamaño.
      const block = ensureReasoningBlock();
      ui.reasoningText = event.text;
      block.text.textContent = event.text;
      break;
    }

    case 'tests_result': {
      // Resultado de la suite: aviso en la barra y, si hay fallos, el detalle.
      const resumen = event.resumen ?? {};
      const texto = event.bien
        ? `Tests: ${resumen.pasan ?? '?'} pasan`
        : `Tests: ${resumen.pasan ?? '?'} pasan, ${resumen.fallan ?? '?'} fallan`;

      showAnnouncement(texto);

      if (Array.isArray(resumen.fallos) && resumen.fallos.length > 0) {
        if (!ui.streamingEl) addAssistantMessage();
        const bloque = document.createElement('div');
        bloque.className = 'tests-failures';

        const titulo = document.createElement('div');
        titulo.className = 'tests-failures__title';
        titulo.textContent = `${resumen.fallos.length} test(s) fallando`;
        bloque.append(titulo);

        for (const fallo of resumen.fallos.slice(0, 20)) {
          const linea = document.createElement('div');
          linea.className = 'tests-failures__item';
          linea.textContent = fallo.nombre;
          bloque.append(linea);
        }

        ui.streamingEl.append(bloque);
        scrollToBottom();
      }
      break;
    }

    case 'system_note': {
      // Nota del monitor de ritmo: se muestra en el hilo como aviso discreto.
      finishReasoningBlock();
      if (!ui.streamingEl) addAssistantMessage();
      addSystemNote(event.text);
      scrollToBottom();
      break;
    }

    case 'reasoning': {
      const block = ensureReasoningBlock();
      ui.reasoningText += event.text;
      block.text.textContent = desescapar(ui.reasoningText);
      scrollToBottom();
      break;
    }

    case 'tool_start': {
      finishReasoningBlock();

      /*
       * Marcador mientras se genera la imagen. Desaparece al llegar el
       * resultado; si falla, también.
       */
      if (event.call?.name === 'generate_image') {
        const marcador = document.createElement('div');
        marcador.className = 'generated-image--loading';
        marcador.dataset.imageLoading = '1';

        const etiqueta = document.createElement('span');
        etiqueta.className = 'generated-image__label';
        etiqueta.textContent = 'Generando imagen...';
        marcador.append(etiqueta);

        els.threadInner.append(marcador);
        scrollToBottom();
      }
      if (event.subagent) {
        // Un subagente lanzado por el planificador se anida dentro de su grupo.
        const sub = ensureSubagentGroup(event.subagent, {
          parent: event.planner ? ensurePlannerGroup() : undefined,
          label: event.subagentLabel ? `Subagente: ${event.subagentLabel}` : undefined,
        });
        addToolRow(event.call.name, event.call.arguments, event.call.id, sub);
        break;
      }
      if (event.planner) {
        addToolRow(event.call.name, event.call.arguments, event.call.id, ensurePlannerGroup());
        break;
      }
      noteTouchedFile(event.call);
      addToolRow(event.call.name, event.call.arguments, event.call.id, null, event.stepIndex);
      break;
    }

    case 'tool_end': {
      let entry = ui.toolGroup?.rows.get(event.call.id);
      if (!entry && ui.subagentGroups) {
        for (const grupo of ui.subagentGroups.values()) {
          entry = grupo.rows.get(event.call.id);
          if (entry) break;
        }
      }
      // El marcador de imagen se retira siempre, haya imagen o error.
      document.querySelector('[data-image-loading]')?.remove();

      if (entry) {
        entry.row.classList.remove('is-running');
        entry.row.classList.add(event.isError ? 'is-error' : 'is-done');

        if (event.call?.name === 'generate_image') {
          pintarImagenGenerada(event.content);
        }

        // La cabecera muestra la orden que la herramienta declara haber hecho.
        if (event.command && entry.cmd) {
          entry.cmd.replaceChildren();
          const p = document.createElement('span');
          p.className = 'work-row__prompt';
          p.textContent = '$';
          entry.cmd.append(p, document.createTextNode(String(event.command)));
        }

        entry.out.replaceChildren(renderToolOutput(entry.name, event.content ?? '', event.isError));
        añadirBotonDeshacer(entry.row);
      }
      break;
    }

    case 'error': {
      const bubble = ui.streamingEl ?? addAssistantMessage();
      bubble.classList.add('is-error');
      bubble.textContent = `Error: ${event.message}`;
      break;
    }

    case 'busy':
      setBusy(event.busy);
      break;

    case 'session_title': {
      // El título semántico llega después de «final»: se refresca la lista.
      void refreshConversations();
      break;
    }

    case 'final':
      if (event.sessionId) {
        ui.activeConversation = event.sessionId;
        renderPaneTitle();
      }
      hideLoading();
      ui.lastAssistantText = ui.streamingText;
      ui.streamingEl = null;
      ui.streamingText = '';
      finishToolGroup();
      playChime();
      showFinalNotice(event);
      addMessageToolbar(event.keepCount, ui.lastAssistantText ?? '');
      void addTurnReviewCard();
      refreshConversations();
      // Si había mensajes en cola, se envía el siguiente.
      if (ui.queue.length > 0) {
        const next = ui.queue.shift();
        els.input.value = next;
        setTimeout(() => {
          send();
        }, 60);
      }
      break;

    default:
      break;
  }
}

/**
 * Entrega los despertares acumulados, de uno en uno.
 *
 * Se llama al cerrar un turno: si el usuario estaba escribiendo cuando una tarea
 * terminó, su resultado se inyecta aquí en vez de perderse.
 */
function entregarDespertares() {
  if (ui.busy || ui.despertaresPendientes.length === 0) return;

  const texto = ui.despertaresPendientes.shift();
  addNotice('Una tarea de fondo terminó. El agente continúa.', 'ok');
  window.api.send({ text: texto }).catch(() => {});
}

function setBusy(busy) {
  ui.busy = busy;
  els.input.placeholder = busy
    ? 'El agente está trabajando…'
    : 'Ask anything, @ to mention, / for actions';

  if (!busy) {
    // Un turno acaba de cerrarse: si quedaban despertares, entran ahora.
    setTimeout(() => entregarDespertares(), 0);
  }

  if (busy) {
    ui.toolGroup = null;
    ui.subagentGroups = new Map();
    ui.plannerGroup = null;
    ui.reasoningEl = null;
    ui.reasoningText = '';
    showLoading();
  } else {
    hideLoading();
  }

  setSendMode(busy);
  updateSendState();
}

/**
 * Traduce las herramientas usadas a una frase corta, como la suya:
 * «Explored files, ran commands, edited file».
 *
 * Se agrupa por verbo y se respeta el orden en que aparecieron, para que la frase
 * cuente la historia del turno y no una lista alfabética.
 */
function resumirHerramientas(nombres) {
  const VERBOS = [
    { plural: 'explored files', singular: 'explored file', tools: ['read_file', 'view_code_item', 'list_directory', 'search_files', 'search_code'] },
    { plural: 'ran commands', singular: 'ran command', tools: ['run_command', 'run_tests', 'command_status', 'manage_task'] },
    { plural: 'edited files', singular: 'edited file', tools: ['edit_file', 'write_file'] },
    { plural: 'generated images', singular: 'generated image', tools: ['generate_image'] },
    { plural: 'searched the web', singular: 'searched the web', tools: ['search_web', 'fetch_url', 'open_url'] },
    { plural: 'used the browser', singular: 'used the browser', tools: ['browser_open', 'browser_read', 'browser_click', 'browser_eval'] },
    { plural: 'delegated tasks', singular: 'delegated a task', tools: ['invoke_subagent', 'browser_task', 'define_subagent', 'manage_subagent'] },
    { plural: 'presented a plan', singular: 'presented a plan', tools: ['present_plan', 'exit_plan_mode'] },
    { plural: 'reviewed the plan', singular: 'reviewed the plan', tools: ['enter_plan_mode'] },
    { plural: 'asked a question', singular: 'asked a question', tools: ['ask_user_question'] },
    { plural: 'used memory', singular: 'used memory', tools: ['memory'] },
    { plural: 'read a skill', singular: 'read a skill', tools: ['skill'] },
    { plural: 'ran a workflow', singular: 'ran a workflow', tools: ['run_workflow'] },
    { plural: 'ran extension code', singular: 'ran extension code', tools: ['run_extension_code'] },
    { plural: 'scheduled a reminder', singular: 'scheduled a reminder', tools: ['notify_user'] },
  ];

  // Cuenta por tipo: Antigravity dice «Explored file» con una lectura y
  // «Explored files» con varias.
  const cuenta = new Map();
  for (const nombre of nombres) {
    const verbo = VERBOS.find((v) => v.tools.includes(nombre));
    if (!verbo) continue;
    cuenta.set(verbo, (cuenta.get(verbo) ?? 0) + 1);
  }

  const vistos = [];
  for (const [verbo, veces] of cuenta) {
    vistos.push(veces === 1 ? verbo.singular : verbo.plural);
  }

  if (vistos.length === 0) return 'Ran commands';

  // Primera en mayúscula, el resto en minúscula, como en su interfaz.
  const [primera, ...resto] = vistos;
  const frase = [primera.charAt(0).toUpperCase() + primera.slice(1), ...resto].join(', ');
  return frase;
}

/** Cierra el grupo de trabajo con el tiempo total, como Antigravity. */
function finishToolGroup() {
  finishReasoningBlock();

  const wrapper = ui.workWrapper;
  const group = ui.toolGroup;
  if (!wrapper && !group) return;

  const started = wrapper?.startedAt ?? group.startedAt;
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
  const label = wrapper?.label ?? group.label;
  label.textContent = `Worked for ${seconds}s`;

  // El resumen queda desplegado; los bloques internos ya nacen cerrados.
  const header = wrapper?.header ?? group.header;
  header.setAttribute('aria-expanded', 'true');
  (wrapper?.wrap ?? group.wrap).classList.remove('is-collapsed');

  if (group?.inner) {
    const nombres = [...group.rows.values()].map((fila) => fila.name);
    group.inner.label.textContent = resumirHerramientas(nombres);
    group.inner.header.setAttribute('aria-expanded', 'false');
    group.inner.body.hidden = true;
  }

  ui.workWrapper = null;
  ui.toolGroup = null;
  ui.subagentGroups = new Map();
  ui.plannerGroup = null;
  ui.reasoningEl = null;
  ui.reasoningText = '';
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

async function send() {
  const text = els.input.value.trim();
  if (text.length === 0 || ui.busy) return;

  if (els.threadEmpty) els.threadEmpty.remove();

  els.input.value = '';
  autoGrow();
  updateSendState();

  hideCommandPalette();
  hideMentionPalette();

  const mentions = collectMentions(text);
  addUserMessage(text);

  const result = await window.api.sendPrompt({
    text,
    mentions,
    effort: ui.effort,
    preset: ui.prefs.permissionPreset ?? 'Turbo',
  });
  if (!result.ok && result.error) {
    const bubble = addAssistantMessage();
    bubble.classList.add('is-error');
    bubble.textContent = `Error: ${result.error}`;
  }
  ui.streamingEl = null;
  ui.streamingText = '';
}

// ---------------------------------------------------------------------------
// Conversaciones guardadas
// ---------------------------------------------------------------------------

async function openConversation(id) {
  // Si la vista de Automations está abierta, se cierra: ocupa el área del hilo.
  closeAutomations();
  try {
    const loaded = await window.api.loadSession(id);
    ui.activeConversation = loaded.meta.id;
  renderPaneTitle();

    clearThread();

    // Los mensajes `tool` no guardan argumentos; la llamada que los originó
    // está en el mensaje `assistant` anterior. Se usan para que el historial
    // pinte el comando y no un genérico «Ran command».
    const llamadasPorId = new Map();
    for (const message of loaded.messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) continue;
      for (const llamada of message.toolCalls) {
        if (llamada?.id) llamadasPorId.set(llamada.id, llamada);
      }
    }

    let indiceDeMensaje = 0;
    for (const message of loaded.messages) {
      indiceDeMensaje += 1;
      if (message.role === 'user') {
        addUserMessage(message.content);
      } else if (message.role === 'assistant' && message.content) {
        const wrap = document.createElement('div');
        wrap.className = 'msg msg--assistant';
        const bubble = document.createElement('div');
        bubble.className = 'msg__bubble msg__bubble--md';
        bubble.innerHTML = window.Markdown.render(message.content);
        wrap.append(bubble);
        els.threadInner.append(wrap);

        // El pie también en el historial: hora, copiar y votos.
        const cuando = message.createdAt ?? loaded.meta.updatedAt ?? loaded.meta.createdAt;
        addMessageToolbar(
          undefined,
          message.content,
          cuando ? relativeTime(cuando) : undefined,
        );
      } else if (message.role === 'tool') {
        // Una fila de historial ya está terminada: se pinta con su salida y sin
        // dejarla marcada como «en ejecución».
        // El callId sintético hace que la fila quede registrada en el grupo, que es
        // de donde sale la línea de resumen del turno.
        const llamada = message.toolCallId ? llamadasPorId.get(message.toolCallId) : null;
        const fila = addToolRow(
          llamada?.name ?? message.name ?? 'tool',
          llamada?.arguments ?? {},
          `hist-${indiceDeMensaje}`,
        );
        if (fila) {
          fila.row.classList.remove('is-running');
          fila.row.classList.add('is-done');
          fila.out.replaceChildren(renderToolOutput(fila.name, message.content ?? '', false));
          // El historial solo guarda «Guardada en …»: la imagen se repinta aquí.
          if (fila.name === 'generate_image') pintarImagenGenerada(message.content);
        }
      }
    }

    // Sin esto, una conversación guardada se queda en «Working…» para siempre.
    finishToolGroup();

    renderNavigator();
    scrollToBottom();
    refreshConversations();
  } catch (error) {
    console.error(error);
  }
}

async function newConversation() {
  // Antes solo se limpiaba la UI: el motor seguía con `state.sessionId` y el
  // mensaje nuevo se añadía a la conversación anterior. Hay que resetearlo.
  if (ui.busy) return;
  try {
    const resultado = await window.api.newSession();
    if (resultado && resultado.ok === false) return;
  } catch {
    // sin IPC se mantiene el flujo local
  }
  closeAutomations();
  ui.activeConversation = null;
  renderPaneTitle();
  clearThread();

  const empty = document.createElement('div');
  empty.className = 'thread__empty';
  empty.id = 'thread-empty';
  // Mismo estado vacío que el del HTML: marca de agua + saludo.
  empty.innerHTML =
    '<span class="thread__empty-mark"></span>' +
    '<div class="thread__empty-title">Hola, ¿qué hacemos hoy?</div>';
  els.threadInner.append(empty);

  els.input.focus();
  refreshConversations();
}

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
}

function updateSendState() {
  if (ui.busy) {
    els.send.disabled = false;
    els.send.classList.remove('is-ready');
    return;
  }

  const ready = els.input.value.trim().length > 0;
  els.send.disabled = !ready;
  els.send.classList.toggle('is-ready', ready);
}

// ---------------------------------------------------------------------------
// Proveedores y modelo
// ---------------------------------------------------------------------------

async function loadProviders() {
  try {
    ui.providers = await window.api.listProviders();
  } catch {
    ui.providers = [];
  }
  renderModelLabel();
  renderModelPopover();
  window.SettingsUI?.refresh();
}

function currentProvider() {
  return ui.providers.find((provider) => provider.id === ui.providerId) ?? null;
}

function renderModelLabel() {
  if (ui.model) {
    els.modelLabel.textContent = ui.model;
    return;
  }

  const provider = currentProvider();
  els.modelLabel.textContent = provider ? `${provider.label} · sin modelo` : 'sin modelo';
}

function renderModelPopover() {
  els.modelPopoverBody.replaceChildren();

  const available = ui.providers.filter((provider) => provider.available);

  if (available.length === 0) {
    const note = document.createElement('div');
    note.className = 'popover__note';
    note.textContent =
      'No hay proveedores disponibles. Arranca Ollama en local (ollama serve) o define una clave en el entorno: OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY.';
    els.modelPopoverBody.append(note);
    return;
  }

  for (const provider of available) {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'popover__group-title';
    groupTitle.textContent = provider.label;
    els.modelPopoverBody.append(groupTitle);

    for (const model of provider.models) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'popover__item';
      if (provider.id === ui.providerId && model.id === ui.model) {
        item.classList.add('is-selected');
      }
      item.textContent = model.name;

      item.addEventListener('click', async () => {
        await selectModel(provider.id, model.id);
        hideModelPopover();
      });

      els.modelPopoverBody.append(item);
    }
  }
}

async function selectModel(providerId, modelId) {
  ui.providerId = providerId;
  ui.model = modelId;
  renderModelLabel();
  window.SettingsUI?.refresh();

  try {
    await window.api.setModel({ provider: providerId, model: modelId });
  } catch (error) {
    console.error('No se pudo guardar el modelo:', error);
  }
}

function toggleModelPopover() {
  const isHidden = els.modelPopover.hasAttribute('hidden');
  if (isHidden) {
    renderModelPopover();
    els.modelPopover.removeAttribute('hidden');
  } else {
    hideModelPopover();
  }
}

function hideModelPopover() {
  els.modelPopover.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function openSettings() {
  // Ajustes es un modal sobre el hilo: Automations no debe quedarse detrás.
  closeAutomations();
  window.SettingsUI.open();
}

function closeSettings() {
  window.SettingsUI.close();
}

// ---------------------------------------------------------------------------
// Preferencias aplicadas
// ---------------------------------------------------------------------------

/** Aplica las preferencias que cambian la interfaz. */
function applyPrefs(prefs) {
  if (!prefs) return;
  ui.prefs = { ...ui.prefs, ...prefs };

  // Nivel de esfuerzo del modelo (Low / Medium / High).
  if (typeof ui.prefs.effort === 'string' && ui.prefs.effort) {
    ui.effort = ui.prefs.effort;
    if (els.effortLabel) els.effortLabel.textContent = ui.effort;
  }
  document.documentElement.dataset.contrast =
    ui.prefs.themeContrast === 'Strong' ? 'strong' : 'default';

  // Tema oscuro o claro (afecta a todos los tokens).
  document.documentElement.dataset.theme =
    ui.prefs.theme === 'Light' ? 'light' : 'dark';

  // Colores personalizados del tema oscuro.
  const colors = ui.prefs.themeColors ?? {};
  const root = document.documentElement.style;
  const mapping = {
    background: '--background',
    foreground: '--foreground',
    accent: '--primary',
  };

  for (const [key, variable] of Object.entries(mapping)) {
    const value = colors[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      root.setProperty(variable, value.trim());
    } else {
      root.removeProperty(variable);
    }
  }
}

/** Carga herramientas, skills y estado del control remoto. */
async function loadCatalogues() {
  try {
    ui.tools = await window.api.listTools();
  } catch {
    ui.tools = [];
  }
  try {
    ui.skills = await window.api.listSkills();
  } catch {
    ui.skills = [];
  }
  try {
    ui.remote = await window.api.remoteStatus();
  } catch {
    ui.remote = { running: false, url: null };
  }
}

/** Arranca o detiene el servidor de control remoto. */
async function toggleRemote() {
  try {
    if (ui.remote.running) {
      await window.api.remoteStop();
    } else {
      await window.api.remoteStart();
    }
  } catch (error) {
    console.error('Control remoto:', error);
  }
  ui.remote = await window.api.remoteStatus();
  window.SettingsUI.refresh();
}

/** Pitido de fin de turno, con el volumen configurado. */
function playChime() {
  if (ui.prefs.sounds !== true) return;

  const volume = Math.max(0, Math.min(100, Number(ui.prefs.volume ?? 100))) / 100;
  if (volume === 0) return;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(volume * 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);

    osc.addEventListener('ended', () => ctx.close().catch(() => {}));
  } catch {
    // el audio es best-effort
  }
}

// ---------------------------------------------------------------------------
// Menciones @
// ---------------------------------------------------------------------------

/** Carga el índice de ficheros del workspace (una vez por workspace). */
async function loadFileIndex() {
  try {
    ui.fileIndex = await window.api.indexFiles();
  } catch {
    ui.fileIndex = [];
  }
  renderFileTree();
}

/** Detecta si el cursor está escribiendo una mención `@`. */
function currentMentionQuery() {
  const value = els.input.value;
  const caret = els.input.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');

  if (at === -1) return null;
  // Solo si el @ está al inicio o tras un espacio, y no hay espacio después.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;

  const fragment = before.slice(at + 1);
  if (/\s/.test(fragment)) return null;

  return { at, query: fragment.toLowerCase() };
}

/** Muestra u oculta la paleta de ficheros. */
function updateMentionPalette() {
  const mention = currentMentionQuery();
  if (!mention) {
    hideMentionPalette();
    return;
  }

  const matches = ui.fileIndex
    .filter((path) => path.toLowerCase().includes(mention.query))
    .slice(0, 30);

  ui.mentionMatches = matches;
  ui.mentionIndex = Math.min(ui.mentionIndex, Math.max(0, matches.length - 1));

  if (matches.length === 0) {
    hideMentionPalette();
    return;
  }

  els.mentionPopoverBody.replaceChildren();

  matches.forEach((path, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'popover__item';
    if (index === ui.mentionIndex) item.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'mention__path';
    label.textContent = path;

    item.append(label);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertMention(path);
    });

    els.mentionPopoverBody.append(item);
  });

  els.mentionPopover.removeAttribute('hidden');
}

function hideMentionPalette() {
  els.mentionPopover.setAttribute('hidden', '');
  ui.mentionMatches = [];
  ui.mentionIndex = 0;
}

/** Sustituye el fragmento `@...` por la ruta elegida. */
function insertMention(path) {
  const mention = currentMentionQuery();
  if (!mention) return;

  const value = els.input.value;
  const caret = els.input.selectionStart ?? value.length;
  const next = `${value.slice(0, mention.at)}@${path} ${value.slice(caret)}`;

  els.input.value = next;
  hideMentionPalette();
  autoGrow();
  updateSendState();
  els.input.focus();
}

/** Rutas mencionadas en el texto actual. */
function collectMentions(text) {
  const found = [];
  for (const match of String(text).matchAll(/@([\w./-]+)/g)) {
    const path = match[1];
    if (ui.fileIndex.includes(path) && !found.includes(path)) found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Editor de código (Monaco)
// ---------------------------------------------------------------------------

/** Instancia de Monaco y del editor. */
let monacoEditor = null;
let monacoApi = null;

/** Lenguaje de Monaco según la extensión. */
function monacoLanguage(filePath) {
  const ext = String(filePath).split('.').pop()?.toLowerCase() ?? '';
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}

/** Crea el editor de un grupo (0 = izquierda, 1 = derecha). */
function ensureMonaco(group = 0) {
  if (ui.editors[group]) return ui.editors[group];

  monacoApi = window.MonacoApp?.monaco;
  if (!monacoApi) {
    console.error('Monaco no está disponible');
    return null;
  }

  const contenedor = document.getElementById(group === 0 ? 'editor-monaco' : 'editor-monaco-2');
  if (!contenedor) return null;

  const instancia = monacoApi.editor.create(contenedor, {
    theme: 'agent-dark',
    automaticLayout: true,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    padding: { top: 8, bottom: 8 },
    tabSize: 2,
    wordWrap: 'off',
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });

  instancia.onDidChangeModelContent(() => {
    if (ui.activeGroup !== group) return;
    updateEditorState();
    scheduleLspChange();
  });

  // Al enfocar un grupo, pasa a ser el activo.
  instancia.onDidFocusEditorText(() => {
    if (ui.activeGroup === group) return;
    ui.activeGroup = group;
    const tab = ui.tabs.find((t) => t.group === group && t.path === ui.activeTab);
    if (!tab) {
      const primera = ui.tabs.find((t) => t.group === group);
      if (primera) activateTab(primera.path);
    }
    renderEditorTabs();
  });

  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => saveEditor());
  instancia.addCommand(monacoApi.KeyCode.F12, () => instancia.getAction('editor.action.revealDefinition').run());
  instancia.addCommand(monacoApi.KeyCode.F2, () => instancia.getAction('editor.action.rename').run());
  instancia.addCommand(
    monacoApi.KeyMod.Shift | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF,
    () => instancia.getAction('editor.action.formatDocument').run(),
  );
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Space, () =>
    instancia.getAction('editor.action.triggerSuggest').run(),
  );

  // Buscar y reemplazar dentro del fichero abierto.
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyF, () =>
    instancia.getAction('actions.find').run(),
  );
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyH, () =>
    instancia.getAction('editor.action.startFindReplaceAction').run(),
  );
  instancia.addCommand(monacoApi.KeyCode.F3, () =>
    instancia.getAction('editor.action.nextMatchFindAction').run(),
  );

  ui.editors[group] = instancia;
  if (group === 0) monacoEditor = instancia;

  return instancia;
}

/** Activa o desactiva la vista dividida. */
function toggleSplit(force) {
  const abrir = force ?? !ui.split;
  if (abrir === ui.split) return;

  ui.split = abrir;
  const grupo1 = document.getElementById('editor-group-1');
  if (grupo1) grupo1.hidden = !abrir;

  if (abrir) {
    const derecho = ensureMonaco(1);
    // El fichero activo se queda a la izquierda; el hueco derecho queda libre.
    const activo = ui.tabs.find((t) => t.path === ui.activeTab);
    if (activo) activo.group = 0;
    ui.activeGroup = 1;
    derecho.setModel(null);
  } else {
    // Todo vuelve al grupo 0 y se cierra el editor derecho.
    for (const tab of ui.tabs) tab.group = 0;
    if (ui.editors[1]) {
      ui.editors[1].dispose();
      ui.editors[1] = null;
    }
    ui.activeGroup = 0;
  }

  renderEditorTabs();

  // Si se deshace la división, el activo vuelve al editor izquierdo.
  if (!abrir) {
    const activo = ui.tabs.find((t) => t.path === ui.activeTab);
    if (activo) activateTab(activo.path);
  }

  monacoApi?.editor.remeasureFonts?.();
}

/** Abre un fichero en el editor. */
async function openInEditor(path, linea, columna) {
  toggleEditorPane(true);
  const editor = ensureMonaco();
  if (!editor) {
    addNotice('Monaco no está disponible.', 'error');
    return;
  }

  els.editorPane.hidden = false;

  // Si ya está abierto, solo se activa.
  const abierta = ui.tabs.find((tab) => tab.path === path);
  if (abierta) {
    activateTab(path);
    return;
  }

  try {
    const file = await window.api.readFile(path);
    const language = monacoLanguage(file.path);
    const uri = monacoApi.Uri.parse(`inmemory://model/${file.path}`);

    const existente = monacoApi.editor.getModel(uri);
    if (existente) existente.dispose();

    const model = monacoApi.editor.createModel(file.content, language, uri);

    ui.tabs.push({
      path: file.path,
      model,
      original: file.content,
      language,
      viewState: null,
      lsp: null,
      group: ui.split ? ui.activeGroup : 0,
    });

    activateTab(file.path);

    // LSP propio solo para lenguajes que Monaco no cubre.
    const tab = ui.tabs.find((t) => t.path === file.path);
    if (tab && !['javascript', 'typescript', 'json', 'css', 'html'].includes(language)) {
      const opened = await window.api.lspOpen({ path: file.path, content: file.content });
      tab.lsp = opened.ok ? opened.language : 'sin LSP';
      if (ui.activeTab === file.path) els.editorLsp.textContent = tab.lsp;
    } else if (tab) {
      tab.lsp = language;
    }
  } catch (error) {
    addNotice(`No se pudo abrir ${path}: ${error.message ?? error}`, 'error');
  }

  // Salto a la coincidencia: centrar la línea y marcar el carácter.
  if (typeof linea === 'number' && linea > 0) {
    const editor = ensureMonaco();
    if (editor) {
      editor.revealLineInCenter(linea);
      editor.setPosition({ lineNumber: linea, column: columna ?? 1 });
      editor.focus();
    }
  }
}

/* ===================== Quick fixes del LSP ===================== */

let menuQuickFixes = null;

/** Cierra el menú de quick fixes si está abierto. */
function cerrarQuickFixes() {
  if (menuQuickFixes) {
    menuQuickFixes.remove();
    menuQuickFixes = null;
  }
}

/**
 * Muestra las acciones de código disponibles en la línea del cursor.
 * Se ancla al indicador de problemas del editor.
 */
async function mostrarQuickFixes() {
  cerrarQuickFixes();

  const editor = ensureMonaco();
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (!editor || !tab) return;

  const posicion = editor.getPosition();
  if (!posicion) return;

  const rango = {
    start: { line: posicion.lineNumber - 1, character: 0 },
    end: { line: posicion.lineNumber - 1, character: 999 },
  };

  let respuesta;
  try {
    respuesta = await window.api.lspCodeActions({ path: tab.path, range: rango, line: rango.start.line });
  } catch (error) {
    addNotice(`Sin quick fixes: ${error.message ?? error}`, 'error');
    return;
  }

  if (!respuesta || !respuesta.ok) {
    addNotice(respuesta?.error ?? 'Sin servidor LSP para este fichero.', 'error');
    return;
  }

  if (respuesta.acciones.length === 0) {
    addNotice('No hay quick fixes en esta línea.', 'ok');
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'quickfix-menu';

  const cabecera = document.createElement('div');
  cabecera.className = 'quickfix-menu__head';
  cabecera.textContent = `L${posicion.lineNumber}`;
  menu.append(cabecera);

  respuesta.acciones.forEach((accion, indice) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'quickfix-menu__item';
    boton.textContent = accion.titulo;
    if (accion.kind) boton.title = accion.kind;

    boton.addEventListener('click', async () => {
      cerrarQuickFixes();
      try {
        const r = await window.api.lspApplyAction({ path: tab.path, indice, range: rango });
        if (r && r.ok) {
          addNotice(
            r.comando ? 'Acción aplicada.' : `Aplicado: ${r.ficheros} fichero${r.ficheros === 1 ? '' : 's'}.`,
            'ok',
          );
          // Recargar el modelo desde disco: el cambio lo hizo el proceso principal.
          await openInEditor(tab.path, posicion.lineNumber, posicion.column);
        } else {
          addNotice(r?.error ?? 'No se pudo aplicar.', 'error');
        }
      } catch (error) {
        addNotice(`No se pudo aplicar: ${error.message ?? error}`, 'error');
      }
    });

    menu.append(boton);
  });

  document.body.append(menu);
  menuQuickFixes = menu;

  // Anclar bajo el indicador de problemas del editor.
  const ancla = els.editorLsp ?? editor.getDomNode();
  const caja = ancla.getBoundingClientRect();
  const alto = menu.getBoundingClientRect().height;
  menu.style.left = `${Math.round(Math.max(8, caja.left - 40))}px`;
  menu.style.top = `${Math.round(Math.min(window.innerHeight - alto - 8, caja.bottom + 6))}px`;
}

/** Engancha el indicador de problemas al menú de quick fixes. */
function initQuickFixes() {
  if (els.editorLsp) {
    els.editorLsp.style.cursor = 'pointer';
    els.editorLsp.addEventListener('click', () => void mostrarQuickFixes());
  }

  document.addEventListener('keydown', (event) => {
    // Ctrl+. es el atajo habitual de «acciones de código».
    if ((event.ctrlKey || event.metaKey) && event.key === '.') {
      event.preventDefault();
      void mostrarQuickFixes();
    }
    if (event.key === 'Escape') cerrarQuickFixes();
  });

  document.addEventListener('click', (event) => {
    if (menuQuickFixes && !menuQuickFixes.contains(event.target) && event.target !== els.editorLsp) {
      cerrarQuickFixes();
    }
  });
}

/* ===================== Buscar y reemplazar ===================== */

const buscarUi = { abierto: false, opciones: { sensibleAMayusculas: false, palabraCompleta: false, regex: false }, ultimo: null, temporizador: null };

/** Abre o cierra el panel de búsqueda. */
function toggleSearchPanel(abrir) {
  const modal = document.getElementById('search-modal');
  if (!modal) return;

  buscarUi.abierto = abrir ?? !buscarUi.abierto;
  modal.hidden = !buscarUi.abierto;

  if (buscarUi.abierto) {
    const input = document.getElementById('search-input');
    input.focus();
    input.select();
    if (input.value.trim()) ejecutarBusqueda();
  }
}

/** Lee las opciones marcadas en el panel. */
function opcionesDeBusqueda() {
  return {
    sensibleAMayusculas: document.getElementById('search-case').classList.contains('is-active'),
    palabraCompleta: document.getElementById('search-word').classList.contains('is-active'),
    regex: document.getElementById('search-regex').classList.contains('is-active'),
  };
}

/** Pinta las coincidencias agrupadas por fichero. */
function pintarResultados(datos) {
  const lista = document.getElementById('search-results');
  const estado = document.getElementById('search-status');
  lista.replaceChildren();

  if (!datos || datos.resultados.length === 0) {
    estado.textContent = document.getElementById('search-input').value.trim()
      ? 'Sin resultados'
      : '';
    return;
  }

  estado.textContent = `${datos.resultados.length} coincidencia${datos.resultados.length === 1 ? '' : 's'} en ${datos.ficheros} fichero${datos.ficheros === 1 ? '' : 's'}${datos.truncado ? ' (truncado)' : ''}`;

  const porFichero = new Map();
  for (const r of datos.resultados) {
    if (!porFichero.has(r.ruta)) porFichero.set(r.ruta, []);
    porFichero.get(r.ruta).push(r);
  }

  for (const [ruta, hits] of porFichero) {
    const bloque = document.createElement('div');
    bloque.className = 'search-file';

    const cabecera = document.createElement('div');
    cabecera.className = 'search-file__head';
    const nombre = document.createElement('span');
    nombre.textContent = ruta;
    const cuenta = document.createElement('span');
    cuenta.className = 'search-file__count';
    cuenta.textContent = String(hits.length);
    cabecera.append(nombre, cuenta);
    bloque.append(cabecera);

    for (const hit of hits.slice(0, 50)) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'search-hit';

      const numero = document.createElement('span');
      numero.className = 'search-hit__line';
      numero.textContent = String(hit.linea);

      const texto = document.createElement('span');
      // Marcar la coincidencia dentro de la línea.
      const antes = hit.texto.slice(0, Math.max(0, hit.columna - 1));
      const desde = Math.max(0, hit.columna - 1);
      const marca = document.createElement('span');
      marca.className = 'search-hit__mark';
      marca.textContent = hit.coincidencia;
      texto.append(
        document.createTextNode(antes),
        marca,
        document.createTextNode(hit.texto.slice(desde + hit.coincidencia.length)),
      );

      boton.append(numero, texto);
      boton.addEventListener('click', () => {
        toggleSearchPanel(false);
        openInEditor(hit.ruta, hit.linea, hit.columna);
      });
      bloque.append(boton);
    }

    lista.append(bloque);
  }
}

/** Lanza la búsqueda en el proyecto. */
async function ejecutarBusqueda() {
  const consulta = document.getElementById('search-input').value;
  if (!consulta.trim()) {
    pintarResultados(null);
    return;
  }

  buscarUi.opciones = opcionesDeBusqueda();
  try {
    const datos = await window.api.searchRun({ consulta, opciones: buscarUi.opciones });
    buscarUi.ultimo = { consulta, datos };
    pintarResultados(datos);
  } catch (error) {
    document.getElementById('search-status').textContent = `Error: ${error.message ?? error}`;
  }
}

/** Reemplaza en todo el proyecto y refresca. */
async function reemplazarTodo() {
  const consulta = document.getElementById('search-input').value;
  const reemplazo = document.getElementById('search-replace').value;
  if (!consulta.trim()) return;

  try {
    const r = await window.api.searchReplace({
      consulta,
      reemplazo,
      opciones: opcionesDeBusqueda(),
    });
    addNotice(`Reemplazadas ${r.cambios} coincidencias en ${r.ficheros} ficheros.`, 'ok');
    await ejecutarBusqueda();
  } catch (error) {
    addNotice(`No se pudo reemplazar: ${error.message ?? error}`, 'error');
  }
}

/** Conecta el panel una sola vez. */
function initSearchPanel() {
  const modal = document.getElementById('search-modal');
  if (!modal) return;

  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    clearTimeout(buscarUi.temporizador);
    buscarUi.temporizador = setTimeout(ejecutarBusqueda, 180);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(buscarUi.temporizador);
      ejecutarBusqueda();
    }
    if (event.key === 'Escape') toggleSearchPanel(false);
  });

  for (const id of ['search-case', 'search-word', 'search-regex']) {
    const boton = document.getElementById(id);
    boton.addEventListener('click', () => {
      boton.classList.toggle('is-active');
      ejecutarBusqueda();
    });
  }

  document.getElementById('search-close').addEventListener('click', () => toggleSearchPanel(false));
  document.getElementById('search-replace-all').addEventListener('click', reemplazarTodo);
  modal.querySelector('[data-close-search]').addEventListener('click', () => toggleSearchPanel(false));

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleSearchPanel(true);
    }
  });
}

/** Activa una pestaña ya abierta y restaura su vista. */
function activateTab(path) {
  const tab = ui.tabs.find((t) => t.path === path);
  if (!tab) return;

  const group = ui.split ? (tab.group ?? 0) : 0;
  const editor = ensureMonaco(group);
  if (!editor) return;

  // Guarda la vista del que se abandona, en su propio grupo.
  const anterior = ui.tabs.find((t) => t.path === ui.activeTab && t.group === ui.activeGroup);
  const editorAnterior = ui.editors[ui.activeGroup];
  if (anterior && editorAnterior && editorAnterior.getModel() === anterior.model) {
    anterior.viewState = editorAnterior.saveViewState();
  }

  ui.activeGroup = group;
  ui.activeTab = path;
  ui.editorPath = path;
  ui.editorOriginal = tab.original;
  monacoEditor = editor;

  editor.setModel(tab.model);
  if (tab.viewState) editor.restoreViewState(tab.viewState);

  els.editorPath.textContent = path;
  els.editorLsp.textContent = tab.lsp ?? tab.language;
  updateEditorState();
  renderEditorTabs();
  editor.focus();
}

/** Cierra una pestaña; si era la activa, pasa a la vecina. */
function closeTab(path) {
  const index = ui.tabs.findIndex((tab) => tab.path === path);
  if (index < 0) return;

  const [cerrada] = ui.tabs.splice(index, 1);
  cerrada.model.dispose();

  if (ui.activeTab === path) {
    const vecina = ui.tabs[index] ?? ui.tabs[index - 1] ?? null;
    ui.activeTab = null;
    ui.editorPath = null;
    if (vecina) activateTab(vecina.path);
    else {
      ensureMonaco(0)?.setModel(null);
      if (ui.editors[1]) ui.editors[1].setModel(null);
      els.editorPath.textContent = '';
      els.editorLsp.textContent = '';
      els.editorState.textContent = '';
    }
  }

  renderEditorTabs();
}

/** Cierra todas las pestañas y oculta el panel. */
function closeEditor() {
  for (const tab of ui.tabs) tab.model.dispose();
  ui.tabs = [];
  ui.activeTab = null;
  ui.editorPath = null;
  ui.editorOriginal = '';
  for (const editor of ui.editors) editor?.setModel(null);
  els.editorPane.hidden = true;
  renderEditorTabs();
}

function renderEditorTabs() {
  els.editorTabs.replaceChildren();

  const newtab = document.getElementById('newtab-view');
  const monaco = document.getElementById('editor-monaco');
  const status = document.querySelector('.editor__status');

  // Sin pestañas: vista de nueva pestaña, como su panel auxiliar.
  if (ui.tabs.length === 0) {
    newtab?.removeAttribute('hidden');
    if (monaco) monaco.style.display = 'none';
    if (status) status.style.display = 'none';
    els.editorTabs.append(makeNewTabButton());
    els.editorTabs.append(makeSplitButton());
    return;
  }

  newtab?.setAttribute('hidden', '');
  if (monaco) monaco.style.display = '';
  if (status) status.style.display = '';

  for (const tab of ui.tabs) {
    const el = document.createElement('div');
    const activa = tab.path === ui.activeTab && (tab.group ?? 0) === ui.activeGroup;
    el.className = activa ? 'editor__tab is-active' : 'editor__tab';
    if (ui.split && tab.group === 1) el.classList.add('is-right');
    el.title = tab.path;
    el.addEventListener('click', () => activateTab(tab.path));

    const name = document.createElement('span');
    name.textContent = basename(tab.path);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'editor__tab-close';
    close.innerHTML = window.Icon('close', 12);
    close.title = 'Cerrar';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    el.append(name, close);
    els.editorTabs.append(el);
  }

  els.editorTabs.append(makeNewTabButton());
  els.editorTabs.append(makeSplitButton());
}

/** Botón de vista dividida, a la derecha de la tira. */
function makeSplitButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = ui.split ? 'editor__new-tab is-active' : 'editor__new-tab';
  btn.setAttribute('aria-label', 'Split Editor');
  btn.title = 'Dividir editor';
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">' +
    '<path d="M2 2h5v12H2zM9 2h5v12H9z" opacity="0.9"/></svg>';
  btn.style.marginLeft = 'auto';
  btn.addEventListener('click', () => toggleSplit());
  return btn;
}

/** Botón «+» de la tira de pestañas. */
function makeNewTabButton() {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'editor__new-tab';
  add.setAttribute('aria-label', 'New Tab');
  add.innerHTML = window.Icon('plus', 14);
  add.addEventListener('click', () => {
    window.api
      .openFileDialog()
      .then((filePath) => {
        if (filePath) openInEditor(filePath);
      })
      .catch(() => {});
  });
  return add;
}

/** Actualiza el estado guardado/sin guardar. */
function updateEditorState() {
  if (!monacoEditor || !ui.editorPath) return;

  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  const dirty = monacoEditor.getValue() !== (tab?.original ?? ui.editorOriginal);
  els.editorState.textContent = dirty ? 'sin guardar' : 'guardado';
  els.editorState.classList.toggle('is-dirty', dirty);
}

/** Avisa al LSP propio con retardo. */
function scheduleLspChange() {
  if (!ui.editorPath || !monacoEditor) return;

  const language = monacoLanguage(ui.editorPath);
  if (['javascript', 'typescript', 'json', 'css', 'html'].includes(language)) return;

  if (ui.lspChangeTimer) clearTimeout(ui.lspChangeTimer);
  ui.lspChangeTimer = setTimeout(() => {
    window.api.lspChange({ path: ui.editorPath, content: monacoEditor.getValue() }).catch(() => {});
  }, 500);
}

/** Guarda el fichero abierto. */
async function saveEditor() {
  if (!ui.editorPath || !monacoEditor) return;

  try {
    await window.api.writeFile(ui.editorPath, monacoEditor.getValue());

    // El original vive en la pestaña: así el estado «sin guardar» es por fichero.
    const tab = ui.tabs.find((t) => t.path === ui.activeTab);
    if (tab) tab.original = monacoEditor.getValue();
    ui.editorOriginal = monacoEditor.getValue();
    updateEditorState();
    renderEditorTabs();
  } catch (error) {
    addNotice(`No se pudo guardar: ${error.message ?? error}`, 'error');
  }
}

/** Pinta los diagnósticos del LSP propio como marcadores de Monaco. */
function renderDiagnostics() {
  if (!monacoEditor || !monacoApi) return;

  const model = monacoEditor.getModel();
  if (!model) return;

  if (!ui.diagnostics || ui.diagnostics.length === 0) {
    monacoApi.editor.setModelMarkers(model, 'lsp', []);
    els.editorLsp.classList.remove('has-errors');
    return;
  }

  const markers = ui.diagnostics.map((diagnostic) => ({
    severity:
      diagnostic.severity === 1
        ? monacoApi.MarkerSeverity.Error
        : monacoApi.MarkerSeverity.Warning,
    message: diagnostic.message ?? '',
    startLineNumber: (diagnostic.range?.start?.line ?? 0) + 1,
    startColumn: (diagnostic.range?.start?.character ?? 0) + 1,
    endLineNumber: (diagnostic.range?.end?.line ?? 0) + 1,
    endColumn: (diagnostic.range?.end?.character ?? 0) + 1,
  }));

  monacoApi.editor.setModelMarkers(model, 'lsp', markers);

  els.editorLsp.textContent = `${markers.length} ${markers.length === 1 ? 'problema' : 'problemas'}`;
  els.editorLsp.classList.add('has-errors');
  els.editorLsp.title = ui.diagnostics
    .slice(0, 5)
    .map((d) => `L${(d.range?.start?.line ?? 0) + 1}: ${d.message}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Explorador de ficheros
// ---------------------------------------------------------------------------

/** Construye un árbol anidado a partir de rutas planas. */
function buildTree(paths) {
  const root = { name: '', dirs: new Map(), files: [] };

  for (const path of paths) {
    const parts = String(path).split('/');
    let node = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }

    node.files.push({ name: parts[parts.length - 1], path });
  }

  return root;
}

/** Pinta el árbol de ficheros en el panel. */
function renderFileTree() {
  const container = $('file-tree');
  if (!container) return;

  container.replaceChildren();

  if (ui.fileIndex.length === 0) {
    container.append(rowText('Sin ficheros'));
    return;
  }

  const tree = buildTree(ui.fileIndex);
  const expanded = ui.treeExpanded ?? new Set(['src', 'electron', 'renderer']);

  const renderNode = (node, prefix, depth) => {
    // Carpetas primero, ordenadas.
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const key = prefix.length > 0 ? `${prefix}/${dir.name}` : dir.name;
      const isOpen = expanded.has(key);

      const row = document.createElement('div');
      row.className = 'tree__row tree__row--dir';
      row.style.paddingLeft = `${depth * 10}px`;

      const chevron = document.createElement('span');
      chevron.className = 'tree__chevron';
      chevron.innerHTML = window.Icon('chevron', 12);
      chevron.style.transform = isOpen ? 'rotate(90deg)' : 'none';

      const label = document.createElement('span');
      label.className = 'tree__label';
      label.textContent = dir.name;

      row.append(chevron, label);
      row.addEventListener('click', () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        ui.treeExpanded = expanded;
        renderFileTree();
      });

      container.append(row);

      if (isOpen) renderNode(dir, key, depth + 1);
    }

    // Ficheros.
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('div');
      row.className = 'tree__row tree__row--file';
      row.style.paddingLeft = `${depth * 10 + 14}px`;
      row.title = file.path;

      const label = document.createElement('span');
      label.className = 'tree__label';
      label.textContent = file.name;

      row.append(label);
      row.addEventListener('click', () => openInEditor(file.path));
      container.append(row);
    }
  };

  renderNode(tree, '', 0);
}

// ---------------------------------------------------------------------------
// Índice de código
// ---------------------------------------------------------------------------

/** Muestra el estado del índice en el panel. */
async function refreshIndexStatus() {
  const el = $('index-status');
  if (!el) return;

  try {
    const status = await window.api.indexStatus();
    el.textContent =
      status.files === 0 ? 'sin construir' : `${status.files} ficheros · ${status.symbols} símbolos`;
  } catch {
    el.textContent = 'no disponible';
  }
}

/** Reconstruye el índice. */
async function rebuildIndex() {
  const el = $('index-status');
  if (el) el.textContent = 'indexando…';

  try {
    const stats = await window.api.indexBuild();
    if (el) el.textContent = `${stats.files} ficheros · ${stats.symbols} símbolos`;
    addNotice(`Índice listo: ${stats.files} ficheros, ${stats.symbols} símbolos.`, 'info');
  } catch (error) {
    if (el) el.textContent = 'error';
    addNotice(`No se pudo indexar: ${error.message ?? error}`, 'error');
  }
}

/** Precalcula embeddings con Ollama. */
async function warmIndex() {
  const el = $('index-status');
  if (el) el.textContent = 'calculando embeddings…';

  try {
    const result = await window.api.indexWarm();
    if (el) el.textContent = `${result.cached} vectores en caché`;
    addNotice(
      result.embedded > 0
        ? `Embeddings: ${result.embedded} nuevos, ${result.skipped} ya en caché.`
        : 'Ollama no respondió: revisa que esté corriendo y que el modelo de embeddings exista.',
      result.embedded > 0 ? 'info' : 'warning',
    );
  } catch (error) {
    if (el) el.textContent = 'error';
    addNotice(`No se pudieron calcular: ${error.message ?? error}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Colores y etiquetas por código de estado de git. */
const GIT_STATUS = {
  M: { label: 'M', title: 'modificado', cls: 'is-modified' },
  A: { label: 'A', title: 'añadido', cls: 'is-added' },
  D: { label: 'D', title: 'borrado', cls: 'is-deleted' },
  R: { label: 'R', title: 'renombrado', cls: 'is-modified' },
  '?': { label: 'U', title: 'sin seguimiento', cls: 'is-untracked' },
};

/** Refresca el estado del repositorio en el panel. */
/** Pinta el estado ahead/behind y si hay conflictos. */
function renderTracking(tracking) {
  const label = document.getElementById('git-tracking');
  const conflict = document.getElementById('git-conflict');
  const conflictText = document.getElementById('git-conflict-text');

  if (label) {
    if (!tracking.remote) {
      label.textContent = 'sin remoto';
    } else if (tracking.ahead === 0 && tracking.behind === 0) {
      label.textContent = 'al día';
    } else {
      const parts = [];
      if (tracking.ahead > 0) parts.push(`↑${tracking.ahead}`);
      if (tracking.behind > 0) parts.push(`↓${tracking.behind}`);
      label.textContent = parts.join(' ');
    }
  }

  if (conflict) {
    const merging = tracking.detached === false && tracking.behind > 0;
    conflict.hidden = !merging;
    if (merging && conflictText) {
      conflictText.textContent = `Hay ${tracking.behind} commit(s) por detrás del remoto.`;
    }
  }
}

async function refreshGit() {
  const branchEl = $('git-branch-select');
  const filesEl = $('git-files');
  if (!branchEl || !filesEl) return;

  let status;
  try {
    status = await window.api.gitStatus();
  } catch {
    status = { ok: false, error: 'git no disponible' };
  }

  if (!status.ok) {
    branchEl.replaceChildren();
    filesEl.replaceChildren();
    void refreshGitLog();
    return;
  }

  // Selector de ramas.
  let branches = [];
  try {
    const result = await window.api.gitBranches();
    branches = result.branches ?? [];
  } catch {
    branches = [];
  }

  branchEl.replaceChildren();
  for (const branch of branches) {
    const option = document.createElement('option');
    option.value = branch.name;
    option.textContent = branch.name;
    if (branch.current) option.selected = true;
    branchEl.append(option);
  }
  if (branches.length === 0) {
    const option = document.createElement('option');
    option.textContent = status.branch ?? '(sin rama)';
    branchEl.append(option);
  }

  // Estado respecto al remoto (ahead / behind).
  let tracking = { ahead: 0, behind: 0, upstream: null, remote: false };
  try {
    tracking = await window.api.gitTracking();
  } catch {
    /* sin remoto */
  }
  renderTracking(tracking);

  filesEl.replaceChildren();

  if (status.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'overview-empty';
    empty.textContent = 'Sin cambios';
    filesEl.append(empty);
    return;
  }

  for (const file of status.files) {
    const meta = GIT_STATUS[file.status] ?? GIT_STATUS.M;

    const row = document.createElement('div');
    row.className = 'git-file';

    const badge = document.createElement('span');
    badge.className = `git-file__badge ${meta.cls}`;
    badge.textContent = meta.label;
    badge.title = meta.title;

    const name = document.createElement('span');
    name.className = 'git-file__name';
    name.textContent = file.path;
    name.title = file.path;

    // Fichero en conflicto: ofrece quedarse con una de las dos versiones.
    if (file.status === 'UU' || file.status === 'AA' || file.status === 'DD' || file.status === 'AU' || file.status === 'UA') {
      const resolve = document.createElement('div');
      resolve.className = 'git-file__resolve';

      for (const side of ['ours', 'theirs']) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = side === 'ours' ? 'Mía' : 'Suya';
        btn.title = side === 'ours' ? 'Quedarse con la versión local' : 'Quedarse con la del remoto';
        btn.addEventListener('click', async (event) => {
          event.stopPropagation();
          await window.api.gitResolve(file.path, side);
          refreshGit();
        });
        resolve.append(btn);
      }

      row.append(badge, name, resolve);
      filesEl.append(row);
      continue;
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'git-file__action';
    action.textContent = file.staged ? '−' : '+';
    action.title = file.staged ? 'Quitar del índice' : 'Añadir al índice';
    action.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (file.staged) await window.api.gitUnstage([file.path]);
      else await window.api.gitStage([file.path]);
      refreshGit();
    });

    row.append(badge, name, action);
    row.title = `${file.path} — clic para ver el diff`;
    row.addEventListener('click', () => openGitDiff(file));
    filesEl.append(row);
  }
}

/** Pinta el historial de commits. */
async function refreshGitLog() {
  const container = $('git-log');
  if (!container) return;

  let result;
  try {
    result = await window.api.gitLog({ limit: 12 });
  } catch {
    result = { ok: false, commits: [] };
  }

  container.replaceChildren();

  if (!result.ok || result.commits.length === 0) {
    container.append(rowText('Sin commits'));
    return;
  }

  for (const commit of result.commits) {
    const row = document.createElement('div');
    row.className = 'git-commit-row';
    row.title = `${commit.hash} · ${commit.author} · ${commit.when}\n${commit.subject}`;

    const hash = document.createElement('span');
    hash.className = 'git-commit-row__hash';
    hash.textContent = commit.hash;

    const subject = document.createElement('span');
    subject.className = 'git-commit-row__subject';
    subject.textContent = commit.subject;

    row.append(hash, subject);
    container.append(row);
  }
}

/** Cambia de rama. */
async function checkoutBranch(branch) {
  const result = await window.api.gitCheckout(branch);
  if (!result.ok) {
    addNotice(`No se pudo cambiar a ${branch}: ${result.error}`, 'error');
    return;
  }
  addNotice(`Rama: ${branch}`, 'info');
  await refreshGit();
  await loadFileIndex();
}

/** Abre el diff de un fichero en el modal, con hunks preparables. */
async function openGitDiff(file) {
  const modal = $('git-diff-modal');
  const body = $('git-diff-body');
  if (!modal || !body) return;

  $('git-diff-title').textContent = file.path;
  $('git-diff-subtitle').textContent = file.staged
    ? 'Cambios en el índice'
    : 'Cambios sin preparar — pulsa + en un bloque para prepararlo';
  body.replaceChildren();
  modal.removeAttribute('hidden');

  let hunks;
  try {
    hunks = await window.api.gitDiffHunks({ path: file.path, staged: file.staged });
  } catch (error) {
    body.append(rowText(error.message ?? 'no se pudo obtener el diff'));
    return;
  }

  if (!hunks.ok) {
    body.append(rowText(hunks.error ?? 'no se pudo obtener el diff'));
    return;
  }

  if (!hunks.hunks || hunks.hunks.length === 0) {
    body.append(rowText('Sin diferencias que mostrar.'));
    return;
  }

  for (const hunk of hunks.hunks) {
    const block = document.createElement('div');
    block.className = 'hunk';

    const bar = document.createElement('div');
    bar.className = 'hunk__bar';

    const label = document.createElement('span');
    label.className = 'hunk__label';
    label.textContent = `${hunk.header}  +${hunk.additions} −${hunk.removals}`;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'hunk__action';
    action.textContent = file.staged ? '−' : '+';
    action.title = file.staged ? 'Quitar del índice' : 'Preparar este bloque';

    action.addEventListener('click', async () => {
      action.disabled = true;

      // Fichero nuevo: se prepara entero con git add.
      const result = hunks.untracked
        ? await window.api.gitStage([file.path])
        : await window.api.gitApplyHunk({
            path: file.path,
            staged: file.staged,
            header: hunks.header,
            patch: hunk.patch,
          });

      if (!result.ok) {
        addNotice(`No se pudo aplicar el bloque: ${result.error}`, 'error');
        action.disabled = false;
        return;
      }

      addNotice(
        file.staged ? 'Bloque quitado del índice.' : 'Bloque preparado en el índice.',
        'info',
      );
      await refreshGit();
      await openGitDiff(file);
    });

    bar.append(label, action);

    const lines = document.createElement('div');
    lines.className = 'hunk__lines';

    for (const line of hunk.preview) {
      if (line.startsWith('@@')) continue;

      const row = document.createElement('div');
      const type = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context';
      row.className = `diff-line diff-line--${type}`;

      const sign = document.createElement('span');
      sign.className = 'diff-line__sign';
      sign.textContent = type === 'add' ? '+' : type === 'remove' ? '−' : ' ';

      const text = document.createElement('span');
      text.className = 'diff-line__text';
      text.textContent = line.slice(1);

      row.append(sign, text);
      lines.append(row);
    }

    block.append(bar, lines);
    body.append(block);
  }
}

function closeGitDiff() {
  const modal = $('git-diff-modal');
  if (modal) modal.setAttribute('hidden', '');
}

/** Hace commit con el mensaje escrito. */
async function commitChanges() {
  const input = $('git-message');
  if (!input) return;

  const message = input.value.trim();
  if (message.length === 0) {
    addNotice('Escribe un mensaje de commit.', 'warning');
    return;
  }

  const result = await window.api.gitCommit(message);
  if (!result.ok) {
    addNotice(`Commit falló: ${result.error}`, 'error');
    return;
  }

  input.value = '';
  addNotice(result.output || 'Commit creado.', 'info');
  refreshGit();
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

/**
 * Convierte códigos ANSI SGR a HTML con colores.
 * Cubre los 16 colores básicos, negrita y reset.
 */
function ansiToHtml(text) {
  const COLORS = [
    '#000000', '#f87171', '#4ade80', '#fbbf24', '#38bdf8', '#c084fc', '#22d3ee', '#cccccc',
    '#666666', '#ff8a8a', '#7ee787', '#ffd166', '#7dd3fc', '#d8b4fe', '#67e8f9', '#ffffff',
  ];

  let html = '';
  let open = false;
  let index = 0;

  const escape = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  while (index < text.length) {
    const esc = text.indexOf('\u001b[', index);
    if (esc === -1) {
      html += escape(text.slice(index));
      break;
    }

    html += escape(text.slice(index, esc));

    const end = text.indexOf('m', esc);
    if (end === -1) break;

    const codes = text.slice(esc + 2, end).split(';').map(Number);
    if (open) {
      html += '</span>';
      open = false;
    }

    for (const code of codes) {
      if (code === 0) continue;
      if (code === 1) {
        html += '<span style="font-weight:600">';
        open = true;
        continue;
      }
      const colorIndex = code >= 30 && code <= 37 ? code - 30 : code >= 90 && code <= 97 ? code - 90 + 8 : -1;
      if (colorIndex >= 0) {
        html += `<span style="color:${COLORS[colorIndex]}">`;
        open = true;
      }
    }

    index = end + 1;
  }

  if (open) html += '</span>';
  return html;
}

/** ¿Estamos en modo PTY interactivo? */
let ptyActive = false;

/** Terminales abiertas: id → { xterm, fit, contenedor, nombre }. */
const terminales = new Map();
let terminalActiva = null;
let contadorTerminales = 0;

/** Tema de xterm, igual en todas las terminales. */
const TEMA_XTERM = {
  background: '#101010',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#264f78',
  black: '#101010',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#38bdf8',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#ff8a8a',
  brightGreen: '#7ee787',
  brightYellow: '#ffd166',
  brightBlue: '#7dd3fc',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

/** Crea una terminal nueva con su propio xterm y su pestaña. */
function crearTerminal(idSugerido) {
  if (!window.XtermApp) return null;

  contadorTerminales += 1;
  const id = idSugerido ?? `terminal-${contadorTerminales}`;
  if (terminales.has(id)) return terminales.get(id);

  const { Terminal, FitAddon } = window.XtermApp;

  // Contenedor propio: las terminales se apilan y solo una se ve.
  const contenedor = document.createElement('div');
  contenedor.className = 'terminal__instance';
  contenedor.dataset.terminal = id;
  contenedor.hidden = true;
  els.terminalXterm.append(contenedor);

  const term = new Terminal({
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.35,
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    theme: TEMA_XTERM,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(contenedor);

  // Teclas → PTY de esta terminal.
  term.onData((data) => {
    window.api.terminalPtyWrite({ id, data });
  });

  // `id` es la clave del mapa y del PTY; `nombre` solo se muestra.
  const entrada = { id, xterm: term, fit, contenedor, nombre: id };

  /*
   * La referencia al observer se guarda en la entrada: un `ResizeObserver` sin
   * referencias fuertes lo recolecta el GC, y entonces el ajuste inicial
   * funciona pero los redimensionados posteriores dejan de llegar.
   */
  entrada.observer = new ResizeObserver(() => ajustarTerminal(id));
  entrada.observer.observe(contenedor);

  terminales.set(id, entrada);
  pintarPestanasTerminal();
  return entrada;
}

/**
 * Ajusta una terminal a su contenedor.
 *
 * Se usa `proposeDimensions()` y se llama a `resize()` directamente en vez de
 * `fit.fit()`: medido en vivo, el addon proponía 202 columnas para 1440 px y
 * después no aplicaba el cambio, dejando la terminal en el tamaño anterior.
 */
function ajustarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada || entrada.contenedor.hidden) return;

  let dims = null;
  try {
    dims = entrada.fit.proposeDimensions();
  } catch {
    dims = null;
  }

  if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
  if (dims.cols < 2 || dims.rows < 1) return;

  try {
    if (entrada.xterm.cols !== dims.cols || entrada.xterm.rows !== dims.rows) {
      entrada.xterm.resize(dims.cols, dims.rows);
    }
    window.api.terminalPtyResize({ id, cols: dims.cols, rows: dims.rows });
  } catch {
    // el contenedor aún no tiene tamaño
  }
}

/** Pinta la lista de terminales de la derecha. */
function renderFilasDeTerminales() {
  const destino = document.getElementById('terminal-rows');
  if (!destino) return;

  destino.replaceChildren();

  for (const [id, entrada] of terminales) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'terminal__row';
    if (id === terminalActiva) {
      fila.classList.add('is-active');
      fila.setAttribute('aria-current', 'true');
    }

    const icono = document.createElement('span');
    icono.className = 'terminal__row-icon';
    icono.innerHTML = window.Icon('terminal', 16);

    const nombre = document.createElement('span');
    nombre.textContent = entrada.nombre;

    fila.append(icono, nombre);
    fila.addEventListener('click', () => activarTerminal(id));
    destino.append(fila);
  }
}

/** Pinta las pestañas y marca la activa. */
function pintarPestanasTerminal() {
  const barra = document.getElementById('terminal-tabs');
  if (!barra) return;

  barra.replaceChildren();

  /*
   * Su barra mezcla vistas y terminales: la primera pestaña es «Open File».
   * Medido en su DOM: pestaña de 28 px con icono y etiqueta, activa si esa vista
   * está abierta.
   */
  const vista = document.createElement('div');
  vista.className = 'terminal__tab';
  vista.dataset.auxView = 'open-file';

  const iconoVista = document.createElement('span');
  iconoVista.className = 'terminal__tab-icon';
  iconoVista.innerHTML = window.Icon('files', 16);

  const etiquetaVista = document.createElement('span');
  etiquetaVista.textContent = 'Open File';

  vista.append(iconoVista, etiquetaVista);
  vista.addEventListener('click', () => void abrirPanelLateral('open-file'));
  barra.append(vista);

  for (const [id, entrada] of terminales) {
    const pestana = document.createElement('div');
    pestana.className = 'terminal__tab';
    pestana.dataset.terminal = id;
    if (id === terminalActiva) pestana.classList.add('is-active');

    const etiqueta = document.createElement('span');
    etiqueta.textContent = entrada.nombre;
    etiqueta.addEventListener('click', () => activarTerminal(id));

    const cerrar = document.createElement('span');
    cerrar.className = 'terminal__tab-close';
    cerrar.textContent = '×';
    cerrar.title = 'Cerrar esta terminal';
    cerrar.addEventListener('click', (event) => {
      event.stopPropagation();
      void cerrarTerminal(id);
    });

    pestana.append(etiqueta, cerrar);
    barra.append(pestana);
  }

  renderOverviewTerminal();
  renderFilasDeTerminales();
}

/** Rellena la vista Terminal del panel de resumen. */
function renderOverviewTerminal() {
  const destino = document.getElementById('overview-terminal');
  if (!destino) return;

  destino.replaceChildren();

  if (terminales.size === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'overview-empty';
    vacio.textContent = 'Sin terminal integrada';
    destino.append(vacio);
    return;
  }

  for (const [id, entrada] of terminales) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'overview-terminal-row';
    if (id === terminalActiva) fila.classList.add('is-active');

    const nombre = document.createElement('span');
    nombre.className = 'overview-terminal-row__name';
    nombre.textContent = entrada.nombre;

    const estado = document.createElement('span');
    estado.className = 'overview-terminal-row__state';
    estado.textContent = id === terminalActiva ? 'activa' : '';

    fila.append(nombre, estado);
    fila.addEventListener('click', () => {
      toggleTerminal(true);
      activarTerminal(id);
    });
    destino.append(fila);
  }
}

/** Muestra una terminal y oculta las demás. */
function activarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada) return;

  terminalActiva = id;

  for (const [otroId, otra] of terminales) {
    otra.contenedor.hidden = otroId !== id;
  }

  pintarPestanasTerminal();

  // Cabecera secundaria: su nombre de shell en 16/24, como en Antigravity.
  const rotulo = document.getElementById('terminal-shell');
  if (rotulo) rotulo.textContent = entrada.nombre;

  // El contenedor acaba de mostrarse: la primera medida puede salir con la
  // maquetación a medias. Se ajusta ahora y se reintenta al asentarse.
  const ajustar = () => {
    ajustarTerminal(id);
    try {
      entrada.xterm.focus();
    } catch {
      // sin foco disponible
    }
  };

  requestAnimationFrame(() => {
    ajustar();
    requestAnimationFrame(ajustar);
  });
  setTimeout(ajustar, 150);
}

/** Cierra una terminal y mata su PTY. */
async function cerrarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada) return;

  try {
    await window.api.terminalPtyKill({ id });
  } catch {
    // el proceso ya no estaba
  }

  try {
    entrada.observer?.disconnect();
  } catch {
    // ya liberado
  }

  try {
    entrada.xterm.dispose();
  } catch {
    // ya liberado
  }

  entrada.contenedor.remove();
  terminales.delete(id);

  if (terminalActiva === id) {
    const siguiente = terminales.keys().next();
    terminalActiva = siguiente.done ? null : siguiente.value;
    if (terminalActiva) activarTerminal(terminalActiva);
  }

  pintarPestanasTerminal();

  // Sin terminales abiertas, se oculta el panel.
  if (terminales.size === 0) {
    els.auxPanel.hidden = true;
    document.querySelector('.body')?.classList.remove('is-terminal-open');
    const boton = $('toggle-terminal');
    if (boton) boton.setAttribute('aria-pressed', 'false');
  }
}

/** Abre una terminal más y la activa. */
async function nuevaTerminal() {
  const entrada = crearTerminal();
  if (!entrada) return;

  await ensurePty(entrada.id);
  activarTerminal(entrada.id);
}

/** Arranca el PTY de una terminal si está disponible. */
async function ensurePty(id) {
  try {
    const status = await window.api.terminalPtyStatus();
    if (!status.available) return null;

    const arrancado = await window.api.terminalStartPty({ id });
    if (!arrancado || !arrancado.ok) return null;

    // Antigravity nombra la pestaña con la shell, no con un índice.
    const shell = arrancado.shell ? String(arrancado.shell).split(/[\\/]/).pop() : null;
    const entrada = terminales.get(id);
    if (shell && entrada) {
      entrada.nombre = shell;
      pintarPestanasTerminal();
    }

    return shell ?? 'pty';
  } catch {
    return null;
  }
}

/** Rellena la vista Review con los cambios del turno en curso. */
async function renderAuxReview() {
  const destino = document.getElementById('aux-view-review');
  if (!destino) return;

  destino.replaceChildren();

  let cambios;
  try {
    cambios = await window.api.turnChanges();
  } catch {
    cambios = null;
  }

  if (!cambios || !cambios.files) {
    const vacio = document.createElement('div');
    vacio.className = 'aux__empty';
    vacio.textContent = 'Sin cambios pendientes de revisar.';
    destino.append(vacio);
    return;
  }

  const resumen = document.createElement('div');
  resumen.className = 'aux__summary';
  resumen.textContent = `${cambios.files} file${cambios.files === 1 ? '' : 's'} changed`;
  const mas = document.createElement('span');
  mas.className = 'aux__add';
  mas.textContent = `+${cambios.additions}`;
  const menos = document.createElement('span');
  menos.className = 'aux__del';
  menos.textContent = `-${cambios.removals}`;
  resumen.append(' ', mas, ' ', menos);
  destino.append(resumen);

  for (const ruta of cambios.paths ?? []) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'aux__file';
    fila.textContent = ruta;
    fila.addEventListener('click', () => {
      cerrarPanelLateral();
      void openInEditor(ruta);
    });
    destino.append(fila);
  }
}

/** Rellena la vista Open File con las pestañas del editor. */
function renderAuxOpenFile() {
  const destino = document.getElementById('aux-view-open-file');
  if (!destino) return;

  destino.replaceChildren();

  if (!ui.tabs || ui.tabs.length === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'aux__empty';
    vacio.textContent = 'Ningún fichero abierto.';
    destino.append(vacio);
    return;
  }

  for (const tab of ui.tabs) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'aux__file';
    if (tab.path === ui.activeTab) fila.classList.add('is-active');

    const nombre = document.createElement('span');
    nombre.className = 'aux__file-name';
    nombre.textContent = tab.path.split(/[\\/]/).pop();

    const carpeta = document.createElement('span');
    carpeta.className = 'aux__file-path';
    carpeta.textContent = tab.path.split(/[\\/]/).slice(0, -1).join('/');

    fila.append(nombre, carpeta);
    fila.addEventListener('click', () => {
      cerrarPanelLateral();
      void openInEditor(tab.path);
    });
    destino.append(fila);
  }
}

/** Muestra una vista del panel lateral y oculta las demás. */
function seleccionarVistaAux(nombre) {
  const panel = els.auxPanel;
  if (!panel) return;

  const lanzador = document.getElementById('aux-launcher');
  const esLanzador = !nombre || nombre === 'launcher';

  if (lanzador) lanzador.hidden = !esLanzador;

  /*
   * En la fila superior solo aparecen las pestañas y sus botones cuando hay una
   * vista abierta; en el lanzador quedan solo los iconos del panel, como el suyo.
   */
  const esTerminal = nombre === 'terminal';
  const tabs = document.getElementById('terminal-tabs');
  if (tabs) tabs.hidden = !esTerminal;

  const add = document.getElementById('terminal-add');
  if (add) add.hidden = !esTerminal;

  const back = document.getElementById('aux-tab-back');
  if (back) back.hidden = esLanzador;

  const kill = document.getElementById('aux-kill');
  if (kill) kill.hidden = !esTerminal;

  for (const vista of panel.querySelectorAll('.aux__view')) {
    vista.hidden = vista.id !== `aux-view-${nombre}`;
  }

  for (const item of panel.querySelectorAll('.aux__item')) {
    item.classList.toggle('is-active', item.dataset.auxView === nombre);
  }

  if (nombre === 'terminal') {
    // La terminal necesita medirse cuando su vista ya es visible.
    if (terminalActiva) activarTerminal(terminalActiva);
  }

  if (nombre === 'review') void renderAuxReview();
  if (nombre === 'open-file') renderAuxOpenFile();
}

/** Abre el panel lateral en una vista concreta. */
async function abrirPanelLateral(vista) {
  const panel = els.auxPanel;
  if (!panel) return;

  panel.hidden = false;
  document.querySelector('.body')?.classList.add('is-terminal-open');
  $('toggle-terminal')?.setAttribute('aria-pressed', 'true');

  seleccionarVistaAux(vista ?? 'launcher');

  if (vista === 'terminal') {
    if (terminales.size === 0) {
      const entrada = crearTerminal();
      if (entrada) {
        ptyActive = Boolean(await ensurePty(entrada.id));
        activarTerminal(entrada.id);
      }
    } else if (terminalActiva) {
      activarTerminal(terminalActiva);
    }
  }
}

/** Cierra el panel lateral. */
function cerrarPanelLateral() {
  if (!els.auxPanel) return;
  els.auxPanel.hidden = true;
  document.querySelector('.body')?.classList.remove('is-terminal-open');
  $('toggle-terminal')?.setAttribute('aria-pressed', 'false');
}

/** Muestra u oculta la terminal. */
async function toggleTerminal(force) {
  const open = force ?? els.auxPanel.hidden;

  if (!open) {
    cerrarPanelLateral();
    return;
  }

  /*
   * El contenedor tiene que estar visible ANTES de crear o ajustar la
   * terminal: `FitAddon` mide el elemento, y sobre un `display: none` se queda
   * en el tamaño por defecto (80x24) sin avisar. Por eso el panel se abre
   * primero y la terminal se crea después.
   */
  const yaHayXterm = Boolean(window.XtermApp);
  els.terminalXterm.hidden = !yaHayXterm;
  els.terminalLegacy.hidden = yaHayXterm;

  await abrirPanelLateral('terminal');

  if (terminales.size === 0) {
    // Sin xterm disponible: se cae al ejecutor de comandos.
    els.terminalXterm.hidden = true;
    els.terminalLegacy.hidden = false;
  }

  // El indicador de directorio es opcional: el panel nuevo no lo tiene.
  if (els.terminalCwd) {
    try {
      els.terminalCwd.textContent = terminales.size > 0 ? 'pty' : await window.api.terminalCwd();
    } catch {
      els.terminalCwd.textContent = '';
    }
  }

  els.terminalInput.placeholder = 'Escribe un comando…';
  if (terminales.size === 0) els.terminalInput.focus();
}

/** Añade texto a la salida de la terminal que corresponda. */
function terminalWrite(text, raw, id) {
  const entrada = id ? terminales.get(id) : terminalActiva ? terminales.get(terminalActiva) : null;

  if (raw && entrada) {
    // xterm interpreta ANSI, secuencias de control y redibujado.
    entrada.xterm.write(text);
    return;
  }

  if (raw) {
    els.terminalOutput.innerHTML += ansiToHtml(text);
  } else {
    els.terminalOutput.textContent += text;
  }
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

/** Envía el comando escrito. */
async function terminalSubmit() {
  const command = els.terminalInput.value;

  if (ptyActive) {
    els.terminalInput.value = '';
    await window.api.terminalPtyWrite(`${command}\r`);
    return;
  }

  const trimmed = command.trim();
  if (trimmed.length === 0) return;

  els.terminalInput.value = '';
  terminalWrite(`$ ${trimmed}\n`);

  const result = await window.api.terminalRun(trimmed);
  if (!result.ok && result.error) {
    terminalWrite(`${result.error}\n`);
  }
}

// ---------------------------------------------------------------------------
// Paleta de comandos
// ---------------------------------------------------------------------------

/** Muestra u oculta la paleta según lo escrito en el composer. */
function updateCommandPalette() {
  const value = els.input.value;

  if (!value.startsWith('/') || value.includes('\n')) {
    hideCommandPalette();
    return;
  }

  const query = value.slice(1).split(' ')[0].toLowerCase();
  ui.commandMatches = COMMANDS.filter((cmd) => cmd.id.startsWith(query));
  ui.commandIndex = Math.min(ui.commandIndex, Math.max(0, ui.commandMatches.length - 1));

  if (ui.commandMatches.length === 0) {
    hideCommandPalette();
    return;
  }

  els.commandPopoverBody.replaceChildren();

  ui.commandMatches.forEach((cmd, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'popover__item';
    if (index === ui.commandIndex) item.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'cmd__label';
    label.textContent = cmd.label;

    const hint = document.createElement('span');
    hint.className = 'cmd__hint';
    hint.textContent = cmd.hint;

    item.append(label, hint);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      runCommand(cmd);
    });

    els.commandPopoverBody.append(item);
  });

  els.commandPopover.removeAttribute('hidden');
}

function hideCommandPalette() {
  els.commandPopover.setAttribute('hidden', '');
  ui.commandMatches = [];
  ui.commandIndex = 0;
}

/** Ejecuta un comando del composer. */
function runCommand(cmd) {
  hideCommandPalette();
  const raw = els.input.value;
  const rest = raw.slice(1 + cmd.id.length).trim();

  els.input.value = '';
  autoGrow();
  updateSendState();

  switch (cmd.id) {
    case 'plan': {
      const task = rest.length > 0 ? rest : 'la tarea actual';
      els.input.value = `Elabora un plan numerado, sin modificar ficheros todavía, para: ${task}`;
      autoGrow();
      updateSendState();
      submitOrQueue();
      break;
    }

    case 'model':
      toggleModelPopover();
      break;

    case 'clear':
      newConversation();
      break;

    case 'settings':
      window.SettingsUI.open();
      break;

    case 'browser': {
      if (rest.length === 0) {
        addNotice('Uso: /browser <url>', 'info');
        break;
      }
      window.api.openBrowser(rest).then((result) => {
        if (!result.ok) addNotice(`No se pudo abrir: ${result.error}`, 'error');
      });
      break;
    }

    case 'stop':
      stopAgent();
      break;

    case 'help':
      addNotice(
        'Comandos: ' + COMMANDS.map((entry) => `${entry.label} — ${entry.hint}`).join(' · '),
        'info',
      );
      break;

    default:
      break;
  }
}

/** Detiene la ejecución en curso (botón de parar). */
async function stopAgent() {
  if (!ui.busy) return;
  ui.queue = [];
  await window.api.abortChat();
}

/** Encola un mensaje o interrumpe la ejecución, según la preferencia. */
async function submitOrQueue() {
  if (!ui.busy) return send();

  if (ui.prefs.queuedMessages === 'Send Immediately') {
    await window.api.abortChat();
    ui.queue = [];
    return send();
  }

  const text = els.input.value.trim();
  if (text.length === 0) return undefined;

  ui.queue.push(text);
  els.input.value = '';
  autoGrow();
  updateSendState();
  return undefined;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot() {
  initSearchPanel();
  initQuickFixes();

  let state = null;
  try {
    state = await window.api.getState();
  } catch (error) {
    console.error('No se pudo obtener el estado:', error);
  }

  if (state) {
    ui.cwd = state.cwd ?? null;
    ui.providerId = state.providerId ?? null;
    ui.model = state.model ?? null;

    els.projectName.textContent = state.cwd ? basename(state.cwd) : 'No Project';
    if (els.projectPill) els.projectPill.textContent = state.cwd ? basename(state.cwd) : 'No Project';
    const inline = document.getElementById('project-inline-label');
    if (inline) inline.textContent = state.cwd ? basename(state.cwd) : 'No Project';
    ui.activeConversation = state.sessionId ?? null;
  }

  await loadProviders();
  await refreshConversations();

  // Restaura preferencias: barra lateral, contraste, sonido, cola…
  try {
    const stored = await window.api.getPrefs();
    if (stored && typeof stored === 'object') {
      applyPrefs(stored);
      if (stored.sidebarCollapsed === true) setSidebarCollapsed(true);
    }
  } catch {
    // sin preferencias guardadas
  }

  window.api.onChatEvent(handleChatEvent);


  // Selector de modelo
  els.btnModel.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleModelPopover();
  });

  document.addEventListener('click', (event) => {
    if (els.modelPopover.hasAttribute('hidden')) return;
    if (els.modelPopover.contains(event.target)) return;
    if (els.btnModel.contains(event.target)) return;
    hideModelPopover();
  });

  // Ajustes: el panel se gestiona en settings.js
  els.btnSettings.addEventListener('click', openSettings);

  for (const el of document.querySelectorAll('[data-close-settings]')) {
    el.addEventListener('click', closeSettings);
  }

  window.SettingsUI.init({
    getState: () => ({
      providers: ui.providers,
      providerId: ui.providerId,
      model: ui.model,
      cwd: ui.cwd,
    }),
    addNotice: (msg, type) => addNotice(msg, type),
    onSelectModel: (providerId, modelId) => selectModel(providerId, modelId),
    reloadProviders: () => loadProviders(),
    onPrefChange: (_key, _value, all) => applyPrefs(all),
    exportActiveConversation: () => exportConversation(),
    openSearch: () => toggleSearch(true),
    getTools: () => ui.tools,
    getSkills: () => ui.skills,
    refreshSkills: async () => {
      ui.skills = await window.api.listSkills();
      window.SettingsUI.refresh();
    },
    getRemote: () => ui.remote,
    toggleRemote: () => toggleRemote(),
    onChangeWorkspace: () => changeWorkspace(),
  });

  document.addEventListener('keydown', (event) => {
    // Atajos declarados en Settings › Shortcuts.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newConversation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleModelPopover();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '`') {
      event.preventDefault();
      toggleTerminal();
      return;
    }
    if (event.key !== 'Escape') return;
    hideModelPopover();
    closeContextMenu();
    closePalette();
    document.getElementById('revert-modal')?.setAttribute('hidden', '');
    closeScheduled();
    closeMenus();
    if (window.SettingsUI.isOpen()) window.SettingsUI.close();
    else if (!els.sidebarSearch.hasAttribute('hidden')) toggleSearch(false);
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (ui.busy) {
      stopAgent();
      return;
    }
    submitOrQueue();
  });

  els.input.addEventListener('input', () => {
    autoGrow();
    updateSendState();
    updateCommandPalette();
    updateMentionPalette();
  });

  els.input.addEventListener('keydown', (event) => {
    const mentionOpen = !els.mentionPopover.hasAttribute('hidden');

    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        ui.mentionIndex = (ui.mentionIndex + 1) % ui.mentionMatches.length;
        updateMentionPalette();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        ui.mentionIndex =
          (ui.mentionIndex - 1 + ui.mentionMatches.length) % ui.mentionMatches.length;
        updateMentionPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const chosen = ui.mentionMatches[ui.mentionIndex];
        if (chosen) insertMention(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideMentionPalette();
        return;
      }
    }

    const paletteOpen = !els.commandPopover.hasAttribute('hidden');

    if (paletteOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        ui.commandIndex = (ui.commandIndex + 1) % ui.commandMatches.length;
        updateCommandPalette();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        ui.commandIndex =
          (ui.commandIndex - 1 + ui.commandMatches.length) % ui.commandMatches.length;
        updateCommandPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const chosen = ui.commandMatches[ui.commandIndex];
        if (chosen) runCommand(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideCommandPalette();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitOrQueue();
    }
  });

  // --- Botones de la barra lateral -----------------------------------------
  els.btnNew?.addEventListener('click', newConversation);
  // Panel de overview: cada fila muestra su vista.
  for (const row of document.querySelectorAll('.overview-row')) {
    row.addEventListener('click', () => selectOverviewView(row.dataset.panel));
  }

  els.effortLabel?.addEventListener('click', (event) => {
    event.stopPropagation();
    const levels = ['Low', 'Medium', 'High'];
    const next = levels[(levels.indexOf(ui.effort) + 1) % levels.length];
    ui.effort = next;
    els.effortLabel.textContent = next;
    window.api.setPrefs({ effort: next }).catch(() => {});
  });

  els.btnNew2.addEventListener('click', newConversation);
  els.btnNewLogo?.addEventListener('click', newConversation);
  els.btnNewSection?.addEventListener('click', newConversation);
  els.btnToggleSidebar?.addEventListener('click', toggleSidebar);
  els.btnGoBack?.addEventListener('click', () => window.history.back());
  els.btnGoForward?.addEventListener('click', () => window.history.forward());
  els.btnDisplayOptions?.addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, [
      { label: 'Mostrar todos los proyectos', onClick: () => {} },
      { label: 'Ocultar archivados', onClick: () => {} },
    ]);
  });
  els.btnOpenWorkspace.addEventListener('click', changeWorkspace);
  els.btnToggleTop?.addEventListener('click', toggleSidebar);
  els.btnSearch.addEventListener('click', () => toggleSearch());

  const overviewToggle = $('toggle-overview-panel');
  if (overviewToggle) overviewToggle.addEventListener('click', () => toggleOverview());

  els.searchInput.addEventListener('input', () => {
    ui.query = els.searchInput.value;
    renderConversations();
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      toggleSearch(false);
    }
  });

  // --- Menús de la barra de título -----------------------------------------
  for (const btn of document.querySelectorAll('[data-menu]')) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(btn.dataset.menu);
    });
  }

  for (const item of document.querySelectorAll('[data-action]')) {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      runMenuAction(item.dataset.action);
    });
  }

  document.addEventListener('click', (event) => {
    if (els.contextMenu.contains(event.target)) return;
    closeContextMenu();
    if (!event.target.closest || !event.target.closest('.menu')) closeMenus();
  });

  // --- Accesos rápidos -----------------------------------------------------
  document.getElementById('btn-customizations').addEventListener('click', () => {
    window.SettingsUI.open('customizations');
  });
  document.getElementById('btn-automations').addEventListener('click', () => openAutomations());

  /*
   * «Create with Prompt» es el flujo guiado: se abre el formulario con el foco
   * en la descripción, que es donde se escribe qué debe hacer la automatización.
   */
  /*
   * «Create with Prompt» no es un formulario: medido en su app, abre una
   * conversación nueva con el mensaje ya escrito («Guide me through creating an
   * automated task») y el agente te guía hasta crear la tarea.
   */
  document.getElementById('automations-create')?.addEventListener('click', async () => {
    closeAutomations();
    await newConversation();
    els.input.value = 'Guíame para crear una tarea automatizada';
    autoGrow();
    updateSendState();
    await send();
  });
  document.getElementById('automations-new')?.addEventListener('click', () => openScheduled());

  document.getElementById('scheduled-add')?.addEventListener('click', async () => {
    const prompt = document.getElementById('scheduled-prompt');
    const every = document.getElementById('scheduled-every');
    const unit = document.getElementById('scheduled-unit');
    if (!prompt || !prompt.value.trim()) return;

    await window.api.saveScheduled({
      prompt: prompt.value.trim(),
      every: Number(every?.value ?? 30),
      unit: unit?.value ?? 'minutes',
      nextRunAt: new Date(Date.now() + Number(every?.value ?? 30) * (unit?.value === 'hours' ? 3600000 : 60000)).toISOString(),
    });

    prompt.value = '';
    await renderScheduled();
  });

  for (const node of document.querySelectorAll('[data-close-scheduled]')) {
    node.addEventListener('click', closeScheduled);
  }

  // Plan mode: el agente propone pasos y el usuario decide.
  /*
   * Despertar reactivo: si una tarea de fondo termina con el turno cerrado, se
   * arranca uno nuevo con su resultado, sin que el usuario tenga que preguntar.
   */
  /*
   * El despertar NO se descarta si el usuario está en un turno: se encola y se
   * entrega al terminar. Descartarlo perdía el resultado de la tarea para
   * siempre, que es peor que llegar tarde.
   */
  window.api.onTaskWake?.(({ texto }) => {
    ui.despertaresPendientes.push(texto);
    if (ui.busy) {
      addNotice('Una tarea de fondo terminó. El agente la retomará al acabar.', 'ok');
      return;
    }
    entregarDespertares();
  });

  window.api.onPlanProposal((plan) => showPlanCard(plan));
  window.api.onQuestionAsk((payload) => showQuestionCard(payload));

  // Una tarea vencida lanza su prompt en una conversación nueva.
  window.api.onScheduledFire(async (payload) => {
    closeScheduled();
    await newConversation();
    els.input.value = payload.prompt ?? '';
    autoGrow();
    updateSendState();
    await send();
  });
  // Selector de proyecto dentro del composer (estado vacío).
  document.getElementById('btn-project-selector-inline')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.top - 8, [
      { label: 'Abrir carpeta…', onClick: changeWorkspace },
      { label: 'Ajustes del workspace', onClick: () => window.SettingsUI.open('application') },
    ]);
  });

  els.btnProjectSelector?.addEventListener('click', (event) => {
    event.stopPropagation();
    openContextMenu(els.btnProjectSelector.getBoundingClientRect().left, 44, [
      { label: 'Abrir carpeta…', onClick: changeWorkspace },
      { label: 'Ajustes del workspace', onClick: () => window.SettingsUI.open('application') },
    ]);
  });
  document.getElementById('btn-permissions')?.addEventListener('click', () => {
    window.SettingsUI.open('general');
  });
  // Paleta de comandos: filtro y navegación con teclado.
  const paletteInput = document.getElementById('palette-input');
  paletteInput?.addEventListener('input', () => renderPalette(paletteInput.value));
  paletteInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaletteSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaletteSelection(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = paletteItems[paletteIndex];
      if (command) {
        closePalette();
        command.run();
      }
    }
  });

  for (const node of document.querySelectorAll('[data-close-palette]')) {
    node.addEventListener('click', closePalette);
  }

  // Git remoto: fetch, pull, push y abortar fusión.
  document.getElementById('git-fetch-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitFetch();
    addNotice(result.ok ? 'Fetch completado.' : `Fetch falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-pull-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitPull();
    addNotice(result.ok ? 'Pull completado.' : `Pull falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-push-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitPush({ setUpstream: true });
    addNotice(result.ok ? 'Push completado.' : `Push falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-abort-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitAbortMerge();
    addNotice(result.ok ? 'Fusión abortada.' : `No se pudo abortar: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  for (const node of document.querySelectorAll('[data-close-revert]')) {
    node.addEventListener('click', () => {
      document.getElementById('revert-modal')?.setAttribute('hidden', '');
    });
  }

  // Controles de ventana propios (la ventana es frameless).
  document.getElementById('win-minimize')?.addEventListener('click', () => window.api.minimize());
  document.getElementById('win-maximize')?.addEventListener('click', () => window.api.toggleMaximize());
  document.getElementById('win-close')?.addEventListener('click', () => window.api.closeWindow());

  document.getElementById('announce-close')?.addEventListener('click', hideAnnouncement);

  document.getElementById('toggle-aux-pane')?.addEventListener('click', () => toggleEditorPane());

  // Tarjetas de la vista de nueva pestaña.
  for (const card of document.querySelectorAll('.newtab__card')) {
    card.addEventListener('click', () => runNewTabAction(card.dataset.newtab));
  }

  document.getElementById('btn-more-actions')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.right - 180, rect.bottom + 4, [
      { label: 'Renombrar conversación…', onClick: () => renameConversation() },
      { label: 'Archivar conversación', onClick: () => archiveConversation() },
      { label: 'Exportar como Markdown', onClick: () => exportConversation() },
    ]);
  });

  // Preset de permisos: cambia de verdad lo que el agente puede hacer sin preguntar.
  document.getElementById('btn-turbo').addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const actual = ui.prefs.permissionPreset ?? 'Turbo';

    openContextMenu(
      rect.left,
      rect.top - 8,
      PRESETS.map((preset) => ({
        label: preset,
        selected: preset === actual,
        onClick: () => setPermissionPreset(preset),
      })),
    );
  });

  // Adjuntar contexto: fichero del disco, mención o imagen.
  document.getElementById('btn-add-context')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.top - 8, [
      { label: 'Adjuntar fichero…', onClick: () => attachFile() },
      { label: 'Mencionar del proyecto', onClick: () => insertMentionTrigger() },
      { label: 'Añadir imagen…', onClick: () => attachImage() },
    ]);
  });

  // Dictado real con el reconocimiento de voz del navegador.
  document.getElementById('btn-voice')?.addEventListener('click', () => toggleDictation());

  renderPresetLabel();

  // --- Catalogos y control remoto ------------------------------------------
  await loadCatalogues();

  // --- Terminal -------------------------------------------------------------
  window.api.onTerminalData((payload) => terminalWrite(payload.chunk ?? '', payload.raw === true, payload.id));
  window.api.onTerminalDone(async (payload) => {
    if (payload.code !== 0 && payload.code !== undefined) {
      terminalWrite(`[exit ${payload.code}]\n`, false, payload.id);
    }
    try {
      if (els.terminalCwd) els.terminalCwd.textContent = await window.api.terminalCwd();
    } catch {
      // sin cwd disponible
    }
  });
  window.api.onTerminalClear(() => {
    els.terminalOutput.textContent = '';
  });

  els.terminalInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      terminalSubmit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      toggleTerminal(false);
      return;
    }

    if (!ptyActive) return;

    // Secuencias de control para el PTY.
    const sequences = {
      ArrowUp: '\u001b[A',
      ArrowDown: '\u001b[B',
      ArrowRight: '\u001b[C',
      ArrowLeft: '\u001b[D',
      Tab: '\t',
      Backspace: '\u007f',
    };

    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      await window.api.terminalPtyWrite('\u0003');
      return;
    }

    const sequence = sequences[event.key];
    if (sequence) {
      event.preventDefault();
      await window.api.terminalPtyWrite(sequence);
    }
  });

  const terminalToggle = $('toggle-terminal');
  if (terminalToggle) terminalToggle.addEventListener('click', () => toggleTerminal());
  const terminalKill = $('aux-kill');
  if (terminalKill) {
    terminalKill.addEventListener('click', () => {
      // Interrumpir solo la terminal activa, no todas.
      if (ptyActive && terminalActiva) window.api.terminalPtyKill({ id: terminalActiva });
      else window.api.terminalKill();
    });
  }

  const terminalAdd = $('terminal-add');
  if (terminalAdd) terminalAdd.addEventListener('click', () => void nuevaTerminal());
  const terminalClose = $('aux-tab-back');
  if (terminalClose) {
    // Vuelve a la lista de vistas, no cierra el panel.
    terminalClose.addEventListener('click', () => seleccionarVistaAux('launcher'));
  }

  const auxClose = $('aux-close');
  if (auxClose) auxClose.addEventListener('click', cerrarPanelLateral);

  const auxMaximize = $('aux-maximize');
  if (auxMaximize) {
    auxMaximize.addEventListener('click', () => {
      const cuerpo = document.querySelector('.body');
      cuerpo?.classList.toggle('is-aux-maximized');
      // Al cambiar el ancho hay que reajustar la terminal visible.
      if (terminalActiva) setTimeout(() => ajustarTerminal(terminalActiva), 300);
    });
  }

  for (const item of document.querySelectorAll('.aux__item')) {
    item.addEventListener('click', () => {
      const vista = item.dataset.auxView;
      void abrirPanelLateral(vista);
    });
  }

  // --- Git ------------------------------------------------------------------
  for (const el of document.querySelectorAll('[data-close-git-diff]')) {
    el.addEventListener('click', closeGitDiff);
  }
  const indexBtn = $('index-build');
  if (indexBtn) indexBtn.addEventListener('click', rebuildIndex);
  const warmBtn = $('index-warm');
  if (warmBtn) warmBtn.addEventListener('click', warmIndex);

  const branchSelect = $('git-branch-select');
  if (branchSelect) {
    branchSelect.addEventListener('change', () => checkoutBranch(branchSelect.value));
  }

  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.addEventListener('click', commitChanges);
  const commitInput = $('git-message');
  if (commitInput) {
    commitInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitChanges();
      }
    });
  }

  // Editor
  await loadFileIndex();

  window.api.onDiffProposal((payload) => addDiffCard(payload, payload.id));
  window.api.onDiffApplied((payload) => addDiffCard(payload, null));

  window.api.onRemotePrompt((text) => {
    els.input.value = text;
    autoGrow();
    updateSendState();
    submitOrQueue();
  });

  // --- Enlaces: respeta «Open Links In» ------------------------------------
  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    event.preventDefault();
    const url = anchor.href;

    if (ui.prefs.openLinksIn === 'Built-in Browser') {
      window.api.openBrowser(url);
    } else {
      window.api.openExternal(url);
    }
  });

  // Iconos reales de la interfaz analizada.
  for (const node of document.querySelectorAll('[data-icon]')) {
    node.innerHTML = window.Icon(node.dataset.icon, 16);
  }

  selectOverviewView(ui.overviewView);
  updateEmptyState();
  updateSendState();
  els.input.focus();
}

function basename(path) {
  if (!path) return 'No Project';
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

boot();
