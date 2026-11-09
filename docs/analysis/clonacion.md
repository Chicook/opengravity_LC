# Grado de clonación respecto a Antigravity

Análisis del estado actual de Opengravity frente a Antigravity, por dimensiones.
Cada nota se apoya en medición propia del DOM de Antigravity salvo donde se
indique «estimado».

**Fecha del análisis**: al cierre de la sesión de trabajo. Antigravity 2.x.

## Metodología

- **Medido**: comparado número a número contra el DOM de Antigravity por CDP
  (`getBoundingClientRect`, `getComputedStyle`, `outerHTML`). Es el estándar del
  proyecto: las capturas solo detectan diferencias, no miden.
- **Estimado**: valorado por inventario de funcionalidad, sin comparación
  numérica exhaustiva.
- **Excluido por encargo**: marketplace, cuentas, planes, facturación y marca.
  También los modelos: Opengravity usa los del usuario, no Gemini.

## Resultado global

| Dimensión | Peso | Nota | Aporta |
|---|---|---|---|
| Sistema visual (fuentes, paleta, temas) | 15 % | 98 % | 14,7 |
| Estructura y shell (sidebar, título) | 15 % | 95 % | 14,3 |
| Chat (pasos, herramientas, respuestas) | 20 % | 95 % | 19,0 |
| Composer y estado vacío | 10 % | 95 % | 9,5 |
| Panel lateral derecho | 10 % | 85 % | 8,5 |
| Ajustes | 10 % | 80 % | 8,0 |
| Motor del agente (mecanismos) | 10 % | 95 % | 9,5 |
| Inventario de herramientas | 5 % | 96 % | 4,8 |
| Comportamiento del agente | 5 % | 85 % | 4,3 |
| **Total** | | | **≈ 94 %** |

## Detalle por dimensión

### 1. Sistema visual — 98 %

Lo más cerrado del proyecto.

- **Fuentes**: 7 WOFF2 latinas servidas desde el proyecto. `Google Sans Flex`
  mide 220,38 y `Google Sans` 214,18 en `canvas.measureText`, **idénticas a
  decimales** a las de Antigravity. Causa raíz encontrada: ellos las sirven desde
  `fonts.googleapis.com` y nosotros solo registrábamos `codicon`.
- **Paleta**: 97 `--color-*` + 3 `--glass-*` portados literalmente. 129 tokens en
  común, 122 con valor idéntico, **0 diferencias reales**.
- **Escala tipográfica**: 12→16, 14→20, 16→24 aplicada a 60 reglas; 29 usos de
  11 px corregidos a 12.
- **Temas**: claro con 43 `var(--color-*)` sustituidos por tokens semánticos.
  99 fallos de contraste → 0. Oscuro: 8 variables autorreferentes corregidas.

Lo que falta: nada conocido.

### 2. Estructura y shell — 95 %

- Sidebar de **256 px**, cabecera de **40 px** con `padding: 0 8px 0 0` y
  `margin-bottom: 12px`, idéntica también plegada.
- Árbol por proyecto con `#project-conversations` y `padding-left: 30px`.
- Separador de 240×1 **transparente** con `margin: 12px 8px 0`.
- Sidebar plegada sigue en el flujo de la rejilla (`position: relative`,
  `z-index: 30`) para que los iconos no se muevan.

Pendiente: 8 px de desfase en los iconos superiores, 1 px en las filas de
conversación y en la fila de proyecto.

### 3. Chat — 95 %

- Los tres bloques de paso (`worked-for`, `tool-group`, `thinking`) comparten la
  forma medida: **32 px** de alto, radio **8**, `padding: 4px 8px`, **14/20**,
  etiqueta en muted con `tabular-nums`, chevron de 14 que gira 90°.
- Sangrado de **12 px** por nivel, confirmado en vivo.
- **Tarjeta de terminal**: radio 8, fondo `rgb(7,7,9)`, cabecera `6px 12px` a
  12/16 mono con borde inferior, salida plana. Idéntica.
- Markdown: párrafos 14/22,75, código inline 12,6/20,475 con radio 4.

Cerrado después de la primera medición: la **etiqueta de cada llamada** ahora es
«Ran list files in current directory», como la suya, y el **gap entre tarjetas de
turno** bajó de 8 a los 6 px medidos.

### 4. Composer y estado vacío — 95 %

- `padding-left: 38px` y `margin: 0` con mensajes; `margin: 0 auto` y
  `padding-left: 16px` en estado vacío.
- Columna alineada en **x=295** igual que la suya.
- Estado vacío centrado en el panel: 849 frente a 847 suyos.

### 5. Panel lateral derecho — 85 %

Lo mejor y lo peor conviven aquí.

- **Geometría exacta**: su fórmula `calc((100vw - var(--sidebar-width)) * 0.5)`,
  copiada de `.agy-layout-vars`. A 1440 px da 592, idéntico.
- Lista de lanzamiento con buscador, cuatro vistas de **32 px** por fila y sus
  posiciones (buscador `y=115`, Review `y=180`, Terminal `y=244`): **idénticas**.
- Vista Terminal con lista «Terminals» de 250 px, cabecera de 24 y filas de 32.

Cerrado después de la primera medición: la **fila superior está fusionada** —las
pestañas de la vista abierta a la izquierda y los iconos del panel a la derecha—,
igual que la suya; en el lanzador quedan solo los iconos.

Pendiente: su primera pestaña es `Open File` (mezcla vistas y terminales en la
misma barra), y las vistas Review, Open File y Browser siguen siendo contenedores
con su texto de vacío.

### 6. Ajustes — 80 %

- Modal **1024×720**, radio **24**, fondo `rgb(7,7,9)`.
- Sidebar de **200 px** con fondo `rgb(17,17,20)`, sin cabecera «Settings».
- Items de **184×28**, radio 8, activo `rgba(255,255,255,0.09)`. Todo medido y
  coincidente.

Añadido después de la primera medición: **cabecera de sección desplegable** con
título de 14 px, **contador en pastilla** de 10 px (`bg-secondary`, `2px 6px`,
radio completo, con borde) y chevron que gira, igual que la suya; y la sección
**Developer**, que faltaba por completo, con sus dos subsecciones.

Corregido después: los desplegables ya no se recortan (`overflow: hidden` de la
tarjeta), solo se abre uno a la vez, las opciones llevan descripción y el nombre
del proyecto dejó de pisar «Customizations» — que había desaparecido de la
navegación. Añadida la sección **Developer**.

Pendiente: contenido de Projects y Conversations, y el **orden exacto de la
navegación** — ellos no listan Customizations ni Developer en la sidebar.

### 7. Motor del agente — 95 %

Los **once mecanismos** documentados del binario están replicados y con pruebas:

trayectoria con revert selectivo · hooks que reescriben argumentos · monitor de
seguridad A–M · clasificador en cascada · nudge por evidencia · memoria entre
conversaciones · subagentes como subtrayectorias · ciclo de plan
planner↔executor · skills con divulgación progresiva · `run_workflow` · cron
propio.

El 5 % restante es verificación: el revert tras reiniciar funcionaba mal y se
arregló; `send_message` y los permisos de solo lectura siguen sin prueba en vivo.

### 8. Inventario de herramientas — 96 %

27 en su inventario, 26 en el nuestro. Añadidos: `multi_replace`, `send_message` y
`edit_notebook` (17 pruebas). `list_peers` ya estaba en `manage_subagent`.

**`generate_image` está excluida a propósito**: requiere un proveedor de imágenes
de pago, y la regla 2 del proyecto prohíbe cualquier coste que no sea la API del
modelo. Ver `docs/analysis/herramientas-excluidas.md`.

### 9. Comportamiento del agente — 85 %

Aquí está lo que más se nota y menos se mide.

Corregido: **no sabía en qué sistema operativo corría** y ejecutaba `find /` en
Windows (32 → 8 pasos de bucle al arreglarlo); **no contrastaba la premisa** de la
tarea (32 → 8 pasos); el monitor de nudge no veía los bucles.

Corregido después: la **guarda de sobrescritura** en `write_file` impide reescribir
un fichero existente sin pedirlo a propósito — verificado en vivo, el primer intento
se rechaza y el segundo lleva `overwrite: true`. Los subagentes reciben ahora la
orden de usar **rutas completas** en su `prompt`, y el bucle inyecta un **aviso de
cierre** cuando quedan pocos pasos para que no agoten el presupuesto en silencio.

Pendiente: el agente sigue prefiriendo reescribir a `multi_replace` — pero ya lo
hace a sabiendas, y su propio `write_file` tiene `Overwrite`, así que es
comportamiento legítimo.

### 10. Automations — añadido después del informe

Vista a página completa con título de 18/28 peso 450, dos pastillas de 32,
estado vacío con su texto literal, historial de ejecuciones y «Create with
Prompt» como **conversación guiada** (medido: no es un formulario, abre un chat
con el mensaje ya escrito).

### 11. Tarjeta de decisión — añadido después del informe

Estaba como overlay centrado y **no era eso**: en su app es una tarjeta en línea
anclada sobre el composer, de 768 px, radio 20, con opciones numeradas de 30 px,
«Other (write your answer)» como última opción y `Submit ⏎`. Rehecha entera.

## Lo que este porcentaje no mide

- **Modelo**: excluido por encargo. La calidad de respuesta depende del proveedor
  del usuario, no del clon.
- **Cuentas, planes, marketplace y marca**: excluidos.
- **Rendimiento y estabilidad a largo plazo**: sin medir.

## Para acercarse al 100 %

Por impacto sobre lo que percibe quien viene de Antigravity:

1. **Ajustes**: contenido de las tres secciones que faltan (10 % del peso, hoy 55 %).
2. **Panel lateral**: fusionar la barra de pestañas con la fila superior (10 %, hoy 70 %).
3. **Chat**: gap de 6 px y etiqueta «Ran …» (20 %, hoy 90 %).
4. **Comportamiento**: elección de herramienta y rutas de subagentes (5 %, hoy 75 %).
5. Deltas de 1-8 px en sidebar y filas.

Los tres primeros son los que moverían la aguja de verdad.
