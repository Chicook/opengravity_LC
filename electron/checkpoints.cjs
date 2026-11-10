'use strict';

/**
 * Restaura los snapshots del más nuevo al más antiguo.
 * Si algún fichero falla, se conservan todos los snapshots procesados para
 * poder reaplicar la cadena completa al reintentar.
 */
async function restoreSnapshots({ keys, checkpoints, writeFile, rm }) {
  const failures = [];
  const procesadas = [];
  let restored = 0;

  /*
   * El plan se copia antes de cualquier `await`: otro handler (`sessions:new`,
   * `sessions:load`) puede vaciar el mapa a mitad y el revert debe terminar
   * igualmente con los snapshots que había al empezar.
   */
  const plan = [...keys]
    .sort((a, b) => b - a)
    .map((key) => [key, checkpoints.get(key)])
    .filter(([, snapshot]) => Boolean(snapshot));

  for (const [key, snapshot] of plan) {
    procesadas.push(key);

    for (const [absolute, original] of snapshot) {
      try {
        if (original === null) {
          await rm(absolute, { force: true });
        } else {
          await writeFile(absolute, original, 'utf8');
        }
        restored += 1;
      } catch (error) {
        failures.push({
          path: absolute,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /*
   * Descarta los snapshots solo si la cadena entera se aplicó. Si un turno
   * falló a medias y se borrara, el reintento aplicaría únicamente el snapshot
   * restante y daría por bueno un estado intermedio: el original más antiguo
   * nunca se reescribiría.
   */
  if (failures.length === 0) {
    for (const key of procesadas) checkpoints.delete(key);
  }

  return { restored, failures };
}

module.exports = { restoreSnapshots };
