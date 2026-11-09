# Referencia de la interfaz de Antigravity

Material extraído de Antigravity para replicar su interfaz **exactamente**. Es la
fuente de consulta: antes de inventar un valor, se busca aquí y se confirma en su
DOM en ejecución.

## Ficheros

| Fichero | Qué es | Tamaño |
|---|---|---|
| `estilos.css` | **Todas** sus hojas de estilo, 3 664 reglas de 14 hojas | 411 KB |
| `dom.html` | El árbol completo de la app (`.agy-shell`) con todas sus clases | 181 KB |
| `ipc.md` | Los 57 canales IPC de su proceso principal | — |

## De dónde sale cada cosa

- **`estilos.css` y `dom.html`**: de la app en ejecución por CDP
  (`--remote-debugging-port=9223`). Se recorren `document.styleSheets` y
  `cssRules` y se serializa `outerHTML`. Son los valores reales, con las reglas
  que ganan.
- **`ipc.md`**: de `app.asar` con `npx @electron/asar extract`. Son ficheros de
  texto empaquetados, no código compilado.

## Lo que NO está en `app.asar`

Su interfaz **no** vive ahí: el asar contiene el proceso principal (5 MB:
`ipcHandlers.js`, `hostBridgeServer.js`, `guestDialogController.js`…) y la UI la
sirve su servidor local (`https://127.0.0.1:64869/`). Por eso lo visual se saca
del DOM en ejecución y no del paquete.

Su `resources/bin/language_server.exe` (179 MB, Go compilado) es otra cosa: ese
sí exige ingeniería inversa de verdad y ya está documentado en
`docs/analysis/agente-cascade.md`.

## Cómo usarlo

1. **Antes de escribir CSS nuevo**, buscar la regla en `estilos.css`:
   ```
   grep -n "terminal__tab\|\.tab-pill" docs/antigravity/estilos.css
   ```
2. **Para ver cómo está montado un elemento**, buscar su clase en `dom.html`.
3. **Para confirmar un valor computado** —el que realmente se pinta— medir en su
   DOM en ejecución. El CSS dice la regla; el DOM dice cuál gana.

Las capturas de pantalla sirven para detectar que algo difiere, nunca para medir.
