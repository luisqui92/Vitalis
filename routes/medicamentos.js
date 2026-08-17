// ChatGo Salud — Gestión de Medicación: lista de medicamentos activos/pasados
// de cada paciente. Carga manual del médico.
const { Paciente, Medicamento } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── AGREGAR MEDICAMENTO ────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/medicamentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");

    const medicamento = await Medicamento.create({
      pacienteId: paciente._id,
      medicoPhone,
      nombre,
      dosis: String(req.body?.dosis || "").trim(),
      frecuencia: String(req.body?.frecuencia || "").trim(),
      fechaInicio: req.body?.fechaInicio ? new Date(req.body.fechaInicio) : null,
      fechaFin: req.body?.fechaFin ? new Date(req.body.fechaFin) : null,
      notas: String(req.body?.notas || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "crear_medicamento", recurso: `Medicamento:${medicamento._id}` });
    res.status(201).json({ ok: true, medicamento });
  }));

  // ─── EDITAR (ej. dar de baja poniendo fechaFin) ────────────────────────
  app.patch("/medico/medicamentos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const medicamento = await obtenerOFallar(Medicamento, { _id: req.params.id, medicoPhone }, "Medicamento no encontrado");

    const campos = ["nombre", "dosis", "frecuencia", "notas"];
    for (const campo of campos) {
      if (req.body?.[campo] !== undefined) medicamento[campo] = String(req.body[campo]).trim();
    }
    if (req.body?.fechaInicio !== undefined) medicamento.fechaInicio = req.body.fechaInicio ? new Date(req.body.fechaInicio) : null;
    if (req.body?.fechaFin !== undefined) medicamento.fechaFin = req.body.fechaFin ? new Date(req.body.fechaFin) : null;

    await medicamento.save();
    registrar({ req, medicoPhone, accion: "editar_medicamento", recurso: `Medicamento:${medicamento._id}` });
    res.json({ ok: true, medicamento });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/medicamentos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await Medicamento.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "Medicamento no encontrado");
    registrar({ req, medicoPhone, accion: "borrar_medicamento", recurso: `Medicamento:${req.params.id}` });
    res.json({ ok: true });
  }));
};
