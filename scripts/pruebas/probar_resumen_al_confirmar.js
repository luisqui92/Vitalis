// Symphomed — Lo que el médico confirma y corrige llega al resumen previo, al
// hilo clínico y a la memoria clínica.
//
// El resumen previo del paciente (services/briefClinico.js) se escribía con
// la nota apenas salía de la IA, sin revisar, y no se rehacía al confirmar:
// el médico corregía un diagnóstico y el resumen seguía repitiendo el de la
// IA (revisión integral del 11 de octubre de 2026, S03). Lo que se prueba:
//   1. El resumen marca qué consultas son borradores y cuenta cuántas hubo.
//   2. Confirmar lo rehace con la nota corregida.
//   3. Una generación vieja que termina tarde no pisa a la nueva (ni con un
//      error).
//   4. El hilo: marca los borradores y se rehace si el médico corrigió; el
//      de antes que termina tarde no lo pisa.
//   5. La memoria clínica marca los borradores y no manda el nombre.
const path = require("path");
const http = require("http");
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
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// La IA de mentira. Contesta según qué le piden, con lo que leyó, para poder
// ver después de qué nota salió cada cosa. «demorar» frena las respuestas
// que salen de un texto dado, y «fallar» las hace fallar.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const pedidos = [];
let demorar = null;   // { si: /texto/, ms }
let fallar = null;    // /texto/
const contestar = (obj) => ({ data: { choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] } });
axios.post = async (_url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const usuario = cuerpo.messages.at(-1).content;
  const tipo = /"brief clínico"/.test(sistema) ? "brief" : /^CONSULTA DE HOY/.test(usuario) ? "hilo" : /historia de UN paciente/.test(sistema) ? "memoria" : "otro";
  pedidos.push({ tipo, sistema, usuario });
  if (demorar && demorar.si.test(usuario)) await esperar(demorar.ms);
  if (fallar && fallar.test(usuario)) throw new Error("la IA no contestó");
  if (tipo === "brief") {
    const ultimo = (usuario.match(/Diagnóstico: [^\n]+/g) || []).pop() || "";
    return contestar({ estadoActual: `según ${ultimo}`, medicamentosActivos: [], alertas: [] });
  }
  if (tipo === "hilo") {
    const id = (usuario.match(/id: ([a-f0-9]{24})/) || [])[1];
    const hoy = (usuario.match(/CONSULTA DE HOY:\n[^\n]*diagnóstico: ([^|\n]+)/) || [])[1]?.trim();
    return contestar({ conexiones: [{ consultaId: id, queDijoEntonces: `hoy dice ${hoy}`, porQueImporta: "se relaciona" }], preguntasParaElMedico: [] });
  }
  return contestar("Respuesta de la memoria");
};

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "resumen_al_confirmar";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { regenerarBriefClinico, PROMPT_SISTEMA } = require(path.join(RAIZ, "services", "briefClinico"));
  const { generarHilo } = require(path.join(RAIZ, "services", "hiloClinico"));
  await mongoose.connection.dropDatabase();
  await Promise.all([M.Medicamento, M.Vacuna, M.Receta, M.TratamientoPlan, M.ConsultaMedica].map(x => x.syncIndexes()));

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  require(path.join(RAIZ, "routes", "memoriaClinica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const MED = "70077001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Resumen", passwordHash: "x", activo: true, tipoEspecialidad: "medicina_general" });
  const tk = generarToken(MED, "medico", 36e5);
  const POST = (ruta, cuerpo) => pedir(servidor.address().port, "POST", ruta, tk, cuerpo);
  const paciente = (nombre) => M.Paciente.create({ medicoPhone: MED, nombre });
  const hace = (dias) => new Date(Date.now() - dias * 86400000);
  const consulta = (pac, diagnostico, { confirmada = false, dias = 0 } = {}) => M.ConsultaMedica.create({
    medicoPhone: MED, pacienteId: pac._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { motivoConsulta: "Control", diagnostico }, confirmadaEn: confirmada ? hace(dias) : null, createdAt: hace(dias),
  });
  const ultimo = (tipo) => pedidos.filter(p => p.tipo === tipo).at(-1);
  const brief = async (pac) => (await M.Paciente.findById(pac._id).lean());

  console.log("── 1. El resumen distingue lo revisado de los borradores ──");
  const rosa = await paciente("Rosa Quispe Mamani");
  await consulta(rosa, "Hipertensión arterial", { confirmada: true, dias: 30 });
  const c2 = await consulta(rosa, "Faringitis", { dias: 1 });
  await regenerarBriefClinico(rosa._id);
  const historial = ultimo("brief")?.usuario || "";
  const [bloque1, bloque2] = historial.split("\n\n---\n\n");
  verificar("la consulta confirmada va como revisada", /Revisada y confirmada por el médico/.test(bloque1) && /Hipertensión/.test(bloque1));
  verificar("  ...y la otra, como BORRADOR", /BORRADOR/.test(bloque2) && /Faringitis/.test(bloque2));
  verificar("  ...y la IA tiene la regla: lo de un borrador va «(sin confirmar)»", /BORRADOR/.test(PROMPT_SISTEMA) && /\(sin confirmar\)/.test(PROMPT_SISTEMA));
  let p = await brief(rosa);
  verificar(`queda dicho de cuántas salió y cuántas sin revisar (${JSON.stringify(p.briefClinicoFuentes)})`,
    p.briefClinicoEstado === "completado" && p.briefClinicoFuentes?.consultas === 2 && p.briefClinicoFuentes?.sinRevisar === 1);

  console.log("\n── 2. Confirmar rehace el resumen con la nota corregida ──");
  const antes = pedidos.length;
  const r = await POST(`/medico/consultas/${c2._id}/confirmar`, { nota: { diagnostico: "Amigdalitis bacteriana" }, aplicar: {} });
  verificar(`se confirma con el diagnóstico corregido (${r.estado})`, r.estado === 200);
  await esperarHasta(async () => (await brief(rosa)).briefClinico?.estadoActual?.includes("Amigdalitis"));
  const deConfirmar = pedidos.slice(antes).filter(x => x.tipo === "brief").at(-1)?.usuario || "";
  verificar("confirmar pide el resumen de nuevo, con lo que corrigió el médico", /Amigdalitis bacteriana/.test(deConfirmar) && !/Faringitis/.test(deConfirmar));
  verificar("  ...ya sin borradores", !/BORRADOR/.test(deConfirmar));
  p = await brief(rosa);
  verificar(`el resumen guardado sale de la confirmada («${p.briefClinico?.estadoActual}»), 0 sin revisar`,
    /Amigdalitis/.test(p.briefClinico?.estadoActual || "") && p.briefClinicoFuentes?.sinRevisar === 0);

  console.log("\n── 3. La generación vieja que termina tarde no pisa a la nueva ──");
  const juan = await paciente("Juan Pérez");
  const d1 = await consulta(juan, "Gastritis");
  demorar = { si: /Gastritis/, ms: 600 };
  const vieja = regenerarBriefClinico(juan._id);
  await esperar(150);   // la vieja ya leyó la nota sin corregir y espera a la IA
  await M.ConsultaMedica.updateOne({ _id: d1._id }, { $set: { confirmadaEn: new Date(), "notaClinica.diagnostico": "Úlcera gástrica" } });
  await regenerarBriefClinico(juan._id);
  await vieja;
  demorar = null;
  p = await brief(juan);
  verificar(`queda la de la nota confirmada («${p.briefClinico?.estadoActual}»), aunque la vieja terminó después`,
    /Úlcera gástrica/.test(p.briefClinico?.estadoActual || "") && p.briefClinicoEstado === "completado");

  const ana = await paciente("Ana Rojas");
  const e1 = await consulta(ana, "Lumbalgia");
  demorar = { si: /Lumbalgia/, ms: 600 };
  fallar = /Lumbalgia/;
  const viejaQueFalla = regenerarBriefClinico(ana._id);
  await esperar(150);
  await M.ConsultaMedica.updateOne({ _id: e1._id }, { $set: { confirmadaEn: new Date(), "notaClinica.diagnostico": "Hernia de disco" } });
  await regenerarBriefClinico(ana._id);
  await viejaQueFalla;
  demorar = null; fallar = null;
  p = await brief(ana);
  verificar(`el error de una vieja tampoco tapa a la nueva (${p.briefClinicoEstado})`,
    p.briefClinicoEstado === "completado" && /Hernia de disco/.test(p.briefClinico?.estadoActual || ""));

  console.log("\n── 4. El hilo clínico ──");
  const luis = await paciente("Luis Choque");
  const h0 = await consulta(luis, "Cefalea tensional", { dias: 40 });
  const h1 = await consulta(luis, "Hipertensión");
  demorar = { si: /diagnóstico: Hipertensión/, ms: 600 };
  const hiloViejo = generarHilo(h1._id);
  await esperar(150);
  const pedidoHilo = ultimo("hilo")?.usuario || "";
  verificar("la consulta anterior sin confirmar va marcada «sin revisar»", new RegExp(`id: ${h0._id}[^\\n]*sin revisar`).test(pedidoHilo));
  let rh = await POST(`/medico/consultas/${h1._id}/confirmar`, { nota: { diagnostico: "Crisis hipertensiva" }, aplicar: {} });
  await hiloViejo;
  demorar = null;
  let hilo = (await M.ConsultaMedica.findById(h1._id).lean()).hiloClinico;
  await esperarHasta(async () => /Crisis/.test((await M.ConsultaMedica.findById(h1._id).lean()).hiloClinico?.conexiones?.[0]?.queDijoEntonces || ""));
  hilo = (await M.ConsultaMedica.findById(h1._id).lean()).hiloClinico;
  verificar(`confirmar con el diagnóstico corregido (${rh.estado}) rehace el hilo, y el de antes no lo pisa («${hilo?.conexiones?.[0]?.queDijoEntonces}»)`,
    rh.estado === 200 && /Crisis hipertensiva/.test(hilo?.conexiones?.[0]?.queDijoEntonces || ""));

  const h2 = await consulta(luis, "Control de presión");
  const hilosAntes = pedidos.filter(x => x.tipo === "hilo").length;
  rh = await POST(`/medico/consultas/${h2._id}/confirmar`, { aplicar: {} });
  await esperar(300);
  verificar(`confirmar sin corregir la nota (${rh.estado}) no gasta otro hilo`, rh.estado === 200 && pedidos.filter(x => x.tipo === "hilo").length === hilosAntes);

  console.log("\n── 5. La memoria clínica ──");
  await consulta(rosa, "Control de rutina");
  const rm = await POST(`/medico/pacientes/${rosa._id}/preguntar`, { pregunta: "¿Qué diagnósticos tuvo?" });
  const memoria = ultimo("memoria")?.usuario || "";
  verificar(`contesta (${rm.estado}), con el borrador marcado y las confirmadas sin marca`, rm.estado === 200
    && /\(borrador sin revisar\)[^\n]*Control de rutina/.test(memoria) && !/\(borrador sin revisar\)[^\n]*Amigdalitis/.test(memoria));
  verificar("  ...y el nombre del paciente no viaja a la IA", !/Rosa|Quispe|Mamani/.test(memoria));

  await esperar(300);   // la auditoría se escribe de atrás
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
