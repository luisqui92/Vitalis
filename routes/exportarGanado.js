// Symphomed Ganadería — Descargar en Excel (lado veterinario).
//
// Tres alcances: un lote, una finca (todos sus lotes, también los
// cerrados: es la historia del establecimiento) o todo Ganadería. La
// planilla la arma services/exportarGanado.js; el dueño baja la de su finca
// por su enlace (routes/accesoDueno.js).
const mongoose = require("mongoose");
const { Finca, LoteGanado, Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { libroGanadero, nombreArchivo } = require("../services/exportarGanado");
const { TIPO_XLSX } = require("../services/xlsx");

const requireMedico = requireAuth(["medico"]);
// Un veterinario con cientos de lotes cerrados no necesita bajarlos todos de
// una: el tope evita que un pedido arme una planilla de minutos.
const TOPE_LOTES = 300;

function idValido(id, que) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(404, `${que} no encontrado`);
}

async function mandarLibro(req, res, lotes, base, recurso) {
  const medicoPhone = req.adminUser.usuario;
  const medico = await Medico.findOne({ phone: medicoPhone }).select("idioma moneda").lean();
  const libro = await libroGanadero(lotes, {
    medicoPhone, idioma: medico?.idioma === "pt" ? "pt" : "es", moneda: medico?.moneda === "BRL" ? "BRL" : "BOB",
  });
  // Bajar los registros de un establecimiento entero es un acto que alguien
  // puede preguntar después quién hizo, igual que compartir una historia.
  registrar({ req, medicoPhone, accion: "exportar_ganaderia_excel", recurso, detalle: `${lotes.length} lote(s)` });
  res.set({
    "Content-Type": TIPO_XLSX,
    "Content-Disposition": `attachment; filename="${nombreArchivo(base)}"`,
    "Cache-Control": "no-store",
  });
  res.send(libro);
}

module.exports = function (app) {
  app.get("/medico/lotes/:id/excel", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    idValido(req.params.id, "Lote");
    const lote = await obtenerOFallar(LoteGanado, { _id: req.params.id, medicoPhone: req.adminUser.usuario }, "Lote no encontrado");
    await mandarLibro(req, res, [lote], `${lote.codigo}_${lote.nombre}`, `LoteGanado:${lote._id}`);
  }));

  app.get("/medico/fincas/:id/excel", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    idValido(req.params.id, "Finca");
    const medicoPhone = req.adminUser.usuario;
    const finca = await obtenerOFallar(Finca, { _id: req.params.id, medicoPhone }, "Finca no encontrada");
    const lotes = await LoteGanado.find({ medicoPhone, fincaId: finca._id }).sort({ estado: 1, nombre: 1 }).limit(TOPE_LOTES);
    await mandarLibro(req, res, lotes, finca.nombre, `Finca:${finca._id}`);
  }));

  // Todo Ganadería, con los mismos filtros que la lista (estado y finca).
  // No cuelga de /medico/lotes/… a propósito: «excel» caería como :id.
  app.get("/medico/ganaderia/excel", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const filtro = { medicoPhone };
    if (req.query.estado === "activo" || req.query.estado === "cerrado") filtro.estado = req.query.estado;
    if (req.query.fincaId) {
      idValido(req.query.fincaId, "Finca");
      filtro.fincaId = req.query.fincaId;
    }
    const lotes = await LoteGanado.find(filtro).sort({ estado: 1, nombre: 1 }).limit(TOPE_LOTES);
    await mandarLibro(req, res, lotes, "ganaderia", "Ganaderia");
  }));
};
