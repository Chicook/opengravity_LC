# Paridad funcional con el agente de Antigravity

Comparación del inventario de herramientas documentado en
`docs/analysis/agente-cascade.md` (extraído de su `language_server.exe`) contra lo
que Opengravity implementa hoy.

## Herramientas

### Lectura

| Antigravity | Opengravity | Estado |
|---|---|---|
| `read_file` / `view_file` | `read_file` | ✅ |
| `list_directory` | `list_directory` | ✅ |
| `grep_search` | `search_files` | ✅ |
| `file_search` | `search_files` | ✅ |
| `codebase_search` (semántica) | `search_code` | ✅ |
| `read_url` | `fetch_url` / `open_url` | ✅ |
| `search_web` | `search_web` | ✅ |
| `view_code_item` | `view_code_item` | ✅ |
| `read_resource` / `list_resources` | ambos | ✅ |

### Escritura

| Antigravity | Opengravity | Estado |
|---|---|---|
| `write_file` | `write_file` | ✅ |
| `edit_file` | `edit_file` | ✅ |
| `multi_replace` | `multi_replace` | ✅ |
| `edit_notebook` | — | ❌ **falta** |
| `run_extension_code` | — | ❌ falta |

### Ejecución

| Antigravity | Opengravity | Estado |
|---|---|---|
| `run_command` (no bloquea) | `run_command` | ✅ |
| `command_status` | `command_status` | ✅ |

### Subagentes

| Antigravity | Opengravity | Estado |
|---|---|---|
| `define_subagent` | `define_subagent` | ✅ |
| `invoke_subagent` (array, concurrente) | `invoke_subagent` | ✅ |
| `manage_subagent` (`list`/`list_peers`/`kill`/`kill_all`) | `manage_subagent` | ⚠️ revisar `list_peers` |
| `send_message` (`@children`) | `send_message` | ✅ |
| `manage_task` | `manage_task` | ✅ |

### Interacción

| Antigravity | Opengravity | Estado |
|---|---|---|
| `ask_user_question` | `ask_user_question` | ✅ |
| `notify_user` (cron, jitter, cancelOn) | `notify_user` | ✅ |
| `present_plan` | `present_plan` | ✅ |
| `generate_image` | — | ❌ falta |

### Plan y skills

| Antigravity | Opengravity | Estado |
|---|---|---|
| `enter_plan_mode` / `exit_plan_mode` | ambos | ✅ |
| `skill` (progressive disclosure) | `skill` | ✅ |
| `list_prompts` / `use_prompt` | ambos | ✅ |

## Huecos concretos, por orden de impacto

1. **`edit_notebook`** — celdas de Jupyter.
2. **`generate_image`** — generación de imágenes.

`send_message` se implementó después: bandeja por subagente en `subagents.cjs`,
recogida entre pasos mediante el hook `mensajeDeSistema` que ya existía.

`multi_replace` se implementó después de este informe (`electron/multi-replace.cjs`,
18 pruebas). `codebase_search` **sí existía** como `search_code`: este informe lo
dio por ausente por un error de búsqueda, no de código.

## Mecanismos del motor

Documentados en `docs/analysis/agente-cascade.md`; todos implementados:

| Mecanismo | Dónde |
|---|---|
| Trayectoria con pasos tipados y revert selectivo | `electron/trajectory.cjs` |
| Hooks que reescriben argumentos y resultados | `electron/hooks.cjs` |
| Monitor de seguridad pre-tool, rúbrica A–M | `electron/guardian.cjs` |
| Clasificador en cascada de dos niveles | `src/agent/classifier.ts` |
| Monitor de nudge por velocidad de evidencia | `electron/main.cjs` |
| Memoria entre conversaciones | `electron/memory.cjs` |
| Subagentes como subtrayectorias | `electron/subagents.cjs` |
| Ciclo de plan planner↔executor | `electron/plan-mode.cjs` |
| Skills desde disco con frontmatter | `electron/skills.cjs` |
| `run_workflow` para scripts | `electron/main.cjs` |
| `notify_user` con cron propio | `electron/cron.cjs` |

## Conclusión

**El motor está completo**: los once mecanismos que hacen especial a Antigravity
están replicados y con pruebas. Lo que falta es **inventario de herramientas**,
no arquitectura: quedan `edit_notebook` y `generate_image`.
`multi_replace`, `send_message` y `codebase_search` (como `search_code`) ya están.

## Actualización (2026-11-10)

Auditoría del orquestador y las herramientas, verificada con pruebas y en vivo:

- `send_message` estaba **solo en el catálogo de Ajustes**: el agente real no lo
  recibía. Ahora se registra en `guardedTools` y llega a los subagentes vivos.
- El bucle serializa todas las mutaciones (`multi_replace`, `edit_notebook`,
  `run_workflow`, `generate_image`) y toda la familia `browser_`; el timeout se
  calcula por herramienta, no por el nombre de la primera del lote.
- La familia de navegador pasa de 4 a 14 herramientas, con el Chromium
  integrado: `navigate`, `snapshot`, `fill`, `type`, `press`, `select`, `scroll`,
  `hover`, `wait` y `batch`, además de `open`, `read`, `click` y `eval`.
- Permisos: `edit_notebook` solo pide permiso en sus acciones de escritura y
  guarda checkpoint; `run_workflow` se trata como comando; `multi_replace`
  muestra el diff real (antes usaba `content`, que no existe, y pintaba el
  fichero entero como borrado).
- Fuera a propósito: `run_extension_code` (API propietaria; se cubre con
  `run_workflow` y MCP) y `search_marketplace` (el marketplace está excluido).
- Subagentes de un solo nivel, sin delegación recursiva. Los grants por
  herramienta ya están: `define_subagent.tools` solo puede quitar herramientas
  del nivel permitido; nunca da escritura ni MCP por sí solo.
