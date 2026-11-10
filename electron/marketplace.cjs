'use strict';
/**
 * Catálogo local de servidores MCP.
 *
 * Es la alternativa open source al marketplace propietario: una lista estática
 * que viaja con la app, sin cuentas, planes, facturación ni red. Instalar una
 * entrada solo añade un plugin normal a `prefs.plugins`.
 */
const fs = require('node:fs');
const path = require('node:path');

const RUTA_CATALOGO = path.join(__dirname, '..', 'assets', 'marketplace.json');

/** Valida una entrada y devuelve una copia normalizada, o null. */
function normalizarEntrada(entrada) {
  if (!entrada || typeof entrada !== 'object') return null;
  const id = String(entrada.id ?? '').trim();
  const name = String(entrada.name ?? '').trim();
  const command = String(entrada.command ?? '').trim();
  if (!id || !name || !command) return null;
  if (!Array.isArray(entrada.args) || entrada.args.some((arg) => typeof arg !== 'string')) {
    return null;
  }
  const env = entrada.env && typeof entrada.env === 'object' ? entrada.env : {};
  return {
    id,
    name,
    description: String(entrada.description ?? '').trim(),
    command,
    args: [...entrada.args],
    env: { ...env },
  };
}

/** Lee el catálogo empaquetado. Una entrada inválida no tumba el resto. */
function cargarCatalogo(ruta = RUTA_CATALOGO) {
  const bruto = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set();
  const salida = [];
  for (const entrada of bruto) {
    const normalizada = normalizarEntrada(entrada);
    if (!normalizada || vistos.has(normalizada.id)) continue;
    vistos.add(normalizada.id);
    salida.push(normalizada);
  }
  return salida;
}

module.exports = { RUTA_CATALOGO, cargarCatalogo, normalizarEntrada };
