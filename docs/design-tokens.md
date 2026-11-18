# Tokens de diseño (extraídos por análisis)

Valores obtenidos inspeccionando la UI en ejecución mediante CDP: DOM real,
hojas de estilo servidas y variables CSS computadas. **No se copió ningún
fichero de estilo**: los valores se transcribieron a `renderer/styles.css`.

- Origen: UI analizada v2.28.2 · Electron 44.5.1 · Chrome 152
- Viewport de referencia: 1400 × 900
- Tema: oscuro (clase `.dark` en el contenedor raíz)

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#101010` | lienzo principal |
| `--foreground` | `#cccccc` | texto base |
| `--card` | `#191919` | superficie de tarjetas / composer |
| `--card-border` | `#222222` | borde de tarjetas |
| `--border` | `#191919` | separadores |
| `--muted` | `#151515` | superficie atenuada |
| `--muted-foreground` | `#6e6e6e` | texto secundario |
| `--secondary` | `#272727` | controles y hover |
| `--secondary-foreground` | `#9d9d9d` | texto de controles |
| `--primary` | `#007acc` | acento / acción |
| `--primary-foreground` | `#ffffff` | texto sobre acento |
| `--sidebar` | `#151515` | barra lateral |
| `--sidebar-muted` | `#151515` | hover de fila |
| `--sidebar-secondary` | `#1b1b1b` | botón destacado |

Semánticos adicionales del sistema original: error `#f87171`, éxito `#4ade80`,
aviso `#fbbf24`, info `#38bdf8`, deshabilitado `#4d4d4d`.

## Radios

| Token | Valor |
|---|---|
| `--radius-xs` | 0.125rem (2px) |
| `--radius-sm` | 0.25rem (4px) |
| `--radius-md` | 0.375rem (6px) |
| `--radius-lg` | 0.5rem (8px) |
| `--radius-xl` | 0.75rem (12px) |

Píldoras y botones circulares: `9999px`.

## Métricas de layout

| Elemento | Valor |
|---|---|
| Ancho de barra lateral | `256px` (redimensionable, con sash de 8px) |
| Alto de barra de título | `35px` (medido con `getBoundingClientRect`) |
| Ancho del cluster estático | `182px` |
| Ancho máximo del hilo | `max(30vw, 48rem)` |
| Separador lateral | `1px` sólido `--border` |
| Hoja del panel | `1175×817` en `(257,75)`, radio `12px`, `--background`, con `8px` de aire a la derecha y abajo |
| Barra del panel | `40px`, de borde a borde, **encima** de la hoja |
| Composer (vacío) | `768×118` en `x=461`; 24 px hasta el borde de la hoja |
| Composer (con hilo) | `768×82` en `x=293`; 16 px hasta el borde de la hoja |
| Columna del hilo | `840px` con la tarjeta Overview abierta; `752px` de texto |
| Tarjeta Overview | `320×166`, a 12 px del borde superior derecho de la hoja |
| Ajustes | `1024×720` centrado en `(208,90)`, radio 24 (igual en ambos) |
| Tarjetas de Interface Layout | `305×114` (original `306×112`), rejilla de 2 con gap `12`, relleno `14`, radio `12`; la elegida con el primario al 10 % |

Estas filas se midieron con `Emulation.setDeviceMetricsOverride` a 1440×900 en
las dos aplicaciones y `getBoundingClientRect` sobre el DOM real, no sobre
capturas.

## Tipografía

- Familia: **Google Sans** (interfaz) y **Google Sans Code** (código), servidas desde
  `assets/fonts/`; detrás quedan `system-ui`/`Segoe UI` e `Inter` como reserva.
  Las cinco son SIL OFL, comprobado en la tabla de nombres de cada `.woff2`
  (ver [`fuentes-licencias.md`](fuentes-licencias.md)).
- Cuerpo: `14px` con `line-height: 20px` (medido: el original trabaja sobre 14 px).
- Etiquetas de sección: `11px`, mayúsculas, `letter-spacing: 0.04em`, peso 600.
- Botones de barra de título y píldoras: `12px`.
- Código y nombres de herramienta: `'Google Sans Code', ui-monospace, Consolas`.

## Estructura de la interfaz

```
app
├── titlebar (40px, drag)
│   ├── app icon + nueva conversación
│   └── menús: Workspace · View · Window
└── body (flex row)
    ├── sidebar (256px)
    │   ├── header: toggle · buscar
    │   ├── New Conversation (destacado) · Automations · Customizations
    │   ├── PROJECTS (+)
    │   ├── CONVERSATIONS
    │   │   └── fila: título + kebab (aparece en hover)
    │   └── footer: Settings
    ├── divider (1px + sash)
    └── content
        ├── toolbar: selector de proyecto · permisos ("Auto" con punto verde)
        ├── hilo (scroll, máx 48rem centrado)
        └── composer
            ├── textarea (placeholder "Ask anything, @ to mention, / for actions")
            └── footer: modelo · Turbo · enviar (28px, circular)
```

## Estados observados

| Elemento | Estado | Tratamiento |
|---|---|---|
| Fila de conversación | normal / hover / activa | fondo `transparent` → `--sidebar-secondary` → `--secondary` |
| Botón de envío | vacío / listo | `--secondary` + `--muted-foreground` → `--primary` + blanco |
| Composer | normal / foco | borde `--card-border` → mezcla con `--primary` al 55 % |
| Etiqueta de sección | — | mayúsculas, `--muted-foreground` |

## Panel de ajustes

Modal de dos columnas: navegación lateral de 190 px + contenido. Cabecera con
título, descripción y botón de cierre circular. Filas agrupadas con borde
compartido: etiqueta + descripción a la izquierda, control a la derecha.

### Secciones

| Sección | Subsecciones |
|---|---|
| General | Global Permissions · Agent Behavior · Execution · Built-in Browser · Browser Subagent |
| Account | Plan · Email · Marketing Emails · Sign Out |
| Appearance | Appearance (Theme: Default/Strong) · Dark Theme (Preset, Background, Foreground, Accent) · Advanced Settings |
| Notifications | General (Enable Notifications) · Sound (Enable Sounds, Volume) |
| Models | Provider · Model · Plan · Model Credits · Model Quota |
| Customizations | Token Usage · Skills · Plugins |
| Application | General · Remote Control · Notifications |
| Shortcuts | Navigation · Conversation · Layout Controls |

### Controles observados

| Ajuste | Tipo | Opciones |
|---|---|---|
| Permission Preset | select | Request Review · Default · Auto (Preview) · Turbo |
| Tool Permissions | botón + badge | contador de herramientas |
| Network Access Rules | botón | — |
| Plan Review Policy | select | Always Ask · … |
| Queued Messages | segmentado | Queue · Send Immediately |
| Open Links In | segmentado | External Browser · Built-in Browser |
| Browser JS Execution Policy | select | Request Review · … |
| Theme | segmentado | Default · Strong |
| Enable Notifications / Sounds | interruptor | — |
| Volume | deslizador | 0–100 % |

### Pie de la navegación

`Give Feedback` y ficha de cuenta con avatar, nombre y email.

## Ficheros de referencia

Los valores de este documento se midieron a mano y se transcribieron aquí. **No
se copió ningún fichero del producto original**: ni sus hojas de estilo, ni su
DOM, ni sus capturas. Ese material se retiró del repositorio por licencia (ver
`docs/antigravity/README.md`).

Si hace falta un valor nuevo, se decide con criterio propio, se anota aquí con su
motivo y se aplica en `renderer/styles.css`.
