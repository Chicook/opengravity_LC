'use strict';

/**
 * Puente entre el renderer y el proceso principal.
 *
 * El renderer no tiene acceso a Node. Solo ve este objeto `window.api`, con
 * métodos explícitos. Cada método es un canal IPC con nombre `dominio:accion`.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** Estado inicial: workspace, proveedores, modelos, sesión. */
  getState: () => ipcRenderer.invoke('app:state'),

  /** Catálogo completo de proveedores con sus modelos. */
  listProviders: () => ipcRenderer.invoke('providers:list'),
  refreshProviders: () => ipcRenderer.invoke('providers:refresh'),

  /** Preferencias de la interfaz. */
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),

  /** Abre un diálogo para elegir carpeta de trabajo. */
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  /** Activa una carpeta ya conocida, sin diálogo. */
  setWorkspace: (target) => ipcRenderer.invoke('workspace:set', target),
  /** Proyectos registrados y acciones de proyecto. */
  listProjects: () => ipcRenderer.invoke('projects:list'),
  selectProject: (target) => ipcRenderer.invoke('project:select', target),
  createProject: (target) => ipcRenderer.invoke('project:create', target),
  removeProject: (target) => ipcRenderer.invoke('project:remove', target),
  clearProject: () => ipcRenderer.invoke('project:none'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openImageDialog: () => ipcRenderer.invoke('dialog:open-image'),
  relativePath: (target) => ipcRenderer.invoke('fs:relative', target),

  /** Lista un directorio del workspace. */
  listDir: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),

  /** Lee un fichero del workspace. */
  readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),

  /** Guarda un fichero del workspace. */
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:write', { path: filePath, content }),

  /** Índice de ficheros del workspace (para @menciones y explorador). */
  indexFiles: () => ipcRenderer.invoke('fs:index'),

  /** Cambia proveedor y/o modelo. */
  setModel: (payload) => ipcRenderer.invoke('settings:set', payload),

  /** Envía un turno al agente. Los eventos llegan por `onChatEvent`. */
  sendPrompt: (payload) => ipcRenderer.invoke('chat:send', payload),

  /** Cancela la ejecución en curso. */
  abortChat: () => ipcRenderer.invoke('chat:abort'),

  /** Deshace hasta el mensaje indicado. */
  revertChat: (keepCount) => ipcRenderer.invoke('chat:revert', keepCount),

  // --- Índice de código ---
  indexBuild: () => ipcRenderer.invoke('index:build'),
  indexStatus: () => ipcRenderer.invoke('index:status'),
  indexSearch: (payload) => ipcRenderer.invoke('index:search', payload),
  indexWarm: () => ipcRenderer.invoke('index:warm'),
  indexReferences: (name) => ipcRenderer.invoke('index:references', name),

  // --- LSP ---
  lspOpen: (payload) => ipcRenderer.invoke('lsp:open', payload),
  lspChange: (payload) => ipcRenderer.invoke('lsp:change', payload),
  lspComplete: (payload) => ipcRenderer.invoke('lsp:complete', payload),
  lspDefinition: (payload) => ipcRenderer.invoke('lsp:definition', payload),
  lspStatus: () => ipcRenderer.invoke('lsp:status'),
  lspRename: (payload) => ipcRenderer.invoke('lsp:rename', payload),
  lspFormat: (payload) => ipcRenderer.invoke('lsp:format', payload),

  onLspDiagnostics: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('lsp:diagnostics', handler);
    return () => ipcRenderer.removeListener('lsp:diagnostics', handler);
  },

  // --- Git ---
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (payload) => ipcRenderer.invoke('git:diff', payload),
  gitStage: (paths) => ipcRenderer.invoke('git:stage', paths),
  gitUnstage: (paths) => ipcRenderer.invoke('git:unstage', paths),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitBranches: () => ipcRenderer.invoke('git:branches'),
  gitCheckout: (branch) => ipcRenderer.invoke('git:checkout', branch),
  gitLog: (payload) => ipcRenderer.invoke('git:log', payload),
  gitDiffHunks: (payload) => ipcRenderer.invoke('git:diff-hunks', payload),
  gitApplyHunk: (payload) => ipcRenderer.invoke('git:apply-hunk', payload),

  // --- Terminal ---
  terminalRun: (command) => ipcRenderer.invoke('terminal:run', { command }),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  terminalCwd: () => ipcRenderer.invoke('terminal:cwd'),
  terminalPtyStatus: () => ipcRenderer.invoke('terminal:pty-status'),
  /** Varias terminales: cada una se identifica por `id`. */
  terminalStartPty: (payload) => ipcRenderer.invoke('terminal:start-pty', payload ?? {}),
  terminalPtyWrite: (payload) => ipcRenderer.invoke('terminal:pty-write', payload),
  terminalPtyResize: (payload) => ipcRenderer.invoke('terminal:pty-resize', payload),
  terminalPtyKill: (payload) => ipcRenderer.invoke('terminal:pty-kill', payload),

  onTerminalData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },

  onTerminalDone: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:done', handler);
    return () => ipcRenderer.removeListener('terminal:done', handler);
  },

  onTerminalClear: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('terminal:clear', handler);
    return () => ipcRenderer.removeListener('terminal:clear', handler);
  },

  /** Propuesta de cambio pendiente de aprobación. */
  onDiffProposal: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('diff:proposal', handler);
    return () => ipcRenderer.removeListener('diff:proposal', handler);
  },

  /** Cambio aplicado automáticamente (sin aprobación). */
  onDiffApplied: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('diff:applied', handler);
    return () => ipcRenderer.removeListener('diff:applied', handler);
  },

  /** Responde a una propuesta de diff. */
  respondDiff: (id, accepted) => ipcRenderer.invoke('diff:respond', { id, accepted }),

  // --- Herramientas, skills, perfil ---
  listTools: () => ipcRenderer.invoke('tools:list'),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  getProfile: () => ipcRenderer.invoke('profile:get'),

  // --- Red y navegador ---
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openBrowser: (url) => ipcRenderer.invoke('browser:open', url),
  browserEvaluate: (script) => ipcRenderer.invoke('browser:evaluate', script),
  getDownloadDir: () => ipcRenderer.invoke('app:downloads-dir'),
  chooseDownloadDir: () => ipcRenderer.invoke('app:choose-download-dir'),
  downloadsList: () => ipcRenderer.invoke('downloads:list'),
  downloadsOpen: (id) => ipcRenderer.invoke('downloads:open', id),
  onDownloadsUpdate: (callback) => {
    const handler = (_event, lista) => callback(lista);
    ipcRenderer.on('downloads:update', handler);
    return () => ipcRenderer.removeListener('downloads:update', handler);
  },
  clearBrowserHistory: () => ipcRenderer.invoke('browser:clear-history'),

  // --- Control remoto ---
  remoteStatus: () => ipcRenderer.invoke('remote:status'),
  remoteStart: () => ipcRenderer.invoke('remote:start'),
  remoteStop: () => ipcRenderer.invoke('remote:stop'),

  /** Prompt recibido por control remoto. */
  onRemotePrompt: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('remote:prompt', handler);
    return () => ipcRenderer.removeListener('remote:prompt', handler);
  },

  /** Lista sesiones guardadas. */
  /** Responde a una propuesta de plan. */
  respondPlan: (payload) => ipcRenderer.invoke('plan:respond', payload),

  /** Recibe propuestas de plan del agente. */
  onPlanProposal: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('plan:proposal', handler);
    return () => ipcRenderer.removeListener('plan:proposal', handler);
  },

  /** Responde a una tarjeta de preguntas del agente. */
  respondQuestion: (payload) => ipcRenderer.invoke('question:respond', payload),

  /** Recibe preguntas del agente. */
  onQuestionAsk: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('question:ask', handler);
    return () => ipcRenderer.removeListener('question:ask', handler);
  },

  /** Servidores MCP: probar y listar. */
  probeMcp: (server) => ipcRenderer.invoke('mcp:probe', server),
  marketplaceList: () => ipcRenderer.invoke('marketplace:list'),
  listMcp: () => ipcRenderer.invoke('mcp:list'),

  /** Tareas programadas. */
  listScheduled: () => ipcRenderer.invoke('scheduled:list'),
  saveScheduled: (task) => ipcRenderer.invoke('scheduled:save', task),
  deleteScheduled: (id) => ipcRenderer.invoke('scheduled:delete', id),
  toggleScheduled: (id, enabled) => ipcRenderer.invoke('scheduled:toggle', id, enabled),
  runScheduled: (id) => ipcRenderer.invoke('scheduled:run', id),
  onScheduledFire: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('scheduled:fire', handler);
    return () => ipcRenderer.removeListener('scheduled:fire', handler);
  },

  /** Vista previa de lo que deshará una reversión. */
  revertPreview: (keepCount) => ipcRenderer.invoke('chat:revert-preview', keepCount),

  /** Acciones de código del LSP (quick fixes). */
  lspCodeActions: (payload) => ipcRenderer.invoke('lsp:code-actions', payload),
  lspApplyAction: (payload) => ipcRenderer.invoke('lsp:apply-action', payload),

  /** Cuenta de Google para generar imágenes con Flow. */
  /** Despertar reactivo: una tarea de fondo terminó. */
  onTaskFinished: (cb) => ipcRenderer.on('task:finished', (_e, p) => cb(p)),
  onTaskWake: (cb) => ipcRenderer.on('task:wake', (_e, p) => cb(p)),

  /** Genera una imagen con Flow (experimental: depende de su interfaz). */
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),

  /** Imagen local como data URL, para pintarla en el hilo. */
  imageAsDataUrl: (ruta) => ipcRenderer.invoke('image:as-data-url', ruta),

  /** Usar el Chrome del usuario, con su sesión ya iniciada. */

  googleStatus: () => ipcRenderer.invoke('google:status'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),

  /** Buscar y reemplazar en todo el proyecto. */
  searchRun: (payload) => ipcRenderer.invoke('search:run', payload),
  searchReplace: (payload) => ipcRenderer.invoke('search:replace', payload),

  /** Cambios del turno en curso, para la tarjeta de revisión. */
  turnChanges: () => ipcRenderer.invoke('chat:turn-changes'),

  /** Runner de tests. */
  testsDetect: () => ipcRenderer.invoke('tests:detect'),
  testsRun: () => ipcRenderer.invoke('tests:run'),

  /** Trayectoria: pasos y reversión selectiva a un paso. */
  trajectoryList: () => ipcRenderer.invoke('trajectory:list'),
  trajectoryPreview: (indice) => ipcRenderer.invoke('trajectory:preview', { indice }),
  trajectoryRevert: (indice) => ipcRenderer.invoke('trajectory:revert', { indice }),

  /** Git remoto y conflictos. */
  gitPush: (options) => ipcRenderer.invoke('git:push', options),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitFetch: () => ipcRenderer.invoke('git:fetch'),
  gitTracking: () => ipcRenderer.invoke('git:tracking'),
  gitResolve: (filePath, side) => ipcRenderer.invoke('git:resolve', filePath, side),
  gitAbortMerge: () => ipcRenderer.invoke('git:abort-merge'),

  listSessions: () => ipcRenderer.invoke('sessions:list'),
  newSession: () => ipcRenderer.invoke('sessions:new'),

  /** Aplica la retención del historial. */
  applyRetention: () => ipcRenderer.invoke('sessions:apply-retention'),

  /** Renombra una conversación. */
  renameSession: (id, title) => ipcRenderer.invoke('sessions:rename', id, title),

  /** Exporta una conversación a Markdown. */
  exportSession: (id) => ipcRenderer.invoke('sessions:export', id),

  /** Borra una conversación. */
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),

  // --- Controles de ventana ---
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
  zoom: (delta) => ipcRenderer.invoke('window:zoom', delta),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  windowInfo: () => ipcRenderer.invoke('window:info'),
  setWindowSize: (w, h) => ipcRenderer.invoke('window:set-size', w, h),

  /** Carga una sesión guardada. */
  loadSession: (id) => ipcRenderer.invoke('sessions:load', id),

  /**
   * Suscripción a eventos del agente.
   * Devuelve la función para darse de baja.
   */
  onChatEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:event', handler);
    return () => ipcRenderer.removeListener('chat:event', handler);
  },
});
