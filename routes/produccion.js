// Symphomed Ganadería — producción: leche (bovinos) y huevos (aves), por
// lote y por día, y el control lechero de cada vaca. Los cálculos viven en
// services/produccion.js.
const mongoose = require("mongoose");
const {
  LoteGanado, EventoLote, AnimalGanado, EventoReproductivo, RegistroProduccion, ControlLechero, Medico,
} = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar, diaPasadoValido: diaValido, numeroNoNegativo } = require("../services/httpHelpers");
const { diaDe, sumarDias, diasEnRetiroLeche, resumenProduccion, resumenControles, resumenControlLote } = require("../services/produccion");

const requireMedico = requireAuth(["medico"]);
const TIPO_POR_ESPECIE = { bovino: "leche", avicola: "huevos" };
const DIAS_HISTORIA = 60;

function idValido(id, que) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, `${que} no encontrado`);
}

async function eventosConRetiroLeche(loteId, medicoPhone) {
  return EventoLote.find({ loteId, medicoPhone, diasRetiroLeche: { $gt: 0 } })
    .select("tipo fecha diasRetiroLeche producto").lean();
}

module.exports = function (app) {
  // ─── PRODUCCIÓN DEL LOTE ────────────────────────────────────────────────
  app.get("/medico/lotes/:id/produccion", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const tipo = TIPO_POR_ESPECIE[lote.especie] || null;
    // Los cerdos no tienen producción diaria que anotar: su producción es
    // el peso, que ya está en los pesajes del lote.
    if (!tipo) return res.json({ tipo: null });

    const desde = sumarDias(diaDe(new Date()), -DIAS_HISTORIA);
    const [registros, eventosLote] = await Promise.all([
      RegistroProduccion.find({ loteId: lote._id, medicoPhone, tipo, dia: { $gte: desde } }).lean(),
      tipo === "leche" ? eventosConRetiroLeche(lote._id, medicoPhone) : [],
    ]);
    const resumen = resumenProduccion(tipo, registros, { eventosLote });

    let controlLote = null;
    if (tipo === "leche") {
      const animales = await AnimalGanado.find({ loteId: lote._id, medicoPhone, activa: true }).select("identificador").lean();
      const controles = animales.length
        ? await ControlLechero.find({ medicoPhone, animalId: { $in: animales.map(a => a._id) } }).lean()
        : [];
      controlLote = resumenControlLote(controles, new Map(animales.map(a => [String(a._id), a])));
    }

    res.json({ tipo, resumen, controlLote, cantidadActual: lote.cantidadActual });
  }));

  // Un registro por día: cargar el mismo día otra vez lo CORRIGE. Por eso
  // es PUT y no POST.
  app.put("/medico/lotes/:id/produccion", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const tipo = TIPO_POR_ESPECIE[lote.especie];
    if (!tipo) throw new ErrorHttp(400, "Los lotes de cerdos no llevan producción diaria: se sigue por los pesajes");
    if (lote.estado === "cerrado") throw new ErrorHttp(400, "El lote está cerrado");

    const dia = diaValido(req.body?.dia);
    const cantidad = numeroNoNegativo(req.body?.cantidad, "cantidad", { requerido: true });
    let animales = numeroNoNegativo(req.body?.animales, "animales");
    // Sin el dato, en aves se asume que ponen todas las gallinas vivas —
    // mismo criterio que la vacunación masiva—; sin eso no hay % de postura.
    if (animales == null && tipo === "huevos") animales = lote.cantidadActual;
    if (tipo === "huevos" && animales > lote.cantidadActual) {
      throw new ErrorHttp(400, `El lote tiene ${lote.cantidadActual} aves vivas`);
    }

    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre").lean();
    const registro = await RegistroProduccion.findOneAndUpdate(
      { medicoPhone, loteId: lote._id, tipo, dia },
      { $set: { cantidad, animales, notas: String(req.body?.notas || "").trim(), registradoPor: medico?.nombre || "" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    // Se avisa en la misma respuesta si esa leche está en retiro: es el
    // momento justo en que alguien puede frenar que vaya al tanque.
    let retiro = null;
    if (tipo === "leche") retiro = diasEnRetiroLeche(await eventosConRetiroLeche(lote._id, medicoPhone))(dia);
    res.json({ ok: true, registro, enRetiro: Boolean(retiro), productoRetiro: retiro ? retiro.producto : null });
  }));

  app.delete("/medico/produccion/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Registro");
    const registro = await obtenerOFallar(RegistroProduccion, { _id: req.params.id, medicoPhone }, "Registro no encontrado");
    await registro.deleteOne();
    res.json({ ok: true });
  }));

  // ─── CONTROL LECHERO DE UNA VACA ────────────────────────────────────────
  app.get("/medico/animales/:id/controles-lecheros", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Animal");
    const animal = await obtenerOFallar(AnimalGanado, { _id: req.params.id, medicoPhone }, "Animal no encontrado");
    if (animal.especie !== "bovino") return res.json({ aplica: false });
    const [controles, ultimoParto] = await Promise.all([
      ControlLechero.find({ animalId: animal._id, medicoPhone }).lean(),
      EventoReproductivo.findOne({ animalId: animal._id, medicoPhone, tipo: "parto" }).sort({ fecha: -1 }).lean(),
    ]);
    res.json({ aplica: true, ...resumenControles(controles, ultimoParto ? ultimoParto.fecha : null) });
  }));

  app.put("/medico/animales/:id/controles-lecheros", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Animal");
    const animal = await obtenerOFallar(AnimalGanado, { _id: req.params.id, medicoPhone }, "Animal no encontrado");
    if (animal.especie !== "bovino") throw new ErrorHttp(400, "El control lechero es para vacas");
    if (!animal.activa) throw new ErrorHttp(400, "El animal está dado de baja");
    const dia = diaValido(req.body?.dia);
    const litros = numeroNoNegativo(req.body?.litros, "litros", { requerido: true });
    const control = await ControlLechero.findOneAndUpdate(
      { medicoPhone, animalId: animal._id, dia },
      { $set: { litros, loteId: animal.loteId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ ok: true, control });
  }));

  app.delete("/medico/controles-lecheros/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Control");
    const control = await obtenerOFallar(ControlLechero, { _id: req.params.id, medicoPhone }, "Control no encontrado");
    await control.deleteOne();
    res.json({ ok: true });
  }));
};
