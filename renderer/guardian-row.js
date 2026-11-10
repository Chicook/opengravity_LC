(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GuardianRow = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /*
   * La identidad manda: el bucle emite todos los `tool_start` antes de ejecutar,
   * así que dos llamadas al mismo comando están «en ejecución» a la vez y el
   * orden no distingue a cuál va el veredicto.
   */
  function chooseRow(rows, tool, callId) {
    if (callId) {
      const porId = rows.find((fila) => fila.callId === callId);
      if (porId) return porId;
    }

    const coinciden = rows.filter((fila) => fila.tool === tool);
    return coinciden.filter((fila) => fila.running).at(-1) ?? coinciden.at(-1) ?? null;
  }

  return { chooseRow };
});
