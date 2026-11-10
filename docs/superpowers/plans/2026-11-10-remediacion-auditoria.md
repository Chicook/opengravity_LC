# Remediación de la auditoría general — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los fallos de integridad, seguridad y paridad detectados en la auditoría del 2026-11-10, con tests que fallen antes del arreglo.

**Architecture:** Se extraen las piezas puras que hoy viven dentro de `electron/main.cjs` (restauración de snapshots, reset de sesión, política de título y escritura de ajustes) a módulos pequeños y testeables. La app sigue siendo un único proceso Electron; no se añaden servicios ni dependencias.

**Tech Stack:** Electron 33, Node 22, CommonJS en `electron/`, TypeScript en `src/`, tests con `node:test`.

**Spec:** `docs/analysis/paridad-en-vivo.md` y los hallazgos de la auditoría general del 2026-11-10 listados abajo.

## Global Constraints

- Un solo usuario de escritorio; no hay carga multiusuario.
- Windows es la plataforma principal; no romper POSIX.
- Cero dependencias nuevas de runtime; cero servicios externos.
- Mantener la paridad visual con Antigravity ya conseguida en Ajustes.
- Ninguna clave API puede aparecer en logs.
- Cada tarea termina con `npm test` en verde y un commit convencional.
- Fuera de alcance: AppContainer, firma de código, auto-actualización y traducción completa de Ajustes.

---

## Hallazgos que cubre este plan

1. El revert restaura ficheros equivocados.
2. Nueva conversación reutiliza checkpoints viejos.
3. El monitor de seguridad pinta el veredicto en la fila equivocada.
4. `settings.json` se puede corromper al guardar.
5. Claves API en texto plano.
6. Marketplace ejecuta la última versión de npm.
7. `run_command` hereda credenciales del entorno.
8. Faltan tests de los flujos nuevos.
9. Developer no es accesible desde la navegación.
10. El título automático pisa un renombrado manual.
11. `entradaAPlugin` es código muerto.
12. CSS duplicado y sin uso.

## Estructura de ficheros

- Crear `electron/checkpoints.cjs`: restaura snapshots y devuelve fallos.
- Crear `electron/session-state.cjs`: resetea el estado de conversación.
- Crear `renderer/guardian-row.js`: elige la fila del guardián por herramienta.
- Crear `electron/settings-store.cjs`: escritura atómica y serializada.
- Crear `electron/secret-store.cjs`: cifrado de claves con `safeStorage`.
- Crear `electron/title-policy.cjs`: decide si el título automático puede escribir.
- Modificar `electron/main.cjs`, `renderer/app.js`, `renderer/index.html`, `renderer/settings.js`, `assets/marketplace.json`, `renderer/styles.css`.
- Tests nuevos en `test/checkpoints.test.mjs`, `test/session-state.test.mjs`, `test/settings-store.test.mjs`, `test/secret-store.test.mjs`, `test/guardian-row.test.mjs`, `test/title-policy.test.mjs`, `test/extension-code.test.mjs`.

---

### Task 1: Revertir cada snapshot con su propio contenido

**Files:**
- Create: `electron/checkpoints.cjs`
- Modify: `electron/main.cjs:1948-1968`, `electron/main.cjs:3455-3475`
- Test: `test/checkpoints.test.mjs`

**Interfaces:**
- Produces: `restoreSnapshots({ keys, checkpoints, writeFile, rm }) -> Promise<{ restored: number, failures: Array<{ path: string, error: string }> }>`.

- [ ] **Step 1: Escribir el test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { restoreSnapshots } = require('../electron/checkpoints.cjs');

test('restaura cada snapshot con el contenido de ese turno', async () => {
  const escritos = new Map();
  const checkpoints = new Map([
    [0, new Map([['A.txt', 'A-viejo']])],
    [2, new Map([['B.txt', 'B-viejo']])],
  ]);

  const resultado = await restoreSnapshots({
    keys: [0, 2],
    checkpoints,
    writeFile: async (ruta, contenido) => escritos.set(ruta, contenido),
    rm: async () => {},
  });

  assert.deepEqual([...escritos], [
    ['B.txt', 'B-viejo'],
    ['A.txt', 'A-viejo'],
  ]);
  assert.deepEqual(resultado, { restored: 2, failures: [] });
  assert.equal(checkpoints.size, 0);
});

test('devuelve el fallo y conserva el snapshot para reintentar', async () => {
  const checkpoints = new Map([[0, new Map([['A.txt', 'A-viejo']])]]);

  const resultado = await restoreSnapshots({
    keys: [0],
    checkpoints,
    writeFile: async () => {
      throw new Error('EACCES');
    },
    rm: async () => {},
  });

  assert.equal(resultado.restored, 0);
  assert.equal(resultado.failures[0].path, 'A.txt');
  assert.equal(checkpoints.size, 1);
});
```

- [ ] **Step 2: Ejecutar el test y verlo fallar**

Run: `node --test test/checkpoints.test.mjs`
Expected: FAIL porque `electron/checkpoints.cjs` no existe.

- [ ] **Step 3: Crear el módulo**

```js
'use strict';

/**
 * Restaura los snapshots del más nuevo al más antiguo.
 * Si un fichero falla, su snapshot se conserva para poder reintentar.
 */
async function restoreSnapshots({ keys, checkpoints, writeFile, rm }) {
  const failures = [];
  let restored = 0;

  for (const key of [...keys].sort((a, b) => b - a)) {
    const snapshot = checkpoints.get(key);
    if (!snapshot) continue;

    let falloEnSnapshot = false;
    for (const [absolute, original] of snapshot) {
      try {
        if (original === null) {
          await rm(absolute, { force: true });
        } else {
          await writeFile(absolute, original, 'utf8');
        }
        restored += 1;
      } catch (error) {
        falloEnSnapshot = true;
        failures.push({
          path: absolute,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!falloEnSnapshot) checkpoints.delete(key);
  }

  return { restored, failures };
}

module.exports = { restoreSnapshots };
```

- [ ] **Step 4: Usarlo desde `main.cjs`**

Añade el require:

```js
const { restoreSnapshots } = require('./checkpoints.cjs');
```

Sustituye el cuerpo de `restoreCheckpoints` por:

```js
async function restoreCheckpoints(keepCount) {
  const keys = [...turnCheckpoints.keys()]
    .filter((key) => key >= keepCount)
    .sort((a, b) => b - a);

  const { restored, failures } = await restoreSnapshots({
    keys,
    checkpoints: turnCheckpoints,
    writeFile: fsp.writeFile,
    rm: fsp.rm,
  });

  /*
   * Si no había snapshots en memoria y no hubo fallos, se usa la trayectoria
   * persistida como hasta ahora. Con fallos no se trunca el historial.
   */
  if (restored === 0 && failures.length === 0 && state.sessionId) {
    // Conserva el bloque actual de trayectoria.planDeReversion.
  }

  return { restored, failures };
}
```

En `chat:revert`, antes de truncar mensajes:

```js
const resultado = await restoreCheckpoints(keep);
if (resultado.failures.length > 0) {
  return {
    ok: false,
    error: `No se pudieron restaurar ${resultado.failures.length} fichero(s). No se recortó la conversación.`,
    restoredFiles: resultado.restored,
    failures: resultado.failures,
  };
}
```

- [ ] **Step 5: Ejecutar tests**

Run: `node --test test/checkpoints.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS (361 tests + los nuevos).

- [ ] **Step 6: Commit**

```bash
git add electron/checkpoints.cjs electron/main.cjs test/checkpoints.test.mjs
git commit -m "fix(revert): restaurar cada snapshot con su contenido"
```

---

### Task 2: Resetear checkpoints al empezar una conversación

**Files:**
- Create: `electron/session-state.cjs`
- Modify: `electron/main.cjs:3158-3165`
- Test: `test/session-state.test.mjs`

**Interfaces:**
- Produces: `resetSessionState(state, turnCheckpoints, cambiosDelTurno) -> void`.

- [ ] **Step 1: Test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resetSessionState } = require('../electron/session-state.cjs');

test('resetea la sesión y olvida los checkpoints anteriores', () => {
  const state = { sessionId: 'vieja', messages: [{ role: 'user', content: 'hola' }] };
  const checkpoints = new Map([[0, new Map([['A.txt', 'viejo']])]]);
  const cambios = [{ absolute: 'A.txt', original: 'viejo' }];

  resetSessionState(state, checkpoints, cambios);

  assert.equal(state.sessionId, null);
  assert.deepEqual(state.messages, []);
  assert.equal(checkpoints.size, 0);
  assert.deepEqual(cambios, []);
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/session-state.test.mjs`
Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Crear el módulo**

```js
'use strict';

function resetSessionState(state, turnCheckpoints, cambiosDelTurno) {
  state.sessionId = null;
  state.messages = [];
  turnCheckpoints.clear();
  if (Array.isArray(cambiosDelTurno)) cambiosDelTurno.length = 0;
}

module.exports = { resetSessionState };
```

- [ ] **Step 4: Usarlo en `sessions:new`**

```js
const { resetSessionState } = require('./session-state.cjs');

ipcMain.handle('sessions:new', async () => {
  if (state.busy) return { ok: false, error: 'el agente está trabajando' };
  resetSessionState(state, turnCheckpoints, cambiosDelTurno);
  currentTurnKey = null;
  return { ok: true };
});
```

- [ ] **Step 5: Tests**

Run: `node --test test/session-state.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/session-state.cjs electron/main.cjs test/session-state.test.mjs
git commit -m "fix(session): limpiar checkpoints al crear una conversación"
```

---

### Task 3: Atribuir el veredicto del guardián a su fila

**Files:**
- Create: `renderer/guardian-row.js`
- Modify: `renderer/index.html` (cargar el script antes de `app.js`), `renderer/app.js:2819-2830`, `renderer/app.js:2916-2922`
- Test: `test/guardian-row.test.mjs`

**Interfaces:**
- Produces: `GuardianRow.chooseRow(rows, tool)` donde cada fila es `{ tool: string, running: boolean, row: unknown }`; devuelve la última fila en ejecución de esa herramienta, o la última de esa herramienta, o `null`.

- [ ] **Step 1: Test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chooseRow } = require('../renderer/guardian-row.js');

test('elige la última fila en ejecución de la herramienta', () => {
  const primera = { tool: 'run_command', running: false };
  const segunda = { tool: 'run_command', running: true };
  const otra = { tool: 'read_file', running: true };

  assert.equal(chooseRow([primera, segunda, otra], 'run_command'), segunda);
});

test('si ya terminó, usa la última fila de esa herramienta', () => {
  const primera = { tool: 'read_file', running: false };
  const segunda = { tool: 'read_file', running: false };

  assert.equal(chooseRow([primera, segunda], 'read_file'), segunda);
  assert.equal(chooseRow([], 'run_command'), null);
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/guardian-row.test.mjs`
Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Crear el helper**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GuardianRow = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function chooseRow(rows, tool) {
    const coinciden = rows.filter((fila) => fila.tool === tool);
    return coinciden.filter((fila) => fila.running).at(-1) ?? coinciden.at(-1) ?? null;
  }

  return { chooseRow };
});
```

- [ ] **Step 4: Usarlo en la UI**

En `index.html`, antes de `app.js`:

```html
<script src="guardian-row.js"></script>
```

En `addToolRow`, después de crear `row`:

```js
row.dataset.tool = name;
```

Sustituye `buscarFilaDeHerramienta` por:

```js
function buscarFilaDeHerramienta(nombre) {
  const filas = [...document.querySelectorAll('.work-row')].map((row) => ({
    tool: row.dataset.tool,
    running: row.classList.contains('is-running'),
    row,
  }));
  return window.GuardianRow.chooseRow(filas, nombre)?.row ?? null;
}
```

- [ ] **Step 5: Tests**

Run: `node --test test/guardian-row.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Prueba manual**

En el EXE, pide dos comandos en un turno y comprueba que el aviso del monitor aparece en la fila del comando correcto; después repite con un `read_file`.

- [ ] **Step 7: Commit**

```bash
git add renderer/guardian-row.js renderer/index.html renderer/app.js test/guardian-row.test.mjs
git commit -m "fix(guardian): atribuir el veredicto a la fila correcta"
```

---

### Task 4: Guardar ajustes de forma atómica y serializada

**Files:**
- Create: `electron/settings-store.cjs`
- Modify: `electron/main.cjs:152-172`
- Test: `test/settings-store.test.mjs`

**Interfaces:**
- Produces: `guardarEnCola(ruta, payload) -> Promise<void>`; `escribirAtomico(ruta, payload) -> Promise<void>`.

- [ ] **Step 1: Test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guardarEnCola } = require('../electron/settings-store.cjs');

test('deja JSON válido y no deja temporales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-settings-'));
  const ruta = join(dir, 'settings.json');

  await Promise.all([
    guardarEnCola(ruta, { version: 1 }),
    guardarEnCola(ruta, { version: 2 }),
  ]);

  const datos = JSON.parse(await readFile(ruta, 'utf8'));
  assert.ok([1, 2].includes(datos.version));
  assert.equal((await readdir(dir)).some((nombre) => nombre.endsWith('.tmp')), false);

  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/settings-store.test.mjs`
Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Crear el módulo**

```js
'use strict';

const fsp = require('node:fs/promises');

let cola = Promise.resolve();

async function escribirAtomico(ruta, payload) {
  const temporal = `${ruta}.tmp`;
  await fsp.writeFile(temporal, JSON.stringify(payload, null, 2), 'utf8');
  await fsp.rename(temporal, ruta);
}

function guardarEnCola(ruta, payload) {
  const siguiente = cola.then(() => escribirAtomico(ruta, payload));
  cola = siguiente.catch(() => {});
  return siguiente;
}

module.exports = { escribirAtomico, guardarEnCola };
```

- [ ] **Step 4: Usarlo en `saveSettings`**

```js
const { guardarEnCola } = require('./settings-store.cjs');

async function saveSettings() {
  await fsp.mkdir(app.getPath('userData'), { recursive: true });

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

  await guardarEnCola(settingsPath(), payload);
}
```

No silencies el error: deja que el `catch` del llamador lo muestre o registra `console.error` sin incluir claves.

- [ ] **Step 5: Tests**

Run: `node --test test/settings-store.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/settings-store.cjs electron/main.cjs test/settings-store.test.mjs
git commit -m "fix(settings): guardar preferencias de forma atómica"
```

---

### Task 5: Cifrar las claves API con `safeStorage`

**Files:**
- Create: `electron/secret-store.cjs`
- Modify: `electron/main.cjs` (lectura y guardado de `settings.json`)
- Test: `test/secret-store.test.mjs`

**Interfaces:**
- Produces: `cifrarClaves(apiKeys, safeStorage) -> string | null`; `descifrarClaves(texto, safeStorage) -> Record<string,string> | null`.

- [ ] **Step 1: Test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cifrarClaves, descifrarClaves } = require('../electron/secret-store.cjs');

const falso = {
  isEncryptionAvailable: () => true,
  encryptString: (texto) => Buffer.from(`x${texto}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').slice(1),
};

test('cifra y descifra el mapa de claves', () => {
  const claves = { 'opencode-go': 'sk-prueba' };
  const cifrado = cifrarClaves(claves, falso);

  assert.equal(typeof cifrado, 'string');
  assert.deepEqual(descifrarClaves(cifrado, falso), claves);
});

test('devuelve null si no hay cifrado disponible', () => {
  assert.equal(cifrarClaves({ a: 'b' }, { isEncryptionAvailable: () => false }), null);
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/secret-store.test.mjs`
Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Crear el módulo**

```js
'use strict';

function cifrarClaves(apiKeys, safeStorage) {
  if (!apiKeys || Object.keys(apiKeys).length === 0) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(JSON.stringify(apiKeys)).toString('base64');
}

function descifrarClaves(texto, safeStorage) {
  if (typeof texto !== 'string' || texto.length === 0) return null;
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(texto, 'base64')));
  } catch {
    return null;
  }
}

module.exports = { cifrarClaves, descifrarClaves };
```

- [ ] **Step 4: Integrar en `main.cjs`**

Al leer `settings.json`:

```js
const { safeStorage } = require('electron');
const { cifrarClaves, descifrarClaves } = require('./secret-store.cjs');

if (datos.prefs?.apiKeysEnc) {
  const claves = descifrarClaves(datos.prefs.apiKeysEnc, safeStorage);
  if (claves) datos.prefs.apiKeys = { ...claves, ...(datos.prefs.apiKeys ?? {}) };
}
```

Al guardar:

```js
const prefsParaDisco = { ...state.prefs };
const claves = prefsParaDisco.apiKeys ?? {};
const cifrado = cifrarClaves(claves, safeStorage);
if (cifrado) {
  prefsParaDisco.apiKeysEnc = cifrado;
  delete prefsParaDisco.apiKeys;
}
```

El `payload.prefs` debe usar `prefsParaDisco` mezclado con `previo.prefs`; nunca escribir `apiKeys` en claro si `cifrado` existe.

- [ ] **Step 5: Tests y verificación manual**

Run: `node --test test/secret-store.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.
Manual: abre Ajustes, guarda una clave, cierra; `settings.json` no debe contener la clave en claro y la app debe seguir usándola.

- [ ] **Step 6: Commit**

```bash
git add electron/secret-store.cjs electron/main.cjs test/secret-store.test.mjs
git commit -m "fix(settings): cifrar claves API con safeStorage"
```

---

### Task 6: Fijar versiones del marketplace

**Files:**
- Modify: `assets/marketplace.json`
- Test: `test/marketplace.test.mjs`

- [ ] **Step 1: Añadir el test que falla**

```js
test('cada servidor fija una versión exacta', () => {
  for (const entrada of cargarCatalogo()) {
    const paquete = entrada.args.find((arg) => arg.startsWith('@modelcontextprotocol/'));
    assert.match(paquete, /@\d+\.\d+\.\d+$/, `sin versión exacta: ${paquete}`);
  }
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/marketplace.test.mjs`
Expected: FAIL; los paquetes no llevan `@versión`.

- [ ] **Step 3: Fijar versiones**

```json
[
  {
    "id": "filesystem",
    "name": "Filesystem",
    "description": "Lee y escribe archivos del workspace. Arranca en el directorio del proyecto.",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem@2.2.0", "."],
    "env": {}
  },
  {
    "id": "memory",
    "name": "Memory",
    "description": "Memoria persistente en un grafo de entidades y relaciones.",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory@2.1.0"],
    "env": {}
  },
  {
    "id": "sequential-thinking",
    "name": "Sequential Thinking",
    "description": "Descompone problemas en pasos de razonamiento revisables.",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking@2.1.1"],
    "env": {}
  },
  {
    "id": "everything",
    "name": "Everything",
    "description": "Servidor de referencia del protocolo, con herramientas de ejemplo.",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-everything@2.2.1"],
    "env": {}
  }
]
```

- [ ] **Step 4: Tests**

Run: `node --test test/marketplace.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/marketplace.json test/marketplace.test.mjs
git commit -m "fix(marketplace): fijar versiones de los servidores MCP"
```

---

### Task 7: Sanear siempre el entorno de `run_command`

**Files:**
- Modify: `electron/tools-extra.cjs:1409`
- Test: `test/hooks.test.mjs`

- [ ] **Step 1: Añadir el test que falla**

```js
test('sanearEntorno quita claves y tokens, pero conserva PATH', () => {
  const limpio = sanearEntorno({
    PATH: 'C:\\Windows',
    OPENCODE_API_KEY: 'sk-secreta',
    GITHUB_TOKEN: 'ghp_secreto',
    HOME: 'C:\\Users\\x',
  });

  assert.equal(limpio.PATH, 'C:\\Windows');
  assert.equal(limpio.HOME, 'C:\\Users\\x');
  assert.equal(limpio.OPENCODE_API_KEY, undefined);
  assert.equal(limpio.GITHUB_TOKEN, undefined);
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/hooks.test.mjs`
Expected: FAIL si no existe el test; si ya existe, PASS. En cualquier caso, el cambio de `tools-extra.cjs` aún no está hecho.

- [ ] **Step 3: Sanear siempre**

En `makeRunCommandTool`:

```js
const entorno = sanearEntorno(process.env);
```

Aunque `restrictToWorkspace` sea `false`, el comando no hereda claves. El cwd solo se restringe cuando el sandbox está activo.

- [ ] **Step 4: Tests**

Run: `node --test test/hooks.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/tools-extra.cjs test/hooks.test.mjs
git commit -m "fix(sandbox): no heredar credenciales en run_command"
```

---

### Task 8: Título sin pisar renombrados y Developer accesible

**Files:**
- Create: `electron/title-policy.cjs`
- Modify: `electron/main.cjs` (`sessions:rename`, generación de título), `renderer/settings.js` (`renderAccount`)
- Test: `test/title-policy.test.mjs`

**Interfaces:**
- Produces: `puedeRenombrarAutomatico(manuales: Set<string>, sessionId: string) -> boolean`.

- [ ] **Step 1: Test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { puedeRenombrarAutomatico } = require('../electron/title-policy.cjs');

test('no pisa un título renombrado a mano', () => {
  const manuales = new Set(['sesion-1']);
  assert.equal(puedeRenombrarAutomatico(manuales, 'sesion-1'), false);
  assert.equal(puedeRenombrarAutomatico(manuales, 'sesion-2'), true);
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/title-policy.test.mjs`
Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Crear el módulo**

```js
'use strict';

function puedeRenombrarAutomatico(manuales, sessionId) {
  return !manuales.has(sessionId);
}

module.exports = { puedeRenombrarAutomatico };
```

- [ ] **Step 4: Integrar en `main.cjs`**

```js
const { puedeRenombrarAutomatico } = require('./title-policy.cjs');
const titulosManuales = new Set();

ipcMain.handle('sessions:rename', async (_event, id, title) => {
  titulosManuales.add(String(id));
  const sessions = await getStore();
  await sessions.rename(String(id), String(title ?? '').slice(0, 120));
  return { ok: true };
});
```

En el `.then` del título:

```js
if (!puedeRenombrarAutomatico(titulosManuales, sessionId)) return;
await sessions.rename(sessionId, titulo);
```

- [ ] **Step 5: Hacer Developer accesible**

En `renderAccount`, junto a la fila de Google:

```js
makeRow({
  label: 'Developer',
  desc: 'Herramientas de desarrollo y sandbox avanzado.',
  control: makeButton({
    label: 'Abrir',
    onClick: () => selectSection('developer'),
  }),
}),
```

Así `Security Monitor`, `Workspace Sandbox` y `Sandbox Limits` dejan de estar escondidos sin añadir una entrada que Antigravity no tiene en la navegación.

- [ ] **Step 6: Tests**

Run: `node --test test/title-policy.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.
Manual: renombra una conversación y comprueba que el título automático no la pisa; abre Account → Developer.

- [ ] **Step 7: Commit**

```bash
git add electron/title-policy.cjs electron/main.cjs renderer/settings.js test/title-policy.test.mjs
git commit -m "fix(chat): respetar títulos manuales y exponer Developer"
```

---

### Task 9: Limpieza y test de `run_extension_code`

**Files:**
- Modify: `electron/marketplace.cjs` (quitar `entradaAPlugin`), `test/marketplace.test.mjs` (quitar su test), `renderer/styles.css` (quitar duplicados)
- Test: `test/extension-code.test.mjs`

- [ ] **Step 1: Escribir el test de extensión**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeRunExtensionCodeTool } = require('../electron/tools-extra.cjs');

test('run_extension_code inyecta args y ejecuta el wrapper', async () => {
  let comando = '';
  const tool = makeRunExtensionCodeTool(
    () => process.cwd(),
    async (args) => {
      comando = args.command;
      return { content: 'ok' };
    },
  );

  const resultado = await tool.execute({
    code: 'console.log(args.valor);',
    args: { valor: 7 },
  });

  assert.equal(resultado.content, 'ok');
  const ruta = comando.match(/"([^"]+\.mjs)"/)?.[1];
  assert.ok(ruta, 'el comando debe apuntar al script temporal');
  const script = await readFile(ruta, 'utf8');
  assert.match(script, /const args = JSON\.parse/);
  await unlink(ruta).catch(() => {});
});
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `node --test test/extension-code.test.mjs`
Expected: PASS si la implementación actual es correcta; si falla, corrige el wrapper antes de seguir.

- [ ] **Step 3: Borrar código muerto y CSS duplicado**

- Elimina `entradaAPlugin` de `electron/marketplace.cjs` y su export.
- Elimina su test de `test/marketplace.test.mjs`.
- Deja una sola regla `.settings__section-title`; borra `.settings__nav-header` y su selector en el tema claro, que no tienen ningún elemento.

- [ ] **Step 4: Tests**

Run: `node --test test/extension-code.test.mjs`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/marketplace.cjs test/marketplace.test.mjs renderer/styles.css test/extension-code.test.mjs
git commit -m "chore: probar run_extension_code y quitar código muerto"
```

---

## Verificación final

- [ ] `npm test` → 361+ tests, 0 fallos.
- [ ] `npx tsc -p tsconfig.json --noEmit` → sin errores.
- [ ] `npm run dist` → EXE generados.
- [ ] E2E empaquetado:
  - dos turnos que editen ficheros distintos → revertir ambos → ambos vuelven a su contenido original;
  - nueva conversación → editar → revertir → no toca ficheros de la anterior;
  - dos `run_command` en un turno → cada veredicto en su fila;
  - `settings.json` sin claves en claro;
  - Account → Developer abre sandbox/security;
  - marketplace instala un servidor con versión fijada.
- [ ] `git status` limpio.

## Self-review

- **Cobertura:** los 12 hallazgos tienen tarea: 1/2/4/5/6/7/8/9/10/11/12. El hallazgo 3 se cubre con el helper y la prueba manual.
- **Placeholders:** no hay TBD; cada paso tiene código o comando.
- **Tipos:** `restoreSnapshots`, `resetSessionState`, `chooseRow`, `guardarEnCola`, `cifrarClaves`, `descifrarClaves` y `puedeRenombrarAutomatico` se usan con las firmas definidas.
- **Riesgo residual:** el sandbox sigue apagado por defecto para no romper la paridad con Antigravity; este plan solo elimina credenciales del entorno. AppContainer, firma y auto-actualización quedan fuera.

## Handoff

Plan guardado en `docs/superpowers/plans/2026-11-10-remediacion-auditoria.md`.
