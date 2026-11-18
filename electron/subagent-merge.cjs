'use strict';

/**
 * Lanzamiento de subagentes en paralelo con presupuesto de espera.
 *
 * El original declara `merge_subagents_latency_ms`: varias ramas a la vez y una
 * espera máxima antes de fusionar lo que haya. Aquí las ramas ya iban en
 * paralelo (`Promise.all`), pero sin tope: un subagente atascado retrasaba el
 * turno entero. Este módulo pone el tope y devuelve lo que llegó.
 *
 * Una tarea vencida se aborta por su `AbortSignal` —el bucle del agente lo
 * respeta— y se informa como vencida, no como error del modelo.
 */

/**
 * @template T
 * @param {Array<{nombre: string, ejecutar: (signal: AbortSignal) => Promise<T>}>} tareas
 * @param {{presupuestoMs?: number, ahora?: () => number}} opciones
 * @returns {Promise<{resultados: Array<{nombre: string, valor?: T, error?: string, vencido: boolean}>, vencidos: number, fallos: number, ms: number}>}
 */
async function correrEnParalelo(tareas, opciones = {}) {
  const lista = Array.isArray(tareas) ? tareas : [];
  const presupuesto = Math.max(0, Number(opciones.presupuestoMs ?? 0));
  const ahora = opciones.ahora ?? (() => Date.now());
  const inicio = ahora();

  const correrUna = async (tarea) => {
    const controlador = new AbortController();
    let temporizador = null;

    const vence = new Promise((resolver) => {
      if (presupuesto === 0) return; // 0 = sin tope
      temporizador = setTimeout(() => {
        controlador.abort();
        resolver({ vencido: true });
      }, presupuesto);
      // No mantiene vivo el proceso si el turno termina antes.
      temporizador.unref?.();
    });

    try {
      const valor = await Promise.race([
        Promise.resolve().then(() => tarea.ejecutar(controlador.signal)),
        vence,
      ]);

      if (valor && typeof valor === 'object' && valor.vencido === true) {
        return {
          nombre: tarea.nombre,
          vencido: true,
          error: `no terminó en ${Math.round(presupuesto / 1000)} s y se canceló`,
        };
      }
      return { nombre: tarea.nombre, valor, vencido: false };
    } catch (error) {
      return {
        nombre: tarea.nombre,
        vencido: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(temporizador);
    }
  };

  const resultados = await Promise.all(lista.map(correrUna));

  return {
    resultados,
    vencidos: resultados.filter((r) => r.vencido).length,
    fallos: resultados.filter((r) => r.error && !r.vencido).length,
    ms: ahora() - inicio,
  };
}

module.exports = { correrEnParalelo };
