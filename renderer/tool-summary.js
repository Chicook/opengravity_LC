(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ToolSummary = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /*
   * Antigravity agrupa las herramientas por intención, no por nombre técnico:
   * «Explored, ran commands, edited files». Mantener esta tabla aquí permite
   * probar el resumen y las estadísticas sin levantar Electron.
   */
  const VERBOS = [
    {
      plural: 'explored files',
      singular: 'explored file',
      tools: ['search_files', 'file_search', 'search_code', 'search_web', 'read_file', 'view_code_item'],
    },
    {
      plural: 'ran commands',
      singular: 'ran command',
      tools: ['run_command', 'run_tests', 'command_status', 'manage_task', 'list_directory'],
    },
    {
      plural: 'edited files',
      singular: 'edited file',
      tools: ['edit_file', 'write_file', 'multi_replace'],
    },
    { plural: 'generated images', singular: 'generated image', tools: ['generate_image'] },
    { plural: 'searched the web', singular: 'searched the web', tools: ['fetch_url', 'open_url'] },
    {
      plural: 'used the browser',
      singular: 'used the browser',
      tools: ['browser_open', 'browser_read', 'browser_click', 'browser_eval'],
    },
    {
      plural: 'delegated tasks',
      singular: 'delegated a task',
      tools: ['invoke_subagent', 'browser_task', 'define_subagent', 'manage_subagent'],
    },
    { plural: 'presented a plan', singular: 'presented a plan', tools: ['present_plan', 'exit_plan_mode'] },
    { plural: 'reviewed the plan', singular: 'reviewed the plan', tools: ['enter_plan_mode'] },
    { plural: 'asked a question', singular: 'asked a question', tools: ['ask_user_question'] },
    { plural: 'used memory', singular: 'used memory', tools: ['memory'] },
    { plural: 'read a skill', singular: 'read a skill', tools: ['skill'] },
    { plural: 'ran a workflow', singular: 'ran a workflow', tools: ['run_workflow'] },
    { plural: 'ran extension code', singular: 'ran extension code', tools: ['run_extension_code'] },
    { plural: 'scheduled a reminder', singular: 'scheduled a reminder', tools: ['notify_user'] },
  ];

  function resumirHerramientas(nombres, traducir = (texto) => texto) {
    const cuenta = new Map();
    for (const nombre of nombres ?? []) {
      const verbo = VERBOS.find((v) => v.tools.includes(nombre));
      if (!verbo) continue;
      cuenta.set(verbo, (cuenta.get(verbo) ?? 0) + 1);
    }

    // El orden es el de las categorías, no el de aparición: Antigravity
    // escribe siempre «Explored, ran commands, edited files».
    const vistos = [];
    for (const verbo of VERBOS) {
      const veces = cuenta.get(verbo);
      if (veces) vistos.push(veces === 1 ? verbo.singular : verbo.plural);
    }

    if (vistos.length === 0) return 'Ran commands';
    const texto = vistos.map((visto) => traducir(visto)).join(', ');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function lineCount(texto) {
    const limpio = String(texto ?? '').replace(/\r\n/g, '\n');
    if (limpio.length === 0) return 0;
    const lineas = limpio.split('\n');
    if (lineas[lineas.length - 1] === '') lineas.pop();
    return lineas.length;
  }

  /** LCS por líneas: exacto para los fragmentos que edita el agente. */
  function lineDiffStats(antes, despues) {
    const a = String(antes ?? '').replace(/\r\n/g, '\n').split('\n');
    const b = String(despues ?? '').replace(/\r\n/g, '\n').split('\n');
    if (a.length * b.length > 250_000) {
      return {
        additions: Math.max(0, b.length - a.length),
        removals: Math.max(0, a.length - b.length),
      };
    }

    const tabla = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        tabla[i][j] =
          a[i - 1] === b[j - 1]
            ? tabla[i - 1][j - 1] + 1
            : Math.max(tabla[i - 1][j], tabla[i][j - 1]);
      }
    }

    const comunes = tabla[a.length][b.length];
    return { additions: b.length - comunes, removals: a.length - comunes };
  }

  /**
   * Estadísticas visibles en la fila de un fichero, como «+203 −0».
   * Devuelve null para herramientas que no escriben.
   */
  function estadisticasDeCambio(nombre, args) {
    const a = args ?? {};
    if (nombre === 'write_file') {
      return { additions: lineCount(a.content ?? a.text ?? ''), removals: 0 };
    }
    if (nombre === 'edit_file') {
      const antes = a.oldText ?? a.old_string ?? '';
      const despues = a.newText ?? a.new_string ?? '';
      return lineDiffStats(antes, despues);
    }
    if (nombre === 'multi_replace' && Array.isArray(a.edits)) {
      let additions = 0;
      let removals = 0;
      for (const edit of a.edits) {
        const stats = lineDiffStats(edit.targetContent ?? '', edit.replacementContent ?? '');
        additions += stats.additions;
        removals += stats.removals;
      }
      return { additions, removals };
    }
    return null;
  }

  return { resumirHerramientas, estadisticasDeCambio, lineDiffStats };
});
