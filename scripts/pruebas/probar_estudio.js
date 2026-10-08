// Symphomed — Estudiar con los casos propios (services/estudio.js, etapa 3).
//
// Lo que se prueba:
//   · que las tarjetas salen del razonamiento guardado, sin llamar a la IA,
//     y sin el nombre del paciente;
//   · que la de diagnóstico viaja sin la respuesta y con las opciones en
//     otro orden, y que quien decide si acertó es el servidor;
//   · el repaso espaciado: 1, 3, 7, 14 y 30 días; errar vuelve a la caja 1;
//     repasar antes de tiempo no sube de caja;
//   · la racha, con el «hoy» de la zona de cada cuenta (La Paz / São Paulo);
//   · «esta pregunta está mal», y que solo lo usan cuentas de estudiante.
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

// ─── La IA de mentira: solo el razonamiento ────────────────────────────────
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const llamadas = { razonamiento: 0, otras: 0 };
axios.post = async (_url, cuerpo) => {
  const contestar = (obj) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  if (/enseñarle a razonar/.test(cuerpo.messages[0].content)) {
    llamadas.razonamiento++;
    return contestar({
      diferenciales: [
        { diagnostico: "Apendicitis aguda", aFavor: ["dolor en fosa ilíaca derecha", "fiebre"], enContra: ["no se exploró Blumberg"], estudio: "Ecografía abdominal" },
        { diagnostico: "Gastroenteritis aguda", aFavor: ["vómitos"], enContra: ["sin diarrea"], estudio: "Coprocultivo" },
        { diagnostico: "Infección urinaria", aFavor: [], enContra: ["sin disuria"], estudio: "Examen de orina" },
        { diagnostico: "Quiste ovárico complicado", aFavor: [], enContra: ["no se preguntó la fecha de la última menstruación"], estudio: "Ecografía pélvica" },
        { diagnostico: "Litiasis renal", aFavor: [], enContra: ["dolor no cólico"], estudio: "Ecografía renal" },
      ],
      banderasRojas: ["Abdomen en tabla", "Fiebre alta con taquicardia"],
      faltoPreguntar: ["¿Cuándo fue tu última menstruación?"],
      comparacion: { acertoPrincipal: true, comentario: "Bien.", noConsideraste: [] },
      perla: "El dolor que migra a la fosa ilíaca derecha es muy sugestivo de apendicitis.",
    });
  }
  llamadas.otras++;
  return contestar({});
};

const TEXTO = "Buenas tardes me duele la panza desde ayer primero alrededor del ombligo y ahora abajo a la derecha tengo fiebre y vomité dos veces";

(async () => {
  const estudio = require(path.join(RAIZ, "services", "estudio"));
  const { tarjetasDeCaso, paraMostrar, inicioDeDia, diaAnterior, rachaVisible, logrosDe } = estudio;

  console.log("── 1. De un razonamiento, las tarjetas (sin base) ──");
  const nacio = new Date("2000-05-20T12:00:00Z");
  const consultaBase = {
    createdAt: new Date("2026-10-01T15:00:00Z"),
    notaClinica: { motivoConsulta: "Dolor abdominal de un día", sintomas: ["dolor periumbilical que migra a FID", null, "fiebre", "", "vómitos"], antecedentesRelevantes: "Sin cirugías previas" },
    razonamiento: {
      principal: "Apendicitis", diferenciales: [], en: new Date("2026-10-01T16:00:00Z"),
      resultado: {
        diferenciales: [
          { diagnostico: "Apendicitis aguda", aFavor: ["dolor en FID", "fiebre"], enContra: ["no se exploró Blumberg"], estudio: "Ecografía abdominal" },
          { diagnostico: "Gastroenteritis aguda", aFavor: ["vómitos"], enContra: ["sin diarrea"], estudio: "Coprocultivo" },
          { diagnostico: "apendicitis AGUDA", aFavor: [], enContra: [], estudio: "" },   // repetido: se descarta
          { diagnostico: "Infección urinaria", aFavor: [], enContra: ["sin disuria"], estudio: "" },
          { diagnostico: "Quiste ovárico", aFavor: [], enContra: [], estudio: "" },
          { diagnostico: "Litiasis renal", aFavor: [], enContra: [], estudio: "" },
        ],
        banderasRojas: ["Abdomen en tabla", "", "Taquicardia"],
        faltoPreguntar: ["¿FUM?"],
        perla: "La migración del dolor orienta a apendicitis.",
      },
    },
  };
  const pacienteBase = { nombre: "Rosa Confidencial Quispe", sexo: "Femenino", fechaNacimiento: nacio };
  const alReves = (xs) => xs.slice().reverse();
  let ts = tarjetasDeCaso(consultaBase, pacienteBase, alReves);
  const porTipo = Object.fromEntries(ts.map(t => [t.tipo, t]));
  verificar("un razonamiento completo → 4 tarjetas: diagnóstico, estudio, banderas rojas y qué faltó preguntar",
    ts.map(t => t.tipo).join() === "dx,estudio,banderas,faltoPreguntar");
  const dx = porTipo.dx;
  verificar("la de diagnóstico tiene hasta 4 opciones, sin repetidos (aunque cambien mayúsculas)",
    dx.opciones.length === 4 && new Set(dx.opciones.map(o => o.toLowerCase())).size === 4);
  verificar("  ...y la correcta es el primer diferencial, esté donde esté", dx.opciones[dx.correcta] === "Apendicitis aguda" && dx.correcta === 3);
  verificar("  ...con lo que va en contra de cada opción, alineado", dx.enContraDe[dx.opciones.indexOf("Gastroenteritis aguda")] === "sin diarrea");
  verificar("el caso: sexo, la edad QUE TENÍA ese día, motivo y síntomas sin filas vacías",
    dx.caso.sexo === "Femenino" && dx.caso.edad === 26 && dx.caso.edadMeses === null && dx.caso.motivo === "Dolor abdominal de un día"
    && dx.caso.sintomas.join("|") === "dolor periumbilical que migra a FID|fiebre|vómitos");
  verificar("NINGUNA tarjeta lleva el nombre del paciente", !/Rosa|Confidencial|Quispe/.test(JSON.stringify(ts)));
  verificar("la de estudio pregunta por el primer diferencial", porTipo.estudio.sobre === "Apendicitis aguda" && porTipo.estudio.respuesta[0] === "Ecografía abdominal");
  verificar("banderas rojas sin filas vacías, y con la perla para después", porTipo.banderas.respuesta.join("|") === "Abdomen en tabla|Taquicardia" && /migración/.test(porTipo.banderas.perla));
  verificar("con caso para leer, las de banderas y «faltó» no dicen el diagnóstico (le soplarían la de opción múltiple)",
    porTipo.banderas.sobre === "" && porTipo.faltoPreguntar.sobre === "");
  ts = tarjetasDeCaso({ ...consultaBase, notaClinica: {} }, pacienteBase);
  verificar("sin motivo ni síntomas → no hay de diagnóstico (sería adivinar), y las otras dicen de qué cuadro se trata",
    !ts.some(t => t.tipo === "dx") && ts.find(t => t.tipo === "banderas")?.sobre === "Apendicitis aguda");
  const unDif = JSON.parse(JSON.stringify(consultaBase));
  unDif.razonamiento.resultado.diferenciales = unDif.razonamiento.resultado.diferenciales.slice(0, 1);
  verificar("con un solo diferencial → no hay opción múltiple", !tarjetasDeCaso(unDif, pacienteBase).some(t => t.tipo === "dx"));
  verificar("sin razonamiento hecho → ninguna", tarjetasDeCaso({ ...consultaBase, razonamiento: { ...consultaBase.razonamiento, en: null } }, pacienteBase).length === 0);
  const bebe = tarjetasDeCaso(consultaBase, { sexo: "Masculino", fechaNacimiento: new Date("2025-03-10T12:00:00Z") })[0];
  verificar("un bebé: la edad en meses (0 años no dice nada)", bebe.caso.edad === 1 && bebe.caso.edadMeses === 18);

  const enPantalla = paraMostrar({ _id: "t1", ...dx, aFavor: ["x"], respuesta: ["Apendicitis aguda"] }, alReves);
  verificar("la de diagnóstico viaja SIN la respuesta, ni lo que la delata", !("correcta" in enPantalla) && !("respuesta" in enPantalla)
    && !("aFavor" in enPantalla) && !("perla" in enPantalla) && !("enContraDe" in enPantalla));
  verificar("  ...y cada opción con su número original (lo que se contesta)",
    enPantalla.opciones.length === 4 && enPantalla.opciones.every(o => dx.opciones[o.i] === o.texto) && enPantalla.opciones[0].i === 3);
  const recuerdo = paraMostrar(porTipo.banderas);
  verificar("las de «me acordaba» llevan la respuesta (se muestra cuando él la pide)", recuerdo.respuesta.length === 2 && recuerdo.perla);

  console.log("\n── 2. Los días, en la zona de cada cuenta ──");
  const LP = "America/La_Paz", SP = "America/Sao_Paulo";
  const a2330LP = new Date("2026-10-09T03:30:00Z");   // 23:30 del 8 en La Paz, 00:30 del 9 en São Paulo
  verificar("«mañana» a las 23:30 en La Paz es el 9 a las 00:00 de La Paz", inicioDeDia(LP, a2330LP, 1).toISOString() === "2026-10-09T04:00:00.000Z");
  verificar("  ...y en São Paulo, en ese mismo instante, ya es el 9: mañana es el 10", inicioDeDia(SP, a2330LP, 1).toISOString() === "2026-10-10T03:00:00.000Z");
  verificar("el día anterior, cruzando meses y años bisiestos", diaAnterior("2026-03-01") === "2026-02-28" && diaAnterior("2028-03-01") === "2028-02-29" && diaAnterior("2027-01-01") === "2026-12-31");
  const ayer = { actual: 5, mejor: 8, ultimoDia: "2026-10-07" };
  verificar("racha de ayer: sigue viva (hoy todavía puede sumar)", JSON.stringify(rachaVisible(ayer, LP, new Date("2026-10-08T15:00:00Z"))) === JSON.stringify({ actual: 5, mejor: 8, hoyHecho: false }));
  verificar("racha de anteayer: cortada, aunque el número guardado siga", rachaVisible(ayer, LP, new Date("2026-10-09T15:00:00Z")).actual === 0);
  const ls = logrosDe({ casos: 3, acertados: 0, mejorRacha: 7, dominadas: 0 });
  verificar("logros: primer caso y racha de 7 hechos; 10 casos en 3/10", ls.find(l => l.id === "primerCaso").hecho && ls.find(l => l.id === "racha7").hecho
    && !ls.find(l => l.id === "casos10").hecho && ls.find(l => l.id === "casos10").actual === 3);

  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "estudio";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await M.TarjetaEstudio.syncIndexes();

  const enSeisMeses = new Date(Date.now() + 180 * 86400000);
  const est = (phone, zonaHoraria) => M.Medico.create({ phone, nombre: "Est " + phone, passwordHash: "x", activo: true, zonaHoraria,
    estudiante: { nivel: "interno", hasta: enSeisMeses, horasMes: 12 } });
  await est("59170070001", LP);
  await est("5511900070002", SP);
  await M.Medico.create({ phone: "70070009", nombre: "Dr. Médico", passwordHash: "x", activo: true });
  const tkEst = generarToken("59170070001", "medico", 36e5, { estudiante: true });
  const tkOtro = generarToken("5511900070002", "medico", 36e5, { estudiante: true });
  const tkMed = generarToken("70070009", "medico", 36e5);
  const pac = await M.Paciente.create({ medicoPhone: "59170070001", nombre: "Rosa Confidencial Quispe", sexo: "Femenino", fechaNacimiento: nacio });
  const consulta = (extra = {}) => M.ConsultaMedica.create({ medicoPhone: "59170070001", pacienteId: pac._id, estado: "completado", deEstudiante: true,
    notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Dolor abdominal", sintomas: ["dolor en FID", "fiebre"] }, transcripcionCompleta: TEXTO, ...extra });

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(require(path.join(RAIZ, "services", "estudiantes")).middlewareEstudiantes);
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  require(path.join(RAIZ, "routes", "estudio"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, tk, cuerpo) => pedir(servidor.address().port, m, ruta, tk, cuerpo);

  console.log("\n── 3. Razonar un caso arma sus tarjetas ──");
  const c1 = await consulta();
  let r = await P("POST", `/medico/consultas/${c1._id}/razonamiento`, tkEst, { principal: "Apendicitis", diferenciales: "Gastroenteritis" });
  verificar("razonar → 200, y avisa que se armaron 4 tarjetas", r.estado === 200 && r.cuerpo.tarjetas === 4);
  verificar("  ...guardadas, en la caja 1, para ya", (await M.TarjetaEstudio.countDocuments({ consultaId: c1._id, caja: 1, proxima: { $lte: new Date() } })) === 4);
  let yo = await M.Medico.findOne({ phone: "59170070001" }).lean();
  verificar("  ...y razonar cuenta como día de estudio: racha 1", yo.estudiante.racha?.actual === 1 && yo.estudiante.racha.mejor === 1);
  verificar("crearlas otra vez no duplica nada", (await estudio.crearTarjetasDeConsulta(c1._id)) === 0 && (await M.TarjetaEstudio.countDocuments()) === 4);
  const llamadasAntes = llamadas.razonamiento + llamadas.otras;

  // Otra consulta razonada «antes de que esto existiera»: con razonamiento y sin tarjetas.
  const c2 = await consulta({ razonamiento: { ...consultaBase.razonamiento, en: new Date() } });
  // Por razonar: una lista, otra sin nota todavía, otra casi sin texto.
  const c3 = await consulta({ notaClinica: { motivoConsulta: "Tos de una semana" } });
  await consulta({ notaClinicaEstado: "pendiente" });
  await consulta({ transcripcionCompleta: "hola doctor" });

  console.log("\n── 4. Lo de hoy ──");
  r = await P("GET", "/medico/estudio/hoy", tkEst);
  verificar("→ 200, con las 4 de este caso y las 4 del razonado antes (se arman al abrir)", r.estado === 200 && r.cuerpo.tarjetas.length === 8);
  verificar("  ...sin llamar a la IA ni una vez", llamadas.razonamiento + llamadas.otras === llamadasAntes);
  const tiposEnOrden = r.cuerpo.tarjetas.map(t => t.tipo);
  verificar("  ...las de diagnóstico primero (las otras le soplarían la respuesta)", tiposEnOrden.slice(0, 2).every(x => x === "dx") && !tiposEnOrden.slice(2).includes("dx"));
  const tDx = r.cuerpo.tarjetas.find(t => t.tipo === "dx" && String(t.consultaId) === String(c1._id));
  verificar("  ...la de diagnóstico sin la respuesta", tDx && !("correcta" in tDx) && !("respuesta" in tDx) && tDx.opciones.every(o => Number.isInteger(o.i) && o.texto));
  verificar("  ...y en ningún lado el nombre del paciente", !/Rosa|Confidencial|Quispe/.test(r.texto));
  const res0 = r.cuerpo.resumen;
  verificar("el resumen: 8 para hoy, 2 casos, racha 1 hecha hoy", res0.paraHoy === 8 && res0.total === 8 && res0.casos === 2 && res0.racha.actual === 1 && res0.racha.hoyHecho === true);
  verificar("  ...y por razonar, solo la que tiene nota y algo que leer", res0.porRazonar.total === 1 && String(res0.porRazonar.casos[0]._id) === String(c3._id) && res0.porRazonar.casos[0].motivo === "Tos de una semana");
  verificar("  ...con el logro del primer caso", res0.logros.find(l => l.id === "primerCaso")?.hecho === true);
  r = await P("GET", "/medico/estudio/hoy", tkMed);
  verificar("un médico → 403: es de las cuentas de estudiante", r.estado === 403);
  r = await P("GET", "/medico/estudio/resumen", tkEst);
  verificar("el resumen solo (para el inicio) → la racha y cuántas hay para hoy", r.estado === 200 && r.cuerpo.resumen.paraHoy === 8 && r.cuerpo.resumen.racha.actual === 1);

  console.log("\n── 5. Responder ──");
  const guardadaDx = await M.TarjetaEstudio.findById(tDx._id).lean();
  const mala = guardadaDx.opciones.findIndex((_, i) => i !== guardadaDx.correcta);
  r = await P("POST", `/medico/estudio/tarjetas/${tDx._id}/responder`, tkEst, { opcion: mala });
  const mananaLP = inicioDeDia(LP, new Date(), 1).toISOString();
  verificar("elegir otra → «no», con la correcta y por qué no era la elegida", r.estado === 200 && r.cuerpo.correcto === false
    && r.cuerpo.correcta === guardadaDx.correcta && r.cuerpo.enContraElegida === guardadaDx.enContraDe[mala] && r.cuerpo.aFavor.length > 0);
  verificar("  ...vuelve a la caja 1, para mañana (en la hora de La Paz)", r.cuerpo.caja === 1 && new Date(r.cuerpo.proxima).toISOString() === mananaLP);
  r = await P("POST", `/medico/estudio/tarjetas/${tDx._id}/responder`, tkEst, { opcion: 99 });
  verificar("una opción que no existe → 400", r.estado === 400);
  const tRec = (await M.TarjetaEstudio.findOne({ consultaId: c1._id, tipo: "banderas" }).lean());
  r = await P("POST", `/medico/estudio/tarjetas/${tRec._id}/responder`, tkEst, {});
  verificar("«me acordaba» sin decir sí o no → 400", r.estado === 400);
  r = await P("POST", `/medico/estudio/tarjetas/${tRec._id}/responder`, tkEst, { recordaba: true });
  verificar("«me acordaba» → sube a la caja 2, para mañana", r.estado === 200 && r.cuerpo.correcto && r.cuerpo.caja === 2 && new Date(r.cuerpo.proxima).toISOString() === mananaLP);
  verificar("  ...la racha no suma dos veces el mismo día", r.cuerpo.racha?.actual === 1 && r.cuerpo.racha.subio === false);
  r = await P("POST", `/medico/estudio/tarjetas/${tRec._id}/responder`, tkEst, { recordaba: true });
  verificar("la misma otra vez enseguida (un doble toque) → 409, no cuenta", r.estado === 409 && (await M.TarjetaEstudio.findById(tRec._id).lean()).vistas === 1);
  const pasoUnRato = (id) => M.TarjetaEstudio.updateOne({ _id: id }, { $set: { ultimaVez: new Date(Date.now() - 60000) } });
  await pasoUnRato(tRec._id);
  r = await P("POST", `/medico/estudio/tarjetas/${tRec._id}/responder`, tkEst, { recordaba: true });
  let tr = await M.TarjetaEstudio.findById(tRec._id).lean();
  verificar("un rato después, repasarla antes de tiempo y acertar → NO sube de caja (la vio antes)", r.estado === 200 && tr.caja === 2 && tr.vistas === 2 && tr.aciertos === 2);
  await pasoUnRato(tRec._id);
  r = await P("POST", `/medico/estudio/tarjetas/${tRec._id}/responder`, tkEst, { recordaba: false });
  tr = await M.TarjetaEstudio.findById(tRec._id).lean();
  verificar("  ...pero errarla sí la manda a la caja 1: es un olvido de verdad", tr.caja === 1 && tr.errores === 1);
  const tEst = await M.TarjetaEstudio.findOne({ consultaId: c1._id, tipo: "estudio" }).lean();
  const dosVeces = await Promise.all([1, 2].map(() => P("POST", `/medico/estudio/tarjetas/${tEst._id}/responder`, tkEst, { recordaba: true })));
  tr = await M.TarjetaEstudio.findById(tEst._id).lean();
  verificar("dos toques al mismo tiempo → cuenta una vez", tr.vistas === 1 && tr.caja === 2 && dosVeces.map(x => x.estado).sort().join() === "200,409");
  r = await P("POST", `/medico/estudio/tarjetas/${tEst._id}/responder`, tkOtro, { recordaba: true });
  verificar("la tarjeta de otro estudiante → 404", r.estado === 404);
  r = await P("POST", "/medico/estudio/tarjetas/no-es-un-id/responder", tkEst, { recordaba: true });
  verificar("un id inventado → 404, no un error del servidor", r.estado === 404);
  r = await P("POST", `/medico/estudio/tarjetas/${tEst._id}/responder`, tkMed, { recordaba: true });
  verificar("un médico → 403", r.estado === 403);

  console.log("\n── 6. El repaso espaciado: 1, 3, 7, 14 y 30 días ──");
  const tF = await M.TarjetaEstudio.findOne({ consultaId: c1._id, tipo: "faltoPreguntar" }).lean();
  let cuando = new Date("2026-11-02T15:00:00Z");
  const saltos = [];
  for (let i = 0; i < 6; i++) {
    await M.TarjetaEstudio.updateOne({ _id: tF._id }, { $set: { proxima: new Date(cuando.getTime() - 1000) } });
    const x = await estudio.responder("59170070001", String(tF._id), { recordaba: true }, LP, cuando);
    saltos.push(`${x.caja}:${Math.round((new Date(x.proxima) - inicioDeDia(LP, cuando, 0)) / 86400000)}`);
    cuando = new Date(x.proxima.getTime() + 3600000);
  }
  verificar(`acertando siempre: caja y días hasta la próxima → ${saltos.join(" ")}`, saltos.join(" ") === "2:1 3:3 4:7 5:14 5:30 5:30");
  const resDom = await estudio.resumen("59170070001", LP);
  verificar("  ...en la caja 4 o 5 cuenta como dominada", resDom.dominadas === 1);

  console.log("\n── 7. La racha ──");
  const telR = "5511900070002";
  const dia = (iso) => new Date(iso);
  let x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-05T15:00:00Z"));
  verificar("primer día → 1", x.actual === 1 && x.subio === true);
  x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-05T22:00:00Z"));
  verificar("otra vez el mismo día → sigue en 1", x.actual === 1 && x.subio === false);
  x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-06T12:00:00Z"));
  verificar("al día siguiente → 2", x.actual === 2 && x.mejor === 2);
  x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-07T02:30:00Z"));
  verificar("las 23:30 del mismo día en São Paulo (en el servidor ya es el 7) → sigue en 2", x.actual === 2 && x.subio === false);
  x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-07T03:30:00Z"));
  verificar("las 00:30 del 7 en São Paulo → 3", x.actual === 3);
  x = await estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-09T12:00:00Z"));
  verificar("saltearse un día → vuelve a 1, y la mejor queda en 3", x.actual === 1 && x.mejor === 3);
  const juntas = await Promise.all([1, 2, 3].map(() => estudio.marcarDiaDeEstudio(telR, SP, dia("2026-10-10T12:00:00Z"))));
  const rr = (await M.Medico.findOne({ phone: telR }).lean()).estudiante.racha;
  verificar("tres respuestas juntas el mismo día → suma UNA", rr.actual === 2 && rr.ultimoDia === "2026-10-10" && juntas.filter(j => j?.subio).length === 1);
  verificar("un médico (sin cuenta de estudiante) no tiene racha", (await estudio.marcarDiaDeEstudio("70070009", LP)) === null);

  console.log("\n── 8. «Esta pregunta está mal» ──");
  const tRep = await M.TarjetaEstudio.findOne({ consultaId: c2._id, tipo: "estudio" }).lean();
  r = await P("POST", `/medico/estudio/tarjetas/${tRep._id}/reportar`, tkEst, { motivo: "cualquier cosa" });
  verificar("con un motivo que no es de la lista → 400 (sin texto libre: nada de datos del caso)", r.estado === 400);
  r = await P("POST", `/medico/estudio/tarjetas/${tRep._id}/reportar`, tkEst, { motivo: "respuesta" });
  const antes = res0.total;
  r = await P("GET", "/medico/estudio/hoy", tkEst);
  verificar("marcada → deja de salir y no cuenta en el total", !r.cuerpo.tarjetas.some(t => String(t._id) === String(tRep._id)) && r.cuerpo.resumen.total === antes - 1);
  r = await P("DELETE", `/medico/estudio/tarjetas/${tRep._id}/reportar`, tkEst);
  r = await P("GET", "/medico/estudio/hoy", tkEst);
  verificar("«deshacer» → vuelve", r.cuerpo.tarjetas.some(t => String(t._id) === String(tRep._id)));
  r = await P("POST", `/medico/estudio/tarjetas/${tRep._id}/reportar`, tkOtro, { motivo: "respuesta" });
  verificar("marcar la de otro → 404", r.estado === 404);

  console.log("\n── 9. Repasar más, y estudiar con el acceso vencido ──");
  r = await P("GET", "/medico/estudio/repaso", tkEst);
  verificar("«repasar más» → las que todavía no tocaban, las que menos sabe primero",
    r.estado === 200 && r.cuerpo.tarjetas.length > 0 && r.cuerpo.tarjetas.every((t, i, xs) => i === 0 || xs[i - 1].caja <= t.caja));
  await M.Medico.updateOne({ phone: "59170070001" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  r = await P("GET", "/medico/estudio/hoy", tkEst);
  verificar("con el acceso vencido se puede seguir estudiando (no cuesta nada; lo que se frena es grabar)", r.estado === 200);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
