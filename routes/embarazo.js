// Vitalis Obstetricia — control de embarazo: FUM/FPP y su historial. Un
// embarazo "activo" por paciente a la vez (no tiene sentido tener dos
// abiertos juntos); los controles prenatales en sí (peso materno, altura
// uterina, frecuencia cardíaca fetal) van por el módulo de Mediciones ya
// existente — acá solo vive el episodio del embarazo.
const { Paciente, Embarazo, DESENLACES_EMBARAZO } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function fppPorNaegele(fum) {
  return new Date(fum.getTime() + 280 * MS_POR_DIA);
}

function semanasGestacion(fum, hasta = new Date()) {
  const dias = Math.floor((hasta.getTime() - fum.getTime()) / MS_POR_DIA);
  return { semanas: Math.max(0, Math.floor(dias / 7)), dias: Math.max(0, dias % 7) };
}

function conCalculo(embarazo) {
  if (!embarazo) return null;
  const obj = embarazo.toObject();
  obj.semanasGestacion = semanasGestacion(embarazo.fum, embarazo.activo ? new Date() : (embarazo.fechaFin || embarazo.fum));
  return obj;
}

module.exports = function (app) {
  // ─── VER (el activo + el historial de embarazos anteriores) ────────────
  app.get("/medico/pacientes/:pacienteId/embarazo", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const [activo, historial] = await Promise.all([
      Embarazo.findOne({ pacienteId: paciente._id, medicoPhone, activo: true }),
      Embarazo.find({ pacienteId: paciente._id, medicoPhone, activo: false }).sort({ fechaFin: -1 }),
    ]);
    registrar({ req, medicoPhone, accion: "ver_embarazo", recurso: `Paciente:${paciente._id}` });
    res.json({ activo: conCalculo(activo), historial: historial.map(conCalculo) });
  }));

  // ─── INICIAR un embarazo nuevo ──────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/embarazo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const yaHayActivo = await Embarazo.findOne({ pacienteId: paciente._id, medicoPhone, activo: true });
    if (yaHayActivo) throw new ErrorHttp(400, "Esta paciente ya tiene un embarazo activo — finalizalo antes de abrir uno nuevo");

    const fum = new Date(req.body?.fum);
    if (Number.isNaN(fum.getTime())) throw new ErrorHttp(400, "Fecha de última menstruación inválida");
    if (fum.getTime() > Date.now()) throw new ErrorHttp(400, "La fecha de última menstruación no puede ser futura");

    // FPP: por defecto la regla de Naegele, pero el médico puede pasarla
    // directamente (ej: recalculada por una ecografía temprana).
    let fpp = fppPorNaegele(fum);
    if (req.body?.fpp) {
      const fppManual = new Date(req.body.fpp);
      if (!Number.isNaN(fppManual.getTime())) fpp = fppManual;
    }

    const embarazo = await Embarazo.create({
      pacienteId: paciente._id, medicoPhone, fum, fpp,
      notas: String(req.body?.notas || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "iniciar_embarazo", recurso: `Paciente:${paciente._id}` });
    res.json({ embarazo: conCalculo(embarazo) });
  }));

  // ─── EDITAR (FUM/FPP/notas del embarazo activo) ─────────────────────────
  app.patch("/medico/embarazo/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const embarazo = await obtenerOFallar(Embarazo, { _id: req.params.id, medicoPhone }, "Embarazo no encontrado");

    if (req.body?.fum) {
      const fum = new Date(req.body.fum);
      if (Number.isNaN(fum.getTime())) throw new ErrorHttp(400, "Fecha de última menstruación inválida");
      embarazo.fum = fum;
      if (!req.body?.fpp) embarazo.fpp = fppPorNaegele(fum); // si no la ajustan a mano en el mismo pedido, se recalcula sola
    }
    if (req.body?.fpp) {
      const fpp = new Date(req.body.fpp);
      if (Number.isNaN(fpp.getTime())) throw new ErrorHttp(400, "Fecha probable de parto inválida");
      embarazo.fpp = fpp;
    }
    if (req.body?.notas != null) embarazo.notas = String(req.body.notas).trim();
    await embarazo.save();

    registrar({ req, medicoPhone, accion: "editar_embarazo", recurso: `Paciente:${embarazo.pacienteId}` });
    res.json({ embarazo: conCalculo(embarazo) });
  }));

  // ─── FINALIZAR (parto, aborto, u otro desenlace) ────────────────────────
  app.post("/medico/embarazo/:id/finalizar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const embarazo = await obtenerOFallar(Embarazo, { _id: req.params.id, medicoPhone }, "Embarazo no encontrado");
    if (!embarazo.activo) throw new ErrorHttp(400, "Este embarazo ya está finalizado");

    const desenlace = String(req.body?.desenlace || "");
    if (!DESENLACES_EMBARAZO.includes(desenlace)) throw new ErrorHttp(400, "Desenlace inválido");

    embarazo.activo = false;
    embarazo.desenlace = desenlace;
    embarazo.fechaFin = req.body?.fechaFin ? new Date(req.body.fechaFin) : new Date();
    if (req.body?.notas != null) embarazo.notas = String(req.body.notas).trim();
    await embarazo.save();

    registrar({ req, medicoPhone, accion: "finalizar_embarazo", recurso: `Paciente:${embarazo.pacienteId}`, detalle: desenlace });
    res.json({ embarazo: conCalculo(embarazo) });
  }));

  // ─── BORRAR (para corregir una carga hecha por error) ───────────────────
  app.delete("/medico/embarazo/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const embarazo = await obtenerOFallar(Embarazo, { _id: req.params.id, medicoPhone }, "Embarazo no encontrado");
    await embarazo.deleteOne();
    registrar({ req, medicoPhone, accion: "borrar_embarazo", recurso: `Paciente:${embarazo.pacienteId}` });
    res.json({ ok: true });
  }));
};
