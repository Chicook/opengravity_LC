# Paridad funcional en vivo — Antigravity vs Opengravity

Fecha: 2026-11-10. Windows, misma máquina. Prueba de operación, no de código.

## Método

- Antigravity: `C:\Users\Usuario\AppData\Local\Programs\antigravity\Antigravity.exe`
  con `--remote-debugging-port=9223`.
- Opengravity: `release\win-unpacked\Opengravity.exe` con
  `--remote-debugging-port=9224`.
- Conversaciones nuevas en ambas, prompts idénticos, entrada y envío por la UI
  real (teclado real en el `contenteditable` de Antigravity; textarea y botón
  de envío en Opengravity).
- Modelos: Antigravity `Gemini 3.8 Flash Medium`; Opengravity `beam-free`.
  La latencia no es comparable entre modelos distintos.

## Resultados

| Comprobación | Antigravity | Opengravity | Veredicto |
|---|---|---|---|
| Caja de entrada | 758×40, x=294 | 758×40, x=295 | Igual (1 px por el divisor del panel) |
| Estado vacío | Saludo personalizado, en inglés | «Hola, ¿qué hacemos hoy?», en español | **Difiere** |
| Preset | Turbo | Turbo | Igual |
| Chat sin herramientas | «PARIDAD-OK.» | «PARIDAD-OK» | Igual en operación; puntuación del modelo |
| Título automático | «System Testing Response Check» | «Responde exactamente PARIDAD-OK uses» | **Difiere** |
| Terminal | Ejecutó `echo PARIDAD-TOOL` y devolvió `PARIDAD-TOOL` | Ejecutó el comando y devolvió `PARIDAD-TOOL` | Igual en operación |
| Presentación del tool | «Worked for 3s», «Ran», `echo paridad tool` | «Worked for 2s», «Ran command», pasos de pensamiento | **Difiere la etiqueta**, no la operación |
| Panel lateral | Overview / Review / Files / Terminal / Extensions | Overview / Review / Files / Terminal / Extensions | Igual |
| Latencia enfocada | 3,1 s | 7,0 s de pared («Worked for 1s») | Diferencia de modelo, no de UI |
| Ajustes: navegación | Projects, por proyecto, Not in Project, Give Feedback | Desktop, Google, Provide Feedback; sin Projects | **Difiere** |
| Ajustes: secciones | Cuenta, plan, créditos, cuota | Sandbox Limits, Google; sin cuenta/plan | Excluido por regla; sandbox es añadido |
| Marketplace | No | Catálogo local en Plugins | Añadido a petición |

## Diferencias que rompen el 1:1

1. **Saludo inicial**: Antigravity usa un saludo personalizado en inglés;
   Opengravity usa uno genérico en español. La copia y el idioma no coinciden.
2. **«Give Feedback» vs «Provide Feedback»** en Ajustes.
3. **Falta la sección Projects** (y «Not in Project») en los ajustes de
   Opengravity; aparece «Desktop» en su lugar.
4. **Título automático de conversación**: Antigravity genera un título
   semántico; Opengravity recorta el prompt y produce «... PARIDAD-OK uses».
5. **Etiqueta del tool**: «Ran» frente a «Ran command»; los pasos de
   pensamiento se muestran con distinto detalle.

Lo demás probado opera igual: misma caja, mismo envío, misma ejecución de
terminal, misma salida y mismos paneles.

## Notas

- La primera prueba de terminal en Antigravity pareció tardar más de 60 s porque
  la ventana estaba en segundo plano y no repintó el turno terminado. Al traerla
  al frente, el mismo tipo de turno terminó en 3,1 s. No se cuenta como
  diferencia.
- No se probaron ficheros ni proyectos porque las dos apps estaban en
  workspaces distintos; para eso hay que abrir el mismo proyecto en ambas.
- Cuentas, planes, facturación y créditos quedan fuera por la regla del
  proyecto; el marketplace y el sandbox son añadidos de Opengravity.

## Correcciones posteriores

Los puntos 3, 4 y 5 de la tabla quedaron corregidos después de esta prueba:

- **Projects / Not in Project**: navegación con el grupo Projects, los proyectos
  conocidos, Show All/Show Less y Not in Project. Commit `5d6f888`.
- **Títulos**: la conversación nueva ya resetea la sesión del motor y el título
  se pide al modelo después del primer turno; el heurístico queda de respaldo.
  Commit `ba3fb02`.
- **Filas de herramienta**: «Ran» + tarjeta con el comando, sin el grupo
  «Ran commands»; el historial recupera los argumentos del mensaje assistant.
  Commit `ba3fb02`.
- El título no llegaba porque el reader SSE no cancelaba el cuerpo al recibir
  `[DONE]` y dejaba la conexión ocupada. Commit `2cc42d4`.

## Correcciones medidas contra 2.31 (2026-11-11)

Antigravity 2.31 cambió la barra lateral y los ajustes; se volvió a medir su DOM
y se ajustó lo nuestro:

- **Iconos superiores**: su logo empieza en x=8 y los cuatro botones caen en
  50/82/114/146. Los nuestros estaban 8 px a la izquierda y la navegación 12 px
  por debajo por un `margin-bottom` que su 2.31 ya no tiene. Corregido:
  navegación en y=75, separador en y=195 y cabeceras de sección en x=8 w=240.
- **Filas de conversación anidadas**: sus filas ocupan los mismos 240 px que las
  de primer nivel; las nuestras iban 8 px a la derecha y 16 px más estrechas.
  Corregido: título en x=38, hora en x=224 y kebab de 24 en x=220.
- **Fila de proyecto**: su botón lleva icono de carpeta de 16 en x=16 y etiqueta
  en x=38; el nuestro solo tenía etiqueta en x=16.
- **Saludo**: «Hey Darío, what should we build today?» — mismo 24/32 weight 350
  con tracking −0.36 y marca de agua de 112 px al 0.15. El nombre sale del perfil
  local; si está vacío, de la cuenta del sistema. El separador superior es
  `clamp(72px, -66px + 32vh, 264px)`, no un padding fijo.
- **Vista Browser**: implementada con `<webview>` sobre
  `persist:opengravity-browser`: barra de 40 px (atrás, adelante, recargar y
  pastilla de 28 con la URL) y pestaña en la fila superior. Pendiente: su panel
  se ensancha a 786 px al abrir el navegador y su barra lleva botón de descargas.
- **Ajustes**: navegación con **Browser** tras Models, «Settings» como cabecera,
  pasos de 30 px, Give Feedback en el pie y sección Browser con Download Location
  real (la carpeta se usa para las descargas del webview) y Browsing History.

### Agente, en vivo

Un turno real con el modelo configurado (144 s) ejecutó `define_subagent`,
`invoke_subagent` y `send_message`:

- El subagente definido solo con `read_file` y `list_directory` no pudo escribir
  `prueba-lector.txt`: no recibió herramientas de escritura. No se creó el
  fichero.
- `send_message` llegó al subagente (`Mensaje entregado a 1 subagente(s)`); el
  primer intento fue a un subagente ya terminado y el reintento a `sub-1` sí se
  entregó.

## Medición 2026-11-13 — Antigravity 2.31.0

Método: las dos apps en vivo por CDP (Antigravity `:9223`, 1424×892;
Opengravity release `:9225`, 1440×900). `getBoundingClientRect` y
`getComputedStyle`; sin capturas.

| Elemento | Antigravity 2.31 | Opengravity | Veredicto |
|---|---|---|---|
| Sidebar | 256 px | 256 px | Igual |
| Logo / iconos superiores | x=8; 50/82/114/146 | idéntico | Igual |
| New Conversation / Automations / Customizations | 8,75 / 8,113 / 8,151 · 240×32 | idéntico | Igual |
| Cabecera Projects | 8,208 · 240×24 | idéntico | Igual |
| Separador | 240×1 en y=195 | idéntico | Igual |
| Composer | 768×118, radio 21, `rgb(13,13,17)` | idéntico | Igual |
| Entrada | 758×40, 14/24, radio 6, padding 8 | idéntico | Igual |
| Botón enviar | 28×28 | idéntico | Igual |
| Saludo vacío | 24/32, w350, −0,36 px | idéntico | Igual |
| Modal de ajustes | 1024×720 | idéntico | Igual |
| Ítem de ajustes | 184×28 | idéntico | Igual |

### Correcciones de esta pasada

- **Tokens**: 91 de 97 idénticos; los 6 restantes alineados con su valor
  (`--color-background: #070708`, `--color-selection-background:
  rgba(47 113 227 / 0.4)` y los cuatro `--color-diffEditor-*`). Ahora 97/97.
- **Panel lateral**: al abrir Browser pasa a **786 px** (medido en su 2.31) y
  vuelve a la fórmula del 50 % en las demás vistas.
- **Ajustes · Browser**: su 2.31 solo tiene Built-in Browser (Open Links In,
  Download Location, Browsing History) y Browser Subagent (Actuation Rules). Se
  retira «Browser Javascript Execution Policy», que no existe en su interfaz.
- **Ajustes · General**: se añade la fila «Keyboard shortcuts» al final de
  Execution, como la suya.

### Pendiente medido y no implementado

- **Interface Layout** (Knowledge Work / Software Engineering) en su General:
  el control no es un `button` y no se pudo accionar por DOM; sin medir su
  efecto no se replica.
- **Voice mode** en General: depende de Gemini Live, fuera del alcance del
  proyecto (modelo del usuario).
- **Botón de descargas** de su barra de URL y vistas reales de Review y
  Open File: sin referencia de geometría y con subsistema propio pendiente.
- **Separación entre tarjetas de turno**: su contenedor mide `gap: 6px`; el
  nuestro es de 16 px en la lista de mensajes. No se cambia sin medir el hueco
  usuario→respuesta, que en su DOM es otro contenedor.

### Chat — medido en Antigravity 2.32.0 (2026-11-13)

| Medida | Antigravity 2.32 (1920) | Opengravity antes | Ahora |
|---|---|---|---|
| Columna del hilo | 768 px **centrada** (x=701, centro del panel 1088) | 768 px con `margin-left: 17px` | `margin: 0 auto`, centrada |
| Separación entre tarjetas | `gap: 6px` | 16 px | 6 px |
| Mensaje de usuario | `pt-6` = 24 px | 16 px | 24 px |
| Resumen del turno terminado | `aria-expanded="false"` (cerrado) | abierto, con todas las filas de pensamiento a la vista | se cierra al terminar |
| Composer | 768×82 centrado (x=701) | 768×82 con 33 px de margen izquierdo | centrado, mismo eje que el hilo |

#### Filas de herramienta y markdown (2.32)

Medido con un turno real abierto por el buscador y desplegado:

| Detalle | Antigravity 2.32 | Opengravity (antes) | Ahora |
|---|---|---|---|
| Turno con **una** llamada | «Worked for 14s» → fila directa `Ran <tarea>` a +12 px, ancho 756 | cabecera intermedia «Ran command» y fila dentro | se aplana: la fila cuelga del resumen, sin cabecera |
| Turno con **varias** llamadas | fila de grupo con el resumen por intención | igual | se mantiene |
| Texto de la fila de comando | `Ran verify date calculation` | solo `Ran` (el comando iba solo en la tarjeta) | `Ran <taskName>` |
| Chevron de un grupo cerrado | apunta a la derecha | siempre abajo (la rotación dependía de una clase que nadie ponía) | rota con `aria-expanded="false"` |
| Negrita markdown | peso **600** | 490 | 600 |
| Lista markdown | `ul` margen 8px 0 0, `li` sin margen | margen 8px 0, `li` 2px | igual a 2.32 |

### Panel Overview: solape con el chat (2026-11-14)

La tarjeta flotante (320×166, `absolute`, 8 px arriba y a la derecha, radio 12,
z-30 — geometría de su DOM) se dibujaba en ventanas estrechas encima del hilo:
a 1440 px el margen derecho de la columna (768 centrada) es de 207 px y la
tarjeta ocupa 328.

Corregido sin tocar la tarjeta: con el panel abierto, `.content__main` reserva
344 px por la derecha cuando la ventana mide ≤1680 px (por encima, el margen ya
supera a la tarjeta). Medido a 1440 con conversación abierta:

| Elemento | Antes | Ahora |
|---|---|---|
| Columna del hilo | x=465, derecha 1233 | x=293, derecha 1061 |
| Composer | x=465 | x=293 (mismo eje) |
| Tarjeta | x=1112 | x=1112 |
| Solape | 121 px sobre el texto | −51 px (51 de hueco) |

Con el estado vacío no hay solape (saludo a 867, tarjeta a 1112).

### Plan propuesto: tarjeta de artefacto (2026-11-14)

Medido en Antigravity 2.32 provocando `present_plan` en una conversación real.
El plan **no** es un modal: es una tarjeta en el hilo.

```html
<div data-testid="artifact-card"
     class="border p-2 my-0.5 rounded-xl flex flex-col gap-1 items-start cursor-pointer artifact-card">
  <div data-testid="artifact-card-header" class="flex flex-col gap-1 items-start w-full">
    <button class="inline-flex items-baseline text-base font-medium … rounded-md p-0.5">
      <svg 16×16/><span>Plan</span>
    </button>
    <span class="text-secondary-foreground line-clamp-3">Plan de 3 pasos para…</span>
  </div>
  <div class="flex gap-2 mt-1 items-center">
    <button class="agy-button agy-button-sm bg-primary h-7 text-base rounded-md gap-1.5 px-2.5 proceed-button">
      Proceed<span class="ml-0.5 text-sm opacity-50">Ctrl+↵</span>
    </button>
  </div>
</div>
```

Medidas: tarjeta **768×100** (ancho del hilo), borde 1, `p-2` = 8, `my-0.5` = 2,
radio 12, `gap-1` = 4; título 16/24 peso 500 en pastilla (`p-0.5`, radio 6);
resumen en `secondary-foreground` con clamp de 3 líneas; botón primario de
**28 px** (`h-7`, `px-2.5`, radio 6, `gap-1.5`) y pista «Ctrl+↵» de 14 px al
50 %. Sin botón de rechazo: la revisión se escribe en el composer.

Opengravity pasa de modal centrado (pasos editables, Rechazar/Aprobar) a esa
tarjeta: se inserta en el hilo, el título despliega el documento del plan, y
«Proceed»/Ctrl+↵ aprueba. Escribir en el composer con un plan pendiente lo
rechaza con ese texto como motivo (el turno sigue y el agente revisa).
