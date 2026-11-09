#!/usr/bin/env node
/**
 * Punto de entrada.
 *
 * Demo del sistema completo: detecta proveedores, conecta servidores MCP,
 * registra herramientas y ejecuta el agente sobre el directorio actual.
 *
 * Uso:
 *   npm run dev -- "resume qué hace este proyecto"
 *   npm run dev -- --provider openai --model gpt-4o-mini "lista los ficheros"
 *   npm run dev -- --list
 *   npm run dev -- --tools
 *   npm run dev -- --mcp-command npx --mcp-arg -y \
 *     --mcp-arg @modelcontextprotocol/server-filesystem --mcp-arg . \
 *     "busca los TODO del proyecto"
 */

import { runAgent } from './agent/loop.js';
import { CdpClient, connectToPage } from './editor/cdp.js';
import { editorTools } from './editor/tools.js';
import { StdioMcpClient } from './mcp/stdio-client.js';
import { JsonlSessionStore } from './persistence/jsonl-store.js';
import { createProvider, detectAvailableProviders, PROVIDER_CATALOG } from './providers/registry.js';
import type { Message } from './providers/types.js';
import { fileSystemTools } from './tools/fs.js';
import { toolsFromMcpServer } from './tools/mcp-adapter.js';
import { ToolRegistry } from './tools/registry.js';

interface McpServerSpec {
  command: string;
  args: string[];
}

interface CliOptions {
  provider: string;
  model: string | undefined;
  prompt: string;
  listModelsOnly: boolean;
  listToolsOnly: boolean;
  listSessionsOnly: boolean;
  listProvidersOnly: boolean;
  mcpServers: McpServerSpec[];
  /** Puerto CDP del editor, si se quiere conectar a uno vivo. */
  cdpPort: number | undefined;
  /** Id de sesión a reanudar. `--session last` reanuda la más reciente. */
  session: string | undefined;
  /** Si es `true`, no se guarda nada en disco. */
  noSave: boolean;
}

const SYSTEM_PROMPT = `Eres un asistente de programación integrado en un IDE.

Reglas:
- Usa las herramientas disponibles para inspeccionar el código antes de responder.
- Cita rutas de fichero concretas cuando hables de código.
- Si algo no lo has comprobado, dilo explícitamente en lugar de suponerlo.
- Responde en el idioma del usuario.`;

function parseArgs(argv: string[]): CliOptions {
  let provider = 'ollama';
  let model: string | undefined;
  let listModelsOnly = false;
  let listToolsOnly = false;
  let listSessionsOnly = false;
  let listProvidersOnly = false;
  let noSave = false;
  let session: string | undefined;
  let cdpPort: number | undefined;
  const mcpServers: McpServerSpec[] = [];
  const words: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    switch (arg) {
      case '--list':
        listModelsOnly = true;
        break;

      case '--tools':
        listToolsOnly = true;
        break;

      case '--list-sessions':
        listSessionsOnly = true;
        break;

      case '--list-providers':
        listProvidersOnly = true;
        break;

      case '--no-save':
        noSave = true;
        break;

      case '--session': {
        const value = argv[index + 1];
        if (!value) throw new Error('--session requiere un id o "last"');
        session = value;
        index += 1;
        break;
      }

      case '--provider': {
        const value = argv[index + 1];
        if (!value) throw new Error('--provider requiere un valor');
        provider = value;
        index += 1;
        break;
      }

      case '--model': {
        const value = argv[index + 1];
        if (!value) throw new Error('--model requiere un valor');
        model = value;
        index += 1;
        break;
      }

      case '--cdp': {
        const value = argv[index + 1];
        if (!value) throw new Error('--cdp requiere un número de puerto');
        const port = Number(value);
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error(`--cdp espera un puerto válido, recibido: ${value}`);
        }
        cdpPort = port;
        index += 1;
        break;
      }

      case '--mcp-command': {
        const value = argv[index + 1];
        if (!value) throw new Error('--mcp-command requiere un valor');
        mcpServers.push({ command: value, args: [] });
        index += 1;
        break;
      }

      case '--mcp-arg': {
        const value = argv[index + 1];
        if (value === undefined) throw new Error('--mcp-arg requiere un valor');
        const last = mcpServers[mcpServers.length - 1];
        if (!last) throw new Error('--mcp-arg debe ir después de --mcp-command');
        last.args.push(value);
        index += 1;
        break;
      }

      default:
        words.push(arg);
        break;
    }
  }

  return {
    provider,
    model,
    prompt: words.join(' ').trim(),
    listModelsOnly,
    listToolsOnly,
    listSessionsOnly,
    listProvidersOnly,
    mcpServers,
    cdpPort,
    session,
    noSave,
  };
}

/**
 * Conecta todos los servidores MCP indicados y registra sus herramientas.
 * Los fallos de un servidor no impiden usar los demás.
 */
async function connectMcpServers(
  specs: McpServerSpec[],
  tools: ToolRegistry,
): Promise<StdioMcpClient[]> {
  const clients: StdioMcpClient[] = [];

  for (const spec of specs) {
    const label = [spec.command, ...spec.args].join(' ');
    try {
      const client = await StdioMcpClient.start({
        command: spec.command,
        args: spec.args,
        onStderr: (chunk) => process.stderr.write(`[mcp] ${chunk}`),
      });
      clients.push(client);

      const mcpTools = await toolsFromMcpServer(client);
      const prefix = client.serverInfo?.name ?? 'mcp';

      for (const tool of mcpTools) {
        // Un servidor MCP puede chocar con una herramienta nativa: se prefija.
        tools.register(tools.has(tool.name) ? { ...tool, name: `${prefix}_${tool.name}` } : tool);
      }

      console.log(
        `MCP "${prefix}" v${client.serverInfo?.version ?? '?'}: ${mcpTools.length} herramientas`,
      );
    } catch (error) {
      console.error(
        `No se pudo iniciar MCP "${label}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return clients;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = new JsonlSessionStore();

  // `--list-providers` solo muestra el catálogo.
  if (options.listProvidersOnly) {
    console.log('Proveedores disponibles:\n');
    for (const spec of PROVIDER_CATALOG) {
      const key = spec.envKey ?? '(sin clave)';
      const local = spec.local ? ' · local' : '';
      console.log(`  ${spec.id.padEnd(12)} ${spec.label}`);
      console.log(`  ${''.padEnd(12)} ${spec.baseUrl}`);
      console.log(`  ${''.padEnd(12)} clave: ${key}${local}`);
      if (spec.note) console.log(`  ${''.padEnd(12)} ${spec.note}`);
      console.log();
    }
    return;
  }

  // `--list-sessions` solo lee el índice.
  if (options.listSessionsOnly) {
    const sessions = await store.list();
    if (sessions.length === 0) {
      console.log('No hay sesiones guardadas.');
      return;
    }
    console.log('Sesiones guardadas:\n');
    for (const session of sessions) {
      console.log(`  ${session.id}`);
      console.log(`    ${session.title}`);
      console.log(
        `    ${session.provider}/${session.model} · ${session.messageCount} mensajes · ${session.updatedAt}`,
      );
    }
    return;
  }

  // `--tools` solo lista herramientas: no necesita proveedor de modelo.
  if (options.listToolsOnly) {
    const tools = new ToolRegistry().registerAll(fileSystemTools);
    const clients = await connectMcpServers(options.mcpServers, tools);
    try {
      console.log('\nHerramientas disponibles:');
      for (const definition of tools.definitions()) {
        console.log(`  ${definition.name} — ${definition.description.split('\n')[0]}`);
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
    return;
  }

  const available = await detectAvailableProviders();
  if (available.length === 0) {
    console.error(
      'No hay proveedores disponibles.\n' +
        '  · Ollama: instala https://ollama.com y ejecuta `ollama serve`\n' +
        '  · OpenAI: exporta OPENAI_API_KEY\n' +
        '  · Anthropic: exporta ANTHROPIC_API_KEY\n' +
        '  · Gemini: exporta GEMINI_API_KEY',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Proveedores detectados: ${available.join(', ')}`);

  if (!available.includes(options.provider)) {
    console.error(`El proveedor "${options.provider}" no está disponible.`);
    process.exitCode = 1;
    return;
  }

  const provider = createProvider(options.provider);
  const models = await provider.listModels();

  if (options.listModelsOnly) {
    console.log(`\nModelos de ${options.provider}:`);
    for (const model of models) {
      const context = model.contextWindow
        ? ` — ${model.contextWindow.toLocaleString('es')} tokens`
        : '';
      console.log(`  ${model.id}${context}`);
    }
    return;
  }

  // --- Servidores MCP -------------------------------------------------------
  const tools = new ToolRegistry().registerAll(fileSystemTools);
  const mcpClients = await connectMcpServers(options.mcpServers, tools);

  // --- Editor vivo por CDP --------------------------------------------------
  let cdpClient: CdpClient | undefined;
  if (options.cdpPort !== undefined) {
    try {
      cdpClient = await connectToPage(`http://127.0.0.1:${options.cdpPort}`);
      tools.registerAll(editorTools(cdpClient));
      console.log(`Editor conectado por CDP en el puerto ${options.cdpPort}`);
    } catch (error) {
      console.error(
        `No se pudo conectar al editor en el puerto ${options.cdpPort}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    if (options.prompt.length === 0) {
      console.error('Falta la pregunta. Ejemplo: npm run dev -- "resume este proyecto"');
      process.exitCode = 1;
      return;
    }

    const selectedModel = options.model ?? models[0]?.id;
    if (!selectedModel) {
      console.error(`El proveedor "${options.provider}" no reporta modelos. Usa --model.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Modelo: ${selectedModel}`);
    console.log(`Herramientas: ${tools.names().join(', ')}`);

    // --- Sesión -------------------------------------------------------------
    let sessionId: string | undefined;
    let initialMessages: Message[] = [];

    if (!options.noSave) {
      try {
        if (options.session !== undefined) {
          const target = options.session === 'last' ? (await store.latest())?.id : options.session;
          if (!target) throw new Error('no hay sesiones guardadas que reanudar');

          const loaded = await store.load(target);
          sessionId = loaded.meta.id;
          initialMessages = loaded.messages;
          console.log(`Sesión ${sessionId} reanudada (${initialMessages.length} mensajes)`);
        } else {
          const created = await store.create({
            provider: options.provider,
            model: selectedModel,
            cwd: process.cwd(),
          });
          sessionId = created.id;
          console.log(`Sesión nueva: ${sessionId}`);
        }
      } catch (error) {
        console.error(
          `No se pudo abrir la sesión (${error instanceof Error ? error.message : String(error)}). ` +
            'Se continúa sin guardar.',
        );
        sessionId = undefined;
      }
    }

    console.log('');

    const result = await runAgent(
      {
        provider,
        model: selectedModel,
        tools,
        system: SYSTEM_PROMPT,
        maxSteps: 16,
        ...(initialMessages.length > 0 ? { initialMessages } : {}),
        onEvent: (event) => {
          switch (event.type) {
            case 'text':
              process.stdout.write(event.text);
              break;
            case 'tool_start':
              process.stdout.write(
                `\n  → ${event.call.name}(${JSON.stringify(event.call.arguments)})\n`,
              );
              break;
            case 'tool_end':
              process.stdout.write(`  ← ${event.isError ? 'error' : 'ok'}\n`);
              break;
            case 'step':
              if (event.index > 1) process.stdout.write(`\n[paso ${event.index}]\n`);
              break;
            case 'done':
              process.stdout.write(`\n\n[${event.reason} · ${event.steps} pasos]\n`);
              break;
          }
        },
      },
      options.prompt,
      { cwd: process.cwd() },
    );

    if (result.reason === 'error') process.exitCode = 1;

    if (sessionId !== undefined) {
      try {
        // Solo el tramo nuevo: el historial cargado ya está en disco.
        await store.append(sessionId, result.messages.slice(initialMessages.length));
        console.log(`Sesión guardada: ${sessionId}`);
      } catch (error) {
        console.error(
          `No se pudo guardar la sesión: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    cdpClient?.close();
    await Promise.all(mcpClients.map((client) => client.close()));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
