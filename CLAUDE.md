# VoltiControl

App web (HTML + CSS + JavaScript puro, sin frameworks ni servidor) para el proyecto innovador de **Cálculo Integral, sección 4, ITLA** (Prof. Lcdo. David Mercedes). Grupo: Leonardo Pérez, Randy Benítez, Eddian Hernández, Diego Martinez.

Calcula el consumo eléctrico de un hogar dominicano como el área bajo la curva de potencia, E = ∫₀²⁴ P(t) dt, compara con la regla del trapecio, estima la factura con la tarifa residencial por bloques, proyecta con lecturas del contador y simula ahorro.

## Estructura
- `index.html` — página principal (abrir directo en el navegador).
- `css/styles.css` — estilos con tokens de color en `:root`, modo claro/oscuro, responsive.
- `js/calculos.js` — funciones puras de matemática (horarios, P(t), integral exacta, trapecio, factura, proyección por mínimos cuadrados, ahorro). Exporta `window.VC` o `module.exports`.
- `js/datos.js` — catálogo de aparatos, hogar de ejemplo, tarifa de referencia (`window.VC_DATOS`).
- `js/app.js` — interfaz y gráficos SVG hechos a mano; estado en `localStorage` (clave `volticontrol.v1`).
- `tests/calculos.test.js` — pruebas: `node tests/calculos.test.js`.
- `build.py` — genera `dist/volticontrol.html` (todo en un solo archivo): `python build.py`. Quita el manifiesto del archivo suelto (no se instala).
- `manifest.webmanifest`, `sw.js`, `iconos/` — app instalable y modo sin internet. El service worker usa red primero y copia guardada sin conexión; si agregas archivos, súmalos a `ARCHIVOS` y sube `VERSION`.
- Pruebas visuales: `..\volticontrol-pruebas\revisar.mjs` (Playwright con Brave), fuera del repo.

## Convenciones
- Todo el texto de la interfaz y los nombres de variables/funciones en español.
- Sin dependencias externas salvo Google Fonts.
- Después de cambiar `calculos.js`, correr las pruebas. Después de cualquier cambio, regenerar `dist/` con `build.py`.
- Animaciones solo con propósito y siempre dentro de `prefers-reduced-motion: no-preference` (en JS, revisar `sinMovimiento`).
- La tarifa por defecto (RD$ 6.09 / 9.50 / 11.50 / 13.09, cargo fijo RD$ 120) es de referencia y editable en la app; hay que verificarla con una factura real.
