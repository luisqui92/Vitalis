// Construye vistas/inicio.html a partir del diseño que mandó el usuario.
//
// El CSS se copia VERBATIM del archivo original: el pedido fue "tal cual", y
// una transcripción a mano de 30 líneas de CSS minificado es la forma más
// fácil de arruinar un diseño sin darse cuenta. Solo se tocan las cosas que
// lo romperían en el servidor:
//
//   1. la foto de Unsplash → alojada acá (la CSP solo admite img-src 'self')
//   2. la tipografía Inter → la variable que ya está en /fonts
//   3. los enlaces muertos (#, mailto) → plataforma y WhatsApp
//   4. el idioma → español, que es quien lo va a leer
const fs = require("fs");
const path = require("path");

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
@media(max-width:480px){
  /* "SYMPHOMED" con letter-spacing:3px es ancho, y la barra reparte con
     space-between: abajo de 480 el logo termina tocando el selector de idioma
     y se lee "SYMPHOMEDES". Se achica el logo y se saca el selector, que hoy
     no hace nada (hay un solo idioma). */
  .logo{font-size:13px;letter-spacing:2px}
  .nav .navright{gap:12px}
  .nav .navright span{display:none}
  .btn{padding:11px 16px}
}
@media(max-width:430px){
  /* A 43px el titular llega justo al borde del contenedor y queda pegado.
     Dos píxeles menos de cuerpo le devuelven el margen. */
  .hero h1{font-size:38px;letter-spacing:-2px}
}
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

// ─── El cuerpo, traducido ──────────────────────────────────────────────────
let cuerpo = original.slice(original.indexOf("<body>") + 6, original.indexOf("</body>"));

const WA = "https://wa.me/59164637067";
const WA_DEMO = WA + "?text=Hola%2C%20quiero%20ver%20una%20demostraci%C3%B3n%20de%20Symphomed";

// Orden: de la cadena más larga a la más corta, para que una traducción no
// se coma un pedazo de otra que todavía no se aplicó.
const T = [
  // — Navegación —
  ['<a href="#platform">Platform</a>',
   '<a href="#plataforma">Plataforma</a><a href="#agenda">Agenda</a>'],
  ['<a href="#specialties">Specialties</a>', '<a href="#especialidades">Especialidades</a>'],
  ['<a href="#solutions">Solutions</a>', '<a href="#soluciones">Soluciones</a>'],
  ['<a href="#technology">Technology</a>', '<a href="#tecnologia">Tecnología</a>'],
  ['<a href="#security">Security</a>', '<a href="#confianza">Confianza</a>'],
  ['<span>EN⌄</span>', '<span>ES</span>'],
  ['<a href="#">Log in</a>', '<a href="__PLATAFORMA__">Ingresar</a>'],

  // — Portada —
  ["THE INTELLIGENCE LAYER FOR HEALTHCARE", "LA CAPA DE INTELIGENCIA PARA LA SALUD"],
  // El largo importa tanto como el sentido: el titular vive en una columna del
  // 43% a 68px con letter-spacing negativo. La primera traducción ("La consulta
  // que habla / La historia que se escribe sola") se desbordaba y se montaba
  // sobre la foto. Esta tiene casi los mismos caracteres que el inglés, así que
  // cae en el lugar para el que se diseñó la retícula.
  ["Clinical conversations.<br><span>Intelligent care.</span>",
   "Conversación clínica.<br><span>Historia inteligente.</span>"],
  ["Symphomed transforms healthcare conversations into structured clinical intelligence — helping professionals capture, understand and connect information throughout the patient journey.",
   "Symphomed convierte la conversación de la consulta en información clínica estructurada: la nota, la receta y el control siguiente quedan listos sin que el médico escriba nada."],
  ["Explore the platform", "Conocer la plataforma"],
  ["More time with patients", "Más tiempo con el paciente"],
  ["Better clinical information", "Mejor información clínica"],
  ["Continuity of care", "Continuidad del cuidado"],

  // — Tarjetas de la portada —
  ["<b>Patient</b>“I've had this pain for about three weeks, especially in the morning...”",
   "<b>Paciente</b>“Me duele hace unas tres semanas, sobre todo en las mañanas…”"],
  ["<label>Chief complaint</label><div>Back pain</div>", "<label>Motivo</label><div>Dolor lumbar</div>"],
  ["<label>Duration</label><div>3 weeks</div>", "<label>Tiempo</label><div>3 semanas</div>"],
  ["<label>Medication</label><div>Ibuprofen 400 mg</div>", "<label>Medicación</label><div>Ibuprofeno 400 mg</div>"],
  ["<label>Relevant history</label><div>Previous episode</div>", "<label>Antecedentes</label><div>Episodio previo</div>"],
  ["<h4>Clinical record</h4>", "<h4>Ficha del paciente</h4>"],
  ["<b>Clinical note</b><br>Patient reports lumbar pain of 3 weeks duration, worse in the morning. No radiation. Prescribed follow-up and clinical review.",
   "<b>Nota clínica</b><br>Refiere dolor lumbar de 3 semanas, de predominio matinal. Sin irradiación. Se indica control y revisión clínica."],
  ["✓ Save to patient record", "✓ Guardar en la ficha"],

  // — Cómo funciona —
  ["HOW IT WORKS", "CÓMO FUNCIONA"],
  ["From conversation<br>to clinical intelligence.", "De la conversación<br>a la historia clínica."],
  ["Symphomed listens, understands and structures each consultation automatically, turning unstructured conversations into actionable clinical data.",
   "Symphomed escucha, entiende y ordena cada consulta de forma automática, y convierte lo que se habló en datos clínicos que sirven."],
  ["<h3>1. Listen</h3><p>Captures the clinical conversation.</p>",
   "<h3>1. Escucha</h3><p>Capta la conversación de la consulta.</p>"],
  ["<h3>2. Understand</h3><p>Identifies relevant clinical information.</p>",
   "<h3>2. Entiende</h3><p>Identifica la información clínica relevante.</p>"],
  ["<h3>3. Structure</h3><p>Generates organized clinical data.</p>",
   "<h3>3. Ordena</h3><p>Genera la nota clínica estructurada.</p>"],
  ["<h3>4. Connect</h3><p>Updates the patient's history for continuity.</p>",
   "<h3>4. Conecta</h3><p>Actualiza la historia del paciente para el próximo control.</p>"],

  // — Plataforma —
  ['id="platform"', 'id="plataforma"'],
  ["<span>Clinical workspace</span>", "<span>Consultorio</span>"],
  ["<div>Patient</div><div>Consultation</div><div>Clinical data</div><div>History</div><div>Kardex</div><div>Prescriptions</div>",
   "<div>Paciente</div><div>Consulta</div><div>Datos clínicos</div><div>Historia</div><div>Kardex</div><div>Recetas</div>"],
  ["<h4>Clinical data</h4>", "<h4>Datos clínicos</h4>"],
  ["<b>Chief complaint</b><span>Headache</span>", "<b>Motivo</b><span>Cefalea</span>"],
  ["<b>Duration</b><span>3 weeks</span>", "<b>Tiempo</b><span>3 semanas</span>"],
  ["<b>Medication</b><span>Ibuprofen 400 mg</span>", "<b>Medicación</b><span>Ibuprofeno 400 mg</span>"],
  ["<b>Assessment</b><span>Tension headache</span>", "<b>Impresión</b><span>Cefalea tensional</span>"],
  ["<b>History</b><span>No relevant history</span>", "<b>Antecedentes</b><span>Sin antecedentes</span>"],
  ["<b>Plan</b><span>Follow-up</span>", "<b>Plan</b><span>Control</span>"],
  ["A COMPLETE CLINICAL PICTURE", "LA FICHA COMPLETA"],
  ["One conversation.<br>A complete clinical picture.", "Una consulta.<br>La ficha completa."],
  ["Symphomed captures the conversation, identifies key information and generates structured clinical data — ready for review and integration with the patient's record.",
   "Symphomed capta la conversación, reconoce lo importante y arma la nota clínica estructurada, lista para que el médico la revise y la guarde en la ficha."],
  ["▶ See it in action", "▶ Ver una demostración"],

  // — Especialidades —
  ['id="specialties"', 'id="especialidades"'],
  ["ONE PLATFORM. MULTIPLE HEALTHCARE EXPERIENCES.", "UNA PLATAFORMA. TODAS LAS ESPECIALIDADES."],
  ["Built for the entire healthcare ecosystem.", "Pensado para todo el consultorio."],
  ["From general practice to specialized care, Symphomed adapts to every professional, every specialty and every setting.",
   "De la medicina general a la especialidad, Symphomed se adapta a cada profesional, cada especialidad y cada consultorio."],
  [">Medicine<", ">Medicina general<"],
  [">Dental<", ">Odontología<"],
  [">Dermatology<", ">Dermatología<"],
  [">Ophthalmology<", ">Oftalmología<"],
  [">Aesthetics<", ">Estética<"],
  [">Surgery<", ">Cirugía<"],
  [">Gynecology<", ">Ginecología<"],
  [">Pediatrics<", ">Pediatría<"],
  [">Physiotherapy<", ">Fisioterapia<"],
  // Psicología y psiquiatría no estaban en el diseño y sí en el producto: el
  // catálogo de instrumentos ya trae WISC-V, WPPSI-IV, Vineland-3, Conners-4
  // y ADOS-2, que son herramientas de psicología clínica.
  // Ojo con el orden: esta regla corre ANTES de que ">Veterinary<" se
  // traduzca, así que tiene que buscar el texto en inglés. Buscarlo en
  // español no da error — simplemente no encuentra nada y las dos
  // especialidades nuevas no aparecen, que fue lo que pasó la primera vez.
  ['<div class="specialty"><div class="sicon">🐾</div>Veterinary</div>',
   '<div class="specialty"><div class="sicon">◈</div>Psicología</div>' +
   '<div class="specialty"><div class="sicon">❋</div>Psiquiatría</div>' +
   '<div class="specialty"><div class="sicon">🐾</div>Veterinary</div>'],
  [">Veterinary<", ">Veterinaria<"],
  [">Telehealth<", ">Teleconsulta<"],
  [">All specialties<", ">Todas<"],

  // — Soluciones — el bloque entero se reemplaza por el carrusel más abajo,
  //   así que acá no hay nada que traducir.

  // — Confianza —
  ['id="security"', 'id="confianza"'],
  ["TRUST &amp; SCALE", "CONFIANZA Y ESCALA"],
  ["TRUST & SCALE", "CONFIANZA Y ESCALA"],
  ["Intelligence that scales with your organization.", "Crece con el consultorio."],
  ["From a single professional to large healthcare networks, Symphomed is designed to grow with your operation.",
   "De un solo profesional a una red de centros de salud, Symphomed está pensado para acompañar el crecimiento."],
  ["<small>Professional</small>", "<small>Profesional</small>"],
  ["<small>Professionals</small>", "<small>Profesionales</small>"],
  ["<small>Healthcare network</small>", "<small>Red de salud</small>"],

  // — Tecnología —
  ['id="technology"', 'id="tecnologia"'],
  [">TECHNOLOGY<", ">TECNOLOGÍA<"],
  ["Built for intelligent healthcare.", "Construido para la salud."],
  ["AI, voice, structured clinical data and integrations brought together in one healthcare intelligence platform.",
   "Inteligencia artificial, voz, datos clínicos estructurados e integraciones, en una sola plataforma."],
  [">AI Intelligence<", ">Inteligencia artificial<"],
  [">Voice<", ">Voz<"],
  [">Clinical NLP<", ">Lenguaje clínico<"],
  [">Structured Data<", ">Datos estructurados<"],
  [">API<", ">API<"],
  [">Security<", ">Seguridad<"],

  // — Cierre —
  ["GLOBAL HEALTHCARE INTELLIGENCE", "EMPEZAR"],
  ["Healthcare has conversations every day.<br>",
   "En la salud se conversa todos los días.<br>"],
  ["Symphomed turns them into intelligence.", "Symphomed lo convierte en historia clínica."],
  ["Discover how Symphomed can become the intelligence layer behind your healthcare organization.",
   "Escríbanos por WhatsApp y le mostramos cómo funciona con un caso real, en quince minutos. Las primeras 4 consultas no se cobran."],

  // — Pie —
  ['<a href="#demo">Contact</a>', '<a href="#demo">Contacto</a>'],
  ["© 2026 Symphomed", "© 2026 Symphomed · Bolivia y Brasil"],

  // — Llamadas a la acción: van a WhatsApp, que es donde contesta una persona —
  ['<a class="btn btn-primary" href="#demo">Book a demo</a>',
   `<a class="btn btn-primary" href="${WA_DEMO}">Escríbanos</a>`],
  ['<a class="btn btn-primary" href="#demo">Book a demo →</a>',
   `<a class="btn btn-primary" href="${WA_DEMO}">Escríbanos por WhatsApp →</a>`],
  ['<a class="btn btn-primary" href="mailto:demo@symphomed.com">Book a demo →</a>',
   `<a class="btn btn-primary" href="${WA_DEMO}">Escríbanos por WhatsApp →</a>`],
];

// ─── El carrusel de módulos ────────────────────────────────────────────────
//
// El diseño mostraba dos módulos —odontología y veterinaria— en un split fijo.
// Son siete los que existen, y los cinco que faltaban son justamente los que
// hacen que un pediatra o una ginecóloga se reconozcan en la página.
//
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
const MODULOS = [
  {
    k: "ODONTOLOGÍA", t: "El odontograma, pieza por pieza.",
    p: "Cada diente con su historia, sus tratamientos y su evolución. La ficha dental deja de ser un dibujo a mano en una hoja.",
    v: `<div class="teeth">${
      ["11","12","13","14","15","16","17","18","21","22","23","24","25","26","27","28",
       "31","32","33","34","35","36","37","38","41","42","43","44","45","46","47","48"]
        .map(n => `<div class="tooth${n === "36" ? " marcada" : ""}">${n}</div>`).join("")
    }</div><b>Pieza 36</b><p class="demo-pie">Caries oclusal · Tratamiento de conducto · En control</p>`,
  },
  {
    k: "PEDIATRÍA", t: "Las curvas, calculadas solas.",
    p: "Peso, talla y perímetro cefálico se grafican sobre los percentiles de la OMS a medida que se cargan. El percentil no se busca en una tabla: ya está.",
    v: `<svg viewBox="0 0 260 130" width="100%" height="130" role="img" aria-label="Curva de peso sobre percentiles">
<polyline points="10,108 60,88 110,74 160,63 210,54 250,48" fill="none" stroke="#2d6c85" stroke-width="1.5"/>
<polyline points="10,116 60,99 110,87 160,78 210,71 250,66" fill="none" stroke="#2d6c85" stroke-width="1.5" stroke-dasharray="3 3"/>
<polyline points="10,99 60,76 110,60 160,47 210,37 250,30" fill="none" stroke="#2d6c85" stroke-width="1.5" stroke-dasharray="3 3"/>
<polyline points="10,110 60,90 110,73 160,60 210,52" fill="none" stroke="#5bddfa" stroke-width="2.5"/>
<circle cx="210" cy="52" r="4" fill="#5bddfa"/>
<text x="10" y="126" fill="#8da7b5" font-size="8">0 m</text>
<text x="196" y="126" fill="#8da7b5" font-size="8">24 m</text>
<text x="228" y="22" fill="#2d6c85" font-size="8">P97</text>
<text x="228" y="62" fill="#2d6c85" font-size="8">P50</text>
</svg><b>Peso · percentil 62</b><p class="demo-pie">12,4 kg a los 24 meses · dentro de lo esperado</p>`,
  },
  {
    k: "NEURODESARROLLO", t: "Los instrumentos, con su puntaje.",
    p: "ADOS-2, WISC-V, Vineland-3, Conners-4 y M-CHAT-R/F, cada uno con sus módulos y sus puntajes. Quedan en la ficha y se comparan entre aplicaciones.",
    v: `<div class="row"><label>ADOS-2 · Módulo 2</label><div>Comparación 7/10</div></div>
<div class="row"><label>WISC-V</label><div>CI total 94</div></div>
<div class="row"><label>Vineland-3</label><div>Compuesto 88</div></div>
<div class="row"><label>Conners-4 · Padres</label><div>Inatención T 68</div></div>
<p class="demo-pie">Aplicado el 14/03 · comparado con la evaluación anterior</p>`,
  },
  {
    k: "GINECOLOGÍA Y OBSTETRICIA", t: "El control prenatal, semana a semana.",
    p: "Altura uterina, frecuencia cardíaca fetal y presión en cada control, sobre la misma línea de tiempo. Y el examen ginecológico con su mapa propio.",
    v: `<div class="row"><label>Semana</label><div>28 · gesta 2, para 1</div></div>
<div class="row"><label>Altura uterina</label><div>27 cm</div></div>
<div class="row"><label>FCF</label><div>142 lpm</div></div>
<div class="row"><label>Presión</label><div>118/74 mmHg</div></div>
<p class="demo-pie">Próximo control en 3 semanas · curva de tolerancia pendiente</p>`,
  },
  {
    k: "OFTALMOLOGÍA", t: "La agudeza y la refracción, en su ficha.",
    p: "Cada ojo con su agudeza, su refracción y su presión intraocular, comparables contra el control anterior sin volver a leer la historia entera.",
    v: `<div class="row"><label>Agudeza OD</label><div>20/25</div></div>
<div class="row"><label>Agudeza OI</label><div>20/40</div></div>
<div class="row"><label>Refracción OI</label><div>−1,25 −0,50 × 180°</div></div>
<div class="row"><label>PIO</label><div>14 / 15 mmHg</div></div>
<p class="demo-pie">El OI bajó de 20/25 a 20/40 desde el control de marzo</p>`,
  },
  {
    k: "IMÁGENES Y LABORATORIO", t: "Los estudios, dentro de la ficha.",
    p: "Las radiografías se abren en un visor que permite medir, y los laboratorios quedan marcados como pendientes hasta que vuelven. El equipo de rayos sube directo.",
    v: `<div class="visor"><span class="visor-regla"></span><span class="visor-medida">34,2 mm</span></div>
<div class="row"><label>Rx tórax</label><div>Recibida · 14/03</div></div>
<div class="row"><label>Creatinina</label><div>Pendiente</div></div>
<p class="demo-pie">Lo pendiente aparece en el panel hasta que llega</p>`,
  },
  {
    k: "SYMPHOMED PET", t: "La misma inteligencia. Otro paciente.",
    p: "Historia clínica completa para perros y gatos, con anatomía visual, esquema de vacunas propio y las particularidades de cada especie.",
    v: `<div class="row"><label>Paciente</label><div>Mora · mestiza, 6 años</div></div>
<div class="row"><label>Peso</label><div>18,4 kg</div></div>
<div class="row"><label>Vacunas</label><div>Quíntuple al día · antirrábica en 2 meses</div></div>
<p class="demo-pie">Ficha por especie, no una ficha humana adaptada</p>`,
    pet: true,
  },
];

const CARRUSEL = `
<section class="dark" id="soluciones">
<div class="container"><div class="section-head"><div class="eyebrow">MÓDULOS POR ESPECIALIDAD</div><h2>Cada especialidad,<br>con su propia ficha.</h2><p>Una nota de pediatría no se parece a una de odontología, y las fichas tampoco. Estos son los módulos que ya están funcionando.</p></div></div>
<div class="carrusel">
<div class="pistas" id="pistas" tabindex="0" role="region" aria-label="Módulos por especialidad">
${MODULOS.map((m, i) => `<article class="modulo" aria-label="${i + 1} de ${MODULOS.length}: ${m.k}"><div class="container modulo-in">
<div class="modulo-txt"><div class="eyebrow">${m.k}</div><h3 class="modulo-t">${m.t}</h3><p>${m.p}</p></div>
<div class="demo${m.pet ? " pet-demo" : ""}">${m.v}</div>
</div></article>`).join("")}
</div>
<div class="container mandos">
<button class="flecha" type="button" data-dir="-1" aria-label="Módulo anterior">←</button>
<div class="puntos" id="puntos"></div>
<button class="flecha" type="button" data-dir="1" aria-label="Módulo siguiente">→</button>
</div>
</div>
</section>`;

// Se reemplaza el bloque entero del diseño, con sus dos paneles fijos.
const iSplit = cuerpo.indexOf('<section class="split" id="solutions">');
const fSplit = cuerpo.indexOf("</section>", cuerpo.indexOf('<div class="panel panel-light pet">')) + 10;
if (iSplit < 0 || fSplit < 10) throw new Error("no encontré la sección de soluciones del diseño original");
cuerpo = cuerpo.slice(0, iSplit) + CARRUSEL + cuerpo.slice(fSplit);

const sinAplicar = [];
for (const [de, a] of T) {
  if (!cuerpo.includes(de)) { sinAplicar.push(de.slice(0, 55)); continue; }
  cuerpo = cuerpo.split(de).join(a);
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
const AGENDA = `
<section class="light" id="agenda"><div class="container">
<div class="section-head"><div class="eyebrow">LA AGENDA</div><h2>Antes y después<br>de la consulta.</h2><p>Symphomed no empieza cuando el paciente entra ni termina cuando se va: la reserva y el control siguiente también se resuelven solos, por WhatsApp.</p></div>
<div class="steps steps-3">
<div class="step"><div class="icon">✆</div><h3>El paciente reserva solo</h3><p>Escribe al WhatsApp del consultorio, ve los horarios que están libres de verdad y elige. La cita aparece en la agenda sin que nadie atienda el teléfono.</p></div>
<div class="step"><div class="icon">✓</div><h3>Queda confirmada al instante</h3><p>Recibe la confirmación en el momento. Si necesita cancelar, escribe «cancelar» ahí mismo y el horario se libera para otro paciente.</p></div>
<div class="step"><div class="icon">↻</div><h3>El seguimiento sigue solo</h3><p>Al cerrar la consulta, Symphomed propone la fecha del próximo control y le manda al paciente un enlace para que elija su horario.</p></div>
</div>
<div class="recuerdos">
<div class="recuerdo"><b>Reconsultas</b><span>El control que se acordó en la consulta, con la fecha que corresponde.</span></div>
<div class="recuerdo"><b>Laboratorios</b><span>Los estudios que se pidieron y todavía no volvieron a la ficha.</span></div>
<div class="recuerdo"><b>Medicación</b><span>Cuándo empieza y cuándo termina cada tratamiento, con su dosis y frecuencia.</span></div>
<div class="recuerdo"><b>Vacunas</b><span>La dosis siguiente y las que quedaron pendientes del esquema.</span></div>
<div class="recuerdo"><b>Controles por edad</b><span>Lo que toca revisar según la edad del paciente, sin depender de la memoria.</span></div>
</div>
</div></section>
`;
cuerpo = cuerpo.replace('<section id="especialidades">', AGENDA + '<section id="especialidades">');

// El logo del pie y el de arriba llevan al inicio, no a "#".
cuerpo = cuerpo.replace('<a class="logo" href="#">', '<a class="logo" href="/">');

// Las anclas que quedaron con el nombre viejo de la sección. Un enlace a una
// sección que ya no se llama así no da error: simplemente no lleva a ningún
// lado, y eso solo se nota tocándolo.
cuerpo = cuerpo
  .replace(/href="#platform"/g, 'href="#plataforma"')
  .replace(/href="#specialties"/g, 'href="#especialidades"')
  .replace(/href="#solutions"/g, 'href="#soluciones"')
  .replace(/href="#technology"/g, 'href="#tecnologia"')
  .replace(/href="#security"/g, 'href="#confianza"');

// Y la comprobación que lo habría atajado antes: todo ancla interna tiene que
// apuntar a un id que exista de verdad en la página.
const anclas = [...cuerpo.matchAll(/href="#([a-z0-9-]+)"/g)].map(m => m[1]);
const ids = [...cuerpo.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]);
const rotas = [...new Set(anclas)].filter(a => !ids.includes(a));
if (rotas.length) throw new Error("anclas que no llevan a ningún lado: " + rotas.join(", "));

// ─── Salida ────────────────────────────────────────────────────────────────
const cabeza = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#03101a">
<title>Symphomed — la capa de inteligencia para la salud</title>
<meta name="description" content="Symphomed convierte la conversación de la consulta en información clínica estructurada: la nota, la receta y el control quedan listos sin que el médico escriba nada.">
<meta property="og:title" content="Symphomed — la capa de inteligencia para la salud">
<meta property="og:description" content="La nota clínica, la receta y el kardex salen de la consulta sin tipear. Las primeras 4 consultas no se cobran.">
<meta property="og:type" content="website">
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
</head>
<body>${cuerpo}
<script nonce="__NONCE__">
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
  var actual = 0;

  laminas.forEach(function (_, i) {
    var b = document.createElement("button");
    b.className = "punto";
    b.type = "button";
    b.setAttribute("aria-label", "Ir al módulo " + (i + 1));
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
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(RAIZ, "vistas", "inicio.html"), cabeza);
console.log("escrito vistas/inicio.html —", cabeza.length, "bytes");
if (sinAplicar.length) {
  console.log("\n⚠️  NO se encontraron estas cadenas (quedaron en inglés):");
  sinAplicar.forEach(s => console.log("   ·", s));
} else {
  console.log("todas las traducciones se aplicaron");
}
