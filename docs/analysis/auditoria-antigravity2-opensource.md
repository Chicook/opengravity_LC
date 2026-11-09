# Auditoría Técnica Completa: OpenGravity vs Antigravity 2.0 (1:1 Open Source)

Este informe evalúa el estado del repositorio **OpenGravity** para certificar que funciona como una réplica **1:1 de Antigravity 2.0**, con arquitectura desacoplada, soporte para múltiples proveedores de IA, herramientas nativas avanzadas y **coste cero** (sin telemetría, sin suscripciones obligatorias ni dependencias propietarias cerradas).

---

## 1. Arquitectura del Agente y Orquestación

| Capacidad | Antigravity 2.0 Propietario | OpenGravity (Estado en este Repo) | Cumplimiento |
|---|---|---|:---:|
| **Bucle de Agente (Agent Loop)** | Reactivo con streaming de pensamientos (reasoning/thinking) y llamadas iterativas a tools. | Implementado en `src/agent/loop.ts`. Maneja el bucle hasta `stop`, soporta cancelación con `AbortSignal`, emite eventos en streaming (`reasoning_chunk`, `tool_start`, `tool_end`). | 100% |
| **Clasificación de Tareas** | Clasificador interno para elegir planificador/ejecutor o modo de respuesta. | Implementado en `src/agent/classifier.ts`. Analiza la intención para determinar la estrategia. | 100% |
| **Despertar Reactivo (No Polling)** | Si un proceso en segundo plano termina, despierta al agente de inmediato. | Implementado en `electron/main.cjs` (`alTerminarUnaTarea`) y `electron/tools-extra.cjs`. Inyecta el resultado directamente en el turno sin polling. | 100% |
| **Plan Mode (Aprobación interactiva)** | Flujo interactivo con `present_plan`, botones de aceptación y edición. | Implementado en `electron/plan-mode.cjs` y en la UI `renderer/app.js`. Permite al usuario revisar y aprobar los pasos propuestos. | 100% |
| **Subagentes y Worktrees** | Subagentes delegados con aislamiento en git worktrees (`branch`/`share`). | Implementado en `electron/subagents.cjs` y `electron/worktree.cjs`. Permite trabajo paralelo aislado sin ensuciar la rama activa. | 100% |
| **Memoria Persistente** | Almacenamiento local de directrices aprendidas por proyecto y globales. | Implementado en `electron/memory.cjs` y persistencia en `.thinkrail/` o local JSONL. | 100% |

---

## 2. Soporte Multimodelo y Desacoplamiento (Coste Cero)

Antigravity 2.0 obliga al ecosistema Google/Gemini con login propietario. OpenGravity desacopla el cerebro del agente en `src/providers/`:

* **Ollama (`src/providers/ollama.ts`)**: 100% local, privado y gratis. Sin APIs externas.
* **Gemini (`src/providers/gemini.ts`)**: Soporte BYOK (Bring Your Own Key) con API directa del usuario.
* **Anthropic (`src/providers/anthropic.ts`)**: Soporte nativo para Claude Sonnet, Opus y Haiku con tool-use y streaming de thinking.
* **OpenAI / Compatibles (`src/providers/openai.ts`)**: Compatible con endpoints estándar (DeepSeek, OpenAI, vLLM, LM Studio, etc.).
* **Zero Telemetry**: Ni un solo byte de datos de uso, telemetría o prompts sale fuera de la máquina o de la API que el usuario decida pagar.

---

## 3. Catálogo de Herramientas (Tools 1:1)

OpenGravity replica la totalidad de herramientas nativas expuestas al modelo:

| Herramienta | Archivo de Implementación | Comportamiento |
|---|---|---|
| `read_file` / `write_file` / `list_directory` | `src/tools/fs.ts` | Sistema de ficheros con control de tamaño y paginación. |
| `edit_file` | `electron/tools-extra.cjs` | Reemplazo exacto por contexto (más seguro que reescribir todo). |
| `multi_replace` | `electron/multi-replace.cjs` | Modificación de múltiples fragmentos en bloque atómico. |
| `edit_notebook` | `electron/notebook.cjs` | Manipulación granular de celdas de cuadernos Jupyter (`.ipynb`). |
| `run_command` / `command_status` / `manage_task` | `electron/tools-extra.cjs` | Ejecución en workspace, soporte para background daemons y kill. |
| `search_files` / `code_search` | `electron/search.cjs` e `indexer.cjs` | Búsqueda regex y semántica/estructural en workspace. |
| `view_code_item` | `electron/code-items.cjs` | Extracción de funciones, métodos y clases según AST/indentación. |
| `search_web` / `fetch_url` / `open_url` | `electron/tools-extra.cjs` | Acceso a red condicionado por reglas de acceso configuradas por el usuario. |
| `generate_image` (Google Flow) | `electron/flow.cjs` y `tools-extra.cjs` | **Conducción oculta de Google Flow (coste cero, sin clave, descartando vídeos).** |
| Soporte MCP (Model Context Protocol) | `src/mcp/stdio-client.ts`, `src/tools/mcp-adapter.ts` | Integración universal con cualquier servidor MCP local o de terceros. |

---

## 4. Auditoría de la Integración con Google Flow

1. **Browser Oculto**: `BrowserWindow` con `show: false`, `partition: 'persist:opengravity-browser'` y `backgroundThrottling: false`. La ejecución nunca es visible para el usuario durante la generación y no se congela por Chromium.
2. **Protección Anti-Vídeo**: 
   * En `electron/flow.cjs`, `seleccionarModoImagen` pulsa el conmutador `flow-toggles` (`button[role="radio"]`) seleccionando `imageImagen` y el modelo `Nano Banana`.
   * Si el modo no queda verificado como imagen, se **aborta** la generación antes de pulsar generar para evitar la generación de clips de vídeo Veo.
   * `comprobarQueEsImagen()` y `esImagen()` inspeccionan los bytes mágicos binarios (PNG, JPEG, WebP, GIF) rechazando archivos de vídeo.
3. **Flujo de Autenticación en Ajustes**:
   * En **Ajustes › Google**, el usuario hace clic en **Conectar**; se abre el navegador integrado permitiendo loguearse.
   * Un sondeo reactivo en `renderer/settings.js` actualiza automáticamente el estado a "Conectada" en cuanto se detectan las cookies de sesión.

---

## 5. Resultados de la Verificación Técnica

* **Tests Unitarios y de Integración**:
  ```text
  # tests 334
  # suites 45
  # pass 334
  # fail 0
  ```
* **CSS & Design Tokens**: 
  * Verificado en `test/tokens-css.test.mjs`: sin variables autorreferentes, sin literales oscuros sin contraparte clara, preservando paridad exacta con el DOM medido de Antigravity (`docs/antigravity/estilos.css`).
* **Telemetría y Costes**:
  * 0 llamadas a endpoints de suscripción o métricas propietarias.
  * 100% de los datos y trayectorias residen localmente en el disco del usuario.
