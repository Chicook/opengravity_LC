// Definiciones de subagente y registro de los que están corriendo.
//
// `define_subagent` guarda un subagente reutilizable (nombre, rol, system prompt y
// permisos) para no repetir el prompt en cada llamada. `manage_subagent` necesita
// saber qué hay vivo, así que aquí también se lleva el registro con sus abortadores.

const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_DEFINICIONES = 50;
const MAX_PROMPT = 8000;

let archivo = null;

/** Definiciones cargadas, indexadas por nombre. */
let definiciones = new Map();
let cargado = false;

/** Subagentes en ejecución, por id. */
const enEjecucion = new Map();
let contador = 0;

function configurar(rutaArchivo) {
  archivo = rutaArchivo || null;
}

async function cargar() {
  if (cargado || !archivo) {
    cargado = true;
    return;
  }
  try {
    const crudo = await fsp.readFile(archivo, 'utf8');
    const datos = JSON.parse(crudo);
    for (const entrada of datos?.definiciones ?? []) {
      if (entrada && typeof entrada.name === 'string') definiciones.set(entrada.name, entrada);
    }
  } catch {
    definiciones = new Map();
  }
  cargado = true;
}

async function guardar() {
  if (!archivo) return;
  await fsp.mkdir(path.dirname(archivo), { recursive: true });
  await fsp.writeFile(
    archivo,
    JSON.stringify({ version: 1, definiciones: [...definiciones.values()] }, null, 2),
    'utf8',
  );
}

/** Valida y guarda una definición. Devuelve la entrada resultante. */
async function definir(datos) {
  await cargar();

  const nombre = String(datos?.name ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/.test(nombre)) {
    throw new Error(
      'el nombre debe empezar por letra o número y solo puede tener letras, números, _, - y .',
    );
  }

  const entrada = {
    name: nombre,
    role: String(datos?.role ?? 'investigador').slice(0, 80),
    description: String(datos?.description ?? '').slice(0, 400),
    systemPrompt: String(datos?.systemPrompt ?? '').slice(0, MAX_PROMPT),
    allowWrites: datos?.allowWrites === true,
    allowMcp: datos?.allowMcp === true,
    allowSubagents: datos?.allowSubagents === true,
    /*
     * Grant opcional por herramienta. Solo puede quitar: el subagente nunca
     * recibe escritura, comandos o MCP que su nivel de permiso no incluya.
     */
    tools: Array.isArray(datos?.tools)
      ? [...new Set(
          datos.tools
            .map((t) => String(t ?? '').trim())
            .filter((t) => t.length > 0 && t.length <= 80),
        )].slice(0, 40)
      : [],
    actualizadoEn: new Date().toISOString(),
  };

  if (definiciones.size >= MAX_DEFINICIONES && !definiciones.has(nombre)) {
    throw new Error(`ya hay ${MAX_DEFINICIONES} subagentes definidos; borra alguno antes`);
  }

  definiciones.set(nombre, entrada);
  await guardar();
  return entrada;
}

/** Devuelve una definición por nombre exacto o por sufijo inequívoco. */
async function buscar(nombre) {
  await cargar();
  const buscado = String(nombre ?? '').trim().toLowerCase();
  if (buscado.length === 0) return null;

  const exacta = definiciones.get(String(nombre).trim());
  if (exacta) return exacta;

  const parciales = [...definiciones.values()].filter((entrada) =>
    entrada.name.toLowerCase().includes(buscado),
  );
  return parciales.length === 1 ? parciales[0] : null;
}

async function listarDefiniciones() {
  await cargar();
  return [...definiciones.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function borrarDefinicion(nombre) {
  await cargar();
  const borrada = definiciones.delete(String(nombre ?? '').trim());
  if (borrada) await guardar();
  return borrada;
}

// --- Registro de los que están corriendo -------------------------------------

/**
 * Registra un subagente en ejecución y devuelve su id.
 *
 * El `controller` permite matarlo desde `manage_subagent`.
 */
function registrar({ nombre, rol, controller, padre, profundidad }) {
  contador += 1;
  const id = `sub-${contador}`;
  enEjecucion.set(id, {
    id,
    nombre: String(nombre ?? id),
    rol: String(rol ?? ''),
    padre: padre ?? null,
    profundidad: Number.isFinite(Number(profundidad)) ? Number(profundidad) : 0,
    inicio: Date.now(),
    estado: 'corriendo',
    controller,
  });
  return id;
}

/**
 * Bandejas de entrada de los subagentes.
 *
 * `send_message` deja aquí el texto y el bucle del subagente lo recoge entre
 * pasos: así se le puede corregir el rumbo sin matarlo ni relanzarlo.
 */
const bandejas = new Map();

/**
 * Entrega un mensaje a un subagente concreto o a todos los que estén vivos.
 * `@children` (o vacío) difunde a todos los que corren ahora mismo.
 * Devuelve cuántos lo recibieron.
 */
function enviarMensaje(destinatario, texto) {
  const cuerpo = String(texto ?? '').trim();
  if (cuerpo.length === 0) return 0;

  const objetivos =
    !destinatario || destinatario === '@children'
      ? [...enEjecucion.keys()]
      : [String(destinatario)];

  let entregados = 0;
  for (const id of objetivos) {
    if (!enEjecucion.has(id)) continue;
    if (!bandejas.has(id)) bandejas.set(id, []);
    bandejas.get(id).push(cuerpo);
    entregados += 1;
  }
  return entregados;
}

/** Vacía la bandeja de un subagente y devuelve lo recibido, o undefined. */
function recogerMensajes(id) {
  const pendientes = bandejas.get(id);
  if (!pendientes || pendientes.length === 0) return undefined;
  bandejas.delete(id);
  return (
    'Mensajes de otro agente mientras trabajabas:\n' +
    pendientes.map((m) => `- ${m}`).join('\n') +
    '\nTenlos en cuenta y ajusta lo que estés haciendo.'
  );
}

function marcarTerminado(id, estado = 'terminado') {
  const entrada = enEjecucion.get(id);
  if (entrada) {
    entrada.estado = estado;
    entrada.fin = Date.now();
  }
}

function liberar(id) {
  enEjecucion.delete(id);
  bandejas.delete(id);
}

function listarEnEjecucion() {
  return [...enEjecucion.values()].map((entrada) => ({
    id: entrada.id,
    nombre: entrada.nombre,
    rol: entrada.rol,
    estado: entrada.estado,
    padre: entrada.padre,
    profundidad: entrada.profundidad,
    segundos: Math.round(((entrada.fin ?? Date.now()) - entrada.inicio) / 1000),
  }));
}

/** Mata los subagentes indicados. Devuelve cuántos se cancelaron. */
function matar(ids) {
  const objetivo = Array.isArray(ids) && ids.length > 0 ? ids : [...enEjecucion.keys()];
  let muertos = 0;

  for (const id of objetivo) {
    const entrada = enEjecucion.get(id);
    if (!entrada) continue;
    try {
      entrada.controller?.abort();
      entrada.estado = 'cancelado';
      muertos += 1;
    } catch {
      // ya estaba terminado
    }
  }

  return muertos;
}

/**
 * Aplica un grant de herramientas a un catálogo ya permitido.
 *
 * Un grant nunca amplía permisos: solo puede quitar herramientas de las que el
 * subagente ya tendría por su nivel (lectura, allowWrites o allowMcp).
 */
function filtrarPorGrant(herramientas, permitidas) {
  if (!Array.isArray(permitidas) || permitidas.length === 0) return herramientas;
  const permitido = new Set(permitidas);
  return herramientas.filter((tool) => permitido.has(tool.name));
}

module.exports = {
  configurar,
  definir,
  buscar,
  listarDefiniciones,
  borrarDefinicion,
  registrar,
  enviarMensaje,
  recogerMensajes,
  marcarTerminado,
  liberar,
  listarEnEjecucion,
  matar,
  filtrarPorGrant,
};
