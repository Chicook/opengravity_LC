# Medidas de la interfaz — notas propias

Este directorio ya **no** contiene ficheros copiados de Antigravity. Antes había
aquí su hoja de estilos completa (411 KB), su árbol DOM (181 KB) y su lista de
canales internos, extraídos de la aplicación en ejecución y de su `app.asar`.
Ese material es del producto de Google y no se puede redistribuir bajo una
licencia MIT, así que se retiró del repositorio.

Lo que queda es lo que sí es del proyecto: **números medidos** (colores, tamaños,
espaciados) transcritos a mano. Los valores están en
[`../design-tokens.md`](../design-tokens.md), que es la referencia que usa hoy el
código, y se aplican en `renderer/styles.css`.

## Qué se retiró y por qué

| Se retiró | Qué era | Por qué no se puede quedar |
|---|---|---|
| `estilos.css` | sus 3 664 reglas en 14 hojas | es su CSS, literal |
| `dom.html` | su árbol de interfaz completo | es su marcado, literal |
| `ajustes.html`, `chat-pasos.html` | capturas de sus pantallas | es su marcado, literal |
| `ipc.md` | la lista de sus 57 canales internos | es su contrato interno |
| `chat-estructura.md`, `ajustes-secciones.md` | sus clases y textos, copiados | texto y nombres suyos |
| `assets/fonts/GoogleSans*.woff2` | las cinco fuentes de Google Sans | **no se retiraron: son SIL OFL**, ver abajo |

## Cómo se mide ahora

Sin abrir el producto original y sin copiar ficheros suyos:

1. **Del propio producto**, solo lo que publica abiertamente (documentación,
   capturas públicas) y solo para anotar decisiones de diseño.
2. **Del proyecto**: `docs/design-tokens.md` y `renderer/styles.css` son la
   fuente de verdad. Si un valor no está ahí, se decide con criterio propio y se
   anota el porqué en el mismo fichero.
3. **Pruebas**: `test/tokens-css.test.mjs` fija que no haya variables
   autorreferentes, ni tokens con erratas, ni colores oscuros sueltos sin su
   pareja del tema claro. Esa es la garantía real, no la comparación con su CSS.

## Tipografía

La interfaz usa **Google Sans**, **Google Sans Code** y **Google Sans Flex**,
servidas desde `assets/fonts/`, más **Inter** de reserva. Son las mismas que carga
Antigravity y **no son propietarias**: cada fichero declara dentro la SIL Open Font
License 1.1. Lo comprobé leyendo la tabla de nombres de cada `.woff2`, no por
suposición; el detalle y la atribución están en
[`../fuentes-licencias.md`](../fuentes-licencias.md).

Al contrario que el CSS y el DOM copiados, que sí eran material suyo y se
retiraron, una fuente bajo OFL se puede redistribuir dentro de un producto: es
justo lo que la licencia permite.
