// Prueba de que pacientes.js y consultas.js siguen pintando exactamente lo
// mismo en español, y que en portugués cambian de verdad.
//
// Se compara contra la versión de main (antes de i18n), con los mismos datos.
const vm = require("vm");
const fs = require("fs");
const { execSync } = require("child_process");

const RAIZ = require("path").join(__dirname, "..", "..");

const PACIENTE = {
  _id: "p1", nombre: "María Fernández", fechaNacimiento: "1985-04-12", sexo: "Femenino",
  telefono: "59171234567", notas: "Alérgica a penicilina",
  antecedentesPersonales: ["Hipertensión desde 2019", "Asma"],
  antecedentesFamiliares: [{ parentesco: "Madre", condicion: "Diabetes tipo 2" }],
  briefClinicoEstado: "completado",
  briefClinico: {
    estadoActual: "Estable", cambiosDesdeUltimaConsulta: "Mejoró la tos",
    medicamentosActivos: ["Losartán 50mg"], examenesPendientes: ["Hemograma"],
    alertas: ["Alergia a penicilina"], factoresRiesgo: ["Tabaquismo"],
    preguntasSugeridas: ["¿Sigue fumando?"], diagnosticosDiferenciales: ["EPOC"],
  },
};
const CONSULTAS = [{
  _id: "c1", estado: "completado", createdAt: "2026-08-01T14:30:00Z",
  notaClinica: { motivoConsulta: "Tos persistente", diagnostico: "Bronquitis" },
}];
const MEDICAMENTOS = [
  { _id: "m1", nombre: "Losartán", dosis: "50mg", frecuencia: "1 vez al día", notas: "Con comida" },
  { _id: "m2", nombre: "Amoxicilina", dosis: "500mg", fechaFin: "2026-07-01T00:00:00Z" },
];
const VACUNAS = [{ _id: "v1", nombre: "Influenza", dosis: "Refuerzo", fecha: "2026-05-10T00:00:00Z" }];

const CONSULTA_DETALLE = {
  _id: "c1", pacienteId: "p1", pacienteNombre: "María Fernández",
  createdAt: "2026-08-01T14:30:00Z", duracionSegundos: 900,
  estado: "completado", notaClinicaEstado: "completado",
  segmentos: [{ hablante: "A", texto: "Buenos días" }, { hablante: "B", texto: "Me duele la garganta" }],
  notaClinica: {
    motivoConsulta: "Tos persistente", sintomas: ["tos", "fiebre"],
    antecedentesRelevantes: "Asma", diagnostico: "Bronquitis",
    diagnosticosDiferenciales: ["Neumonía"], plan: "Reposo e hidratación",
    medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "500mg", frecuencia: "c/8h" }],
    examenesSolicitados: ["Radiografía de tórax"], proximoControl: "En 7 días",
    reconsultaSugerida: { fechaHora: "2026-08-08T14:00:00Z", estado: "pendiente", textoOriginal: "vuelva en una semana" },
    tratamientosSugeridos: [{ _id: "t1", estado: "pendiente", itemMencionado: "corona", catalogoNombreSugerido: "Corona", piezaFdi: 36, precioCatalogo: 800 }],
    antecedentesPersonalesNuevos: ["Tabaquismo"],
    antecedentesFamiliaresNuevos: [{ parentesco: "Padre", condicion: "Hipertensión" }],
    vacunasMencionadas: [{ nombre: "Neumococo", dosis: "1ra" }],
  },
};

function entorno(idioma) {
  const app = { innerHTML: "" };
  const nodo = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, {
    get: (o, k) => (k in o ? o[k] : (k === "value" ? "" : undefined)),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const s = {
    app, console, MEDICO_NOMBRE: "Dra. Camila", MEDICO_TIPO_ESPECIALIDAD: "medicina_general",
    // La moneda de la cuenta: decide qué se dibuja donde Brasil trabaja
    // distinto (la receta va por Memed). "BOB" es el caso de siempre.
    MEDICO_MONEDA: "BOB",
    headerSub: { textContent: "" }, btnLogout: { style: {} }, btnAsistente: { style: {} },
    esc: (x) => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    document: { getElementById: () => nodo(), querySelectorAll: () => [], querySelector: () => nodo(), createElement: () => nodo(), documentElement: {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    edadDesde: (f) => (f ? 41 : null),
    edadPediatricaTexto: () => "41 años",
    iniciales: (n) => "MF",
    fmt: (x) => "05:00",
    ICONOS: new Proxy({}, { get: () => "<svg/>" }),
    tabsKardexPara: () => ({ paciente: { icono: "<svg/>", label: "Paciente" }, consultas: { icono: "<svg/>", label: "Consultas" } }),
    tabMemoriaHtml: () => "", tabEvolucionHtml: () => "", tabCrecimientoHtml: () => "",
    tabEstudiosHtml: () => "", tabRecetasHtml: () => "",
    detenerPolling: () => {}, nuevaSeriePantalla: () => 1, seriePantallaVigente: () => true,
    logout: () => {}, api: async () => ({}), setTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
    renderDashboard: () => {}, renderAgenda: () => {}, renderRecordatorios: () => {}, renderVincular: () => {},
    renderSeguridad: () => {}, renderBandejaDicom: () => {}, renderPacienteDetalle: () => {},
    renderNuevaConsulta: () => {}, renderDetalle: () => {}, renderReceta: () => {},
    crearIndicadorAudio: () => ({ iniciar() {}, detener() {} }),
    crearTranscriptorEnVivo: () => ({ iniciar() {}, detener() {} }),
    // El respaldo de grabaciones en el teléfono (audio.js): en el arnés no
    // hay IndexedDB ni nada pendiente.
    ofrecerGrabacionesPendientes: () => {},
    navigator: { mediaDevices: {} }, alert: () => {}, confirm: () => true,
    wireTabMemoria: () => {}, wireTabEvolucion: () => {}, wireTabEstudios: () => {},
    wireTabRecetas: () => {}, wireTabCrecimiento: () => {},
    renderTabOdontograma: () => {}, renderTabExamenOcular: () => {}, renderTabMapaGineco: () => {},
    renderTabMapaCorporal: () => {}, renderTabPlanTratamiento: () => {}, renderTabEmbarazo: () => {},
    renderTabPerfilNeuro: () => {}, renderTabObjetivosNeuro: () => {}, renderTabVigilancia: () => {},
    renderTabInstrumentos: () => {}, renderTabInformes: () => {},
    // Persona compartida (personas.js). El bloque se carga aparte y sin
    // await, así que para comparar el pintado alcanza con el hueco.
    bloquePersonaHtml: () => `<div id="personaBox"></div>`,
    cargarBloquePersona: () => {}, engancharBuscadorPersonaEnAlta: () => {},
    vincularPersonaElegidaEnAlta: async () => {},
  };
  vm.createContext(s);
  // Los puntos de extensión (public/js/extensiones.js) son del núcleo, como
  // i18n.js. Sin ningún módulo cargado, cada lugar queda vacío y cada permiso
  // dice que sí: la pantalla de siempre.
  vm.runInContext(fs.readFileSync(`${RAIZ}/public/js/extensiones.js`, "utf8"), s);
  if (idioma) {
    for (const f of ["public/js/i18n.js", "public/i18n/es.js", "public/i18n/pt.js"]) {
      vm.runInContext(fs.readFileSync(`${RAIZ}/${f}`, "utf8"), s);
    }
    vm.runInContext(`MEDICO_IDIOMA = ${JSON.stringify(idioma)};`, s);
  } else {
    // La versión vieja no tenía t(); pero sí usaba localeActual en ninguna
    // parte, así que no hace falta nada.
  }
  return s;
}

function pintarPacientes(codigo, idioma) {
  const s = entorno(idioma);
  vm.runInContext(codigo, s);
  const out = {};
  vm.runInContext("renderNuevoPaciente();", s); out.nuevo = s.app.innerHTML;
  for (const tab of ["paciente", "consultas", "medicamentos", "antecedentes", "vacunas"]) {
    vm.runInContext(
      `pintarKardex(${JSON.stringify(PACIENTE)}, ${JSON.stringify(CONSULTAS)}, ${JSON.stringify(MEDICAMENTOS)}, ${JSON.stringify(VACUNAS)}, [], [], [], ${JSON.stringify(tab)});`, s);
    out["kardex_" + tab] = s.app.innerHTML;
  }
  return out;
}

function pintarConsultas(codigoConsultas, idioma) {
  const s = entorno(idioma);
  vm.runInContext(codigoConsultas, s);
  const out = {};
  vm.runInContext('renderNuevaConsulta("p1", "María Fernández");', s); out.nueva = s.app.innerHTML;
  for (const v of [{ vinculado: false, codigo: "482913" }, { vinculado: true, estado: "armado" }, { vinculado: true, estado: "grabando" }]) {
    vm.runInContext(`pintarControlRemoto(${JSON.stringify(v)}, "p1", "María Fernández");`, s);
    out["remoto_" + (v.estado || "sinvincular")] = s.app.innerHTML;
  }
  return out;
}

// El hueco donde después se pinta la persona de la clínica es un agregado
// deliberado (ver personas.js), así que se descuenta antes de comparar —
// mismo criterio que el selector de idioma en probar_auth.js.
// Son dos: el aviso arriba del Kardex y el buscador del alta.
//
// Lo mismo con el de la teleconsulta (ver teleconsultaMedico.js): esta
// prueba existe para atajar que el trabajo de i18n cambie el dibujo sin
// querer, no para congelar el Kardex. Un elemento NUEVO y deliberado se
// declara acá; lo que no se puede es que aparezca una diferencia que nadie
// escribió a propósito.
//
// En el arnés la función no existe, así que el ternario deja una línea en
// blanco: por eso se descuenta también ese hueco vacío.
const sinBloquePersona = (html) => html
  .replace(/\n?\s*<div id="personaBox"><\/div>/g, "")
  .replace(/\n?\s*<div id="personaAltaBox"><\/div>/g, "")
  .replace(/\n?\s*<div id="teleMedBox"><\/div>/g, "")
  // El cuidador de la grabación (crearGuardianGrabacion en audio.js): el
  // hueco de sus avisos y el consejo de dejar la pantalla encendida. Otro
  // agregado deliberado: una consulta de 32 minutos llegó con solo los
  // primeros minutos grabados porque el celular se bloqueó.
  .replace(/\n?\s*<div id="recAviso"><\/div>/g, "")
  .replace(/\n?\s*<div id="grabPendientes"><\/div>/g, "")
  // La nota en vivo (services/notaEnVivo.js): el panel donde se va armando
  // la nota mientras se graba. Vacío y escondido hasta que hay qué mostrar.
  .replace(/\n?\s*<div class="nota-vivo" id="notaVivo" style="display:none"><\/div>/g, "")
  .replace(/\n?\s*<div class="hint" style="text-align:center;margin-top:6px">📱 [^<]*<\/div>/g, "")
  // La fila del CPF: solo se dibuja en cuentas brasileñas (Memed lo necesita
  // para recetar). En el arnés la moneda es BOB, así que el ternario deja el
  // hueco vacío que hay que descontar.
  .replace(/\n {8}(?=\n {8}<div class="dato-row" style="border-bottom:none">)/g, "")
  .replace(/\n {4}(?=\n {4}<div class="tabs")/g, "")
  // El botón «Descargar PDF» junto al nombre del paciente (routes/kardexPdf.js),
  // pedido por médicos. Otro agregado deliberado: el nombre pasó a una fila
  // con el botón, y la fila se quedó con el margen de abajo que tenía él.
  .replace(/<div class="kardex-cabecera">\s*<div class="nombre" style="font-size:18px;font-weight:700">([^<]*)<\/div>\s*<button class="secondary kardex-pdf" id="btnKardexPdf">[^<]*<\/button>\s*<\/div>/g,
    '<div class="nombre" style="font-size:18px;font-weight:700;margin-bottom:10px">$1</div>')
  // Y el bloque plegado de "Más acciones", que es el mismo caso: elemento
  // nuevo y deliberado, no una diferencia que nadie escribió. Se saca junto
  // con el comentario que lo explica — los comentarios de HTML viajan al
  // navegador y aparecen en esta comparación como cualquier otro texto.
  .replace(/\n?\s*<!--[\s\S]*?-->/g, "")
  .replace(/\n?\s*<details class="kardex-mas">[\s\S]*?<\/details>/g, "");

// ═══ LO ACCESIBLE NO CAMBIA LO QUE SE VE ═══════════════════════════════════
//
// La lista de pacientes pasó de <div> a <button> y las pestañas ganaron
// role/aria-selected/tabindex, para que la app se pueda usar con teclado y
// con lector de pantalla.
//
// Nada de eso cambia lo que el médico VE: cambia lo que se ANUNCIA y lo que
// se puede enfocar. Esta prueba existe para atajar que el trabajo de idiomas
// mueva el dibujo sin querer, así que se igualan los dos lados y se sigue
// comparando el dibujo — que es lo que la prueba vino a cuidar.
//
// Se normaliza en AMBOS lados y no se descuenta del nuevo: tapando solo un
// lado, un cambio futuro de estructura pasaría sin que nadie lo viera.
const sinAccesibilidad = (html) => html
  .replace(/\s+(?:role|aria-[a-z]+|tabindex)="[^"]*"/g, "")
  // El id de cada pestaña es parte del cableado de accesibilidad: es a lo
  // que apunta el aria-labelledby del panel.
  .replace(/\s+id="tab-[a-zA-Z]+"/g, "")
  // Los atributos quedaron repartidos en varias líneas para que se lean; eso
  // mete saltos y sangría adentro de la etiqueta. Se normaliza el espaciado
  // DENTRO de cada etiqueta en los dos lados: es espaciado del código fuente,
  // no algo que el navegador dibuje distinto.
  .replace(/<([a-z]+)([^>]*?)\s*>/g, (_, tag, attrs) => `<${tag}${attrs.replace(/\s+/g, " ").replace(/\s+$/, "")}>`)
  // div, span y button son los tres contenedores de maquetado, y cuál se usa
  // es una decisión de estructura y accesibilidad —un paciente pasó a ser un
  // <button> para poder abrirlo con Enter—, no un cambio en lo que se
  // muestra. Se igualan los tres, incluidos sus cierres, y así la
  // comparación sigue mirando lo que esta prueba vino a cuidar: las
  // etiquetas, los atributos y el texto.
  .replace(/<\/?(?:div|span|button)\b/g, "<T")
  .replace(/ type="button"/g, "");

// El archivo del símbolo cambió: /logo.png era un dibujo sobre fondo BLANCO
// OPACO, y desde que la plataforma usa la paleta oscura se veía como un
// cuadrado blanco en la cabecera de todas las pantallas. El reemplazo lo
// genera scripts/diseno/construir_marca.js y lo comprueba probar_marca.js,
// que le mira los píxeles.
//
// Acá se iguala en LOS DOS lados, no se descuenta de uno solo: esta prueba
// existe para atajar que el trabajo de i18n mueva el dibujo sin querer, no
// para congelar el nombre de un archivo. Tapando solo el lado nuevo, un
// cambio de imagen futuro pasaría sin que nadie lo viera.
const mismaMarca = (html) => html.replace(/\/logo\.png|\/img\/simbolo\.webp/g, "«símbolo»");

let fallos = 0;
function comparar(nombre, viejoBruto, nuevoBruto) {
  const viejo = Object.fromEntries(Object.entries(viejoBruto).map(([k, v]) => [k, sinAccesibilidad(mismaMarca(v))]));
  const nuevo = Object.fromEntries(Object.entries(nuevoBruto).map(([k, v]) => [k, sinAccesibilidad(mismaMarca(sinBloquePersona(v)))]));
  for (const k of Object.keys(viejo)) {
    if (viejo[k] === nuevo[k]) {
      console.log(`✅ ${nombre}/${k}: idéntico (${viejo[k].length} car.)`);
    } else {
      fallos++;
      const a = viejo[k], b = nuevo[k] || "";
      // Se recorre por unidad UTF-16 en los dos lados. El reporte anterior
      // mezclaba code points (el spread) con índices UTF-16, y con un emoji
      // antes del punto de conflicto señalaba una posición equivocada — dos
      // textos idénticos en pantalla y un "DIFIERE" sin explicación.
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      console.log(`❌ ${nombre}/${k}: DIFIERE en el carácter ${i}`);
      console.log(`   antes: ${JSON.stringify(a.slice(Math.max(0, i - 70), i + 70))}`);
      console.log(`   ahora: ${JSON.stringify(b.slice(Math.max(0, i - 70), i + 70))}`);
    }
  }
}

// El código de main todavía dice "Vitalis": el producto se renombró a
// Symphomed. Se normaliza la marca del lado VIEJO en vez de aflojar la
// comparación, así esta prueba sigue haciendo lo único que vino a hacer —
// detectar que el marcado cambió— y no se vuelve ciega al resto.
const marcaVieja = (s) => s.replace(/Vitalis/g, "Symphomed");

const pacViejo = execSync(`git -C ${RAIZ} show main:public/js/pacientes.js`, { encoding: "utf8" });
const pacNuevo = fs.readFileSync(`${RAIZ}/public/js/pacientes.js`, "utf8");
const conViejo = execSync(`git -C ${RAIZ} show main:public/js/consultas.js`, { encoding: "utf8" });
const conNuevo = fs.readFileSync(`${RAIZ}/public/js/consultas.js`, "utf8");

comparar("pacientes", pintarPacientes(marcaVieja(pacViejo), null), pintarPacientes(pacNuevo, "es"));
comparar("consultas", pintarConsultas(marcaVieja(conViejo), null), pintarConsultas(conNuevo, "es"));

// Y que el portugués realmente cambie.
console.log("");
const pt = { ...pintarPacientes(pacNuevo, "pt"), ...pintarConsultas(conNuevo, "pt") };
const todoPt = Object.values(pt).join("");
const esperadas = ["Salvar paciente", "Data de nascimento", "Antecedentes pessoais", "Adicionar vacina", "Ouvindo a consulta", "Toque para gravar", "Em uso"];
const faltan = esperadas.filter(x => !todoPt.includes(x));
console.log(faltan.length ? `❌ portugués: faltan → ${faltan.join(", ")}` : `✅ portugués: las ${esperadas.length} etiquetas esperadas aparecen`);
if (faltan.length) fallos++;

const quedaEspanol = ["Guardar paciente", "Antecedentes personales", "Agregar vacuna", "Escuchando la consulta", "Tocá para grabar"].filter(x => todoPt.includes(x));
console.log(quedaEspanol.length ? `❌ portugués: quedó en español → ${quedaEspanol.join(", ")}` : "✅ portugués: no quedó ninguna etiqueta en español");
if (quedaEspanol.length) fallos++;

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
