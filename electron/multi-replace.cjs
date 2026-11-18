'use strict';

/**
 * `multi_replace`: varios reemplazos por rango en una sola llamada.
 *
 * Igual que en Antigravity, cada trozo se aplica sobre el resultado del
 * anterior, y si uno falla **no se aplica ninguno**: el fichero queda intacto.
 * Así el agente puede corregir cinco tramos de un fichero con una llamada y sin
 * riesgo de dejarlo a medias.
 *
 * Las líneas son **1-based** e inclusivas, que es lo que ve el agente al leer.
 */

/** Desplazamiento absoluto del inicio de una línea 1-based. */
function inicioDeLinea(texto, linea) {
  if (linea <= 1) return 0;
  let vistas = 1;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto.charCodeAt(i) === 10) {
      vistas += 1;
      if (vistas === linea) return i + 1;
    }
  }
  return texto.length;
}

/** Texto que ocupa el rango de líneas indicado, con sus saltos. */
function textoDelRango(texto, desde, hasta) {
  const inicio = inicioDeLinea(texto, desde);
  const finBruto = hasta === undefined || hasta === null
    ? texto.length
    : inicioDeLinea(texto, hasta + 1);
  return { inicio, fin: Math.min(texto.length, finBruto) };
}

/** Cuenta líneas de un texto (1 si no hay saltos). */
function contarLineas(texto) {
  let n = 1;
  for (let i = 0; i < texto.length; i += 1) if (texto.charCodeAt(i) === 10) n += 1;
  return n;
}

/**
 * Aplica los trozos en orden. Devuelve `{ texto, aplicados }` o
 * `{ error, indice }` sin haber tocado nada.
 */
function aplicarReemplazos(textoOriginal, trozos) {
  if (!Array.isArray(trozos) || trozos.length === 0) {
    return { error: 'No hay ningún trozo que aplicar.' };
  }

  let texto = textoOriginal;
  let aplicados = 0;
  /*
   * Los números de línea que manda el modelo suelen ser los del fichero que
   * leyó, no los del resultado de la edición anterior. Si un trozo previo
   * añadió o quitó líneas, se prueba también el rango desplazado; así el
   * segundo cambio no falla por un desfase que el modelo no puede ver.
   */
  let desplazamientoLineas = 0;

  for (let i = 0; i < trozos.length; i += 1) {
    const trozo = trozos[i] ?? {};
    const objetivo = String(trozo.targetContent ?? '');
    const reemplazo = String(trozo.replacementContent ?? '');

    if (objetivo.length === 0) {
      return { error: `El trozo ${i + 1} no trae \`targetContent\`.`, indice: i };
    }

    const total = contarLineas(texto);
    const desde = Number(trozo.startLine ?? 1);
    const hasta = trozo.endLine === undefined || trozo.endLine === null
      ? total
      : Number(trozo.endLine);

    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde < 1 || hasta < desde) {
      return { error: `El trozo ${i + 1} tiene un rango inválido (${desde}-${hasta}).`, indice: i };
    }

    const candidatos = [{ desde, hasta }];
    if (desplazamientoLineas !== 0) {
      const desdeAjustado = Math.max(1, desde + desplazamientoLineas);
      const hastaAjustado = Math.max(desdeAjustado, hasta + desplazamientoLineas);
      if (desdeAjustado !== desde || hastaAjustado !== hasta) {
        candidatos.push({ desde: desdeAjustado, hasta: hastaAjustado });
      }
    }

    let elegido = null;
    let ambiguo = false;
    for (const rango of candidatos) {
      const { inicio, fin } = textoDelRango(texto, rango.desde, rango.hasta);
      const ventana = texto.slice(inicio, fin);
      const primera = ventana.indexOf(objetivo);
      if (primera === -1) continue;
      if (ventana.indexOf(objetivo, primera + 1) !== -1) {
        ambiguo = true;
        continue;
      }
      elegido = { inicio, primera, desde: rango.desde, hasta: rango.hasta };
      break;
    }

    if (!elegido) {
      return {
        error: ambiguo
          ? `El trozo ${i + 1} encuentra su \`targetContent\` más de una vez. Amplía el contexto.`
          : `El trozo ${i + 1} no encuentra su \`targetContent\` entre las líneas ${desde} y ${hasta}` +
            (desplazamientoLineas !== 0 ? ' ni con el rango desplazado.' : '.'),
        indice: i,
      };
    }

    const absoluto = elegido.inicio + elegido.primera;
    texto = texto.slice(0, absoluto) + reemplazo + texto.slice(absoluto + objetivo.length);
    const lineasObjetivo = objetivo.split('\n').length;
    const lineasReemplazo = reemplazo.length === 0 ? 0 : reemplazo.split('\n').length;
    desplazamientoLineas += lineasReemplazo - lineasObjetivo;
    aplicados += 1;
  }

  return { texto, aplicados };
}

module.exports = { aplicarReemplazos, inicioDeLinea, textoDelRango, contarLineas };
