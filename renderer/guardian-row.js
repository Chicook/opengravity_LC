(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GuardianRow = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function chooseRow(rows, tool) {
    const coinciden = rows.filter((fila) => fila.tool === tool);
    return coinciden.filter((fila) => fila.running).at(-1) ?? coinciden.at(-1) ?? null;
  }

  return { chooseRow };
});
