# Fuentes incluidas y sus licencias

La app sirve sus fuentes desde dentro del proyecto (`assets/fonts/`) para que
funcione sin red y sin depender de lo que haya instalado en el sistema. No son
propietarias: las cinco llevan la **SIL Open Font License 1.1**, que permite
usarlas, modificarlas y redistribuirlas dentro de un producto.

Esto no es una suposición. Cada `.woff2` guarda su tabla de nombres (`name`)
comprimida con Brotli, y ahí están el copyright y la URL de la licencia. Se leyó
descomprimiendo esa tabla; lo que sigue es lo que dicen los ficheros.

## Qué declara cada uno

| Fichero | Familia | Copyright que declara | Licencia |
|---|---|---|---|
| `GoogleSans-Regular.woff2` | Google Sans 18pt Regular | Copyright 2025 The Google Sans Project Authors (github.com/googlefonts/googlesans) | SIL OFL (`openfontlicense.org`) |
| `GoogleSans-Italic.woff2` | Google Sans (cursiva) | El mismo proyecto | SIL OFL |
| `GoogleSansCode-Regular.woff2` | Google Sans Code Monospace Regular | Copyright 2026 The Google Sans Code Project Authors (github.com/googlefonts/googlesans-code) | SIL OFL (`openfontlicense.org`) |
| `GoogleSansCode-Italic.woff2` | Google Sans Code (cursiva) | El mismo proyecto | SIL OFL |
| `GoogleSansFlex.woff2` | Google Sans Flex (variable) | El mismo proyecto | SIL OFL |
| `Inter-Regular.woff2` | Inter Regular | Copyright 2016 The Inter Project Authors (github.com/rsms/inter) | SIL OFL (`openfontlicense.org`) |
| `Inter-Italic.woff2` | Inter Italic | El mismo proyecto | SIL OFL |

En las cursivas la tabla de nombres es más corta y no repite la línea de
copyright, pero apuntan al mismo proyecto con la misma URL de licencia.

## Qué permite la OFL y qué no

Permite:

- Usarlas en un producto, comercial o no.
- Empaquetarlas y redistribuirlas con la aplicación.
- Modificarlas, mientras la versión modificada no use los nombres reservados.

No permite:

- Vender las fuentes por separado.
- Usar sus nombres para promocionar el producto.

Esta app cumple: las fuentes van dentro del producto, no se venden aparte y su
nombre no se usa como reclamo.

## Atribución

El aviso de copyright de cada familia queda en su fichero y en la tabla de
arriba. El texto completo de la SIL OFL 1.1 está en
<https://openfontlicense.org> y conviene incluir una copia literal (`OFL.txt`)
junto a las fuentes si el proyecto se publica. Ese texto no se copia aquí para
no arrastrar errores de transcripción: es corto y se descarga de su origen.

## Cómo se comprobó

Un script de Node leyó la cabecera de cada `.woff2`, descomprimió el bloque
Brotli con `zlib` y extrajo las cadenas de la tabla `name`. No se ejecutó nada del
fichero: solo se leyó. El resultado es el de la tabla de arriba.

## KaTeX (fórmulas del chat)

Las fórmulas del hilo se pintan con **KaTeX 0.16**, que es **MIT** (no OFL: es
código, no tipografía, aunque distribuya sus propias fuentes matemáticas). El
paquete viaja dentro de `renderer/katex/` con su `LICENSE` al lado, copiado por
`scripts/build-monaco.mjs` desde `node_modules/katex`. Las fuentes que usa
(`KaTeX_Main`, `KaTeX_Math`, …) van en la misma carpeta y su licencia es la del
propio proyecto, incluida ahí mismo.
