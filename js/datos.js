/*
 * VoltiControl — datos de referencia.
 * Potencias típicas de aparatos comunes en hogares dominicanos y la tarifa
 * residencial de referencia. Todo es editable desde la aplicación.
 */
(function (root) {
  'use strict';

  // ciclo: fracción del tiempo encendido en que el aparato realmente consume
  // (la nevera y el aire prenden y apagan el compresor).
  const CATALOGO = [
    { nombre: 'Nevera', watts: 150, ciclo: 0.4, horario: '24 horas' },
    { nombre: 'Freezer', watts: 200, ciclo: 0.45, horario: '24 horas' },
    { nombre: 'Aire acondicionado 12,000 BTU', watts: 1200, ciclo: 0.7, horario: '22:00-05:00' },
    { nombre: 'Aire acondicionado 12,000 BTU inverter', watts: 900, ciclo: 0.55, horario: '22:00-05:00' },
    { nombre: 'Abanico de techo', watts: 75, ciclo: 1, horario: '21:00-06:00' },
    { nombre: 'Abanico de pie', watts: 55, ciclo: 1, horario: '13:00-17:00' },
    { nombre: 'Televisor LED 43"', watts: 80, ciclo: 1, horario: '18:00-23:00' },
    { nombre: 'Bombillo LED', watts: 9, ciclo: 1, horario: '18:00-23:00' },
    { nombre: 'Bombillo incandescente', watts: 60, ciclo: 1, horario: '18:00-23:00' },
    { nombre: 'Laptop', watts: 65, ciclo: 1, horario: '14:00-20:00' },
    { nombre: 'Computadora de escritorio', watts: 250, ciclo: 1, horario: '14:00-20:00' },
    { nombre: 'Consola de videojuegos', watts: 150, ciclo: 1, horario: '20:00-22:00' },
    { nombre: 'Router Wi‑Fi', watts: 10, ciclo: 1, horario: '24 horas' },
    { nombre: 'Lavadora', watts: 500, ciclo: 1, horario: '09:00-09:30' },
    { nombre: 'Secadora eléctrica', watts: 3000, ciclo: 1, horario: '10:00-10:30' },
    { nombre: 'Plancha', watts: 1200, ciclo: 0.6, horario: '07:00-07:20' },
    { nombre: 'Microondas', watts: 1100, ciclo: 1, horario: '12:00-12:10, 19:00-19:10' },
    { nombre: 'Arrocera', watts: 700, ciclo: 1, horario: '11:00-11:30' },
    { nombre: 'Licuadora', watts: 400, ciclo: 1, horario: '07:00-07:05' },
    { nombre: 'Cafetera', watts: 800, ciclo: 1, horario: '06:30-06:45' },
    { nombre: 'Bomba de agua', watts: 750, ciclo: 1, horario: '06:00-06:30' },
    { nombre: 'Calentador de agua', watts: 1500, ciclo: 0.5, horario: '06:00-07:00' },
    { nombre: 'Secador de pelo', watts: 1500, ciclo: 1, horario: '07:00-07:10' },
    { nombre: 'Cargador de celular', watts: 10, ciclo: 1, horario: '22:00-01:00' }
  ];

  // Hogar de ejemplo (se muestra al abrir la app por primera vez).
  const EJEMPLO_APARATOS = [
    { nombre: 'Nevera', watts: 150, cantidad: 1, ciclo: 0.4, horario: '24 horas' },
    { nombre: 'Aire acondicionado 12,000 BTU', watts: 1200, cantidad: 1, ciclo: 0.7, horario: '22:00-05:00' },
    { nombre: 'Abanico de techo', watts: 75, cantidad: 2, ciclo: 1, horario: '21:00-06:00' },
    { nombre: 'Abanico de pie', watts: 55, cantidad: 1, ciclo: 1, horario: '13:00-17:00' },
    { nombre: 'Televisor LED 43"', watts: 80, cantidad: 1, ciclo: 1, horario: '18:00-23:00' },
    { nombre: 'Bombillo LED', watts: 9, cantidad: 6, ciclo: 1, horario: '18:00-23:00' },
    { nombre: 'Laptop', watts: 65, cantidad: 1, ciclo: 1, horario: '14:00-20:00' },
    { nombre: 'Router Wi‑Fi', watts: 10, cantidad: 1, ciclo: 1, horario: '24 horas' },
    { nombre: 'Lavadora', watts: 500, cantidad: 1, ciclo: 1, horario: '09:00-09:30' },
    { nombre: 'Microondas', watts: 1100, cantidad: 1, ciclo: 1, horario: '12:00-12:10, 19:00-19:10' },
    { nombre: 'Bomba de agua', watts: 750, cantidad: 1, ciclo: 1, horario: '06:00-06:30' },
    { nombre: 'Plancha', watts: 1200, cantidad: 1, ciclo: 0.6, horario: '07:00-07:20' }
  ];

  // Lecturas de ejemplo del contador (kWh acumulados que marca el medidor).
  const EJEMPLO_LECTURAS = [
    { fecha: '2026-11-01', valor: 15230 },
    { fecha: '2026-11-02', valor: 15241 },
    { fecha: '2026-11-03', valor: 15253 },
    { fecha: '2026-11-04', valor: 15263 },
    { fecha: '2026-11-05', valor: 15275 },
    { fecha: '2026-11-06', valor: 15286 }
  ];

  // Tarifa residencial de referencia (RD$). 0–200 y más de 700 kWh: valores
  // citados por el Ministerio de Energía y Minas (oct. 2026). Bloques
  // intermedios y cargo fijo: referencias públicas. Verificar con la factura.
  const TARIFA = {
    bloques: [
      { hasta: 200, precio: 6.09 },
      { hasta: 300, precio: 9.5 },
      { hasta: 700, precio: 11.5 },
      { hasta: null, precio: 13.09 }
    ],
    cargoFijo: 120,
    ultimoBloqueATodo: true,
    itbisSobreUmbral: true,
    itbis: 0.18
  };

  // Ciclo automático: la app lo deduce del nombre del aparato, así el usuario
  // no tiene que saber qué es. Primero busca el nombre exacto en el catálogo;
  // si no está, reconoce por palabras los aparatos con termostato.
  const REGLAS_CICLO = [
    { patron: /freidora/, ciclo: 1 },
    { patron: /inverter/, ciclo: 0.55 },
    { patron: /aire|acondicionado|split|\ba\/?c\b/, ciclo: 0.7 },
    { patron: /nevera|nevecon|refrigerador|frigorifico/, ciclo: 0.4 },
    { patron: /freezer|congelador/, ciclo: 0.45 },
    { patron: /plancha/, ciclo: 0.6 },
    { patron: /calentador|boiler|\btermo\b/, ciclo: 0.5 }
  ];

  function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function cicloAutomatico(nombre) {
    const n = normalizar(nombre);
    if (!n) return 1;
    for (let i = 0; i < CATALOGO.length; i++) {
      if (normalizar(CATALOGO[i].nombre) === n) return CATALOGO[i].ciclo;
    }
    for (let i = 0; i < REGLAS_CICLO.length; i++) {
      if (REGLAS_CICLO[i].patron.test(n)) return REGLAS_CICLO[i].ciclo;
    }
    return 1;
  }

  const DATOS = { CATALOGO: CATALOGO, EJEMPLO_APARATOS: EJEMPLO_APARATOS, EJEMPLO_LECTURAS: EJEMPLO_LECTURAS, TARIFA: TARIFA, cicloAutomatico: cicloAutomatico };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATOS;
  else root.VC_DATOS = DATOS;
})(typeof window !== 'undefined' ? window : this);
