/**
 * Reexporta, con tipos, la tabla de niveles de pensamiento.
 *
 * La implementación vive en `electron/pensamiento.cjs` para que el proceso
 * principal de Electron y el CLI compilado usen exactamente la misma escala: dos
 * copias se desincronizan en cuanto una se toca y la otra no.
 */

import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);

/** Resultado normalizado de `normalizarNivel`. */
export type NivelPensamiento = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Lo que hay que mandar al proveedor para un nivel. */
export interface AjustesDePensamiento {
  thinkingBudget?: number;
  reasoningEffort?: string;
  thinkingLevel?: string;
}

interface ModuloPensamiento {
  NIVELES: readonly NivelPensamiento[];
  NIVEL_POR_DEFECTO: NivelPensamiento;
  TOKENS_POR_NIVEL: Record<NivelPensamiento, number>;
  ESFUERZO_OPENAI: Record<NivelPensamiento, string>;
  NIVEL_GEMINI: Record<NivelPensamiento, string>;
  normalizarNivel(nivel?: string | null): NivelPensamiento | null;
  ajustesDePensamiento(opciones?: {
    nivel?: string | null;
    tipo?: string | null;
    proveedor?: string | null;
    modelo?: string | null;
  }): AjustesDePensamiento;
  etiquetaDeNivel(nivel?: string | null): string;
}

export const {
  NIVELES,
  NIVEL_POR_DEFECTO,
  TOKENS_POR_NIVEL,
  normalizarNivel,
  ajustesDePensamiento,
  etiquetaDeNivel,
} = requerir('../../electron/pensamiento.cjs') as ModuloPensamiento;
