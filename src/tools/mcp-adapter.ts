/**
 * Adaptador MCP → Tool.
 *
 * Las herramientas de un servidor MCP se envuelven como `Tool` para que el
 * agente las use igual que las nativas. Así `chrome-devtools-mcp`, un servidor
 * de ficheros o de git entran sin tocar el bucle del agente.
 *
 * Los tipos del protocolo viven en `src/mcp/types.ts`; aquí solo está la
 * conversión a la abstracción del agente.
 */

import { defineTool, type Tool } from './types.js';
import type { McpClientLike, McpToolDescriptor } from '../mcp/types.js';

/**
 * Convierte una herramienta MCP en una `Tool` del agente.
 *
 * El nombre que ve el modelo se sanea: OpenAI y Anthropic solo aceptan
 * `[A-Za-z0-9_-]` (máx. 64), y muchos servidores usan `server.tool` o `foo/bar`.
 * La llamada al servidor conserva el nombre original.
 */
export function fromMcpTool(
  client: McpClientLike,
  descriptor: McpToolDescriptor,
  originalName = descriptor.name,
): Tool {
  return defineTool({
    name: descriptor.name,
    description: descriptor.description ?? `Herramienta MCP: ${originalName}`,
    parameters: descriptor.inputSchema ?? { type: 'object', properties: {}, required: [] },
    async execute(args) {
      const result = await client.callTool(originalName, args);
      return { content: result.text, isError: result.isError };
    },
  });
}

/** Envuelve todas las herramientas de un servidor MCP. */
export async function toolsFromMcpServer(client: McpClientLike): Promise<Tool[]> {
  const descriptors = await client.listTools();
  const vistos = new Set<string>();

  return descriptors.map((descriptor) => {
    const base = descriptor.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'mcp_tool';
    let nombre = base;
    let sufijo = 2;
    while (vistos.has(nombre)) {
      nombre = `${base.slice(0, 56)}_${sufijo}`;
      sufijo += 1;
    }
    vistos.add(nombre);
    return fromMcpTool(client, { ...descriptor, name: nombre }, descriptor.name);
  });
}
