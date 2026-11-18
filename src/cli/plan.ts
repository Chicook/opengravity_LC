/**
 * Ciclo planner ↔ executor para el CLI.
 *
 * Reutiliza `plan-mode.cjs`, el mismo ciclo que usa la app: el planner solo lee,
 * entrega el plan con `present_plan`; al aprobarlo, la compuerta abre escritura
 * y el executor vuelve a pedir revisión cada N invocaciones.
 */

import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);
const { CicloDePlan, PROMPT_EXECUTOR } = requerir('../../electron/plan-mode.cjs');

export class PlanSession {
  private ciclo: InstanceType<typeof CicloDePlan>;

  constructor(empezarPlanificando = false) {
    // El CLI no registra enter_plan_mode: no se piden revisiones que no podría entregar.
    this.ciclo = new CicloDePlan({ empezarPlanificando, cada: 100000, maxRevisiones: 0 });
  }

  /** Un turno nuevo empieza en la fase que pida el modo actual. */
  reiniciar(empezarPlanificando = false): void {
    this.ciclo = new CicloDePlan({ empezarPlanificando, cada: 100000, maxRevisiones: 0 });
  }

  /**
   * La instrucción del turno ya explica el ciclo. No se añade PROMPT_PLANNER:
   * ese texto dice «no ejecutas», y tras aprobar el plan sí se ejecuta.
   */
  sistema(base: string, _modo: string): string {
    return base;
  }

  /** Compuerta de herramientas del ciclo; cuenta las invocaciones del executor. */
  compuerta(call: { name: string }): string | null {
    const rechazo = this.ciclo.compuerta(call);
    if (!rechazo) this.ciclo.contarInvocacion();
    return rechazo;
  }

  mensajePendiente(): string | null {
    return this.ciclo.mensajePendiente();
  }

  /** El plan aprobado abre la fase de ejecución. */
  entregarPlan(plan: unknown): void {
    this.ciclo.entregarPlan(plan);
  }

  /** En `plan` se permite escribir solo después de aprobar el plan. */
  ejecutando(): boolean {
    return this.ciclo.fase === 'ejecutando';
  }

  get promptEjecutor(): string {
    return PROMPT_EXECUTOR;
  }

  get fase(): string {
    return String(this.ciclo.fase);
  }
}
