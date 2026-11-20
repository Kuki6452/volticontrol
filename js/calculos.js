/*
 * VoltiControl — núcleo matemático.
 * Funciones puras (sin DOM) para calcular el consumo eléctrico con integrales.
 *
 *   Energía consumida en un día:   E = ∫₀²⁴ P(t) dt   (P en W, t en horas → Wh)
 *
 * La curva P(t) del hogar es la suma de la potencia de cada aparato mientras
 * está encendido. Como cada aparato tiene potencia constante en sus horarios,
 * la integral exacta se obtiene sumando áreas de rectángulos. La regla del
 * trapecio aproxima esa misma integral con n subintervalos.
 */
(function (root) {
  'use strict';

  // ---------- Horarios ----------

  /** "22:30", "7", "7am", "2:15 pm" → horas decimales (22.5). NaN si no es válida. */
  function parseHora(texto) {
    const m = String(texto).trim().toLowerCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.\s?m\.?|p\.\s?m\.?)?$/);
    if (!m) return NaN;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (min > 59) return NaN;
    if (m[3]) {
      const sufijo = m[3].replace(/[\s.]/g, '');
      if (h < 1 || h > 12) return NaN;
      if (sufijo === 'pm' && h !== 12) h += 12;
      if (sufijo === 'am' && h === 12) h = 0;
    }
    if (h > 24 || (h === 24 && min > 0)) return NaN;
    return h + min / 60;
  }

  /**
   * "22:00-05:00, 13:00-14:00" → [[22, 5], [13, 14]].
   * Un rango cuyo fin es menor que su inicio cruza la medianoche.
   * Devuelve null si el texto no se puede leer.
   */
  function parseHorario(texto) {
    const limpio = String(texto || '').trim().toLowerCase();
    if (!limpio) return null;
    if (/^(24\s*h(oras)?|todo el d[ií]a|siempre)$/.test(limpio)) return [[0, 24]];
    const partes = limpio.split(/[,;]|\s+y\s+/).map(function (p) { return p.trim(); }).filter(Boolean);
    const rangos = [];
    for (const parte of partes) {
      const extremos = parte.split(/\s*[-–—]\s*|\s+a\s+|\s+hasta\s+/);
      if (extremos.length !== 2) return null;
      const inicio = parseHora(extremos[0].replace(/^de\s+/, ''));
      const fin = parseHora(extremos[1]);
      if (isNaN(inicio) || isNaN(fin)) return null;
      const a = inicio % 24;
      const b = fin === 24 ? 24 : fin % 24;
      if (a === b) return null;
      rangos.push([a, b]);
    }
    return rangos;
  }

  function formatoHora(h) {
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function textoHorario(rangos) {
    if (rangos.length === 1 && rangos[0][0] === 0 && rangos[0][1] === 24) return '24 horas';
    return rangos.map(function (r) {
      return formatoHora(r[0]) + '–' + (r[1] === 24 ? '24:00' : formatoHora(r[1]));
    }).join(', ');
  }

  /** Duración de un rango en horas (considera el cruce de medianoche). */
  function duracionRango(r) {
    return r[1] > r[0] ? r[1] - r[0] : 24 - r[0] + r[1];
  }

  function horasDeUso(rangos) {
    return rangos.reduce(function (s, r) { return s + duracionRango(r); }, 0);
  }

  /** ¿Está encendido a la hora t? Intervalos semiabiertos [inicio, fin). */
  function encendido(t, rangos) {
    // EPS evita errores de redondeo cuando t cae justo en el borde de un rango.
    const EPS = 1e-9;
    const x = ((t % 24) + 24) % 24;
    return rangos.some(function (r) {
      const a = r[0] - EPS, b = r[1] - EPS;
      return r[0] < r[1] ? (x >= a && x < b) : (x >= a || x < b);
    });
  }

  // ---------- Potencia y energía ----------

  /** Potencia promedio de un aparato encendido, en W (incluye cantidad y ciclo de trabajo). */
  function potenciaMedia(ap) {
    return ap.watts * ap.cantidad * ap.ciclo;
  }

  /** P(t): potencia total del hogar a la hora t, en W. */
  function potenciaEn(t, aparatos) {
    let p = 0;
    for (const ap of aparatos) if (encendido(t, ap.rangos)) p += potenciaMedia(ap);
    return p;
  }

  /** Energía diaria exacta de un aparato en kWh: área del rectángulo potencia × tiempo. */
  function energiaDiaria(ap) {
    return potenciaMedia(ap) * horasDeUso(ap.rangos) / 1000;
  }

  /** ∫₀²⁴ P(t) dt exacta en kWh (suma de las áreas de cada aparato). */
  function energiaDiariaTotal(aparatos) {
    return aparatos.reduce(function (s, ap) { return s + energiaDiaria(ap); }, 0);
  }

  /** Regla del trapecio: ∫ₐᵇ f(t) dt ≈ h/2 · [f(t₀) + 2f(t₁) + … + 2f(tₙ₋₁) + f(tₙ)]. */
  function trapecio(f, a, b, n) {
    const h = (b - a) / n;
    let suma = (f(a) + f(b)) / 2;
    for (let i = 1; i < n; i++) suma += f(a + i * h);
    return suma * h;
  }

  /** Aproximación de la energía diaria (kWh) con n trapecios. */
  function energiaTrapecio(aparatos, n) {
    return trapecio(function (t) { return potenciaEn(t, aparatos); }, 0, 24, n) / 1000;
  }

  // ---------- Tarifa ----------

  /**
   * Factura de un período con tarifa por bloques.
   * tarifa = { bloques: [{hasta, precio}...] (último hasta = null),
   *            cargoFijo, ultimoBloqueATodo, itbisSobreUmbral, itbis }
   */
  function factura(kwh, tarifa) {
    const bloques = tarifa.bloques;
    const umbral = bloques[bloques.length - 2].hasta;
    const lineas = [];
    let energia = 0;
    let indiceBloque = 0;

    if (kwh > umbral && tarifa.ultimoBloqueATodo) {
      const precio = bloques[bloques.length - 1].precio;
      lineas.push({ desde: 0, hasta: null, kwh: kwh, precio: precio, monto: kwh * precio });
      energia = kwh * precio;
      indiceBloque = bloques.length - 1;
    } else {
      let anterior = 0;
      for (let i = 0; i < bloques.length; i++) {
        const tope = bloques[i].hasta === null ? Infinity : bloques[i].hasta;
        const cantidad = Math.max(0, Math.min(kwh, tope) - anterior);
        if (cantidad > 0) {
          lineas.push({ desde: anterior, hasta: bloques[i].hasta, kwh: cantidad, precio: bloques[i].precio, monto: cantidad * bloques[i].precio });
          energia += cantidad * bloques[i].precio;
          indiceBloque = i;
        }
        if (kwh <= tope) break;
        anterior = tope;
      }
    }

    const subtotal = energia + tarifa.cargoFijo;
    const itbis = (kwh > umbral && tarifa.itbisSobreUmbral) ? subtotal * tarifa.itbis : 0;
    return {
      kwh: kwh,
      lineas: lineas,
      energia: energia,
      cargoFijo: tarifa.cargoFijo,
      itbis: itbis,
      total: subtotal + itbis,
      bloque: indiceBloque,
      precioMedio: kwh > 0 ? (subtotal + itbis) / kwh : 0
    };
  }

  // ---------- Medidor ----------

  function diasEntre(fechaA, fechaB) {
    const a = Date.UTC(+fechaA.slice(0, 4), +fechaA.slice(5, 7) - 1, +fechaA.slice(8, 10));
    const b = Date.UTC(+fechaB.slice(0, 4), +fechaB.slice(5, 7) - 1, +fechaB.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }

  /**
   * A partir de lecturas del contador {fecha:'AAAA-MM-DD', valor:kWh}
   * calcula los puntos acumulados, el ritmo diario (pendiente por mínimos
   * cuadrados) y la proyección al final del período.
   */
  function proyeccion(lecturas, periodo) {
    const orden = lecturas.slice().sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0; });
    if (orden.length < 2) return null;
    const base = orden[0];
    const puntos = orden.map(function (l) {
      return { fecha: l.fecha, dia: diasEntre(base.fecha, l.fecha), acumulado: l.valor - base.valor, valor: l.valor };
    });
    const n = puntos.length;
    const mx = puntos.reduce(function (s, p) { return s + p.dia; }, 0) / n;
    const my = puntos.reduce(function (s, p) { return s + p.acumulado; }, 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of puntos) { sxy += (p.dia - mx) * (p.acumulado - my); sxx += (p.dia - mx) * (p.dia - mx); }
    if (sxx === 0) return null;
    const ritmo = Math.max(0, sxy / sxx); // kWh por día
    const ultimo = puntos[n - 1];
    const diasRestantes = Math.max(0, periodo - ultimo.dia);
    const total = ultimo.acumulado + ritmo * diasRestantes;
    return { puntos: puntos, ritmo: ritmo, ultimo: ultimo, total: total, periodo: periodo, diasRestantes: diasRestantes };
  }

  /** Día (desde la primera lectura) en que el acumulado alcanzaría `limite` kWh, o null. */
  function diaQueAlcanza(proy, limite) {
    if (!proy || proy.ultimo.acumulado >= limite || proy.ritmo <= 0) return null;
    const dia = proy.ultimo.dia + (limite - proy.ultimo.acumulado) / proy.ritmo;
    return dia <= proy.periodo ? dia : null;
  }

  // ---------- Ahorro ----------

  /** Energía diaria (kWh) si cada aparato se usa `reducciones[id]` horas menos al día. */
  function energiaConReduccion(aparatos, reducciones) {
    return aparatos.reduce(function (s, ap) {
      const horas = Math.max(0, horasDeUso(ap.rangos) - (reducciones[ap.id] || 0));
      return s + potenciaMedia(ap) * horas / 1000;
    }, 0);
  }

  // ---------- Meta de factura ----------

  /** Paso con que se recortan las horas de un aparato (igual que las barras del simulador). */
  function pasoHoras(horas) {
    return horas <= 1 ? 1 / 12 : horas <= 4 ? 0.25 : 0.5;
  }

  /**
   * Plan para llegar a una factura objetivo (RD$) recortando horas de uso.
   * Empieza por el aparato que más energía puede ahorrar (potencia × la mitad
   * de sus horas) y le quita horas hasta la mitad de su uso; si no alcanza,
   * pasa al siguiente. Los aparatos que funcionan las
   * 24 horas (nevera, router) no se tocan: apagarlos no es un consejo realista.
   * Devuelve { reducciones: {id: horas}, inicial, total, alcanzable }.
   */
  function planParaMeta(aparatos, tarifa, periodo, meta) {
    const reducciones = {};
    const facturaActual = function () {
      return factura(energiaConReduccion(aparatos, reducciones) * periodo, tarifa).total;
    };
    const inicial = facturaActual();
    let total = inicial;
    const candidatos = aparatos
      .filter(function (ap) { return horasDeUso(ap.rangos) < 24 && potenciaMedia(ap) > 0; })
      .map(function (ap) { const h = horasDeUso(ap.rangos); return { ap: ap, max: h / 2, paso: pasoHoras(h) }; })
      .sort(function (a, b) { return potenciaMedia(b.ap) * b.max - potenciaMedia(a.ap) * a.max; });
    let avanzo = true;
    while (total > meta && avanzo) {
      avanzo = false;
      for (const c of candidatos) {
        const actual = reducciones[c.ap.id] || 0;
        if (actual + c.paso <= c.max + 1e-9) {
          reducciones[c.ap.id] = Math.round((actual + c.paso) * 1e4) / 1e4;
          avanzo = true;
          break;
        }
      }
      total = facturaActual();
    }
    return { reducciones: reducciones, inicial: inicial, total: total, alcanzable: total <= meta + 1e-9 };
  }

  // ---------- Consejos: cambiar un aparato por otro más eficiente ----------

  /**
   * Para cada aparato que tenga una alternativa más eficiente, calcula cuánto
   * bajaría la factura del período. `alternativas` viene de datos.js:
   * [{ aplica(ap) → bool, cambio(ap) → {nombre, watts, ciclo}, texto }].
   * Devuelve la lista ordenada de mayor a menor ahorro en RD$.
   */
  function consejosAhorro(aparatos, tarifa, periodo, alternativas) {
    const totalKwh = energiaDiariaTotal(aparatos) * periodo;
    const facturaHoy = factura(totalKwh, tarifa).total;
    const lista = [];
    aparatos.forEach(function (ap) {
      alternativas.forEach(function (alt, i) {
        if (!alt.aplica(ap)) return;
        const nuevo = Object.assign({}, ap, alt.cambio(ap));
        const menosKwhDia = energiaDiaria(ap) - energiaDiaria(nuevo);
        if (menosKwhDia <= 0) return;
        const ahorroRD = facturaHoy - factura(totalKwh - menosKwhDia * periodo, tarifa).total;
        lista.push({ apId: ap.id, alternativa: i, texto: alt.texto, nombre: ap.nombre, nuevo: alt.cambio(ap), menosKwhDia: menosKwhDia, ahorroRD: ahorroRD });
      });
    });
    return lista.sort(function (a, b) { return b.ahorroRD - a.ahorroRD; });
  }

  // ---------- Facturas reales ----------

  /** Compara una factura real con lo que da la tarifa de la app para esos mismos kWh. */
  function compararFactura(kwh, montoReal, tarifa) {
    const calculado = factura(kwh, tarifa).total;
    return { calculado: calculado, diferencia: montoReal - calculado, porcentaje: calculado > 0 ? (montoReal - calculado) / calculado * 100 : 0 };
  }

  const VC = {
    pasoHoras: pasoHoras,
    planParaMeta: planParaMeta,
    consejosAhorro: consejosAhorro,
    compararFactura: compararFactura,
    parseHora: parseHora,
    parseHorario: parseHorario,
    formatoHora: formatoHora,
    textoHorario: textoHorario,
    horasDeUso: horasDeUso,
    encendido: encendido,
    potenciaMedia: potenciaMedia,
    potenciaEn: potenciaEn,
    energiaDiaria: energiaDiaria,
    energiaDiariaTotal: energiaDiariaTotal,
    trapecio: trapecio,
    energiaTrapecio: energiaTrapecio,
    factura: factura,
    diasEntre: diasEntre,
    proyeccion: proyeccion,
    diaQueAlcanza: diaQueAlcanza,
    energiaConReduccion: energiaConReduccion
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VC;
  else root.VC = VC;
})(typeof window !== 'undefined' ? window : this);
