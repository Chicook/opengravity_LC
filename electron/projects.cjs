'use strict';

/**
 * Lista de proyectos persistida junto a las preferencias.
 *
 * Un proyecto es una carpeta con nombre y última fecha de uso. La lista no
 * depende del historial: un proyecto sin conversaciones sigue apareciendo en el
 * selector y en Ajustes.
 */

const path = require('node:path');

/** Nombre visible de una carpeta de proyecto. */
function nombreProyecto(cwd) {
  return path.basename(String(cwd ?? '')) || String(cwd ?? '');
}

/** Normaliza una entrada leída de settings.json. */
function normalizarProyecto(entrada) {
  if (!entrada || typeof entrada.path !== 'string' || entrada.path.trim() === '') return null;
  const ruta = path.resolve(entrada.path);
  return {
    path: ruta,
    name:
      typeof entrada.name === 'string' && entrada.name.trim()
        ? entrada.name.trim()
        : nombreProyecto(ruta),
    lastUsed:
      typeof entrada.lastUsed === 'string' && !Number.isNaN(Date.parse(entrada.lastUsed))
        ? entrada.lastUsed
        : new Date(0).toISOString(),
  };
}

/** Normaliza y elimina duplicados por ruta, conservando la entrada más reciente. */
function normalizarProyectos(lista) {
  const porRuta = new Map();
  for (const entrada of Array.isArray(lista) ? lista : []) {
    const proyecto = normalizarProyecto(entrada);
    if (!proyecto) continue;
    const previo = porRuta.get(proyecto.path);
    if (!previo || proyecto.lastUsed > previo.lastUsed) porRuta.set(proyecto.path, proyecto);
  }
  return [...porRuta.values()];
}

/** Añade o actualiza un proyecto en una lista, sin mutar la entrada. */
function registrarEnLista(lista, cwd, ahora = new Date().toISOString()) {
  const ruta = path.resolve(String(cwd ?? ''));
  if (!ruta) return normalizarProyectos(lista);
  const base = normalizarProyectos(lista);
  const proyecto = { path: ruta, name: nombreProyecto(ruta), lastUsed: ahora };
  return [...base.filter((p) => p.path !== ruta), proyecto];
}

module.exports = { nombreProyecto, normalizarProyecto, normalizarProyectos, registrarEnLista };
