# Orquestación: qué hace Antigravity y qué hacemos nosotros

Comparación escrita después de **mirar** el Antigravity instalado en este equipo
(`%LOCALAPPDATA%\Programs\antigravity`), con el permiso del dueño. Tres reglas
para leer esto:

1. Lo que Antigravity hace se apoya en textos y nombres que están **dentro** de
   sus binarios. Es lo que el programa declara, no una ejecución observada.
2. Lo que hacemos nosotros se apoya en nuestro código, que sí se puede leer entero.
3. Cuando algo no se ha mirado, se dice. No se rellena con suposiciones.

Ficheros inspeccionados: `resources/app.asar` (5,6 MB, la interfaz Electron) y
`resources/bin/language_server.exe` (215 MB, el motor del agente).

## La forma general: los dos separan interfaz y motor

| Pieza | Antigravity | Nosotros |
|---|---|---|
| Interfaz | `app.asar`, Electron | `electron/main.cjs` + `renderer/`, Electron |
| Motor del agente | `language_server.exe`, un binario Go de 215 MB | `src/agent/loop.ts`, TypeScript legible |
| Conversación | «Cascade», con pasos (`CORTEX_STEP_TYPE_*`) | mensajes + `onEvent`, con `tool_call`/`reasoning` |

Los dos son la misma arquitectura: un proceso que dibuja y otro que piensa. La
diferencia es que su motor es un binario opaco y el nuestro es código que se lee.

## Lo que Antigravity declara de su orquestación

Nombres encontrados en `language_server.exe` (cadena literal, sección `.rdata`):

- **Herramientas de fichero**: `view_file`, `replace_file_content`,
  `multi_replace_file_content`, y el tipo de paso `CORTEX_STEP_TYPE_VIEW_FILE`.
  Es decir: leer un fichero y reemplazar contenido, con una variante para varios
  ficheros a la vez.
- **Subagentes**: `enable-fork-with-subagents`, `merge_subagents_latency_ms`,
  `SUBAGENT_STATE_UNSPECIFIED`. Un agente puede abrir ramas que trabajan en
  paralelo y luego fusionarse, y eso se mide en latencia.
- **Niveles de pensamiento**: `THINKING_LEVEL_MINIMAL`, `_LOW`, `_MEDIUM`,
  `_HIGH`, `_XHIGH`, `_MAX`, más `_MODEL_DEFAULT` y `_UNSPECIFIED`. Siete
  valores: seis niveles y «lo que el modelo tenga por defecto».
- **Memoria**: `CORTEX_MEMORY_TRIGGER_GLOB` — la memoria se dispara por patrones
  de ficheros, no solo por conversación.
- **Trayectoria**: `RecordCortexTrajectoryStep`, `FetchTrajectory`,
  `ShareTrajectoryByUser` — cada paso se graba y la trayectoria se puede
  compartir.
- **Permisos**: `PERMISSION_SCOPE_WORKSPACE`, `AGENT_SETTING_POLICY_ALLOW`.
- **Protocolos**: lleva cliente MCP (`io.modelcontextprotocol/ui`,
  `chrome-devtools-mcp@latest`) y habla gRPC por la red interna
  (`application/grpc-web+proto`, `/v1internal:*`).

No he mirado **cómo** encadena esos pasos: el binario no trae símbolos y no se
ha ejecutado bajo observación. Lo de arriba es su vocabulario, no su algoritmo.

## Lo que ya teníamos igual

- **Herramientas**: `src/tools/fs.ts` tiene leer, escribir y reemplazar; el
  registro (`registry.ts`) las expone al modelo y despacha las llamadas.
  MCP entra por `mcp-adapter.ts`, igual que en ellos.
- **Subagentes**: `electron/subagents.cjs` (ramas que trabajan aparte y se
  fusionan).
- **Plan antes de actuar**: `planReviewInstruction` en `main.cjs` con
  `present_plan`, y las tres políticas (Always Review / Always Ask / Never).
- **Trayectoria**: `trajectory.cjs` graba los pasos de cada turno.
- **Memoria por ficheros**: `descubrirReglas` + `bloqueDeReglas` con presupuesto.
- **Permisos**: `guardian.cjs` y `ciclo.compuerta(call)` deciden qué herramienta
  puede ejecutarse en cada fase.

## La diferencia que importaba: el nivel de pensamiento era decorativo

Esto sí era un fallo nuestro y está arreglado en esta ronda.

**Antes.** El composer ofrecía tres niveles (`Low`, `Medium`, `High`) y elegirlos
solo añadía una frase al prompt de sistema:

```js
Low:    'Responde de forma directa y breve, con los mínimos pasos necesarios.'
Medium: 'Equilibra brevedad y rigor: explica lo justo antes de actuar.'
High:   'Razona con detalle, verifica cada paso...'
```

Ningún proveedor recibía nada. Peor: el adaptador de OpenAI no mandaba
`reasoning_effort` en ningún caso, así que en GPT-5 o los modelos de razonamiento
el nivel se quedaba en una sugerencia de estilo. Y `thinkingBudget` era una
constante de 4096 para todos los modelos y todos los niveles.

**Ahora.** `electron/pensamiento.cjs` traduce el nivel al campo que entiende cada
familia, y la escala es la suya (seis niveles, no tres):

| Nivel | OpenAI (`reasoning_effort`) | Anthropic (`budget_tokens`) | Gemini 2.5 | Gemini 3+ (`thinkingLevel`) |
|---|---|---|---|---|
| Minimal | `minimal` | 1 024 | 1 024 | `low` |
| Low | `low` | 4 096 | 4 096 | `low` |
| Medium | `medium` | 12 000 | 12 000 | `medium` |
| High | `high` | 24 000 | 24 000 | `high` |
| XHigh | `high` | 48 000 | 48 000 | `high` |
| Max | `high` | 96 000 | 96 000 | `high` |

Detalles que importan:

- **No se inventan valores.** OpenAI no tiene escalones por encima de `high`, así
  que `XHigh` y `Max` se quedan en `high` en vez de mandar un valor que la API
  rechazaría con 400.
- **Los servidores locales no reciben nada.** LM Studio, vLLM y llama.cpp se
  declaran `kind: 'openai'` en el catálogo, pero son servidores locales que
  devuelven 400 si les llega `reasoning_effort`. Se excluyen por id de proveedor,
  que es lo único que los distingue de un servicio en la nube.
- **El recordatorio en el prompt solo se añade cuando el campo no viaja.** Si el
  proveedor ya recibió el ajuste real, el texto sobraba y gastaba contexto.

## Correcciones de esta ronda

- `invoke_subagent` ya no bloquea el turno: devuelve el control con los ids y
  los resúmenes llegan como mensajes del sistema (o despiertan un turno nuevo).
  Así `send_message` y `manage_subagent` se pueden usar mientras trabajan. Los
  nietos y el planificador siguen esperando el resumen en su propio turno.
- Los servidores MCP se arrancan una vez por workspace y configuración, no en
  cada mensaje.
- Los pasos de la trayectoria se cierran por `callId`, no por «el último
  abierto», para que un lote en paralelo no atribuya todos los resultados al
  mismo paso.

## Lo que sigue sin estar a su altura

- **Subtrayectorias persistidas.** Los subagentes viven en memoria y sus pasos
  no se guardan como trayectoria hija; el original sí las persiste.
- **Navegador con red y DOM.** Tenemos 14 acciones, pero no inspección de red ni
  `get_dom` como sus herramientas de Chromium.
- **Benchmark real.** Falta correr la misma tarea y modelo en los dos y medir
  pasos, tokens y latencia. Sin eso, «misma eficiencia» es una hipótesis.

## Lo que no se ha mirado y no se puede afirmar

- Cómo decide Antigravity cuándo abrir un subagente y cuándo no.
- Qué modelo usa por defecto y con qué presupuesto real de pensamiento.
- Si sus niveles de pensamiento son tan solo una etiqueta o cambian la petición:
  **no se ha ejecutado** con captura de red, así que no se sabe.
- Su velocidad. Compararla exigiría correr los dos con la misma tarea y el mismo
  modelo; no se ha hecho.
