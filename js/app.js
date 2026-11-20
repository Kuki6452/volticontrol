/*
 * VoltiControl — interfaz.
 * Lee y guarda el estado, y dibuja cada sección a partir de las funciones de calculos.js.
 */
(function () {
  'use strict';

  const VC = window.VC;
  const D = window.VC_DATOS;
  const CLAVE = 'volticontrol.v1';
  const N_VALORES = [4, 6, 8, 12, 24, 48, 96, 288];
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- utilidades ----------
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const fmt = function (n, d) {
    if (d === undefined) d = 1;
    return Number(n).toLocaleString('es-DO', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const rd = function (n, d) { return 'RD$ ' + fmt(n, d === undefined ? 2 : d); };
  const clonar = function (o) { return JSON.parse(JSON.stringify(o)); };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  let contador = 0;
  const nuevoId = function () { return 'a' + Date.now().toString(36) + (contador++).toString(36); };

  function svg(tag, attrs, padre) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(el);
    return el;
  }

  /** Máximo "bonito" para un eje y su paso. */
  function escalaBonita(max, marcas) {
    if (!(max > 0)) max = 1;
    const bruto = max / (marcas || 4);
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const r = bruto / pot;
    const paso = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * pot;
    return { max: Math.ceil(max / paso) * paso, paso: paso };
  }

  function hoyISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function sumarDias(iso, dias) {
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() + Math.floor(dias));
    return d.toISOString().slice(0, 10);
  }
  const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];
  function fechaCorta(iso) { return (+iso.slice(8, 10)) + ' ' + MESES[+iso.slice(5, 7) - 1]; }

  function anunciar(texto) { $('#anuncio').textContent = texto; }

  // ---------- aviso flotante con "Deshacer" ----------
  let temporizadorAviso = null;
  let accionDeshacer = null;
  function ocultarAviso() {
    clearTimeout(temporizadorAviso);
    $('#toast').hidden = true;
    accionDeshacer = null;
  }
  function mostrarAviso(texto, deshacer) {
    $('#toast-texto').textContent = texto;
    accionDeshacer = deshacer || null;
    $('#toast-deshacer').hidden = !deshacer;
    $('#toast').hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(ocultarAviso, deshacer ? 7000 : 3500);
  }

  // ---------- estado ----------
  function aparatoDesde(o) {
    return {
      id: o.id || nuevoId(),
      nombre: String(o.nombre || 'Aparato'),
      watts: Number(o.watts) || 0,
      cantidad: Math.max(1, Math.round(Number(o.cantidad) || 1)),
      ciclo: Math.min(1, Math.max(0.01, Number(o.ciclo) || 1)),
      horario: String(o.horario || ''),
      rangos: VC.parseHorario(o.horario)
    };
  }

  function estadoInicial() {
    return {
      aparatos: D.EJEMPLO_APARATOS.map(aparatoDesde),
      lecturas: clonar(D.EJEMPLO_LECTURAS),
      tarifa: clonar(D.TARIFA),
      periodo: 30,
      nIndice: 3,
      trapecios: false,
      reducciones: {},
      escenarios: [],
      facturas: [],
      ejemplo: true,
      lecturasEjemplo: true
    };
  }

  // Validación de lo guardado (o de un hogar compartido): nada se usa sin revisar.
  function escenariosValidos(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.slice(0, 6).filter(function (e) { return e && typeof e.nombre === 'string' && e.reducciones && typeof e.reducciones === 'object'; })
      .map(function (e) {
        const r = {};
        Object.keys(e.reducciones).forEach(function (k) { const v = +e.reducciones[k]; if (v > 0 && v <= 24) r[k] = v; });
        return { id: String(e.id || nuevoId()), nombre: e.nombre.slice(0, 80), reducciones: r };
      });
  }
  function facturasValidas(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.slice(0, 36).filter(function (f) { return f && /^\d{4}-\d{2}$/.test(f.mes) && +f.kwh > 0 && +f.monto > 0; })
      .map(function (f) { return { mes: f.mes, kwh: +f.kwh, monto: +f.monto }; });
  }

  function esLecturaEjemplo(l) { return D.VALORES_LECTURAS_EJEMPLO.indexOf(l.valor) >= 0; }

  // Si las lecturas guardadas son exactamente las del ejemplo, se renuevan sus
  // fechas para que terminen ayer (si no, la proyección hablaría del pasado).
  function refrescarLecturasEjemplo(lecturas) {
    if (lecturas.length === D.VALORES_LECTURAS_EJEMPLO.length && lecturas.every(esLecturaEjemplo)) return clonar(D.EJEMPLO_LECTURAS);
    return lecturas;
  }

  function cargar() {
    const base = estadoInicial();
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return base;
      const s = JSON.parse(crudo);
      return {
        aparatos: Array.isArray(s.aparatos) ? s.aparatos.map(aparatoDesde).filter(function (a) { return a.rangos; }) : base.aparatos,
        lecturas: Array.isArray(s.lecturas) ? refrescarLecturasEjemplo(s.lecturas.filter(function (l) { return /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) && isFinite(l.valor); })) : base.lecturas,
        tarifa: s.tarifa && Array.isArray(s.tarifa.bloques) && s.tarifa.bloques.length === 4 ? Object.assign(clonar(D.TARIFA), s.tarifa) : base.tarifa,
        periodo: s.periodo > 0 ? s.periodo : 30,
        nIndice: s.nIndice >= 0 && s.nIndice < N_VALORES.length ? s.nIndice : 3,
        trapecios: s.trapecios !== false,
        reducciones: s.reducciones || {},
        escenarios: escenariosValidos(s.escenarios),
        facturas: facturasValidas(s.facturas),
        ejemplo: !!s.ejemplo,
        lecturasEjemplo: s.lecturasEjemplo !== undefined ? !!s.lecturasEjemplo : !!s.ejemplo
      };
    } catch (e) {
      return base;
    }
  }

  function guardar() {
    try {
      const copia = Object.assign({}, estado, {
        aparatos: estado.aparatos.map(function (a) {
          return { id: a.id, nombre: a.nombre, watts: a.watts, cantidad: a.cantidad, ciclo: a.ciclo, horario: a.horario };
        })
      });
      localStorage.setItem(CLAVE, JSON.stringify(copia));
    } catch (e) { /* almacenamiento no disponible: la app sigue funcionando */ }
  }

  let estado = cargar();
  let editandoId = null;

  // ---------- cálculo central ----------

  function actualizarOrigenLecturas() {
    estado.lecturasEjemplo = estado.lecturas.some(esLecturaEjemplo);
  }

  // Aplica un cambio y ofrece deshacerlo durante unos segundos.
  function deshacerA(antes) {
    return function () {
      estado = antes;
      limpiarFormulario();
      renderTodo();
      anunciar('Cambio deshecho.');
    };
  }
  function conDeshacer(texto, cambio) {
    const antes = clonar(estado);
    cambio();
    renderTodo();
    mostrarAviso(texto, deshacerA(antes));
  }

  function calcular() {
    const diaria = VC.energiaDiariaTotal(estado.aparatos);
    const periodoKwh = diaria * estado.periodo;
    const fac = VC.factura(periodoKwh, estado.tarifa);
    const porAparato = estado.aparatos.map(function (ap) {
      const dia = VC.energiaDiaria(ap);
      return { ap: ap, dia: dia, periodo: dia * estado.periodo, parte: diaria > 0 ? dia / diaria : 0, costo: dia * estado.periodo * fac.precioMedio };
    }).sort(function (a, b) { return b.dia - a.dia; });
    const proy = VC.proyeccion(estado.lecturas, estado.periodo);
    return { diaria: diaria, periodoKwh: periodoKwh, factura: fac, porAparato: porAparato, proy: proy };
  }

  const NOMBRES_BLOQUE = ['0–200 kWh', '201–300 kWh', '301–700 kWh', 'más de 700 kWh'];
  const ESTADO_BLOQUE = ['good', 'warn', 'warn', 'crit'];

  function pillBloque(i) {
    return '<span class="pill ' + ESTADO_BLOQUE[i] + '">Bloque ' + NOMBRES_BLOQUE[i] + '</span>';
  }

  // Ventana del formulario. Los navegadores viejos de celular no tienen showModal(),
  // así que en ellos se muestra como capa fija con la clase "sin-modal".
  function abrirEditor() {
    const d = $('#editor');
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else { d.setAttribute('open', ''); d.classList.add('sin-modal'); }
  }
  function alCerrarEditor() {
    limpiarFormulario();
    renderAparatos();
  }
  function cerrarEditor() {
    const d = $('#editor');
    if (typeof d.close === 'function' && typeof d.showModal === 'function') { d.close(); return; }
    d.removeAttribute('open');
    d.classList.remove('sin-modal');
    alCerrarEditor();
  }

  // Al editar aparatos o lecturas, el hogar deja de ser "de ejemplo".
  function marcarEditado() {
    estado.ejemplo = false;
  }

  // ---------- encabezado y resumen ----------

  // Números que avanzan hasta su nuevo valor (idea tomada del "KPI Tile" de 21st.dev).
  // Respeta "reducir movimiento" del sistema: en ese caso el número cambia sin animación.
  const valoresPrevios = {};
  const animaciones = {};
  const sinMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animarNumero(clave, el, hasta, formato) {
    const desde = clave in valoresPrevios ? valoresPrevios[clave] : 0;
    valoresPrevios[clave] = hasta;
    cancelAnimationFrame(animaciones[clave]);
    if (sinMovimiento || Math.abs(hasta - desde) < 1e-9) { el.textContent = formato(hasta); return; }
    const inicio = performance.now();
    const duracion = 450;
    function paso(ahora) {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const suave = 1 - Math.pow(1 - t, 3);
      el.textContent = formato(desde + (hasta - desde) * suave);
      if (t < 1) animaciones[clave] = requestAnimationFrame(paso);
    }
    el.textContent = formato(desde);
    animaciones[clave] = requestAnimationFrame(paso);
  }

  function renderResumen(c) {
    const f = c.factura;
    const top = c.porAparato[0];

    // La factura va primero y más grande: es la cifra que más le importa a la gente.
    $('#stats').innerHTML =
      '<div class="stat"><span class="label">Factura estimada · ' + estado.periodo + ' días</span><span class="value" id="n-factura">' + rd(f.total, 0) + '</span><span class="sub">≈ ' + rd(f.precioMedio) + ' por kWh en promedio</span></div>' +
      '<div class="stat"><span class="label">Consumo · ' + estado.periodo + ' días</span><span class="value"><span id="n-periodo">' + fmt(c.periodoKwh, 0) + '</span><small>kWh</small></span><span class="sub">' + pillBloque(f.bloque) + '</span></div>' +
      '<div class="stat"><span class="label">Consumo diario</span><span class="value"><span id="n-diaria">' + fmt(c.diaria, 2) + '</span><small>kWh</small></span><span class="sub">Área bajo la curva de 0 a 24 h</span></div>';
    animarNumero('diaria', $('#n-diaria'), c.diaria, function (v) { return fmt(v, 2); });
    animarNumero('periodo', $('#n-periodo'), c.periodoKwh, function (v) { return fmt(v, 0); });
    animarNumero('factura', $('#n-factura'), f.total, function (v) { return rd(v, 0); });
    $('#top-aparato').innerHTML = top
      ? 'Aparato que más consume: <b>' + esc(top.ap.nombre) + '</b> · ' + fmt(top.parte * 100, 0) + ' % del consumo · ' + rd(top.costo, 0) + ' en el período'
      : 'Agrega aparatos para ver cuál consume más.';
    $('#e-dia').textContent = fmt(c.diaria, 2) + ' kWh';

    // tabla de factura
    let filas = '<tr><th>Concepto</th><th class="r">kWh</th><th class="r p">RD$/kWh</th><th class="r">Monto</th></tr>';
    if (!f.lineas.length) filas += '<tr><td>Energía</td><td class="r">0</td><td class="r p">—</td><td class="r">' + rd(0) + '</td></tr>';
    f.lineas.forEach(function (l) {
      const nombre = l.hasta === null && l.desde === 0 ? 'Todo el consumo (pasó de 700 kWh)' : 'Bloque ' + (l.desde === 0 ? '0' : l.desde + 1) + (l.hasta === null ? '+' : '–' + l.hasta) + ' kWh';
      filas += '<tr><td>' + nombre + '</td><td class="r">' + fmt(l.kwh, 1) + '</td><td class="r p">' + fmt(l.precio, 2) + '</td><td class="r">' + rd(l.monto) + '</td></tr>';
    });
    filas += '<tr><td>Cargo fijo</td><td class="r"></td><td class="r p"></td><td class="r">' + rd(f.cargoFijo) + '</td></tr>';
    if (f.itbis > 0) filas += '<tr><td>ITBIS (' + fmt(estado.tarifa.itbis * 100, 0) + ' %)</td><td class="r"></td><td class="r p"></td><td class="r">' + rd(f.itbis) + '</td></tr>';
    filas += '<tr class="total"><td>Total estimado</td><td class="r">' + fmt(c.periodoKwh, 1) + '</td><td class="r p"></td><td class="r">' + rd(f.total) + '</td></tr>';
    $('#tabla-factura').innerHTML = filas;

    renderEscala(c.periodoKwh, f.bloque);
  }

  function renderEscala(kwh, bloque) {
    const b = estado.tarifa.bloques;
    const tope = Math.max(900, kwh * 1.08);
    const limites = [0, b[0].hasta, b[1].hasta, b[2].hasta, tope];
    let html = '<div class="scale-bar">';
    for (let i = 0; i < 4; i++) {
      const ancho = (limites[i + 1] - limites[i]) / tope * 100;
      html += '<div class="seg' + (i === bloque ? ' on' : '') + '" style="width:' + ancho + '%" title="' + NOMBRES_BLOQUE[i] + ': RD$ ' + fmt(b[i].precio, 2) + '">' + fmt(b[i].precio, 2) + '</div>';
    }
    const pos = Math.min(100, kwh / tope * 100);
    html += '<div class="scale-mark" style="left:calc(' + pos + '% - 1px)"><span>' + fmt(kwh, 0) + ' kWh</span></div></div>';
    html += '<div class="scale-legend">' + limites.map(function (v, i) {
      return '<span style="left:' + (v / tope * 100) + '%">' + (i === 4 ? fmt(v, 0) + ' kWh' : fmt(v, 0)) + '</span>';
    }).join('') + '</div>';
    $('#escala').innerHTML = html;
    const sig = bloque < 3 ? b[bloque].hasta - kwh : null;
    $('#escala-nota').innerHTML = sig !== null
      ? 'Te faltan <b>' + fmt(sig, 0) + ' kWh</b> para pasar al bloque de ' + NOMBRES_BLOQUE[bloque + 1] + ', donde cada kWh cuesta RD$ ' + fmt(b[bloque + 1].precio, 2) + '.'
      : 'Pasaste de 700 kWh: ' + (estado.tarifa.ultimoBloqueATodo ? 'todo el consumo se cobra a RD$ ' + fmt(b[3].precio, 2) + ' por kWh' : 'el excedente se cobra a RD$ ' + fmt(b[3].precio, 2)) + (estado.tarifa.itbisSobreUmbral ? ' y se agrega ITBIS.' : '.');
  }

  // ---------- aparatos ----------
  // Aparatos comunes que se ofrecen como atajo cuando la lista está vacía.
  const ATAJOS = ['Nevera', 'Aire acondicionado 12,000 BTU', 'Abanico de techo', 'Televisor LED 43"', 'Bombillo LED', 'Router Wi‑Fi'];

  function renderAparatos(c) {
    c = c || ultimoCalculo || calcular();
    const lista = $('#lista-aparatos');
    $('#cabecera-costo').textContent = 'Costo · ' + estado.periodo + ' días';
    if (!estado.aparatos.length) {
      const botones = ATAJOS.map(function (nombre) {
        const i = D.CATALOGO.findIndex(function (a) { return a.nombre === nombre; });
        return i < 0 ? '' : '<button class="btn small" type="button" data-catalogo="' + i + '">+ ' + esc(nombre.replace(/ \d.*$/, '')) + '</button>';
      }).join('');
      lista.innerHTML = '<div class="vacio"><p>Todavía no hay aparatos. Empieza con uno común:</p>' +
        '<div class="atajos">' + botones + '<button class="btn small ghost" type="button" data-catalogo="otro">Otro aparato</button></div></div>';
      return;
    }
    // Del que más cuesta al que menos (el costo es su parte de la factura).
    const max = c.porAparato.length ? c.porAparato[0].costo : 0;
    lista.innerHTML = c.porAparato.map(function (it) {
      const ap = it.ap;
      const horas = VC.horasDeUso(ap.rangos);
      const detalle = [fmt(ap.watts, 0) + ' W'];
      if (ap.cantidad > 1) detalle.push(ap.cantidad + ' unidades');
      if (ap.ciclo < 1) detalle.push('ciclo ' + fmt(ap.ciclo * 100, 0) + ' %');
      return '<div class="row' + (ap.id === editandoId ? ' editing' : '') + '" data-id="' + ap.id + '">' +
        '<div class="ap-nombre"><b>' + esc(ap.nombre) + '</b><small>' + detalle.join(' · ') + '</small></div>' +
        '<div class="ap-horario"><span>' + esc(VC.textoHorario(ap.rangos)) + '</span><small>' + textoHoras(horas) + ' al día<span class="kwh-movil"> · ' + fmt(it.dia, 2) + ' kWh/día</span></small></div>' +
        '<div class="ap-kwh r"><b>' + fmt(it.dia, 2) + '</b><small>kWh/día</small></div>' +
        '<div class="ap-costo r"><b>' + rd(it.costo, 0) + '</b><small>' + fmt(it.parte * 100, 0) + ' % · ' + estado.periodo + ' días</small>' +
        '<span class="mini" aria-hidden="true"><i style="width:' + (max > 0 ? it.costo / max * 100 : 0) + '%"></i></span></div>' +
        '<div class="acts"><button class="btn small ghost" type="button" data-accion="editar" aria-label="Editar ' + esc(ap.nombre) + '">Editar</button><button class="btn small ghost danger" type="button" data-accion="quitar" aria-label="Quitar ' + esc(ap.nombre) + '">Quitar</button></div>' +
        '</div>';
    }).join('');
  }

  // Rellena el formulario con un aparato del catálogo (índice) o lo deja libre ("otro").
  function elegirDelCatalogo(v) {
    if (v === '') return;
    if (v === 'otro') { $('#f-nombre').value = ''; $('#f-watts').value = ''; cargarHorarioVisual(''); $('#f-nombre').focus(); actualizarVistaPrevia(); return; }
    const a = D.CATALOGO[+v];
    if (!a) return;
    $('#f-nombre').value = a.nombre;
    $('#f-watts').value = a.watts;
    cargarHorarioVisual(a.horario);
    $('#f-error').textContent = '';
    actualizarVistaPrevia();
  }

  function llenarCatalogo() {
    const sel = $('#f-catalogo');
    sel.innerHTML = '<option value="">Elige un aparato común…</option>' +
      D.CATALOGO.map(function (a, i) { return '<option value="' + i + '">' + esc(a.nombre) + ' · ' + a.watts + ' W</option>'; }).join('') +
      '<option value="otro">Otro (lo escribo yo)</option>';
  }


  function agregarIntervalo(destino, inicio, fin, adicional) {
    const fila = document.createElement('div');
    fila.className = 'intervalo';
    fila.innerHTML = '<label class="field">Desde<input type="time"></label>' +
      '<label class="field">Hasta<input type="time"></label>' +
      '<label class="check medianoche"><input type="checkbox"> Hasta medianoche</label>';
    const [desde, hasta, medianoche] = fila.querySelectorAll('input');
    desde.value = inicio;
    hasta.value = fin === '24:00' ? '00:00' : fin;
    medianoche.checked = fin === '24:00';
    hasta.disabled = medianoche.checked;
    fila.addEventListener('input', function () {
      hasta.disabled = medianoche.checked;
      actualizarVistaPrevia();
    });
    if (adicional) {
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'btn small ghost';
      quitar.textContent = 'Quitar intervalo';
      quitar.addEventListener('click', function () {
        fila.remove();
        $('#agregar-intervalo').focus();
        actualizarVistaPrevia();
      });
      fila.append(quitar);
    }
    destino.append(fila);
    return desde;
  }

  function mostrarHorario() {
    const todoDia = $('#f-todo-dia').checked;
    $('#intervalos').hidden = todoDia;
    $('#intervalos-extra').hidden = todoDia;
    $('#agregar-intervalo').hidden = todoDia;
  }

  function cargarHorarioVisual(horario) {
    const rangos = VC.parseHorario(horario);
    const todoDia = rangos && VC.horasDeUso(rangos) === 24;
    $('#f-todo-dia').checked = !!todoDia;
    $('#primer-intervalo').innerHTML = '';
    $('#intervalos-extra').innerHTML = '';
    function hora(t) {
      const minutos = Math.round(t * 60);
      return String(Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0');
    }
    const pares = rangos && !todoDia ? rangos : [];
    const [primero, ...extras] = pares.map(function (rango) { return rango.map(hora); });
    agregarIntervalo($('#primer-intervalo'), ...(primero || ['', '']), false);
    extras.forEach(function (par) { agregarIntervalo($('#intervalos-extra'), ...par, true); });
    mostrarHorario();
  }

  function leerHorarioVisual() {
    if ($('#f-todo-dia').checked) return '24 horas';
    const horarios = Array.from(document.querySelectorAll('.intervalo'), function (fila) {
      const [desde, hasta, medianoche] = fila.querySelectorAll('input');
      const fin = medianoche.checked ? '24:00' : hasta.value;
      if (!desde.value || !fin || desde.value === fin) return '';
      return desde.value + '-' + fin;
    });
    return horarios.every(Boolean) ? horarios.join(', ') : '';
  }

  function leerFormulario() {
    const nombre = $('#f-nombre').value.trim();
    const watts = parseFloat($('#f-watts').value);
    const cantidad = parseInt($('#f-cantidad').value, 10);
    // El ciclo ya no se pregunta: se deduce del nombre (nevera 40 %, aire 70 %, etc.).
    const ciclo = D.cicloAutomatico(nombre);
    const horario = leerHorarioVisual();
    $('#f-horario').value = horario;
    const rangos = VC.parseHorario(horario);
    const errores = [];
    if (!nombre) errores.push('Escribe el nombre del aparato.');
    if (!(watts > 0 && watts <= 20000)) errores.push('La potencia debe estar entre 1 y 20,000 W.');
    if (!(cantidad >= 1 && cantidad <= 50)) errores.push('La cantidad debe estar entre 1 y 50.');
    if (!rangos) errores.push('Completa cada intervalo con dos horas distintas, o activa Todo el día.');
    return { datos: { nombre: nombre, watts: watts, cantidad: cantidad, ciclo: ciclo, horario: horario, rangos: rangos }, errores: errores };
  }

  function actualizarVistaPrevia() {
    const r = leerFormulario();
    const prev = $('#f-preview');
    if (r.datos.watts > 0 && r.datos.rangos && r.datos.cantidad >= 1 && r.datos.ciclo > 0) {
      const ap = Object.assign({}, r.datos, { ciclo: Math.min(1, r.datos.ciclo) });
      const dia = VC.energiaDiaria(ap);
      // Cuánto sube la factura con este aparato (considera el bloque tarifario).
      let base = (ultimoCalculo || calcular()).periodoKwh;
      const anterior = editandoId && estado.aparatos.find(function (a) { return a.id === editandoId; });
      if (anterior) base -= VC.energiaDiaria(anterior) * estado.periodo;
      base = Math.max(0, base);
      const extra = VC.factura(base + dia * estado.periodo, estado.tarifa).total - VC.factura(base, estado.tarifa).total;
      prev.innerHTML = 'Consumirá <b class="mono">' + fmt(dia, 2) + ' kWh</b> al día (' + textoHoras(VC.horasDeUso(ap.rangos)) + ' de uso) y unos <b class="mono">' + fmt(dia * estado.periodo, 0) + ' kWh</b> en ' + estado.periodo + ' días.' +
        '<br>Le suma a tu factura unos <b class="mono">' + rd(extra, 0) + '</b> cada ' + estado.periodo + ' días.' +
        (ap.ciclo < 1 ? '<br><span class="nota-ciclo">Ya se descontó que su motor o resistencia prende y apaga solo: trabaja cerca del ' + fmt(ap.ciclo * 100, 0) + ' % del tiempo.</span>' : '');
    } else {
      prev.textContent = 'Completa los datos para ver cuánto consumirá.';
    }
  }

  function limpiarFormulario() {
    editandoId = null;
    $('#form-aparato').reset();
    $('#f-cantidad').value = 1;
    cargarHorarioVisual('');
    $('#f-error').textContent = '';
    $('#form-titulo').textContent = 'Agregar un aparato';
    $('#f-guardar').textContent = 'Agregar aparato';
    $('#f-cancelar').hidden = true;
    document.querySelectorAll('#form-aparato .invalid').forEach(function (el) { el.classList.remove('invalid'); });
    actualizarVistaPrevia();
  }

  function editarAparato(id) {
    const ap = estado.aparatos.find(function (a) { return a.id === id; });
    if (!ap) return;
    editandoId = id;
    $('#f-catalogo').value = '';
    $('#f-nombre').value = ap.nombre;
    $('#f-watts').value = ap.watts;
    $('#f-cantidad').value = ap.cantidad;
    cargarHorarioVisual(ap.horario);
    abrirEditor();
    $('#form-titulo').textContent = 'Editar: ' + ap.nombre;
    $('#f-guardar').textContent = 'Guardar cambios';
    $('#f-cancelar').hidden = false;
    $('#f-error').textContent = '';
    actualizarVistaPrevia();
    renderAparatos();
    $('#form-aparato').scrollIntoView({ block: 'nearest' });
    $('#f-nombre').focus({ preventScroll: true });
  }


  // ---------- curva de potencia ----------
  function puntosDeCambio(aparatos) {
    const set = new Set([0, 24]);
    aparatos.forEach(function (ap) { ap.rangos.forEach(function (r) { set.add(r[0]); set.add(r[1]); }); });
    return Array.from(set).filter(function (t) { return t >= 0 && t <= 24; }).sort(function (a, b) { return a - b; });
  }

  // Animación de entrada de una gráfica: un recorte que se abre de izquierda a
  // derecha, como si la curva se fuera dibujando a lo largo del día.
  function revelar(s, capa, m, iw, ih, id, duracion) {
    if (sinMovimiento) return;
    const defs = svg('defs', {}, s);
    const clip = svg('clipPath', { id: 'revelar-' + id }, defs);
    const r = svg('rect', { x: m.l - 2, y: 0, width: 0, height: m.t + ih + 6 }, clip);
    capa.setAttribute('clip-path', 'url(#revelar-' + id + ')');
    const inicio = performance.now();
    const total = duracion || 900;
    function paso(ahora) {
      // el primer cuadro puede llegar con una hora apenas anterior a `inicio`
      const k = Math.min(1, Math.max(0, (ahora - inicio) / total));
      r.setAttribute('width', (iw + 6) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(paso);
      else capa.removeAttribute('clip-path');
    }
    requestAnimationFrame(paso);
  }

  function renderCurva(c, animar) {
    dibujarCurva($('#grafico-curva'), c, { n: N_VALORES[estado.nIndice], trapecios: estado.trapecios, interactivo: true, animar: animar });
  }

  /** Dibuja P(t) en `cont`. op = { n, trapecios, interactivo, animar, alto }. */
  function dibujarCurva(cont, c, op) {
    if (!cont.clientWidth) return;
    const ancho = Math.max(280, cont.clientWidth || 700);
    const angosto = ancho < 520;
    const alto = op.alto || (angosto ? 245 : 330);
    const m = { l: 48, r: 12, t: 24, b: 40 };
    const iw = ancho - m.l - m.r, ih = alto - m.t - m.b;
    const ap = estado.aparatos;
    const P = function (t) { return VC.potenciaEn(t, ap); };

    const cortes = puntosDeCambio(ap);
    const tramos = [];
    for (let i = 0; i < cortes.length - 1; i++) {
      const a = cortes[i], b = cortes[i + 1];
      if (b - a > 1e-9) tramos.push({ a: a, b: b, p: P((a + b) / 2) });
    }
    const pMax = tramos.reduce(function (s, x) { return Math.max(s, x.p); }, 0);
    const ejeY = escalaBonita(pMax * 1.08, 4);
    const x = function (t) { return m.l + t / 24 * iw; };
    const y = function (p) { return m.t + ih - p / ejeY.max * ih; };

    cont.innerHTML = '';
    const s = svg('svg', { viewBox: '0 0 ' + ancho + ' ' + alto, width: ancho, height: alto, role: 'img', 'aria-label': 'Curva de potencia del hogar durante el día. Energía total ' + fmt(c.diaria, 2) + ' kWh.' }, cont);

    // cuadrícula y ejes
    const g = svg('g', { class: 'grid' }, s);
    const ejes = svg('g', { class: 'axis' }, s);
    for (let v = 0; v <= ejeY.max + 1e-9; v += ejeY.paso) {
      svg('line', { x1: m.l, x2: ancho - m.r, y1: y(v), y2: y(v) }, g);
      const t = svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, ejes);
      t.textContent = fmt(v / 1000, ejeY.paso < 10 ? 3 : ejeY.paso < 100 ? 2 : 1);
    }
    const pasoH = angosto ? 6 : 3;
    for (let h = 0; h <= 24; h += pasoH) {
      const t = svg('text', { x: x(h), y: alto - m.b + 18, 'text-anchor': h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }, ejes);
      t.textContent = String(h).padStart(2, '0') + ':00';
    }
    const tituloX = svg('text', { x: m.l + iw / 2, y: alto - 4, 'text-anchor': 'middle', class: 'axis-title' }, s);
    tituloX.textContent = 'Hora del día';
    const tituloY = svg('text', { x: m.l - 8, y: 11, 'text-anchor': 'end', class: 'axis-title' }, s);
    tituloY.textContent = 'kW';

    if (!tramos.length || pMax === 0) {
      const t = svg('text', { x: m.l + iw / 2, y: m.t + ih / 2, 'text-anchor': 'middle', class: 'axis-title' }, s);
      t.textContent = 'Agrega aparatos para ver la curva';
      return;
    }

    // área y curva escalonada exacta
    let d = 'M' + x(0) + ',' + y(tramos[0].p);
    tramos.forEach(function (tr, i) {
      if (i > 0) d += 'V' + y(tr.p);
      d += 'H' + x(tr.b);
    });
    const capa = svg('g', {}, s);
    if (op.animar) revelar(s, capa, m, iw, ih, cont.id);
    svg('path', { d: d + 'V' + y(0) + 'H' + x(0) + 'Z', class: 'area' }, capa);

    // trapecios
    const n = op.n;
    if (op.trapecios) {
      const h = 24 / n;
      const gt = svg('g', {}, capa);
      if (n <= 48) {
        for (let i = 0; i < n; i++) {
          const a = i * h, b = (i + 1) * h;
          svg('polygon', { points: x(a) + ',' + y(0) + ' ' + x(a) + ',' + y(P(a)) + ' ' + x(b) + ',' + y(P(b)) + ' ' + x(b) + ',' + y(0), class: 'trap' }, gt);
        }
      } else {
        let pts = '';
        for (let i = 0; i <= n; i++) pts += x(i * h) + ',' + y(P(i * h)) + ' ';
        svg('polyline', { points: pts.trim(), class: 'trap', style: 'fill:none' }, gt);
      }
      if (n <= 24) {
        for (let i = 0; i <= n; i++) svg('circle', { cx: x(i * h), cy: y(P(i * h)), r: 4, class: 'trap-dot' }, gt);
      }
    }
    svg('path', { d: d, class: 'curve' }, capa);
    if (!op.interactivo) return;

    // capa de interacción
    const cruz = svg('line', { class: 'cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' }, s);
    const zona = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' }, s);
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    cont.appendChild(tip);

    function mover(ev) {
      const caja = s.getBoundingClientRect();
      const px = (ev.clientX - caja.left) * (ancho / caja.width);
      let t = (px - m.l) / iw * 24;
      t = Math.min(23.99, Math.max(0, Math.round(t * 12) / 12));
      const p = P(t);
      const activos = ap.filter(function (a) { return VC.encendido(t, a.rangos); })
        .sort(function (a, b) { return VC.potenciaMedia(b) - VC.potenciaMedia(a); });
      cruz.setAttribute('x1', x(t)); cruz.setAttribute('x2', x(t));
      cruz.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + VC.formatoHora(t) + '</b> · ' + fmt(p, 0) + ' W' +
        '<ul>' + (activos.length ? activos.slice(0, 5).map(function (a) { return '<li>' + esc(a.nombre) + ' · ' + fmt(VC.potenciaMedia(a), 0) + ' W</li>'; }).join('') + (activos.length > 5 ? '<li>y ' + (activos.length - 5) + ' más</li>' : '') : '<li>Nada encendido</li>') + '</ul>';
      tip.hidden = false;
      const left = Math.min(Math.max(x(t) / ancho * caja.width, 80), caja.width - 80);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(y(p) / alto * caja.height, 70) + 'px';
    }
    function salir() { cruz.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    zona.addEventListener('pointermove', mover);
    zona.addEventListener('pointerdown', mover);
    zona.addEventListener('pointerleave', salir);
  }

  function renderLecturaCurva(c) {
    const n = N_VALORES[estado.nIndice];
    const aprox = VC.energiaTrapecio(estado.aparatos, n);
    const error = c.diaria > 0 ? (aprox - c.diaria) / c.diaria * 100 : 0;
    const abs = Math.abs(error);
    const h = 24 / n;
    $('#r-exacta').innerHTML = fmt(c.diaria, 3) + ' <small>kWh</small>';
    $('#r-trap-label').textContent = 'Regla del trapecio con n = ' + n;
    $('#r-trap').innerHTML = fmt(aprox, 3) + ' <small>kWh</small>';
    const tipo = abs < 1 ? 'good' : abs < 10 ? 'warn' : 'crit';
    $('#r-error').innerHTML = '<span class="pill ' + tipo + '">Error ' + (error >= 0 ? '+' : '−') + fmt(abs, 1) + ' %</span>';
    $('#n-slider').value = estado.nIndice;
    $('#n-slider').style.setProperty('--p', (estado.nIndice / (N_VALORES.length - 1) * 100) + '%');
    $('#n-slider').setAttribute('aria-valuetext', n + ' trapecios');
    $('#mostrar-trap').checked = estado.trapecios;
    $('#leyenda-trap').hidden = !estado.trapecios;
    const anchoTxt = h >= 1 ? fmt(h, h % 1 ? 1 : 0) + (h === 1 ? ' hora' : ' horas') : fmt(h * 60, 0) + ' minutos';
    $('#r-explica').textContent = 'Cada trapecio cubre ' + anchoTxt + ' (h = 24/' + n + '). ' +
      (abs < 1 ? 'Con esta n la aproximación ya coincide casi exactamente con el área real.' : 'Sube n para que los trapecios sigan mejor los cambios de la curva, sobre todo los aparatos que se usan pocos minutos.');
  }

  function renderBarras(c) {
    const cont = $('#barras');
    if (!c.porAparato.length) { cont.innerHTML = '<div class="empty">Sin aparatos registrados.</div>'; return; }
    const max = c.porAparato[0].periodo || 1;
    cont.innerHTML = c.porAparato.map(function (it, i) {
      return '<div class="bar-row' + (i === 0 ? ' top' : '') + '" title="' + esc(it.ap.nombre) + ': ' + fmt(it.periodo, 1) + ' kWh, ' + fmt(it.parte * 100, 1) + ' % del consumo">' +
        '<span class="n">' + esc(it.ap.nombre) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + (it.periodo / max * 100) + '%"></span></span>' +
        '<span class="v">' + fmt(it.periodo, 1) + ' kWh · ' + rd(it.costo, 0) + '</span></div>';
    }).join('');
  }

  // ---------- contador ----------
  /** Dibuja las lecturas acumuladas y la proyección en `cont`. op = { interactivo, animar, alto }. */
  function dibujarMedidor(cont, c, op) {
    if (!cont.clientWidth) return;
    const proy = c.proy;
    const ancho = Math.max(280, cont.clientWidth || 600);
    const angosto = ancho < 520;
    const alto = op.alto || (angosto ? 230 : 280);
    const m = { l: 52, r: angosto ? 58 : 70, t: 16, b: 40 };
    const iw = ancho - m.l - m.r, ih = alto - m.t - m.b;
    cont.innerHTML = '';
    const s = svg('svg', { viewBox: '0 0 ' + ancho + ' ' + alto, width: ancho, height: alto, role: 'img', 'aria-label': proy ? 'Consumo acumulado según el contador, con proyección de ' + fmt(proy.total, 0) + ' kWh al final del período.' : 'Sin suficientes lecturas.' }, cont);

    if (!proy) {
      const t = svg('text', { x: ancho / 2, y: alto / 2, 'text-anchor': 'middle', class: 'axis-title' }, s);
      t.textContent = estado.lecturas.length ? 'Agrega una lectura de otro día para ver tu ritmo' : 'Agrega al menos dos lecturas de días distintos';
      return;
    }

    const umbrales = estado.tarifa.bloques.slice(0, 3).map(function (b) { return b.hasta; });
    const siguiente = umbrales.find(function (u) { return u > proy.total; });
    const ejeY = escalaBonita(Math.max(proy.total * 1.08, siguiente ? siguiente * 1.04 : 0), 4);
    const x = function (d) { return m.l + d / proy.periodo * iw; };
    const y = function (v) { return m.t + ih - v / ejeY.max * ih; };

    const g = svg('g', { class: 'grid' }, s);
    const ejes = svg('g', { class: 'axis' }, s);
    for (let v = 0; v <= ejeY.max + 1e-9; v += ejeY.paso) {
      svg('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }, g);
      const t = svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, ejes);
      t.textContent = fmt(v, 0);
    }
    const pasoD = proy.periodo <= 31 ? (angosto ? 10 : 5) : 10;
    for (let d = 0; d <= proy.periodo; d += pasoD) {
      const t = svg('text', { x: x(d), y: alto - m.b + 18, 'text-anchor': d === 0 ? 'start' : 'middle' }, ejes);
      t.textContent = d;
    }
    const tx = svg('text', { x: m.l + iw / 2, y: alto - 4, 'text-anchor': 'middle', class: 'axis-title' }, s);
    tx.textContent = 'Días desde la primera lectura';
    const ty = svg('text', { x: 4, y: m.t - 4, class: 'axis-title' }, s);
    ty.textContent = 'kWh';

    umbrales.forEach(function (u) {
      if (u > ejeY.max) return;
      svg('line', { x1: m.l, x2: m.l + iw, y1: y(u), y2: y(u), class: 'threshold' }, s);
      const t = svg('text', { x: m.l + 6, y: y(u) - 5, class: 'threshold-label' }, s);
      t.textContent = 'límite ' + u + ' kWh';
    });

    const pts = proy.puntos;
    const linea = svg('polyline', { points: pts.map(function (p) { return x(p.dia) + ',' + y(p.acumulado); }).join(' '), class: 'real' }, s);
    const lineaProy = svg('line', { x1: x(proy.ultimo.dia), y1: y(proy.ultimo.acumulado), x2: x(proy.periodo), y2: y(proy.total), class: 'proj' }, s);
    pts.forEach(function (p, i) {
      const punto = svg('circle', { cx: x(p.dia), cy: y(p.acumulado), r: 4.5, class: 'dot' }, s);
      if (op.animar) { punto.classList.add('aparecer'); punto.style.animationDelay = (i * 70) + 'ms'; }
    });
    const final = svg('circle', { cx: x(proy.periodo), cy: y(proy.total), r: 5, class: 'dot-end' }, s);
    const fin = svg('text', { x: x(proy.periodo) + 8, y: y(proy.total) + 4, class: 'end-label' }, s);
    fin.textContent = fmt(proy.total, 0);
    // animación: primero se trazan las lecturas reales y después aparece la proyección
    if (op.animar && !sinMovimiento && linea.getTotalLength) {
      linea.style.setProperty('--largo', linea.getTotalLength());
      linea.classList.add('trazar');
      [lineaProy, final, fin].forEach(function (el) { el.classList.add('aparecer-tarde'); });
    }
    if (!op.interactivo) return;

    // interacción: punto más cercano
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    cont.appendChild(tip);
    const objetivos = pts.map(function (p) { return { dia: p.dia, v: p.acumulado, txt: '<b>' + fechaCorta(p.fecha) + '</b><ul><li>Contador: ' + fmt(p.valor, 1) + ' kWh</li><li>Acumulado: ' + fmt(p.acumulado, 1) + ' kWh</li></ul>' }; });
    objetivos.push({ dia: proy.periodo, v: proy.total, txt: '<b>Cierre del período</b><ul><li>Proyección: ' + fmt(proy.total, 1) + ' kWh</li><li>' + fechaCorta(sumarDias(pts[0].fecha, proy.periodo)) + '</li></ul>' });
    const zona = svg('rect', { x: m.l, y: m.t, width: iw + 10, height: ih, fill: 'transparent' }, s);
    function mover(ev) {
      const caja = s.getBoundingClientRect();
      const px = (ev.clientX - caja.left) * (ancho / caja.width);
      const dia = (px - m.l) / iw * proy.periodo;
      let mejor = objetivos[0];
      objetivos.forEach(function (o) { if (Math.abs(o.dia - dia) < Math.abs(mejor.dia - dia)) mejor = o; });
      tip.innerHTML = mejor.txt;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(x(mejor.dia) / ancho * caja.width, 80), caja.width - 80) + 'px';
      tip.style.top = Math.max(y(mejor.v) / alto * caja.height, 70) + 'px';
    }
    zona.addEventListener('pointermove', mover);
    zona.addEventListener('pointerdown', mover);
    zona.addEventListener('pointerleave', function () { tip.hidden = true; });
  }

  function renderMedidor(c, animar) {
    const cont = $('#grafico-medidor');
    if (!cont.clientWidth) return;
    dibujarMedidor(cont, c, { interactivo: true, animar: animar });
    const hechos = $('#hechos-medidor');
    const proy = c.proy;
    if (!proy) { hechos.innerHTML = ''; return; }
    const umbrales = estado.tarifa.bloques.slice(0, 3).map(function (b) { return b.hasta; });
    const pts = proy.puntos;

    // datos clave
    const facProy = VC.factura(proy.total, estado.tarifa);
    let cambio = 'No cambiarías de bloque en este período.';
    const proximo = umbrales.find(function (u) { return u > proy.ultimo.acumulado; });
    if (proximo) {
      const dia = VC.diaQueAlcanza(proy, proximo);
      if (dia !== null) cambio = 'Llegarías a ' + proximo + ' kWh alrededor del ' + fechaCorta(sumarDias(pts[0].fecha, dia));
    }
    const cobertura = proy.ritmo > 0 ? c.diaria / proy.ritmo * 100 : 0;
    hechos.innerHTML =
      '<div class="fact"><span class="label">Ritmo según lecturas</span><span class="val">' + fmt(proy.ritmo, 2) + ' kWh/día</span><span class="sub">Consumo de aparatos respecto al ritmo: ' + fmt(cobertura, 0) + ' %</span></div>' +
      '<div class="fact"><span class="label">Proyección a ' + proy.periodo + ' días</span><span class="val">' + fmt(proy.total, 0) + ' kWh</span><span class="sub">Factura ≈ ' + rd(facProy.total, 0) + '</span></div>' +
      '<div class="fact"><span class="label">Próximo bloque</span><span class="val texto">' + cambio + '</span></div>';
  }

  function renderLecturas() {
    const cont = $('#lista-lecturas');
    const orden = estado.lecturas.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    // nota del formulario rápido del Resumen
    const ultima = orden[orden.length - 1];
    $('#lr-nota').textContent = !ultima ? 'Anota el número que marca tu contador.'
      : ultima.fecha === hoyISO() ? 'Ya anotaste hoy: ' + fmt(ultima.valor, 1) + ' kWh (puedes corregirla).'
      : 'Última: ' + fmt(ultima.valor, 1) + ' kWh el ' + fechaCorta(ultima.fecha) + '.';
    if (!orden.length) { cont.innerHTML = '<div class="empty">Sin lecturas todavía.</div>'; return; }
    const filas = orden.map(function (l, i) {
      const ant = orden[i - 1];
      let dif = '';
      if (ant) {
        const dias = VC.diasEntre(ant.fecha, l.fecha);
        dif = '+' + fmt((l.valor - ant.valor) / Math.max(1, dias), 1) + (dias > 1 ? ' /día' : '');
      }
      return '<div class="reading"><span>' + fechaCorta(l.fecha) + ' ' + l.fecha.slice(0, 4) + '</span><span class="mono">' + fmt(l.valor, 1) + '</span><span class="d">' + dif + '</span>' +
        '<button class="btn small ghost danger" type="button" data-fecha="' + l.fecha + '" aria-label="Borrar lectura del ' + l.fecha + '">Borrar</button></div>';
    }).reverse();
    cont.innerHTML = filas.join('');
  }

  // ---------- ahorro ----------
  function renderAhorro(c) {
    const cont = $('#sliders');
    const items = c.porAparato.filter(function (it) { return VC.horasDeUso(it.ap.rangos) > 0; });
    const aire = estado.aparatos.find(function (a) { return /aire/i.test(a.nombre); });
    $('#btn-aire').hidden = !aire || VC.horasDeUso(aire.rangos) < 2;

    if (!items.length) {
      cont.innerHTML = '<div class="empty">Agrega aparatos para simular.</div>';
      cont.dataset.firma = '';
      $('#resultado-ahorro').innerHTML = '';
      $('#barra-ahorro').hidden = true;
      return;
    }
    $('#barra-ahorro').hidden = false;
    // limpiar reducciones de aparatos que ya no existen o exceden sus horas
    Object.keys(estado.reducciones).forEach(function (id) {
      const ap = estado.aparatos.find(function (a) { return a.id === id; });
      if (!ap) delete estado.reducciones[id];
      else estado.reducciones[id] = Math.min(estado.reducciones[id], VC.horasDeUso(ap.rangos));
    });

    // se reconstruye solo si cambió la lista de aparatos (para no perder el foco al arrastrar)
    const firma = items.map(function (it) { return it.ap.id + ':' + VC.horasDeUso(it.ap.rangos) + ':' + it.ap.nombre; }).join('|');
    if (cont.dataset.firma !== firma) {
      cont.dataset.firma = firma;
      cont.innerHTML = items.map(function (it) {
        const horas = VC.horasDeUso(it.ap.rangos);
        const paso = horas <= 1 ? 0.0833 : horas <= 4 ? 0.25 : 0.5;
        return '<div class="slider-row" data-id="' + it.ap.id + '">' +
          '<div class="top"><b>' + esc(it.ap.nombre) + '</b><span data-salida></span></div>' +
          '<input type="range" id="sim-' + it.ap.id + '" min="0" max="' + horas + '" step="' + paso + '" aria-label="Horas menos al día para ' + esc(it.ap.nombre) + '">' +
          '</div>';
      }).join('');
    }
    cont.querySelectorAll('.slider-row').forEach(function (fila) {
      const id = fila.dataset.id;
      const ap = estado.aparatos.find(function (a) { return a.id === id; });
      const r = estado.reducciones[id] || 0;
      const input = fila.querySelector('input');
      if (document.activeElement !== input) input.value = r;
      const horas = VC.horasDeUso(ap.rangos);
      const ahorroDia = VC.potenciaMedia(ap) * r / 1000;
      input.style.setProperty('--p', (horas > 0 ? r / horas * 100 : 0) + '%');
      input.setAttribute('aria-valuetext', r > 0 ? textoHoras(r) + ' menos al día' : 'sin cambios');
      fila.classList.toggle('activo', r > 0);
      fila.querySelector('[data-salida]').textContent = r > 0
        ? '−' + textoHoras(r) + ' · ahorra ' + fmt(ahorroDia, 2) + ' kWh/día'
        : 'usa ' + textoHoras(horas) + ' al día';
    });

    const nuevoDia = VC.energiaConReduccion(estado.aparatos, estado.reducciones);
    const nuevoPeriodo = nuevoDia * estado.periodo;
    const facNueva = VC.factura(nuevoPeriodo, estado.tarifa);
    const ahorro = c.factura.total - facNueva.total;
    let bloqueTxt = '';
    if (facNueva.bloque < c.factura.bloque) bloqueTxt = '<p>Bajarías del bloque ' + NOMBRES_BLOQUE[c.factura.bloque] + ' al de ' + NOMBRES_BLOQUE[facNueva.bloque] + '.</p>';
    $('#resultado-ahorro').innerHTML =
      '<h3>Resultado</h3>' +
      '<div class="compare">' +
      '<div><span class="k">Ahora</span><span class="v">' + fmt(c.periodoKwh, 0) + ' kWh</span><span class="rd">' + rd(c.factura.total, 0) + '</span></div>' +
      '<div><span class="k">Con los cambios</span><span class="v">' + fmt(nuevoPeriodo, 0) + ' kWh</span><span class="rd">' + rd(facNueva.total, 0) + '</span></div>' +
      '</div>' +
      '<div class="savings"><span class="k">Ahorro en ' + estado.periodo + ' días</span><span class="v">' + rd(ahorro, 0) + '</span><span class="sub">≈ ' + rd(ahorro * 365 / estado.periodo, 0) + ' al año · ' + fmt(c.periodoKwh - nuevoPeriodo, 0) + ' kWh menos</span></div>' +
      (ahorro === 0 ? '<p class="vacio-sim">Mueve alguna barra para ver el ahorro.</p>' : bloqueTxt);
    animarNumero('ahorro', $('#resultado-ahorro .savings .v'), ahorro, function (v) { return rd(v, 0); });
    renderEscenarios(c);
    const meta = $('#meta-valor');
    meta.placeholder = fmt(Math.max(0, Math.round(c.factura.total * 0.85 / 50) * 50), 0);

    // En el celular, el resultado queda fijo abajo mientras se mueven las barras.
    const barra = $('#barra-ahorro');
    barra.classList.toggle('con-ahorro', ahorro > 0);
    barra.innerHTML = ahorro > 0
      ? '<span>Ahorras en ' + estado.periodo + ' días<br>≈ ' + rd(ahorro * 365 / estado.periodo, 0) + ' al año</span><b>' + rd(ahorro, 0) + '</b>'
      : '<span>Factura actual<br>Mueve una barra para ahorrar</span><b>' + rd(c.factura.total, 0) + '</b>';
  }

  function textoHoras(h) {
    if (h < 1) return fmt(h * 60, 0) + ' min';
    const ent = Math.floor(h), min = Math.round((h - ent) * 60);
    return ent + ' h' + (min ? ' ' + min + ' min' : '');
  }

  // ---------- consejos ----------
  let consejosActuales = [];
  function renderConsejos() {
    consejosActuales = VC.consejosAhorro(estado.aparatos, estado.tarifa, estado.periodo, D.ALTERNATIVAS);
    const cont = $('#consejos');
    if (!estado.aparatos.length) { cont.innerHTML = '<p class="empty">Agrega aparatos para ver consejos.</p>'; return; }
    const lista = consejosActuales.map(function (k, i) {
      return '<div class="consejo">' +
        '<div class="consejo-texto"><b>' + esc(k.texto) + '</b><small>' + esc(k.nombre) + ' → ' + esc(k.nuevo.nombre) + ' · ' + fmt(k.menosKwhDia, 2) + ' kWh menos al día</small></div>' +
        '<div class="consejo-ahorro"><b>−' + rd(k.ahorroRD, 0) + '</b><small>cada ' + estado.periodo + ' días · ≈ ' + rd(k.ahorroRD * 365 / estado.periodo, 0) + ' al año</small></div>' +
        '<button class="btn small" type="button" data-consejo="' + i + '">Aplicar cambio</button>' +
        '</div>';
    }).join('');
    cont.innerHTML = (lista || '<p class="consejo-vacio">Tus aparatos ya son de los eficientes de la lista.</p>') +
      '<p class="consejo-horas">También puedes ahorrar usándolos menos horas: <a href="#ahorro">prueba el simulador</a>.</p>';
  }

  // ---------- escenarios del simulador ----------
  function nombreEscenario(reducciones) {
    const partes = Object.keys(reducciones).filter(function (id) { return reducciones[id] > 0; }).map(function (id) {
      const ap = estado.aparatos.find(function (a) { return a.id === id; });
      return ap ? { nombre: ap.nombre.replace(/ \d[\d,.]*\s*BTU.*$/i, ''), h: reducciones[id], kwh: VC.potenciaMedia(ap) * reducciones[id] } : null;
    }).filter(Boolean).sort(function (a, b) { return b.kwh - a.kwh; });
    if (!partes.length) return 'Sin cambios';
    const texto = partes.slice(0, 2).map(function (p) { return p.nombre + ' −' + textoHoras(p.h); }).join(', ');
    return texto + (partes.length > 2 ? ' y ' + (partes.length - 2) + ' más' : '');
  }
  function ahorroDe(reducciones, c) {
    const valido = {};
    Object.keys(reducciones).forEach(function (id) {
      const ap = estado.aparatos.find(function (a) { return a.id === id; });
      if (ap) valido[id] = Math.min(reducciones[id], VC.horasDeUso(ap.rangos));
    });
    const nueva = VC.factura(VC.energiaConReduccion(estado.aparatos, valido) * estado.periodo, estado.tarifa).total;
    return c.factura.total - nueva;
  }
  function renderEscenarios(c) {
    const cont = $('#lista-escenarios');
    if (!estado.escenarios.length) {
      cont.innerHTML = '<p class="nota">Guarda combinaciones de cambios para compararlas.</p>';
      return;
    }
    const ahorros = estado.escenarios.map(function (e) { return ahorroDe(e.reducciones, c); });
    const mejor = Math.max.apply(null, ahorros);
    cont.innerHTML = estado.escenarios.map(function (e, i) {
      return '<div class="escenario">' +
        '<div><b>' + esc(e.nombre) + '</b>' + (ahorros[i] === mejor && estado.escenarios.length > 1 && mejor > 0 ? ' <span class="pill good">Mayor ahorro</span>' : '') +
        '<small>Ahorra ' + rd(ahorros[i], 0) + ' cada ' + estado.periodo + ' días</small></div>' +
        '<div class="escenario-acciones"><button class="btn small" type="button" data-escenario="' + esc(e.id) + '" data-accion="aplicar">Aplicar</button>' +
        '<button class="btn small ghost danger" type="button" data-escenario="' + esc(e.id) + '" data-accion="borrar" aria-label="Borrar ' + esc(e.nombre) + '">Borrar</button></div>' +
        '</div>';
    }).join('');
  }

  // ---------- facturas reales ----------
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(mes) { return MESES_LARGOS[+mes.slice(5, 7) - 1] + ' ' + mes.slice(0, 4); }
  function renderFacturas(c) {
    const cont = $('#lista-facturas');
    const lista = estado.facturas.slice().sort(function (a, b) { return a.mes < b.mes ? 1 : -1; });
    if (!lista.length) { cont.innerHTML = ''; return; }
    let filas = '<tr><th>Mes</th><th class="r">kWh</th><th class="r">Pagaste</th><th class="r">Con la tarifa de la app</th><th class="r">Diferencia</th><th></th></tr>';
    lista.forEach(function (f) {
      const cmp = VC.compararFactura(f.kwh, f.monto, estado.tarifa);
      const tipo = Math.abs(cmp.porcentaje) < 5 ? 'good' : Math.abs(cmp.porcentaje) < 15 ? 'warn' : 'crit';
      filas += '<tr><td>' + nombreMes(f.mes) + '</td><td class="r">' + fmt(f.kwh, 0) + '</td><td class="r">' + rd(f.monto, 0) + '</td><td class="r">' + rd(cmp.calculado, 0) + '</td>' +
        '<td class="r"><span class="pill ' + tipo + '">' + (cmp.diferencia >= 0 ? '+' : '−') + fmt(Math.abs(cmp.porcentaje), 0) + ' %</span></td>' +
        '<td class="r"><button class="btn small ghost danger" type="button" data-mes="' + f.mes + '" aria-label="Borrar factura de ' + nombreMes(f.mes) + '">Borrar</button></td></tr>';
    });
    const promedio = lista.reduce(function (s, f) { return s + f.kwh; }, 0) / lista.length;
    const cubre = promedio > 0 ? c.periodoKwh / promedio * 100 : 0;
    const peor = lista.map(function (f) { return Math.abs(VC.compararFactura(f.kwh, f.monto, estado.tarifa).porcentaje); }).reduce(function (a, b) { return Math.max(a, b); }, 0);
    cont.innerHTML = '<div class="tabla-scroll"><table class="tabla-facturas">' + filas + '</table></div>' +
      '<p class="facturas-resumen">En promedio tus facturas marcan <b>' + fmt(promedio, 0) + ' kWh</b>. Tus aparatos registrados estiman <b>' + fmt(c.periodoKwh, 0) + ' kWh</b>, es decir, el <b>' + fmt(cubre, 0) + ' %</b>' +
      (cubre < 85 ? '. Puede que falten aparatos o que algunos se usen más horas.' : cubre > 115 ? '. Quizás algún horario es más largo de lo real.' : ': la estimación se parece a la realidad.') +
      (peor >= 5 ? ' Si la diferencia en RD$ es grande, revisa los precios en <a href="#tarifa">Tarifa</a>.' : '') + '</p>';
  }

  // ---------- tarifa ----------
  function renderTarifa() {
    const t = estado.tarifa;
    for (let i = 0; i < 4; i++) { const el = $('#t-' + i); if (document.activeElement !== el) el.value = t.bloques[i].precio; }
    if (document.activeElement !== $('#t-fijo')) $('#t-fijo').value = t.cargoFijo;
    if (document.activeElement !== $('#t-periodo')) $('#t-periodo').value = estado.periodo;
    $('#t-todo').checked = t.ultimoBloqueATodo;
    $('#t-itbis').checked = t.itbisSobreUmbral;
  }

  // ---------- render general ----------
  let ultimoCalculo = null;
  function renderTodo() {
    const c = calcular();
    ultimoCalculo = c;
    $('#aviso-ejemplo').hidden = !estado.ejemplo;
    $('#origen-lecturas').hidden = !estado.lecturasEjemplo;
    $('#btn-quitar-todos').disabled = !estado.aparatos.length;
    renderResumen(c);
    renderAparatos(c);
    renderCurva(c);
    renderLecturaCurva(c);
    renderBarras(c);
    renderMedidor(c);
    renderLecturas();
    renderAhorro(c);
    renderConsejos();
    renderFacturas(c);
    renderTarifa();
    guardar();
  }

  // Barras horizontales que crecen desde cero (al abrir una sección o un desplegable).
  function crecerBarras(selector) {
    if (sinMovimiento) return;
    const barras = Array.from(document.querySelectorAll(selector));
    barras.forEach(function (b) { b.dataset.ancho = b.style.width; b.style.transition = 'none'; b.style.width = '0'; });
    void document.body.offsetWidth;
    requestAnimationFrame(function () {
      barras.forEach(function (b, i) { b.style.transition = ''; b.style.transitionDelay = Math.min(i * 30, 300) + 'ms'; b.style.width = b.dataset.ancho; });
    });
  }

  // ---------- modo exposición ----------
  // Recorrido de 7 pasos para presentar el proyecto con los datos del hogar actual.
  function iniciarExposicion() {
    const dlg = $('#expo');
    const contenido = $('#expo-contenido');
    let paso = 0;
    let c = null;
    let reloj = null;
    let reproduciendo = true;

    function picoDelDia(aparatos) {
      let mejor = { t: 0, p: 0 };
      for (let t = 0; t < 24; t += 1 / 12) { const p = VC.potenciaEn(t, aparatos); if (p > mejor.p) mejor = { t: t, p: p }; }
      return mejor;
    }

    const PASOS = [
      function () {
        return '<p class="expo-etiqueta">El problema</p><h2 id="expo-titulo">¿Por qué sube tanto la factura de la luz?</h2>' +
          '<div class="expo-cifra">' + rd(c.factura.total, 0) + '</div>' +
          '<p class="expo-sub">Factura estimada de este hogar: ' + fmt(c.periodoKwh, 0) + ' kWh en ' + estado.periodo + ' días con ' + estado.aparatos.length + ' aparatos.</p>' +
          '<p class="expo-texto">VoltiControl usa el Cálculo Integral para responder dos preguntas: <b>¿cuánta energía consume la casa?</b> y <b>¿cuánto cuesta?</b></p>';
      },
      function () {
        const pico = picoDelDia(estado.aparatos);
        const top = c.porAparato[0];
        return '<p class="expo-etiqueta">Paso 1 · La función</p><h2 id="expo-titulo">La potencia P(t) cambia durante el día</h2>' +
          '<div class="chart expo-grafica" id="expo-grafica"></div>' +
          '<p class="expo-texto">P(t) es la suma de lo que consume cada aparato encendido a la hora t. El pico es a las <b>' + VC.formatoHora(pico.t) + '</b> con <b>' + fmt(pico.p / 1000, 2) + ' kW</b>' +
          (top ? '; el que más pesa es <b>' + esc(top.ap.nombre) + '</b>.' : '.') + '</p>';
      },
      function () {
        return '<p class="expo-etiqueta">Paso 2 · La integral</p><h2 id="expo-titulo">La energía es el área bajo la curva</h2>' +
          '<div class="chart expo-grafica" id="expo-grafica"></div>' +
          '<div class="expo-formula">E = ∫<sub>0</sub><sup>24</sup> P(t) dt = <b>' + fmt(c.diaria, 2) + ' kWh</b></div>' +
          '<p class="expo-texto">Cada aparato consume potencia constante mientras está encendido, así que el área exacta es una suma de rectángulos: potencia × horas.</p>';
      },
      function () {
        return '<p class="expo-etiqueta">Paso 3 · Integración numérica</p><h2 id="expo-titulo">Regla del trapecio</h2>' +
          '<div class="chart expo-grafica" id="expo-grafica"></div>' +
          '<div class="expo-trap"><div><span>n</span><b id="expo-n">4</b></div><div><span>Tₙ</span><b id="expo-tn"></b></div><div><span>Error</span><b id="expo-err"></b></div>' +
          '<button class="btn small" type="button" id="expo-pausa">Pausa</button></div>' +
          '<p class="expo-texto">T<sub>n</sub> = h/2 [P(t<sub>0</sub>) + 2P(t<sub>1</sub>) + … + P(t<sub>n</sub>)], con h = 24/n. Al subir n, los trapecios siguen mejor la curva y el error baja.</p>';
      },
      function () {
        const f = c.factura;
        const filas = f.lineas.map(function (l) {
          const nombre = l.hasta === null && l.desde === 0 ? 'Todo el consumo' : (l.desde === 0 ? '0' : l.desde + 1) + (l.hasta === null ? '+' : '–' + l.hasta) + ' kWh';
          return '<tr><td>' + nombre + '</td><td class="r">' + fmt(l.kwh, 1) + ' × ' + fmt(l.precio, 2) + '</td><td class="r">' + rd(l.monto, 0) + '</td></tr>';
        }).join('');
        return '<p class="expo-etiqueta">Paso 4 · Función por partes</p><h2 id="expo-titulo">Del día al mes, y la tarifa por bloques</h2>' +
          '<div class="expo-formula">' + fmt(c.diaria, 2) + ' kWh/día × ' + estado.periodo + ' días = <b>' + fmt(c.periodoKwh, 0) + ' kWh</b></div>' +
          '<table class="expo-tabla">' + filas + '<tr><td>Cargo fijo' + (f.itbis > 0 ? ' + ITBIS' : '') + '</td><td></td><td class="r">' + rd(f.cargoFijo + f.itbis, 0) + '</td></tr>' +
          '<tr class="total"><td>Total</td><td></td><td class="r">' + rd(f.total, 0) + '</td></tr></table>' +
          '<p class="expo-texto">Cada bloque de kWh tiene su propio precio: mientras más se consume, más caro sale cada kWh adicional.</p>';
      },
      function () {
        const p = c.proy;
        return '<p class="expo-etiqueta">Paso 5 · La derivada</p><h2 id="expo-titulo">El contador: el ritmo es la pendiente</h2>' +
          '<div class="chart expo-grafica" id="expo-medidor"></div>' +
          (p ? '<p class="expo-texto">Las lecturas son la energía acumulada. Su pendiente (recta de mínimos cuadrados) es el ritmo: <b>' + fmt(p.ritmo, 2) + ' kWh por día</b>. Con ella se proyectan <b>' + fmt(p.total, 0) + ' kWh</b> al cerrar el período.</p>'
            : '<p class="expo-texto">Con dos o más lecturas del contador se calcula el ritmo diario (la pendiente) y se proyecta el cierre del período.</p>');
      },
      function () {
        const k = VC.consejosAhorro(estado.aparatos, estado.tarifa, estado.periodo, D.ALTERNATIVAS)[0];
        const aire = estado.aparatos.find(function (a) { return /aire/i.test(a.nombre) && VC.horasDeUso(a.rangos) >= 2; });
        let horas = '';
        if (aire) {
          const r = {}; r[aire.id] = 2;
          const nueva = VC.factura(VC.energiaConReduccion(estado.aparatos, r) * estado.periodo, estado.tarifa).total;
          horas = '<li><b>−' + rd(c.factura.total - nueva, 0) + '</b> usando el ' + esc(aire.nombre.replace(/ \d[\d,.]*\s*BTU.*$/i, '').toLowerCase()) + ' 2 horas menos al día</li>';
        }
        return '<p class="expo-etiqueta">Conclusión</p><h2 id="expo-titulo">¿Cuánto se puede ahorrar?</h2>' +
          '<ul class="expo-lista">' + horas + (k ? '<li><b>−' + rd(k.ahorroRD, 0) + '</b> si se hace este cambio: ' + esc(k.texto.toLowerCase()) + '</li>' : '') +
          '<li>Con el simulador se prueba cualquier combinación y se fija una meta de factura.</li></ul>' +
          '<p class="expo-creditos">Proyecto innovador de Cálculo Integral, sección 4 · ITLA<br>Leonardo Pérez · Randy Benítez · Eddian Hernández · Diego Martinez</p>';
      }
    ];

    function detenerReloj() { clearInterval(reloj); reloj = null; }

    function animarTrapecios() {
      let i = 0;
      const grafica = $('#expo-grafica');
      function mostrar() {
        const n = N_VALORES[i];
        dibujarCurva(grafica, c, { n: n, trapecios: true, interactivo: false, alto: alturaGrafica() });
        const aprox = VC.energiaTrapecio(estado.aparatos, n);
        const err = c.diaria > 0 ? (aprox - c.diaria) / c.diaria * 100 : 0;
        $('#expo-n').textContent = n;
        $('#expo-tn').textContent = fmt(aprox, 3) + ' kWh';
        $('#expo-err').textContent = (err >= 0 ? '+' : '−') + fmt(Math.abs(err), 1) + ' %';
      }
      function avanzar() { i = (i + 1) % N_VALORES.length; mostrar(); }
      mostrar();
      const boton = $('#expo-pausa');
      function arrancar() { detenerReloj(); reloj = setInterval(avanzar, 1300); boton.textContent = 'Pausa'; }
      // Con "reducir movimiento" no hay avance automático: el botón pasa a la siguiente n.
      if (sinMovimiento) { boton.textContent = 'Siguiente n'; boton.addEventListener('click', avanzar); return; }
      boton.addEventListener('click', function () {
        reproduciendo = !reproduciendo;
        if (reproduciendo) arrancar(); else { detenerReloj(); boton.textContent = 'Seguir'; }
      });
      if (reproduciendo) arrancar(); else boton.textContent = 'Seguir';
    }

    function alturaGrafica() { return Math.max(220, Math.min(380, window.innerHeight * 0.42)); }

    function mostrarPaso(nuevo) {
      detenerReloj();
      paso = Math.max(0, Math.min(PASOS.length - 1, nuevo));
      contenido.innerHTML = '<div class="expo-paso">' + PASOS[paso]() + '</div>';
      $('#expo-progreso').textContent = (paso + 1) + ' / ' + PASOS.length;
      $('#expo-anterior').disabled = paso === 0;
      $('#expo-siguiente').textContent = paso === PASOS.length - 1 ? 'Terminar' : 'Siguiente →';
      $('#expo-puntos').querySelectorAll('button').forEach(function (b, i) { b.setAttribute('aria-selected', i === paso ? 'true' : 'false'); });
      const g = $('#expo-grafica');
      if (g && paso === 3) animarTrapecios();
      else if (g) dibujarCurva(g, c, { n: 4, trapecios: false, interactivo: false, animar: paso === 2, alto: alturaGrafica() });
      const med = $('#expo-medidor');
      if (med) dibujarMedidor(med, c, { interactivo: false, animar: true, alto: alturaGrafica() });
    }

    $('#expo-puntos').innerHTML = PASOS.map(function (_, i) {
      return '<button type="button" role="tab" aria-label="Paso ' + (i + 1) + '" data-paso="' + i + '"></button>';
    }).join('');
    $('#expo-puntos').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-paso]');
      if (b) mostrarPaso(+b.dataset.paso);
    });
    $('#expo-anterior').addEventListener('click', function () { mostrarPaso(paso - 1); });
    $('#expo-siguiente').addEventListener('click', function () {
      if (paso === PASOS.length - 1) cerrar(); else mostrarPaso(paso + 1);
    });
    $('#expo-cerrar').addEventListener('click', cerrar);
    dlg.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('input')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); mostrarPaso(paso + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); mostrarPaso(paso - 1); }
    });
    dlg.addEventListener('close', function () {
      detenerReloj();
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    });

    function abrir() {
      c = calcular();
      reproduciendo = true;
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      if (document.documentElement.requestFullscreen && window.innerWidth > 780) {
        document.documentElement.requestFullscreen().catch(function () { /* sin pantalla completa */ });
      }
      mostrarPaso(0);
      $('#expo-siguiente').focus();
    }
    function cerrar() {
      if (typeof dlg.close === 'function') dlg.close(); else { dlg.removeAttribute('open'); detenerReloj(); }
    }
    document.querySelectorAll('[data-expo]').forEach(function (b) { b.addEventListener('click', abrir); });
    window.addEventListener('resize', function () { if (dlg.open && paso !== 3) mostrarPaso(paso); });
  }

  // ---------- eventos ----------
  function iniciar() {

    llenarCatalogo();

    // Muestra una sección. Funciona con clics aunque el archivo se abra desde
    // WhatsApp o la carpeta de descargas del celular, donde cambiar location.hash puede fallar.
    function leerHash() {
      try { return location.hash.slice(1); } catch (e) { return ''; }
    }
    function irA(id) {
      navegar(true, id);
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* sin historial disponible */ }
    }
    document.addEventListener('click', function (e) {
      const enlace = e.target.closest('a[href^="#"]');
      if (!enlace) return;
      const id = enlace.getAttribute('href').slice(1);
      if (!id || !document.getElementById(id)) return;
      e.preventDefault();
      irA(id);
    });

    function navegar(enfocar, pedido) {
      const hash = pedido !== undefined ? pedido : leerHash();
      const destino = hash === 'curva' ? 'resumen' : hash;
      const secciones = Array.from(document.querySelectorAll('main > section'));
      const activa = secciones.find(function (s) { return s.id === destino; }) || secciones[0];
      secciones.forEach(function (s) { s.hidden = s !== activa; });
      document.querySelectorAll('.nav a').forEach(function (a) {
        if (a.getAttribute('href') === '#' + activa.id) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      if (hash === 'curva') $('#curva').open = true;
      if (enfocar) {
        window.scrollTo(0, 0);
        const titulo = activa.querySelector('h1, h2');
        titulo.tabIndex = -1;
        titulo.focus({ preventScroll: true });
        // cambio de sección suave (el CSS lo desactiva si se pidió menos movimiento)
        activa.classList.remove('entrando');
        void activa.offsetWidth;
        activa.classList.add('entrando');
      }
      // al entrar a una sección, sus gráficas se dibujan con animación
      if (ultimoCalculo) {
        if (activa.id === 'resumen') renderCurva(ultimoCalculo, true);
        if (activa.id === 'medidor') renderMedidor(ultimoCalculo, true);
        if (activa.id === 'aparatos') crecerBarras('#lista-aparatos .mini i');
      }
    }
    window.addEventListener('hashchange', function () { navegar(true); });
    navegar(false);


    document.querySelectorAll('main > section').forEach(function (s) {
      s.addEventListener('animationend', function () { s.classList.remove('entrando'); });
    });

    $('#f-catalogo').addEventListener('change', function (e) { elegirDelCatalogo(e.target.value); });

    ['#f-nombre', '#f-watts', '#f-cantidad', '#f-horario'].forEach(function (s) {
      $(s).addEventListener('input', actualizarVistaPrevia);
    });

    $('#form-aparato').addEventListener('submit', function (e) {
      e.preventDefault();
      const r = leerFormulario();
      $('#f-watts').classList.toggle('invalid', !(r.datos.watts > 0));
      $('#f-horario').classList.toggle('invalid', !r.datos.rangos);
      $('#f-nombre').classList.toggle('invalid', !r.datos.nombre);
      if (r.errores.length) { $('#f-error').textContent = r.errores[0]; return; }
      const datos = Object.assign({}, r.datos, { ciclo: Math.min(1, r.datos.ciclo) });
      if (editandoId) {
        const i = estado.aparatos.findIndex(function (a) { return a.id === editandoId; });
        if (i >= 0) estado.aparatos[i] = aparatoDesde(Object.assign({ id: editandoId }, datos));
        anunciar('Cambios guardados en ' + datos.nombre + '.');
      } else {
        estado.aparatos.push(aparatoDesde(datos));
        anunciar(datos.nombre + ' agregado.');
      }
      marcarEditado();
      cerrarEditor();
      limpiarFormulario();
      renderTodo();
      $('#btn-agregar').focus();
    });


    $('#f-cancelar').addEventListener('click', cerrarEditor);
    $('#cerrar-editor').addEventListener('click', cerrarEditor);
    $('#editor').addEventListener('close', alCerrarEditor);
    $('#btn-agregar').addEventListener('click', function () {
      limpiarFormulario();
      abrirEditor();
      $('#f-catalogo').focus();
    });
    // Menú "Más opciones": acciones sobre toda la lista. En vez de pedir confirmación,
    // se pueden deshacer desde el aviso que aparece abajo.
    const menu = $('#menu-aparatos');
    document.addEventListener('click', function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
      const ej = $('#aviso-ejemplo');
      if (ej.open && !ej.contains(e.target)) ej.open = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
      if ($('#aviso-ejemplo').open) $('#aviso-ejemplo').open = false;
    });
    $('#btn-quitar-todos').addEventListener('click', function () {
      menu.open = false;
      conDeshacer('Se quitaron todos los aparatos.', function () {
        estado.aparatos = [];
        estado.reducciones = {};
        marcarEditado();
      });
      $('#btn-agregar').focus();
    });
    $('#btn-restaurar-aparatos').addEventListener('click', function () {
      menu.open = false;
      conDeshacer('Se cargaron los 12 aparatos del ejemplo.', function () {
        estado.aparatos = D.EJEMPLO_APARATOS.map(aparatoDesde);
        estado.reducciones = {};
      });
    });

    $('#agregar-intervalo').addEventListener('click', function () {
      agregarIntervalo($('#intervalos-extra'), '', '', true).focus();
      actualizarVistaPrevia();
    });
    $('#f-todo-dia').addEventListener('input', function () {
      mostrarHorario();
      actualizarVistaPrevia();
    });


    $('#lista-aparatos').addEventListener('click', function (e) {
      const atajo = e.target.closest('button[data-catalogo]');
      if (atajo) {
        limpiarFormulario();
        abrirEditor();
        $('#f-catalogo').value = atajo.dataset.catalogo;
        elegirDelCatalogo(atajo.dataset.catalogo);
        if (atajo.dataset.catalogo !== 'otro') $('#f-guardar').focus();
        return;
      }
      const btn = e.target.closest('button[data-accion]');
      if (!btn) return;
      const id = btn.closest('.row').dataset.id;
      if (btn.dataset.accion === 'editar') editarAparato(id);
      else {
        const ap = estado.aparatos.find(function (a) { return a.id === id; });
        conDeshacer((ap ? ap.nombre : 'Aparato') + ' quitado.', function () {
          estado.aparatos = estado.aparatos.filter(function (a) { return a.id !== id; });
          delete estado.reducciones[id];
          if (editandoId === id) limpiarFormulario();
          marcarEditado();
        });
        $('#btn-agregar').focus();
      }
    });

    $('#n-slider').addEventListener('input', function (e) {
      estado.nIndice = +e.target.value;
      renderCurva(ultimoCalculo);
      renderLecturaCurva(ultimoCalculo);
      guardar();
    });
    $('#mostrar-trap').addEventListener('change', function (e) {
      estado.trapecios = e.target.checked;
      renderCurva(ultimoCalculo);
      renderLecturaCurva(ultimoCalculo);
      guardar();
    });

    // lecturas
    // Valida y guarda una lectura. Devuelve el texto del error, o '' si se guardó.
    function guardarLectura(fecha, valor) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Elige la fecha de la lectura.';
      if (!(valor >= 0)) return 'Escribe el número que marca el contador.';
      const otras = estado.lecturas.filter(function (l) { return l.fecha !== fecha; });
      const antes = otras.filter(function (l) { return l.fecha < fecha; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }).pop();
      const despues = otras.filter(function (l) { return l.fecha > fecha; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })[0];
      if (antes && valor < antes.valor) return 'La lectura no puede ser menor que la del ' + fechaCorta(antes.fecha) + ' (' + fmt(antes.valor, 1) + '). El contador solo sube.';
      if (despues && valor > despues.valor) return 'La lectura no puede ser mayor que la del ' + fechaCorta(despues.fecha) + ' (' + fmt(despues.valor, 1) + ').';
      otras.push({ fecha: fecha, valor: valor });
      estado.lecturas = otras;
      actualizarOrigenLecturas();
      marcarEditado();
      return '';
    }

    $('#l-fecha').value = hoyISO();
    $('#form-lectura').addEventListener('submit', function (e) {
      e.preventDefault();
      const fecha = $('#l-fecha').value;
      const previo = clonar(estado);
      const error = guardarLectura(fecha, parseFloat($('#l-valor').value));
      $('#l-error').textContent = error;
      if (error) return;
      $('#l-valor').value = '';
      $('#l-fecha').value = sumarDias(fecha, 1);
      renderTodo();
      mostrarAviso('Lectura del ' + fechaCorta(fecha) + ' guardada.', deshacerA(previo));
    });

    // Lectura rápida desde el Resumen (siempre con la fecha de hoy).
    $('#form-lectura-rapida').addEventListener('submit', function (e) {
      e.preventDefault();
      const previo = clonar(estado);
      const error = guardarLectura(hoyISO(), parseFloat($('#lr-valor').value));
      $('#lr-error').textContent = error;
      $('#lr-valor').classList.toggle('invalid', !!error);
      if (error) return;
      $('#lr-valor').value = '';
      renderTodo();
      mostrarAviso('Lectura de hoy guardada.', deshacerA(previo));
    });

    $('#lista-lecturas').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-fecha]');
      if (!btn) return;
      conDeshacer('Lectura del ' + fechaCorta(btn.dataset.fecha) + ' borrada.', function () {
        estado.lecturas = estado.lecturas.filter(function (l) { return l.fecha !== btn.dataset.fecha; });
        actualizarOrigenLecturas();
        marcarEditado();
      });
    });

    // simulador
    $('#sliders').addEventListener('input', function (e) {
      if (e.target.type !== 'range') return;
      const id = e.target.closest('.slider-row').dataset.id;
      estado.reducciones[id] = +e.target.value;
      renderAhorro(ultimoCalculo);
      guardar();
    });
    $('#btn-reiniciar-sim').addEventListener('click', function () {
      estado.reducciones = {};
      document.querySelectorAll('#sliders input').forEach(function (i) { i.value = 0; });
      renderAhorro(ultimoCalculo);
      guardar();
    });
    $('#btn-aire').addEventListener('click', function () {
      estado.reducciones = {};
      estado.aparatos.filter(function (a) { return /aire/i.test(a.nombre); }).forEach(function (a) {
        estado.reducciones[a.id] = Math.min(2, VC.horasDeUso(a.rangos));
      });
      document.querySelectorAll('#sliders input').forEach(function (i) { i.value = estado.reducciones[i.closest('.slider-row').dataset.id] || 0; });
      renderAhorro(ultimoCalculo);
      guardar();
    });

    // tarifa
    function leerTarifa() {
      for (let i = 0; i < 4; i++) {
        const v = parseFloat($('#t-' + i).value);
        if (v >= 0) estado.tarifa.bloques[i].precio = v;
      }
      const fijo = parseFloat($('#t-fijo').value);
      if (fijo >= 0) estado.tarifa.cargoFijo = fijo;
      const per = parseInt($('#t-periodo').value, 10);
      if (per >= 1 && per <= 62) estado.periodo = per;
      estado.tarifa.ultimoBloqueATodo = $('#t-todo').checked;
      estado.tarifa.itbisSobreUmbral = $('#t-itbis').checked;
      renderTodo();
    }
    ['#t-0', '#t-1', '#t-2', '#t-3', '#t-fijo', '#t-periodo'].forEach(function (s) { $(s).addEventListener('input', leerTarifa); });
    ['#t-todo', '#t-itbis'].forEach(function (s) { $(s).addEventListener('change', leerTarifa); });
    $('#btn-tarifa-ref').addEventListener('click', function () {
      conDeshacer('Tarifa de referencia restaurada.', function () {
        estado.tarifa = clonar(D.TARIFA);
        estado.periodo = 30;
      });
    });

    // aviso de ejemplo
    $('#btn-limpiar').addEventListener('click', function () {
      $('#aviso-ejemplo').open = false;
      conDeshacer('Empezaste desde cero.', function () {
        estado.aparatos = [];
        estado.lecturas = [];
        estado.lecturasEjemplo = false;
        estado.reducciones = {};
        estado.ejemplo = false;
        limpiarFormulario();
      });
      irA('aparatos');
    });
    $('#btn-ocultar-aviso').addEventListener('click', function () {
      estado.ejemplo = false;
      renderTodo();
    });

    // aviso flotante
    $('#toast-deshacer').addEventListener('click', function () {
      const accion = accionDeshacer;
      ocultarAviso();
      if (accion) accion();
    });

    // ---------- tema claro / oscuro ----------
    const consultaOscuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function temaActual() {
      const t = document.documentElement.getAttribute('data-theme');
      if (t === 'light' || t === 'dark') return t;
      return consultaOscuro && consultaOscuro.matches ? 'dark' : 'light';
    }
    function pintarBotonTema() {
      const oscuro = temaActual() === 'dark';
      const b = $('#btn-tema');
      b.classList.toggle('oscuro', oscuro);
      $('#tema-texto').textContent = oscuro ? 'Modo claro' : 'Modo oscuro';
      b.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }
    $('#btn-tema').addEventListener('click', function () {
      const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nuevo);
      try { localStorage.setItem('volticontrol.tema', nuevo); } catch (e) { /* sin almacenamiento */ }
      pintarBotonTema();
    });
    if (consultaOscuro && consultaOscuro.addEventListener) consultaOscuro.addEventListener('change', pintarBotonTema);
    pintarBotonTema();

    // ---------- compartir el hogar con un enlace ----------
    function aBase64Url(texto) {
      const bytes = new TextEncoder().encode(texto);
      let bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function deBase64Url(texto) {
      const b64 = texto.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      return new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }));
    }
    function codificarHogar() {
      return aBase64Url(JSON.stringify({
        v: 1,
        a: estado.aparatos.map(function (a) { return [a.nombre, a.watts, a.cantidad, a.ciclo, a.horario]; }),
        t: [estado.tarifa.bloques.map(function (b) { return b.precio; }), estado.tarifa.cargoFijo, estado.tarifa.ultimoBloqueATodo ? 1 : 0, estado.tarifa.itbisSobreUmbral ? 1 : 0],
        d: estado.periodo,
        l: estado.lecturas.map(function (l) { return [l.fecha, l.valor]; })
      }));
    }
    // Lee un hogar compartido. Todo se valida: el enlace puede venir de cualquiera.
    function decodificarHogar(texto) {
      try {
        const d = JSON.parse(deBase64Url(texto));
        if (!d || d.v !== 1 || !Array.isArray(d.a)) return null;
        const aparatos = d.a.slice(0, 100).filter(Array.isArray).map(function (x) {
          return aparatoDesde({ nombre: String(x[0] || 'Aparato').slice(0, 60), watts: x[1], cantidad: x[2], ciclo: x[3], horario: String(x[4] || '').slice(0, 120) });
        }).filter(function (a) { return a.rangos && a.watts > 0 && a.watts <= 20000; });
        const tarifa = clonar(D.TARIFA);
        if (Array.isArray(d.t) && Array.isArray(d.t[0]) && d.t[0].length === 4) {
          d.t[0].forEach(function (p, i) { if (+p >= 0) tarifa.bloques[i].precio = +p; });
          if (+d.t[1] >= 0) tarifa.cargoFijo = +d.t[1];
          tarifa.ultimoBloqueATodo = !!d.t[2];
          tarifa.itbisSobreUmbral = !!d.t[3];
        }
        const lecturas = Array.isArray(d.l) ? d.l.slice(0, 400).filter(function (x) {
          return Array.isArray(x) && /^\d{4}-\d{2}-\d{2}$/.test(x[0]) && isFinite(x[1]) && +x[1] >= 0;
        }).map(function (x) { return { fecha: x[0], valor: +x[1] }; }) : [];
        const periodo = d.d >= 1 && d.d <= 62 ? Math.round(d.d) : 30;
        return { aparatos: aparatos, tarifa: tarifa, lecturas: lecturas, periodo: periodo };
      } catch (e) {
        return null;
      }
    }
    function enlaceBase() { return location.href.split(/[?#]/)[0]; }
    $('#btn-compartir').addEventListener('click', function () {
      const url = enlaceBase() + '?hogar=' + codificarHogar();
      if (navigator.share) {
        navigator.share({ title: 'VoltiControl', text: 'Mira el consumo eléctrico de este hogar en VoltiControl', url: url }).catch(function () { /* cancelado */ });
        return;
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(function () {
          mostrarAviso('Enlace copiado. Pégalo en WhatsApp o donde quieras.');
        }, function () { window.prompt('Copia este enlace:', url); });
      } else {
        window.prompt('Copia este enlace:', url);
      }
    });

    function quitarParametroHogar() {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* sin historial */ }
    }
    let compartido = null;
    try {
      const codigo = new URLSearchParams(location.search).get('hogar');
      if (codigo) compartido = decodificarHogar(codigo);
      if (codigo && !compartido) { quitarParametroHogar(); mostrarAviso('El enlace compartido está incompleto o dañado.'); }
    } catch (e) { compartido = null; }
    if (compartido) {
      $('#aviso-compartido-texto').textContent = 'Te compartieron un hogar con ' + compartido.aparatos.length + ' aparato' + (compartido.aparatos.length === 1 ? '' : 's') +
        (compartido.lecturas.length ? ' y ' + compartido.lecturas.length + ' lecturas' : '') + '. Si lo abres, podrás volver a tus datos con "Deshacer".';
      $('#aviso-compartido').hidden = false;
    }
    $('#btn-cargar-compartido').addEventListener('click', function () {
      if (!compartido) return;
      const datos = compartido;
      $('#aviso-compartido').hidden = true;
      quitarParametroHogar();
      conDeshacer('Estás viendo el hogar compartido.', function () {
        estado.aparatos = datos.aparatos;
        estado.tarifa = datos.tarifa;
        estado.lecturas = datos.lecturas;
        estado.periodo = datos.periodo;
        estado.reducciones = {};
        estado.ejemplo = false;
        actualizarOrigenLecturas();
      });
      irA('resumen');
    });
    $('#btn-ignorar-compartido').addEventListener('click', function () {
      $('#aviso-compartido').hidden = true;
      quitarParametroHogar();
    });

    // ---------- imprimir / guardar en PDF ----------
    let antesDeImprimirEstado = null;
    function prepararImpresion() {
      if (antesDeImprimirEstado) return;
      $('#fecha-impresion').textContent = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
      const secciones = Array.from(document.querySelectorAll('main > section'));
      antesDeImprimirEstado = {
        ocultas: secciones.filter(function (s) { return s.hidden; }),
        cerradas: Array.from(document.querySelectorAll('details.desplegable:not([open])'))
      };
      secciones.forEach(function (s) { s.hidden = false; });
      antesDeImprimirEstado.cerradas.forEach(function (d) { d.open = true; });
      renderCurva(ultimoCalculo);
      renderMedidor(ultimoCalculo);
    }
    function terminarImpresion() {
      if (!antesDeImprimirEstado) return;
      antesDeImprimirEstado.ocultas.forEach(function (s) { s.hidden = true; });
      antesDeImprimirEstado.cerradas.forEach(function (d) { d.open = false; });
      antesDeImprimirEstado = null;
    }
    window.addEventListener('beforeprint', prepararImpresion);
    window.addEventListener('afterprint', terminarImpresion);
    $('#btn-imprimir').addEventListener('click', function () {
      prepararImpresion();
      window.print();
    });


    // ---------- consejos ----------
    $('#consejos').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-consejo]');
      if (!btn) return;
      const k = consejosActuales[+btn.dataset.consejo];
      if (!k) return;
      conDeshacer('Cambiaste: ' + k.nombre + ' → ' + k.nuevo.nombre + '. Ahorras ' + rd(k.ahorroRD, 0) + '.', function () {
        const ap = estado.aparatos.find(function (a) { return a.id === k.apId; });
        if (!ap) return;
        const i = estado.aparatos.indexOf(ap);
        estado.aparatos[i] = aparatoDesde(Object.assign({}, ap, k.nuevo, { id: ap.id }));
        marcarEditado();
      });
    });
    // las barras de "Consumo por aparato" crecen al abrir el desplegable
    $('#barras').closest('details').addEventListener('toggle', function (e) {
      if (e.currentTarget.open) crecerBarras('#barras .bar-fill');
    });

    // ---------- meta de factura ----------
    $('#form-meta').addEventListener('submit', function (e) {
      e.preventDefault();
      const c = ultimoCalculo;
      const salida = $('#meta-resultado');
      const meta = parseFloat($('#meta-valor').value);
      if (!(meta > 0)) { salida.textContent = 'Escribe cuánto quieres pagar, por ejemplo ' + $('#meta-valor').placeholder + '.'; return; }
      const plan = VC.planParaMeta(estado.aparatos, estado.tarifa, estado.periodo, meta);
      if (plan.inicial <= meta) {
        salida.innerHTML = 'Tu factura estimada (<b>' + rd(plan.inicial, 0) + '</b>) ya está por debajo de ' + rd(meta, 0) + '. ¡Vas bien!';
        return;
      }
      conDeshacer('Se aplicaron los cambios sugeridos para la meta.', function () {
        estado.reducciones = plan.reducciones;
      });
      const detalle = nombreEscenario(plan.reducciones);
      salida.innerHTML = plan.alcanzable
        ? 'Para pagar <b>' + rd(meta, 0) + '</b>: ' + esc(detalle) + '. La factura quedaría en <b>' + rd(plan.total, 0) + '</b> (ahorras ' + rd(plan.inicial - plan.total, 0) + '). Ya moví las barras por ti.'
        : 'Solo usando menos los aparatos (hasta la mitad de sus horas) no se llega a ' + rd(meta, 0) + '. Lo más bajo es <b>' + rd(plan.total, 0) + '</b> con: ' + esc(detalle) + '. Mira también los <a href="#resumen">consejos para cambiar aparatos</a>.';
      if (c) anunciar(salida.textContent);
    });

    // ---------- escenarios ----------
    $('#btn-guardar-escenario').addEventListener('click', function () {
      const r = {};
      Object.keys(estado.reducciones).forEach(function (id) { if (estado.reducciones[id] > 0) r[id] = estado.reducciones[id]; });
      if (!Object.keys(r).length) { mostrarAviso('Mueve alguna barra antes de guardar un escenario.'); return; }
      if (estado.escenarios.length >= 6) { mostrarAviso('Puedes guardar hasta 6 escenarios. Borra uno para guardar otro.'); return; }
      const nombre = nombreEscenario(r);
      conDeshacer('Escenario guardado: ' + nombre + '.', function () {
        estado.escenarios.push({ id: nuevoId(), nombre: nombre, reducciones: r });
      });
    });
    $('#lista-escenarios').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-escenario]');
      if (!btn) return;
      const esc_ = estado.escenarios.find(function (x) { return x.id === btn.dataset.escenario; });
      if (!esc_) return;
      if (btn.dataset.accion === 'aplicar') {
        conDeshacer('Aplicaste: ' + esc_.nombre + '.', function () { estado.reducciones = clonar(esc_.reducciones); });
      } else {
        conDeshacer('Escenario borrado.', function () {
          estado.escenarios = estado.escenarios.filter(function (x) { return x !== esc_; });
        });
      }
    });

    // ---------- facturas reales ----------
    (function () {
      const ahora = new Date();
      ahora.setMonth(ahora.getMonth() - 1);
      $('#fr-mes').value = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
    })();
    $('#form-factura').addEventListener('submit', function (e) {
      e.preventDefault();
      const mes = $('#fr-mes').value.trim();
      const kwh = parseFloat($('#fr-kwh').value);
      const monto = parseFloat($('#fr-monto').value);
      const err = $('#fr-error');
      if (!/^\d{4}-\d{2}$/.test(mes)) { err.textContent = 'Elige el mes de la factura (por ejemplo 2026-10).'; return; }
      if (!(kwh > 0 && kwh < 100000)) { err.textContent = 'Escribe los kWh que dice la factura.'; return; }
      if (!(monto > 0 && monto < 10000000)) { err.textContent = 'Escribe el total que pagaste en RD$.'; return; }
      err.textContent = '';
      conDeshacer('Factura de ' + nombreMes(mes) + ' guardada.', function () {
        estado.facturas = estado.facturas.filter(function (f) { return f.mes !== mes; }).concat([{ mes: mes, kwh: kwh, monto: monto }]);
      });
      $('#fr-kwh').value = '';
      $('#fr-monto').value = '';
    });
    $('#lista-facturas').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-mes]');
      if (!btn) return;
      conDeshacer('Factura de ' + nombreMes(btn.dataset.mes) + ' borrada.', function () {
        estado.facturas = estado.facturas.filter(function (f) { return f.mes !== btn.dataset.mes; });
      });
    });

    // ---------- instalar como app y uso sin internet ----------
    let eventoInstalar = null;
    const btnInstalar = $('#btn-instalar');
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const yaInstalada = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      eventoInstalar = e;
      btnInstalar.hidden = false;
    });
    if (esIOS && !yaInstalada) btnInstalar.hidden = false;
    btnInstalar.addEventListener('click', function () {
      if (eventoInstalar) {
        eventoInstalar.prompt();
        eventoInstalar.userChoice.then(function (r) { if (r.outcome === 'accepted') btnInstalar.hidden = true; });
        eventoInstalar = null;
      } else if (esIOS) {
        mostrarAviso('En Safari: toca el botón Compartir y luego "Agregar a pantalla de inicio".');
      }
    });
    window.addEventListener('appinstalled', function () {
      btnInstalar.hidden = true;
      mostrarAviso('VoltiControl quedó instalada. Ya funciona sin internet.');
    });
    // El "service worker" guarda la app para abrirla sin conexión. Solo existe en
    // la página publicada (no en el archivo suelto de dist/, que no tiene manifiesto).
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel="manifest"]')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo sin conexión */ });
    }

    // ---------- modo exposición ----------
    iniciarExposicion();

    // redibujar gráficos al cambiar el tamaño
    // Solo cuando una gráfica visible cambia de ancho (girar el celular, cambiar la
    // ventana). Al aparecer una sección (ancho 0 → algo) ya la dibuja navegar(), con animación.
    const anchos = { curva: $('#grafico-curva').clientWidth, medidor: $('#grafico-medidor').clientWidth };
    let espera = null;
    const ro = new ResizeObserver(function () {
      const nuevos = { curva: $('#grafico-curva').clientWidth, medidor: $('#grafico-medidor').clientWidth };
      const cambia = function (k) { return anchos[k] > 0 && nuevos[k] > 0 && Math.abs(nuevos[k] - anchos[k]) >= 4; };
      const curva = cambia('curva'), medidor = cambia('medidor');
      anchos.curva = nuevos.curva; anchos.medidor = nuevos.medidor;
      if (!curva && !medidor) return;
      clearTimeout(espera);
      espera = setTimeout(function () { if (curva) renderCurva(ultimoCalculo); if (medidor) renderMedidor(ultimoCalculo); }, 60);
    });
    ro.observe($('#grafico-curva'));
    ro.observe($('#grafico-medidor'));

    limpiarFormulario();
    renderTodo();
    // primera vista: la gráfica de la sección abierta se dibuja con animación
    const abierta = document.querySelector('main > section:not([hidden])');
    if (abierta && abierta.id === 'resumen') renderCurva(ultimoCalculo, true);
    if (abierta && abierta.id === 'medidor') renderMedidor(ultimoCalculo, true);
    anchos.curva = $('#grafico-curva').clientWidth;
    anchos.medidor = $('#grafico-medidor').clientWidth;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
