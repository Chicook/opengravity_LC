# Análisis del blueprint frente a lo construido

Contraste del documento `ANTIGRAVITY_REVERSE_ENGINEERING_AND_OPEN_SOURCE_BLUEPRINT`
con el código real de Opengravity. Comprobado con `grep` sobre el repositorio, no
de memoria.

## Lo que el blueprint acierta y ya tenemos

| Blueprint | Dónde está en Opengravity |
|---|---|
| Separación estricta de `thinking` / `tool_calls` / `content` | el bucle emite los tres por eventos distintos y el renderer los pinta separados |
| Truncado de salidas grandes a disco con vista previa | `electron/hooks.cjs`, con `toolOutputLimit` configurable |
| `run_command` que no bloquea y pasa a segundo plano | `waitDurationSeconds` + `command_status` |
| `manage_task` para procesos de fondo | implementado |
| `schedule` (temporizador/cron) | `notify_user` + `electron/cron.cjs`, con parser cron propio |
| `ask_question` | `ask_user_question`, tarjeta en línea |
| `invoke_subagent` / `manage_subagents` / `send_message` | los tres, con subtrayectorias y bandeja por subagente |
| Progressive disclosure en skills | `electron/skills.cjs`, solo frontmatter en el prompt |
| Permisos con revisión | monitor de seguridad A–M, modos `block` / `ask` / `off` |
| Trayectoria paso a paso | `electron/trajectory.cjs`, con revert selectivo |

## Los huecos reales

### 1. Despertar reactivo — el hueco más importante

El blueprint insiste: *«NO hay polling de tokens ni gasto de inferencia»*. Cuando
una tarea de fondo termina, el daemon **despierta** al agente e inyecta el
resultado.

**Lo nuestro no hace eso.** `run_command` espera `waitDurationSeconds` y, si no ha
terminado, deja la tarea viva y devuelve un `CommandId`. Pero **nadie despierta al
agente**: tiene que llamar a `command_status` por su cuenta. Si no lo hace, la
tarea termina en el vacío.

Es una diferencia de arquitectura, no de detalle. El arreglo sería un bus de
eventos que, al terminar una tarea de fondo, inyecte el resultado en el turno
como mensaje de usuario — el mismo mecanismo que ya usa `mensajeDeSistema` para
el plan y para `send_message`.

**Viable y acotado.**

### 2. `read_file` paginado

El blueprint define `StartLine`, `EndLine`, `ByteOffset` para *«evitar saturación
de memoria»*. El nuestro solo acepta `maxBytes`: lee el fichero entero y lo corta.

En un fichero de 2 MB, leerlo entero para devolver 200 KB es tirar memoria y
tiempo. Añadir rango de líneas es pequeño y mejora algo que el agente usa en cada
turno.

**Viable y barato.**

### 3. `ArtifactMetadata` en `write_file`

Cuando el agente escribe un documento, el blueprint lo cataloga como **artefacto**
y lo muestra en un panel propio. Nosotros no tenemos ese concepto: todo lo escrito
es un fichero más.

**Viable**, pero es función nueva de interfaz (panel de artefactos), no un arreglo.

### 4. Aislamiento de workspace con `git worktree`

Los subagentes pueden trabajar en `inherit` (mismo directorio), `branch` (copia
completa) o **`share`** (worktree ligero). Nosotros solo tenemos lo equivalente a
`inherit`: los subagentes comparten el directorio.

El modo `share` es lo que hace seguro lanzar varios subagentes que escriben a la
vez. Sin él, dos subagentes con permiso de escritura se pisan.

**Viable** con `git worktree add/remove`, ya usado en el blueprint. Requiere que el
proyecto sea un repo git.

### 5. Sandboxing del sistema operativo

El blueprint propone **Job Objects** en Windows y **Bubblewrap/Landlock** en Linux
para limitar memoria, CPU y acceso al disco fuera del workspace.

**No es viable en el plazo de este proyecto.** Implementar Job Objects desde Node
requiere un módulo nativo en C++ o FFI, y su valor es contener daño de un agente
malicioso — no algo que un usuario de Antigravity note en el uso diario. El
monitor de seguridad cubre el caso de uso real.

### 6. Daemon HTTP con CSRF

Su `language_server.exe` es un daemon con puerto dinámico y token CSRF en
`daemon/hub_<pid>.json`. Nosotros corremos dentro del proceso de Electron, sin
daemon ni puerto.

**No es un hueco que valga la pena cerrar.** El daemon existe en Antigravity porque
su interfaz es una web servida por HTTP y porque comparten el motor con la
extensión de IDE y la CLI. Nosotros no tenemos esos tres consumidores: un daemon
añadiría un puerto abierto y un token que gestionar, sin darnos nada.

### 7. SQLite en vez de JSONL

El blueprint usa SQLite por conversación. Nosotros usamos JSON Lines.

**No es un hueco.** JSONL es más simple, se puede leer y depurar a mano, y el
volumen de una conversación no justifica una base de datos. SQLite tendría sentido
si hubiera búsqueda sobre miles de conversaciones — y para eso ya está el índice.

### 8. `search_marketplace`

**Excluido por encargo**: marketplace está fuera del alcance del proyecto.

## Veredicto de viabilidad

| Hueco | Valor | Coste | ¿Merece? |
|---|---|---|---|
| **Despertar reactivo** | alto — es la diferencia entre «agente autónomo» y «agente que hay que empujar» | medio | **sí** |
| **`read_file` paginado** | medio — lo usa en cada turno | bajo | **sí** |
| **`git worktree` para subagentes** | alto si se usan subagentes que escriben | medio | sí, condicionado a que el proyecto sea git |
| `ArtifactMetadata` + panel | medio | alto (función nueva) | después |
| Sandboxing del SO | bajo para el usuario | muy alto | no |
| Daemon HTTP + CSRF | ninguno para nosotros | alto | no |
| SQLite | ninguno | medio | no |

## Recomendación

**Los dos primeros**, en ese orden: el despertar reactivo y `read_file` paginado.
El primero cierra la diferencia conceptual más grande del documento; el segundo
mejora algo que el agente usa constantemente.

`git worktree` después, si los subagentes con escritura se van a usar de verdad.

El resto son decisiones de arquitectura de Antigravity que no aplican a nuestro
caso, y conviene decirlo así en lugar de copiarlas por completitud.
