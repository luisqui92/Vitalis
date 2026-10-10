// Symphomed — El idioma del médico llega hasta la transcripción y la nota.
//
// La interfaz en portugués sin esto es una fachada: el médico ve todo en su
// idioma, graba una consulta, y el audio se manda declarado como español.
// Sale texto —no falla— y sale mal. Ese es el peor tipo de error: silencioso.
//
// ═══ LO QUE ESTA PRUEBA SÍ DEMUESTRA ═══════════════════════════════════════
//
// Que el idioma de la cuenta viaja hasta cada punto donde antes había un "es"
// escrito a mano, y que el vocabulario que se manda es el del país correcto.
//
// ═══ LO QUE NO ═════════════════════════════════════════════════════════════
//
// Que la transcripción en portugués sea BUENA. Eso no lo puede decir ningún
// test: hace falta audio real de consultas en portugués y un médico brasileño
// que lea las notas. Ver el aviso de services/assemblyai.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/no-se-usa";
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { keytermsPara, idiomaSoportado, IDIOMAS_CON_MEDICAL_MODE } = require(path.join(RAIZ, "services", "assemblyai"));

console.log("── 1. El vocabulario es el del país, no una traducción ──");
const es = keytermsPara("medicina_general", "es");
const pt = keytermsPara("medicina_general", "pt");

verificar("en español está losartán", es.includes("losartán"));
verificar("en portugués es losartana, no losartán", pt.includes("losartana") && !pt.includes("losartán"));
verificar("en español está warfarina", es.includes("warfarina"));
verificar("en portugués es varfarina, con V", pt.includes("varfarina") && !pt.includes("warfarina"));
verificar("en portugués está dipirona (lo más recetado en Brasil)", pt.includes("dipirona"));
verificar("en portugués se dice glicemia, no glucosa", pt.includes("glicemia") && !pt.includes("glucosa"));

// Que no haya quedado una lista calcada: si el 80% de los términos son
// idénticos, alguien tradujo con buscar y reemplazar.
const compartidos = pt.filter(x => es.includes(x)).length;
verificar(
  `las listas se parecen en ${compartidos}/${pt.length} términos, no son la misma`,
  compartidos < pt.length * 0.6
);

console.log("\n── 2. Cada especialidad tiene su vocabulario en los dos idiomas ──");
const ESPECIALIDADES = ["odontologia", "oftalmologia", "ginecologia", "neurodesarrollo", "pediatria", "veterinaria", "estetica"];
for (const esp of ESPECIALIDADES) {
  const listaEs = keytermsPara(esp, "es");
  const listaPt = keytermsPara(esp, "pt");
  const propiosEs = listaEs.length - es.length;
  const propiosPt = listaPt.length - pt.length;
  verificar(`${esp}: ${propiosEs} términos en es · ${propiosPt} en pt`, propiosEs > 5 && propiosPt > 5);
}
// Los términos que más fácil se cuelan traducidos del español.
verificar("odontología pt dice tártaro y no sarro", keytermsPara("odontologia", "pt").includes("tártaro"));
verificar("veterinaria pt dice cinomose y no moquillo", keytermsPara("veterinaria", "pt").includes("cinomose"));
verificar("pediatría pt dice puericultura", keytermsPara("pediatria", "pt").includes("puericultura"));
verificar("ginecología pt dice cesariana y no cesárea", keytermsPara("ginecologia", "pt").includes("cesariana"));
verificar("estética pt dice preenchimento y no relleno", keytermsPara("estetica", "pt").includes("preenchimento"));

console.log("\n── 3. Un idioma que no conocemos cae en español, no en vacío ──");
verificar("idiomaSoportado('pt') es pt", idiomaSoportado("pt") === "pt");
verificar("idiomaSoportado('fr') cae en es", idiomaSoportado("fr") === "es");
verificar("idiomaSoportado(undefined) cae en es", idiomaSoportado(undefined) === "es");
verificar("y el vocabulario nunca sale vacío", keytermsPara("medicina_general", "klingon").length > 20);

console.log("\n── 4. El Medical Mode solo donde existe ──");
// https://www.assemblyai.com/docs/pre-recorded-audio/medical-mode
verificar("español tiene Medical Mode", IDIOMAS_CON_MEDICAL_MODE.includes("es"));
verificar("portugués NO tiene Medical Mode", !IDIOMAS_CON_MEDICAL_MODE.includes("pt"));

console.log("\n── 5. Ya no queda ningún idioma escrito a mano ──");
// Esto es lo que hacía que la interfaz en portugués fuera una fachada: cinco
// lugares con "es" fijo que ninguna prueba miraba.
function fuente(rel) { return fs.readFileSync(path.join(RAIZ, rel), "utf8"); }

const assembly = fuente("services/assemblyai.js");
verificar('assemblyai.js ya no manda language_code: "es" fijo', !/language_code:\s*"es"/.test(assembly));
verificar("  ...manda el idioma que recibe", /language_code:\s*lang/.test(assembly));
verificar("  ...y el domain va condicionado", /conMedicalMode\s*\?\s*\{\s*domain/.test(assembly));

// La vista previa en vivo pasa por el servidor (services/vistaPrevia.js):
// el idioma lo pone él, sacado de la cuenta, y el navegador no elige nada.
const audio = fuente("public/js/audio.js");
verificar("audio.js no elige el idioma de la vista previa", !/language_codes/.test(audio));
const vista = fuente("services/vistaPrevia.js");
verificar("  ...lo pone el servidor, con el idioma de la cuenta",
  /select\("tipoEspecialidad idioma"\)/.test(vista) && /language_codes:\s*JSON\.stringify\(\[idioma\]\)/.test(vista));

const ruta = fuente("routes/consultaMedica.js");
const selects = [...ruta.matchAll(/\.select\("tipoEspecialidad[^"]*"\)/g)].map(m => m[0]);
// El que alimenta la transcripción tiene que traer el idioma. Hay otro más
// abajo que solo mira la especialidad para el catálogo de tratamientos, y
// ese no lo necesita.
const conIdioma = selects.filter(s => s.includes("idioma")).length;
verificar(`${conIdioma} de ${selects.length} consultas al médico traen el idioma`, conIdioma >= 1);
// Se busca que el idioma sea un argumento, no que sea el ÚLTIMO: la llamada
// lleva además un objeto de opciones (multicanal, para la teleconsulta) y
// atarse a la posición hacía fallar la prueba por agregar un parámetro que no
// tiene nada que ver con el idioma.
verificar("la transcripción recibe el idioma", /transcribirConsultaMedica\(audioBuffer,[^;]*?idioma\s*[,)]/.test(ruta));
// La nota se arma en producirNota() (también la usa «Volver a generar la
// nota»): el idioma del médico tiene que llegar hasta ahí y de ahí a la IA.
verificar("la nota clínica también", /producirNota\(actual, paciente, medicoPhone, medicoParaVocabulario\?\.idioma\)/.test(ruta)
  && /generarNotaClinica\(texto \?\? consulta\.transcripcionCompleta, contexto, idioma\)/.test(ruta));
// La nota en vivo, el borrador y la verificación (services/notaEnVivo.js)
// también se escriben en el idioma de la cuenta.
verificar("  ...y la nota en vivo, el borrador y la verificación",
  /producirNota\(actual, paciente, medicoPhone, medico\?\.idioma, \{/.test(ruta)
  && /generarNotaClinica\(texto, contexto, medico\?\.idioma\)/.test(ruta)
  && /generarNotaClinica\(c\.transcripcionCompleta \|\| "", contexto, medico\?\.idioma\)/.test(ruta));
verificar("  ...y al regenerarla, con el idioma de la cuenta", /producirNota\(consulta, paciente, medicoPhone, medico\?\.idioma\)/.test(ruta)
  && /select\("idioma"\)/.test(ruta));

console.log("\n── 6. La nota clínica sale en el idioma del médico ──");
const nota = fuente("services/notaClinica.js");
verificar("el prompt ya no dice 'en español' fijo", !/médica en español/.test(nota));
verificar("  ...lo pone según el idioma", /\{IDIOMA\}/.test(nota) && /replace\("\{IDIOMA\}"/.test(nota));
// La regla que evita el desastre: si el modelo traduce las claves del JSON,
// la nota no se guarda y el médico pierde la consulta entera.
verificar("se le prohíbe explícitamente traducir las CLAVES del JSON", /CLAVES del JSON NO se traducen/.test(nota));
verificar("y se le pide la nomenclatura DCB para Brasil", /DCB/.test(nota));

// Y ahora el prompt ARMADO, que es lo que de verdad va a leer el modelo.
// Que el archivo contenga ciertas palabras no garantiza que terminen en la
// petición.
const { generarNotaClinica, promptSistema } = require(path.join(RAIZ, "services", "notaClinica"));
verificar("generarNotaClinica acepta el idioma", generarNotaClinica.length === 3);

const promptEs = promptSistema("es");
const promptPt = promptSistema("pt");
verificar("el prompt en español dice 'médica en español'", promptEs.includes("médica en español"));
verificar("el de portugués dice 'médica en portugués de Brasil'", promptPt.includes("médica en portugués de Brasil"));
verificar("  ...y no quedó ningún {IDIOMA} sin reemplazar", !promptEs.includes("{IDIOMA}") && !promptPt.includes("{IDIOMA}"));
verificar("los dos llevan la prohibición de traducir las claves", promptEs.includes("CLAVES del JSON NO se traducen") && promptPt.includes("CLAVES del JSON NO se traducen"));
verificar("solo el de portugués menciona DCB", promptPt.includes("DCB") && !promptEs.includes("DCB"));
// El esquema JSON tiene que sobrevivir igual en los dos: es lo que después
// se guarda en Mongo con tipos estrictos.
for (const clave of ["motivoConsulta", "diagnostico", "medicamentosRecetados", "odontogramaSugerido"]) {
  verificar(`  la clave "${clave}" está intacta en los dos prompts`, promptEs.includes(`"${clave}"`) && promptPt.includes(`"${clave}"`));
}
verificar("un idioma desconocido produce el prompt en español", promptSistema("klingon").includes("médica en español"));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
