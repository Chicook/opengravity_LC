# Arquitectura de referencia — IDE con agentes

Análisis de un IDE con agentes comercial (v2.26.0, Electron + servicio Go),
producido con análisis estático del bundle y observación de runtime.

Cada afirmación está marcada: **[obs]** observado, **[inf]** inferido,
**[unk]** desconocido.

## 1. Procesos

| Componente | Tecnología | Función |
|---|---|---|
| Shell de escritorio | Electron (`app.asar`) | Ventanas, menús, updater, integración SO |
| Host bridge | HTTP local `:55356` | Puente shell ↔ servicio de lenguaje |
| Servidor de UI | HTTPS local `:55357` | Sirve la UI; las ventanas cargan de aquí **[obs]** |
| Servicio de lenguaje | Binario Go | Auth, modelos, agentes, persistencia, CDP **[obs]** |
| Sidecar Node | `bin/agy-node.cmd` | Runtime Node embebido **[obs]** |
| MCP navegador | `chrome-devtools-mcp` | Herramientas de navegador **[obs]** |

Consecuencia de diseño: **la UI se sirve por HTTP, no desde `file://`**. Eso
explica que el análisis estático apenas pudiera atribuir ficheros a Electron
(25 de 666) — el renderer no es un fichero local.

## 2. IPC del shell

**31 canales** `ipcMain.handle`, patrón `dominio:accion` **[obs]**:

- `window:*` (12): close, minimize, maximize, unmaximize, is-maximized, zoom-in,
  zoom-out, reset-zoom, set-title-bar-overlay, toggle-devtools, show-context-menu,
  close-context-menu
- `updater:*` (4): get-state, check-for-updates, apply, quit-and-install
- `dialog:*` (2): open-workspace, open-workspaces
- `shell:*` (2): open-external, reveal-in-file-picker
- `storage:*` (2): get-items, update-items
- `notification:*` (2): send, open-system-preferences
- `wsl:*` (2): get-state, connect
- Únicos (5): `agent:update-active-count`, `extensions:send-authorities`,
  `ide:is-installed`, `webview:execute-js-isolated-world`, `logs:electron`

**Lectura:** son canales genéricos de un IDE, no lógica de negocio. Solo uno
(`agent:update-active-count`) toca la capa de agentes, lo que indica que los
agentes **no** viven en el proceso principal.

38 observaciones de validación de `sender` **[obs]**. El análisis estático no
prueba la política de autorización completa **[unk]**.

## 3. Capa de modelo

El modelo **no** se llama desde el cliente Electron. Se llama desde el servicio
Go, que habla con el backend del vendor **[obs]**:

```
https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
```

Auth observada: `SetEnableBusinessLogin`, `SetProjectID`, `SetLocation`,
`SetUserTier` — modelo de Google Cloud Code **[obs]**.

**Decisión de diseño derivada:** el proveedor de modelo es una pieza
intercambiable detrás de una interfaz. De ahí `ModelProvider` en
`src/providers/types.ts`. No hace falta replicar el protocolo interno del
vendor: hace falta una interfaz propia con adaptadores a APIs públicas.

## 4. Capa de agentes

### Cómo el agente opera el editor
```
[CDP Discovery] Successfully discovered Electron WS URL:
  ws://127.0.0.1:58974/devtools/browser/...
```
El servicio de lenguaje se conecta por **Chrome DevTools Protocol** al propio
Electron **[obs]**. El agente no tiene acceso privilegiado al editor: usa CDP
como cualquier herramienta externa. Replicable con `chrome-devtools-mcp` o
`playwright-core`.

### Herramientas
El IDE empaqueta `chrome-devtools-mcp` (MIT) **[obs]**. MCP es el mecanismo de
herramientas. De ahí `src/tools/mcp-adapter.ts`.

### Persistencia
`Creating trajectory store manager with proto store and SQLite store` **[obs]**.
Conversaciones en protobuf sobre SQLite.

### Extensiones
Marketplace de plugins con migraciones versionadas y `PERMISSION_GRANTS_V2`
**[obs]**. Modelo de permisos por herramienta ya resuelto por el vendor; a
replicar cuando haya usuarios.

## 5. Qué es propietario

| Pieza | Estado | ¿Bloquea la réplica? |
|---|---|---|
| Servicio de lenguaje (Go) | Binario propietario | **No** — se reimplementa |
| Protocolo interno `v1internal:*` | Solo observable por tráfico o análisis nativo | **No** — no hace falta |
| UI bundle | Embebido en el binario Go | **No** — UI propia sobre Code OSS |
| `chrome-devtools-mcp` | **MIT** | No — reutilizable |
| MCP, Connect, protobuf | **Abiertos** | No — reutilizables |

## 6. Mapa de reutilización

| Necesidad | Pieza abierta | Código propio |
|---|---|---|
| Editor, LSP, terminal | Code OSS (MIT) | — |
| Herramientas del agente | MCP | adaptador |
| Navegador / CDP | chrome-devtools-mcp (MIT) | — |
| Transporte cliente↔servidor | Connect/protobuf | — |
| **Modelo** | — | **`ModelProvider` + adaptadores** |
| **Bucle del agente** | — | **`src/agent/loop.ts`** |
| Persistencia | SQLite | esquema |
| Permisos de herramientas | — | política |

## 7. Orden de implementación

1. `ModelProvider` con 2 adaptadores (Ollama + OpenAI) — valida la abstracción sin coste
2. Bucle de agente mínimo — hecho
3. Puente CDP al editor — reutiliza `chrome-devtools-mcp`
4. Persistencia SQLite
5. Plugins y permisos
6. UI sobre Code OSS

## 8. Límites de este análisis

- Estático inerte: no prueba ejecución, reachability ni defaults **[unk]**.
- 38 679 unknowns semánticos en el bundle; 591 de aplicación **[obs]**.
- Los hallazgos describen una versión concreta y pueden quedar obsoletos.
- No se extrajo ni se copió código del producto analizado.
