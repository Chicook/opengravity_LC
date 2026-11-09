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

/** Convierte una herramienta MCP en una `Tool` del agente. */
export function fromMcpTool(client: McpClientLike, descriptor: McpToolDescriptor): Tool {
  return defineTool({
    name: descriptor.name,
    description: descriptor.description ?? `Herramienta MCP: ${descriptor.name}`,
    parameters: descriptor.inputSchema ?? { type: 'object', properties: {}, required: [] },
    async execute(args) {
      const result = await client.callTool(descriptor.name, args);
      return { content: result.text, isError: result.isError };
    },
  });
}

/** Envuelve todas las herramientas de un servidor MCP. */
export async function toolsFromMcpServer(client: McpClientLike): Promise<Tool[]> {
  const descriptors = await client.listTools();
  return descriptors.map((descriptor) => fromMcpTool(client, descriptor));
}
