// Symphomed — La nota de enfermería: el proceso de atención por voz.
//
// Las cuentas con tipoEspecialidad "enfermeria" (hoy, los estudiantes de
// enfermería: modulos/estudiantes/carreras.js) no escriben la nota del médico:
// escriben la del proceso de atención de enfermería —valoración por patrones
// funcionales, diagnósticos en formato PES, objetivos, intervenciones y
// evaluación— (services/notaClinica.js). Lo que se prueba:
//   1. El prompt: PES y los patrones de Gordon, sin taxonomías con licencia ni
//      datos inventados; en portugués, el contenido en portugués y las claves no.
//   2. Las claves que vuelven traducidas o envueltas se reconocen.
//   3. La limpieza: patrones conocidos, una vez y en orden; sin filas vacías;
//      con topes que no se comen lo que se escribe a mano.
//   4. Solo las cuentas de enfermería la piden, y la que vuelve vacía se pide
//      de nuevo una vez.
//   5. Las rutas: regenerar en una cuenta de enfermería; confirmar guarda lo
//      corregido (limpio) y registra cada corrección; confirmar sin cambios no
//      marca nada como corregido; medicina sigue igual.
//   6. La nota en vivo: el borrador sale con el formato de enfermería, y la
//      que se escribió en vivo no queda esperando una verificación que no
//      aplica (la verificación compara medicamentos recetados).
//   7. Lo que la leen otros: el resumen previo, el hilo, la memoria clínica,
//      el Kardex en PDF y la lista del Kardex.
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarHasta(condicion, ms = 5000) {
  for (let t = 0; t < ms; t += 50) { if (await condicion()) return true; await esperar(50); }
  return false;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    // Un Buffer es una grabación que se sube; lo demás, JSON.
    const datos = cuerpo === undefined ? null : Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = Buffer.isBuffer(cuerpo) ? "audio/ogg" : "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// Lo que contesta la IA de enfermería, de a una por pedido (la última se
// repite). Una atención de un niño con fiebre.
const NOTA_ENF = {
  motivoConsulta: "Fiebre de dos días",
  valoracion: [
    { patron: "sueno", hallazgos: "Duerme poco por la fiebre" },
    { patron: "nutricional", hallazgos: "Inapetencia, mucosas secas" },
    { patron: "actividad", hallazgos: "Deambula sin ayuda" },
  ],
  signosVitales: { PA: "110/70 mmHg", FC: "98 lpm", FR: null, T: "38,6 °C", SatO2: null, dolor: null, glucemia: null },
  diagnosticosEnfermeria: [
    { problema: "Hipertermia", etiologia: "proceso infeccioso", signos: "T 38,6 °C, piel caliente" },
    { problema: "Riesgo de déficit de volumen de líquidos", etiologia: "fiebre e ingesta escasa", signos: null },
  ],
  objetivos: ["Temperatura menor a 37,5 °C en 4 horas"],
  intervenciones: ["Control de temperatura cada 2 horas", "Compresas tibias", "Ofrecer líquidos"],
  evaluacion: null,
  educacion: "Se explicó a la madre cómo controlar la temperatura",
};
const VACIA_ENF = { motivoConsulta: null, valoracion: [], signosVitales: {}, diagnosticosEnfermeria: [], objetivos: [], intervenciones: [], evaluacion: null, educacion: null };

const axios = require(path.join(RAIZ, "node_modules", "axios"));
const pedidos = [];
let colaEnfermeria = [NOTA_ENF];
const contestar = (obj) => ({ data: { choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] } });
axios.post = async (_url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const usuario = cuerpo.messages.at(-1).content;
  const tipo = /NOTA DE ENFERMERÍA/.test(sistema) ? "enfermeria"
    : /"brief clínico"/.test(sistema) ? "brief"
    : /^CONSULTA DE HOY/.test(usuario) ? "hilo"
    : /historia de UN paciente/.test(sistema) ? "memoria" : "medica";
  pedidos.push({ tipo, sistema, usuario, mensajes: cuerpo.messages });
  if (tipo === "enfermeria") return contestar(colaEnfermeria.length > 1 ? colaEnfermeria.shift() : colaEnfermeria[0]);
  if (tipo === "brief") return contestar({ estadoActual: "estable", medicamentosActivos: [], alertas: [] });
  if (tipo === "hilo") return contestar({ conexiones: [], preguntasParaElMedico: [] });
  if (tipo === "memoria") return contestar("Respuesta de la memoria");
  return contestar({ motivoConsulta: "Control", diagnostico: "Faringitis", plan: "Reposo", medicamentosRecetados: [] });
};

// AssemblyAI de mentira: cada transcripción termina cuando la prueba dice.
const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));
const transcripciones = [];
assemblyai.transcribirConsultaMedica = () => new Promise((resolve, reject) => transcripciones.push({ resolve, reject }));
async function terminarTranscripcion(texto, { falla = false } = {}) {
  await esperarHasta(() => transcripciones.length > 0);
  const t = transcripciones.shift();
  if (falla) t.reject(Object.assign(new Error("AssemblyAI falló"), { definitiva: true }));
  else t.resolve({ transcripcionCompleta: texto, segmentos: [{ hablante: "A", texto }], duracionSegundos: 600 });
}

// Una atención de más de 80 palabras: con menos, una nota vacía no se pide
// de nuevo (services/notaClinica.js, PALABRAS_MINIMAS_PARA_NOTA).
const TRANSCRIPCION = ("Buenos días, vengo con mi hijo porque tiene fiebre desde hace dos días y casi no come. " +
  "Le vamos a controlar los signos vitales: la presión está en ciento diez sobre setenta, el pulso en noventa y ocho " +
  "y la temperatura en treinta y ocho coma seis. Duerme poco por la fiebre, camina solo sin ayuda. " +
  "Vamos a ponerle compresas tibias, controlar la temperatura cada dos horas y ofrecerle líquidos de a poco. " +
  "Le explico cómo controlar la temperatura en casa y cuándo volver si sigue con fiebre o deja de orinar. ").repeat(2);

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "nota_enfermeria";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const NC = require(path.join(RAIZ, "services", "notaClinica"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Promise.all([M.Medicamento, M.Vacuna, M.Receta, M.TratamientoPlan, M.ConsultaMedica].map(x => x.syncIndexes()));

  console.log("── 1. El prompt ──");
  const pEs = NC.promptEnfermeria("es");
  const pPt = NC.promptEnfermeria("pt");
  verificar("pide el formato PES (problema, etiología, signos)", /"problema"/.test(pEs) && /"etiologia"/.test(pEs) && /"signos"/.test(pEs) && /PES/.test(pEs));
  verificar("  ...y los 11 patrones funcionales, con sus claves exactas",
    NC.PATRONES_GORDON.length === 11 && NC.PATRONES_GORDON.every(p => pEs.includes(p)));
  verificar("  ...prohíbe usar las taxonomías con licencia (NANDA-I, NIC, NOC)", /NO uses códigos ni\s+etiquetas textuales de taxonomías con licencia \(NANDA-I, NIC, NOC\)/.test(pEs));
  verificar("  ...y no trae ningún código de esas taxonomías", !/\b000\d{2}\b/.test(pEs));
  verificar("  ...prohíbe inventar datos y completar dosis que no se dijeron", /NUNCA inventes datos/.test(pEs) && /una dosis que no se dijo NO se completa/.test(pEs));
  verificar("en portugués: el contenido en portugués, las claves y los patrones tal cual",
    /portugu/i.test(pPt) && /CLAVES del JSON NO se traducen/.test(pPt) && /valor de "patron": va tal cual/.test(pPt));

  console.log("\n── 2. Las claves traducidas o envueltas se reconocen ──");
  const enPortugues = {
    queixaPrincipal: "Febre há dois dias",
    coletaDeDados: [{ padrao: "Padrão sono e repouso", achados: "Dorme pouco" }, { padraoFuncional: "Nutricional-metabólico", dados: "Inapetência" }],
    sinaisVitais: { pressaoArterial: "110/70 mmHg", temperatura: "38,6 °C", spo2: "97%", dor: "null" },
    diagnosticosDeEnfermagem: [{ titulo: "Hipertermia", relacionadoA: "processo infeccioso", evidenciadoPor: "pele quente" }, "Risco de quedas"],
    metas: "Temperatura abaixo de 37,5 °C; Hidratação adequada",
    intervencoes: ["Compressas mornas"],
    avaliacao: ["Afebril após 2 horas"],
    educacaoEmSaude: "Orientada a mãe",
  };
  let r = NC.normalizarNotaEnfermeria(enPortugues);
  let n = NC.sanearNotaEnfermeria(r.nota);
  verificar("las claves en portugués quedan marcadas como ajustadas", r.clavesAjustadas === true);
  verificar(`  ...el motivo y los patrones salen bien (${n.valoracion.map(v => v.patron).join(", ")})`,
    n.motivoConsulta === "Febre há dois dias" && n.valoracion.length === 2 && n.valoracion[0].patron === "nutricional" && n.valoracion[1].patron === "sueno");
  verificar(`  ...los signos vitales por su nombre, sin el «null» (${JSON.stringify(n.signosVitales)})`,
    n.signosVitales.PA === "110/70 mmHg" && n.signosVitales.T === "38,6 °C" && n.signosVitales.SatO2 === "97%" && !("dolor" in n.signosVitales));
  verificar("  ...el diagnóstico en PES, y uno que vino como texto suelto queda como problema",
    n.diagnosticosEnfermeria[0].problema === "Hipertermia" && n.diagnosticosEnfermeria[0].etiologia === "processo infeccioso"
    && n.diagnosticosEnfermeria[0].signos === "pele quente" && n.diagnosticosEnfermeria[1].problema === "Risco de quedas");
  verificar("  ...las metas separadas, la evaluación en texto y la educación",
    n.objetivos.length === 2 && n.intervenciones[0] === "Compressas mornas" && n.evaluacion === "Afebril após 2 horas" && n.educacion === "Orientada a mãe");
  r = NC.normalizarNotaEnfermeria({ notaDeEnfermagem: { motivoConsulta: "Curación", intervenciones: ["Curación de herida"] } });
  verificar("una nota envuelta en otro objeto se desenvuelve", r.clavesAjustadas && r.nota.motivoConsulta === "Curación");
  r = NC.normalizarNotaEnfermeria({ valoracion: { "Eliminação": "Diurese presente", sueno: "Insônia" } });
  n = NC.sanearNotaEnfermeria(r.nota);
  verificar("una valoración que vino como objeto por patrón también sirve", n.valoracion.length === 2 && n.valoracion[0].patron === "eliminacion");

  console.log("\n── 3. La limpieza ──");
  n = NC.sanearNotaEnfermeria({
    valoracion: [
      { patron: "valores", hallazgos: "Católica" },
      { patron: "inventado", hallazgos: "No es un patrón" },
      { patron: "sueno", hallazgos: "" },
      { patron: "nutricional", hallazgos: "Come poco" },
      { patron: "Nutricional", hallazgos: "Mucosas secas" },
    ],
    diagnosticosEnfermeria: [...Array(12)].map((_, i) => ({ problema: i === 3 ? "" : `Problema ${i}` })),
    intervenciones: [...Array(25)].map((_, i) => `Intervención ${i}`),
    evaluacion: "x".repeat(1800),
  });
  verificar("formato «enfermeria»", n.formato === "enfermeria");
  verificar(`patrones conocidos, uno por vez y en el orden de Gordon (${n.valoracion.map(v => v.patron).join(", ")})`,
    n.valoracion.map(v => v.patron).join(",") === "nutricional,valores" && n.valoracion[0].hallazgos === "Come poco; Mucosas secas");
  verificar(`diagnósticos sin problema afuera, hasta ${NC.TOPES_ENFERMERIA.diagnosticos}`,
    n.diagnosticosEnfermeria.length === NC.TOPES_ENFERMERIA.diagnosticos && !n.diagnosticosEnfermeria.some(d => d.problema === "Problema 3"));
  verificar("una lista larga escrita a mano no se recorta (25 intervenciones)", n.intervenciones.length === 25);
  verificar("  ...ni una evaluación larga", n.evaluacion.length === 1800);
  verificar("una nota sin nada está vacía; con un signo vital, no",
    NC.notaVacia(NC.sanearNotaEnfermeria({})) && !NC.notaVacia(NC.sanearNotaEnfermeria({ signosVitales: { PA: "120/80" } })));

  console.log("\n── 4. Solo enfermería la pide; la vacía se pide de nuevo ──");
  pedidos.length = 0;
  let nota = await NC.generarNotaClinica(TRANSCRIPCION, { enfermeria: true }, "es");
  verificar("una cuenta de enfermería pide la nota de enfermería", pedidos.length === 1 && pedidos[0].tipo === "enfermeria");
  verificar("  ...y vuelve con su formato", nota.formato === "enfermeria" && nota.diagnosticosEnfermeria[0].problema === "Hipertermia");
  pedidos.length = 0;
  nota = await NC.generarNotaClinica(TRANSCRIPCION, { enfermeria: false }, "es");
  verificar("una cuenta de medicina sigue con la nota médica", pedidos[0]?.tipo === "medica" && !nota.formato && nota.diagnostico === "Faringitis");
  pedidos.length = 0;
  colaEnfermeria = [VACIA_ENF, NOTA_ENF];
  nota = await NC.generarNotaClinica(TRANSCRIPCION, { enfermeria: true }, "es");
  verificar("la que vuelve vacía se pide de nuevo, recordando las claves",
    pedidos.length === 2 && /diagnosticosEnfermeria/.test(pedidos[1].mensajes.at(-1).content) && nota.valoracion.length === 3);
  colaEnfermeria = [VACIA_ENF];
  let error = "";
  try { await NC.generarNotaClinica(TRANSCRIPCION, { enfermeria: true }, "es"); } catch (e) { error = e.message; }
  verificar("  ...y si vuelve vacía otra vez, es un error que se ve", /nota vacía/.test(error));
  colaEnfermeria = [NOTA_ENF];

  console.log("\n── 5. Regenerar y confirmar ──");
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  require(path.join(RAIZ, "routes", "memoriaClinica"))(app);
  require(path.join(RAIZ, "routes", "pacientes"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const ENF = "70088001";
  const MED = "70088002";
  await M.Medico.create({ phone: ENF, nombre: "Ana Enfermera", passwordHash: "x", activo: true, tipoEspecialidad: "enfermeria" });
  await M.Medico.create({ phone: MED, nombre: "Dr. Médico", passwordHash: "x", activo: true, tipoEspecialidad: "medicina_general" });
  const tkEnf = generarToken(ENF, "medico", 36e5);
  const tkMed = generarToken(MED, "medico", 36e5);
  const puerto = () => servidor.address().port;
  const pacEnf = await M.Paciente.create({ medicoPhone: ENF, nombre: "Tomás Choque" });
  const pacMed = await M.Paciente.create({ medicoPhone: MED, nombre: "Lucía Mamani" });
  const consultaFallida = (medicoPhone, pac) => M.ConsultaMedica.create({
    medicoPhone, pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "completado",
    notaClinicaEstado: "error", transcripcionCompleta: TRANSCRIPCION,
  });
  const leer = (c) => M.ConsultaMedica.findById(c._id).lean();

  pedidos.length = 0;
  const c1 = await consultaFallida(ENF, pacEnf);
  let rr = await pedir(puerto(), "POST", `/medico/consultas/${c1._id}/nota/regenerar`, tkEnf);
  verificar(`regenerar en una cuenta de enfermería (${rr.estado})`, rr.estado === 202);
  await esperarHasta(async () => (await leer(c1)).notaClinicaEstado === "completado");
  let g = await leer(c1);
  verificar("la nota guardada es la de enfermería", g.notaClinica?.formato === "enfermeria" && pedidos.some(p => p.tipo === "enfermeria"));
  verificar(`  ...con la valoración en el orden de Gordon (${(g.notaClinica?.valoracion || []).map(v => v.patron).join(", ")})`,
    (g.notaClinica?.valoracion || []).map(v => v.patron).join(",") === "nutricional,actividad,sueno");
  verificar("  ...sus signos vitales y sus diagnósticos PES",
    g.notaClinica.signosVitales?.T === "38,6 °C" && !g.notaClinica.signosVitales?.FR
    && g.notaClinica.diagnosticosEnfermeria?.[0]?.etiologia === "proceso infeccioso");
  verificar("  ...y sin campos de la nota médica", !g.notaClinica.diagnostico && !(g.notaClinica.medicamentosRecetados || []).length);
  rr = await pedir(puerto(), "GET", `/medico/consultas/${c1._id}`, tkEnf);
  verificar(`el detalle se abre (${rr.estado})`, rr.estado === 200 && rr.cuerpo?.consulta?.notaClinica?.formato === "enfermeria");

  // Lo que manda la pantalla (public/js/consultas.js → notaEnfermeriaDelFormulario).
  const delFormulario = (cambios = {}) => ({
    motivoConsulta: "Fiebre de dos días",
    signosVitales: { PA: "110/70 mmHg", FC: "98 lpm", FR: "", T: "38,6 °C", SatO2: "", dolor: "", glucemia: "" },
    valoracion: [
      { patron: "nutricional", hallazgos: "Inapetencia, mucosas secas" },
      { patron: "actividad", hallazgos: "Deambula sin ayuda" },
      { patron: "sueno", hallazgos: "Duerme poco por la fiebre" },
    ],
    diagnosticosEnfermeria: [
      { problema: "Hipertermia", etiologia: "proceso infeccioso", signos: "T 38,6 °C, piel caliente" },
      { problema: "Riesgo de déficit de volumen de líquidos", etiologia: "fiebre e ingesta escasa", signos: "" },
    ],
    objetivos: ["Temperatura menor a 37,5 °C en 4 horas"],
    intervenciones: ["Control de temperatura cada 2 horas", "Compresas tibias", "Ofrecer líquidos"],
    evaluacion: "",
    educacion: "Se explicó a la madre cómo controlar la temperatura",
    ...cambios,
  });
  rr = await pedir(puerto(), "POST", `/medico/consultas/${c1._id}/confirmar`, tkEnf, {
    nota: delFormulario({
      valoracion: [
        { patron: "nutricional", hallazgos: "Inapetencia, mucosas secas" },
        { patron: "actividad", hallazgos: "" },
        { patron: "sueno", hallazgos: "Duerme poco por la fiebre" },
        { patron: "eliminacion", hallazgos: "Orina concentrada" },
      ],
      diagnosticosEnfermeria: [
        { problema: "Hipertermia", etiologia: "proceso infeccioso viral", signos: "T 38,6 °C, piel caliente" },
        { problema: "Riesgo de déficit de volumen de líquidos", etiologia: "fiebre e ingesta escasa", signos: "" },
      ],
      intervenciones: ["Control de temperatura cada 2 horas", "Compresas tibias", "Ofrecer líquidos", "Registrar diuresis"],
    }),
    aplicar: {},
  });
  verificar(`confirmar con correcciones (${rr.estado})`, rr.estado === 200 && rr.cuerpo?.aplicado?.includes("Nota clínica corregida"));
  g = await leer(c1);
  verificar(`  ...el patrón vaciado se va y el agregado entra en su lugar (${g.notaClinica.valoracion.map(v => v.patron).join(", ")})`,
    g.notaClinica.valoracion.map(v => v.patron).join(",") === "nutricional,eliminacion,sueno");
  verificar("  ...el diagnóstico y las intervenciones corregidos",
    g.notaClinica.diagnosticosEnfermeria[0].etiologia === "proceso infeccioso viral" && g.notaClinica.intervenciones.length === 4);
  verificar("  ...lo demás, igual", g.notaClinica.signosVitales.T === "38,6 °C" && g.notaClinica.objetivos.length === 1
    && /madre/.test(g.notaClinica.educacion) && g.notaClinica.formato === "enfermeria");
  verificar("  ...queda como corregida y confirmada", g.notaEditadaPorMedico === true && Boolean(g.confirmadaEn));
  const correcciones = await M.CorreccionIA.find({ consultaId: c1._id }).lean();
  const campos = correcciones.map(x => x.campo).sort().join(",");
  verificar(`  ...una corrección por cada parte que cambió, y ninguna de las que no (${campos})`,
    campos === "diagnosticosEnfermeria,intervenciones,valoracion");

  const c2 = await consultaFallida(ENF, pacEnf);
  colaEnfermeria = [{ ...NOTA_ENF, signosVitales: {} }];
  await pedir(puerto(), "POST", `/medico/consultas/${c2._id}/nota/regenerar`, tkEnf);
  await esperarHasta(async () => (await leer(c2)).notaClinicaEstado === "completado");
  colaEnfermeria = [NOTA_ENF];
  rr = await pedir(puerto(), "POST", `/medico/consultas/${c2._id}/confirmar`, tkEnf, {
    nota: delFormulario({ signosVitales: { PA: "", FC: "", FR: "", T: "", SatO2: "", dolor: "", glucemia: "" } }), aplicar: {},
  });
  g = await leer(c2);
  verificar(`confirmar sin tocar nada (los signos vitales vacíos tampoco) no la marca como corregida (${rr.estado})`,
    rr.estado === 200 && g.notaEditadaPorMedico !== true && (await M.CorreccionIA.countDocuments({ consultaId: c2._id })) === 0);

  pedidos.length = 0;
  const c3 = await consultaFallida(MED, pacMed);
  await pedir(puerto(), "POST", `/medico/consultas/${c3._id}/nota/regenerar`, tkMed);
  await esperarHasta(async () => (await leer(c3)).notaClinicaEstado === "completado");
  g = await leer(c3);
  verificar("en una cuenta de medicina, la nota médica de siempre",
    !g.notaClinica.formato && g.notaClinica.diagnostico === "Faringitis" && !pedidos.some(p => p.tipo === "enfermeria"));

  console.log("\n── 6. La nota en vivo ──");
  const textoVivo = TRANSCRIPCION.split(" ").slice(0, 60).join(" ");
  rr = await pedir(puerto(), "POST", "/medico/consultas/nota-en-vivo", tkEnf, { pacienteId: String(pacEnf._id), texto: textoVivo });
  verificar(`el borrador en vivo sale con el formato de enfermería (${rr.estado})`,
    rr.estado === 200 && rr.cuerpo?.nota?.formato === "enfermeria" && Array.isArray(rr.cuerpo?.noNombrados) && !rr.cuerpo.noNombrados.length);
  const enCurso = (medicoPhone, pac) => M.ConsultaMedica.create({
    medicoPhone, pacienteId: pac._id, pacienteNombre: pac.nombre, estado: "procesando", notaFuente: "",
  });
  const v1 = await enCurso(ENF, pacEnf);
  rr = await pedir(puerto(), "POST", `/medico/consultas/${v1._id}/texto-en-vivo`, tkEnf, { texto: textoVivo });
  await esperarHasta(async () => (await leer(v1)).notaClinicaEstado === "completado");
  g = await leer(v1);
  verificar(`la de enfermería escrita en vivo no queda «verificando» (${JSON.stringify(g.verificacion?.estado)})`,
    g.notaFuente === "vivo" && g.notaClinica?.formato === "enfermeria" && g.verificacion?.estado === "");
  rr = await pedir(puerto(), "POST", `/medico/consultas/${v1._id}/confirmar`, tkEnf, { nota: delFormulario(), aplicar: {} });
  verificar(`  ...y se puede confirmar sin esperar al audio completo (${rr.estado})`, rr.estado === 200);
  // La grabación entera: se sube, la nota sale del texto en vivo y después
  // termina la transcripción completa, bien o con una falla definitiva. Nunca
  // dice «verificando» ni «no se pudo verificar»: no hay nada que verificar.
  const subir = async () => (await pedir(puerto(), "POST", `/medico/consultas?pacienteId=${pacEnf._id}`, tkEnf, Buffer.from("audio"))).cuerpo?.consulta?._id;
  for (const falla of [false, true]) {
    const id = await subir();
    await pedir(puerto(), "POST", `/medico/consultas/${id}/texto-en-vivo`, tkEnf, { texto: textoVivo + (falla ? " y algo más" : "") });
    await esperarHasta(async () => (await leer({ _id: id })).notaClinicaEstado === "completado");
    const antes = pedidos.length;
    await terminarTranscripcion(TRANSCRIPCION, { falla });
    await esperarHasta(async () => (await leer({ _id: id })).estado !== "procesando");
    await esperar(300);
    g = await leer({ _id: id });
    verificar(falla
      ? `si la transcripción completa falla, tampoco dice «no se pudo verificar» (${JSON.stringify(g.verificacion?.estado)})`
      : `cuando termina la transcripción completa, no se verifica nada ni se pide otra nota (${JSON.stringify(g.verificacion?.estado)})`,
    g.estado === (falla ? "error" : "completado") && g.verificacion?.estado === "" && g.notaClinica?.formato === "enfermeria"
      && !pedidos.slice(antes).some(p => p.tipo === "enfermeria"));
  }
  const v2 = await enCurso(MED, pacMed);
  await pedir(puerto(), "POST", `/medico/consultas/${v2._id}/texto-en-vivo`, tkMed, { texto: textoVivo });
  await esperarHasta(async () => (await leer(v2)).notaClinicaEstado === "completado");
  g = await leer(v2);
  verificar(`la médica escrita en vivo sigue esperando la verificación (${JSON.stringify(g.verificacion?.estado)})`, g.verificacion?.estado === "pendiente");

  console.log("\n── 7. Lo que la leen otros ──");
  const { formatearHistorial } = require(path.join(RAIZ, "services", "briefClinico"));
  const { construirContextoPaciente } = require(path.join(RAIZ, "services", "memoriaClinica"));
  const { tejerHilo } = require(path.join(RAIZ, "services", "hiloClinico"));
  const confirmada = await leer(c1);
  const historial = formatearHistorial([confirmada]);
  verificar("el resumen previo lee la valoración, los diagnósticos PES y las intervenciones",
    /Valoración: nutricional-metabólico: Inapetencia/.test(historial)
    && /Diagnósticos de enfermería: Hipertermia r\/c proceso infeccioso viral m\/p T 38,6 °C/.test(historial)
    && /Intervenciones: .*Registrar diuresis/.test(historial) && /Signos vitales: PA 110\/70 mmHg/.test(historial));
  const medica = await leer(c3);
  verificar("  ...y una nota médica, sin renglones de enfermería", !/enfermería|Valoración:/.test(formatearHistorial([medica])));
  const contexto = construirContextoPaciente({ paciente: { nombre: "x" }, consultas: [confirmada] });
  verificar("la memoria clínica también los lee", /Diagnósticos de enfermería: Hipertermia/.test(contexto));
  pedidos.length = 0;
  const hoy = await M.ConsultaMedica.create({ medicoPhone: ENF, pacienteId: pacEnf._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { formato: "enfermeria", motivoConsulta: "Control de fiebre" } });
  await tejerHilo(hoy.toObject());
  verificar("el hilo con las consultas anteriores también", /Diagnósticos de enfermería: Hipertermia/.test(pedidos.find(p => p.tipo === "hilo")?.usuario || ""));

  const { armarContenido, normalizarSecciones } = require(path.join(RAIZ, "services", "resumenCompartido"));
  const { armarKardexPdf } = require(path.join(RAIZ, "services", "kardexPdf"));
  const soloSignos = { createdAt: new Date(), notaClinica: { formato: "enfermeria", signosVitales: { PA: "120/80" } } };
  const contenido = armarContenido({ paciente: { nombre: "Tomás Choque" }, consultas: [confirmada, soloSignos, medica] },
    { alcance: "completo", secciones: normalizarSecciones(["consultas"], "completo") });
  const [filaEnf, filaSignos, filaMed] = contenido.consultas || [];
  verificar("el contenido del Kardex lleva la nota de enfermería entera",
    filaEnf?.enfermeria?.diagnosticos?.[0]?.problema === "Hipertermia" && filaEnf.enfermeria.valoracion.length === 3
    && filaEnf.enfermeria.intervenciones.length === 4 && filaEnf.enfermeria.signosVitales.T === "38,6 °C");
  verificar("  ...una con solo signos vitales no se pierde", filaSignos?.enfermeria?.signosVitales?.PA === "120/80");
  verificar("  ...y la médica, sin nada de enfermería", filaMed && !("enfermeria" in filaMed) && filaMed.diagnostico === "Faringitis");
  const dibujos = (buf) => {
    const s = buf.toString("latin1");
    const salida = [];
    for (const m of s.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
      const desde = m.index + m[0].length;
      try { salida.push(zlib.inflateSync(Buffer.from(s.slice(desde, desde + Number(m[1])), "latin1")).toString("latin1")); } catch { /* no es una página */ }
    }
    return salida.join("\n");
  };
  for (const idioma of ["es", "pt"]) {
    const pdf = dibujos(armarKardexPdf({ contenido, paciente: { nombre: "Tomás Choque" }, medico: { nombre: "Ana" }, idioma }));
    const etiquetas = idioma === "es" ? ["Intervenciones", "Valoraci", "Signos vitales"] : ["Interven", "Coleta de dados", "Sinais vitais"];
    verificar(`el Kardex en PDF (${idioma}) imprime las partes con sus nombres`,
      etiquetas.every(e => pdf.includes(e)) && pdf.includes("Hipertermia") && pdf.includes("Registrar diuresis") && pdf.includes("Inapet"));
  }

  rr = await pedir(puerto(), "GET", `/medico/pacientes/${pacEnf._id}`, tkEnf);
  const deLaLista = (rr.cuerpo?.consultas || []).find(x => String(x._id) === String(c1._id));
  verificar(`la lista del Kardex trae el diagnóstico de enfermería prioritario (${rr.estado})`,
    deLaLista?.notaClinica?.diagnosticosEnfermeria?.[0]?.problema === "Hipertermia");

  await esperar(300);
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : "\n✅ La nota de enfermería se escribe, se corrige, se confirma y se lee bien");
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
