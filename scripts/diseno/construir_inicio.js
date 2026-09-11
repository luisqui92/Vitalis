// Construye vistas/inicio.es.html, inicio.pt.html e inicio.en.html a partir
// del diseño que mandó el usuario.
//
// El CSS se copia VERBATIM del archivo original: el pedido fue "tal cual", y
// una transcripción a mano de 30 líneas de CSS minificado es la forma más
// fácil de arruinar un diseño sin darse cuenta. Solo se tocan las cosas que
// lo romperían en el servidor:
//
//   1. la foto de Unsplash → alojada acá (la CSP solo admite img-src 'self')
//   2. la tipografía Inter → la variable que ya está en /fonts
//   3. los enlaces muertos (#, mailto) → plataforma y WhatsApp
//   4. el idioma → los tres, que es de lo que se trata este guion
//
// El CSS y los scripts son UNO SOLO para los tres idiomas. Solo cambia el
// texto. Así una corrección de diseño no hay que hacerla tres veces —que es
// como una versión se queda atrás sin que nadie lo note.
const fs = require("fs");
const path = require("path");

const {
  IDIOMAS, NOMBRES, RUTAS, WA_TEXTO, CABEZA, FRASES, AGENDA,
  MODULOS_TXT, TECNO_TXT, FILAS, CARRUSEL_TXT, ESPECIALIDADES_EXTRA, SELECTOR,
} = require("./textos");

const ORIGEN = path.join(__dirname, "inicio_original.html");
const RAIZ = path.join(__dirname, "..", "..");
const original = fs.readFileSync(ORIGEN, "utf8");

// ─── El CSS, tal cual ──────────────────────────────────────────────────────
let css = original.slice(original.indexOf("<style>") + 7, original.indexOf("</style>"));

// El panel de Symphomed Pet lleva .panel-light Y .pet. La segunda lo pinta
// oscuro pero no cambia el color del texto, así que el titular queda en tinta
// casi negra sobre fondo casi negro: ilegible. El panel gemelo (.panel-dark)
// sí declara color:#fff — esto es un olvido, no una decisión.
css = css.replace(
  /\.pet\{background:linear-gradient\(120deg,#06131c,#0d2836\);/,
  ".pet{background:linear-gradient(120deg,#06131c,#0d2836);color:#fff;"
);
css = css.replace(/\.panel-dark p\{color:#a8bdc9\}/, ".panel-dark p,.pet p{color:#a8bdc9}");

// ─── El símbolo de la marca, en lugar de los cinco puntos ──────────────────
//
// El diseño traía un símbolo inventado: cinco puntos cian dibujados con CSS.
// Symphomed ya tiene el suyo —el círculo con la cruz, el cerebro y el
// electro— y es el que reconoce un médico que ya usa la plataforma.
//
// La regla de los puntos se reemplaza en vez de agregarle otra encima: si se
// dejara, los <i> seguirían dibujándose arriba de la imagen. Se deja sin
// `position:relative` y sin los hijos, y el <i> se anula por si alguno
// sobrevive a un cambio futuro del marcado.
// 34px y no los 26 de los puntos: MEDIDO contra 26, 30, 34 y 38 en la barra
// de verdad. El símbolo tiene cinco elementos —círculo, cruz, cerebro,
// electro y la carpeta— y abajo de 34 el cerebro se convierte en una mancha:
// se ve que hay "algo", no se ve QUÉ. Los puntos que traía el diseño se
// bancaban 26 porque eran cinco círculos. De 38 para arriba el símbolo le
// gana al texto y deja de ser un bloque.
// Es el mismo tamaño que usa la cabecera de la plataforma, a propósito.
css = css.replace(
  /\.logo-mark\{width:26px;height:26px;position:relative\}/,
  ".logo-mark{width:34px;height:34px;flex:none;object-fit:contain;display:block}.logo-mark i{display:none}"
);

// ─── Lo que le faltaba al diseño para el celular ───────────────────────────
//
// El original trae reglas para 900px y 560px, pero ninguna toca .scale ni
// .footerlinks: son filas flex sin flex-wrap, así que a 402px piden 511px y
// 458px y no hay forma de que entren.
//
// El síntoma no es que se vean apretadas: el documento entero se hace más
// ancho que la pantalla, y como los fondos de sección solo pintan hasta el
// ancho de la VENTANA, queda una franja blanca a la derecha de toda la
// página. Se ve como si el sitio estuviera roto, y la causa está a cinco
// secciones de distancia de donde se nota.
//
// Esto no cambia el diseño: completa las reglas que ya venía aplicando a
// todo lo demás en esos mismos puntos de quiebre.
css += `
/* El pie es una fila flex de tres bloques sin flex-wrap. Alargar el copyright
   a "Bolivia y Brasil" bastó para que a 768px no entrara y desbordara la
   página entera. Se deja envolviendo SIEMPRE: a ancho completo no cambia
   nada, y deja de depender de que el texto no crezca. */
.footer{flex-wrap:wrap;gap:14px 20px}
.footerlinks{flex-wrap:wrap;gap:12px 18px}
@media(max-width:620px){
  .scale{flex-wrap:wrap;justify-content:center;gap:12px}
  .scale-box{flex:1 1 38%}
}
@media(max-width:620px){
  /* .screen es una grilla dentro de otra grilla. Por defecto una celda no se
     achica por debajo del ancho mínimo de su contenido, así que la maqueta
     del consultorio empujaba 354px aunque su contenedor midiera 331. El
     minmax(0,1fr) es lo que le da permiso para achicarse. */
  .screen-body{grid-template-columns:84px minmax(0,1fr)}
  .screen-main{min-width:0}
  .metric{grid-template-columns:1fr}
}
/* ── El selector de idioma ────────────────────────────────────────────────
   Son tres enlaces de verdad, a tres URLs de verdad. Ni un menú desplegable
   ni un botón con JavaScript: un médico brasileño que abra la página en
   español tiene que poder cambiarla aunque el script no haya corrido, y un
   buscador tiene que poder seguir el enlace para encontrar las otras dos
   versiones. */
.idiomas{display:inline-flex;gap:2px;align-items:center}
.idiomas a{
  color:#7f9fb0;text-decoration:none;font-size:11px;letter-spacing:1px;
  padding:4px 6px;border-radius:5px;transition:.2s;
}
.idiomas a:hover{color:#fff;background:#0c2a3a}
.idiomas a[aria-current="page"]{color:#fff;background:#12384a}
.idiomas a:focus-visible{outline:2px solid #49d8fb;outline-offset:1px}
@media(max-width:480px){
  /* "SYMPHOMED" con letter-spacing:3px es ancho, y la barra reparte con
     space-between: abajo de 480 el logo termina tocando el selector de idioma
     y se lee "SYMPHOMEDES". Se achica el logo y se aprieta el selector.
     Ojo: el selector NO se esconde. Antes sí —había un solo idioma y no
     hacía nada—, pero ahora es la única forma que tiene un visitante de
     cambiar de versión, y esconderlo justo en el celular lo dejaría atrapado
     en el idioma que le tocó. */
  .logo{font-size:13px;letter-spacing:2px}
  /* El símbolo también se achica: a 34px con el texto ya chico quedaba
     desbalanceado, y son 6px que en la barra de un celular se notan. */
  .logo-mark{width:28px;height:28px}
  .nav .navright{gap:10px}
  .idiomas a{padding:4px;letter-spacing:0}
  .btn{padding:11px 16px}
  /* Y el botón de la barra se va. MEDIDO, no supuesto: con el selector
     puesto, a 390px la .navright pedía 247px y terminaba 22px afuera de la
     pantalla — el mismo desborde que produce la franja blanca al costado de
     toda la página, otra vez.
     Se saca este botón y no el selector porque este es el único de los tres
     que se repite: la misma llamada está en la portada, justo abajo, y
     de nuevo al cierre. El selector y "Ingresar" no están en ningún otro
     lado. Y no se arregla apretando el botón unos píxeles: en portugués dice
     "Fale conosco" y en inglés "Talk to us", así que el ancho cambia con el
     idioma y el margen tiene que ser holgado, no justo. */
  .nav .navright .btn{display:none}
}
@media(max-width:430px){
  /* A 43px el titular llega justo al borde del contenedor y queda pegado.
     Dos píxeles menos de cuerpo le devuelven el margen. */
  .hero h1{font-size:38px;letter-spacing:-2px}
}
/* ── Las fichas de tecnología ─────────────────────────────────────────────
   Tres columnas y no seis: con seis, cada ficha medía 185px de ancho y el
   texto no entraba sin quedar ilegible.

   El resumen está SIEMPRE en el HTML, nunca escondido por JavaScript. Se
   revela al pasar el cursor, al tabular y al tocar (por la clase que agrega
   el script). Así lo lee Google, y si el script no corre se sigue pudiendo
   llegar a todo con el teclado. */
.tecnos{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
.tecno{
  background:#071a25;border:1px solid #214354;border-radius:10px;
  padding:15px 12px;color:#8fb0c2;font-family:inherit;font-size:12px;
  line-height:1.35;cursor:pointer;transition:.2s;
}
.tecno:hover{border-color:#3f9dbe;color:#fff}
.tecno[aria-selected="true"]{border-color:#5bddfa;background:#0c2a3a;color:#fff}
.tecno:focus-visible{outline:2px solid #49d8fb;outline-offset:2px}
/* El alto mínimo es lo que evita que cambiar de pestaña mueva la página: el
   panel no se achica con el resumen más corto ni salta con el más largo. */
.tecno-panel{
  margin-top:14px;background:#071a25;border:1px solid #214354;border-radius:12px;
  padding:26px 28px;min-height:200px;
}
.det b{display:block;font-size:15px;color:#fff;margin-bottom:10px}
.det p{color:#a8bdc9;font-size:14px;line-height:1.75;max-width:74ch;margin:0}
/* Sin JavaScript se muestran los seis, uno debajo del otro: una lista, que se
   lee bien, y ahí el filete separa. Con el script solo hay uno visible.
   El :not() es necesario: display:none saca al elemento del dibujo pero NO de
   la cadena de hermanos, así que un ".det + .det" pelado le ponía el filete
   al único visible por tener cinco ocultos delante — una línea suelta arriba
   del título, sin nada que separar. */
.det:not([data-oculto]) + .det:not([data-oculto]){
  margin-top:20px;padding-top:20px;border-top:1px solid #16323f;
}
/* Sin JavaScript no hay clase que alternar, así que el resumen se muestra al
   pasar el cursor y al tabular — que es lo que ya hace el CSS de arriba. */
@media(max-width:900px){.tecnos{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.tecnos{grid-template-columns:1fr 1fr}.tecno-panel{padding:20px}}
@media(prefers-reduced-motion:reduce){.tecno{transition:none}}
[data-oculto]{display:none}

/* ── El carrusel de módulos ───────────────────────────────────────────────
   Las diapositivas se desplazan con overflow-x + scroll-snap, así que andan
   sin JavaScript. Las flechas y los puntos son una mejora encima. */
.carrusel{margin-top:45px}
.pistas{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.pistas::-webkit-scrollbar{display:none}
.pistas:focus-visible{outline:2px solid #49d8fb;outline-offset:4px}
.modulo{flex:0 0 100%;scroll-snap-align:start;min-width:0}
.modulo-in{display:grid;grid-template-columns:1fr 1fr;gap:55px;align-items:center}
.modulo-txt p{color:#a8bdc9;font-size:15px;line-height:1.7;margin:14px 0 0;max-width:46ch}
.modulo-t{font-size:clamp(24px,2.6vw,34px);line-height:1.15;letter-spacing:-1px;margin:10px 0 0;font-weight:700}
.demo{background:#092331;border:1px solid #23596d;border-radius:12px;padding:20px;color:#fff;min-width:0}
.demo b{display:block;margin-top:14px;font-size:13px}
.demo .row:first-of-type{border-top:0}
.demo-pie{margin:8px 0 0;color:#9fb8c5;font-size:11px;line-height:1.6}
.tooth.marcada{border-color:#5bddfa;background:#123b4e;color:#8beaff}
.visor{height:110px;border:1px solid #2c6b84;border-radius:8px;background:linear-gradient(140deg,#0d2b3b,#061620);position:relative;margin-bottom:14px}
.visor-regla{position:absolute;left:18%;top:38%;width:46%;height:2px;background:#5bddfa}
.visor-medida{position:absolute;left:18%;top:calc(38% + 10px);color:#5bddfa;font-size:10px}
.pet-demo{position:relative;overflow:hidden}
.pet-demo:after{content:"🐕";position:absolute;font-size:64px;right:10px;bottom:-12px;opacity:.55}
.mandos{display:flex;align-items:center;gap:18px;margin-top:30px}
.flecha{width:42px;height:42px;flex:none;border-radius:50%;border:1px solid #2c6b84;background:transparent;color:#8beaff;font-size:15px;cursor:pointer;transition:.2s}
.flecha:hover:not(:disabled){background:#0d2b3b;border-color:#5bddfa}
.flecha:disabled{opacity:.3;cursor:default}
.flecha:focus-visible{outline:2px solid #49d8fb;outline-offset:3px}
/* flex-wrap y no un ancho fijo: con siete puntos, dos flechas y los huecos,
   los mandos pedían 350px dentro de un contenedor de 294 en una pantalla de
   320. Envolviendo, deja de importar cuántos módulos haya. */
.puntos{display:flex;gap:8px;flex:1;flex-wrap:wrap}
.punto{width:26px;height:3px;border-radius:2px;border:0;padding:0;background:#23596d;cursor:pointer;transition:.2s}
.punto[aria-current="true"]{background:#5bddfa}
.punto:focus-visible{outline:2px solid #49d8fb;outline-offset:3px}
@media(max-width:900px){
  .modulo-in{grid-template-columns:1fr;gap:26px}
  .carrusel{margin-top:32px}
}
@media(max-width:480px){
  .mandos{gap:12px}
  .flecha{width:38px;height:38px}
  .punto{width:18px}
}
@media(prefers-reduced-motion:reduce){.pistas{scroll-behavior:auto}}

/* Qué recuerda el seguimiento. Van como filete y no como tarjeta: son una
   lista de cosas del mismo rango, y cinco tarjetas con sombra al lado de las
   tres de arriba competirían con ellas por la atención. */
.recuerdos{display:grid;grid-template-columns:repeat(5,1fr);gap:0 22px;margin-top:52px;border-top:1px solid var(--line);padding-top:26px}
.recuerdo b{display:block;font-size:13px;margin-bottom:7px}
.recuerdo span{color:var(--muted);font-size:12px;line-height:1.6}
@media(max-width:900px){.recuerdos{grid-template-columns:1fr 1fr;gap:22px}}
@media(max-width:560px){.recuerdos{grid-template-columns:1fr;gap:18px}}
/* La sección de la agenda tiene tres pasos y no cuatro. Sin esto quedaría una
   columna vacía a la derecha, que se lee como si faltara algo. */
.steps-3{grid-template-columns:repeat(3,1fr)}
@media(max-width:900px){.steps-3{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.steps-3{grid-template-columns:1fr}.steps-3 .step:after{display:none}}
/* Con psicología y psiquiatría son catorce especialidades. A seis columnas
   quedaban doce arriba y dos solas abajo; a siete entran en dos filas justas.
   Va acotado a esta sección: la de tecnología usa la misma clase con seis. */
#especialidades .specialties{grid-template-columns:repeat(7,1fr)}
@media(max-width:900px){#especialidades .specialties{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){#especialidades .specialties{grid-template-columns:repeat(2,1fr)}}
/* Cinturón de seguridad. Lo de arriba arregla las causas conocidas; esto
   asegura que una futura —un texto más largo, una sección nueva— no vuelva a
   producir la franja blanca al costado de TODA la página. El costo es que un
   desborde nuevo se recorta en vez de avisar, y por eso no reemplaza a las
   reglas de arriba: las respalda. */
html{overflow-x:hidden}`;

// La única regla que cambia: la foto deja de venir de afuera.
css = css.replace(
  /url\("https:\/\/images\.unsplash\.com[^"]*"\)/,
  'url("/img/medica.jpg")'
);
// Y la familia tipográfica pasa a ser la alojada, que sí existe en este
// servidor. Tal como venía, "Inter" no se cargaba en ningún lado y la página
// caía en la fuente del sistema.
css = css.replace(/font-family:Inter,/, "font-family:InterVar,Inter,");


// ─── El cuerpo, un idioma a la vez ─────────────────────────────────────────
//
// ═══ POR QUÉ TRES ARCHIVOS Y NO UNO CON PLANTILLAS ═════════════════════════
//
// La alternativa era servir una sola plantilla y sustituir los textos en cada
// pedido. Sale más caro de lo que parece: hay que traducir en tiempo de
// respuesta, cualquier frase que falte se descubre en producción, y la página
// deja de poder cachearse igual para todos.
//
// Acá los tres HTML se arman una vez, al construir. Si a una versión le falta
// una traducción, este guion lo dice ANTES de desplegar, y cada archivo se
// sirve tal cual, sin trabajo por visita.
const CUERPO = original.slice(original.indexOf("<body>") + 6, original.indexOf("</body>"));

const WA = "https://wa.me/59164637067";
const SITIO = "https://symphomed.com";

// Los identificadores de las secciones quedan en español en los TRES idiomas.
// Son anclas, no texto que alguien lea: traducirlos daría tres juegos de
// enlaces distintos para mantener y ningún visitante notaría la diferencia.
const IDS = [
  ['id="platform"', 'id="plataforma"'],
  ['id="specialties"', 'id="especialidades"'],
  ['id="security"', 'id="confianza"'],
  ['id="technology"', 'id="tecnologia"'],
];

function filas(lista) {
  return lista.map(([r, v]) => `<div class="row"><label>${r}</label><div>${v}</div></div>`).join("\n");
}

// Las siete pantallas de ejemplo del carrusel. Los VALORES no se traducen
// —27 cm, 142 lpm, 20/25 son mediciones— pero las etiquetas sí, y eso es
// justo lo que se me había quedado en español adentro de cada maqueta.
function pantalla(i, idioma, pie, rotulo) {
  const c = CARRUSEL_TXT[idioma];
  const cierre = (rotulo ? `<b>${rotulo}</b>` : "") + `<p class="demo-pie">${pie}</p>`;
  if (i === 0) {
    const dientes = ["11","12","13","14","15","16","17","18","21","22","23","24","25","26","27","28",
                     "31","32","33","34","35","36","37","38","41","42","43","44","45","46","47","48"];
    return `<div class="teeth">${dientes.map(n =>
      `<div class="tooth${n === "36" ? " marcada" : ""}">${n}</div>`).join("")}</div>` + cierre;
  }
  if (i === 1) {
    return `<svg viewBox="0 0 260 130" width="100%" height="130" role="img" aria-label="${c.curva}">
<polyline points="10,108 60,88 110,74 160,63 210,54 250,48" fill="none" stroke="#2d6c85" stroke-width="1.5"/>
<polyline points="10,116 60,99 110,87 160,78 210,71 250,66" fill="none" stroke="#2d6c85" stroke-width="1.5" stroke-dasharray="3 3"/>
<polyline points="10,99 60,76 110,60 160,47 210,37 250,30" fill="none" stroke="#2d6c85" stroke-width="1.5" stroke-dasharray="3 3"/>
<polyline points="10,110 60,90 110,73 160,60 210,52" fill="none" stroke="#5bddfa" stroke-width="2.5"/>
<circle cx="210" cy="52" r="4" fill="#5bddfa"/>
<text x="10" y="126" fill="#8da7b5" font-size="8">${c.eje[0]}</text>
<text x="196" y="126" fill="#8da7b5" font-size="8">${c.eje[1]}</text>
<text x="228" y="22" fill="#2d6c85" font-size="8">P97</text>
<text x="228" y="62" fill="#2d6c85" font-size="8">P50</text>
</svg>` + cierre;
  }
  if (i === 2) return filas(FILAS.neuro[idioma]) + cierre;
  if (i === 3) return filas(FILAS.gineco[idioma]) + cierre;
  if (i === 4) return filas(FILAS.oftalmo[idioma]) + cierre;
  if (i === 5) {
    return `<div class="visor"><span class="visor-regla"></span><span class="visor-medida">34,2 mm</span></div>`
      + filas(FILAS.imagenes[idioma]) + cierre;
  }
  return filas(FILAS.pet[idioma]) + cierre;
}

// ═══ POR QUÉ ES SCROLL NATIVO Y NO UN CARRUSEL DE JAVASCRIPT ═══════════════
//
// Las diapositivas viven en un contenedor con overflow-x y scroll-snap. Eso
// significa que YA funciona sin una línea de script: se arrastra con el dedo
// en el celular y con la rueda en la compu. Las flechas y los puntos son una
// mejora encima, no el mecanismo.
//
// Importa porque esta página se sirve con una CSP de nonce por respuesta: si
// el script no corriera —un nonce mal puesto, un error de sintaxis— un
// carrusel hecho con JavaScript dejaría siete módulos invisibles y la sección
// se vería vacía, sin ningún error a la vista. Así, lo peor que pasa es que
// se pierdan las flechas.
function carrusel(idioma) {
  const c = CARRUSEL_TXT[idioma];
  const modulos = MODULOS_TXT[idioma];
  const laminas = modulos.map(([k, t, p, rotulo, pie], i) =>
    `<article class="modulo" aria-label="${i + 1} ${c.de} ${modulos.length}: ${k}"><div class="container modulo-in">
<div class="modulo-txt"><div class="eyebrow">${k}</div><h3 class="modulo-t">${t}</h3><p>${p}</p></div>
<div class="demo${i === 6 ? " pet-demo" : ""}">${pantalla(i, idioma, pie, rotulo)}</div>
</div></article>`).join("");

  return `
<section class="dark" id="soluciones">
<div class="container"><div class="section-head"><div class="eyebrow">${c.eyebrow}</div><h2>${c.h2}</h2><p>${c.p}</p></div></div>
<div class="carrusel">
<div class="pistas" id="pistas" tabindex="0" role="region" aria-label="${c.region}">
${laminas}
</div>
<div class="container mandos">
<button class="flecha" type="button" data-dir="-1" aria-label="${c.anterior}">←</button>
<div class="puntos" id="puntos" data-ir="${c.irA}"></div>
<button class="flecha" type="button" data-dir="1" aria-label="${c.siguiente}">→</button>
</div>
</div>
</section>`;
}

// ─── Las fichas de tecnología, que se abren ────────────────────────────────
//
// ═══ QUÉ SE PUEDE CONTAR Y QUÉ NO ══════════════════════════════════════════
//
// Cada ficha dice QUÉ LOGRA y nunca CÓMO ESTÁ HECHO. No aparece el nombre de
// ningún proveedor —ni el de transcripción, ni el del modelo, ni el de la
// receta digital— ni una sola pista de arquitectura. Eso es exactamente lo
// que un competidor necesitaría para copiar, y no aporta nada al médico que
// está decidiendo si probar.
//
// Seis pestañas arriba y UN panel abajo, en vez de seis fichas que crecen. La
// primera versión expandía la ficha en su lugar dentro de una grilla de tres
// columnas, y eso descuadra la fila por definición: la que se abre estira la
// fila entera y las otras dos quedan chiquitas con un hueco debajo.
function fichas(idioma) {
  const t = TECNO_TXT[idioma];
  return `<div class="tecnos" id="tecnos">${t.map(([nombre], i) => `
<button class="tecno" type="button" aria-selected="${i === 0 ? "true" : "false"}">${nombre}</button>`).join("")}
</div>
<div class="tecno-panel" id="tecnoPanel">${t.map(([nombre, d]) => `
<div class="det"><b>${nombre}</b><p>${d}</p></div>`).join("")}
</div>
<script nonce="__NONCE__">
// Va acá, pegado al panel, y no al final del documento: así se ejecuta apenas
// el navegador termina de leer estas seis fichas y ANTES de dibujarlas. Al
// final de la página también funcionaría, pero se vería un parpadeo con los
// seis resúmenes abiertos.
//
// Y por eso el HTML llega con los seis visibles en vez de con cinco ocultos:
// si el script no corre —CSP, error de sintaxis—, el visitante ve los seis
// uno debajo del otro, que es una lista perfectamente legible. Al revés
// vería uno solo y cinco pestañas que no hacen nada.
(function () {
  var p = document.getElementById("tecnoPanel");
  if (!p) return;
  [].slice.call(p.children).forEach(function (d, i) {
    if (i) d.setAttribute("data-oculto", "");
  });
})();
</script>`;
}

// ─── La agenda: lo que pasa antes y después de la consulta ─────────────────
//
// El diseño no la contemplaba y es de lo más vendible que tiene el producto,
// porque le ahorra trabajo a la secretaria y no solo al médico.
//
// Lo que dice acá está limitado a propósito a lo que el código hace hoy:
//
//   · reservar por WhatsApp — services/reservaCitas.js, el bot con los pasos
//     elegir_dia / elegir_hora
//   · la confirmación al instante — routes/citas.js:102 y reservaPublica.js:86
//   · la reconsulta — routes/consultaMedica.js:441, que arma un enlace de
//     reserva y se lo manda al paciente al cerrar la consulta
//
// Lo que NO se promete: un recordatorio automático que le llegue al paciente
// unos días antes de la cita. Eso no existe todavía —los Recordatorio son la
// lista que ve el médico en su panel, no un envío— y anunciarlo sería vender
// algo que el primer médico descubre que falta en su primera semana.
function agenda(idioma) {
  const a = AGENDA[idioma];
  return `
<section class="light" id="agenda"><div class="container">
<div class="section-head"><div class="eyebrow">${a.eyebrow}</div><h2>${a.h2}</h2><p>${a.p}</p></div>
<div class="steps steps-3">
${a.pasos.map(([icono, titulo, texto]) =>
  `<div class="step"><div class="icon">${icono}</div><h3>${titulo}</h3><p>${texto}</p></div>`).join("\n")}
</div>
<div class="recuerdos">
${a.recuerda.map(([que, cuando]) =>
  `<div class="recuerdo"><b>${que}</b><span>${cuando}</span></div>`).join("\n")}
</div>
</div></section>
`;
}

// ─── El selector de idioma ─────────────────────────────────────────────────
// Tres enlaces, no un desplegable: se siguen sin JavaScript y un buscador los
// usa para encontrar las otras dos versiones.
function selector(idioma) {
  const enlaces = IDIOMAS.map(i =>
    `<a href="${RUTAS[i]}" hreflang="${i}" lang="${i}"${i === idioma ? ' aria-current="page"' : ""}>${NOMBRES[i]}</a>`
  ).join("");
  return `<span class="idiomas" role="group" aria-label="${SELECTOR[idioma]}">${enlaces}</span>`;
}

// ─── Armar una versión ─────────────────────────────────────────────────────
function construir(idioma) {
  let cuerpo = CUERPO;
  const faltantes = [];

  // 1. Los identificadores de sección, que son los mismos en los tres idiomas.
  for (const [de, a] of IDS) cuerpo = cuerpo.split(de).join(a);

  // 2. Psicología y psiquiatría, que el diseño no traía.
  //    OJO CON EL ORDEN: esto corre ANTES de traducir ">Veterinary<", así que
  //    tiene que buscar el texto EN INGLÉS. Buscarlo traducido no da error —
  //    simplemente no encuentra nada y las dos especialidades no aparecen,
  //    que fue exactamente lo que pasó la primera vez.
  const ancla = '<div class="specialty"><div class="sicon">🐾</div>Veterinary</div>';
  if (!cuerpo.includes(ancla)) throw new Error("no encontré dónde meter psicología y psiquiatría");
  cuerpo = cuerpo.replace(ancla,
    ESPECIALIDADES_EXTRA[idioma].map(([signo, nombre]) =>
      `<div class="specialty"><div class="sicon">${signo}</div>${nombre}</div>`).join("") + ancla);

  // 3. Las seis fichas planas del diseño, por las pestañas con resumen.
  const iTec = cuerpo.indexOf('<div class="specialties"><div class="specialty" style="background:#071a25');
  if (iTec < 0) throw new Error("no encontré las fichas de tecnología del diseño original");
  cuerpo = cuerpo.slice(0, iTec) + fichas(idioma) + cuerpo.slice(cuerpo.indexOf("</div></section>", iTec));

  // 4. Los dos paneles fijos de "Soluciones", por el carrusel de siete módulos.
  const iSplit = cuerpo.indexOf('<section class="split" id="solutions">');
  const fSplit = cuerpo.indexOf("</section>", cuerpo.indexOf('<div class="panel panel-light pet">')) + 10;
  if (iSplit < 0 || fSplit < 10) throw new Error("no encontré la sección de soluciones del diseño original");
  cuerpo = cuerpo.slice(0, iSplit) + carrusel(idioma) + cuerpo.slice(fSplit);

  // 5. Las frases. De la más larga a la más corta ya viene ordenado en el
  //    archivo de textos, para que una traducción no se coma un pedazo de
  //    otra que todavía no se aplicó.
  for (const [de, versiones] of FRASES) {
    if (!cuerpo.includes(de)) { faltantes.push(de.slice(0, 55)); continue; }
    cuerpo = cuerpo.split(de).join(versiones[idioma]);
  }

  // 6. El selector de idioma, donde el diseño tenía un "EN⌄" que no hacía nada.
  if (!cuerpo.includes("<span>EN⌄</span>")) faltantes.push("<span>EN⌄</span>");
  cuerpo = cuerpo.replace("<span>EN⌄</span>", selector(idioma));

  // 7. La agenda, que el diseño no contemplaba.
  cuerpo = cuerpo.replace('<section id="especialidades">', agenda(idioma) + '<section id="especialidades">');

  // 8. El logo lleva al inicio DE ESTE IDIOMA, no a "#" ni a la versión
  //    española: un médico brasileño que toque el logo no tiene por qué
  //    terminar en una página en español.
  cuerpo = cuerpo.split('<a class="logo" href="#">').join(`<a class="logo" href="${RUTAS[idioma]}">`);

  // 8b. Y los cinco puntos del diseño, por el símbolo de verdad.
  //
  //     Va con width y height puestos aunque el CSS ya los defina: sin ellos
  //     el navegador no sabe cuánto espacio reservar hasta que la imagen
  //     llega, y la barra entera da un salto cuando aparece. Es lo primero
  //     que se ve al abrir la página, así que el salto se nota siempre.
  //
  //     El alt va VACÍO a propósito: el enlace ya dice "SYMPHOMED" al lado,
  //     y un alt="Symphomed" haría que un lector de pantalla leyera la marca
  //     dos veces seguidas.
  const puntos = '<span class="logo-mark"><i></i><i></i><i></i><i></i><i></i></span>';
  if (!cuerpo.includes(puntos)) throw new Error(`[${idioma}] no encontré los puntos del logo`);
  cuerpo = cuerpo.split(puntos).join(
    '<img class="logo-mark" src="/img/simbolo.webp" alt="" width="34" height="34">');

  // 9. Las anclas que quedaron con el nombre viejo de la sección. Un enlace a
  //    una sección que ya no se llama así no da error: simplemente no lleva a
  //    ningún lado, y eso solo se nota tocándolo.
  cuerpo = cuerpo
    .replace(/href="#platform"/g, 'href="#plataforma"')
    .replace(/href="#specialties"/g, 'href="#especialidades"')
    .replace(/href="#solutions"/g, 'href="#soluciones"')
    .replace(/href="#technology"/g, 'href="#tecnologia"')
    .replace(/href="#security"/g, 'href="#confianza"');

  // 10. El WhatsApp, con el saludo en el idioma de quien lo va a escribir.
  const wa = WA + "?text=" + encodeURIComponent(WA_TEXTO[idioma]);
  cuerpo = cuerpo.split("__WA__").join(wa);

  // Y la comprobación que lo habría atajado antes: toda ancla interna tiene
  // que apuntar a un id que exista de verdad en la página.
  const anclas = [...cuerpo.matchAll(/href="#([a-z0-9-]+)"/g)].map(m => m[1]);
  const ids = [...cuerpo.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]);
  const rotas = [...new Set(anclas)].filter(a => !ids.includes(a));
  if (rotas.length) throw new Error(`[${idioma}] anclas que no llevan a ningún lado: ${rotas.join(", ")}`);

  // Y que no haya quedado inglés del diseño colgando en la versión traducida.
  if (/__[A-Z]+__/.test(cuerpo.replace(/__NONCE__|__PLATAFORMA__/g, ""))) {
    throw new Error(`[${idioma}] quedó un marcador sin reemplazar`);
  }

  return { cuerpo, faltantes };
}

// ─── La cabecera ───────────────────────────────────────────────────────────
//
// ═══ QUÉ HACE hreflang Y POR QUÉ NO ALCANZA CON TRADUCIR ═══════════════════
//
// Sin estas tres líneas, Google ve tres páginas parecidas en tres idiomas y
// tiene que adivinar cuál mostrarle a quién —o, peor, decidir que dos son la
// misma y quedarse con una sola—. Con ellas sabe que son la MISMA página en
// tres versiones y le muestra a cada quien la suya.
//
// Las tres se apuntan entre sí, incluida a sí misma: es lo que pide la
// especificación y lo que más fácil se olvida. El x-default es a dónde mandar
// a quien no hable ninguno de los tres.
function cabecera(idioma) {
  const c = CABEZA[idioma];
  const alternativas = IDIOMAS.map(i =>
    `<link rel="alternate" hreflang="${i}" href="${SITIO}${RUTAS[i]}">`).join("\n");
  return `<!doctype html>
<html lang="${idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#03101a">
<title>${c.titulo}</title>
<meta name="description" content="${c.descripcion}">
<link rel="canonical" href="${SITIO}${RUTAS[idioma]}">
${alternativas}
<link rel="alternate" hreflang="x-default" href="${SITIO}${RUTAS.es}">
<meta property="og:title" content="${c.ogTitulo}">
<meta property="og:description" content="${c.ogDescripcion}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITIO}${RUTAS[idioma]}">
<meta property="og:locale" content="${{ es: "es_BO", pt: "pt_BR", en: "en_US" }[idioma]}">
<style>
@font-face {
  font-family: "InterVar"; src: url("/fonts/inter-variable.woff2") format("woff2");
  font-weight: 100 900; font-display: swap;
}
:root { color-scheme: dark; }
</style>
<style>
${css}
</style>
</head>`;
}

// ─── Los controles, que son una mejora y no el mecanismo ───────────────────
const CONTROLES = `<script nonce="__NONCE__">
"use strict";
// Las flechas y los puntos del carrusel. Todo lo que hay acá es OPCIONAL: las
// diapositivas ya se desplazan solas con scroll-snap. Si este script no corre
// —un nonce mal puesto, un error de sintaxis— se pierden los controles y no
// se pierde ni un módulo.
(function () {
  var pistas = document.getElementById("pistas");
  var puntos = document.getElementById("puntos");
  if (!pistas || !puntos) return;
  var laminas = [].slice.call(pistas.children);
  if (laminas.length < 2) return;

  var flechas = [].slice.call(document.querySelectorAll(".flecha"));
  // La etiqueta viaja en el HTML y no acá adentro: este script es el mismo en
  // los tres idiomas, y un "Ir al módulo 3" en español dentro de la versión
  // inglesa es justo lo que escucha quien navega con lector de pantalla.
  var irA = puntos.getAttribute("data-ir") || "";
  var actual = 0;

  laminas.forEach(function (_, i) {
    var b = document.createElement("button");
    b.className = "punto";
    b.type = "button";
    b.setAttribute("aria-label", irA + " " + (i + 1));
    b.addEventListener("click", function () { ir(i); });
    puntos.appendChild(b);
  });
  var bolitas = [].slice.call(puntos.children);

  function ir(i) {
    i = Math.max(0, Math.min(laminas.length - 1, i));
    // scrollLeft y no scrollIntoView: este último arrastra TAMBIÉN la página
    // vertical hasta la diapositiva, así que tocar una flecha daba un salto
    // de scroll además del desplazamiento lateral.
    pistas.scrollLeft = laminas[i].offsetLeft - laminas[0].offsetLeft;
  }

  function pintar() {
    // Se deduce del scroll y no de una variable propia, para que quede bien
    // también cuando el visitante arrastra con el dedo sin tocar los botones.
    var ancho = pistas.clientWidth || 1;
    actual = Math.round(pistas.scrollLeft / ancho);
    actual = Math.max(0, Math.min(laminas.length - 1, actual));
    bolitas.forEach(function (b, i) { b.setAttribute("aria-current", i === actual ? "true" : "false"); });
    flechas.forEach(function (f) {
      var d = Number(f.getAttribute("data-dir"));
      f.disabled = (d < 0 && actual === 0) || (d > 0 && actual === laminas.length - 1);
    });
  }

  flechas.forEach(function (f) {
    f.addEventListener("click", function () { ir(actual + Number(f.getAttribute("data-dir"))); });
  });

  pistas.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); ir(actual + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); ir(actual - 1); }
  });

  var esperando = false;
  pistas.addEventListener("scroll", function () {
    if (esperando) return;
    esperando = true;
    requestAnimationFrame(function () { esperando = false; pintar(); });
  }, { passive: true });
  window.addEventListener("resize", pintar);
  pintar();
})();

// Las pestañas de tecnología. Sin este script se ven los seis resúmenes uno
// debajo del otro —una lista, que se lee bien—; con él, el panel muestra el
// de la pestaña activa.
(function () {
  var caja = document.getElementById("tecnos");
  var panel = document.getElementById("tecnoPanel");
  if (!caja || !panel) return;
  var pestanas = [].slice.call(caja.children);
  var detalles = [].slice.call(panel.children);
  if (pestanas.length !== detalles.length) return;

  function activar(i) {
    pestanas.forEach(function (p, j) { p.setAttribute("aria-selected", j === i ? "true" : "false"); });
    detalles.forEach(function (d, j) {
      if (j === i) d.removeAttribute("data-oculto");
      else d.setAttribute("data-oculto", "");
    });
  }

  pestanas.forEach(function (p, i) {
    // mouseenter y no hover de CSS: el panel es un hermano y el resumen que
    // hay que mostrar depende de CUÁL pestaña se señaló, no de si alguna lo
    // está. Eso no se puede expresar en CSS sin acoplar los seis selectores.
    p.addEventListener("mouseenter", function () { activar(i); });
    p.addEventListener("focus", function () { activar(i); });
    p.addEventListener("click", function () { activar(i); });
  });

  activar(0);
})();
</script>`;

// ─── Salida ────────────────────────────────────────────────────────────────
let problemas = 0;
for (const idioma of IDIOMAS) {
  const { cuerpo, faltantes } = construir(idioma);
  const html = `${cabecera(idioma)}
<body>${cuerpo}
${CONTROLES}
</body>
</html>
`;
  const archivo = path.join(RAIZ, "vistas", `inicio.${idioma}.html`);
  fs.writeFileSync(archivo, html);
  console.log(`✅ vistas/inicio.${idioma}.html — ${html.length} bytes`);
  if (faltantes.length) {
    problemas += faltantes.length;
    console.log(`   ⚠️  ${faltantes.length} frase(s) que NO se encontraron en el diseño:`);
    faltantes.forEach(s => console.log("      ·", s));
  }
}

// El archivo viejo de un solo idioma. Se borra a propósito y no se deja
// "por las dudas": si queda, routes/inicio.js podría seguir sirviéndolo sin
// que nadie se entere, y la página en español se congelaría en la versión
// anterior mientras las otras dos avanzan.
const viejo = path.join(RAIZ, "vistas", "inicio.html");
if (fs.existsSync(viejo)) {
  fs.unlinkSync(viejo);
  console.log("🗑  vistas/inicio.html (la versión de un solo idioma) — borrado");
}

if (problemas) {
  console.log(`\n💥 ${problemas} frase(s) sin aplicar`);
  process.exit(1);
}
console.log("\n🏁 los tres idiomas, completos");
