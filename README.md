<p align="center">
  <img src="assets/readme-header.png" alt="Opengravity — IDE open source con agentes para cualquier modelo" width="100%">
</p>

# Opengravity

IDE de escritorio con agentes **multi-proveedor**: la misma experiencia de
asistente de código, funcionando con modelos locales o en la nube, sin atarte a
un vendor.

Aplicación Electron propia — no una extensión — con **Monaco** como editor,
**LSP** para inteligencia de código, **MCP** para herramientas, **git** y
**terminal** integrados.

> Proyecto independiente. No contiene código, assets ni branding de ningún
> producto propietario. Ver `docs/analysis/` y `docs/design-tokens.md` para el
> análisis de referencia que motivó las decisiones de diseño.

## Arrancar

Requiere **Node 22+**.

```bash
npm install
node node_modules/electron/install.js   # si npm bloquea el postinstall
npm run app
```

`npm run app` compila el motor TypeScript, empaqueta Monaco y abre la ventana.

## Cuenta de Google y Flow

La generación de imágenes usa **Google Flow** con la sesión del navegador
integrado. No hay clave de API ni coste adicional:

1. Abre **Ajustes › Google** y pulsa **Conectar**.
2. Inicia sesión con tu cuenta en la ventana que se abre. Flow se abre al
   terminar.
3. Vuelve a la app y pide una imagen con `generate_image`.

La sesión se guarda en la partición persistente del navegador integrado, así
que solo hay que iniciar sesión una vez. Si no hay cuenta conectada, la
herramienta devuelve las instrucciones en vez de abrir un login oculto.

## Crear los ejecutables (Windows)

```bash
npm run dist
```

Deja dos ficheros en `release/`:

- **`Opengravity Setup 0.1.0.exe`**: instalador (elige carpeta, acceso directo
  en el menú Inicio y en el escritorio).
- **`Opengravity 0.1.0.exe`**: portable, se ejecuta sin instalar.

`npm run dist:dir` genera solo la aplicación desempaquetada (`release/win-unpacked`),
útil para comprobar el contenido sin instalar. Los ejecutables no se versionan:
`release/` está en `.gitignore`.

Antes de repartir el resultado, `npm run verify:release` comprueba que los
ejecutables lleven dentro el código de hoy (comparando bytes, no fechas), que
las fuentes vayan con su licencia y deja las **huellas SHA-256** en
`release/SHA256SUMS.txt`. **Qué falta todavía y por qué: ver
[`docs/estado.md`](docs/estado.md).**

### Descargar sin sustos (y sin pagar un certificado)

Los ejecutables **no van firmados**: un certificado Authenticode cuesta dinero
cada año y este proyecto es libre. Windows mostrará «editor desconocido» al
instalar; es lo esperado, no un error. Lo que sí puedes hacer es comprobar que
el fichero que bajaste es el que se publicó:

```powershell
# 1) Huella del fichero descargado
Get-FileHash "Opengravity Setup 0.1.0.exe" -Algorithm SHA256

# 2) Compárala con la que se publicó junto a la release
Get-Content SHA256SUMS.txt

# 3) Si coincide, quita la marca de «descargado de internet»
Unblock-File "Opengravity Setup 0.1.0.exe"
```

Si la huella no coincide, no lo instales: no es el fichero publicado. Y si
prefieres no instalar nada, siempre puedes compilar desde el código
(`npm run dist`) y comparar.

## Qué incluye

### Agente

- **22 proveedores** de modelo con autodetección de modelos y claves pegables
  desde Ajustes (ver `docs/proveedores.md`); detección en paralelo con timeout,
  refresco manual y claves compartidas entre OpenCode Zen y Go
- **Reglas del workspace**: `AGENTS.md` y `.agents/rules/*.md` entran al prompt
  de sistema con presupuesto propio (20 000 tokens por defecto)
- **Perfiles de trabajo** (`Interface Layout`): *Knowledge Work* responde como
  documento (informe, resumen, plan) y *Software Engineering* lee, edita y
  verifica código. Cambia el bloque de instrucciones del prompt
  (`electron/personas.cjs`), igual con un modelo local que con uno de la nube.
  No restringe herramientas: medido en el original, tampoco lo hace
- **Pensamiento extendido** con un botón en el chat que solo aparece si el
  modelo actual lo admite (Claude 3.7+/4/5 y Gemini 2.5+); no cambia de modelo
  ni lo activa en otros
- **Subagentes en paralelo con espera máxima**: varias ramas a la vez, cada una en su
  worktree si escribe, y lo que no llega al presupuesto se cancela y se fusiona el
  resto (Ajustes › Ejecución › *Subagent wait*)
- **Memoria por patrón de fichero**: una memoria puede declarar `globs` y entra sola
  cuando el agente escribe en un fichero que encaja, en vez de repetirla cada turno
- Catálogo de herramientas abierto: lectura/escritura de código y cuadernos,
  búsqueda, terminal en segundo plano, MCP, memoria, skills, subagentes (en
  paralelo y anidados de solo lectura con presupuesto), planes,
  `run_extension_code` para extensiones temporales, generación de imágenes y
  **14 acciones de navegador** (`open`, `read`,
  `snapshot`, `click`, `fill`, `type`, `press`, `select`, `scroll`, `hover`,
  `wait`, `batch`, `navigate`, `eval`) sobre el Chromium integrado
- Permisos: preset global, permisos por herramienta y reglas de red
- **Sandbox de workspace opcional**: rutas de fichero dentro del proyecto, cwd de
  comandos fijado, credenciales fuera del entorno y límites de proceso (Job
  Object en Windows; grupo + `ulimit` en POSIX), con terminación del árbol.
  AppContainer queda fuera: un comando normal necesita el toolchain del sistema,
  así que haría falta un contenedor con su propio Node
- **Diffs con aprobación** antes de escribir
- **Checkpoints**: deshacer restaura los ficheros en disco
- Skills inyectables, perfil local y servidores MCP como plugins, con
  **catálogo local** instalable desde Ajustes (sin cuentas, planes ni pagos)

### Editor

- **Monaco** con tema oscuro propio y resaltado por lenguaje
- **LSP**: completado, diagnósticos, ir a definición, renombrar, formatear
  (TypeScript/JavaScript incluido en el proyecto; python/go/rust configurables)
- **Selector de proyecto**: recientes, This Computer con búsqueda, New Project
  y No Project; la conversación guarda su proyecto aparte del workspace.
- Pestañas, estado de guardado, `Ctrl+S`

#### Servidores LSP

La app no empaqueta servidores externos. Para Python, Go y Rust hay que tenerlos
instalados y visibles:

- **Go**: `go` y `gopls`. La app añade al `PATH` las rutas estándar, `GOROOT`,
  `GOPATH/bin`, `GOBIN` y los SDK de `%USERPROFILE%\sdk`. Para una instalación
  arbitraria, define `GOROOT`, añade su carpeta `bin` al `PATH` o fija la ruta
  en **Ajustes › Developer › Go**.
- **Python**: `pylsp` o `pyright-langserver`. La app prefiere el primero; si no
  hay ninguno, muestra un error al abrir un `.py`.
- **Rust**: `rust-analyzer` en el `PATH`.

No se escanean discos en busca de estos binarios: una ruta que no esté en el
entorno o en las rutas anteriores no se detecta. `lspServers` permite fijar el
comando y los argumentos de cada servidor.

### Resto del IDE

- **Terminal** integrada con `cd` persistente (`Ctrl+\``)
- **Git**: rama, ficheros modificados, stage, commit y diff por fichero
- Panel de resumen con Files, Plugins, Review y Terminal
- Navegador de turnos, barra de acciones por respuesta, reacciones
- Comandos `/` y menciones `@` en el composer
- **Interfaz bilingüe**: inglés y español, con detección del idioma del sistema y selector en Ajustes › Application
- Búsqueda de conversaciones, sesiones persistentes en JSONL

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+Enter` | Enviar mensaje |
| `Ctrl+N` | Nueva conversación |
| `Ctrl+M` | Selector de modelo |
| `Ctrl+\`` | Terminal |
| `/` | Paleta de comandos |
| `@` | Mencionar fichero |
| `Ctrl+S` | Guardar (editor) |
| `Ctrl+Space` | Autocompletado |
| `F12` | Ir a definición |
| `F2` | Renombrar símbolo |
| `Shift+Alt+F` | Formatear |

## Estructura

```
app
├── electron/
│   ├── main.cjs          ventana, IPC, agente, git, terminal, LSP, protocolo app://
│   ├── preload.cjs       puente contextBridge
│   ├── tools-extra.cjs   herramientas del proceso principal
│   ├── diff.cjs          diff por líneas
│   └── lsp.cjs           cliente LSP (Content-Length)
├── renderer/
│   ├── index.html        estructura de la interfaz
│   ├── styles.css        tokens y layout
│   ├── app.js            lógica de la UI
│   ├── settings.js       panel de ajustes
│   ├── markdown.js       markdown → HTML
│   ├── highlight.js      resaltado para el chat
│   ├── icons.js          set de iconos SVG
│   ├── monaco-entry.js   entrada de Monaco (se empaqueta)
│   └── monaco/           bundle generado por build:monaco
├── scripts/build-monaco.mjs
├── src/                  motor: proveedores, agente, MCP, persistencia
└── docs/
    ├── analysis/         arquitectura de referencia
    ├── design-tokens.md  paleta, métricas y estructura de la UI
    └── proveedores.md    catálogo de endpoints
```

El renderer no tiene acceso a Node: todo pasa por IPC con nombres
`dominio:accion`. El motor vive en el proceso principal.

## CLI

Para automatizar o depurar el motor sin interfaz:

```bash
npm run dev -- "resume este proyecto"
npm run dev -- --provider openai --model gpt-4o-mini "lista los ficheros"
npm run dev -- --list-providers
npm run dev -- --provider groq --list
npm run dev -- --mcp-command npx --mcp-arg -y \
  --mcp-arg @modelcontextprotocol/server-filesystem --mcp-arg . --tools
npm run dev -- --list-sessions
```

### Headless (estilo `agy -p`)

```bash
# Respuesta limpia por stdout; diagnósticos por stderr.
npm run dev -- -p "¿qué hace src/agent/loop.ts?" --output-format text

# Un sobre JSON con conversación, estado y tokens.
npm run dev -- -p "resume el proyecto" --output-format json

# NDJSON: init → step_update → result.
npm run dev -- -p "busca los TODO" --output-format stream-json

# Conversación persistente por stdin: un result por prompt.
printf '%s\n' \
  '{"event":"user","message":{"content":"¿qué hace src/agent/loop.ts?"}}' \
  '{"event":"user","message":{"content":"resume lo anterior"}}' \
  | npm run dev -- --input-format stream-json --output-format stream-json

# Continuar la última conversación.
npm run dev -- -p "ahora arregla el primero" -c

# Cambiar esfuerzo/modo y permitir escrituras en headless.
npm run dev -- -p "arregla el test" --effort high --mode accept-edits
npm run dev -- -p "ejecuta los tests" --sandbox --mode auto
```

### TUI

Sin encargo y con una terminal interactiva, `npm run dev` abre la TUI de chat
a pantalla completa:

```bash
npm run dev
```

La TUI completa acepta `/model`, `/mode`, `/tools`, `/clear`, `/help` y `/exit`.
Para volver a la TUI de línea con todos los comandos de sesión:

```bash
OPENGRAVITY_LINE_TUI=1 npm run dev
```

En la **TUI de línea**:

- `/model <id>` cambia de modelo; `/tools` lista el catálogo.
- `/mode default|accept-edits|auto|plan` cambia permisos en caliente.
- `/permissions`, `/mcp`, `/skills`, `/agents`, `/context` y `/config` muestran el estado.
- `/panel` abre una TUI de paneles a pantalla completa (Estado, Sesiones, Herramientas, Skills, Agentes, Permisos y MCP); `←/→` cambia de pestaña, `↑/↓` desplaza y `q` sale.
- `/diff`, `/resume`, `/rename`, `/fork`, `/rewind` y `/open` trabajan sobre el workspace;
  `/rewind` restaura los ficheros tocados por las herramientas de edición y, en
  repos git, los cambios de `run_command` (no binarios, ignorados ni fuera de git).
- `/btw` hace una pregunta lateral sin tocar el hilo; `/swarm` y `/teamwork` lanzan
  tres subagentes; `/plan` y `/goal` orientan el turno.
- `/help` y `/exit`.
- Las acciones sensibles piden confirmación `[y/N]`; `plan` es solo lectura.
- Las claves cifradas de la app (`apiKeysEnc`) se descifran con `safeStorage` al
  arrancar el CLI; no hace falta volver a escribirlas.

### Permisos y ajustes

El CLI lee el mismo `settings.json` que la app (`%APPDATA%/Opengravity` en
Windows, `~/.config/Opengravity` en Linux, `~/Library/Application Support/Opengravity`
en macOS). Los flags explícitos mandan. `--sandbox` confina las herramientas al
workspace y `--add-dir` añade raíces adicionales.

En headless no hay prompt: una acción que requiere aprobación se rechaza. Usa
`--dangerously-skip-permissions`, un modo más amplio (`accept-edits`, `auto`
con `--sandbox`) o reglas en `settings.json`:

```json
{
  "permissions": {
    "allow": ["command(git)", "command(regex:^npm run (build|lint|test))"],
    "deny": ["write_file(.env)"]
  }
}
```

El catálogo incluye edición, búsqueda, comandos en segundo plano, tests,
workflows, memoria, skills, `invoke_subagent` y `present_plan`; navegador y Flow
necesitan Electron y no se registran en el CLI. `--json-schema` valida el JSON
con Ajv, no solo lo parsea.

## Licencia

MIT. Ver `LICENSE`.

## Aviso

Este proyecto es para construir software propio. Si lo usas como referencia para
interoperar con otro producto, respeta sus licencias y no copies su código,
assets ni marcas.


## Tests

```bash
npm test
```

`pretest` compila antes de correr, así que la suite nunca prueba un `dist` viejo.
Sin dependencias nuevas: usa `node:test`, que viene con Node 22.

Cubre el motor del agente, no la interfaz:

| Fichero | Qué prueba |
|---|---|
| `cron.test.mjs` | Expresiones de 5 campos, validación y próxima ejecución |
| `guardian.test.mjs` | Severidad de la rúbrica A–M y modos del monitor |
| `hooks.test.mjs` | Reescritura de rutas, redacción de secretos, truncado, hooks de texto |
| `skills.test.mjs` | Frontmatter, descubrimiento y que el cuerpo no entre en el prompt |
| `code-items.test.mjs` | Símbolos en TypeScript, Python y Go |
| `trajectory.test.mjs` | Snapshots, reversión y persistencia tras reiniciar |
| `subagents.test.mjs` | Definiciones, búsqueda y `kill` selectivo |
| `plan-mode.test.mjs` | Las cuatro fases del ciclo y sus compuertas |
| `loop.test.mjs` | Compuerta, inyección, monitor de ritmo, paralelismo y timeouts |
