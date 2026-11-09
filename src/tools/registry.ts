/**
 * Registro de herramientas.
 *
 * Mantiene el catálogo que se expone al modelo y despacha las llamadas.
 * Aísla al agente de cómo se implementa cada herramienta (nativa, MCP, shell…).
 */

import type { ToolDef } from '../providers/types.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Añade una herramienta. Falla si el nombre ya existe: evita sombras silenciosas. */
  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`herramienta duplicada: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Añade varias de golpe. */
  registerAll(tools: Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  /** Catálogo en el formato que esperan los proveedores. */
  definitions(): ToolDef[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Ejecuta una herramienta por nombre.
   *
   * Nunca lanza: los fallos se devuelven como `ToolResult` con `isError`, para
   * que el modelo pueda leerlos y corregir en el siguiente turno.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Herramienta desconocida: ${name}. Disponibles: ${this.names().join(', ')}`,
        isError: true,
      };
    }

    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Fallo en ${name}: ${message}`, isError: true };
    }
  }
}
