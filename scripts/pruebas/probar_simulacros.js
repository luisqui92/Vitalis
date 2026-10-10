// Symphomed — Simulacros por especialidad (etapa 4 de las cuentas de estudiante).
//
// Con la IA de mentira. Lo que se prueba:
//   · que una pregunta se guarda solo si está bien armada y otra IA, sin ver
//     la respuesta, contesta lo mismo sin dudar;
//   · que la respuesta correcta cambia de lugar (la IA tiende a repetirlo);
//   · el banco compartido: lo generado para uno le sirve al siguiente, y
//     nadie ve dos veces la misma pregunta;
//   · práctica (la respuesta enseguida) y examen (con tiempo, al final);
//   · que las erradas pasan a sus tarjetas de repaso;
//   · «está mal» de dos estudiantes saca la pregunta del banco;
//   · el cupo, el acceso vencido, y que solo es de estudiantes;
//   · lo del informe de QA del 9 de octubre de 2026: dos «empezar» a la vez
//     con un solo cupo (E03), y un examen cuyo cierre falla a la mitad: el
//     reintento completa las tarjetas sin contar dos veces (E07);
//   · y de la segunda revisión (R01): una respuesta que llega justo cuando se
//     cierra el examen, en los dos órdenes posibles.
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

// ─── La IA de mentira ──────────────────────────────────────────────────────
// Cada pregunta lleva un número; la respuesta correcta de cada enunciado se
// anota al escribirla, y el que verifica la busca ahí (o se equivoca a
// propósito, si el enunciado lo pide).
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const claves = new Map();
const llamadas = { generar: 0, verificar: 0 };
const alVerificador = [];
const modo = { generar: "ok" };
let numero = 0;
function pregunta(tema, marca = "") {
  numero++;
  const correcta = numero % 5;
  const enunciado = `Caso ${numero}: una paciente consulta por un cuadro de ${tema}. ${marca}¿Cuál es la conducta más adecuada?`;
  claves.set(enunciado, correcta);
  return { tema, enunciado, opciones: [0, 1, 2, 3, 4].map(k => `Conducta ${String.fromCharCode(65 + k)} del caso ${numero}`), correcta,
    explicacion: `Porque la conducta ${String.fromCharCode(65 + correcta)} es la indicada.`, porOpcion: [0, 1, 2, 3, 4].map(k => k === correcta ? "Es la correcta." : `La ${k} no corresponde.`) };
}
let ultimoLote = [];
axios.post = async (_url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const usuario = cuerpo.messages[1]?.content || "";
  const json = (obj) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  if (/preguntas para el examen de ingreso a la residencia/.test(sistema)) {
    llamadas.generar++;
    if (modo.generar === "falla") throw new Error("la IA no contestó");
    const temas = (sistema.match(/estos temas: (.+?)\.\n/) || [])[1].split("; ");
    if (modo.generar === "repetida") return json({ preguntas: ultimoLote });
    let lote;
    if (modo.generar === "sucio") {
      // Una sola de las cinco sirve.
      const [a, b, c, d, e] = temas.map(t => pregunta(t));
      a.opciones[4] = "Todas las anteriores";
      b.opciones = b.opciones.slice(0, 4);
      const dudosa = pregunta(temas[2], "[dudosa] ");
      const mal = pregunta(temas[3], "[equivocada] ");
      lote = [a, b, dudosa, mal, e];
      void c; void d;
    } else {
      lote = temas.map(t => pregunta(t));
    }
    ultimoLote = lote;
    return json({ preguntas: lote });
  }
  if (/Sos un médico que rinde el examen de residencia/.test(sistema)) {
    llamadas.verificar++; alVerificador.push(usuario);
    const enunciados = [...usuario.matchAll(/^PREGUNTA \d+: (.+)$/gm)].map(m => m[1]);
    return json({ respuestas: enunciados.map(e => {
      const k = claves.get(e);
      if (/\[dudosa\]/.test(e)) return { opcion: k, dudosa: true };
      if (/\[equivocada\]/.test(e)) return { opcion: (k + 1) % 5, dudosa: false };
      return { opcion: k, dudosa: false };
    }) });
  }
  throw new Error("pedido inesperado a la IA: " + sistema.slice(0, 80));
};

(async () => {
  const sim = require(path.join(RAIZ, "modulos", "estudiantes", "simulacros"));

  console.log("── 1. Una pregunta bien armada (sin base) ──");
  const buena = pregunta("asma");
  verificar("una pregunta completa sirve", !!sim.sanearPregunta(buena));
  verificar("con 4 opciones no sirve", sim.sanearPregunta({ ...buena, opciones: buena.opciones.slice(0, 4) }) === null);
  verificar("con opciones repetidas no sirve", sim.sanearPregunta({ ...buena, opciones: ["a", "A", "b", "c", "d"] }) === null);
  verificar("con «todas las anteriores» no sirve", sim.sanearPregunta({ ...buena, opciones: [...buena.opciones.slice(0, 4), "Todas las anteriores"] }) === null);
  verificar("con una «correcta» que no existe no sirve", sim.sanearPregunta({ ...buena, correcta: 7 }) === null);
  const lugares = new Set();
  for (let i = 0; i < 40; i++) {
    const m = sim.mezclarOpciones(sim.sanearPregunta(buena));
    if (m.opciones[m.correcta] !== buena.opciones[buena.correcta] || m.porOpcion[m.correcta] !== "Es la correcta.") lugares.add("mal");
    lugares.add(m.correcta);
  }
  verificar("mezclar cambia de lugar la correcta, y su explicación la acompaña", !lugares.has("mal") && lugares.size >= 4);

  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "simulacros";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  for (const modelo of [M.TarjetaEstudio, M.RachaEstudio, M.Candado, M.Simulacro]) await modelo.syncIndexes();

  console.log("\n── 2. Generar y verificar ──");
  modo.generar = "sucio";
  let n = await sim.generarPreguntas("es", "pediatria", 10);
  verificar(`de 10 escritas, se guardan solo las bien armadas que el verificador contestó igual y sin dudar (${n})`, n === 2 && llamadas.generar === 2 && llamadas.verificar === 2);
  verificar("al verificador no le llega la respuesta ni la explicación", !/correcta|Porque la conducta|Es la correcta/.test(alVerificador.join("\n")));
  const guardadas = await M.PreguntaSimulacro.find({ area: "pediatria" }).lean();
  verificar("  ...y las guardadas tienen la correcta en su lugar (el texto que era)",
    guardadas.every(p => p.opciones[p.correcta] === `Conducta ${String.fromCharCode(65 + claves.get(p.enunciado))} del caso ${p.enunciado.match(/Caso (\d+)/)[1]}`));
  modo.generar = "ok";
  n = await sim.generarPreguntas("es", "pediatria", 20);
  verificar("20 más, en cuatro lotes a la par", n === 20 && llamadas.generar === 6);
  modo.generar = "repetida";
  n = await sim.generarPreguntas("es", "pediatria", 5);
  verificar("las que repiten un enunciado del banco no se guardan", n === 0);
  modo.generar = "ok";

  const est = (phone) => M.Medico.create({ phone, nombre: "Est " + phone, passwordHash: "x", activo: true, idioma: "es",
    estudiante: { nivel: "interno", hasta: new Date(Date.now() + 180 * 86400000), horasMes: 12 } });
  await est("59170095001"); await est("59170095002"); await est("59170095003");
  await M.Medico.create({ phone: "70095009", nombre: "Dr. Médico", passwordHash: "x", activo: true });
  const tk = (phone) => generarToken(phone, "medico", 36e5, { estudiante: true });
  const [tkA, tkB, tkC] = ["59170095001", "59170095002", "59170095003"].map(tk);
  const tkMed = generarToken("70095009", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  // El módulo, montado igual que en index.js.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);
  const hastaQueEste = async (id, t, estados, ms = 15000) => {
    for (let i = 0; i < ms / 100; i++) {
      const r = await P("GET", `/medico/simulacros/${id}`, t);
      if (estados.includes(r.cuerpo?.simulacro?.estado)) return r.cuerpo.simulacro;
      await esperar(100);
    }
    return null;
  };
  const correctaDe = async (preguntaId) => (await M.PreguntaSimulacro.findById(preguntaId).lean()).correcta;

  console.log("\n── 3. Modo práctica ──");
  let r = await P("POST", "/medico/simulacros", tkMed, { area: "pediatria", cantidad: 10, modo: "practica" });
  verificar("un médico → 403", r.estado === 403);
  r = await P("POST", "/medico/simulacros", tkA, { area: "dermatologia", cantidad: 10, modo: "practica" });
  verificar("un área que no existe → 400", r.estado === 400);
  r = await P("POST", "/medico/simulacros", tkA, { area: "pediatria", cantidad: 7, modo: "practica" });
  verificar("una cantidad que no se ofrece → 400", r.estado === 400);
  const genAntes = llamadas.generar;
  r = await P("POST", "/medico/simulacros", tkA, { area: "pediatria", cantidad: 10, modo: "practica" });
  let s = await hastaQueEste(r.cuerpo.simulacro._id, tkA, ["listo", "error"]);
  verificar("con el banco alcanza: listo enseguida, sin gastar IA", s?.estado === "listo" && s.preguntas.length === 10 && llamadas.generar === genAntes);
  verificar("  ...las preguntas viajan sin la respuesta ni la explicación",
    s.preguntas.every(p => !("correcta" in p) && !("explicacion" in p) && p.opciones.length === 5 && p.enunciado));
  const idA1 = s._id;
  const q0 = s.preguntas[0], q1 = s.preguntas[1];
  const ok0 = await correctaDe(q0.preguntaId);
  r = await P("POST", `/medico/simulacros/${idA1}/responder`, tkA, { indice: 0, opcion: (ok0 + 1) % 5 });
  verificar("errar → «no», con la correcta, la explicación y el porqué de cada opción",
    r.estado === 200 && r.cuerpo.acerto === false && r.cuerpo.correcta === ok0 && /Porque la conducta/.test(r.cuerpo.explicacion) && r.cuerpo.porOpcion.length === 5);
  const tarjeta = await M.TarjetaEstudio.findOne({ medicoPhone: "59170095001", preguntaId: q0.preguntaId }).lean();
  verificar("  ...y la pregunta pasa a sus tarjetas de repaso, para mañana", tarjeta?.tipo === "pregunta" && tarjeta.enunciado === q0.enunciado && new Date(tarjeta.proxima) > new Date());
  r = await P("POST", `/medico/simulacros/${idA1}/responder`, tkA, { indice: 0, opcion: ok0 });
  verificar("  ...y no se puede cambiar (ya vio la respuesta) → 409", r.estado === 409);
  const ok1 = await correctaDe(q1.preguntaId);
  r = await P("POST", `/medico/simulacros/${idA1}/responder`, tkA, { indice: 1, opcion: ok1 });
  verificar("acertar → «sí», y esa no va a las tarjetas", r.cuerpo.acerto === true && !(await M.TarjetaEstudio.exists({ preguntaId: q1.preguntaId })));
  r = await P("POST", `/medico/simulacros/${idA1}/responder`, tkA, { indice: 99, opcion: 0 });
  verificar("una pregunta que no está → 400", r.estado === 400);
  s = (await P("GET", `/medico/simulacros/${idA1}`, tkA)).cuerpo.simulacro;
  verificar("al volver a abrirlo: las contestadas con su respuesta, las otras sin", s.preguntas[0].correcta === ok0 && !("correcta" in s.preguntas[2]));
  r = await P("POST", `/medico/simulacros/${idA1}/terminar`, tkA);
  verificar("terminar → 1 de 10, y ahora se ven todas", r.cuerpo.simulacro.estado === "terminado" && r.cuerpo.simulacro.aciertos === 1 && r.cuerpo.simulacro.preguntas.every(p => "correcta" in p));
  r = await P("POST", `/medico/simulacros/${idA1}/terminar`, tkA);
  verificar("terminar otra vez (el reloj y el botón a la vez) → lo mismo, sin error", r.estado === 200 && r.cuerpo.simulacro.aciertos === 1);
  verificar("las estadísticas de la pregunta: vista una vez", (await M.PreguntaSimulacro.findById(q0.preguntaId).lean()).vistas === 1);

  console.log("\n── 4. Nadie ve dos veces la misma pregunta ──");
  const vistasA = new Set(s.preguntas.map(p => String(p.preguntaId)));
  r = await P("POST", "/medico/simulacros", tkA, { area: "pediatria", cantidad: 10, modo: "practica" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkA, ["listo", "error"]);
  verificar("el segundo simulacro, con preguntas que no vio, todavía del banco", s?.estado === "listo" && s.preguntas.every(p => !vistasA.has(String(p.preguntaId))) && llamadas.generar === genAntes);
  s.preguntas.forEach(p => vistasA.add(String(p.preguntaId)));
  r = await P("POST", "/medico/simulacros", tkA, { area: "pediatria", cantidad: 10, modo: "practica" });
  verificar("  ...el anterior, a medias, se da por terminado al empezar otro", (await M.Simulacro.findById(s._id).lean()).estado === "terminado");
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkA, ["listo", "error"]);
  verificar("al tercero ya no le alcanzan: genera lo que falta y sigue sin repetir", s?.estado === "listo" && s.preguntas.length === 10
    && s.preguntas.every(p => !vistasA.has(String(p.preguntaId))) && llamadas.generar > genAntes);

  console.log("\n── 5. Modo examen, con tiempo ──");
  r = await P("POST", "/medico/simulacros", tkB, { area: "mixto", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkB, ["listo", "error"]);
  verificar("examen de todas las áreas → listo, con 90 segundos por pregunta", s?.estado === "listo" && s.segundosRestantes > 880 && s.segundosRestantes <= 900);
  verificar("  ...mezcla áreas", new Set(s.preguntas.map(p => p.area)).size >= 2);
  const idB = s._id;
  const okB0 = await correctaDe(s.preguntas[0].preguntaId);
  r = await P("POST", `/medico/simulacros/${idB}/responder`, tkB, { indice: 0, opcion: (okB0 + 1) % 5 });
  verificar("responder en examen → guardado, sin decir si está bien", r.estado === 200 && r.cuerpo.ok === true && !("acerto" in r.cuerpo) && !("correcta" in r.cuerpo));
  r = await P("POST", `/medico/simulacros/${idB}/responder`, tkB, { indice: 0, opcion: okB0 });
  verificar("  ...y puede cambiar de opinión antes de terminar", r.estado === 200);
  s = (await P("GET", `/medico/simulacros/${idB}`, tkB)).cuerpo.simulacro;
  verificar("  ...al mirarlo: su opción, sin la correcta", s.preguntas[0].elegida === okB0 && !("correcta" in s.preguntas[0]));
  verificar("  ...y no se crean tarjetas hasta el final", (await M.TarjetaEstudio.countDocuments({ medicoPhone: "59170095002" })) === 0);
  await M.Simulacro.updateOne({ _id: idB }, { $set: { empezadoEn: new Date(Date.now() - 20 * 60000) } });
  r = await P("POST", `/medico/simulacros/${idB}/responder`, tkB, { indice: 1, opcion: 0 });
  verificar("con el tiempo vencido → 409, «se terminó el tiempo»", r.estado === 409 && /tiempo/.test(r.cuerpo.error));
  r = await P("POST", `/medico/simulacros/${idB}/terminar`, tkB);
  s = r.cuerpo.simulacro;
  verificar("terminar → 1 de 10 (la que contestó bien), con todas las respuestas", s.estado === "terminado" && s.aciertos === 1 && s.preguntas.every(p => "correcta" in p));
  verificar("  ...las 9 que no sabía (erradas o sin contestar) pasan a sus tarjetas", (await M.TarjetaEstudio.countDocuments({ medicoPhone: "59170095002", tipo: "pregunta" })) === 9);

  console.log("\n── 6. Las erradas, en «Estudiar» ──");
  await M.TarjetaEstudio.updateMany({ medicoPhone: "59170095001" }, { $set: { proxima: new Date(Date.now() - 1000) } });
  r = await P("GET", "/medico/estudio/hoy", tkA);
  const tp = r.cuerpo.tarjetas.find(t => t.tipo === "pregunta");
  verificar("la errada del simulacro sale en sus tarjetas: el enunciado y las 5 opciones, sin la respuesta",
    tp && tp.enunciado === q0.enunciado && tp.opciones.length === 5 && !("correcta" in tp) && tp.area === "pediatria");
  r = await P("POST", `/medico/estudio/tarjetas/${tp._id}/responder`, tkA, { opcion: ok0 });
  verificar("  ...contestarla bien → «sí», con la explicación", r.estado === 200 && r.cuerpo.correcto === true && /Porque la conducta/.test(r.cuerpo.perla));

  console.log("\n── 7. «Esta pregunta está mal» ──");
  const comun = (await M.PreguntaSimulacro.findOne({ area: "pediatria" }).lean())._id;
  await M.Simulacro.create({ medicoPhone: "59170095002", area: "pediatria", cantidad: 1, estado: "terminado", preguntas: [{ preguntaId: comun }] });
  await M.Simulacro.create({ medicoPhone: "59170095003", area: "pediatria", cantidad: 1, estado: "terminado", preguntas: [{ preguntaId: comun }] });
  r = await P("POST", `/medico/simulacros/preguntas/${comun}/reportar`, tkB, { motivo: "inventado" });
  verificar("con un motivo que no es de la lista → 400", r.estado === 400);
  r = await P("POST", `/medico/simulacros/preguntas/${comun}/reportar`, tkB, { motivo: "respuesta" });
  verificar("un estudiante → queda anotado, sigue en el banco", r.estado === 200 && !(await M.PreguntaSimulacro.findById(comun).lean()).oculta);
  r = await P("POST", `/medico/simulacros/preguntas/${comun}/reportar`, tkC, { motivo: "respuesta" });
  verificar("  ...un segundo → sale del banco", (await M.PreguntaSimulacro.findById(comun).lean()).oculta === true);
  const nadie = await M.PreguntaSimulacro.findOne({ area: "pediatria", _id: { $ne: comun } }).lean();
  r = await P("POST", `/medico/simulacros/preguntas/${nadie._id}/reportar`, tkC, { motivo: "respuesta" });
  verificar("marcar una que nunca le tocó → 404", r.estado === 404);
  const deB = await M.TarjetaEstudio.findOne({ medicoPhone: "59170095002", tipo: "pregunta" }).lean();
  r = await P("POST", `/medico/estudio/tarjetas/${deB._id}/reportar`, tkB, { motivo: "pregunta" });
  verificar("marcar la tarjeta de una pregunta de simulacro la marca también en el banco",
    r.estado === 200 && (await M.PreguntaSimulacro.findById(deB.preguntaId).lean()).reportes.some(x => x.medicoPhone === "59170095002"));
  await P("DELETE", `/medico/estudio/tarjetas/${deB._id}/reportar`, tkB);
  verificar("  ...y deshacerlo la saca también del banco", !(await M.PreguntaSimulacro.findById(deB.preguntaId).lean()).reportes.some(x => x.medicoPhone === "59170095002"));

  console.log("\n── 8. Progreso, logros, cupo, acceso ──");
  r = await P("GET", "/medico/simulacros", tkA);
  const ped = r.cuerpo.progreso.find(p => p.area === "pediatria");
  verificar("el progreso por área: simulacros, preguntas y % bien", ped?.simulacros >= 1 && ped.preguntas >= 10 && typeof ped.pct === "number");
  verificar("  ...con el que tiene abierto", r.cuerpo.enCurso?.estado === "listo");
  // Uno perfecto: 10 de 10.
  r = await P("POST", "/medico/simulacros", tkC, { area: "pediatria", cantidad: 10, modo: "practica" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkC, ["listo", "error"]);
  for (const p of s.preguntas) await P("POST", `/medico/simulacros/${s._id}/responder`, tkC, { indice: p.indice, opcion: await correctaDe(p.preguntaId) });
  await P("POST", `/medico/simulacros/${s._id}/terminar`, tkC);
  r = await P("GET", "/medico/estudio/resumen", tkC);
  const logros = Object.fromEntries(r.cuerpo.resumen.logros.map(l => [l.id, l.hecho]));
  verificar("los logros: primer simulacro, y uno con el 80 % o más", logros.simulacro1 === true && logros.simulacro80 === true);
  verificar("  ...y responder cuenta como día de estudio", (await M.RachaEstudio.findOne({ medicoPhone: "59170095003" }).lean())?.actual === 1);
  await M.Simulacro.insertMany(Array.from({ length: 45 }, () => ({ medicoPhone: "59170095003", area: "clinica", cantidad: 10, estado: "terminado" })));
  r = await P("POST", "/medico/simulacros", tkC, { area: "clinica", cantidad: 10, modo: "practica" });
  verificar("con el cupo del mes usado (45 en interno) → 402, y lo dice", r.estado === 402 && /45 simulacros/.test(r.cuerpo.error));
  await M.Medico.updateOne({ phone: "59170095002" }, { $set: { "estudiante.hasta": new Date(Date.now() - 1000) } });
  r = await P("POST", "/medico/simulacros", tkB, { area: "clinica", cantidad: 10, modo: "practica" });
  verificar("con el acceso vencido → 402", r.estado === 402);
  modo.generar = "falla";
  r = await P("POST", "/medico/simulacros", tkA, { area: "salud_publica", cantidad: 40, modo: "practica" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkA, ["listo", "error"]);
  verificar("si no hay preguntas y la IA falla → error (y no le gasta el cupo)", s?.estado === "error");
  modo.generar = "ok";
  r = await P("GET", "/medico/simulacros/no-es-un-id", tkA);
  verificar("un id inventado → 404", r.estado === 404);

  console.log("\n── 9. A la vez, repetido y a medio cerrar (informe de QA del 9 de octubre de 2026) ──");
  await est("59170095004"); await est("59170095005");
  const [tkD, tkE] = ["59170095004", "59170095005"].map(tk);
  // Repetir «empezar» con la misma clave: el mismo simulacro.
  const CLAVE = "simulacro-de-prueba-0001";
  const r1 = await P("POST", "/medico/simulacros", tkE, { area: "pediatria", cantidad: 10, modo: "practica", clave: CLAVE });
  const r2 = await P("POST", "/medico/simulacros", tkE, { area: "pediatria", cantidad: 10, modo: "practica", clave: CLAVE });
  verificar("repetir «empezar» con la misma clave → el mismo simulacro, un solo cupo",
    r1.estado === 200 && r2.estado === 200 && String(r1.cuerpo.simulacro._id) === String(r2.cuerpo.simulacro._id)
    && (await M.Simulacro.countDocuments({ medicoPhone: "59170095005" })) === 1);
  // E03. Con 44 de 45: lo de adentro, lento a propósito.
  await M.Simulacro.insertMany(Array.from({ length: 44 }, () => ({ medicoPhone: "59170095004", area: "clinica", cantidad: 10, estado: "terminado" })));
  const cupoDe = sim.cupoDe;
  sim.cupoDe = async (...a) => { await esperar(300); return cupoDe(...a); };
  const juntos = await Promise.all([1, 2].map(() => P("POST", "/medico/simulacros", tkD, { area: "pediatria", cantidad: 10, modo: "practica" })));
  sim.cupoDe = cupoDe;
  const deD = await M.Simulacro.countDocuments({ medicoPhone: "59170095004" });
  verificar(`E03: con 44 de 45 y dos «empezar» a la vez → uno empieza y el otro espera (409); quedan 45, no 46 (${deD})`,
    juntos.filter(x => x.estado === 200).length === 1 && juntos.some(x => x.estado === 409 && /Esperá/.test(x.cuerpo?.error || "")) && deD === 45);

  // E07. Un examen: acierta la primera, erra la segunda, el resto sin contestar.
  r = await P("POST", "/medico/simulacros", tkE, { area: "pediatria", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkE, ["listo", "error"]);
  const okE0 = await correctaDe(s.preguntas[0].preguntaId);
  const okE1 = await correctaDe(s.preguntas[1].preguntaId);
  await P("POST", `/medico/simulacros/${s._id}/responder`, tkE, { indice: 0, opcion: okE0 });
  await P("POST", `/medico/simulacros/${s._id}/responder`, tkE, { indice: 1, opcion: (okE1 + 1) % 5 });
  const vistasAntes = new Map((await M.PreguntaSimulacro.find({ _id: { $in: s.preguntas.map(p => p.preguntaId) } }).lean()).map(p => [String(p._id), p.vistas]));
  // La base falla al guardar la cuarta tarjeta, una sola vez.
  const updateOne = M.TarjetaEstudio.updateOne;
  let tarjetasGuardadas = 0;
  M.TarjetaEstudio.updateOne = function (...a) {
    if (++tarjetasGuardadas === 4) return Promise.reject(new Error("la base no contestó"));
    return updateOne.apply(this, a);
  };
  r = await P("POST", `/medico/simulacros/${s._id}/terminar`, tkE);
  M.TarjetaEstudio.updateOne = updateOne;
  let guardado = await M.Simulacro.findById(s._id).lean();
  const tarjetasE = () => M.TarjetaEstudio.countDocuments({ medicoPhone: "59170095005", tipo: "pregunta" });
  verificar("E07: si la base falla a mitad del cierre → error, el examen queda terminado y anotado como pendiente",
    r.estado === 500 && guardado.estado === "terminado" && guardado.cierrePendiente === true && (await tarjetasE()) === 3);
  r = await P("POST", `/medico/simulacros/${s._id}/terminar`, tkE);
  guardado = await M.Simulacro.findById(s._id).lean();
  const vistasDespues = new Map((await M.PreguntaSimulacro.find({ _id: { $in: s.preguntas.map(p => p.preguntaId) } }).lean()).map(p => [String(p._id), p.vistas]));
  const contadas = s.preguntas.map(p => vistasDespues.get(String(p.preguntaId)) - vistasAntes.get(String(p.preguntaId)));
  verificar("  ...terminar otra vez lo completa: las 9 tarjetas (erradas y sin contestar), sin repetir ninguna",
    r.estado === 200 && r.cuerpo.simulacro.aciertos === 1 && (await tarjetasE()) === 9 && guardado.cierrePendiente === false);
  verificar(`  ...y las estadísticas se contaron una sola vez (las dos contestadas: +1; las otras: 0) [${contadas.join(",")}]`,
    contadas[0] === 1 && contadas[1] === 1 && contadas.slice(2).every(x => x === 0));
  // Otra vez, pero el estudiante no vuelve a tocar «terminar»: abre sus simulacros.
  r = await P("POST", "/medico/simulacros", tkE, { area: "pediatria", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkE, ["listo", "error"]);
  const antesSegundo = await tarjetasE();
  M.TarjetaEstudio.updateOne = () => Promise.reject(new Error("la base no contestó"));
  r = await P("POST", `/medico/simulacros/${s._id}/terminar`, tkE);
  M.TarjetaEstudio.updateOne = updateOne;
  verificar("  ...un segundo examen que falla al cerrar no crea ninguna tarjeta todavía", r.estado === 500 && (await tarjetasE()) === antesSegundo);
  r = await P("GET", "/medico/simulacros", tkE);
  verificar("  ...y abrir la lista de simulacros completa lo pendiente: sus 10 tarjetas", r.estado === 200
    && (await tarjetasE()) === antesSegundo + 10 && (await M.Simulacro.findById(s._id).lean()).cierrePendiente === false);
  r = await P("POST", "/medico/simulacros", tkE, { area: "pediatria", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkE, ["listo", "error"]);
  const antesTercero = await tarjetasE();
  M.TarjetaEstudio.updateOne = () => Promise.reject(new Error("la base no contestó"));
  await P("POST", `/medico/simulacros/${s._id}/terminar`, tkE);
  M.TarjetaEstudio.updateOne = updateOne;
  r = await P("GET", `/medico/simulacros/${s._id}`, tkE);
  verificar("  ...lo mismo al abrir ese examen", r.estado === 200 && r.cuerpo.simulacro.estado === "terminado"
    && (await tarjetasE()) === antesTercero + 10 && (await M.Simulacro.findById(s._id).lean()).cierrePendiente === false);
  // Un examen terminado antes de este cambio no tiene la marca: no hay nada que completar.
  const yaEnTarjetas = await M.TarjetaEstudio.distinct("preguntaId", { medicoPhone: "59170095005" });
  const otra = await M.PreguntaSimulacro.findOne({ _id: { $nin: yaEnTarjetas } }).lean();
  const viejo = await M.Simulacro.collection.insertOne({ medicoPhone: "59170095005", area: otra.area, modo: "examen", cantidad: 1, estado: "terminado",
    preguntas: [{ preguntaId: otra._id, elegida: null, acerto: null }], createdAt: new Date(), updatedAt: new Date() });
  const antesViejo = await tarjetasE();
  r = await P("GET", "/medico/simulacros", tkE);
  r = await P("GET", `/medico/simulacros/${viejo.insertedId}`, tkE);
  verificar("un examen de antes de esto (sin la marca) no se toca al abrirlo", r.estado === 200 && (await tarjetasE()) === antesViejo
    && !("cierrePendiente" in await M.Simulacro.collection.findOne({ _id: viejo.insertedId })));

  console.log("\n── 10. Responder y cerrar a la vez (segunda revisión de QA, R01) ──");
  await est("59170095006");
  const tkF = tk("59170095006");
  const updateOneSim = M.Simulacro.updateOne;
  // Un intercalado a mano: «antes» corre justo antes de que se guarde el
  // cambio que cumple «cuando», una sola vez.
  const intercalar = (cuando, antes) => {
    M.Simulacro.updateOne = function (filtro, cambio, ...resto) {
      if (!cuando(cambio)) return updateOneSim.call(this, filtro, cambio, ...resto);
      M.Simulacro.updateOne = updateOneSim;
      return antes(filtro._id).then(() => updateOneSim.call(this, filtro, cambio, ...resto));
    };
  };
  const esCierre = (cambio) => Array.isArray(cambio) || cambio?.$set?.estado === "terminado";
  const esRespuesta = (cambio) => Object.keys(cambio?.$set || {}).some(k => /^preguntas\.\d+\.elegida$/.test(k));
  r = await P("POST", "/medico/simulacros", tkF, { area: "pediatria", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkF, ["listo", "error"]);
  const okF0 = await correctaDe(s.preguntas[0].preguntaId);
  // A. Mientras se cierra, entra una respuesta correcta a la primera.
  intercalar(esCierre, (id) => M.Simulacro.collection.updateOne({ _id: id }, { $set: { "preguntas.0.elegida": okF0, "preguntas.0.acerto": true } }));
  r = await P("POST", `/medico/simulacros/${s._id}/terminar`, tkF);
  M.Simulacro.updateOne = updateOneSim;
  let cerrado = await M.Simulacro.findById(s._id).lean();
  verificar("A. una respuesta que entra mientras se cierra: queda guardada y cuenta en la nota (1 de 10, no 0)",
    r.estado === 200 && cerrado.preguntas[0].acerto === true && cerrado.aciertos === 1 && r.cuerpo.simulacro.aciertos === 1);
  // B. Mientras viaja una respuesta, el reloj cierra el examen.
  r = await P("POST", "/medico/simulacros", tkF, { area: "pediatria", cantidad: 10, modo: "examen" });
  s = await hastaQueEste(r.cuerpo.simulacro._id, tkF, ["listo", "error"]);
  const okF1 = await correctaDe(s.preguntas[0].preguntaId);
  intercalar(esRespuesta, (id) => M.Simulacro.collection.updateOne({ _id: id }, { $set: { estado: "terminado", terminadoEn: new Date() } }));
  r = await P("POST", `/medico/simulacros/${s._id}/responder`, tkF, { indice: 0, opcion: okF1 });
  M.Simulacro.updateOne = updateOneSim;
  cerrado = await M.Simulacro.findById(s._id).lean();
  verificar("B. una respuesta que llega con el examen ya cerrado → 409, «no se tomó en cuenta» (antes contestaba ok), y no se guarda",
    r.estado === 409 && /no se tomó en cuenta/.test(r.cuerpo?.error || "") && cerrado.preguntas[0].elegida == null);
  r = await P("POST", `/medico/simulacros/${s._id}/responder`, tkF, { indice: 1, opcion: 0 });
  verificar("  ...y una que llega después, igual: 409", r.estado === 409);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
