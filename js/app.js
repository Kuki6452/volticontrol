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
      ejemplo: true,
      lecturasEjemplo: true
    };
  }

  function cargar() {
    const base = estadoInicial();
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return base;
      const s = JSON.parse(crudo);
      return {
        aparatos: Array.isArray(s.aparatos) ? s.aparatos.map(aparatoDesde).filter(function (a) { return a.rangos; }) : base.aparatos,
        lecturas: Array.isArray(s.lecturas) ? s.lecturas.filter(function (l) { return /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) && isFinite(l.valor); }) : base.lecturas,
        tarifa: s.tarifa && Array.isArray(s.tarifa.bloques) && s.tarifa.bloques.length === 4 ? Object.assign(clonar(D.TARIFA), s.tarifa) : base.tarifa,
        periodo: s.periodo > 0 ? s.periodo : 30,
        nIndice: s.nIndice >= 0 && s.nIndice < N_VALORES.length ? s.nIndice : 3,
        trapecios: s.trapecios !== false,
        reducciones: s.reducciones || {},
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
    estado.lecturasEjemplo = estado.lecturas.some(function (l) {
      return D.EJEMPLO_LECTURAS.some(function (e) { return e.fecha === l.fecha && e.valor === l.valor; });
    });
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

    $('#stats').innerHTML =
      '<div class="stat"><span class="label">Consumo diario</span><span class="value"><span id="n-diaria">' + fmt(c.diaria, 2) + '</span><small>kWh</small></span><span class="sub">Área bajo la curva de 0 a 24 h</span></div>' +
      '<div class="stat"><span class="label">Consumo · ' + estado.periodo + ' días</span><span class="value"><span id="n-periodo">' + fmt(c.periodoKwh, 0) + '</span><small>kWh</small></span><span class="sub">' + pillBloque(f.bloque) + '</span></div>' +
      '<div class="stat"><span class="label">Factura estimada</span><span class="value" id="n-factura">' + rd(f.total, 0) + '</span><span class="sub">≈ ' + rd(f.precioMedio) + ' por kWh en promedio</span></div>';
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
  function renderAparatos(c) {
    const lista = $('#lista-aparatos');
    if (!estado.aparatos.length) {
      lista.innerHTML = '<div class="empty">Todavía no hay aparatos. Elige uno de la lista del formulario para empezar.</div>';
      return;
    }
    // orden de registro (más estable para editar), con el consumo calculado
    lista.innerHTML = estado.aparatos.map(function (ap) {
      const horas = VC.horasDeUso(ap.rangos);
      const detalle = [];
      if (ap.cantidad > 1) detalle.push(ap.cantidad + ' unidades');
      if (ap.ciclo < 1) detalle.push('ciclo ' + fmt(ap.ciclo * 100, 0) + ' %');
      return '<div class="row' + (ap.id === editandoId ? ' editing' : '') + '" data-id="' + ap.id + '">' +
        '<span class="name">' + esc(ap.nombre) + (detalle.length ? '<small>' + detalle.join(' · ') + '</small>' : '') + '</span>' +
        '<span class="r mono"><span class="k">Potencia</span>' + fmt(ap.watts, 0) + ' W</span>' +
        '<span class="sched"><span class="k">Horario</span>' + esc(VC.textoHorario(ap.rangos)) + '</span>' +
        '<span class="r mono"><span class="k">Horas</span>' + fmt(horas, horas % 1 ? 2 : 0) + ' h</span>' +
        '<span class="r mono"><span class="k">kWh/día</span><b>' + fmt(VC.energiaDiaria(ap), 2) + '</b></span>' +
        '<span class="acts"><button class="btn small ghost" type="button" data-accion="editar">Editar</button><button class="btn small ghost danger" type="button" data-accion="quitar" aria-label="Quitar ' + esc(ap.nombre) + '">Quitar</button></span>' +
        '</div>';
    }).join('');
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
      prev.innerHTML = 'Consumirá <b class="mono">' + fmt(dia, 2) + ' kWh</b> al día (' + fmt(VC.horasDeUso(ap.rangos), 2) + ' h de uso) y unos <b class="mono">' + fmt(dia * estado.periodo, 0) + ' kWh</b> en ' + estado.periodo + ' días.' +
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

  function renderCurva(c) {
    const cont = $('#grafico-curva');
    if (!cont.clientWidth) return;
    const ancho = Math.max(280, cont.clientWidth || 700);
    const angosto = ancho < 520;
    const alto = angosto ? 245 : 330;
    const m = { l: 48, r: 12, t: 14, b: 40 };
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
    svg('path', { d: d + 'V' + y(0) + 'H' + x(0) + 'Z', class: 'area' }, s);

    // trapecios
    const n = N_VALORES[estado.nIndice];
    if (estado.trapecios) {
      const h = 24 / n;
      const gt = svg('g', {}, s);
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
    svg('path', { d: d, class: 'curve' }, s);

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
  function renderMedidor(c) {
    const cont = $('#grafico-medidor');
    if (!cont.clientWidth) return;
    const proy = c.proy;
    const ancho = Math.max(280, cont.clientWidth || 600);
    const angosto = ancho < 520;
    const alto = angosto ? 230 : 280;
    const m = { l: 52, r: angosto ? 58 : 70, t: 16, b: 40 };
    const iw = ancho - m.l - m.r, ih = alto - m.t - m.b;
    cont.innerHTML = '';
    const s = svg('svg', { viewBox: '0 0 ' + ancho + ' ' + alto, width: ancho, height: alto, role: 'img', 'aria-label': proy ? 'Consumo acumulado según el contador, con proyección de ' + fmt(proy.total, 0) + ' kWh al final del período.' : 'Sin suficientes lecturas.' }, cont);

    const hechos = $('#hechos-medidor');
    if (!proy) {
      const t = svg('text', { x: ancho / 2, y: alto / 2, 'text-anchor': 'middle', class: 'axis-title' }, s);
      t.textContent = estado.lecturas.length ? 'Agrega una lectura de otro día para ver tu ritmo' : 'Agrega al menos dos lecturas de días distintos';
      hechos.innerHTML = '';
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
    svg('polyline', { points: pts.map(function (p) { return x(p.dia) + ',' + y(p.acumulado); }).join(' '), class: 'real' }, s);
    svg('line', { x1: x(proy.ultimo.dia), y1: y(proy.ultimo.acumulado), x2: x(proy.periodo), y2: y(proy.total), class: 'proj' }, s);
    pts.forEach(function (p) { svg('circle', { cx: x(p.dia), cy: y(p.acumulado), r: 4.5, class: 'dot' }, s); });
    svg('circle', { cx: x(proy.periodo), cy: y(proy.total), r: 5, class: 'dot-end' }, s);
    const fin = svg('text', { x: x(proy.periodo) + 8, y: y(proy.total) + 4, class: 'end-label' }, s);
    fin.textContent = fmt(proy.total, 0);

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
      '<div class="fact"><span class="label">Próximo bloque</span><span class="val" style="font-size:.95rem;font-family:var(--font-body)">' + cambio + '</span></div>';
  }

  function renderLecturas() {
    const cont = $('#lista-lecturas');
    const orden = estado.lecturas.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
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
      $('#resultado-ahorro').innerHTML = '';
      return;
    }
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
      '<div><span class="k">Ahora</span><span class="v">' + fmt(c.periodoKwh, 0) + ' kWh</span><span class="mono" style="font-size:.9rem">' + rd(c.factura.total, 0) + '</span></div>' +
      '<div><span class="k">Con los cambios</span><span class="v">' + fmt(nuevoPeriodo, 0) + ' kWh</span><span class="mono" style="font-size:.9rem">' + rd(facNueva.total, 0) + '</span></div>' +
      '</div>' +
      '<div class="savings"><span class="k" style="font-size:.85rem;font-weight:600;color:var(--ink-2)">Ahorro en ' + estado.periodo + ' días</span><span class="v">' + rd(ahorro, 0) + '</span><span class="sub">≈ ' + rd(ahorro * 365 / estado.periodo, 0) + ' al año · ' + fmt(c.periodoKwh - nuevoPeriodo, 0) + ' kWh menos</span></div>' +
      (ahorro === 0 ? '<p style="color:var(--muted)">Mueve alguna barra para ver el ahorro.</p>' : bloqueTxt);
  }

  function textoHoras(h) {
    if (h < 1) return fmt(h * 60, 0) + ' min';
    const ent = Math.floor(h), min = Math.round((h - ent) * 60);
    return ent + ' h' + (min ? ' ' + min + ' min' : '');
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
    renderTarifa();
    guardar();
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
      }
      if (ultimoCalculo) {
        if (activa.id === 'resumen') renderCurva(ultimoCalculo);
        if (activa.id === 'medidor') renderMedidor(ultimoCalculo);
      }
    }
    window.addEventListener('hashchange', function () { navegar(true); });
    navegar(false);


    $('#f-catalogo').addEventListener('change', function (e) {
      const v = e.target.value;
      if (v === '' ) return;
      if (v === 'otro') { $('#f-nombre').value = ''; $('#f-watts').value = ''; cargarHorarioVisual(''); $('#f-nombre').focus(); actualizarVistaPrevia(); return; }
      const a = D.CATALOGO[+v];
      $('#f-nombre').value = a.nombre;
      $('#f-watts').value = a.watts;
      cargarHorarioVisual(a.horario);
      $('#f-error').textContent = '';
      actualizarVistaPrevia();
    });

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
    // Botones para todos los aparatos: hay que pulsar dos veces para confirmar,
    // porque borran o reemplazan la lista completa.
    function botonConConfirmacion(boton, textoConfirmar, accion) {
      const textoNormal = boton.textContent;
      let espera = null;
      boton.addEventListener('click', function () {
        if (!espera) {
          boton.textContent = textoConfirmar;
          boton.classList.add('confirmando');
          espera = setTimeout(function () { boton.textContent = textoNormal; boton.classList.remove('confirmando'); espera = null; }, 4000);
          return;
        }
        clearTimeout(espera); espera = null;
        boton.textContent = textoNormal; boton.classList.remove('confirmando');
        accion();
      });
    }
    botonConConfirmacion($('#btn-quitar-todos'), '¿Seguro? Pulsa otra vez', function () {
      estado.aparatos = [];
      estado.reducciones = {};
      marcarEditado();
      renderTodo();
      anunciar('Se quitaron todos los aparatos.');
      $('#btn-agregar').focus();
    });
    botonConConfirmacion($('#btn-restaurar-aparatos'), 'Reemplazar mi lista: pulsa otra vez', function () {
      estado.aparatos = D.EJEMPLO_APARATOS.map(aparatoDesde);
      estado.reducciones = {};
      renderTodo();
      anunciar('Se restauraron los 12 aparatos del ejemplo.');
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
      const btn = e.target.closest('button[data-accion]');
      if (!btn) return;
      const id = btn.closest('.row').dataset.id;
      if (btn.dataset.accion === 'editar') editarAparato(id);
      else {
        const ap = estado.aparatos.find(function (a) { return a.id === id; });
        estado.aparatos = estado.aparatos.filter(function (a) { return a.id !== id; });
        delete estado.reducciones[id];
        if (editandoId === id) limpiarFormulario();
        marcarEditado();
        anunciar((ap ? ap.nombre : 'Aparato') + ' quitado.');
        renderTodo();
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
    $('#l-fecha').value = hoyISO();
    $('#form-lectura').addEventListener('submit', function (e) {
      e.preventDefault();
      const fecha = $('#l-fecha').value;
      const valor = parseFloat($('#l-valor').value);
      const err = $('#l-error');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { err.textContent = 'Elige la fecha de la lectura.'; return; }
      if (!(valor >= 0)) { err.textContent = 'Escribe el número que marca el contador.'; return; }
      const otras = estado.lecturas.filter(function (l) { return l.fecha !== fecha; });
      const antes = otras.filter(function (l) { return l.fecha < fecha; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }).pop();
      const despues = otras.filter(function (l) { return l.fecha > fecha; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })[0];
      if (antes && valor < antes.valor) { err.textContent = 'La lectura no puede ser menor que la del ' + fechaCorta(antes.fecha) + ' (' + fmt(antes.valor, 1) + '). El contador solo sube.'; return; }
      if (despues && valor > despues.valor) { err.textContent = 'La lectura no puede ser mayor que la del ' + fechaCorta(despues.fecha) + ' (' + fmt(despues.valor, 1) + ').'; return; }
      err.textContent = '';
      otras.push({ fecha: fecha, valor: valor });
      estado.lecturas = otras;
      actualizarOrigenLecturas();
      marcarEditado();
      $('#l-valor').value = '';
      $('#l-fecha').value = sumarDias(fecha, 1);
      anunciar('Lectura guardada.');
      renderTodo();
    });
    $('#lista-lecturas').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-fecha]');
      if (!btn) return;
      estado.lecturas = estado.lecturas.filter(function (l) { return l.fecha !== btn.dataset.fecha; });
      actualizarOrigenLecturas();
      marcarEditado();
      renderTodo();
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
      estado.tarifa = clonar(D.TARIFA);
      estado.periodo = 30;
      renderTodo();
      anunciar('Tarifa de referencia restaurada.');
    });

    // aviso de ejemplo
    let confirmando = null;
    $('#btn-limpiar').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (!confirmando) {
        btn.textContent = 'Sí, borrar el ejemplo';
        btn.classList.add('danger');
        confirmando = setTimeout(function () { btn.textContent = 'Empezar desde cero'; btn.classList.remove('danger'); confirmando = null; }, 4000);
        return;
      }
      clearTimeout(confirmando); confirmando = null;
      btn.textContent = 'Empezar desde cero'; btn.classList.remove('danger');
      estado.aparatos = [];
      estado.lecturas = [];
      estado.lecturasEjemplo = false;
      estado.reducciones = {};
      estado.ejemplo = false;
      limpiarFormulario();
      renderTodo();
      irA('aparatos');
    });
    $('#btn-ocultar-aviso').addEventListener('click', function () {
      estado.ejemplo = false;
      renderTodo();
    });


    // redibujar gráficos al cambiar el tamaño
    let anchoPrevio = 0, espera = null;
    const ro = new ResizeObserver(function () {
      const w = $('#grafico-curva').clientWidth - $('#grafico-medidor').clientWidth;
      if (Math.abs(w - anchoPrevio) < 4) return;
      anchoPrevio = w;
      clearTimeout(espera);
      espera = setTimeout(function () { renderCurva(ultimoCalculo); renderMedidor(ultimoCalculo); }, 60);
    });
    ro.observe($('#grafico-curva'));
    ro.observe($('#grafico-medidor'));

    limpiarFormulario();
    renderTodo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
