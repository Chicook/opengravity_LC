# Revisión de Opengravity

Revisión del proyecto tal como está en esta carpeta. Fecha: 2026-11-14.
Tercera ronda: análisis profundo del programa (binarios, paquete y código).

## Resumen

El proyecto **compila y sus pruebas pasan todas (428)**. La base es sólida: hay un
motor de agente de verdad, 22 endpoints de proveedor, y las defensas obvias
(aislamiento del renderer, escape de HTML, cifrado de claves) están puestas.
Lo que fallaba no era la arquitectura sino **los bordes**: rutas de fichero sin
confinar, un servidor de control remoto que podía arrancar sin contraseña, una
puerta interna (`app://`) que servía cualquier fichero del disco, y la interfaz
sin vetar navegaciones. Los tres últimos ya están cerrados. Quedan abiertos el
confinamiento de ficheros (decisión de diseño pendiente) y un problema **legal**,
no técnico: el repositorio incluye copias de la interfaz del producto propietario,
y el paquete de `release/` está caducado y sin firmar.

## Lo comprobado (hecho, no deducido)

| Comprobación | Resultado |
|---|---|
| `npm run build` (TypeScript) | Correcto, sin errores |
| `npm test` | **428 pruebas, 52 suites, 0 fallos** |
| Catálogo de proveedores | 22 entradas (4 adaptadores: OpenAI, Anthropic, Gemini, Ollama) |
| Ventana principal | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` |
| Navegación de la ventana | solo `app://local/`; las ventanas nuevas se deniegan |
| `<webview>` del navegador | se le fuerza `nodeIntegration: false` y se le quita el `preload` |
| Markdown del chat | escapa el HTML: `<img onerror>` sale como texto, no se ejecuta |
| Resaltador de código | escapa el HTML también |
| Salida de la terminal | escapa el HTML antes de pintarla |
| Claves de API en disco | cifradas con `safeStorage`; si no hay cifrado, no escribe claves nuevas en claro |
| Canales entre interfaz y proceso principal | 123, con nombres fijos (uno solo se calcula al vuelo) |

## Análisis profundo del programa

Esta ronda miró los binarios y el paquete, no solo el código.

**El lanzador de arena es real.** La app compila su propio lanzador en C#
(`og-sandbox.exe`, en la carpeta temporal) y lo usa para ejecutar comandos con
límites. El análisis de sus importaciones nativas muestra 13 llamadas a
`kernel32`: crear el «Job Object» (grupo de procesos con límites), aplicarle las
restricciones, asignarle el proceso y terminarlo en bloque. Y lo arranca
**suspendido** y lo asigna al grupo **antes** de reanudarlo, que es la secuencia
correcta: así ningún proceso hijo puede escapar antes de estar limitado.

**El módulo nativo de terminal no abre red.** `conpty.node` solo importa
`KERNEL32`, `SHLWAPI` y el propio `node.exe` (el motor de JavaScript). No hay
sockets ahí.

**El paquete de `release/` está caducado.** Comparado con el código de esta
carpeta, su `app.asar` difiere en 2 ficheros y le faltan 22 módulos compilados.
En concreto, **no lleva los dos arreglos de la ronda anterior**: el validador de
id de sesión y el token del control remoto. Quien instale ese paquete tiene los
fallos que aquí ya están corregidos.

**Ni el ejecutable ni las piezas nativas están firmadas.** Windows mostrará
«editor desconocido» al instalar. Es lo normal sin certificado de firma, pero
contradice la idea de una app lista para el usuario final.

## Fallos encontrados

### 1. Alto — Borrado de ficheros fuera de la carpeta de sesiones (ARREGLADO)

`electron/main.cjs` (`sessions:delete`) pasaba el id que llega del renderer a
`jsonl-store.ts`, que montaba la ruta como `carpeta/sesiones/{id}.jsonl` sin
comprobar el id. Un id como `../../../algo` hace que el borrado salga de la
carpeta de sesiones.

**Arreglo aplicado:** `sessionPath` ahora valida el id (`^[A-Za-z0-9._-]+$`, y
rechaza `.` y `..`). Comprobado: `../escape`, `..\escape`, `a/b`, `a\b` y vacío se
rechazan; los ids normales siguen funcionando.

### 2. Alto — Control remoto sin contraseña (ARREGLADO)

El servidor de control remoto escucha solo en `127.0.0.1`, pero el token era
**opcional**: si estaba vacío, cualquier petición local se aceptaba. Y el
renderer, al recibir un prompt remoto, lo escribe en la caja de texto y **lo
envía solo**, sin confirmación. Cualquier página web abierta en el equipo podía
lanzar prompts al agente.

**Arreglo aplicado:** si no hay token, se genera uno aleatorio y se guarda; y la
comparación es en tiempo constante (`mismoToken`), para que no se pueda adivinar
midiendo tiempos de respuesta.

### 3. Alto — La puerta interna `app://` servía cualquier fichero del disco (ARREGLADO)

El renderer se sirve con un esquema propio (`app://`) porque Chromium bloquea los
workers de Monaco desde `file://`. El manejador hacía
`path.join(app.getAppPath(), decodeURIComponent(pathname))` **sin comprobar que
el resultado siguiera dentro de la app**. Con una barra invertida codificada
(`app://local/..%5C..%5CUsers%5Cx`) subía dos niveles y devolvía ficheros ajenos;
con una ruta absoluta codificada (`app://local/C:%5CWindows%5Cwin.ini`) se
descartaba la raíz del todo.

Detalle medido que conviene no confundir: el parser de URL **ya colapsa** los
`..` normales (`app://local/../../x` llega como `/x`). El agujero real era la
barra invertida y la ruta absoluta, que `path.resolve`/`path.join` sí interpretan
en Windows. Lo comprobé con un script aparte antes de arreglarlo.

**Arreglo aplicado:** nuevo módulo `electron/protocol-path.cjs` con
`resolverRutaApp()`, que resuelve la ruta y la contiene bajo la raíz de la app
(comparación de prefijo **con separador**, para que `C:\app-otra` no pase por
`C:\app`). Si se sale, responde 404. Seis pruebas nuevas en
`test/protocol-path.test.mjs` fijan la frontera.

### 4. Alto — La ventana principal no vetaba navegaciones (ARREGLADO)

Se cargaba `app://local/renderer/index.html` sin escuchar `will-navigate` ni
`setWindowOpenHandler`. Si la página navegaba a un sitio externo, esa página
recibía **el preload y con él los 123 canales**: escritura de ficheros, terminal,
ajustes. Hoy no hay un enlace que lo provoque (el clic en enlaces está
interceptado y se abre fuera), así que era un riesgo latente, no explotado.

**Arreglo aplicado:** `will-navigate` solo deja pasar `app://local/`; las ventanas
nuevas se deniegan y los enlaces `http(s)` se abren en el navegador del sistema.

### 5. Alto (sin arreglar) — Lectura y escritura de ficheros sin confinar

`fs:read`, `fs:write`, `fs:list` e `fs:index` resuelven la ruta pero **no
comprueban que siga dentro del proyecto**. Existe la función que lo haría
(`dentroDelWorkspace`, en `hooks.cjs`) y las herramientas del agente la usan, pero
estos canales de la interfaz no. Sumado a que la ventana va con `sandbox: false`,
si algo consiguiera ejecutar código en la interfaz tendría lectura y escritura de
ficheros con los permisos del usuario.

**No lo he arreglado a propósito:** el diálogo «Abrir fichero» devuelve rutas
absolutas y el editor guarda con esa misma ruta, así que confinar sin más
**rompería abrir y guardar ficheros de fuera del proyecto**. El arreglo correcto
es permitir las rutas que el usuario ha autorizado con el diálogo (una lista de
permisos) y rechazar el resto. Es una decisión de diseño, no un parche.

### 6. Medio — Los valores por defecto aprueban escrituras sin revisar

`permissionPreset` viene en `"Turbo"`, que está en `AUTO_APPROVE_PRESETS`: el
agente escribe ficheros sin enseñar el diff. Y `restrictToWorkspace` viene en
`false`, así que el sandbox de rutas está apagado. Para un IDE con agente, lo
razonable es empezar pidiendo revisión y dejar «Turbo» como opción explícita.

### 7. Medio — El paquete de `release/` está caducado y sin firmar

Ver arriba. Tres consecuencias: no lleva dos arreglos de seguridad, Windows lo
trata como de editor desconocido, y quien lo reparta reparte código viejo.

### 8. Medio (legal) — Material del producto original: qué se retiró y qué no

`docs/antigravity/` incluía `estilos.css` (411 KB, «todas sus hojas de estilo»),
`dom.html` (181 KB, «el árbol completo de la app») e `ipc.md` (sus 57 canales
internos), versionados en git. Su propio README explicaba que se extrajeron de la
aplicación en ejecución y de su `app.asar`. Eso chocaba con lo que dice el
`README` («no contiene código, assets ni branding de ningún producto
propietario») y con una licencia MIT.

**Retirado:** los siete ficheros copiados (`estilos.css`, `dom.html`,
`ajustes.html`, `chat-pasos.html`, `ipc.md`, `chat-estructura.md`,
`ajustes-secciones.md`). En su lugar queda `docs/antigravity/README.md`, que anota
qué se retiró, por qué, y cómo se toman ahora las medidas (valores propios en
`docs/design-tokens.md`, que ya era la referencia real del código).

**No retirado, y con razón: las cinco fuentes `GoogleSans*.woff2`.** En una
primera pasada las quité por considerarlas propietarias. Era una suposición mía y
estaba mal. Leí la tabla de nombres que cada `.woff2` lleva dentro (descomprimida
con Brotli) y las cinco declaran la **SIL Open Font License 1.1**, con la URL
`openfontlicense.org` y un copyright que remite a
`github.com/googlefonts/googlesans` y `…/googlesans-code`. La OFL permite
redistribuirlas dentro de un producto. Están restauradas en `assets/fonts/`, el
CSS vuelve a declararlas y `docs/fuentes-licencias.md` recoge la atribución.

**Queda pendiente una cosa que no se puede hacer desde aquí:** los siete ficheros
del producto siguen en el **historial** de git. Hay que reescribirlo
(`git filter-repo --path docs/antigravity/estilos.css --invert-paths`, y lo mismo
con el resto) y forzar el push, lo que cambia los hashes de todos los commits. Eso
afecta a cualquiera que tenga el repositorio clonado, así que es una decisión del
dueño, no un paso automático.

### 9. Bajo — La regla del proyecto pide copiar la interfaz 1:1

`AGENTS.md` dice que la réplica 1:1 de la interfaz «es el criterio de
aceptación» y que se averigua «leyendo su código». Es coherente con el punto 8 y
es lo que conviene revisar antes de publicar el proyecto como abierto.

### 10. Bajo — Listado de directorios sin filtrar por contenido

`fs:list` y `fs:index` solo excluyen `node_modules` y `.git` por nombre. No es un
fallo de seguridad por sí mismo (es el proyecto del usuario), pero conviene
decidir qué se indexa.

### 11. Bajo — La raíz del repositorio no es la app

`index.html` en la raíz es un «Simulador de Tornado» (1515 líneas, en español)
que no forma parte de la aplicación ni está versionado. No estorba, pero confunde
a quien abra la carpeta: la app real es `renderer/index.html`. Vale la pena
moverlo a una carpeta de pruebas o borrarlo.

## Lo que no se ha podido comprobar

- **Que la app arranque y funcione de verdad.** No se ha lanzado: aquí solo se
  compila y se prueba. Las herramientas estáticas nunca demuestran que el código
  se ejecutó.
- **La afirmación «copia 1:1 de Antigravity».** No se puede verificar sin abrir el
  producto original, que esta revisión no hace. Los tests cubren el motor, no la
  interfaz (lo dice el propio README).
- **Que los 22 proveedores respondan.** Hay 4 adaptadores; los otros 18 son
  endpoints que reutilizan el adaptador de OpenAI. Que un endpoint esté en la
  lista no demuestra que autentique bien.
- **La generación de imágenes con Google Flow**, que conduce un navegador oculto
  sobre una interfaz web ajena: es frágil por naturaleza y depende de que esa
  página no cambie.

## Sobre comparar con el Antigravity que tienes instalado

Buena idea, y es la pregunta correcta, pero **esta revisión no puede hacerlo**: el
modo de trabajo de esta sesión es de «sala limpia», que nunca abre, lee ni ejecuta
el producto original. Sirve para que lo revisado no herede su código ni su marca.

Lo que sí se ha hecho es comprobar la paridad **contra tu propia documentación**
de Antigravity, que ya está en el repositorio. Los tres huecos que esos informes
daban por faltantes no faltan:

| Documento decía | Realidad en el código |
|---|---|
| `edit_notebook` ❌ falta | implementado y registrado para el agente |
| `generate_image` ❌ falta | implementado (conduce Google Flow con tu sesión) |
| `run_extension_code` ❌ falta | implementado (`tools-extra.cjs:1291`) |

Se corrigieron esos documentos (`docs/analysis/paridad-funcional.md` y
`docs/analysis/herramientas-excluidas.md`). Lo único que sigue fuera de alcance en
`generate_image` son las imágenes de referencia (hasta 3 en el original).

**Si quieres la comparación visual de verdad**, la forma limpia es hacerla tú
abriendo los dos lado a lado y diciendo las diferencias concretas. Para que sea
medible y no «a ojo», tu propio `docs/analysis/paridad-en-vivo.md` ya describe el
método (medir con CDP en el Antigravity real y comparar número a número).

## Siguiente paso sugerido

1. Decidir el modelo de permisos de ficheros (punto 5).
2. Reescribir el historial de git para que los ficheros retirados del punto 8
   desaparezcan también de los commits antiguos.
3. Reempaquetar `release/` con los arreglos, o no repartir binarios y dejar que
   cada uno compile (punto 7).
