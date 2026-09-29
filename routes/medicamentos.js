// ChatGo Salud — Gestión de Medicación: lista de medicamentos activos/pasados
// de cada paciente. Carga manual del médico.
const { Paciente, Medicamento } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { recalcularRecordatorio } = require("../services/recordatorioMedicamento");
const { olvidar: olvidarVocabulario } = require("../services/vocabularioMedico");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── AGREGAR MEDICAMENTO ────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/medicamentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    const frecuencia = String(req.body?.frecuencia || "").trim();

    const medicamento = new Medicamento({
      pacienteId: paciente._id,
      medicoPhone,
      nombre,
      dosis: String(req.body?.dosis || "").trim(),
      frecuencia,
      fechaInicio: req.body?.fechaInicio ? new Date(req.body.fechaInicio) : null,
      fechaFin: req.body?.fechaFin ? new Date(req.body.fechaFin) : null,
      notas: String(req.body?.notas || "").trim(),
    });
    // Ver services/recordatorioMedicamento.js: si "cada 3 días" (o
    // equivalente) se entiende con confianza Y el paciente tiene teléfono,
    // el recordatorio automático al paciente arranca solo, sin que el
    // médico tenga que tocar nada aparte.
    recalcularRecordatorio(medicamento, frecuencia, Boolean(paciente.telefono));
    await medicamento.save();
    // Lo que el médico carga a mano es vocabulario suyo desde ya: la
    // próxima consulta lo transcribe y lo reconoce (services/vocabularioMedico.js).
    olvidarVocabulario(medicoPhone);
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

    // Solo se recalcula si tocaron la frecuencia — así una edición de otro
    // campo (una nota, la dosis) no reinicia el conteo de veces enviadas.
    // "recordatorioActivo" es la única forma de apagarlo a mano: si el
    // médico ve que la detección se equivocó, no depende de reescribir la
    // frecuencia para que se corrija sola.
    if (req.body?.frecuencia !== undefined) {
      const paciente = await Paciente.findById(medicamento.pacienteId).select("telefono").lean();
      recalcularRecordatorio(medicamento, medicamento.frecuencia, Boolean(paciente?.telefono));
    }
    if (req.body?.recordatorioActivo !== undefined && medicamento.recordatorio?.intervaloDias) {
      medicamento.recordatorio.activo = Boolean(req.body.recordatorioActivo);
    }

    await medicamento.save();
    if (req.body?.nombre !== undefined) olvidarVocabulario(medicoPhone);
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
