/**
 * Presupuesto de contexto para el motor en TypeScript.
 *
 * La implementación vive en `electron/contexto.cjs` porque la app de escritorio
 * la necesita de forma síncrona (y no puede `import()` en mitad de un turno).
 * Esta capa la reexporta con tipos para que el CLI y el motor usen exactamente
 * las mismas cuentas: dos copias de esta fórmula acabarían divergiendo, y el
 * síntoma sería un turno que falla solo en una de las dos interfaces.
 */

import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);

interface ModuloContexto {
  ventanaEnElNombre(modelId: string): number | null;
  ventanaDeModelo(opciones?: {
    providerId?: string;
    modelId?: string;
    reportada?: number;
  }): number;
  presupuestoDeContexto(opciones?: {
    providerId?: string;
    modelId?: string;
    reportada?: number;
  }): number;
  ventanaDeOllama(payload: unknown): number | null;
  capacidadesDeOllama(payload: unknown): { tools: boolean; vision: boolean } | null;
  VENTANA_GENERICA: number;
  VENTANA_MINIMA_TOKENS: number;
}

// `../../electron/contexto.cjs` desde `dist/agent/` y desde `src/agent/`.
const contexto = requerir('../../electron/contexto.cjs') as ModuloContexto;

export const ventanaEnElNombre = contexto.ventanaEnElNombre;
export const ventanaDeModelo = contexto.ventanaDeModelo;
export const presupuestoDeContexto = contexto.presupuestoDeContexto;
export const ventanaDeOllama = contexto.ventanaDeOllama;
export const capacidadesDeOllama = contexto.capacidadesDeOllama;
export const VENTANA_GENERICA = contexto.VENTANA_GENERICA;
export const VENTANA_MINIMA_TOKENS = contexto.VENTANA_MINIMA_TOKENS;
