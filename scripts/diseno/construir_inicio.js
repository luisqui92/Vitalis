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

  // — Soluciones —
  ['id="solutions"', 'id="soluciones"'],
  ["SPECIALIZED SOLUTIONS", "MÓDULOS POR ESPECIALIDAD"],
  ["Dental, with its own language.", "Odontología, con su propio lenguaje."],
  ["The interactive odontogram and specialized modules make dental care more precise, complete and efficient.",
   "El odontograma interactivo y los módulos propios hacen que la ficha dental sea más precisa y más rápida de llenar."],
  ["<b>Tooth 36</b>", "<b>Pieza 36</b>"],
  ["Clinical history · Treatments · Evolution", "Historia · Tratamientos · Evolución"],
  ["SYMPHOMED PET", "SYMPHOMED PET"],
  ["The same intelligence.<br>A different patient.", "La misma inteligencia.<br>Otro paciente."],
  ["Complete clinical records for dogs and cats, with specialized tools and visual anatomy.",
   "Historia clínica completa para perros y gatos, con herramientas propias y anatomía visual."],

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
<body>${cuerpo}</body>
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
