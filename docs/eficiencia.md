# Eficiencia comparada con Antigravity

Nota propia, escrita a partir del código de este repositorio. **No** se ha
inspeccionado el producto original: lo que se dice de Antigravity es lo que ya
estaba documentado en `docs/antigravity/README.md`, y lo que se mide aquí es
nuestro código. Todo lo demás sería una suposición y va marcado como tal.

## Lo que se puede medir de este proyecto

| Aspecto | Antes | Ahora | Cómo se comprueba |
|---|---|---|---|
| Tope de contexto | 400 000 caracteres fijos para todos los modelos | Sale de la ventana del modelo (8k, 32k, 128k, 200k, 1M…) | `test/contexto.test.mjs`, `test/contexto-loop.test.mjs` |
| Ventana declarada por el proveedor | Se descartaba al listar modelos | Se guarda por `proveedor:modelo` | `recordarVentana` en `electron/main.cjs` |
| Ventana de un modelo local | No se consultaba | `POST /api/show` de Ollama, sin bloquear | `ventanaDeOllama` |
| Adaptadores | — | 22 proveedores en el catálogo, casi todos por el protocolo de OpenAI | `src/providers/catalog.ts` |

## Por qué el tope fijo era caro

El presupuesto se mide en caracteres porque el bucle necesita una cuenta barata y
síncrona antes de cada llamada. Un único valor para todos los modelos falla por
los dos lados:

- **Demasiado grande**: el proveedor rechaza la petición completa por exceso de
  contexto. Se pierde el turno entero, no el trozo que sobra.
- **Demasiado pequeño**: se compacta cuando aún cabía todo. Cada compactación es
  una llamada más al modelo (resumir) y pierde detalle del historial.

Ninguno de los dos casos da error visible: el primero se ve como un fallo del
proveedor y el segundo como "el agente se olvida de lo que hicimos".

## La ventaja del código abierto, en términos medibles

La diferencia que sí es comprobable en el árbol no es de rendimiento bruto, es de
**libertad de elección**: el catálogo (`src/providers/catalog.ts`) lista 22
proveedores —Ollama, LM Studio, vLLM, llama.cpp, OpenAI, Anthropic, Gemini,
OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras,
Perplexity, Moonshot, Z.ai, OpenCode Zen, OpenCode Go y dos «compatible con» a los
que se les da URL y clave—. Un modelo local cuesta 0 por token; los de
razonamiento de primera línea cuestan más por token pero resuelven en menos
pasos. Al no estar atado a un backend, la palanca de coste está en el usuario y
no en el producto.

Eso no convierte al proyecto en más rápido ni más barato por sí solo: **la
eficiencia depende del modelo que se elija**, y una elección mejor solo se puede
hacer si el motor respeta la ventana de cada uno, que es justo lo que arregla
este cambio.

## Correcciones de esta ronda

- El presupuesto de contexto descuenta el prompt de sistema y las definiciones
  de herramienta, que viajan en la misma petición. Antes solo medía `messages`:
  un modelo de 8k recibía más historial del que cabía con el prompt y las tools.
- Ollama recibe `options.num_ctx` y `options.num_predict`; sin `num_ctx` usaba
  4k por defecto y truncaba el prompt aunque el agente hubiera calculado otra
  ventana.
- Los servidores locales sin ventana declarada asumen 8k, no 128k. La ventana
  del nombre (`:8k`, `:32k`) y la de `/api/show` siguen mandando.
- Los nombres MCP se sanean para los proveedores; la llamada conserva el
  original.

## Lo que sigue sin medirse

- Comparación de tiempo por turno contra el producto original: haría falta
  ejecutar ambos con la misma tarea y el mismo modelo. No se ha hecho.
- Calidad de las respuestas: subjetiva y dependiente del modelo.
- Coste real por tarea: depende de precios del proveedor que cambian a menudo.
