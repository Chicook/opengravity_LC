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
