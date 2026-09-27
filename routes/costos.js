// Symphomed Ganadería — alimento y costos de un lote. Los indicadores
// (costo por animal, conversión alimenticia, costo por litro o por docena)
// se calculan en services/costos.js.
const mongoose = require("mongoose");
const { LoteGanado, EventoLote, RegistroProduccion, GastoLote, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { CATEGORIAS_GASTO, resumenCostos } = require("../services/costos");
const { registrarGasto } = require("../services/cargasGanado");
const { diaDe, sumarDias, resumenProduccion } = require("../services/produccion");

const requireMedico = requireAuth(["medico"]);
const TIPO_PRODUCCION = { bovino: "leche", avicola: "huevos" };

function idValido(id, que) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, `${que} no encontrado`);
}

module.exports = function (app) {
  app.get("/medico/lotes/:id/costos", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const medico = await Medico.findOne({ phone: medicoPhone }).select("moneda").lean();
    const moneda = medico?.moneda === "BRL" ? "BRL" : "BOB";

    const tipoProduccion = TIPO_PRODUCCION[lote.especie] || null;
    const desde = sumarDias(diaDe(new Date()), -31);
    const [gastos, pesajes, registros, eventosRetiro] = await Promise.all([
      GastoLote.find({ loteId: lote._id, medicoPhone }).sort({ dia: -1, createdAt: -1 }).lean(),
      EventoLote.find({ loteId: lote._id, medicoPhone, tipo: "pesaje" }).select("fecha pesoPromedioKg").lean(),
      tipoProduccion ? RegistroProduccion.find({ loteId: lote._id, medicoPhone, tipo: tipoProduccion, dia: { $gte: desde } }).lean() : [],
      tipoProduccion === "leche"
        ? EventoLote.find({ loteId: lote._id, medicoPhone, diasRetiroLeche: { $gt: 0 } }).select("tipo fecha diasRetiroLeche producto").lean()
        : [],
    ]);

    // Solo se suman los gastos en la moneda de la cuenta. Si la cuenta
    // cambió de moneda, sumar bolivianos con reales daría un número que no
    // es ni una cosa ni la otra: los de la otra moneda se listan igual, pero
    // se dice cuántos quedaron fuera de la cuenta.
    const enMoneda = gastos.filter(g => (g.moneda || "BOB") === moneda);
    const serieProduccion = tipoProduccion
      ? resumenProduccion(tipoProduccion, registros, { eventosLote: eventosRetiro }).serie
      : [];

    res.json({
      moneda,
      categorias: CATEGORIAS_GASTO,
      gastos: gastos.slice(0, 50),
      gastosOtraMoneda: gastos.length - enMoneda.length,
      resumen: resumenCostos(lote, enMoneda, { pesajes, tipoProduccion, serieProduccion }),
    });
  }));

  app.post("/medico/lotes/:id/gastos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone }, "Lote no encontrado");
    const medico = await Medico.findOne({ phone: medicoPhone }).select("nombre moneda").lean();
    const gasto = await registrarGasto(lote, req.body, { moneda: medico?.moneda, registradoPor: medico?.nombre || "" });
    res.status(201).json({ ok: true, gasto });
  }));

  app.delete("/medico/gastos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    idValido(req.params.id, "Gasto");
    const gasto = await obtenerOFallar(GastoLote, { _id: req.params.id, medicoPhone }, "Gasto no encontrado");
    await gasto.deleteOne();
    res.json({ ok: true });
  }));
};
