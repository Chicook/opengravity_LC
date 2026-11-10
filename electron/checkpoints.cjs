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

  for (const key of [...keys].sort((a, b) => b - a)) {
    const snapshot = checkpoints.get(key);
    if (!snapshot) continue;
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
