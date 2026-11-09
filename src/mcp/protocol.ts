/**
 * Formas del cable JSON-RPC 2.0 usadas por MCP sobre stdio.
 *
 * El transporte stdio de MCP es una secuencia de objetos JSON separados por
 * salto de línea: uno por mensaje, sin cabeceras ni delimitadores extra.
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorPayload;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Distingue una respuesta de una notificación o de una petición del servidor. */
export function isResponse(message: unknown): message is JsonRpcResponse {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Record<string, unknown>;
  if (candidate['jsonrpc'] !== '2.0') return false;
  const hasId = candidate['id'] !== undefined && candidate['id'] !== null;
  return hasId && ('result' in candidate || 'error' in candidate);
}

/** `true` si el mensaje es una petición del servidor que espera respuesta. */
export function isServerRequest(message: unknown): message is JsonRpcRequest {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' &&
    typeof candidate['method'] === 'string' &&
    candidate['id'] !== undefined &&
    candidate['id'] !== null
  );
}

/** `true` si el mensaje es una notificación (sin `id`). */
export function isNotification(message: unknown): message is JsonRpcNotification {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' &&
    typeof candidate['method'] === 'string' &&
    (candidate['id'] === undefined || candidate['id'] === null)
  );
}

/** Códigos de error JSON-RPC que interesa distinguir. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** Error lanzado por el cliente cuando el servidor responde con `error`. */
export class McpError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`MCP ${code}: ${message}`);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}
