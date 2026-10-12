// Symphomed — Confirmar una consulta aplica lo suyo una sola vez
// (routes/consultaMedica.js, «Una confirmación por vez»).
//
// Confirmar crea medicación, vacunas, receta y tratamientos, y avisa la
// reconsulta por WhatsApp. Antes se creaba todo y recién al final quedaba la
// marca de confirmada: dos toques seguidos, o un reintento después de un
// error al guardar, duplicaban la medicación del Kardex (revisión integral
// del 11 de octubre de 2026, S02). Lo que se prueba:
//   1. Dos confirmaciones a la vez: una aplica, la otra → 409.
//   2. Falla el guardado final: error, y al reintentar no se duplica nada
//      (ni el WhatsApp al paciente).
//   3. El reclamo de una confirmación cortada vence; uno vigente frena.
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

// El WhatsApp al paciente, de mentira: se cuentan los envíos.
const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
const enviados = [];
meta.enviarTextoOPlantilla = async (telefono, texto) => { enviados.push({ telefono, texto }); return { ok: true }; };
// Ni la IA del resumen previo, que se rehace al confirmar (probar_resumen_al_confirmar.js).
require(path.join(RAIZ, "services", "briefClinico")).regenerarBriefClinico = async () => {};

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "confirmar_una_vez";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  // Los índices únicos son los que frenan el duplicado: que existan ya.
  await Promise.all([M.Medicamento, M.Vacuna, M.Receta, M.TratamientoPlan, M.ConsultaMedica].map(x => x.syncIndexes()));

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));

  const MED = "70099101";
  await M.Medico.create({ phone: MED, nombre: "Dra. Confirma", passwordHash: "x", activo: true, tipoEspecialidad: "odontologia" });
  const tk = generarToken(MED, "medico", 36e5);
  const P = (ruta, cuerpo) => pedir(servidor.address().port, "POST", ruta, tk, cuerpo);
  const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Paciente que confirma", telefono: "59170099102" });

  // Una consulta con de todo para aplicar.
  const nueva = () => M.ConsultaMedica.create({
    medicoPhone: MED, pacienteId: paciente._id, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: {
      motivoConsulta: "Control", diagnostico: "Caries",
      medicamentosRecetados: [{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 horas" }, { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 horas" }],
      vacunasMencionadas: [{ nombre: "Antitetánica", dosis: "Refuerzo", fecha: "2026-10-01" }],
      antecedentesFamiliaresNuevos: [{ parentesco: "Madre", condicion: "Diabetes" }],
      tratamientosSugeridos: [{ itemMencionado: "una restauración en la 16", piezaFdi: 16, catalogoNombreSugerido: "Restauración" }],
      reconsultaSugerida: { fechaHora: new Date(Date.now() + 7 * 86400000), estado: "pendiente" },
    },
  });
  const cuerpo = (c) => ({
    aplicar: {
      medicamentos: [0, 1], vacunas: [0], receta: true, antecedentesFamiliares: [0],
      tratamientos: [{ itemId: String(c.notaClinica.tratamientosSugeridos[0]._id), nombre: "Restauración", precio: 250 }],
      reconsulta: { activo: true },
    },
  });
  const cuantos = async (consultaId) => ({
    meds: await M.Medicamento.countDocuments({ pacienteId: paciente._id, consultaId }),
    vacunas: await M.Vacuna.countDocuments({ pacienteId: paciente._id, consultaId }),
    recetas: await M.Receta.countDocuments({ consultaId }),
    tratamientos: await M.TratamientoPlan.countDocuments({ pacienteId: paciente._id, consultaId }),
  });
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const UNA_VEZ = { meds: 2, vacunas: 1, recetas: 1, tratamientos: 1 };

  console.log("── 1. Dos confirmaciones a la vez ──");
  const c1 = await nueva();
  const [ra, rb] = await Promise.all([P(`/medico/consultas/${c1._id}/confirmar`, cuerpo(c1)), P(`/medico/consultas/${c1._id}/confirmar`, cuerpo(c1))]);
  verificar(`una aplica (200) y la otra → 409 (${ra.estado}, ${rb.estado})`, [ra.estado, rb.estado].sort().join() === "200,409");
  verificar("  ...la del 409 dice que ya se confirmó o se está confirmando", /confirm/.test([ra, rb].find(x => x.estado === 409)?.cuerpo?.error || ""));
  verificar(`  ...y todo quedó una sola vez: ${JSON.stringify(await cuantos(c1._id))}`, igual(await cuantos(c1._id), UNA_VEZ));
  verificar("  ...un solo WhatsApp de reconsulta al paciente", enviados.length === 1);
  const c1Final = await M.ConsultaMedica.findById(c1._id).lean();
  verificar("  ...confirmada, y sin el reclamo colgado", !!c1Final.confirmadaEn && !c1Final.confirmandoDesde);

  console.log("\n── 2. Falla el guardado final, y se reintenta ──");
  const c2 = await nueva();
  const saveOriginal = M.ConsultaMedica.prototype.save;
  let fallar = 1;
  M.ConsultaMedica.prototype.save = function (...a) {
    if (fallar > 0 && this.confirmadaEn) { fallar--; return Promise.reject(new Error("la base no contestó")); }
    return saveOriginal.apply(this, a);
  };
  let r = await P(`/medico/consultas/${c2._id}/confirmar`, cuerpo(c2));
  M.ConsultaMedica.prototype.save = saveOriginal;
  const despuesDelError = await cuantos(c2._id);
  verificar(`el guardado final falla → error (${r.estado}), con lo aplicado hasta ahí`, r.estado === 500 && igual(despuesDelError, UNA_VEZ));
  verificar("  ...y el reclamo se suelta en el momento: se puede reintentar", !(await M.ConsultaMedica.findById(c2._id).lean()).confirmandoDesde);
  r = await P(`/medico/consultas/${c2._id}/confirmar`, cuerpo(c2));
  verificar("el reintento → 200, confirmada", r.estado === 200 && !!(await M.ConsultaMedica.findById(c2._id).lean()).confirmadaEn);
  verificar(`  ...sin duplicar nada: ${JSON.stringify(await cuantos(c2._id))}`, igual(await cuantos(c2._id), UNA_VEZ));
  verificar("  ...el reintento devuelve la receta que ya estaba", String(r.cuerpo?.recetaId) === String((await M.Receta.findOne({ consultaId: c2._id }).lean())?._id));
  verificar("  ...el paciente recibió un solo WhatsApp de esta reconsulta", enviados.length === 2);
  verificar("  ...y el antecedente familiar figura una vez", (await M.Paciente.findById(paciente._id).lean()).antecedentesFamiliares.filter(a => a.condicion === "Diabetes").length === 1);

  console.log("\n── 3. El reclamo de una confirmación cortada ──");
  const c3 = await nueva();
  await M.ConsultaMedica.updateOne({ _id: c3._id }, { $set: { confirmandoDesde: new Date() } });
  r = await P(`/medico/consultas/${c3._id}/confirmar`, cuerpo(c3));
  verificar("con otra confirmación en curso → 409 «se está confirmando»", r.estado === 409 && /se está confirmando/.test(r.cuerpo?.error || ""));
  await M.ConsultaMedica.updateOne({ _id: c3._id }, { $set: { confirmandoDesde: new Date(Date.now() - 3 * 60000) } });
  r = await P(`/medico/consultas/${c3._id}/confirmar`, cuerpo(c3));
  verificar("si quedó colgada hace minutos (el proceso se cayó) → se puede confirmar", r.estado === 200 && igual(await cuantos(c3._id), UNA_VEZ));
  r = await P(`/medico/consultas/${c3._id}/confirmar`, cuerpo(c3));
  verificar("ya confirmada → 409 «ya fue confirmada»", r.estado === 409 && /ya fue confirmada/.test(r.cuerpo?.error || ""));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
