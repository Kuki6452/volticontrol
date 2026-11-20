const assert = require('assert');
const VC = require('../js/calculos.js');
const D = require('../js/datos.js');
const near = (a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e, `${a} != ${b}`);

// Horarios
near(VC.parseHora('22:30'), 22.5); near(VC.parseHora('7pm'), 19); near(VC.parseHora('12 am'), 0);
assert.ok(isNaN(VC.parseHora('25:00')));
assert.deepStrictEqual(VC.parseHorario('22:00-05:00, 13:00-14:00'), [[22,5],[13,14]]);
assert.deepStrictEqual(VC.parseHorario('de 10 am a 2 pm'), [[10,14]]);
assert.deepStrictEqual(VC.parseHorario('24 horas'), [[0,24]]);
assert.deepStrictEqual(VC.parseHorario('18:00-24:00'), [[18,24]]);
assert.strictEqual(VC.parseHorario('hola'), null);
near(VC.horasDeUso([[22,5]]), 7);
assert.ok(VC.encendido(23, [[22,5]]) && VC.encendido(2,[[22,5]]) && !VC.encendido(5,[[22,5]]));

// Energía: aire 1200 W, ciclo .7, 7 h -> 5.88 kWh
const aire = {watts:1200,cantidad:1,ciclo:0.7,rangos:[[22,5]]};
near(VC.energiaDiaria(aire), 5.88);
// Trapecio en polinomio: ∫0^2 x^2 = 8/3
near(VC.trapecio(x=>x*x,0,2,1000), 8/3, 1e-5);
// Trapecio con horario en la malla => exacto
near(VC.energiaTrapecio([{watts:100,cantidad:1,ciclo:1,rangos:[[6,12]]}], 24), 0.6);
// Converge con horario fuera de la malla
const ap = D.EJEMPLO_APARATOS.map((a,i)=>({...a,id:i,rangos:VC.parseHorario(a.horario)}));
const exacta = VC.energiaDiariaTotal(ap);
console.log('exacta', exacta.toFixed(4));
for (const n of [4,12,24,96,288,1440]) console.log(n, VC.energiaTrapecio(ap,n).toFixed(4));
near(VC.energiaTrapecio(ap, 1440), exacta, 1e-6);

// Factura escalonada: 300 kWh -> 200*6.09 + 100*9.5 + 120
const f300 = VC.factura(300, D.TARIFA);
near(f300.total, 1218 + 950 + 120, 1e-6); assert.strictEqual(f300.bloque, 1);
const f750 = VC.factura(750, D.TARIFA);
near(f750.total, (750*13.09+120)*1.18, 1e-6); assert.strictEqual(f750.bloque, 3);
const f700 = VC.factura(700, D.TARIFA);
near(f700.total, 1218+950+4600+120, 1e-6);
console.log('mes ejemplo', (exacta*30).toFixed(1), 'kWh', VC.factura(exacta*30, D.TARIFA).total.toFixed(2));

// Proyección
const p = VC.proyeccion(D.EJEMPLO_LECTURAS, 30);
console.log('ritmo', p.ritmo.toFixed(3), 'total', p.total.toFixed(1), 'dia200', VC.diaQueAlcanza(p,200), 'dia300', VC.diaQueAlcanza(p,300));
near(VC.proyeccion([{fecha:'2026-11-01',valor:0},{fecha:'2026-11-11',valor:100}],30).total, 300);
near(VC.diasEntre('2026-10-30','2026-11-02'), 3);
// Ahorro
near(VC.energiaConReduccion([{...aire,id:'a'}], {a:2}), 0.84*5);
// Ciclo automático por nombre
near(D.cicloAutomatico('Nevera'), 0.4); near(D.cicloAutomatico('  nevera de la cocina '), 0.4);
near(D.cicloAutomatico('Aire acondicionado 12,000 BTU inverter'), 0.55); near(D.cicloAutomatico('Aire del cuarto'), 0.7);
near(D.cicloAutomatico('Aire inverter 18000'), 0.55); near(D.cicloAutomatico('Congelador'), 0.45);
near(D.cicloAutomatico('Calentador de agua'), 0.5); near(D.cicloAutomatico('Plancha'), 0.6);
near(D.cicloAutomatico('Freidora de aire'), 1); near(D.cicloAutomatico('Televisor'), 1); near(D.cicloAutomatico(''), 1);
for (const a of D.CATALOGO) near(D.cicloAutomatico(a.nombre), a.ciclo);
for (const a of D.EJEMPLO_APARATOS) near(D.cicloAutomatico(a.nombre), a.ciclo);
// Lecturas de ejemplo con fechas relativas: 6 días seguidos que terminan en la fecha dada
const le = D.lecturasDeEjemplo('2026-03-02');
assert.deepStrictEqual(le.map(l => l.fecha), ['2026-02-25','2026-02-26','2026-02-27','2026-02-28','2026-03-01','2026-03-02']);
assert.deepStrictEqual(le.map(l => l.valor), D.VALORES_LECTURAS_EJEMPLO);
assert.strictEqual(D.EJEMPLO_LECTURAS.length, 6);
near(VC.diasEntre(D.EJEMPLO_LECTURAS[0].fecha, D.EJEMPLO_LECTURAS[5].fecha), 5);
console.log('OK');
