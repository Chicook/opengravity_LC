# Herramientas excluidas y por qué

El inventario de Antigravity tiene dos herramientas que no se han replicado. Las
dos por motivos distintos, y conviene dejarlo escrito para no confundirlo con un
olvido.

## `generate_image` — excluida por la regla de coste cero

Su `generate_image` (`Prompt`, `AspectRatio`, `Images[]` hasta 3 referencias)
genera imágenes con un servicio de Google.

**No se puede replicar sin gastar dinero.** Opengravity funciona con la API del
modelo que el usuario ya paga; generar imágenes requiere un proveedor aparte
(Imagen, DALL·E, Stable Diffusion) con su propia cuenta y su propia factura.

Eso choca de frente con la regla 2 del proyecto: *«nada de telemetría, ni
servidores propios, ni servicios de pago. Lo único que puede costar dinero es la
API del modelo que el usuario ya paga»*.

**Qué haría falta para tenerla**: que el usuario configure un proveedor de
imágenes propio y asuma su coste. Mientras tanto, la herramienta no existe — es
preferible a tener una que siempre devuelva error.

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
| 27 herramientas | 26 replicadas + `generate_image` excluida |
