// Symphomed — El tutor clínico de las cuentas de estudiante (etapa 2).
//
// «Te falta preguntar» mientras graba, y el razonamiento diagnóstico al
// terminar, DESPUÉS de que el estudiante escribió el suyo. Con la IA de
// mentira, para saber qué se le manda y cuántas veces se la llama. Lo que se
// prueba:
//   · que solo lo reciben las cuentas de estudiante (a un médico no le
//     agrega nada y cuesta);
//   · que a la IA no le llega el nombre del paciente;
//   · que lo que vuelve se recorta y se ordena (nada de 8 preguntas);
//   · que el razonamiento se hace una vez, con lo que propuso el estudiante,
//     y queda guardado; y que si falla no se guarda nada a medias.
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

// ─── La IA de mentira: contesta según qué se le pide ───────────────────────
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const llamadas = { nota: 0, falta: 0, razonamiento: 0 };
const pedidos = { falta: [], razonamiento: [] };
let modo = { falta: "ok", razonamiento: "ok" };
axios.post = async (url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const usuario = cuerpo.messages[1]?.content || "";
  const contestar = (obj) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  if (/TODAVÍA NO se hicieron/.test(sistema)) {
    llamadas.falta++; pedidos.falta.push({ sistema, usuario });
    if (modo.falta === "falla") throw new Error("la IA no contestó");
    // De más, a propósito: 8 preguntas y 5 banderas.
    return contestar({ preguntas: Array.from({ length: 8 }, (_, i) => ({ pregunta: `¿Pregunta ${i + 1}?`, porQue: "porque sí" })).concat([{ pregunta: "" }]),
      banderasRojas: ["Disnea", "Estridor", "Babeo", "Trismus", "Rigidez de nuca"] });
  }
  if (/enseñarle a razonar/.test(sistema)) {
    llamadas.razonamiento++; pedidos.razonamiento.push({ sistema, usuario });
    if (modo.razonamiento === "vacio") return contestar({ diferenciales: [] });
    return contestar({
      diferenciales: Array.from({ length: 7 }, (_, i) => ({ diagnostico: i === 0 ? "Faringoamigdalitis estreptocócica" : `Dx ${i}`, aFavor: ["fiebre", "placas"], enContra: ["no se preguntó por tos"], estudio: "Test rápido de estreptococo" }))
        .concat([{ diagnostico: "" }]),
      banderasRojas: ["Absceso periamigdalino"],
      faltoPreguntar: ["¿Tiene tos?"],
      comparacion: { acertoPrincipal: "true", comentario: "x".repeat(2000), noConsideraste: [{ diagnostico: "Mononucleosis", porQue: "edad y fiebre" }] },
      perla: "Los criterios de Centor ayudan a decidir el antibiótico.",
    });
  }
  llamadas.nota++;
  return contestar({ motivoConsulta: "Dolor de garganta", diagnostico: "Faringitis", medicamentosRecetados: [] });
};

const TEXTO = "Buenos días doctor me duele la garganta hace tres días tengo fiebre y me cuesta tragar la comida desde ayer";

(async () => {
  const { sanearRazonamiento } = require(path.join(RAIZ, "modulos", "estudiantes", "tutor"));
  console.log("── 1. Lo que vuelve de la IA se recorta ──");
  const s = sanearRazonamiento({ diferenciales: Array.from({ length: 9 }, (_, i) => ({ diagnostico: "D" + i })), comparacion: { acertoPrincipal: "true", comentario: "y".repeat(5000) } });
  verificar("máximo 5 diferenciales", s.diferenciales.length === 5);
  verificar("«acertó» tiene que ser un sí de verdad, no el texto «true»", s.acertoPrincipal === false);
  verificar("un comentario larguísimo se corta", s.comentario.length === 600);

  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "tutor_clinico";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  for (const modelo of [M.TarjetaEstudio, M.RazonamientoDiagnostico, M.RachaEstudio]) await modelo.syncIndexes();

  const enSeisMeses = new Date(Date.now() + 180 * 86400000);
  const est = (phone, idioma, extra = {}) => M.Medico.create({ phone, nombre: "Est " + phone, passwordHash: "x", activo: true, idioma,
    estudiante: { nivel: "interno", hasta: enSeisMeses, horasMes: 12 }, ...extra });
  await est("59170060001", "es");
  await est("5511900060002", "pt");
  await M.Medico.create({ phone: "70060009", nombre: "Dr. Médico", passwordHash: "x", activo: true });
  const tkEst = generarToken("59170060001", "medico", 36e5, { estudiante: true });
  const tkEstPt = generarToken("5511900060002", "medico", 36e5, { estudiante: true });
  const tkMed = generarToken("70060009", "medico", 36e5);
  const pac = await M.Paciente.create({ medicoPhone: "59170060001", nombre: "Juana Secreta Mamani", sexo: "Femenino",
    fechaNacimiento: new Date(Date.now() - 23 * 365.25 * 86400000), antecedentesPersonales: ["Asma"], alergias: ["Penicilina"] });
  const pacMed = await M.Paciente.create({ medicoPhone: "70060009", nombre: "Paciente del médico" });
  const pacPt = await M.Paciente.create({ medicoPhone: "5511900060002", nombre: "Paciente BR" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  // El módulo, montado igual que en index.js: antes de las rutas del núcleo.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, tk, cuerpo) => pedir(servidor.address().port, m, ruta, tk, cuerpo);

  console.log("\n── 2. «Te falta preguntar», mientras graba ──");
  let r = await P("POST", "/medico/consultas/nota-en-vivo", tkEst, { pacienteId: String(pac._id), texto: TEXTO });
  verificar("el estudiante recibe la nota y, al lado (en «extras»), lo que le falta preguntar", r.estado === 200 && r.cuerpo.nota?.diagnostico === "Faringitis" && r.cuerpo.extras?.tutor?.preguntas?.length > 0);
  const tutor = r.cuerpo.extras.tutor;
  verificar("  ...como mucho 5 preguntas y 3 banderas rojas, sin filas vacías", tutor.preguntas.length === 5 && tutor.banderasRojas.length === 3 && tutor.preguntas.every(p => p.pregunta));
  verificar("  ...una llamada para la nota y otra para el tutor, a la par", llamadas.nota === 1 && llamadas.falta === 1);
  const pf = pedidos.falta[0];
  verificar("a la IA le llega lo que se habló, la edad y los antecedentes", pf.usuario.includes("me duele la garganta") && /Edad: 2[23] años/.test(pf.usuario) && /Asma/.test(pf.usuario) && /Penicilina/.test(pf.usuario));
  verificar("  ...pero NUNCA el nombre del paciente", !/Juana|Secreta|Mamani/.test(pf.usuario + pf.sistema));
  verificar("  ...y la regla de no dar diagnósticos mientras entrevista", /NO DES DIAGNÓSTICOS/.test(pf.sistema));
  r = await P("POST", "/medico/consultas/nota-en-vivo", tkEst, { pacienteId: String(pac._id), texto: TEXTO });
  verificar("el mismo texto otra vez (al terminar) → se reusa, sin llamar de nuevo", r.cuerpo.extras?.tutor?.preguntas?.length === 5 && llamadas.nota === 1 && llamadas.falta === 1);
  r = await P("POST", "/medico/consultas/nota-en-vivo", tkMed, { pacienteId: String(pacMed._id), texto: TEXTO });
  verificar("un médico recibe su nota, sin tutor y sin una llamada de más", r.estado === 200 && r.cuerpo.nota && !("tutor" in r.cuerpo) && !("tutor" in (r.cuerpo.extras || {})) && llamadas.nota === 2 && llamadas.falta === 1);
  modo.falta = "falla";
  r = await P("POST", "/medico/consultas/nota-en-vivo", tkEst, { pacienteId: String(pac._id), texto: TEXTO + " y tos" });
  verificar("si el tutor falla, la nota en vivo sale igual", r.estado === 200 && r.cuerpo.nota?.diagnostico === "Faringitis" && r.cuerpo.extras?.tutor?.preguntas?.length === 0);
  modo.falta = "ok";
  await P("POST", "/medico/consultas/nota-en-vivo", tkEstPt, { pacienteId: String(pacPt._id), texto: TEXTO + " ok" });
  verificar("en una cuenta en portugués, el tutor escribe en portugués", /portugués de Brasil/.test(pedidos.falta.at(-1).sistema));

  console.log("\n── 3. El razonamiento, después de que él pensó ──");
  const consulta = (medicoPhone, pacienteId, extra = {}) => M.ConsultaMedica.create({ medicoPhone, pacienteId, estado: "completado", deEstudiante: true,
    notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Dolor de garganta" }, transcripcionCompleta: TEXTO, ...extra });
  const c1 = await consulta("59170060001", pac._id);
  const ruta = `/medico/consultas/${c1._id}/razonamiento`;
  const cMed = await M.ConsultaMedica.create({ medicoPhone: "70060009", pacienteId: pacMed._id, estado: "completado", transcripcionCompleta: TEXTO });
  r = await P("POST", `/medico/consultas/${cMed._id}/razonamiento`, tkMed, { principal: "Faringitis" });
  verificar("un médico → 403: es un ejercicio de estudiante", r.estado === 403);
  r = await P("POST", ruta, tkEst, { principal: "", diferenciales: "x" });
  verificar("sin su diagnóstico principal → 400, y no se le muestra nada", r.estado === 400 && llamadas.razonamiento === 0);
  const sinTexto = await consulta("59170060001", pac._id, { transcripcionCompleta: "hola" });
  r = await P("POST", `/medico/consultas/${sinTexto._id}/razonamiento`, tkEst, { principal: "Faringitis" });
  verificar("una consulta casi sin transcripción → 400", r.estado === 400);
  r = await P("POST", ruta, tkEst, { principal: "Faringitis bacteriana", diferenciales: "Faringitis viral, Mononucleosis" });
  verificar("con su diagnóstico → 200, con el análisis", r.estado === 200 && r.cuerpo.razonamiento?.resultado?.diferenciales?.length === 5);
  const pr = pedidos.razonamiento[0];
  verificar("a la IA le llega lo que propuso el estudiante, y la transcripción", /Diagnóstico principal: Faringitis bacteriana/.test(pr.usuario) && /Faringitis viral; Mononucleosis/.test(pr.usuario) && pr.usuario.includes("me duele la garganta"));
  verificar("  ...con las reglas: solo datos de la consulta, sin porcentajes", /USÁ SOLO DATOS/.test(pr.sistema) && /NADA DE PORCENTAJES/.test(pr.sistema));
  verificar("  ...y sin el nombre del paciente", !/Juana|Secreta|Mamani/.test(pr.usuario));
  const guardada = await M.RazonamientoDiagnostico.findOne({ consultaId: c1._id }).lean();
  verificar("queda guardado (en su colección, no en la consulta): lo que pensó él y el análisis, recortado",
    guardada.medicoPhone === "59170060001" && guardada.principal === "Faringitis bacteriana" && guardada.diferenciales.length === 2
    && guardada.resultado.diferenciales.length === 5 && guardada.resultado.comentario.length === 600
    && guardada.resultado.acertoPrincipal === false && guardada.resultado.perla.includes("Centor")
    && !("razonamiento" in (await M.ConsultaMedica.collection.findOne({ _id: c1._id }))));
  r = await P("POST", ruta, tkEst, { principal: "Otra cosa" });
  verificar("una segunda vez → 409, sin llamar a la IA: es un ejercicio, no un «probar hasta acertar»", r.estado === 409 && llamadas.razonamiento === 1);
  r = await P("GET", `/medico/consultas/${c1._id}`, tkEst);
  verificar("al abrir la consulta, el razonamiento viene con ella (consulta.extras)", r.cuerpo?.consulta?.extras?.razonamiento?.resultado?.perla?.includes("Centor"));
  r = await P("GET", `/medico/consultas/${cMed._id}`, tkMed);
  verificar("  ...y a un médico la consulta le llega sin nada de eso", r.estado === 200 && JSON.stringify(r.cuerpo.consulta.extras) === "{}");
  modo.razonamiento = "vacio";
  const c2 = await consulta("59170060001", pac._id);
  r = await P("POST", `/medico/consultas/${c2._id}/razonamiento`, tkEst, { principal: "Faringitis" });
  verificar("si la IA no devuelve diferenciales → 502, y no se guarda nada a medias", r.estado === 502 && !(await M.RazonamientoDiagnostico.exists({ consultaId: c2._id })));
  modo.razonamiento = "ok";
  // Un doble toque de verdad: los dos pedidos pasan juntos el «¿ya lo hizo?»
  // y llegan a guardar a la vez. Lo que deja uno solo es la base (un índice
  // único por consulta), no el código.
  const cDoble = await consulta("59170060001", pac._id);
  const dobles = await Promise.all([1, 2].map(() => P("POST", `/medico/consultas/${cDoble._id}/razonamiento`, tkEst, { principal: "Faringitis" })));
  verificar("dos toques a la vez → uno guarda (200) y el otro no (409), y queda UNO",
    dobles.map(x => x.estado).sort().join() === "200,409" && (await M.RazonamientoDiagnostico.countDocuments({ consultaId: cDoble._id })) === 1);
  const cOtro = await consulta("5511900060002", pacPt._id);
  r = await P("POST", `/medico/consultas/${cOtro._id}/razonamiento`, tkEst, { principal: "Faringitis" });
  verificar("la consulta de otro estudiante → 404", r.estado === 404);
  await M.Medico.updateOne({ phone: "59170060001" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  r = await P("POST", `/medico/consultas/${c2._id}/razonamiento`, tkEst, { principal: "Faringitis" });
  verificar("acceso vencido → 402, como al grabar", r.estado === 402);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
