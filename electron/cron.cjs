// Expresiones cron de 5 campos, sin dependencias.
//
// Se usa para los avisos programados del agente (`notify_user`). No pretende ser
// exhaustivo: cubre lo que la gente escribe de verdad (`*/5 * * * *`, `0 9 * * 1-5`,
// `30 2 1 * *`) y rechaza lo que no entiende en vez de adivinar.

const CAMPOS = [
  { nombre: 'minuto', min: 0, max: 59 },
  { nombre: 'hora', min: 0, max: 23 },
  { nombre: 'día del mes', min: 1, max: 31 },
  { nombre: 'mes', min: 1, max: 12 },
  { nombre: 'día de la semana', min: 0, max: 6 },
];

// Convierte un campo (asterisco, 5, 1-4, asterisco/15, 1,15,30) en un Set de valores.
function parsearCampo(texto, { nombre, min, max }) {
  const valores = new Set();

  for (const parte of String(texto).split(',')) {
    const trozo = parte.trim();
    if (trozo.length === 0) throw new Error(`campo vacío en ${nombre}`);

    // Paso: asterisco/n o a-b/n
    const conPaso = trozo.match(/^(.+)\/(\d+)$/);
    const base = conPaso ? conPaso[1] : trozo;
    const paso = conPaso ? Number(conPaso[2]) : 1;
    if (!Number.isInteger(paso) || paso <= 0) {
      throw new Error(`paso inválido en ${nombre}: ${trozo}`);
    }

    let desde;
    let hasta;

    if (base === '*') {
      desde = min;
      hasta = max;
    } else if (base.includes('-')) {
      const [a, b] = base.split('-');
      desde = Number(a);
      hasta = Number(b);
    } else {
      desde = Number(base);
      hasta = desde;
    }

    if (!Number.isInteger(desde) || !Number.isInteger(hasta)) {
      throw new Error(`valor inválido en ${nombre}: ${trozo}`);
    }
    if (desde < min || hasta > max || desde > hasta) {
      throw new Error(`${nombre} fuera de rango (${min}-${max}): ${trozo}`);
    }

    for (let v = desde; v <= hasta; v += paso) valores.add(v);
  }

  if (valores.size === 0) throw new Error(`el campo ${nombre} no produce ningún valor`);
  return valores;
}

/** Valida y compila una expresión de 5 campos. Lanza si no es válida. */
function compilarCron(expresion) {
  const partes = String(expresion ?? '').trim().split(/\s+/);
  if (partes.length !== 5) {
    throw new Error('una expresión cron tiene 5 campos: minuto hora día-del-mes mes día-de-la-semana');
  }

  const [minuto, hora, diaMes, mes, diaSemana] = partes.map((parte, i) =>
    parsearCampo(parte, CAMPOS[i]),
  );

  return {
    expresion: partes.join(' '),
    minuto,
    hora,
    diaMes,
    mes,
    diaSemana,
    // Si los dos están restringidos, el cron clásico los combina con OR.
    domRestringido: partes[2] !== '*',
    dowRestringido: partes[4] !== '*',
  };
}

/** ¿Coincide este instante con la expresión? */
function coincide(compilado, fecha) {
  if (!compilado.minuto.has(fecha.getMinutes())) return false;
  if (!compilado.hora.has(fecha.getHours())) return false;
  if (!compilado.mes.has(fecha.getMonth() + 1)) return false;

  const domOk = compilado.diaMes.has(fecha.getDate());
  const dowOk = compilado.diaSemana.has(fecha.getDay());

  if (compilado.domRestringido && compilado.dowRestringido) return domOk || dowOk;
  if (compilado.domRestringido) return domOk;
  if (compilado.dowRestringido) return dowOk;
  return true;
}

/** Tope de búsqueda: dos años hacia delante. */
const MAX_MINUTOS = 2 * 366 * 24 * 60;

/**
 * Calcula la siguiente vez que se cumple la expresión, a partir de `desde`.
 *
 * Devuelve un `Date`, o null si no hay ninguna en los próximos dos años (por ejemplo
 * `0 0 31 2 *`, que no existe).
 */
function siguienteEjecucion(expresion, desde = new Date()) {
  const compilado = typeof expresion === 'string' ? compilarCron(expresion) : expresion;

  // Se empieza en el minuto siguiente, en punto.
  const cursor = new Date(desde.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_MINUTOS; i += 1) {
    if (coincide(compilado, cursor)) return new Date(cursor.getTime());

    // Salto rápido: si el mes no cuadra, se va al día 1 del siguiente.
    if (!compilado.mes.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

/** Describe una expresión en castellano, para mostrarla en la UI. */
function describirCron(expresion) {
  let compilado;
  try {
    compilado = compilarCron(expresion);
  } catch (error) {
    return `expresión inválida: ${error.message}`;
  }

  const partes = [];
  const [minuto, hora, , , dow] = expresion.trim().split(/\s+/);

  if (minuto.startsWith('*/')) partes.push(`cada ${minuto.slice(2)} min`);
  else if (hora === '*') partes.push(`cada hora en el minuto ${minuto}`);
  else partes.push(`a las ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`);

  if (dow !== '*') partes.push(`los días ${dow} de la semana`);

  const proxima = siguienteEjecucion(compilado);
  return `${partes.join(', ')} — próxima: ${proxima ? proxima.toISOString() : 'nunca'}`;
}

module.exports = { compilarCron, siguienteEjecucion, describirCron, coincide };
