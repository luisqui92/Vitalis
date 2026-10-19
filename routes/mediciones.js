// ChatGo Salud — Evolución Clínica: signos vitales/indicadores (presión,
// glucosa, peso, saturación, etc.) para graficar tendencias del paciente.
const { Paciente, Medicion } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar, fechaCivilValida } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { TIPOS_MEDICION } = require("../services/medicionesTipos");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── AGREGAR MEDICIÓN ────────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/mediciones", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const tipo = String(req.body?.tipo || "").trim();
    const valor = Number(req.body?.valor);
    if (!tipo || Number.isNaN(valor) || !req.body?.fecha) throw new ErrorHttp(400, "tipo, valor y fecha son requeridos");
    // El día del <input type="date">, que exista ("no-es-fecha" daba 500, y
    // el 30 de febrero se guardaba como 2 de marzo).
    const fecha = fechaCivilValida(req.body.fecha);
    // Un día de margen, como en Ganadería: a las once de la noche en Bolivia
    // ya es mañana en UTC.
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (fecha.toISOString().slice(0, 10) > manana) throw new ErrorHttp(400, "La fecha de la medición no puede ser futura");

    // Solo los tipos que conoce la pantalla (services/medicionesTipos.js):
    // con texto libre entraba cualquier cosa como si fuera un control.
    const meta = TIPOS_MEDICION[tipo];
    if (!meta) throw new ErrorHttp(400, "Tipo de medición desconocido");
    const [min, max] = meta.rango;
    if (!Number.isFinite(valor) || valor < min || valor > max) {
      throw new ErrorHttp(400, `El valor tiene que estar entre ${min} y ${max}${meta.unidad ? " " + meta.unidad : ""}`);
    }

    let valorSecundario = req.body?.valorSecundario !== undefined && req.body?.valorSecundario !== null
      ? Number(req.body.valorSecundario) : null;
    if (valorSecundario !== null && Number.isNaN(valorSecundario)) throw new ErrorHttp(400, "valorSecundario inválido");
    if (meta.doble) {
      // La presión sin diastólica, o con la diastólica arriba de la
      // sistólica (80/120), es un dato dado vuelta, no una presión.
      const [dMin, dMax] = meta.rangoSecundario;
      if (valorSecundario === null || !Number.isFinite(valorSecundario) || valorSecundario < dMin || valorSecundario > dMax) {
        throw new ErrorHttp(400, `La diastólica tiene que estar entre ${dMin} y ${dMax} ${meta.unidad}`);
      }
      if (valorSecundario >= valor) throw new ErrorHttp(400, "La diastólica tiene que ser menor que la sistólica");
    } else {
      // Un segundo número en un control de un solo número se escribiría
      // «70/5 kg» en el Kardex.
      valorSecundario = null;
    }

    const medicion = await Medicion.create({
      pacienteId: paciente._id,
      medicoPhone,
      tipo,
      valor,
      valorSecundario,
      fecha,
      notas: String(req.body?.notas || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "crear_medicion", recurso: `Medicion:${medicion._id}` });
    res.status(201).json({ ok: true, medicion });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/mediciones/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await Medicion.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "Medición no encontrada");
    registrar({ req, medicoPhone, accion: "borrar_medicion", recurso: `Medicion:${req.params.id}` });
    res.json({ ok: true });
  }));
};
