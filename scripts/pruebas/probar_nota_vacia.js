// Symphomed — La nota clínica que llegaba vacía.
//
// Caso real: una consulta de 32 minutos en portugués, bien transcrita, y una
// nota con TODOS los campos en blanco, mostrada como lista para firmar. La IA
// había contestado con las claves traducidas o envueltas en otro objeto, y
// Mongo descartó todo sin avisar (ver services/notaClinica.js).
//
// Lo que se prueba:
//   · que las claves en portugués / envueltas / con otro tipo se reconocen;
//   · que se le pide a la IA un JSON válido sí o sí (response_format);
//   · que una nota vacía de una consulta con contenido se pide de nuevo, y si
//     vuelve vacía queda como ERROR (visible), no como un formulario en blanco;
//   · que «Volver a generar la nota» la recupera, sin cobrar otra vez, y solo
//     cuando corresponde.
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

// La IA de mentira: devuelve, en orden, las respuestas de la cola.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
let cola = [];
let pedidos = [];
axios.post = async (url, cuerpo) => {
  pedidos.push(cuerpo);
  const siguiente = cola.length ? cola.shift() : {};
  return { data: { choices: [{ message: { content: typeof siguiente === "string" ? siguiente : JSON.stringify(siguiente) } }] } };
};

const { normalizarNota, notaVacia, generarNotaClinica } = require(path.join(RAIZ, "services", "notaClinica"));

// Lo que probablemente contestó la IA en el caso real: claves en portugués.
const RESPUESTA_PT = {
  motivoDaConsulta: "Início de terapia hormonal",
  sintomas: "sem sintomas relatados",
  "antecedentes_relevantes": "Nunca fez terapia hormonal; nunca usou inibidor por conta própria",
  "diagnóstico": "Acompanhamento para terapia hormonal",
  plano: "Solicitar exames de sangue e urina",
  medicamentosPrescritos: [{ nome: "Estradiol", dose: "2 mg", frequencia: "1x ao dia" }],
  examesSolicitados: ["hemograma", "urina"],
};
const TRANSCRIPCION_LARGA = "Eu vou usar um aplicativo que é para gravar consulta e para fazer o anamnese. ".repeat(20);

function pedir(puerto, metodo, ruta, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta,
      headers: token ? { authorization: "Bearer " + token } : {} }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(texto); } catch {} resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  console.log("── 1. Las claves que llegan cambiadas ──");
  const r1 = normalizarNota(RESPUESTA_PT).nota;
  verificar("motivoDaConsulta → motivoConsulta", r1.motivoConsulta === "Início de terapia hormonal");
  verificar("«diagnóstico» con tilde → diagnostico", r1.diagnostico === "Acompanhamento para terapia hormonal");
  verificar("plano → plan", r1.plan === "Solicitar exames de sangue e urina");
  verificar("antecedentes_relevantes (con guion bajo) → antecedentesRelevantes", /terapia hormonal/.test(r1.antecedentesRelevantes));
  verificar("medicamentosPrescritos con nome/dose/frequencia → nombre/dosis/frecuencia",
    r1.medicamentosRecetados?.[0]?.nombre === "Estradiol" && r1.medicamentosRecetados[0].dosis === "2 mg" && r1.medicamentosRecetados[0].frecuencia === "1x ao dia");
  verificar("sintomas como texto → lista", Array.isArray(r1.sintomas) && r1.sintomas[0] === "sem sintomas relatados");
  const envuelta = normalizarNota({ notaClinica: { motivoConsulta: "Dor", diagnostico: "Cefaleia" } });
  verificar("envuelta en {notaClinica: {…}} → se desenvuelve", envuelta.nota.motivoConsulta === "Dor" && envuelta.clavesAjustadas);
  const correcta = normalizarNota({ motivoConsulta: "Dolor", sintomas: ["fiebre"] });
  verificar("una respuesta ya correcta pasa igual y no se marca como ajustada", correcta.nota.motivoConsulta === "Dolor" && !correcta.clavesAjustadas);
  verificar("una lista que vino como texto con comas se parte", normalizarNota({ examenesSolicitados: "hemograma, TSH; glicemia" }).nota.examenesSolicitados.length === 3);
  verificar("un texto que vino como lista se une", normalizarNota({ plan: ["reposo", "hidratación"] }).nota.plan === "reposo; hidratación");
  verificar("notaVacia: todo null → vacía", notaVacia({ motivoConsulta: null, sintomas: [], plan: "" }));
  verificar("notaVacia: con un campo → no vacía", !notaVacia({ sintomas: ["tos"] }));

  console.log("\n── 2. Pedirle a la IA ──");
  cola = [RESPUESTA_PT];
  pedidos = [];
  const n1 = await generarNotaClinica(TRANSCRIPCION_LARGA, {}, "pt");
  verificar("con claves en portugués la nota sale llena, en UN pedido", n1.motivoConsulta === "Início de terapia hormonal" && pedidos.length === 1);
  verificar("se le exige un JSON válido (response_format json_object)", pedidos[0].response_format?.type === "json_object");
  verificar("y hay lugar para una consulta larga (más de 1600 tokens)", pedidos[0].max_tokens > 1600);

  cola = [{ motivoConsulta: null, sintomas: [], diagnostico: null, plan: null }, RESPUESTA_PT];
  pedidos = [];
  const n2 = await generarNotaClinica(TRANSCRIPCION_LARGA, {}, "pt");
  verificar("si llega vacía de una consulta larga, se pide de nuevo (2 pedidos)", pedidos.length === 2);
  verificar("  ...recordándole que no traduzca ni envuelva las claves", /sin traducirlas/.test(pedidos[1]?.messages?.at(-1)?.content || ""));
  verificar("  ...y la segunda respuesta es la que queda", n2.plan === "Solicitar exames de sangue e urina");

  cola = [{}, { nada: "que ver" }];
  pedidos = [];
  let error = null;
  try { await generarNotaClinica(TRANSCRIPCION_LARGA, {}, "pt"); } catch (e) { error = e; }
  verificar("si vuelve vacía otra vez → ERROR (no un formulario en blanco que parece bueno)", error && /nota vacía/.test(error.message));

  cola = [{ motivoConsulta: null }];
  pedidos = [];
  const corta = await generarNotaClinica("Hola, ¿me escucha?", {}, "es");
  verificar("una grabación de dos frases vacía no se reintenta (puede ser legítima)", pedidos.length === 1 && notaVacia(corta));

  console.log("\n── 3. «Volver a generar la nota» ──");
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "nota_vacia_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Paciente, ConsultaMedica, MovimientoSaldo } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "5511900000001", nombre: "Dra. Brasil", passwordHash: hash, idioma: "pt", moneda: "BRL" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash });
  const tk = generarToken("5511900000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);
  const paciente = await Paciente.create({ medicoPhone: "5511900000001", nombre: "Natália Domingues Falcão" });
  const base = { medicoPhone: "5511900000001", pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "completado", transcripcionCompleta: TRANSCRIPCION_LARGA };
  // Exactamente como quedó la de la captura: "completado" y vacía.
  const vacia = await ConsultaMedica.create({ ...base, notaClinicaEstado: "completado", notaClinica: { motivoConsulta: null, sintomas: [] } });
  const conError = await ConsultaMedica.create({ ...base, notaClinicaEstado: "error", notaClinicaError: "timeout" });
  const llena = await ConsultaMedica.create({ ...base, notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Control", sintomas: ["tos"] } });
  const confirmada = await ConsultaMedica.create({ ...base, notaClinicaEstado: "error", confirmadaEn: new Date() });
  const enCurso = await ConsultaMedica.create({ ...base, notaClinicaEstado: "pendiente" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const regenerar = (id, token = tk) => pedir(puerto, "POST", `/medico/consultas/${id}/nota/regenerar`, token);
  const esperarEstado = async (id) => {
    for (let i = 0; i < 50; i++) {
      const c = await ConsultaMedica.findById(id).lean();
      if (c.notaClinicaEstado !== "pendiente") return c;
      await new Promise((r) => setTimeout(r, 100));
    }
    return ConsultaMedica.findById(id).lean();
  };

  const movAntes = await MovimientoSaldo.countDocuments();
  cola = [RESPUESTA_PT];
  pedidos = [];
  const rv = await regenerar(vacia._id);
  verificar("la consulta vacía (como la de Natália) → se regenera (202)", rv.estado === 202);
  const cv = await esperarEstado(vacia._id);
  verificar("  ...y queda con la nota llena, en portugués", cv.notaClinicaEstado === "completado" && cv.notaClinica.motivoConsulta === "Início de terapia hormonal");
  verificar("  ...con los medicamentos bien puestos", cv.notaClinica.medicamentosRecetados?.[0]?.nombre === "Estradiol");
  verificar("  ...pidiéndole la nota en portugués", /portugués de Brasil/.test(pedidos[0]?.messages?.[0]?.content || ""));
  verificar("  ...y SIN cobrar la consulta otra vez", (await MovimientoSaldo.countDocuments()) === movAntes);

  cola = [RESPUESTA_PT];
  const re = await regenerar(conError._id);
  const ce = await esperarEstado(conError._id);
  verificar("una nota en error → se regenera y se limpia el error", re.estado === 202 && ce.notaClinicaEstado === "completado" && !ce.notaClinicaError);

  cola = [{}, {}];
  const cvacia2 = await ConsultaMedica.create({ ...base, notaClinicaEstado: "error" });
  await regenerar(cvacia2._id);
  const cv2 = await esperarEstado(cvacia2._id);
  verificar("si la IA vuelve a mandarla vacía, queda en ERROR con un mensaje (no vacía y «completa»)",
    cv2.notaClinicaEstado === "error" && /vacía/.test(cv2.notaClinicaError || ""));

  verificar("una nota con contenido NO se regenera (se corrige a mano) → 409", (await regenerar(llena._id)).estado === 409);
  verificar("una consulta ya confirmada → 409", (await regenerar(confirmada._id)).estado === 409);
  verificar("una que ya se está generando → 409", (await regenerar(enCurso._id)).estado === 409);
  verificar("la consulta de otro médico → 404", (await regenerar(vacia._id, tkB)).estado === 404);
  verificar("sin sesión → 401", (await regenerar(vacia._id, null)).estado === 401);

  servidor.close();
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
