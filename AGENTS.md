# Directrices del proyecto

Reglas que gobiernan todo el trabajo en este repositorio. Se leen antes de empezar.

## 1. Es una réplica 1:1 de la interfaz de Antigravity

Opengravity es la versión open source de Antigravity. **Un usuario que venga de
Antigravity tiene que encontrarse exactamente la misma interfaz**: mismos
elementos, en el mismo sitio, con las mismas medidas, los mismos estados y los
mismos atajos.

Esto no es una preferencia estética: es el criterio de aceptación del producto.

### Qué implica

- **Nunca se inventa ni se elige.** No hay «opción (a), (b) o (c)» diseñada por
  mí. Si hay que decidir cómo conviven dos elementos, la respuesta es lo que
  haga Antigravity, y se averigua leyendo su código.
- **No se pregunta al usuario por decisiones de interfaz.** Si la duda es «¿cómo
  lo hace Antigravity?», es una tarea de medición, no una pregunta. Se mide y se
  replica. Solo se pregunta cuando falta información que no está en Antigravity
  (una tarea de prueba, una preferencia personal fuera del producto).
- **No se copia de capturas.** Una captura sirve para detectar que algo difiere;
  las medidas salen del DOM real (`outerHTML`, reglas CSS aplicadas,
  `getBoundingClientRect`). Las capturas ya han engañado varias veces en este
  proyecto.
- **Lo que Antigravity no tiene, no se añade.** Y lo que tiene, no se omite salvo
  lo excluido explícitamente: marketplace, cuentas, planes, facturación y
  logos/marca.
- **Los detalles pequeños cuentan.** Un icono que falta, un texto de relleno, un
  ancho de 4 px o un elemento colocado en el sitio equivocado son fallos, no
  matices.

### Cómo se verifica

- Medir en Antigravity con CDP (`--remote-debugging-port=9223`) y comparar
  número a número con lo nuestro.
- Verificar en vivo, no por inspección del código. Una función que «parece
  correcta» no está verificada.
- Comprobar el resultado con una captura **después** de que las medidas cuadren,
  nunca en su lugar.

## 2. Coste cero más allá de la API del usuario

Nada de telemetría, ni servidores propios, ni servicios de pago. Lo único que
puede costar dinero es la API del modelo que el usuario ya paga.

## 3. Nada de cambios que rompan lo ya corregido

Antes de tocar algo, comprobar qué se arregló antes en esa zona. Los fallos de
este proyecto se han repetido por volver a pisar lo mismo: estilos puestos en el
contenedor cuando el problema estaba en el hijo, variables CSS
autorreferentes, literales oscuros donde iba un token.

## 4. Verificar de verdad

- `npm test` antes de dar nada por bueno.
- Cuidado con las sondas propias: medir en el momento correcto y leer la fuente
  correcta (el buffer de xterm, no el DOM; `MonacoApp.monaco`, no
  `window.monaco`). Varias «regresiones» fueron errores de la sonda.
- Si algo no se pudo verificar, decirlo con esas palabras.
