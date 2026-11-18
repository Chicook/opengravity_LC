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
| `edit_notebook` | `edit_notebook` | ✅ |
| `run_extension_code` | `run_extension_code` | ✅ |

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
| `generate_image` | `generate_image` | ✅ |

### Plan y skills

| Antigravity | Opengravity | Estado |
|---|---|---|
| `enter_plan_mode` / `exit_plan_mode` | ambos | ✅ |
| `skill` (progressive disclosure) | `skill` | ✅ |
| `list_prompts` / `use_prompt` | ambos | ✅ |

## Huecos concretos, por orden de impacto

**Ninguno en el inventario de herramientas: el catálogo está completo.**

Esta sección decía antes que faltaban `edit_notebook` y `generate_image`, y el
resumen de abajo contaba `run_extension_code` como exclusión. Las tres cosas están
implementadas y registradas para el agente (`electron/main.cjs`: `makeEditNotebookTool`
y `makeGenerateImageTool` en el catálogo; `electron/tools-extra.cjs:1291`:
`run_extension_code`), así que el texto anterior estaba desfasado y se corrige aquí.

Lo que sí queda fuera de alcance es la **cuenta de Google** que usa
`generate_image`: la herramienta existe, pero depende de que el usuario conecte su
sesión, y se apoya en una interfaz web ajena que puede cambiar sin aviso.

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

**El motor está completo** y el inventario de herramientas también: los once
mecanismos que hacen especial a Antigravity están replicados y con pruebas, y las
herramientas que este informe daba por ausentes (`edit_notebook`,
`generate_image`, `run_extension_code`) están implementadas.
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
- **Delegación anidada acotada**: `define_subagent.allowSubagents` permite que un
  subagente lance hijos de SOLO LECTURA. Hay un nivel (los nietos no reciben
  `invoke_subagent`), no se permite dentro de un worktree, y el presupuesto es de
  8 subagentes por turno, compartido entre el padre y los anidados. `list_peers`
  filtra los de primer nivel y `manage_subagent list` muestra el padre.
- **Sandbox de workspace, fase 2** (opt-in en Ajustes): las herramientas de
  fichero no pueden resolver rutas fuera del proyecto y `run_command` arranca
  con las variables de entorno que parecen credenciales eliminadas. En Windows
  un lanzador nativo (C# compilado con el csc del sistema) crea el comando
  **suspendido**, lo asigna a un Job Object y lo reanuda: límites de memoria,
  procesos y CPU, y terminación de todo el árbol al salir el comando o la app.
  En Linux/macOS se usa un grupo de procesos propio y `ulimit` para CPU y
  procesos (la memoria virtual no se limita: V8 reserva varios GB y `ulimit -v`
  rompería comandos normales; haría falta cgroups). Si el lanzador
  nativo no se puede compilar, queda el guard PowerShell como respaldo. No es
  AppContainer: los procesos siguen corriendo con el usuario actual.
