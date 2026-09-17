// Symphomed — El resumen que el paciente se lleva a otro consultorio.
//
// ═══ QUÉ SE VIGILA ACÁ, Y POR QUÉ ═════════════════════════════════════════
//
// Esta función manda historias clínicas fuera del consultorio. Es la única de
// Symphomed que hace eso, y casi todo lo que puede salir mal sale mal EN
// SILENCIO: el resumen se genera, el enlace abre, la página se ve linda, y
// adentro viajó la transcripción de la consulta.
//
// Tres clases de prueba, en orden de gravedad:
//
//   1. LO QUE NO PUEDE SALIR. La transcripción cruda, el brief que escribió
//      una máquina, los diagnósticos diferenciales. Se prueba armando un
//      kardex que los tiene TODOS y revisando que no aparezcan en la salida
//      —ni en resumen, ni en completo, ni con las secciones forzadas a mano—.
//      Buscar la cadena en el JSON entero y no campo por campo: si mañana
//      alguien agrega una sección nueva que los arrastre, esto lo agarra
//      igual.
//
//   2. LAS ALERGIAS. Son lo único acá que puede matar a alguien si falta. No
//      se pueden destildar, y cuando no hay ninguna registrada el documento
//      tiene que DECIRLO, porque un hueco se lee como un "no hay".
//
//   3. LAS TRES PUERTAS. /medico con sesión, /mi con la llave, /r con el
//      enlace. Que ninguna llegue a lo de otra, y que revocar corte de verdad.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const svc = require(path.join(RAIZ, "services", "resumenCompartido"));
const RUTA = fs.readFileSync(path.join(RAIZ, "routes", "resumenCompartido.js"), "utf8");
const MODELOS = fs.readFileSync(path.join(RAIZ, "db", "models.js"), "utf8");
// Los comentarios de estos archivos nombran justo lo que las pruebas buscan
// ("no sale la transcripción"), así que se sacan antes de mirar el código.
const sinComentarios = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const RUTA_CODIGO = sinComentarios(RUTA);

// ═══ UN KARDEX CON TODO LO QUE NO TIENE QUE SALIR ══════════════════════════
//
// Cada campo prohibido lleva una cadena única e inventada. Si aparece en la
// salida, es que viajó — no hay forma de que coincida por casualidad.
const MARCA = {
  transcripcion: "ZZTRANSCRIPCIONCRUDAZZ",
  segmento: "ZZSEGMENTOZZ",
  brief: "ZZBRIEFDEMAQUINAZZ",
  diferencial: "ZZDIFERENCIALZZ",
  hilo: "ZZHILOCLINICOZZ",
  sinConfirmar: "ZZNOTASINCONFIRMARZZ",
  plata: 99991,
};

const KARDEX = {
  paciente: {
    _id: "p1", medicoPhone: "591700",
    nombre: "Carla Mendoza", fechaNacimiento: new Date("1984-03-02"), sexo: "F",
    codigo: "P-0042",
    antecedentesPersonales: ["Hipertensión desde 2019", "Colecistectomía 2021"],
    antecedentesFamiliares: [{ parentesco: "madre", condicion: "Diabetes tipo 2" }],
    // Lo escribió una máquina. No sale nunca.
    briefClinico: { estadoActual: MARCA.brief, diagnosticosDiferenciales: [MARCA.diferencial] },
  },
  persona: { documento: "4821993", alergias: ["Penicilina", "AINE"], alergiasActualizadasEn: new Date("2026-01-10") },
  consultas: [
    {
      createdAt: new Date("2026-08-01"), confirmadaEn: new Date("2026-08-01"),
      transcripcionCompleta: MARCA.transcripcion,
      segmentos: [{ hablante: "A", texto: MARCA.segmento }],
      hiloClinico: { conexiones: [{ queDijoEntonces: MARCA.hilo }] },
      notaClinica: {
        motivoConsulta: "Control de presión",
        sintomas: ["Cefalea occipital"],
        diagnostico: "Hipertensión esencial en tratamiento",
        diagnosticosDiferenciales: [MARCA.diferencial],
        plan: "Continuar enalapril, control en 30 días",
        medicamentosRecetados: [{ nombre: "Enalapril", dosis: "10 mg", frecuencia: "cada 12 h" }],
        examenesSolicitados: ["Perfil lipídico"],
        proximoControl: "30 días",
      },
    },
    ...Array.from({ length: 7 }, (_, k) => ({
      createdAt: new Date(2026, 6 - k, 5), confirmadaEn: new Date(2026, 6 - k, 5),
      notaClinica: { motivoConsulta: `Control ${k + 2}`, diagnostico: "Hipertensión esencial" },
    })),
  ],
  medicamentos: [
    { nombre: "Enalapril", dosis: "10 mg", frecuencia: "cada 12 h", fechaInicio: new Date("2019-05-01"), fechaFin: null },
    { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "si dolor", fechaInicio: new Date("2021-02-01"), fechaFin: new Date("2021-02-10") },
  ],
  informes: [
    { estado: "firmado", tipoEstudio: "Ecografía abdominal", fechaEstudio: new Date("2026-05-02"),
      titulo: "Ecografía abdominal", conclusion: "Vesícula ausente, resto sin particularidades",
      recomendaciones: "Control anual" },
    // Un borrador no sale: nadie se hizo cargo de esa lectura todavía.
    { estado: "borrador", tipoEstudio: "Radiografía", fechaEstudio: new Date("2026-06-01"),
      titulo: "ZZBORRADORZZ", conclusion: "ZZBORRADORZZ" },
  ],
  vacunas: [{ nombre: "Influenza", dosis: "Anual", fecha: new Date("2026-04-01") }],
  mediciones: [{ tipo: "presion", valor: 130, unidad: "mmHg", fecha: new Date("2026-08-01") }],
  tratamientos: [{ nombre: "Corona en pieza 36", estado: "realizado", piezaFdi: 36,
                   precio: MARCA.plata, pagos: [{ monto: MARCA.plata }] }],
};

const armar = (alcance, secciones) =>
  svc.armarContenido(KARDEX, { alcance, secciones: svc.normalizarSecciones(secciones, alcance) });

// ═══ 1. LO QUE NO PUEDE SALIR ══════════════════════════════════════════════
console.log("── 1. Lo que nunca sale del consultorio ──");

// Se prueba con las secciones FORZADAS a todas, incluso las que no existen,
// porque el modo peligroso no es el normal: es el de alguien pidiendo todo.
const todosLosCasos = [
  ["resumen, por defecto", armar("resumen", null)],
  ["completo, por defecto", armar("completo", null)],
  ["completo, con todas las secciones forzadas", armar("completo", svc.CLAVES_VALIDAS)],
];

for (const [nombre, salida] of todosLosCasos) {
  const json = JSON.stringify(salida);
  verificar(`${nombre}: no viaja la transcripción de la consulta`, !json.includes(MARCA.transcripcion));
  verificar(`${nombre}: ni los segmentos de la grabación`, !json.includes(MARCA.segmento));
  verificar(`${nombre}: ni el brief que escribió la máquina`, !json.includes(MARCA.brief));
  verificar(`${nombre}: ni los diagnósticos diferenciales`, !json.includes(MARCA.diferencial));
  verificar(`${nombre}: ni el hilo clínico`, !json.includes(MARCA.hilo));
}

// La lista de SIEMPRE_FUERA no es decoración: tiene que nombrar exactamente
// las cinco cosas que las pruebas de arriba comprueban. Si alguien saca una de
// la lista sin sacarla del código, esto lo marca.
verificar("y la regla está escrita, no solo implementada",
  ["transcripcionCompleta", "segmentos", "briefClinico", "diagnosticosDiferenciales", "hiloClinico"]
    .every(c => svc.SIEMPRE_FUERA.includes(c)));

// Un informe en borrador es una imagen que nadie leyó todavía.
verificar("los informes en borrador tampoco salen",
  !JSON.stringify(armar("completo", null)).includes("ZZBORRADORZZ"));

// La plata del plan de tratamiento es de la relación del paciente con SU
// consultorio. En otro no tiene nada que hacer.
verificar("ni el precio ni los pagos del plan de tratamiento",
  !JSON.stringify(armar("completo", null)).includes(String(MARCA.plata)));

// Y la consulta sin confirmar: la nota que la IA escribió y el médico todavía
// no revisó es un borrador de máquina, igual que el brief. Se filtra en la
// consulta a la base, así que se comprueba ahí.
verificar("solo salen las consultas que el médico confirmó",
  /ConsultaMedica\.find\(\{ \.\.\.filtro, confirmadaEn: \{ \$ne: null \} \}\)/.test(RUTA_CODIGO));

// ═══ 2. LAS ALERGIAS ═══════════════════════════════════════════════════════
console.log("\n── 2. Las alergias, que son lo único que puede matar ──");

const conAlergias = armar("resumen", null);
verificar("salen en el resumen corto", (conAlergias.alergias?.lista || []).includes("Penicilina"));

// Destildar las alergias no es una opción que se pueda ofrecer: el que recibe
// un resumen sin sección de alergias asume que no hay.
const intentandoSacarlas = armar("resumen", ["consultas"]);
verificar("no se pueden destildar, ni pidiéndolo explícitamente",
  Boolean(intentandoSacarlas.alergias) && Boolean(intentandoSacarlas.identidad));
verificar("  ...y eso está declarado en las secciones, no escondido en un if",
  svc.SECCIONES.filter(s => s.fija).map(s => s.clave).sort().join(",") === "alergias,identidad");

// «No tiene alergias» y «nadie preguntó» son cosas distintas para quien va a
// recetar, y el documento no puede confundirlas con un hueco.
const sinPersona = svc.armarContenido(
  { ...KARDEX, persona: null }, { alcance: "resumen", secciones: svc.normalizarSecciones(null, "resumen") });
verificar("cuando no hay ninguna registrada, el documento lo dice",
  sinPersona.alergias && sinPersona.alergias.registradas === false);

// ═══ 3. QUE EL RESUMEN SEA UN RESUMEN ══════════════════════════════════════
console.log("\n── 3. Un resumen que se pueda leer ──");

const corto = armar("resumen", null);
const largo = armar("completo", null);
verificar(`el corto trae ${svc.CONSULTAS_EN_RESUMEN} consultas y no las ocho`,
  corto.consultas.length === svc.CONSULTAS_EN_RESUMEN);
verificar("el completo las trae todas", largo.consultas.length === 8);
// Sin esto, un resumen de 5 de 40 se lee como una historia de 5 consultas, y
// el que lo recibe saca conclusiones sobre un paciente que no es.
verificar("y el corto avisa cuántas quedaron afuera", corto.consultasTotales === 8);

verificar("el corto trae solo la medicación que toma HOY",
  corto.medicacion.length === 1 && corto.medicacion[0].nombre === "Enalapril");
verificar("el completo trae también la que terminó", largo.medicacion.length === 2);
verificar("  ...y marca cuál sigue activa", largo.medicacion.filter(m => m.activo).length === 1);

// El orden de las secciones no puede depender de cómo lleguen: unas alergias
// después de las consultas es un dato que nadie va a mirar.
const desordenadas = svc.normalizarSecciones(["vacunas", "consultas", "alergias", "identidad"], "completo");
verificar("las secciones salen siempre en el mismo orden, no en el que llegaron",
  desordenadas.indexOf("identidad") === 0 && desordenadas.indexOf("alergias") === 1 &&
  desordenadas.indexOf("consultas") < desordenadas.indexOf("vacunas"));

// Una sección vacía le hace creer al que lee que no hay nada, cuando puede ser
// que nadie lo haya cargado.
const pelado = svc.armarContenido(
  { paciente: { nombre: "Sin datos", antecedentesPersonales: [] }, persona: null,
    consultas: [], medicamentos: [], informes: [], vacunas: [], mediciones: [], tratamientos: [] },
  { alcance: "completo", secciones: svc.normalizarSecciones(null, "completo") });
verificar("las secciones sin nada no se dibujan vacías, no existen",
  !("medicacion" in pelado) && !("consultas" in pelado) && !("vacunas" in pelado));
verificar("  ...pero identidad y alergias siguen estando", Boolean(pelado.identidad) && Boolean(pelado.alergias));

// ═══ 4. LAS TRES PUERTAS ═══════════════════════════════════════════════════
console.log("\n── 4. Tres puertas, tres candados distintos ──");

verificar("lo del médico pide sesión de médico",
  /app\.(get|post)\("\/medico\/pacientes\/:pacienteId\/resumenes[^"]*", limitMedico, requireMedico/.test(RUTA_CODIGO));
// obtenerOFallar exige medicoPhone en el filtro: es lo que impide que un
// médico pida el resumen del paciente de otro cambiando el id en la URL.
verificar("  ...y siempre contra SU propio paciente, nunca por id suelto",
  !/Paciente\.findById/.test(RUTA_CODIGO) &&
  /obtenerOFallar\(Paciente, \{ _id: req\.params\.pacienteId, medicoPhone \}/.test(RUTA_CODIGO));

verificar("lo del paciente pide la llave y tiene su propio límite",
  /app\.(get|post)\("\/mi\/:llave[^"]*", limitLlave/.test(RUTA_CODIGO));
verificar("  ...y una llave revocada no abre nada",
  /LlavePaciente\.findOne\(\{ token, revocadaEn: null \}\)/.test(RUTA_CODIGO));

// La puerta pública NO puede llegar al kardex: solo lee el contenido que ya
// estaba congelado. Si algún día alguien le mete un leerKardex() acá, esto lo
// agarra.
const bloquePublico = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf('app.get("/r/:token/datos"'));
verificar("la puerta pública solo lee lo congelado, nunca el kardex",
  bloquePublico.length > 0 && !/leerKardex/.test(bloquePublico));
verificar("  ...y devuelve el resumen filtrado, no el documento de la base",
  /res\.json\(\{ resumen: paraElQueLoRecibe\(r\) \}\)/.test(RUTA_CODIGO));
// Quien recibe un resumen no tiene por qué saber qué otros médicos lo abrieron.
const proyeccion = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("function paraElQueLoRecibe"),
                                     RUTA_CODIGO.indexOf("function paraElQueLoGenero"));
verificar("  ...sin decirle quién más lo abrió",
  !/importadoPor|medicoPhone|pacienteId/.test(proyeccion));

// ═══ 5. REVOCAR, QUE ES LO QUE HACE QUE COMPARTIR NO DÉ MIEDO ══════════════
console.log("\n── 5. Se puede cortar lo que se mandó ──");

verificar("hay revocación del lado del médico",
  /app\.post\("\/medico\/resumenes\/:id\/revocar"/.test(RUTA_CODIGO));
verificar("y del lado del paciente, sobre lo que él generó",
  /app\.post\("\/mi\/:llave\/compartidos\/:id\/revocar"/.test(RUTA_CODIGO) &&
  /generadoPor: "paciente",\s*\n\s*\}\);/.test(RUTA_CODIGO));
// Revocar no borra: el registro de que ESE día se compartió eso es la prueba
// de un acto, y borrarla sería borrar la prueba.
verificar("revocar corta el acceso pero no borra el registro",
  !/ResumenCompartido\.(deleteOne|deleteMany|findOneAndDelete)/.test(RUTA_CODIGO) &&
  /r\.revocadoEn = new Date\(\)/.test(RUTA_CODIGO));
verificar("  ...y un enlace revocado contesta 410, no 404",
  /if \(r\.revocadoEn\) throw new ErrorHttp\(410/.test(RUTA_CODIGO));
verificar("  ...igual que uno vencido", /r\.tokenExpira < new Date\(\)\) throw new ErrorHttp\(410/.test(RUTA_CODIGO));

// Emitir una llave nueva tiene que invalidar la anterior, si no «se me fue al
// número equivocado» no tiene arreglo.
verificar("emitir una llave nueva revoca la anterior",
  /LlavePaciente\.updateMany\(\{ pacienteId: paciente\._id, revocadaEn: null \}[\s\S]{0,120}?LlavePaciente\.create/.test(RUTA_CODIGO));
verificar("  ...y la base lo garantiza, no solo el código",
  /llavePacienteSchema\.index\(\{ pacienteId: 1 \}, \{ unique: true, partialFilterExpression: \{ revocadaEn: null \} \}\)/.test(MODELOS));

// ═══ 6. LA INSTANTÁNEA ═════════════════════════════════════════════════════
console.log("\n── 6. Lo que se compartió queda como se compartió ──");

// Con una consulta en vivo, lo que el médico cargue mañana aparecería en el
// enlace que compartió ayer sin que nadie lo aprobara.
verificar("el contenido se congela al compartir, no se consulta al abrir",
  /contenido: armarContenido\(datos, \{ alcance, secciones \}\)/.test(RUTA_CODIGO) &&
  /contenido: r\.contenido/.test(RUTA_CODIGO));
// La previsualización tiene que salir de la MISMA función que lo que se
// guarda. Si fueran dos caminos, el médico aprueba una cosa y sale otra.
const previa = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf('resumenes/previa"'), RUTA_CODIGO.indexOf('resumenes/previa"') + 700);
verificar("la previsualización usa el mismo armador que el guardado",
  /armarContenido\(datos, \{ alcance, secciones \}\)/.test(previa) && /leerKardex\(paciente\)/.test(previa));
verificar("  ...y armarContenido no toca la base (por eso puede ser la misma)",
  !/await|find\(|findOne\(/.test(
    fs.readFileSync(path.join(RAIZ, "services", "resumenCompartido.js"), "utf8")
      .split("function armarContenido")[1].split("\nmodule.exports")[0]));

// ═══ 7. AUDITORÍA ══════════════════════════════════════════════════════════
console.log("\n── 7. Queda escrito quién sacó qué del consultorio ──");
for (const accion of ["compartir_resumen", "compartir_resumen_paciente", "revocar_resumen",
                      "emitir_llave_paciente", "revocar_llave_paciente"]) {
  verificar(`se registra «${accion}»`, new RegExp(`accion: "${accion}"`).test(RUTA_CODIGO));
}
// El paciente no tiene sesión, así que su acto se anota bajo el consultorio de
// la ficha. Lo que no puede pasar es que no se anote.
verificar("lo del paciente también, aunque no tenga sesión",
  /registrar\(\{ req, medicoPhone: llave\.medicoPhone, accion: "compartir_resumen_paciente"/.test(RUTA_CODIGO));

// ═══ 8. EL MENSAJE DE WHATSAPP ═════════════════════════════════════════════
console.log("\n── 8. La llave que viaja por WhatsApp ──");
// La vista previa se ve en la pantalla bloqueada. Mismo criterio que el
// informe de avance: nada clínico afuera del enlace.
const mensaje = (RUTA.match(/const texto =\s*([\s\S]*?);\n/) || [])[1] || "";
verificar("el mensaje no nombra ninguna especialidad ni diagnóstico",
  mensaje.length > 0 && !/diagn|especialidad|consulta de|resultado/i.test(mensaje));
// La llave abre Y deja generar. Que el paciente lo sepa es la única defensa
// contra que la reenvíe pensando que es un enlace más.
verificar("  ...pero sí avisa que no hay que reenviarla",
  /no lo reenvíes/.test(mensaje));
verificar("y si WhatsApp falla, la llave no se pierde: se le da el enlace al médico",
  /return res\.json\(\{ ok: true, enlace, enviadaA: null/.test(RUTA_CODIGO));

// ═══ 9. LAS PANTALLAS ══════════════════════════════════════════════════════
console.log("\n── 9. Las tres pantallas ──");

const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const HTML_R = leer("public", "resumen.html");
const HTML_MI = leer("public", "mi.html");
const JS_R = leer("public", "js", "resumenPublico.js");
const JS_MI = leer("public", "js", "miHistoria.js");
const JS_MED = leer("public", "js", "compartirResumen.js");
const CSS = leer("public", "resumen.css");
const INDEX_JS = sinComentarios(leer("index.js"));
const INDEX_HTML = leer("index.html");

// Una sola función dibuja el resumen en los tres lados. Si se separaran, un
// día el paciente compartiría algo que se ve distinto de lo que él miró, y no
// habría forma de saber cuál de las dos versiones es la buena.
verificar("las tres pantallas dibujan el resumen con la MISMA función",
  /resumenVista\.js/.test(HTML_R) && /resumenVista\.js/.test(HTML_MI) && /resumenVista\.js/.test(INDEX_HTML));
verificar("  ...y la previa del médico también, que es lo que hace que aprobar signifique algo",
  /resumenVistaHtml\(r\.contenido/.test(JS_MED));

// Peso: quien abre /r es un médico que todavía no es cliente, y esa es la
// primera vez que ve Symphomed. Bajarle el JavaScript clínico para leer una
// hoja arruina esa impresión antes de que empiece. Mismo criterio que socio.html.
for (const [nombre, html] of [["/r", HTML_R], ["/mi", HTML_MI]]) {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  verificar(`${nombre} no baja la app: solo ${scripts.length} scripts propios`,
    scripts.length <= 2 && !scripts.some(s => /main\.js|pacientes\.js|estado\.js|i18n/.test(s)));
}
verificar("y el servidor les sirve su propia página, no index.html",
  /app\.get\("\/r\/:token", .*?"public", "resumen\.html"/.test(INDEX_JS) &&
  /app\.get\("\/mi\/:llave", .*?"public", "mi\.html"/.test(INDEX_JS));

// Una historia clínica detrás de un enlace no adivinable que además quede
// indexada sería el peor final posible de esta función.
for (const [nombre, html] of [["/r", HTML_R], ["/mi", HTML_MI]]) {
  verificar(`${nombre} pide no ser indexada`, /name="robots" content="noindex/.test(html));
  verificar(`  ...y no filtra el enlace por el Referer al salir`, /name="referrer" content="no-referrer"/.test(html));
}
// El título de /mi no nombra Symphomed: el historial del navegador de un
// teléfono es una lista que ve cualquiera que lo levante de la mesa. El de /r
// sí, porque lo abre un profesional en su consultorio — son dos audiencias.
verificar("el título de la página del paciente no nombra el producto",
  /<title>Mi historia clínica<\/title>/.test(HTML_MI));

// La banda de producto va DESPUÉS del documento. Un cartel arriba de una
// historia clínica convierte el documento en el envoltorio de un anuncio.
// Se mide dentro de renderResumen() y no en todo el archivo: el primer
// `app.innerHTML` del archivo es el de pintarError(), que no tiene nada que
// ver con el orden de la página. Medido sobre el archivo entero daba un falso
// negativo, porque bandaHtml se DEFINE antes de usarse.
const cuerpoR = JS_R.slice(JS_R.indexOf("async function renderResumen"));
verificar("la banda de Symphomed va después del resumen, nunca antes",
  cuerpoR.indexOf("resumenVistaHtml") > 0 &&
  cuerpoR.indexOf("resumenVistaHtml") < cuerpoR.indexOf("bandaHtml"));
// Y en papel no sale: un cartel de producto impreso encima de una historia
// clínica no tiene ninguna excusa.
const bloqueImprimir = CSS.slice(CSS.indexOf("@media print"));
verificar("  ...y al imprimir no sale ni la banda ni los botones",
  /\.barra,\.acciones,\.banda,\.panel,\.no-imprimir\{display:none!important\}/.test(bloqueImprimir));

// El botón principal tiene que hacer lo que dice. Sin sesión ofrece pedir
// cuenta y avisa de la revisión: prometer «empezá ahora» y que después haya
// que esperar una aprobación quema al único médico que vino solo.
verificar("con sesión de médico, el botón importa de verdad",
  /\/importar`, \{ method: "POST" \}/.test(JS_R));
verificar("  ...y sin sesión ofrece pedir cuenta, diciendo que hay una revisión",
  /btnCuenta/.test(JS_R) && /se revisan una por una/.test(JS_R));
verificar("  ...y después de importar se ofrece abrir la ficha, no buscarla",
  /\/app\/paciente\/\$\{esc\(r2\.pacienteId\)\}/.test(JS_R));

// ─── Lo del paciente: sin una sola palabra de consultorio ────────────────
//
// Se mira SOLO el texto que llega a la pantalla —lo que queda entre `>` y
// `<`— y no el archivo entero. Buscar la palabra en todo el archivo agarraba
// nombres de variables y rutas de la API, que nadie lee: una prueba en rojo
// por `/revocar` adentro de una URL no dice nada sobre lo que ve el paciente.
const textoVisible = (js) => [...js.matchAll(/>([^<>{}`]{3,})</g)].map(m => m[1]).join(" ");
const visibleMi = textoVisible(JS_MI);
const jerga = ["revocar", "token", "alcance", "kardex", "API"].filter(p => new RegExp(p, "i").test(visibleMi));
verificar(`la página del paciente no usa palabras de consultorio${jerga.length ? " — aparece: " + jerga.join(", ") : ""}`,
  jerga.length === 0);
// Y sí usa las de una persona. Sin esto, la de arriba se cumpliría con una
// pantalla que no dijera nada.
verificar("  ...dice «cortar el enlace», que es lo que hace",
  /Cortar enlace/.test(visibleMi) && /Compartir con un médico/.test(visibleMi));
verificar("  ...y el aviso de la llave va ARRIBA de la historia, donde se lee",
  JS_MI.indexOf("Ojo con este enlace") < JS_MI.indexOf("resumenVistaHtml(DATOS.contenido"));

// Las fijas se muestran deshabilitadas y diciendo por qué: esconderlas dejaría
// la sensación de que falta algo, y permitirlas es lo que no puede pasar.
verificar("las secciones fijas se ven, pero no se pueden destildar",
  /\$\{s\.fija \? "disabled" : ""\}/.test(JS_MI) && /\$\{s\.fija \? "disabled" : ""\}/.test(JS_MED));
// Cambiar de alcance vuelve a lo que corresponde por defecto: si conservara
// las casillas destildadas, «historia completa» podría mandar menos que
// «resumen», que es lo contrario de lo que dice el botón.
verificar("cambiar de alcance reinicia las casillas en las dos pantallas",
  /ELEGIDAS = \(DATOS\.porDefecto \|\| \{\}\)\[ALCANCE\]/.test(JS_MI) &&
  /crElegidas = \(crPorDefecto\[crAlcance\] \|\| \[\]\)\.slice\(\)/.test(JS_MED));

// Y la caja del médico va en «Más acciones», no como pestaña trece.
const PACIENTES = leer("public", "js", "pacientes.js");
const bloqueMas = PACIENTES.slice(PACIENTES.indexOf('class="kardex-mas"'),
                                  PACIENTES.indexOf("</details>", PACIENTES.indexOf('class="kardex-mas"')));
verificar("en el kardex va dentro de «Más acciones», no como una pestaña más",
  /compartirResumenCajaHtml/.test(bloqueMas));
// El mismo patrón que teleconsulta: si la lista tarda o falla, la ficha se
// abre igual.
verificar("  ...y si su consulta falla, la ficha del paciente se abre igual",
  /typeof compartirResumenPintar === "function"/.test(PACIENTES));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
