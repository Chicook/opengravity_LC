/**
 * Paneles de la TUI.
 *
 * Son texto estructurado, no una interfaz de pantalla completa: muestran el
 * estado, las sesiones y el catálogo sin salir del bucle del agente. El ancho se
 * fija para que las cajas no se rompan en terminales estrechas.
 */

import type { PermissionsConfig } from './settings.js';

const ANCHO = 78;

function recortar(texto: string, ancho: number): string {
  return texto.length <= ancho ? texto : `${texto.slice(0, Math.max(0, ancho - 1))}…`;
}

function linea(titulo: string, valor: string): string {
  return `${titulo.padEnd(14)}${recortar(valor, ANCHO - 18)}`;
}

/** Caja con un título y filas ya formateadas. */
export function caja(titulo: string, filas: string[]): string {
  const interior = ANCHO - 4;
  const salida = [`╭─ ${recortar(titulo, ANCHO - 5)} ${'─'.repeat(Math.max(0, ANCHO - titulo.length - 5))}╮`];
  for (const fila of filas) {
    salida.push(`│ ${recortar(fila, interior).padEnd(interior)} │`);
  }
  salida.push(`╰${'─'.repeat(ANCHO - 2)}╯`);
  return salida.join('\n');
}

export interface DatosPanel {
  modelo: string;
  modo: string;
  ventana: number;
  mensajes: number;
  herramientas: string[];
  sandbox: boolean;
  permisos?: PermissionsConfig;
  mcp: string[];
  skills: Array<{ name: string; description?: string }>;
  agentes: Array<{ name: string; role: string }>;
  sesion?: string;
  planFase?: string;
}

function resumenPermisos(permisos?: PermissionsConfig): string {
  if (!permisos) return 'sin reglas';
  const partes = [
    permisos.allow?.length ? `allow ${permisos.allow.length}` : '',
    permisos.ask?.length ? `ask ${permisos.ask.length}` : '',
    permisos.deny?.length ? `deny ${permisos.deny.length}` : '',
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'sin reglas';
}

/** Líneas del panel general, sin la caja exterior. */
export function lineasEstado(datos: DatosPanel): string[] {
  const herramientas = datos.herramientas.slice(0, 12).join(', ');
  const resto = datos.herramientas.length > 12
    ? `${herramientas}, … (+${datos.herramientas.length - 12})`
    : herramientas;
  const skills = datos.skills.length > 0
    ? datos.skills.slice(0, 8).map((s) => s.name).join(', ')
    : 'ninguna';
  const agentes = datos.agentes.length > 0
    ? datos.agentes.slice(0, 8).map((a) => `${a.name} (${a.role})`).join(', ')
    : 'ninguno';

  return [
    linea('Modelo', datos.modelo),
    linea('Modo', datos.modo),
    linea('Plan', datos.planFase ?? 'libre'),
    linea('Ventana', `${datos.ventana} tokens`),
    linea('Mensajes', String(datos.mensajes)),
    linea('Sesión', datos.sesion ?? 'sin guardar'),
    linea('Sandbox', datos.sandbox ? 'sí' : 'no'),
    linea('Permisos', resumenPermisos(datos.permisos)),
    linea('MCP', datos.mcp.length > 0 ? datos.mcp.join(', ') : 'ninguno'),
    linea('Herramientas', `${datos.herramientas.length}: ${resto}`),
    linea('Skills', skills),
    linea('Subagentes', agentes),
  ];
}

/** Panel general: estado, catálogo y contexto. */
export function panelEstado(datos: DatosPanel): string {
  return caja('Opengravity', lineasEstado(datos));
}

/** Líneas de sesiones, sin la caja exterior. */
export function lineasSesiones(
  sesiones: Array<{ id: string; title: string; updatedAt: string; messageCount: number }>,
): string[] {
  if (sesiones.length === 0) return ['No hay conversaciones guardadas.'];
  return sesiones.slice(0, 20).map((sesion) =>
    `${sesion.id}  ${recortar(sesion.title, 34)}  ${sesion.messageCount} msj  ${sesion.updatedAt.slice(0, 10)}`,
  );
}

/** Panel de sesiones guardadas, con título y fecha. */
export function panelSesiones(
  sesiones: Array<{ id: string; title: string; updatedAt: string; messageCount: number }>,
): string {
  return caja(`Sesiones (${sesiones.length})`, lineasSesiones(sesiones));
}
