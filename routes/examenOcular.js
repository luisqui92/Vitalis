// Vitalis Visión — Mapa ocular: la ficha de cada paciente, ojo por ojo y
// estructura por estructura (córnea, iris, retina...). Se crea solo, con
// las 12 estructuras × 2 ojos en "normal", la primera vez que se abre —
// mismo criterio que el odontograma.
const { Paciente, ExamenOcular, OJOS, ESTRUCTURAS_OCULARES, ESTADOS_ESTRUCTURA_OCULAR } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { registrarCorreccion } = require("../services/correccionesIA");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

async function obtenerOCrearExamenOcular(pacienteId, medicoPhone) {
  let examen = await ExamenOcular.findOne({ pacienteId, medicoPhone });
  if (!examen) {
    const estructuras = [];
    for (const ojo of OJOS) {
      for (const estructura of ESTRUCTURAS_OCULARES) {
        estructuras.push({ ojo, estructura, estado: "normal", notas: "", historial: [] });
      }
    }
    examen = await ExamenOcular.create({ pacienteId, medicoPhone, estructuras });
  }
  return examen;
}

module.exports = function (app) {
  // ─── VER MAPA OCULAR (lo crea si es la primera vez) ─────────────────────
  app.get("/medico/pacientes/:pacienteId/examen-ocular", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const examen = await obtenerOCrearExamenOcular(paciente._id, medicoPhone);
    registrar({ req, medicoPhone, accion: "ver_examen_ocular", recurso: `Paciente:${paciente._id}` });
    res.json({ examen });
  }));

  // ─── ACTUALIZAR UNA ESTRUCTURA (corrección manual del médico) ───────────
  app.patch("/medico/pacientes/:pacienteId/examen-ocular/:ojo/:estructura", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const { ojo, estructura } = req.params;
    if (!OJOS.includes(ojo)) throw new ErrorHttp(400, "Ojo inválido");
    if (!ESTRUCTURAS_OCULARES.includes(estructura)) throw new ErrorHttp(400, "Estructura inválida");

    const estado = String(req.body?.estado || "").trim();
    if (!ESTADOS_ESTRUCTURA_OCULAR.includes(estado)) throw new ErrorHttp(400, "Estado inválido");
    const notas = String(req.body?.notas || "").trim();

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const examen = await obtenerOCrearExamenOcular(paciente._id, medicoPhone);

    const item = examen.estructuras.find(e => e.ojo === ojo && e.estructura === estructura);
    if (!item) throw new ErrorHttp(404, "Estructura no encontrada");

    // Si lo último que se guardó vino de la voz y el médico ahora lo
    // cambia a mano, es justo el caso que queremos poder revisar después.
    const ultimoFueVoz = item.historial[item.historial.length - 1]?.fuente === "voz";
    if (ultimoFueVoz) {
      registrarCorreccion({
        medicoPhone, tipo: "examen_ocular", consultaId: item.historial[item.historial.length - 1]?.consultaId,
        campo: `${ojo}:${estructura}`, valorSugerido: item.estado, valorFinal: estado,
      });
    }

    item.estado = estado;
    item.notas = notas;
    item.historial.push({ fecha: new Date(), estado, notas, fuente: "manual" });
    await examen.save();

    registrar({ req, medicoPhone, accion: "editar_examen_ocular", recurso: `Paciente:${paciente._id}`, detalle: `${ojo} ${estructura} -> ${estado}` });
    res.json({ ok: true, item });
  }));
};
