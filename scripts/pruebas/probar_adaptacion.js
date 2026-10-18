// Symphomed — La IA que se amolda a cada profesional (services/adaptacion.js).
//
// Lo que se prueba:
//   1. Lo que se aprende de una corrección, y lo que NO: un error del
//      transcriptor sí; un cambio de idea, un número, un lado, un prefijo
//      opuesto, la concordancia, un medicamento, un término clínico de verdad,
//      el nombre del paciente o el de un familiar, no.
//   2. Su forma de escribir: las abreviaturas (y las que parecen pero no son),
//      las frases que borra, el largo, las viñetas y sus términos de siempre.
//   3. De la consulta confirmada a la próxima: la IA de la nota recibe sus
//      palabras, sus correcciones y su forma; el transcriptor (el final y el
//      en vivo), sus palabras. A la primera corrección, el transcriptor; desde
//      la segunda, la nota.
//   4. Configuración: verlo, elegir, agregar, sacar (también un medicamento),
//      volver a empezar, y que lo de uno no le llegue a otro ni a un
//      estudiante le quede cerrado.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function pedir(puerto, metodo, ruta, token, cuerpo, tipo = "application/json") {
  return new Promise((resolve, reject) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    if (cuerpo) headers["content-type"] = tipo;
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(texto); } catch {} resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", reject);
    if (cuerpo) req.write(typeof cuerpo === "string" || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
    req.end();
  });
}

const A = require(path.join(RAIZ, "services", "adaptacion"));
const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));

// Una consulta confirmada y una corrección, como las guarda la base.
const nota = (id, paciente, nombre, notaClinica = {}, dias = 0) => ({
  _id: id, pacienteId: paciente, pacienteNombre: nombre, confirmadaEn: new Date(Date.now() - dias * 864e5), notaClinica,
});
const corr = (consultaId, campo, valorSugerido, valorFinal) => ({ consultaId, campo, valorSugerido, valorFinal });
const BASE = [nota("c1", "p1", "Juan Quispe"), nota("c2", "p2", "Ana Rojas"), nota("c3", "p3", "Rosa Mamani"), nota("c4", "p1", "Juan Quispe")];
const aprender = (correcciones, confirmadas = BASE, extra = {}) => A.analizar({ correcciones, confirmadas, idioma: "es", ...extra });
const par = (r, dijo) => r.pares.find(p => A.claveDe(p.dijo) === A.claveDe(dijo));

(async () => {
  console.log("── 1. Lo que se aprende de una corrección, y lo que no ──");
  let r = aprender([corr("c1", "plan", "Se solicita jolter de 24 horas.", "Se solicita Holter de 24 horas.")]);
  verificar("«jolter» → «Holter» (el transcriptor lo oyó mal): se aprende", par(r, "jolter")?.correcto === "Holter" && par(r, "jolter").veces === 1);
  r = aprender([
    corr("c1", "plan", "Se solicita jolter de 24 horas.", "Se solicita Holter de 24 horas."),
    corr("c2", "plan", "Pedimos jolter.", "Pedimos Holter."),
  ]);
  verificar("  ...corregido en dos consultas cuenta 2", par(r, "jolter")?.veces === 2 && par(r, "jolter").pacientes === 2);
  verificar("«eco grafía» → «ecografía» (partida en dos): se aprende", par(aprender([corr("c1", "plan", "Pedimos eco grafía", "Pedimos ecografía")]), "eco grafía")?.correcto === "ecografía");
  const nada = (correcciones, confirmadas) => { const x = aprender(correcciones, confirmadas); return !x.pares.length && !x.abreviaturas.length && !x.frases.length; };
  verificar("un cambio de idea (gastritis → colecistitis) no", nada([corr("c1", "diagnostico", "Gastritis aguda", "Colecistitis aguda")]));
  verificar("un número cambiado (500 mg → 250 mg) no: es un dato", nada([corr("c1", "plan", "Amoxicilina 500 mg cada 8 horas", "Amoxicilina 250 mg cada 8 horas")]));
  verificar("el lado (derecha → izquierda) no", nada([corr("c1", "motivoConsulta", "Dolor en rodilla derecha", "Dolor en rodilla izquierda")]));
  // En minúscula y en el medio de la frase: al principio, con mayúscula, ya los
  // frena la regla de los nombres propios, y no se probaría esta.
  verificar("lado, presencia y tamaño que se parecen (superior/inferior, presentes/ausentes, mayor/menor) no", nada([
    corr("c1", "motivoConsulta", "Lesión en la cara superior", "Lesión en la cara inferior"),
    corr("c2", "plan", "Pulsos distales presentes", "Pulsos distales ausentes"),
    corr("c3", "plan", "Con riesgo mayor de caídas", "Con riesgo menor de caídas"),
  ]));
  verificar("los prefijos opuestos no: hiper/hipo, taqui/bradi, hiperglucemia/hipoglucemia", nada([
    corr("c1", "diagnostico", "Antecedente de hipertiroidismo", "Antecedente de hipotiroidismo"),
    corr("c2", "diagnostico", "Ritmo en taquicardia sinusal", "Ritmo en bradicardia sinusal"),
    corr("c4", "diagnostico", "Episodio de hiperglucemia", "Episodio de hipoglucemia"),
  ]));
  verificar("los que niegan con un prefijo no: típica/atípica, estable/inestable", nada([
    corr("c3", "diagnostico", "Una lesión típica", "Una lesión atípica"), corr("c2", "plan", "Paciente estable", "Paciente inestable"),
  ]));
  verificar("la concordancia (dolores articulares → dolor articular) no", nada([corr("c1", "sintomas", "dolores articulares", "dolor articular")]));
  verificar("borrar un «No» al principio no es una frase que no usa: cambia el sentido", nada([
    corr("c1", "antecedentesRelevantes", "No fuma.", "Fuma."), corr("c2", "antecedentesRelevantes", "No fuma.", "Fuma."),
  ]));
  verificar("un medicamento no (losartán → valsartán es un cambio de idea; omeprasol → omeprazol va por la lista oficial)", nada([
    corr("c1", "plan", "Toma losartán 50 mg", "Toma valsartán 50 mg"), corr("c2", "plan", "Indicamos omeprasol en ayunas", "Indicamos omeprazol en ayunas"),
  ]));
  verificar("un término clínico de verdad (faringitis → laringitis) no", nada([corr("c3", "antecedentesRelevantes", "Cuadros de faringitis a repetición", "Cuadros de laringitis a repetición")]));
  verificar("el nombre del paciente no sale de su consulta (mamami → mamani, aunque venga en minúscula)", nada([corr("c3", "motivoConsulta", "Control de la señora mamami", "Control de la señora mamani")]));
  verificar("el nombre de un familiar (Karla → Carla) con un solo paciente, no", nada([corr("c3", "motivoConsulta", "Viene con su hija Karla", "Viene con su hija Carla")]));
  const conSuya = [...BASE, nota("c5", "p2", "Ana Rojas", { antecedentesRelevantes: "Glicemia en ayunas normal" })];
  verificar("«glicemia» → «glucemia»: se aprende…", par(aprender([corr("c1", "sintomas", "glicemia alta", "glucemia alta")]), "glicemia")?.correcto === "glucemia");
  verificar("  ...pero no si él mismo escribe «glicemia» en otra nota: es una palabra suya", nada([corr("c1", "sintomas", "glicemia alta", "glucemia alta")], conSuya));
  verificar("si corrigió lo mismo distinto, vale la última (las correcciones vienen de la más nueva a la más vieja)", par(aprender([
    corr("c2", "plan", "Pedimos jolter.", "Pedimos Holter."), corr("c1", "plan", "Pedimos jolter.", "Pedimos Golter."),
  ]), "jolter")?.correcto === "Holter");
  verificar("una corrección en la nota de enfermería (JSON) también enseña", par(aprender([
    corr("c1", "intervenciones", JSON.stringify(["Se coloca jolter"]), JSON.stringify(["Se coloca Holter"])),
  ]), "jolter")?.correcto === "Holter");
  verificar("los medicamentos de la nota no pasan por acá (tienen su camino)", nada([corr("c1", "medicamentosRecetados", "Jolter|1|2", "Holter|1|2")]));
  verificar("una corrección de una consulta que no está entre las confirmadas, no", nada([corr("c9", "plan", "Pedimos jolter.", "Pedimos Holter.")]));

  console.log("\n── 2. Su forma de escribir ──");
  r = aprender([
    corr("c1", "diagnostico", "Dolor torácico; hipertensión arterial", "Dolor torácico; HTA"),
    corr("c2", "antecedentesRelevantes", "Hipertensión arterial hace años", "HTA hace años"),
  ]);
  verificar("«hipertensión arterial» → «HTA» en dos consultas: aprende la abreviatura", r.abreviaturas.some(a => a.corto === "HTA" && A.claveDe(a.largo) === "hipertension arterial" && a.usa === "corto"));
  verificar("  ...en una sola, todavía no (puede ser casualidad)", !aprender([corr("c1", "diagnostico", "Dolor torácico; hipertensión arterial", "Dolor torácico; HTA")]).abreviaturas.length);
  verificar("«hipotensión arterial» → «HTA» nunca: HTA dice otra cosa", nada([
    corr("c1", "plan", "Hipotensión arterial ortostática", "HTA ortostática"), corr("c2", "plan", "Hipotensión arterial ortostática", "HTA ortostática"),
  ]));
  verificar("«insuficiencia coronaria» → «IC» nunca: IC es la cardíaca", nada([
    corr("c1", "antecedentesRelevantes", "Insuficiencia coronaria", "IC"), corr("c2", "antecedentesRelevantes", "Insuficiencia coronaria", "IC"),
  ]));
  verificar("«cáncer de mama» → «CA» tampoco: le faltan las letras de «mama» (se borró un dato)", nada([
    corr("c1", "antecedentesRelevantes", "Antecedente de cáncer de mama", "Antecedente de CA"), corr("c2", "antecedentesRelevantes", "Antecedente de cáncer de mama", "Antecedente de CA"),
  ]));
  verificar("«cada 8 horas» → «c/12 h» no es una abreviatura: cambió el número", nada([
    corr("c1", "plan", "Enalapril cada 8 horas", "Enalapril c/12 h"), corr("c2", "plan", "Metformina cada 8 horas", "Metformina c/12 h"),
  ]));
  verificar("«miembro inferior derecho» → «MII» nunca: MII es el izquierdo", nada([
    corr("c1", "motivoConsulta", "Edema de miembro inferior derecho", "Edema de MII"), corr("c2", "motivoConsulta", "Edema de miembro inferior derecho", "Edema de MII"),
  ]));
  r = aprender([corr("c1", "plan", "Enalapril cada 12 horas", "Enalapril c/12 h"), corr("c2", "plan", "Metformina cada 8 horas", "Metformina c/8 h")]);
  verificar("«cada 12 horas» → «c/12 h» y «cada 8 horas» → «c/8 h»: aprende «c/N h», con el número que se diga", r.abreviaturas.some(a => a.corto === "c/N h" && a.largo === "cada N horas"));
  r = aprender([corr("c1", "plan", "Pedimos ECG", "Pedimos electrocardiograma"), corr("c2", "plan", "ECG de control", "Electrocardiograma de control")]);
  verificar("la que desarma (ECG → electrocardiograma) también", r.abreviaturas.some(a => a.corto === "ECG" && a.usa === "largo"));
  verificar("«sin» no abrevia «sintomático» (ni en mayúsculas), ni «con» a «control»", !A.esAbreviatura("sin", "sintomático") && !A.esAbreviatura("SIN", "sintomático")
    && !A.esAbreviatura("con", "control"));
  verificar("las de siempre, sí: IVU, VO, MID, DM2, Hb, eco", A.esAbreviatura("IVU", "infección de vías urinarias") && A.esAbreviatura("VO", "vía oral")
    && A.esAbreviatura("MID", "miembro inferior derecho") && A.esAbreviatura("DMN", "diabetes mellitus tipo N") && A.esAbreviatura("Hb", "hemoglobina") && A.esAbreviatura("eco", "ecografía"));

  r = aprender([corr("c1", "motivoConsulta", "Paciente refiere cefalea", "Cefalea"), corr("c2", "motivoConsulta", "Paciente refiere tos seca", "Tos seca")]);
  verificar("«Paciente refiere» borrado al empezar la frase, con dos pacientes: es una frase que no usa", r.frases.some(f => f.frase === "Paciente refiere"));
  verificar("  ...con un solo paciente (dos consultas), todavía no", !aprender([
    corr("c1", "plan", "Se le explica la dieta", "La dieta"), corr("c4", "plan", "Se le explica el reposo", "El reposo"),
  ]).frases.length);
  r = aprender([corr("c1", "motivoConsulta", "Paciente refiere hipertensión arterial", "HTA"), corr("c2", "motivoConsulta", "Paciente refiere hipertensión arterial", "HTA")]);
  verificar("borrar el principio y abreviar el resto en el mismo lugar: aprende las dos cosas", r.frases.some(f => f.frase === "Paciente refiere") && r.abreviaturas.some(a => a.corto === "HTA"));
  verificar("borrar una oración entera al final no es «una frase que no usa»", !aprender([
    corr("c1", "plan", "Control en 7 días. Reposo relativo.", "Control en 7 días."), corr("c2", "plan", "Control en 7 días. Reposo relativo.", "Control en 7 días."),
  ]).frases.length);

  // El largo: notas confirmadas con lo que escribió la IA y lo que quedó.
  const larga = "La paciente refiere que desde hace una semana presenta dolor de cabeza que se intensifica por la tarde y que mejora parcialmente con el descanso, sin otros síntomas.";
  const corta = "Cefalea de una semana, vespertina, mejora con descanso.";
  const notasLargo = (final) => [1, 2, 3, 4, 5].map(i => nota(`l${i}`, `q${i}`, "Paciente Prueba", { motivoConsulta: final }));
  const corrLargo = (final) => [1, 2, 3, 4, 5].map(i => corr(`l${i}`, "motivoConsulta", larga, final));
  verificar("si deja las notas a un tercio de lo que escribió la IA → «breve»", aprender(corrLargo(corta), notasLargo(corta)).largo === "breve");
  verificar("si las deja como están → «normal»", aprender([], notasLargo(larga)).largo === "normal");
  verificar("con menos de cinco notas, todavía no sabe", aprender(corrLargo(corta).slice(0, 4), notasLargo(corta).slice(0, 4)).largo === "");
  const enLista = "- Holter de 24 horas\n- Enalapril c/12 h\n- Control en 7 días";
  verificar("si deja el plan en viñetas en la mayoría de sus notas → viñetas", aprender([], [1, 2, 3].map(i => nota(`v${i}`, `q${i}`, "P", { plan: enLista }))).vinetas === "si");
  verificar("si desarmó en dos consultas las viñetas de la IA → texto corrido", aprender(
    [corr("v1", "plan", enLista, "Holter de 24 horas, enalapril c/12 h y control en 7 días."), corr("v2", "plan", enLista, "Holter, enalapril y control en 7 días.")],
    [1, 2].map(i => nota(`v${i}`, `q${i}`, "P", { plan: "Holter de 24 horas, enalapril c/12 h y control en 7 días." }))).vinetas === "no");

  const conTerminos = [
    nota("t1", "p1", "Juan Quispe", { examenesSolicitados: ["Perfil lipídico", "Ecografía renal", "Paracetamol", "Control en 3 meses"], diagnostico: "Dislipidemia; Hígado graso" }),
    nota("t2", "p2", "Ana Rojas", { examenesSolicitados: ["Perfil lipídico", "Control en 3 meses", "Paracetamol"], diagnostico: "Dislipidemia" }),
    nota("t3", "p1", "Juan Quispe", { examenesSolicitados: ["Ecografía renal"] }),
  ];
  const terminos = aprender([], conTerminos).terminos.map(x => x.termino);
  verificar(`sus términos de siempre, de dos pacientes o más (${terminos.join(", ")})`, terminos.includes("Perfil lipídico") && terminos.includes("Dislipidemia"));
  verificar("  ...lo de un solo paciente, no (aunque se repita)", !terminos.includes("Ecografía renal") && !terminos.includes("Hígado graso"));
  verificar("  ...con números, no; un medicamento, tampoco (va por su camino)", !terminos.some(x => /\d/.test(x)) && !terminos.includes("Paracetamol"));
  verificar("«volver a empezar»: lo confirmado antes no cuenta", aprender([], conTerminos, { desde: new Date(Date.now() + 1000) }).notas === 0);

  const instrucciones = A.instruccionesDeEstilo({ largo: "breve", vinetas: "si", frases: ["Paciente refiere"],
    abreviaturas: [{ corto: "HTA", largo: "hipertensión arterial", usa: "corto" }, { corto: "c/N h", largo: "cada N horas", usa: "corto" }, { corto: "ECG", largo: "electrocardiograma", usa: "largo" }] }).join(" ");
  verificar("cómo se le cuenta a la IA: largo, viñetas, abreviaturas (con el número que se dijo), las que desarma y las frases",
    /corto y directo/.test(instrucciones) && /viñetas/.test(instrucciones) && /«HTA» por «hipertensión arterial»/.test(instrucciones)
    && /«c\/N h» por «cada N horas» \(N es el número que se dijo\)/.test(instrucciones) && /«electrocardiograma» y no «ECG»/.test(instrucciones)
    && /No empieza las frases con «Paciente refiere»/.test(instrucciones));
  verificar("sin nada aprendido, nada que contarle", A.instruccionesDeEstilo({ largo: "normal", vinetas: "", frases: [], abreviaturas: [] }).length === 0);

  console.log("\n── 3. El vocabulario para transcribir ──");
  const { keytermsPara, MAX_KEYTERMS, MAX_KEYTERMS_PROPIOS } = assemblyai;
  const meds = ["Rivotril", "Glifage XR"];
  const propias = ["Holter", "Perfil lipídico", "rivotril", ...Array.from({ length: 40 }, (_, i) => `Palabra${i}`)];
  const lista = keytermsPara("medicina_general", "es", meds, propias);
  verificar("sus medicamentos primero, después sus palabras", lista[0] === "Rivotril" && lista[2] === "Holter" && lista[3] === "Perfil lipídico");
  verificar(`como mucho ${MAX_KEYTERMS_PROPIOS} palabras suyas, sin repetir un medicamento`, lista.filter(x => /^Palabra\d/.test(x)).length === MAX_KEYTERMS_PROPIOS - 2
    && lista.filter(x => x.toLowerCase() === "rivotril").length === 1);
  verificar(`nunca más de ${MAX_KEYTERMS}, y la especialidad sigue`, lista.length <= MAX_KEYTERMS && keytermsPara("odontologia", "es", meds, propias).includes("odontograma"));
  verificar("sin palabras suyas, como antes", JSON.stringify(keytermsPara("medicina_general", "es", meds)) === JSON.stringify(keytermsPara("medicina_general", "es", meds, [])));

  console.log("\n── 4. De la consulta confirmada a la próxima ──");
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "adaptacion_prueba";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Promise.all([M.ConsultaMedica.syncIndexes(), M.Adaptacion.syncIndexes()]);

  // La transcripción de mentira: guarda con qué vocabulario la llamaron.
  let llamadaTranscripcion = null;
  assemblyai.transcribirConsultaMedica = async (buf, esp, idioma, opciones) => {
    llamadaTranscripcion = { esp, idioma, opciones };
    return { transcripcionCompleta: "", segmentos: [], duracionSegundos: 60 };
  };
  // La IA de mentira: guarda lo que se le pidió.
  const axios = require(path.join(RAIZ, "node_modules", "axios"));
  const pedidosIA = [];
  axios.post = async (url, cuerpo) => {
    pedidosIA.push(cuerpo);
    return { data: { choices: [{ message: { content: JSON.stringify({ motivoConsulta: "Control", plan: "Control" }) } }] } };
  };

  const hash = await hashPassword("Prueba123.");
  const MED = "70000101", MED2 = "70000102";
  await M.Medico.create({ phone: MED, nombre: "Dra. Adaptada", passwordHash: hash, idioma: "es", tipoEspecialidad: "medicina_general" });
  await M.Medico.create({ phone: MED2, nombre: "Dr. Otro", passwordHash: hash, idioma: "es", tipoEspecialidad: "medicina_general" });
  const tk = generarToken(MED, "medico", 36e5), tk2 = generarToken(MED2, "medico", 36e5);
  const p1 = await M.Paciente.create({ medicoPhone: MED, nombre: "Juan Quispe" });
  const p2 = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Rojas" });
  const pOtro = await M.Paciente.create({ medicoPhone: MED2, nombre: "Luis Vaca" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  require(path.join(RAIZ, "routes", "adaptacion"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const llamar = (metodo, ruta, cuerpo, token = tk, tipo) => pedir(puerto, metodo, ruta, token, cuerpo, tipo);

  const nueva = (paciente, notaClinica, phone = MED) => M.ConsultaMedica.create({ medicoPhone: phone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
    estado: "completado", transcripcionCompleta: "Consulta de control. ".repeat(30), notaClinicaEstado: "completado", notaClinica });
  const confirmar = (c, notaEditada, token = tk) => llamar("POST", `/medico/consultas/${c._id}/confirmar`, { nota: notaEditada, aplicar: {} }, token);
  // El pedido de la nota en vivo, con un texto distinto cada vez (el borrador
  // de un mismo texto no se vuelve a pedir).
  let vueltas = 0;
  async function promptDeNota(paciente = p1, token = tk) {
    pedidosIA.length = 0;
    const texto = `Consulta número ${++vueltas}: el paciente viene a control y cuenta cómo estuvo esta semana con su tratamiento.`;
    await llamar("POST", "/medico/consultas/nota-en-vivo", { texto, pacienteId: String(paciente._id) }, token);
    return JSON.stringify(pedidosIA.find(p => /odontogramaSugerido/.test(p.messages?.[0]?.content || ""))?.messages || []);
  }
  const { parametrosDeConexion } = require(path.join(RAIZ, "services", "vistaPrevia"));
  const terminosVivo = async (phone = MED) => JSON.parse((await parametrosDeConexion(phone)).get("keyterms_prompt") || "[]");

  const c1 = await nueva(p1, { motivoConsulta: "Paciente refiere dolor torácico", plan: "Se solicita jolter de 24 horas. Enalapril cada 12 horas.",
    diagnostico: "Dolor torácico; hipertensión arterial", examenesSolicitados: ["Perfil lipídico"], medicamentosRecetados: [{ nombre: "Espironolactna", dosis: "25 mg" }] });
  const r1 = await confirmar(c1, { motivoConsulta: "Dolor torácico", plan: "Se solicita Holter de 24 horas. Enalapril c/12 h.",
    diagnostico: "Dolor torácico; HTA", examenesSolicitados: ["Perfil lipídico"], medicamentosRecetados: [{ origen: 0, nombre: "Espironolactona", dosis: "25 mg" }] });
  verificar("confirmar la primera consulta corregida → 200", r1.estado === 200);
  verificar("la primera corrección: «Holter» ya va al transcriptor en vivo, enseguida", (await terminosVivo()).includes("Holter"));
  let prompt = await promptDeNota();
  verificar("  ...y la IA de la nota la conoce como palabra suya", /Palabras que usa este profesional/.test(prompt) && prompt.includes("Holter"));
  verificar("  ...pero todavía no le cambia «jolter» por «Holter» (una vez puede ser casualidad)", !/jolter/.test(prompt));
  verificar("  ...ni le cuenta abreviaturas o frases de una sola consulta", !/Cómo escribe sus notas/.test(prompt));

  const c2 = await nueva(p2, { motivoConsulta: "Paciente refiere palpitaciones", plan: "Pedimos jolter. Metformina cada 8 horas.",
    diagnostico: "Palpitaciones; hipertensión arterial", examenesSolicitados: ["Perfil lipídico"] });
  await confirmar(c2, { motivoConsulta: "Palpitaciones", plan: "Pedimos Holter. Metformina c/8 h.", diagnostico: "Palpitaciones; HTA", examenesSolicitados: ["Perfil lipídico"] });
  prompt = await promptDeNota();
  verificar("la segunda (sin esperar nada): la IA ya escribe «Holter» aunque el transcriptor diga «jolter»", /corrigió en dos consultas o más/.test(prompt) && /\\"jolter\\" → \\"Holter\\"/.test(prompt));
  verificar("  ...usa sus abreviaturas: «HTA» y «c/N h»", /«HTA» por «hipertensión arterial»/.test(prompt) && /«c\/N h» por «cada N horas»/.test(prompt));
  verificar("  ...no empieza con «Paciente refiere»", /No empieza las frases con «Paciente refiere»/.test(prompt));
  verificar("  ...y sus términos de siempre (Perfil lipídico, de dos pacientes)", prompt.includes("Perfil lipídico"));
  verificar("  ...con la regla: es solo la forma, nunca un dato", /SOLO la forma: nunca agregues, quites ni cambies un dato clínico/.test(prompt) && /NUNCA agregues una de estas palabras si no se dijo/.test(prompt));
  verificar("  ...sin el nombre de ningún paciente", !/Quispe|Rojas/.test(prompt.replace(/Consulta número[^"]*/g, "")));

  const sub = await llamar("POST", `/medico/consultas?pacienteId=${p1._id}`, Buffer.from("audio"), tk, "audio/ogg");
  for (let i = 0; i < 50 && !llamadaTranscripcion; i++) await new Promise((res) => setTimeout(res, 50));
  verificar("subir una consulta → 202", sub.estado === 202);
  verificar("la transcripción final recibe sus palabras, aparte de sus medicamentos",
    llamadaTranscripcion?.opciones?.propios?.includes("Holter") && llamadaTranscripcion.opciones.propios.includes("Perfil lipídico")
    && Array.isArray(llamadaTranscripcion.opciones.delMedico));

  console.log("\n── 5. Configuración ──");
  let v = (await llamar("GET", "/medico/adaptacion")).cuerpo;
  verificar(`ve de cuántas notas aprendió (${v?.notas})`, v?.notas === 2);
  verificar("ve lo que corrigió: «jolter» → «Holter», 2 veces, y el medicamento",
    v.correcciones.some(x => x.clave === "par:jolter" && x.correcto === "Holter" && x.veces === 2)
    && v.correcciones.some(x => x.medicamento && x.dijo === "Espironolactna" && x.correcto === "Espironolactona"));
  verificar("ve sus abreviaturas y sus frases", v.abreviaturas.some(a => a.clave === "abrev:hipertension arterial" && a.corto === "HTA")
    && v.abreviaturas.some(a => a.corto === "c/N h") && v.frases.some(f => f.clave === "frase:paciente refiere"));
  verificar("ve su vocabulario, con de dónde salió cada palabra", v.terminos.some(x => x.termino === "Holter" && x.origen === "corregido")
    && v.terminos.some(x => x.termino === "Perfil lipídico" && x.origen === "frecuente"));
  verificar("el largo y las viñetas, en automático", v.largo.elegido === "" && v.vinetas.elegido === "");

  verificar("elegir el largo → 200", (await llamar("PATCH", "/medico/adaptacion", { largo: "breve" })).estado === 200);
  await llamar("PATCH", "/medico/adaptacion", { vinetas: "si" });
  prompt = await promptDeNota();
  verificar("  ...y la nota sale corta y con el plan en viñetas", /Escribe corto y directo/.test(prompt) && /El plan lo escribe en viñetas/.test(prompt));
  verificar("un largo que no existe → 400", (await llamar("PATCH", "/medico/adaptacion", { largo: "enorme" })).estado === 400);
  verificar("sin nada que cambiar → 400", (await llamar("PATCH", "/medico/adaptacion", {})).estado === 400);

  verificar("agregar una palabra → 200", (await llamar("POST", "/medico/adaptacion/agregar", { tipo: "termino", texto: "Ecografía Doppler" })).estado === 200);
  verificar("  ...el transcriptor ya la escucha", (await terminosVivo()).includes("Ecografía Doppler"));
  await llamar("POST", "/medico/adaptacion/agregar", { tipo: "abreviatura", corto: "IC", largo: "insuficiencia cardíaca" });
  await llamar("POST", "/medico/adaptacion/agregar", { tipo: "frase", texto: "Se observa" });
  prompt = await promptDeNota();
  verificar("agregar una abreviatura y una frase: la IA las usa", /«IC» por «insuficiencia cardíaca»/.test(prompt) && /«Se observa»/.test(prompt));
  verificar("una palabra de más de 6 palabras → 400 (el transcriptor no la acepta)",
    (await llamar("POST", "/medico/adaptacion/agregar", { tipo: "termino", texto: "uno dos tres cuatro cinco seis siete" })).estado === 400);
  verificar("vacía → 400; una abreviatura sin significado → 400; algo que no existe → 400",
    (await llamar("POST", "/medico/adaptacion/agregar", { tipo: "termino", texto: "  " })).estado === 400
    && (await llamar("POST", "/medico/adaptacion/agregar", { tipo: "abreviatura", corto: "IC" })).estado === 400
    && (await llamar("POST", "/medico/adaptacion/agregar", { tipo: "otra", texto: "x" })).estado === 400);

  verificar("sacar «jolter» → 200", (await llamar("POST", "/medico/adaptacion/quitar", { clave: "par:jolter" })).estado === 200);
  prompt = await promptDeNota();
  verificar("  ...la IA ya no lo cambia, y el transcriptor ya no tiene «Holter»", !/jolter/.test(prompt) && !(await terminosVivo()).includes("Holter"));
  v = (await llamar("GET", "/medico/adaptacion")).cuerpo;
  verificar("  ...y no vuelve a aparecer", !v.correcciones.some(x => x.clave === "par:jolter"));
  await llamar("POST", "/medico/adaptacion/quitar", { clave: "abrev:hipertension arterial" });
  await llamar("POST", "/medico/adaptacion/quitar", { clave: "termino:perfil lipidico" });
  prompt = await promptDeNota();
  verificar("sacar una abreviatura aprendida y una palabra: se van", !/«HTA»/.test(prompt) && !(await terminosVivo()).includes("Perfil lipídico"));
  await llamar("POST", "/medico/adaptacion/agregar", { tipo: "termino", texto: "Perfil lipídico" });
  verificar("  ...agregarla de nuevo la vuelve a poner", (await terminosVivo()).includes("Perfil lipídico"));
  await llamar("POST", "/medico/adaptacion/quitar", { clave: "termino:ecografia doppler" });
  v = (await llamar("GET", "/medico/adaptacion")).cuerpo;
  verificar("sacar una palabra que agregó él la borra", !v.terminos.some(x => x.termino === "Ecografía Doppler"));

  const c3 = await nueva(p1, { motivoConsulta: "Control", medicamentosRecetados: [{ nombre: "Espironolactna" }] });
  const verif = async () => (await llamar("GET", `/medico/consultas/${c3._id}`)).cuerpo?.consulta?.verificacionMedicamentos?.[0];
  verificar("el medicamento corregido se propone como él lo escribió…", (await verif())?.aprendido === true && (await verif()).sugerencia === "Espironolactona");
  await llamar("POST", "/medico/adaptacion/quitar", { clave: "med:espironolactna" });
  const despues = await verif();
  // Sigue marcado como «parecido»: Espironolactona está en sus recetas. Lo que
  // se va es que la propuesta salga de esa corrección.
  verificar("  ...sacada la corrección, la propuesta ya no sale de ella", despues?.estado === "parecido" && !despues.aprendido);
  verificar("sacar algo que no existe → 400", (await llamar("POST", "/medico/adaptacion/quitar", { clave: "x:y" })).estado === 400
    && (await llamar("POST", "/medico/adaptacion/quitar", { clave: "par:" })).estado === 400);

  console.log("\n── 6. Lo de uno no le llega a otro ──");
  const v2 = (await llamar("GET", "/medico/adaptacion", null, tk2)).cuerpo;
  verificar("otro médico no ve nada de esto", v2.notas === 0 && !v2.correcciones.length && !v2.terminos.length && !v2.abreviaturas.length && !v2.frases.length);
  const prompt2 = await promptDeNota(pOtro, tk2);
  verificar("  ...ni su IA lo recibe", prompt2.length > 2 && !/Holter|HTA|Paciente refiere|Perfil lipídico|corto y directo/.test(prompt2));
  verificar("  ...ni su transcriptor", !(await terminosVivo(MED2)).some(x => ["Holter", "Perfil lipídico", "Ecografía Doppler"].includes(x)));
  verificar("sin sesión → 401", (await llamar("GET", "/medico/adaptacion", null, null)).estado === 401);
  const restricciones = require(path.join(RAIZ, "modulos", "estudiantes", "restricciones"));
  verificar("un estudiante puede verlo y cambiarlo (es de su cuenta, no gasta IA)", restricciones.rutaPermitida("GET", "/medico/adaptacion")
    && restricciones.rutaPermitida("PATCH", "/medico/adaptacion") && restricciones.rutaPermitida("POST", "/medico/adaptacion/quitar")
    && restricciones.rutaPermitida("POST", "/medico/adaptacion/reiniciar") && !restricciones.gastaIA("POST", "/medico/adaptacion/agregar"));
  verificar("  ...y nada más que eso", !restricciones.rutaPermitida("POST", "/medico/adaptacion/otra") && !restricciones.rutaPermitida("DELETE", "/medico/adaptacion"));

  console.log("\n── 7. Volver a empezar ──");
  verificar("volver a empezar → 200", (await llamar("POST", "/medico/adaptacion/reiniciar")).estado === 200);
  v = (await llamar("GET", "/medico/adaptacion")).cuerpo;
  verificar("no queda nada aprendido ni agregado (tampoco los medicamentos corregidos)", v.notas === 0 && !v.correcciones.length && !v.terminos.length
    && !v.abreviaturas.length && !v.frases.length && v.largo.elegido === "" && v.vinetas.elegido === "");
  prompt = await promptDeNota();
  verificar("  ...la IA vuelve a escribir como al principio", prompt.length > 2 && !/Palabras que usa|Cómo escribe sus notas|corrigió en dos/.test(prompt));
  verificar("  ...el transcriptor también", !(await terminosVivo()).some(x => ["Holter", "Perfil lipídico"].includes(x)));
  verificar("  ...y queda registrado", Boolean(await M.AuditLog.findOne({ medicoPhone: MED, accion: "adaptacion_reiniciada" })));
  const c4 = await nueva(p2, { plan: "Pedimos jolter." });
  await confirmar(c4, { plan: "Pedimos Holter." });
  v = (await llamar("GET", "/medico/adaptacion")).cuerpo;
  verificar("y desde ahí aprende de nuevo, de cero", v.notas === 1 && v.correcciones.some(x => x.clave === "par:jolter" && x.veces === 1));

  servidor.close();
  await new Promise((res) => setTimeout(res, 300));
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
