# Herramientas: qué hay y qué no

El inventario de Antigravity tiene una herramienta que se replicó con otro
mecanismo. Conviene dejarlo escrito para no confundirlo con un olvido.

## `generate_image` — existe, pero no por la vía del original

**Corrección:** este documento decía que la herramienta no existía. Sí existe
(`electron/tools-extra.cjs`, registrada en `electron/main.cjs`), y genera imágenes
conduciendo Google Flow en el navegador integrado con la sesión de Google del
usuario.

Por qué no gasta dinero: no hay clave de API ni servicio propio; se usa la sesión
que el usuario ya tiene abierta. Lo que sí hay que asumir es que depende de una
interfaz web ajena (la de Flow), que puede cambiar sin aviso: por eso la
herramienta es la parte más frágil del catálogo, no una parte ausente.

Su `generate_image` original acepta `Prompt`, `AspectRatio` y `Images[]` hasta 3
referencias; la nuestra acepta prompt y proporción. Las imágenes de referencia no
están cubiertas.

## `list_peers` en `manage_subagent` — no es una exclusión

Ya está implementado: `manage_subagent` acepta `list`, `list_peers`, `kill` y
`kill_all`, igual que el suyo. Aparecía como pendiente en el informe por un error
de búsqueda.

## Lo que sí se añadió

- `multi_replace` — varios reemplazos por rango en una llamada.
- `send_message` — mensajes a subagentes vivos, con `@children`.
- `edit_notebook` — operaciones sobre celdas de `.ipynb` (`list`, `get`, `add`,
  `update`, `delete`, `create`), con 17 pruebas.

## Balance del inventario

| Antigravity | Opengravity |
|---|---|
| 27 herramientas | 27 replicadas; `generate_image` por otra vía (Google Flow) |
