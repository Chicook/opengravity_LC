/**
 * Validación real de `--json-schema`.
 *
 * Ajv es una dependencia de ejecución pequeña y estándar; escribir un
 * validador de JSON Schema a mano dejaría fuera `anyOf`, `pattern`, etc.
 */

import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);
const Ajv = requerir('ajv');

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

export type Validador = (data: unknown) => string | null;

/** Compila el esquema; lanza si el esquema no es válido. */
export function compilarValidador(esquema: unknown): Validador {
  let validar: ((data: unknown) => boolean) & { errors?: unknown };
  try {
    validar = ajv.compile(esquema);
  } catch (error) {
    throw new Error(
      `--json-schema inválido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return (data: unknown) => {
    if (validar(data)) return null;
    return `La respuesta no cumple --json-schema: ${ajv.errorsText(validar.errors)}`;
  };
}
