'use strict';

/**
 * Restaura los snapshots del más nuevo al más antiguo.
 * Si un fichero falla, su snapshot se conserva para poder reintentar.
 */
async function restoreSnapshots({ keys, checkpoints, writeFile, rm }) {
  const failures = [];
  let restored = 0;

  for (const key of [...keys].sort((a, b) => b - a)) {
    const snapshot = checkpoints.get(key);
    if (!snapshot) continue;

    let falloEnSnapshot = false;
    for (const [absolute, original] of snapshot) {
      try {
        if (original === null) {
          await rm(absolute, { force: true });
        } else {
          await writeFile(absolute, original, 'utf8');
        }
        restored += 1;
      } catch (error) {
        falloEnSnapshot = true;
        failures.push({
          path: absolute,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!falloEnSnapshot) checkpoints.delete(key);
  }

  return { restored, failures };
}

module.exports = { restoreSnapshots };
