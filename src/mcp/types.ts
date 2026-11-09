/**
 * Tipos del protocolo MCP que usa el proyecto.
 *
 * Solo se modela lo necesario para el flujo de herramientas: descubrir y
 * ejecutar. Prompts y resources quedan fuera de este alcance inicial.
 *
 * Especificación: https://modelcontextprotocol.io/specification
 */

/** Herramienta tal como la anuncia un servidor MCP. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Resultado de invocar una herramienta MCP, ya normalizado a texto. */
export interface McpCallResult {
  text: string;
  isError: boolean;
}

/**
 * Interfaz mínima que necesita el adaptador `tools/mcp-adapter.ts`.
 *
 * Cualquier transporte (stdio, HTTP, SSE) que implemente esto sirve.
 */
export interface McpClientLike {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

/** Versión del protocolo MCP que anuncia este cliente. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';
