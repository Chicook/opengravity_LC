/**
 * Motor de permisos del CLI.
 *
 * Replica el subconjunto útil del motor de `agy`: recursos `action(target)`,
 * listas deny/ask/allow, write implica read, deny read implica deny write,
 * dominios con subdominios, comandos por prefijo de token o `regex:` y MCP
 * `server/tool`.
 */

import { resolve } from 'node:path';
import type { PermissionsConfig } from './settings.js';

export type Decision = 'allow' | 'ask' | 'deny' | null;
type Accion =
  | 'read_file'
  | 'write_file'
  | 'read_url'
  | 'execute_url'
  | 'download_url'
  | 'command'
  | 'mcp'
  | 'unsandboxed';

const ESCRITURAS: Record<string, true> = {
  write_file: true,
  edit_file: true,
  multi_replace: true,
  edit_notebook: true,
};

const LECTURAS: Record<string, true> = {
  read_file: true,
  list_directory: true,
  search_files: true,
  file_search: true,
  search_code: true,
  view_code_item: true,
  command_status: true,
  memory: true,
  skill: true,
  present_plan: true,
};

const COMANDOS: Record<string, true> = {
  run_command: true,
  run_workflow: true,
  run_extension_code: true,
  run_tests: true,
  manage_task: true,
  invoke_subagent: true,
};

const WEB: Record<string, true> = { search_web: true, fetch_url: true };

/** Acciones que hay que consultar para una herramienta. */
function accionesDe(tool: string, args: Record<string, unknown>): Accion[] {
  if (ESCRITURAS[tool] === true) {
    if (tool === 'edit_notebook') {
      const accion = String(args.action ?? '').toLowerCase();
      if (['list', 'get'].includes(accion)) return ['read_file'];
    }
    return ['write_file', 'read_file'];
  }
  if (LECTURAS[tool] === true) return ['read_file'];
  if (COMANDOS[tool] === true) return ['command'];
  if (WEB[tool] === true) return ['read_url'];
  if (tool === 'fetch_url') return ['read_url'];
  return ['mcp'];
}

function normalizarRuta(valor: string, cwd: string): string {
  let ruta = valor.replace(/\\/g, '/');
  ruta = ruta.replace(/^[A-Za-z]:/, '');
  if (!ruta.startsWith('/')) {
    const absoluta = resolve(cwd, ruta).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
    const relativa = absoluta.slice(resolve(cwd).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').length);
    ruta = relativa.startsWith('/') ? relativa.slice(1) : relativa;
  }
  return ruta.replace(/\/+/g, '/').replace(/\/$/, '');
}

function objetivo(tool: string, args: Record<string, unknown>, cwd: string): string {
  if (tool === 'run_command') return String(args.command ?? '');
  if (tool === 'search_web') return 'html.duckduckgo.com';
  if (tool === 'fetch_url') {
    try {
      return new URL(String(args.url ?? '')).host;
    } catch {
      return '';
    }
  }
  if (ESCRITURAS[tool] === true || LECTURAS[tool] === true) {
    const ruta = String(args.path ?? args.directory ?? '');
    return normalizarRuta(ruta, cwd);
  }
  // MCP: el nombre saneado suele ser `<servidor>_<tool>`.
  return tool;
}

function coincideAccion(accionRegla: Accion, accion: Accion): boolean {
  if (accionRegla === accion) return true;
  // write_file implica read_file.
  if (accionRegla === 'write_file' && accion === 'read_file') return true;
  return false;
}

function comandoSeguro(valor: string): boolean {
  // Constructos que pueden esconder ejecución arbitraria: sin prefijo.
  return !/\$\(|`|\$\(\(|<\(|\{[^}]*,[^}]*\}/.test(valor);
}

function prefijoDeTokens(valor: string, patron: string): boolean {
  const tokens = valor.trim().split(/\s+/);
  const objetivoTokens = patron.trim().split(/\s+/);
  if (objetivoTokens.length === 0) return false;
  if (!comandoSeguro(valor)) return valor === patron;
  return objetivoTokens.every((token, indice) => tokens[indice] === token);
}

function envoltorioTransparente(valor: string): string | null {
  const coincidencia = /^(?:timeout|nohup|nice|env)\s+(?:\S+\s+)?(.+)$/.exec(valor);
  return coincidencia?.[1] ?? null;
}

function coincideComando(valor: string, patron: string): boolean {
  if (patron === '*') return true;
  const interno = envoltorioTransparente(valor);
  if (interno) return coincideComando(interno, patron);
  if (patron.startsWith('regex:')) {
    try {
      return new RegExp(patron.slice(6)).test(valor);
    } catch {
      return false;
    }
  }
  return prefijoDeTokens(valor, patron);
}

function coincideDominio(host: string, patron: string): boolean {
  if (patron === '*') return true;
  const normal = patron.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const destino = host.toLowerCase();
  if (normal.includes(':')) return destino === normal; // localhost:port
  return destino === normal || destino.endsWith(`.${normal}`);
}

function coincideMCP(valor: string, patron: string): boolean {
  if (patron === '*') return true;
  const sano = patron.replace(/\//g, '_');
  if (patron.endsWith('/*')) return valor.startsWith(patron.slice(0, -1).replace(/\//g, '_'));
  return valor === sano || valor === patron || valor.endsWith(`_${patron.split('/').pop()}`);
}

function coincideObjetivo(accion: Accion, valor: string, patron: string): boolean {
  if (patron === '*') return true;
  if (accion === 'command') return coincideComando(valor, patron);
  if (accion === 'read_url' || accion === 'execute_url' || accion === 'download_url') {
    return coincideDominio(valor, patron);
  }
  if (accion === 'mcp') return coincideMCP(valor, patron);
  const ruta = patron.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').replace(/\/$/, '');
  return valor === ruta || valor.startsWith(`${ruta}/`);
}

function coincideRegla(
  regla: string,
  acciones: Accion[],
  tool: string,
  args: Record<string, unknown>,
  cwd: string,
): boolean {
  const coincidencia = /^([a-z_]+)(?:\((.*)\))?$/.exec(regla.trim());
  if (!coincidencia) return false;
  const [, nombre = '', destino] = coincidencia;
  const accionRegla = nombre as Accion;
  if (!acciones.some((accion) => coincideAccion(accionRegla, accion))) return false;
  if (destino === undefined) return true;
  return acciones.some(
    (accion) =>
      coincideAccion(accionRegla, accion) &&
      coincideObjetivo(accion, objetivo(tool, args, cwd), destino),
  );
}

function decidirLista(
  lista: string[] | undefined,
  acciones: Accion[],
  tool: string,
  args: Record<string, unknown>,
  cwd: string,
): boolean {
  return (
    Array.isArray(lista) &&
    lista.some((regla) => coincideRegla(String(regla), acciones, tool, args, cwd))
  );
}

/** Decide por reglas declarativas; `null` si ninguna aplica. */
export function decidirPorReglas(
  tool: string,
  args: Record<string, unknown>,
  permisos: PermissionsConfig | undefined,
  cwd = process.cwd(),
): Decision {
  if (!permisos) return null;
  const acciones = accionesDe(tool, args);
  if (decidirLista(permisos.deny, acciones, tool, args, cwd)) return 'deny';
  if (decidirLista(permisos.ask, acciones, tool, args, cwd)) return 'ask';
  if (decidirLista(permisos.allow, acciones, tool, args, cwd)) return 'allow';
  return null;
}
