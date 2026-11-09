# Sesión real de verificación del núcleo

Registro de la primera prueba end-to-end del bucle del agente con una tarea de
programación real, no una prueba unitaria.

## La tarea

Proyecto `prueba-nucleo` con un bug sembrado a propósito en `src/carrito.mjs`
(`>` en lugar de `>=` en los umbrales de descuento) y una suite de 5 pruebas que
fallaban 3.

Encargo: *«Encuentra el bug, arréglalo y comprueba que pasan los 5 tests. No
modifiques los tests.»*

## Resultado del primer turno: correcto

| Criterio | Resultado |
|---|---|
| Encontró el bug | ✅ identificó `>` frente a `>=` |
| Lo arregló | ✅ `1 file changed +2 -2` |
| Los 5 tests pasan | ✅ |
| No tocó los tests | ✅ |
| Tiempo | 12 s de trabajo |

## Fallos encontrados

### 1. Todos los bloques de paso nacían desplegados

Medido: `aria-expanded: "true"` en el resumen **y** en todos los bloques internos.
En su DOM, el resumen del turno nace abierto y los internos **cerrados**
(`aria-expanded="false"`). El hilo se volvía una pared de texto.

Corregido: los bloques internos (`tool-group`, `thinking`) nacen cerrados y con el
cuerpo oculto; solo `worked-for` nace abierto.

### 2. El agente entra en bucle cuando la premisa es falsa

Segundo turno, con el bug **ya arreglado** por el primero: el agente encontró los
tests en verde y repitió **unas 25 veces** la misma idea («los tests pasan, pero el
usuario dice que fallan, quizá hay tests ocultos») sin converger ni parar.

Es el fallo más serio de la sesión. El monitor de nudge por velocidad de evidencia
existe precisamente para esto y **no lo detuvo**. Hay que revisar por qué: puede
que la huella (herramienta + argumentos + resultado) cambie lo bastante entre
pasos como para parecer evidencia nueva.

### 3. Etiquetas incoherentes

Aparecían `Working.` y `Thinking.` con punto final, frente a `Worked for 12s` y
`Thought for 3s`. Corregido `Thinking…` → `Thinking`.

### 4. Texto de depuración en la salida

`[hooks] Hooks: path: "prueba-nucleo"` aparecía dentro del resultado de la
herramienta. Es intencionado (informa al modelo de que un hook actuó), pero el
formato es de depuración y se lee mal en la interfaz.

## Nota metodológica

El bucle del punto 2 **lo provoqué yo**: no reinicié el bug entre turnos, así que
el segundo se encontró el trabajo hecho. El fallo del agente es real, pero la
premisa falsa la puse yo.

También: al intentar corregir el punto 1 calculé el parche y **no escribí el
fichero** en dos intentos consecutivos. Es un error mío repetido que conviene
vigilar: hay que comprobar con `grep` que el cambio está en disco, no fiarse del
mensaje del script.
