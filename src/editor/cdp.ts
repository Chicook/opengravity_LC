/**
 * Cliente del Chrome DevTools Protocol.
 *
 * Permite a un agente observar y controlar un editor basado en Electron igual
 * que lo haría una herramienta externa: por CDP, sin privilegios especiales.
 *
 * Requiere Node 22+ (WebSocket global). Sin dependencias.
 *
 * @example
 * const targets = await listCdpTargets('http://127.0.0.1:9222');
 * const page = targets.find((t) => t.type === 'page');
 * const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
 * const title = await cdp.evaluate<string>('document.title');
 * cdp.close();
 */

/** Destino CDP tal como lo anuncia `/json/list`. */
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/**
 * Forma mínima de WebSocket que usa este módulo.
 *
 * Se declara aquí en lugar de depender de los tipos DOM o de `ws`: el runtime
 * solo necesita estos métodos.
 */
interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', handler: () => void): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', handler: (event: unknown) => void): void;
  addEventListener(type: 'close', handler: () => void): void;
}

type WebSocketConstructor = new (url: string) => MinimalWebSocket;

function getWebSocketConstructor(): WebSocketConstructor {
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof ctor !== 'function') {
    throw new Error(
      'Este runtime no expone WebSocket global. Se requiere Node 22 o superior.',
    );
  }
  return ctor as WebSocketConstructor;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/** Error devuelto por el protocolo. */
export class CdpError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`CDP ${method} falló (${code}): ${message}`);
    this.name = 'CdpError';
    this.code = code;
    this.data = data;
  }
}

/** Sesión CDP sobre un único destino. */
export class CdpClient {
  private readonly ws: MinimalWebSocket;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>();
  private nextId = 1;
  private closed = false;

  private constructor(ws: MinimalWebSocket) {
    this.ws = ws;
    this.attach();
  }

  /** Conecta al `webSocketDebuggerUrl` de un destino. */
  static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpClient> {
    const WebSocketImpl = getWebSocketConstructor();
    const ws = new WebSocketImpl(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout de ${timeoutMs} ms conectando a ${wsUrl}`));
      }, timeoutMs);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`no se pudo conectar a ${wsUrl}`));
      });
    });

    return new CdpClient(ws);
  }

  /** Envía un comando y espera su resultado. */
  send<T = unknown>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('sesión CDP cerrada'));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout de ${timeoutMs} ms en ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
      });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evalúa una expresión en el contexto de la página.
   *
   * Devuelve el valor ya deserializado (`returnByValue`), no el objeto remoto.
   */
  async evaluate<T = unknown>(
    expression: string,
    options: { awaitPromise?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const response = await this.send<{
      result?: { value?: unknown; description?: string; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: options.awaitPromise ?? true,
        userGesture: true,
      },
      options.timeoutMs ?? 30_000,
    );

    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'excepción sin detalle';
      throw new Error(`evaluación falló: ${detail}`);
    }

    return response.result?.value as T;
  }

  /** Se suscribe a un evento del protocolo. Devuelve la función para desuscribirse. */
  on(event: string, handler: (params: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);

    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  /** Cierra la sesión y rechaza los comandos pendientes. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`sesión cerrada durante ${entry.method}`));
    }
    this.pending.clear();

    try {
      this.ws.close();
    } catch {
      // ya cerrado
    }
  }

  private attach(): void {
    this.ws.addEventListener('message', (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (!message || typeof message !== 'object') return;
      const payload = message as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { code?: number; message?: string; data?: unknown };
      };

      if (typeof payload.id === 'number') {
        this.settle(payload);
        return;
      }

      if (typeof payload.method === 'string') {
        for (const handler of this.listeners.get(payload.method) ?? []) {
          handler(payload.params);
        }
      }
    });

    this.ws.addEventListener('close', () => {
      if (this.closed) return;
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`conexión CDP cerrada durante ${entry.method}`));
      }
      this.pending.clear();
    });
  }

  private settle(payload: {
    id?: number;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
  }): void {
    if (typeof payload.id !== 'number') return;

    const entry = this.pending.get(payload.id);
    if (!entry) return;

    this.pending.delete(payload.id);
    clearTimeout(entry.timer);

    if (payload.error) {
      entry.reject(
        new CdpError(entry.method, payload.error.code ?? -1, payload.error.message ?? 'error', payload.error.data),
      );
      return;
    }

    entry.resolve(payload.result);
  }
}

/**
 * Lista los destinos disponibles en un endpoint CDP.
 *
 * @param endpoint `http://127.0.0.1:9222` (el puerto de `--remote-debugging-port`).
 */
export async function listCdpTargets(endpoint: string): Promise<CdpTarget[]> {
  const base = endpoint.replace(/\/+$/, '');
  const response = await fetch(`${base}/json/list`);

  if (!response.ok) {
    throw new Error(`CDP ${base}/json/list respondió ${response.status}`);
  }

  const payload = (await response.json()) as Array<{
    id?: string;
    type?: string;
    title?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
  }>;

  const targets: CdpTarget[] = [];
  for (const entry of payload) {
    if (!entry.id || !entry.webSocketDebuggerUrl) continue;
    targets.push({
      id: entry.id,
      type: entry.type ?? 'desconocido',
      title: entry.title ?? '',
      url: entry.url ?? '',
      webSocketDebuggerUrl: entry.webSocketDebuggerUrl,
    });
  }

  return targets;
}

/**
 * Conecta al primer destino que cumpla el filtro.
 * Atajo para el caso habitual: "el primer page".
 */
export async function connectToPage(
  endpoint: string,
  filter: (target: CdpTarget) => boolean = (target) => target.type === 'page',
): Promise<CdpClient> {
  const targets = await listCdpTargets(endpoint);
  const target = targets.find(filter);

  if (!target) {
    const available = targets.map((entry) => `${entry.type}:${entry.title}`).join(', ') || '(ninguno)';
    throw new Error(`no hay destino que cumpla el filtro en ${endpoint}. Disponibles: ${available}`);
  }

  return CdpClient.connect(target.webSocketDebuggerUrl);
}
