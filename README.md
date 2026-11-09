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

## Qué incluye

### Agente

- **22 proveedores** de modelo con autodetección de modelos y claves pegables
  desde Ajustes (ver `docs/proveedores.md`)
- Catálogo de herramientas abierto: lectura/escritura de código y cuadernos,
  búsqueda, terminal en segundo plano, MCP, memoria, skills, subagentes (en
  paralelo y anidados de solo lectura con presupuesto), planes,
  generación de imágenes y **14 acciones de navegador** (`open`, `read`,
  `snapshot`, `click`, `fill`, `type`, `press`, `select`, `scroll`, `hover`,
  `wait`, `batch`, `navigate`, `eval`) sobre el Chromium integrado
- Permisos: preset global, permisos por herramienta y reglas de red
- **Sandbox de workspace opcional**: rutas de fichero dentro del proyecto, cwd de
  comandos fijado y variables de entorno con credenciales fuera del proceso
- **Diffs con aprobación** antes de escribir
- **Checkpoints**: deshacer restaura los ficheros en disco
- Skills inyectables, perfil local y servidores MCP como plugins

### Editor

- **Monaco** con tema oscuro propio y resaltado por lenguaje
- **LSP**: completado, diagnósticos, ir a definición, renombrar, formatear
  (TypeScript/JavaScript incluido en el proyecto; python/go/rust configurables)
- Pestañas, estado de guardado, `Ctrl+S`

### Resto del IDE

- **Terminal** integrada con `cd` persistente (`Ctrl+\``)
- **Git**: rama, ficheros modificados, stage, commit y diff por fichero
- Panel de resumen con Files, Plugins, Review y Terminal
- Navegador de turnos, barra de acciones por respuesta, reacciones
- Comandos `/` y menciones `@` en el composer
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
