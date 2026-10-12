// Symphomed — Lo que la IA entiende para el mapa de la especialidad entra a
// la ficha recién al confirmar, y solo lo que el médico dejó marcado.
//
// Antes, apenas se escribía la nota, sus hallazgos se cargaban solos en el
// odontograma, el mapa ocular o el ginecológico: una pieza mal oída quedaba
// en la ficha sin que nadie la revisara, y desmarcarla al confirmar no
// servía de nada (revisión integral del 11 de octubre de 2026, S05). Lo que
// se prueba:
//   1. Escribir la nota no crea ni toca el mapa.
//   2. Al confirmar entra lo marcado, con fuente "voz" y el id de la
//      consulta; lo desmarcado no entra; si no había mapa, se crea.
//   3. Un reintento de la confirmación no repite el historial.
//   4. Solo en la especialidad que tiene ese mapa; índices raros no rompen.
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

// La IA de mentira: la nota que escribe trae hallazgos para los tres mapas.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const NOTA_IA = {
  motivoConsulta: "Control", diagnostico: "Control de rutina", plan: "Seguimiento",
  odontogramaSugerido: [
    { piezaFdi: 36, estado: "caries", hallazgo: "la 36 tiene caries" },
    { piezaFdi: 18, estado: "extraccion_indicada", hallazgo: "la 18 hay que sacarla" },
  ],
  examenOcularSugerido: [
    { ojo: "OD", estructura: "cristalino", hallazgo: "opacidad cortical leve", estado: "leve" },
    { ojo: "OI", estructura: "retina", hallazgo: "retina sin desprendimiento", estado: "normal" },
  ],
  ginecoSugerido: [
    { organo: "utero", hallazgo: "mioma", detalle: "mioma de cuatro centímetros" },
    { organo: "ovario_izquierdo", hallazgo: "quiste", detalle: "quiste simple" },
  ],
};
axios.post = async () => ({ data: { choices: [{ message: { content: JSON.stringify(NOTA_IA) } }] } });

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "mapas_al_confirmar";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Promise.all([M.Medicamento, M.Vacuna, M.Receta, M.TratamientoPlan, M.ConsultaMedica].map(x => x.syncIndexes()));

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  const medicos = {};
  for (const [clave, phone, tipoEspecialidad] of [["odonto", "70088001", "odontologia"], ["ojos", "70088002", "oftalmologia"],
    ["gineco", "70088003", "ginecologia"], ["general", "70088004", "medicina_general"]]) {
    await M.Medico.create({ phone, nombre: `Dra. ${clave}`, passwordHash: "x", activo: true, tipoEspecialidad });
    medicos[clave] = { phone, tk: generarToken(phone, "medico", 36e5) };
  }
  const POST = (quien, ruta, cuerpo) => pedir(puerto, "POST", ruta, medicos[quien].tk, cuerpo);
  const paciente = (quien, nombre) => M.Paciente.create({ medicoPhone: medicos[quien].phone, nombre });
  // Una consulta transcrita cuya nota falló: «Volver a generar la nota» la
  // escribe con el mismo camino que la de siempre (producirNota).
  const consultaSinNota = (quien, pac) => M.ConsultaMedica.create({
    medicoPhone: medicos[quien].phone, pacienteId: pac._id, estado: "completado",
    transcripcionCompleta: "Consulta de control con hallazgos en el examen.", notaClinicaEstado: "error", notaClinicaError: "timeout",
  });
  const escribirNota = async (quien, consulta) => {
    const r = await POST(quien, `/medico/consultas/${consulta._id}/nota/regenerar`);
    let c;
    for (let i = 0; i < 50; i++) {
      c = await M.ConsultaMedica.findById(consulta._id).lean();
      if (c.notaClinicaEstado !== "pendiente") break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    // El brief y el hilo salen de atrás después de la nota: que terminen.
    await new Promise((ok) => setTimeout(ok, 200));
    return { r, c };
  };
  const confirmar = (quien, consulta, aplicar) => POST(quien, `/medico/consultas/${consulta._id}/confirmar`, { aplicar });
  const pieza = (od, n) => od?.piezas.find(p => p.numero === n);
  const estructura = (ex, ojo, e) => ex?.estructuras.find(x => x.ojo === ojo && x.estructura === e);
  const organo = (mapa, o) => mapa?.organos.find(x => x.organo === o);

  console.log("── 1. Escribir la nota no toca el mapa ──");
  const pacOdonto = await paciente("odonto", "Paciente sin odontograma");
  const c1 = await consultaSinNota("odonto", pacOdonto);
  let { r, c } = await escribirNota("odonto", c1);
  verificar(`la nota se escribe (${r.estado}) con los dos hallazgos del odontograma`, r.estado === 202 && c.notaClinicaEstado === "completado" && c.notaClinica.odontogramaSugerido?.length === 2);
  verificar("  ...y el paciente sigue sin odontograma: la nota no lo crea", (await M.Odontograma.countDocuments({ pacienteId: pacOdonto._id })) === 0);

  const pacConMapa = await paciente("odonto", "Paciente con odontograma");
  await M.Odontograma.create({ pacienteId: pacConMapa._id, medicoPhone: medicos.odonto.phone,
    piezas: M.PIEZAS_FDI_PERMANENTE.map(numero => ({ numero, estado: numero === 36 ? "obturado" : "sano", notas: "", historial: [] })) });
  const c2 = await consultaSinNota("odonto", pacConMapa);
  await escribirNota("odonto", c2);
  let od = await M.Odontograma.findOne({ pacienteId: pacConMapa._id }).lean();
  verificar("con odontograma: la 36 sigue «obturado», sin nada en su historial", pieza(od, 36)?.estado === "obturado" && pieza(od, 36).historial.length === 0);

  const pacOjos = await paciente("ojos", "Paciente de ojos");
  const c3 = await consultaSinNota("ojos", pacOjos);
  ({ c } = await escribirNota("ojos", c3));
  verificar("oftalmología: la nota trae los hallazgos y no hay mapa ocular todavía", c.notaClinica.examenOcularSugerido?.length === 2 && (await M.ExamenOcular.countDocuments({ pacienteId: pacOjos._id })) === 0);

  const pacGineco = await paciente("gineco", "Paciente de gineco");
  const c4 = await consultaSinNota("gineco", pacGineco);
  ({ c } = await escribirNota("gineco", c4));
  verificar("ginecología: la nota trae los hallazgos y no hay mapa ginecológico todavía", c.notaClinica.ginecoSugerido?.length === 2 && (await M.ExamenGinecologico.countDocuments({ pacienteId: pacGineco._id })) === 0);

  console.log("\n── 2. Al confirmar entra lo marcado, y nada más ──");
  r = await confirmar("odonto", c1, { odontograma: [0] });
  od = await M.Odontograma.findOne({ pacienteId: pacOdonto._id }).lean();
  verificar(`confirmar con la 36 marcada y la 18 no (${r.estado}) → el odontograma se crea entero`, r.estado === 200 && od?.piezas.length === M.PIEZAS_FDI_PERMANENTE.length);
  const h36 = pieza(od, 36)?.historial || [];
  verificar("  ...la 36 queda «caries», con lo que se dijo", pieza(od, 36)?.estado === "caries" && pieza(od, 36).notas === "la 36 tiene caries");
  verificar("  ...en su historial, una vez, con fuente «voz» y el id de la consulta", h36.length === 1 && h36[0].fuente === "voz" && String(h36[0].consultaId) === String(c1._id));
  verificar("  ...la 18, desmarcada, sigue sana y sin historial", pieza(od, 18)?.estado === "sano" && pieza(od, 18).historial.length === 0);
  verificar("  ...y la respuesta dice qué se cargó", (r.cuerpo?.aplicado || []).includes("Odontograma: pieza 36") && !(r.cuerpo?.aplicado || []).some(x => /pieza 18/.test(x)));

  r = await confirmar("odonto", c2, { odontograma: [] });
  od = await M.Odontograma.findOne({ pacienteId: pacConMapa._id }).lean();
  verificar(`todo desmarcado (${r.estado}) → la 36 sigue «obturado» y la 18 sana`, r.estado === 200 && pieza(od, 36)?.estado === "obturado" && pieza(od, 18)?.estado === "sano" && pieza(od, 36).historial.length === 0);

  r = await confirmar("ojos", c3, { examenOcular: [0] });
  const ex = await M.ExamenOcular.findOne({ pacienteId: pacOjos._id }).lean();
  const cristalino = estructura(ex, "OD", "cristalino");
  verificar(`oftalmología (${r.estado}): el mapa se crea, el cristalino derecho queda «leve», del dictado`, r.estado === 200 && cristalino?.estado === "leve"
    && cristalino.historial.length === 1 && cristalino.historial[0].fuente === "voz" && String(cristalino.historial[0].consultaId) === String(c3._id));
  verificar("  ...la retina izquierda, desmarcada, sin tocar", estructura(ex, "OI", "retina")?.historial.length === 0);

  r = await confirmar("gineco", c4, { gineco: [1] });
  const mapa = await M.ExamenGinecologico.findOne({ pacienteId: pacGineco._id }).lean();
  verificar(`ginecología (${r.estado}): el ovario izquierdo queda «quiste», del dictado`, r.estado === 200 && organo(mapa, "ovario_izquierdo")?.hallazgo === "quiste"
    && organo(mapa, "ovario_izquierdo").historial[0]?.fuente === "voz" && String(organo(mapa, "ovario_izquierdo").historial[0]?.consultaId) === String(c4._id));
  verificar("  ...el útero, desmarcado, sigue «normal» y sin historial", organo(mapa, "utero")?.hallazgo === "normal" && organo(mapa, "utero").historial.length === 0);

  console.log("\n── 3. Un reintento no repite el historial ──");
  const pacReintento = await paciente("odonto", "Paciente del reintento");
  const c5 = await consultaSinNota("odonto", pacReintento);
  await escribirNota("odonto", c5);
  const saveOriginal = M.ConsultaMedica.prototype.save;
  let fallar = 1;
  M.ConsultaMedica.prototype.save = function (...a) {
    if (fallar > 0 && this.confirmadaEn) { fallar--; return Promise.reject(new Error("la base no contestó")); }
    return saveOriginal.apply(this, a);
  };
  r = await confirmar("odonto", c5, { odontograma: [0, 1] });
  M.ConsultaMedica.prototype.save = saveOriginal;
  verificar(`el guardado final falla → error (${r.estado})`, r.estado === 500);
  r = await confirmar("odonto", c5, { odontograma: [0, 1] });
  od = await M.Odontograma.findOne({ pacienteId: pacReintento._id }).lean();
  verificar(`el reintento (${r.estado}): la 36 y la 18 con UNA entrada cada una`, r.estado === 200
    && pieza(od, 36)?.historial.length === 1 && pieza(od, 18)?.historial.length === 1 && pieza(od, 18).estado === "extraccion_indicada");

  console.log("\n── 4. Solo en su especialidad; índices raros no rompen ──");
  const pacGeneral = await paciente("general", "Paciente de medicina general");
  const c6 = await M.ConsultaMedica.create({ medicoPhone: medicos.general.phone, pacienteId: pacGeneral._id, estado: "completado",
    notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Control", odontogramaSugerido: NOTA_IA.odontogramaSugerido } });
  r = await confirmar("general", c6, { odontograma: [0, 1] });
  verificar(`una cuenta de medicina general (${r.estado}) no crea odontograma aunque la pantalla lo pida`, r.estado === 200 && (await M.Odontograma.countDocuments({ pacienteId: pacGeneral._id })) === 0);

  const pacRaro = await paciente("odonto", "Paciente de índices raros");
  const c7 = await consultaSinNota("odonto", pacRaro);
  await escribirNota("odonto", c7);
  r = await confirmar("odonto", c7, { odontograma: ["x", 99, -1, null, { a: 1 }] });
  verificar(`índices que no existen (${r.estado}) → se confirma sin cargar nada al mapa`, r.estado === 200 && (await M.Odontograma.countDocuments({ pacienteId: pacRaro._id })) === 0);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
