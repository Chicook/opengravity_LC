# Proveedores de modelo

Catálogo en `src/providers/catalog.ts`. Añadir uno nuevo es una entrada más; si
habla el protocolo de OpenAI no hace falta escribir adaptador.

## Autodetección de modelos

Cada proveedor expone un endpoint de listado que el motor consulta al arrancar.
Si el usuario define la clave, los modelos aparecen solos: no hay que escribirlos
a mano en ningún sitio.

| Tipo de adaptador | Endpoint de listado | Autenticación |
|---|---|---|
| `openai` (compatible) | `GET {baseUrl}/models` | `Authorization: Bearer <clave>` |
| `anthropic` | `GET {baseUrl}/models` | `x-api-key` + `anthropic-version` |
| `gemini` | `GET {baseUrl}/models?key=<clave>` | clave en query |
| `ollama` | `GET {baseUrl}/api/tags` | sin clave |

Si el endpoint falla o no existe, se usa una lista curada como respaldo
(Anthropic y Gemini) para que la UI nunca se quede vacía.

## Catálogo

### Locales (sin clave)

| id | Nombre | Endpoint | Nota |
|---|---|---|---|
| `ollama` | Ollama | `http://127.0.0.1:11434` | Requiere `ollama serve` |
| `lmstudio` | LM Studio | `http://127.0.0.1:1234/v1` | Servidor local |
| `vllm` | vLLM | `http://127.0.0.1:8000/v1` | Servidor local |
| `llamacpp` | llama.cpp | `http://127.0.0.1:8080/v1` | `llama-server` |

### En la nube

| id | Nombre | Endpoint | Variable de entorno |
|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | Anthropic | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `xai` | xAI (Grok) | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `together` | Together AI | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| `fireworks` | Fireworks AI | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` |
| `perplexity` | Perplexity | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` |
| `moonshot` | Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `zai` | Z.ai (GLM) | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY` |

### OpenCode

| id | Nombre | Endpoint | Variable |
|---|---|---|---|
| `opencode-zen` | OpenCode Zen | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` |
| `opencode-go` | OpenCode Go | `https://opencode.ai/zen/go/v1` | `OPENCODE_API_KEY` |

Ambos son OpenAI-compatibles y comparten la misma clave: Zen es pago por uso y
Go es suscripción. Se envía la cabecera `x-opencode-session` con un id estable
por proceso, que OpenCode usa para enrutar y cachear prompts.

OpenCode Go también expone modelos Anthropic-compatibles (MiniMax, Qwen) en
`https://opencode.ai/zen/go`; para esos, usa el proveedor personalizable
`anthropic-compatible` con esa URL.

### Personalizables

El usuario aporta la URL y la clave desde **Settings › Models**. Se guardan en
`settings.json` dentro del directorio de usuario de la app.

| id | Nombre | Protocolo | Endpoint |
|---|---|---|---|
| `openai-compatible` | OpenAI Compatible | `/chat/completions` | el que indiques |
| `anthropic-compatible` | Anthropic Compatible | `/v1/messages` | el que indiques |

Sirven para gateways corporativos, proxies, LiteLLM, vLLM remoto, o cualquier
servicio que imite uno de los dos protocolos.

## Sobrescribir un endpoint

Cualquier proveedor acepta `<ID>_BASE_URL` en mayúsculas (los guiones pasan a
guion bajo). Útil para proxies, gateways corporativos o servidores propios:

```powershell
$env:OPENROUTER_BASE_URL = "https://mi-proxy.interno/v1"
$env:OLLAMA_BASE_URL = "http://192.168.1.50:11434"
$env:OPENCODE_GO_BASE_URL = "https://mi-gateway/v1"
```

El valor se normaliza (se quita la barra final) y tiene prioridad sobre el
catálogo. En los proveedores personalizables el override de entorno también
funciona, pero lo normal es usar los ajustes.

## Uso

```bash
# Ver el catálogo completo con endpoints
npm run dev -- --list-providers

# Listar modelos detectados de un proveedor
npm run dev -- --provider openrouter --list

# Usar un proveedor concreto
npm run dev -- --provider groq --model llama-3.3-70b-versatile "resume este repo"
```

En la app de escritorio: **Settings › Models**.

## Añadir un proveedor

```ts
// src/providers/catalog.ts
{
  id: 'mi-proveedor',
  label: 'Mi Proveedor',
  kind: 'openai',                    // o 'anthropic' | 'gemini' | 'ollama'
  baseUrl: 'https://api.ejemplo.com/v1',
  envKey: 'MI_PROVEEDOR_API_KEY',
}
```

Nada más. Aparece en la CLI, en los ajustes y en el desplegable de modelo.

Si el proveedor **no** habla el protocolo de OpenAI, hay que escribir un
adaptador en `src/providers/` que implemente `ModelProvider`.
