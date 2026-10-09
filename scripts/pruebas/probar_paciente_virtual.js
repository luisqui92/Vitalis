// Symphomed — El paciente virtual de las cuentas de estudiante (etapa 4).
//
// Con la IA de mentira, para saber qué recibe cada parte. Lo que se prueba:
//   · que un caso se usa solo si otra IA, a ciegas, llega a su diagnóstico;
//   · que el paciente NUNCA recibe el diagnóstico (no lo puede decir);
//   · que mientras dura la práctica la pantalla no recibe el guion;
//   · que pedir dos veces el mismo examen da lo mismo, sin volver a la IA;
//   · que la evaluación se recorta y queda alineada con el guion;
//   · el banco: un caso bueno lo usa el siguiente estudiante sin gastar, y
//     nadie ve dos veces el mismo; con dos reportes sale del banco;
//   · el cupo del mes, el acceso vencido, y que solo es de estudiantes;
//   · lo del informe de QA del 9 de octubre de 2026: dos «empezar» a la vez
//     con un solo cupo (E03), dos preguntas a la vez con un solo mensaje
//     (E04), repetir un pedido con su clave, y la práctica abierta cuando
//     el acceso vence (E05).
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
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j, texto: t }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const CASO = {
  paciente: { nombre: "Carla Mendoza", edad: 24, edadMeses: null, sexo: "Femenino", ocupacion: "estudiante" },
  quienHabla: "el paciente", lugar: "emergencia",
  motivo: "Me duele mucho la panza desde ayer, doctor.",
  personalidad: "preocupada y colaboradora",
  historia: ["El dolor empezó hace 20 horas alrededor del ombligo", "Hace 8 horas se fue abajo a la derecha", "Tuvo náuseas y vomitó una vez", "No tiene hambre"],
  antecedentes: { personales: ["ninguno"], familiares: [], medicamentos: ["tomó paracetamol una vez"], alergias: [], habitos: [], ginecoObstetricos: ["última menstruación hace 2 semanas, ciclos regulares"] },
  negativos: ["diarrea", "ardor al orinar", "flujo vaginal"],
  signosVitales: { PA: "110/70 mmHg", FC: "102 lpm", FR: "18 rpm", T: "38,1 °C", SatO2: "98 %", Glucosa: "no debería quedar" },
  examenFisico: [{ region: "Abdomen", hallazgo: "Dolor a la palpación en fosa ilíaca derecha, signo de Blumberg positivo" }],
  estudios: [{ nombre: "Hemograma", resultado: "Leucocitos 14.500/mm³ con 85 % de neutrófilos" }, { nombre: "Test de embarazo", resultado: "Negativo" }],
  diagnostico: "Apendicitis aguda",
  diferenciales: [
    { diagnostico: "Embarazo ectópico", porQueNo: "Test de embarazo negativo" },
    { diagnostico: "Infección urinaria", porQueNo: "Sin síntomas urinarios" },
    { diagnostico: "apendicitis aguda", porQueNo: "es el mismo: no debería quedar" },
    { diagnostico: "Quiste ovárico complicado", porQueNo: "El dolor migró desde el ombligo" },
  ],
  preguntasClave: ["¿Dónde empezó el dolor?", "¿Se movió el dolor?", "¿Tuvo fiebre?", "¿Náuseas o vómitos?", "¿Cuándo fue su última menstruación?", "¿Síntomas urinarios?"],
  banderasRojas: ["Peritonitis", "Embarazo ectópico roto"],
  estudiosPertinentes: ["Hemograma", "Test de embarazo", "Ecografía abdominal"],
  perla: "El dolor que migra del ombligo a la fosa ilíaca derecha es muy sugestivo de apendicitis.",
};

// ─── La IA de mentira ──────────────────────────────────────────────────────
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const llamadas = { caso: 0, resolver: 0, paciente: 0, examen: 0, estudio: 0, evaluar: 0 };
const pedidos = { paciente: [], examen: [], evaluar: [] };
const modo = { resolver: "bien", caso: "ok", evaluar: "ok", paciente: "ok", demoraPaciente: 0 };
axios.post = async (_url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const ultimo = cuerpo.messages[cuerpo.messages.length - 1]?.content || "";
  const json = (obj) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const textoPlano = (t) => ({ data: { choices: [{ message: { content: t } }] } });
  if (/Armá UN caso nuevo/.test(sistema)) {
    llamadas.caso++;
    if (modo.caso === "incompleto") return json({ ...CASO, preguntasClave: [] });
    return json(CASO);
  }
  if (/Elegí el diagnóstico más probable entre las opciones/.test(sistema)) {
    llamadas.resolver++;
    const opciones = [...ultimo.matchAll(/^(\d+)\. (.+)$/gm)].map(m => m[2]);
    const bien = opciones.indexOf(CASO.diagnostico);
    return json({ opcion: modo.resolver === "bien" ? bien : (bien + 1) % opciones.length });
  }
  if (/Esto es una práctica de entrevista clínica/.test(sistema)) {
    llamadas.paciente++; pedidos.paciente.push(cuerpo);
    if (modo.demoraPaciente) await esperar(modo.demoraPaciente);
    if (modo.paciente === "falla") throw new Error("la IA no contestó");
    return textoPlano(`"Sí doctor, ${ultimo.length > 10 ? "me duele" : "no"}."`);
  }
  if (/el estudiante examina al paciente/.test(sistema)) {
    llamadas.examen++; pedidos.examen.push(sistema);
    return json({ hallazgo: "Dolor en fosa ilíaca derecha, Blumberg positivo." });
  }
  if (/el estudiante pide un estudio/.test(sistema)) {
    llamadas.estudio++;
    return json({ resultado: "Leucocitos 14.500/mm³." });
  }
  if (/Sos un docente que evalúa la práctica/.test(sistema)) {
    llamadas.evaluar++; pedidos.evaluar.push(ultimo);
    if (modo.evaluar === "falla") throw new Error("la IA no contestó");
    return json({
      // De más y con basura, a propósito.
      preguntasClave: [{ hecha: true }, { hecha: "true" }, { hecha: true }, { hecha: false }, { hecha: true }, { hecha: false }, { hecha: true }, { hecha: true }],
      banderasRojas: [{ explorada: true }],
      estudios: { pertinentes: ["Hemograma", ""], faltaron: ["Ecografía abdominal"], innecesarios: [] },
      diagnostico: { acerto: true, comentario: "Llegaste al diagnóstico con la migración del dolor." },
      diferenciales: { considero: ["Embarazo ectópico"], faltaron: ["Quiste ovárico complicado"] },
      comunicacion: { bien: ["Te presentaste", "Preguntas abiertas", "Empatía", "Resumiste"], mejorar: ["Explicar los pasos"] },
      comentario: "x".repeat(2000),
    });
  }
  throw new Error("pedido inesperado a la IA: " + sistema.slice(0, 80));
};

(async () => {
  const pv = require(path.join(RAIZ, "modulos", "estudiantes", "pacienteVirtual"));

  console.log("── 1. El guion (sin base) ──");
  const g = pv.sanearGuion(CASO);
  verificar("un guion completo sirve", !!g && g.diagnostico === "Apendicitis aguda");
  verificar("  ...sin el diferencial que repite el diagnóstico, ni campos inventados", g.diferenciales.length === 3 && !("Glucosa" in g.signosVitales));
  verificar("sin preguntas clave no sirve (no habría con qué evaluar)", pv.sanearGuion({ ...CASO, preguntasClave: [] }) === null);
  verificar("sin examen físico tampoco", pv.sanearGuion({ ...CASO, examenFisico: [] }) === null);
  const delPaciente = JSON.stringify(pv.guionDelPaciente(g));
  verificar("lo que recibe el paciente NO tiene el diagnóstico, ni el examen, ni los estudios",
    !/Apendicitis|apendicitis|Blumberg|Leucocitos|ectópico/.test(delPaciente) && delPaciente.includes("Carla Mendoza") && delPaciente.includes("ombligo"));
  verificar("lo que recibe el que resuelve a ciegas tiene todo menos la respuesta", !/Apendicitis/.test(pv.casoSinRespuesta(g)) && /Blumberg/.test(pv.casoSinRespuesta(g)));

  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "paciente_virtual";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  // Después de vaciar la base, los índices que importan acá: el del candado
  // es el candado mismo.
  for (const modelo of [M.RachaEstudio, M.Candado, M.SimulacionPaciente]) await modelo.syncIndexes();

  const enSeisMeses = new Date(Date.now() + 180 * 86400000);
  const est = (phone) => M.Medico.create({ phone, nombre: "Est " + phone, passwordHash: "x", activo: true, idioma: "es",
    estudiante: { nivel: "interno", hasta: enSeisMeses, horasMes: 12 } });
  await est("59170090001"); await est("59170090002"); await est("59170090003");
  await M.Medico.create({ phone: "70090009", nombre: "Dr. Médico", passwordHash: "x", activo: true });
  const tk = (phone) => generarToken(phone, "medico", 36e5, { estudiante: true });
  const [tkA, tkB, tkC] = ["59170090001", "59170090002", "59170090003"].map(tk);
  const tkMed = generarToken("70090009", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  // El módulo, montado igual que en index.js.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);
  const hastaQueEste = async (id, t, estados, ms = 10000) => {
    for (let i = 0; i < ms / 100; i++) {
      const r = await P("GET", `/medico/pacientes-virtuales/${id}`, t);
      if (estados.includes(r.cuerpo?.simulacion?.estado)) return r.cuerpo.simulacion;
      await esperar(100);
    }
    return null;
  };

  console.log("\n── 2. Empezar: el caso se prepara y se comprueba a ciegas ──");
  let r = await P("GET", "/medico/pacientes-virtuales", tkMed);
  verificar("un médico → 403: es de las cuentas de estudiante", r.estado === 403);
  r = await P("POST", "/medico/pacientes-virtuales", tkA, { area: "cirugia", dificultad: "no-existe" });
  verificar("una dificultad que no existe → 400", r.estado === 400);
  r = await P("POST", "/medico/pacientes-virtuales", tkA, { area: "cirugia", dificultad: "intermedio" });
  verificar("empezar → 200, preparándose", r.estado === 200 && r.cuerpo.simulacion.estado === "preparando");
  const idA = r.cuerpo.simulacion._id;
  let s = await hastaQueEste(idA, tkA, ["en_curso", "error"]);
  verificar("  ...y enseguida en curso: el paciente dice su motivo", s?.estado === "en_curso" && s.mensajes[0]?.texto === CASO.motivo && s.paciente?.nombre === "Carla Mendoza");
  verificar("  ...el caso se armó una vez y se resolvió a ciegas una vez", llamadas.caso === 1 && llamadas.resolver === 1);
  const vistaA = JSON.stringify(s);
  verificar("  ...y a la pantalla NO le llega el guion: ni el diagnóstico, ni el examen, ni los estudios",
    !/Apendicitis|Blumberg|Leucocitos|preguntasClave|guion/.test(vistaA));
  verificar("el caso quedó en el banco", (await M.CasoVirtual.countDocuments()) === 1);

  console.log("\n── 3. La entrevista ──");
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "pregunta", texto: "Hola, soy el estudiante Juan. ¿Desde cuándo le duele?" });
  verificar("preguntar → el paciente contesta, sin las comillas", r.estado === 200 && r.cuerpo.mensajes[1].rol === "paciente" && r.cuerpo.mensajes[1].texto === "Sí doctor, me duele.");
  const alPaciente = pedidos.paciente[0];
  verificar("al paciente le llega su guion SIN el diagnóstico, ni el examen, ni los estudios",
    !/Apendicitis|Blumberg|Leucocitos|ectópico/.test(alPaciente.messages[0].content) && /NUNCA|nunca digas un diagnóstico/.test(alPaciente.messages[0].content));
  verificar("  ...y la conversación: su motivo y la pregunta", alPaciente.messages[1].role === "assistant" && alPaciente.messages[1].content === CASO.motivo
    && alPaciente.messages.at(-1).content.includes("¿Desde cuándo le duele?"));
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "examen", texto: "Abdomen" });
  verificar("examinar → el hallazgo, como resultado de la práctica (no del paciente)", r.estado === 200 && r.cuerpo.mensajes[1].rol === "sistema" && /Blumberg/.test(r.cuerpo.mensajes[1].texto));
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "examen", texto: "  abdomen. " });
  verificar("examinar lo mismo otra vez → lo mismo, sin volver a la IA", r.estado === 200 && /Blumberg/.test(r.cuerpo.mensajes[1].texto) && llamadas.examen === 1);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "estudio", texto: "Hemograma" });
  verificar("pedir un estudio → el resultado", r.estado === 200 && /Leucocitos/.test(r.cuerpo.mensajes[1].texto) && llamadas.estudio === 1);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "pregunta", texto: "" });
  verificar("una pregunta vacía → 400", r.estado === 400);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkB, { tipo: "pregunta", texto: "hola" });
  verificar("la práctica de otro estudiante → 404", r.estado === 404);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/terminar`, tkA, { principal: "Apendicitis" });
  verificar("terminar con una sola pregunta → 400: primero hay que entrevistar", r.estado === 400 && llamadas.evaluar === 0);
  for (const q of ["¿El dolor se movió?", "¿Tuvo fiebre?"]) await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "pregunta", texto: q });
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/terminar`, tkA, { principal: "" });
  verificar("terminar sin diagnóstico → 400", r.estado === 400);

  console.log("\n── 4. La evaluación ──");
  modo.evaluar = "falla";
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/terminar`, tkA, { principal: "Apendicitis aguda", diferenciales: "Embarazo ectópico, Infección urinaria" });
  s = (await P("GET", `/medico/pacientes-virtuales/${idA}`, tkA)).cuerpo.simulacion;
  verificar("si la evaluación falla → 502, y la práctica sigue en curso para reintentar", r.estado === 502 && s.estado === "en_curso");
  modo.evaluar = "ok";
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/terminar`, tkA, { principal: "Apendicitis aguda", diferenciales: "Embarazo ectópico, Infección urinaria", plan: "Interconsulta a cirugía" });
  const ev = r.cuerpo?.simulacion?.evaluacion;
  verificar("terminar → 200, con el caso entero a la vista", r.estado === 200 && r.cuerpo.simulacion.estado === "terminada" && r.cuerpo.simulacion.guion?.diagnostico === "Apendicitis aguda");
  verificar("  ...las preguntas clave alineadas con el guion (6), y «hecha» solo si es un sí de verdad",
    ev.preguntasClave.length === 6 && ev.preguntasClave[0].pregunta === "¿Dónde empezó el dolor?" && ev.preguntasClave[0].hecha === true && ev.preguntasClave[1].hecha === false);
  verificar("  ...las banderas rojas alineadas (la que no vino, sin explorar)", ev.banderasRojas.length === 2 && ev.banderasRojas[0].explorada === true && ev.banderasRojas[1].explorada === false);
  verificar("  ...recortada: sin filas vacías, hasta 3 de comunicación, comentario corto",
    ev.estudios.pertinentes.join() === "Hemograma" && ev.comunicacion.bien.length === 3 && ev.comentario.length === 700 && ev.diagnostico.acerto === true);
  verificar("  ...la IA recibió su diagnóstico y la conversación entera", /SU DIAGNÓSTICO: Apendicitis aguda/.test(pedidos.evaluar.at(-1)) && /¿Tuvo fiebre\?/.test(pedidos.evaluar.at(-1)) && /RESULTADO: .*Blumberg/.test(pedidos.evaluar.at(-1)));
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/terminar`, tkA, { principal: "Otra cosa" });
  verificar("terminar otra vez → 409", r.estado === 409 && llamadas.evaluar === 2);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/mensajes`, tkA, { tipo: "pregunta", texto: "¿y ahora?" });
  verificar("preguntar después de terminar → 409", r.estado === 409);
  const racha = await M.RachaEstudio.findOne({ medicoPhone: "59170090001" }).lean();
  verificar("terminar cuenta como día de estudio (racha 1)", racha?.actual === 1);
  r = await P("GET", "/medico/estudio/resumen", tkA);
  verificar("  ...y el logro del primer paciente virtual", r.cuerpo.resumen.logros.find(l => l.id === "paciente1")?.hecho === true && r.cuerpo.resumen.pacientesVirtuales === 1);
  r = await P("GET", "/medico/pacientes-virtuales", tkA);
  verificar("en el historial: el diagnóstico, si acertó y cuántas preguntas clave hizo",
    r.cuerpo.historial[0]?.diagnostico === "Apendicitis aguda" && r.cuerpo.historial[0].acerto === true && r.cuerpo.historial[0].preguntasHechas === 3 && r.cuerpo.historial[0].preguntasTotal === 6);

  console.log("\n── 5. El banco ──");
  const antes = { caso: llamadas.caso, resolver: llamadas.resolver };
  r = await P("POST", "/medico/pacientes-virtuales", tkB, { area: "cirugia", dificultad: "intermedio" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkB, ["en_curso", "error"]);
  verificar("otro estudiante, misma área y dificultad → el caso del banco, sin gastar IA", s?.estado === "en_curso" && llamadas.caso === antes.caso && llamadas.resolver === antes.resolver);
  verificar("  ...y el banco anota que se usó dos veces", (await M.CasoVirtual.findOne().lean()).usos === 2);
  r = await P("POST", "/medico/pacientes-virtuales", tkA, { area: "cirugia", dificultad: "intermedio" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkA, ["en_curso", "error"]);
  verificar("el mismo estudiante otra vez → uno nuevo: nadie ve dos veces el mismo caso", s?.estado === "en_curso" && llamadas.caso === antes.caso + 1 && (await M.CasoVirtual.countDocuments()) === 2);

  console.log("\n── 6. Un caso que no cierra se tira ──");
  modo.resolver = "mal";
  const antesMal = llamadas.caso;
  r = await P("POST", "/medico/pacientes-virtuales", tkC, { area: "pediatria", dificultad: "basico" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkC, ["en_curso", "error"]);
  verificar("si a ciegas no se llega al diagnóstico, se reintenta 3 veces y no se usa", s?.estado === "error" && llamadas.caso === antesMal + 3 && !(await M.CasoVirtual.exists({ area: "pediatria" })));
  modo.resolver = "bien";
  r = await P("GET", "/medico/pacientes-virtuales", tkC);
  verificar("  ...y un error no le gasta el cupo", r.cuerpo.cupo.usados === 0 && r.cuerpo.cupo.limite === 30);
  modo.caso = "incompleto";
  r = await P("POST", "/medico/pacientes-virtuales", tkC, { area: "pediatria", dificultad: "basico" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkC, ["en_curso", "error"]);
  verificar("un guion incompleto tampoco se usa", s?.estado === "error");
  modo.caso = "ok";

  console.log("\n── 7. «Este caso está mal» ──");
  const casoId = (await M.SimulacionPaciente.findById(idA).lean()).casoId;
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/reportar`, tkA, { motivo: "cualquier cosa" });
  verificar("con un motivo que no es de la lista → 400", r.estado === 400);
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/reportar`, tkA, { motivo: "incoherente" });
  r = await P("POST", `/medico/pacientes-virtuales/${idA}/reportar`, tkA, { motivo: "incoherente" });
  verificar("un estudiante, aunque lo marque dos veces → sigue en el banco", !(await M.CasoVirtual.findById(casoId).lean()).oculto);
  const simB = await M.SimulacionPaciente.findOne({ medicoPhone: "59170090002", casoId }).lean();
  r = await P("POST", `/medico/pacientes-virtuales/${simB._id}/reportar`, tkB, { motivo: "paciente" });
  verificar("  ...con un segundo estudiante → sale del banco", r.estado === 200 && (await M.CasoVirtual.findById(casoId).lean()).oculto === true);
  const antesOculto = llamadas.caso;
  r = await P("POST", "/medico/pacientes-virtuales", tkC, { area: "cirugia", dificultad: "intermedio" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkC, ["en_curso", "error"]);
  const usado = (await M.SimulacionPaciente.findById(r.cuerpo.simulacion._id).lean()).casoId;
  verificar("  ...y ya no le toca a nadie más", s?.estado === "en_curso" && String(usado) !== String(casoId) && llamadas.caso === antesOculto);

  console.log("\n── 8. Lo que se traba, el cupo y el acceso ──");
  const trabada = await M.SimulacionPaciente.create({ medicoPhone: "59170090002", area: "clinica", dificultad: "basico", estado: "evaluando", guion: CASO });
  await M.SimulacionPaciente.collection.updateOne({ _id: trabada._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 60000) } });
  r = await P("GET", `/medico/pacientes-virtuales/${trabada._id}`, tkB);
  verificar("una que quedó «evaluando» (el servidor se reinició) → vuelve a en curso al mirarla", r.cuerpo.simulacion.estado === "en_curso");
  r = await P("POST", "/medico/pacientes-virtuales", tkB, { area: "clinica", dificultad: "basico" });
  verificar("empezar otra deja la anterior como abandonada", (await M.SimulacionPaciente.findById(trabada._id).lean()).estado === "abandonada");
  await M.SimulacionPaciente.insertMany(Array.from({ length: 30 }, () => ({ medicoPhone: "59170090003", area: "clinica", dificultad: "basico", estado: "terminada" })));
  r = await P("POST", "/medico/pacientes-virtuales", tkC, { area: "clinica", dificultad: "basico" });
  verificar("con el cupo del mes usado (30 en interno) → 402, y lo dice", r.estado === 402 && /30 pacientes virtuales/.test(r.cuerpo.error));
  await M.Medico.updateOne({ phone: "59170090002" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  r = await P("POST", "/medico/pacientes-virtuales", tkB, { area: "clinica", dificultad: "basico" });
  verificar("con el acceso vencido → 402 (usa IA, como grabar)", r.estado === 402);
  r = await P("GET", `/medico/pacientes-virtuales/${idA}`, tkA);
  verificar("lo ya hecho se puede volver a mirar", r.estado === 200 && r.cuerpo.simulacion.evaluacion?.preguntasClave?.length === 6);
  r = await P("GET", "/medico/pacientes-virtuales/no-es-un-id", tkA);
  verificar("un id inventado → 404", r.estado === 404);
  await M.CasoVirtual.insertMany(Array.from({ length: pv.MAX_CASOS_NUEVOS_DIA }, () => ({ idioma: "pt", area: "gineco", dificultad: "avanzado", guion: { x: 1 }, oculto: true })));
  const antesTope = llamadas.caso;
  await M.Medico.updateOne({ phone: "59170090001" }, { $set: { idioma: "pt" } });
  r = await P("POST", "/medico/pacientes-virtuales", tkA, { area: "gineco", dificultad: "avanzado" });
  s = await hastaQueEste(r.cuerpo.simulacion._id, tkA, ["en_curso", "error"]);
  verificar(`con ${pv.MAX_CASOS_NUEVOS_DIA} casos nuevos en el día (entre todos) no se generan más: tope de gasto`, s?.estado === "error" && llamadas.caso === antesTope);

  console.log("\n── 9. A la vez, repetido y vencido (informe de QA del 9 de octubre de 2026) ──");
  await est("59170090004"); await est("59170090005");
  const [tkD, tkE] = ["59170090004", "59170090005"].map(tk);
  // Repetir «empezar» con la misma clave (se cortó la conexión): la misma práctica.
  const CLAVE_EMPEZAR = "empezar-de-prueba-0001";
  const r1 = await P("POST", "/medico/pacientes-virtuales", tkE, { area: "clinica", dificultad: "basico", clave: CLAVE_EMPEZAR });
  const r2 = await P("POST", "/medico/pacientes-virtuales", tkE, { area: "clinica", dificultad: "basico", clave: CLAVE_EMPEZAR });
  const deE = await M.SimulacionPaciente.find({ medicoPhone: "59170090005" }).lean();
  verificar("repetir «empezar» con la misma clave → la misma práctica: un solo cupo, y no se abandona a sí misma",
    r1.estado === 200 && r2.estado === 200 && String(r2.cuerpo.simulacion._id) === String(r1.cuerpo.simulacion._id)
    && deE.length === 1 && deE[0].estado !== "abandonada");
  // El candado: uno tomado frena; uno vencido (el servidor se cayó con él puesto) se toma.
  await M.Candado.updateOne({ clave: "pv:59170090005" }, { $set: { hasta: new Date(Date.now() + 60000), dueno: "otro pedido" } }, { upsert: true });
  r = await P("POST", "/medico/pacientes-virtuales", tkE, { area: "clinica", dificultad: "basico" });
  verificar("con otro «empezar» en curso → 409, «esperá un momento»", r.estado === 409 && /Esperá/.test(r.cuerpo?.error || ""));
  await M.Candado.updateOne({ clave: "pv:59170090005" }, { $set: { hasta: new Date(Date.now() - 1000) } });
  r = await P("POST", "/medico/pacientes-virtuales", tkE, { area: "clinica", dificultad: "basico" });
  verificar("  ...y si ese quedó colgado (venció su candado) → se puede empezar", r.estado === 200);

  // E03. Con 29 de 30: lo de adentro se hace lento a propósito, para que los
  // dos pedidos se crucen seguro.
  await M.SimulacionPaciente.insertMany(Array.from({ length: 29 }, () => ({ medicoPhone: "59170090004", area: "clinica", dificultad: "basico", estado: "terminada" })));
  const cupoDe = pv.cupoDe;
  pv.cupoDe = async (...a) => { await esperar(300); return cupoDe(...a); };
  const juntos = await Promise.all([1, 2].map(() => P("POST", "/medico/pacientes-virtuales", tkD, { area: "cirugia", dificultad: "intermedio" })));
  pv.cupoDe = cupoDe;
  // Todas, aunque la nueva no llegue a prepararse: lo que se mide es cuántas se crearon.
  const usadosD = await M.SimulacionPaciente.countDocuments({ medicoPhone: "59170090004" });
  verificar(`E03: con 29 de 30 y dos «empezar» a la vez → uno empieza y el otro espera (409); quedan 30, no 31 (${usadosD})`,
    juntos.filter(x => x.estado === 200).length === 1 && juntos.some(x => x.estado === 409) && usadosD === 30);

  // E04. Con 79 de 80: el paciente tarda en contestar, a propósito.
  const charla = [];
  for (let i = 0; i < 79; i++) charla.push({ rol: "estudiante", tipo: "pregunta", texto: `Pregunta ${i}`, en: new Date() }, { rol: "paciente", tipo: "pregunta", texto: "Sí.", en: new Date() });
  const llena = await M.SimulacionPaciente.create({ medicoPhone: "59170090004", area: "cirugia", dificultad: "intermedio", estado: "en_curso", guion: g, mensajes: charla });
  modo.demoraPaciente = 300;
  const antesDos = llamadas.paciente;
  const dos = await Promise.all(["¿Fuma?", "¿Toma alcohol?"].map(q => P("POST", `/medico/pacientes-virtuales/${llena._id}/mensajes`, tkD, { tipo: "pregunta", texto: q })));
  modo.demoraPaciente = 0;
  const trasDos = await M.SimulacionPaciente.findById(llena._id).lean();
  verificar("E04: con 79 de 80 y dos preguntas a la vez → una sola llega a la IA y se guarda; la otra espera su turno (409)",
    dos.filter(x => x.estado === 200).length === 1 && dos.some(x => x.estado === 409 && /Esperá/.test(x.cuerpo?.error || ""))
    && llamadas.paciente === antesDos + 1 && pv.preguntasDe(trasDos) === 80);
  r = await P("POST", `/medico/pacientes-virtuales/${llena._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Algo más?" });
  verificar("  ...y la siguiente → 409, «llegaste a 80», sin gastar IA", r.estado === 409 && /80 mensajes/.test(r.cuerpo?.error || "") && llamadas.paciente === antesDos + 1);
  // Terminar mientras el paciente contesta: espera esa respuesta.
  const tresPreguntas = [];
  for (const q of ["¿Desde cuándo?", "¿Dónde?", "¿Fiebre?"]) tresPreguntas.push({ rol: "estudiante", tipo: "pregunta", texto: q, en: new Date() }, { rol: "paciente", tipo: "pregunta", texto: "Sí.", en: new Date() });
  const corta = await M.SimulacionPaciente.create({ medicoPhone: "59170090004", area: "cirugia", dificultad: "intermedio", estado: "en_curso", guion: g,
    mensajes: [{ rol: "paciente", tipo: "inicio", texto: CASO.motivo, en: new Date() }, ...tresPreguntas] });
  modo.demoraPaciente = 300;
  const enVuelo = P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Vomitó?" });
  await esperar(100);
  r = await P("POST", `/medico/pacientes-virtuales/${corta._id}/terminar`, tkD, { principal: "Apendicitis aguda" });
  verificar("terminar mientras el paciente contesta → 409, «esperá la respuesta»; la pregunta en camino se guarda",
    r.estado === 409 && /Esperá/.test(r.cuerpo?.error || "") && (await enVuelo).estado === 200);
  modo.demoraPaciente = 0;

  // Repetir una pregunta con su clave: la respuesta que ya se guardó.
  const CLAVE_PREGUNTA = "pregunta-de-prueba-0001";
  const antesRep = llamadas.paciente;
  const p1 = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Le duele al caminar?", clave: CLAVE_PREGUNTA });
  const p2 = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Le duele al caminar?", clave: CLAVE_PREGUNTA });
  const trasRep = await M.SimulacionPaciente.findById(corta._id).lean();
  verificar("repetir una pregunta con su clave (se cortó la conexión) → la misma respuesta, sin volver a la IA ni duplicar la charla",
    p1.estado === 200 && p2.estado === 200 && p2.cuerpo.mensajes[1].texto === p1.cuerpo.mensajes[1].texto
    && llamadas.paciente === antesRep + 1 && pv.preguntasDe(trasRep) === 5);
  r = await P("GET", `/medico/pacientes-virtuales/${corta._id}`, tkD);
  verificar("  ...y la clave no viaja a la pantalla", !("clave" in p1.cuerpo.mensajes[0]) && !r.texto.includes(CLAVE_PREGUNTA));
  modo.paciente = "falla";
  r = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Y la fiebre?" });
  modo.paciente = "ok";
  const trasFalla = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Y la fiebre?" });
  verificar("si la IA falla → 502, y el turno se libera: la siguiente pasa", r.estado === 502 && trasFalla.estado === 200);

  // E05. Vence en el medio de la práctica.
  await M.Medico.updateOne({ phone: "59170090004" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  const antesVenc = { ...llamadas };
  r = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "pregunta", texto: "¿Algo más?" });
  verificar("E05: con el acceso vencido, la práctica abierta no le pregunta más a la IA → 402, y dice que venció",
    r.estado === 402 && /venció/.test(r.cuerpo?.error || "") && llamadas.paciente === antesVenc.paciente);
  r = await P("POST", `/medico/pacientes-virtuales/${corta._id}/mensajes`, tkD, { tipo: "examen", texto: "Abdomen" });
  verificar("  ...ni examina ni pide estudios → 402", r.estado === 402 && llamadas.examen === antesVenc.examen);
  r = await P("POST", `/medico/pacientes-virtuales/${corta._id}/terminar`, tkD, { principal: "Apendicitis aguda" });
  verificar("  ...ni la evalúa → 402", r.estado === 402 && llamadas.evaluar === antesVenc.evaluar);
  r = await P("GET", `/medico/pacientes-virtuales/${corta._id}`, tkD);
  verificar("  ...pero la puede mirar, y lo espera en curso para cuando renueve", r.estado === 200 && r.cuerpo.simulacion.estado === "en_curso");
  r = await P("GET", "/medico/pacientes-virtuales", tkD);
  verificar("  ...igual que la lista de sus prácticas", r.estado === 200 && Array.isArray(r.cuerpo.historial));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
