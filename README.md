# VoltiControl

Aplicación web para calcular el consumo eléctrico de un hogar con integrales, estimar la factura con la tarifa residencial por bloques y simular el ahorro.

Proyecto innovador de **Cálculo Integral, sección 4** del Instituto Tecnológico de Las Américas (ITLA).
Profesor: Lcdo. David Mercedes.
Integrantes: Leonardo Pérez, Randy Benítez, Eddian Hernández y Diego Martinez.

## Cómo abrirla

No necesita servidor ni instalación. Abre `index.html` en el navegador.
También está `dist/volticontrol.html`, que es la misma app en un solo archivo.

Para publicarla gratis, sube la carpeta a GitHub y activa **GitHub Pages** (Settings → Pages → rama `main`, carpeta raíz).

## Qué hace

- **Mis aparatos:** registro de aparatos con potencia (W), cantidad y horarios de uso. El ciclo de trabajo (nevera 40 %, aire 70 %, etc.) se aplica solo, según el nombre del aparato. Incluye una lista de 24 aparatos comunes con potencias típicas.
- **Curva de potencia del día:** gráfica de P(t). El área bajo la curva es la energía del día, E = ∫₀²⁴ P(t) dt. Compara el área exacta con la regla del trapecio para n = 4 … 288 y muestra el error.
- **Resumen y factura:** consumo diario y del período, factura con desglose por bloques, cargo fijo e ITBIS, y el bloque tarifario en que cae el hogar.
- **Lecturas del contador:** registro de lecturas diarias, ritmo real en kWh/día (pendiente por mínimos cuadrados), proyección al cierre del período y fecha en que se pasaría al siguiente bloque.
- **Simulador de ahorro:** reduce las horas de uso de cada aparato y calcula el ahorro en RD$ por período y por año.
- **Tarifa editable:** precios por bloque, cargo fijo, días del período y reglas para más de 700 kWh.

Los datos se guardan en el navegador (`localStorage`).

## Estructura

```
index.html          Página principal
css/styles.css      Estilos (modo claro y oscuro, adaptado a celular)
js/calculos.js      Núcleo matemático: horarios, P(t), integral exacta, regla del trapecio, factura, proyección
js/datos.js         Catálogo de aparatos, hogar de ejemplo y tarifa de referencia
js/app.js           Interfaz y gráficos (SVG, sin librerías)
tests/calculos.test.js  Pruebas de los cálculos (node tests/calculos.test.js)
build.py            Genera dist/volticontrol.html (todo en un archivo)
```

## La matemática

- **Energía como integral:** cada aparato aporta potencia constante mientras está encendido, así que P(t) es una función escalonada y su integral exacta es la suma de áreas de rectángulos: potencia × ciclo × cantidad × horas.
- **Regla del trapecio:** T_n = h/2 · [P(t₀) + 2P(t₁) + … + 2P(tₙ₋₁) + P(tₙ)], con h = 24/n. Es el método que se usaría con mediciones de un sensor cada cierto tiempo.
- **Proyección:** las lecturas del contador son la energía acumulada; su pendiente (derivada) es el ritmo diario, calculado por mínimos cuadrados.
- **Factura:** función por partes según los bloques de la tarifa.

## Tarifa de referencia

0–200 kWh: RD$ 6.09 y más de 700 kWh: RD$ 13.09, según declaraciones del Ministerio de Energía y Minas (octubre 2026). Bloques intermedios (RD$ 9.50 y RD$ 11.50), cargo fijo (RD$ 120) e ITBIS sobre 700 kWh tomados de guías públicas. Se deben verificar con una factura real.

## Mejora futura

Medición real con un sensor PZEM-004T conectado a un ESP32 que envíe la potencia cada pocos segundos; la app integraría esas mediciones con la regla del trapecio.
