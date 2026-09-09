// ═══════════════════════════════════════════════════════════════════════════
// Instrumentos aplicados — ADOS-2, ADI-R, Vineland, WISC y compañía
// ═══════════════════════════════════════════════════════════════════════════
// El diagnóstico de TEA no sale de una charla: sale de instrumentos
// estandarizados. Hoy sus resultados viven en un PDF adjunto o en una frase
// suelta de la evolución, y cuando hay que reaplicar a los dos años nadie
// encuentra con qué módulo se hizo la vez anterior.
//
// LA LÍNEA QUE NO SE CRUZA: acá se registra el RESULTADO, nunca el
// instrumento. El ADOS-2 es propiedad de WPS —ítems, hojas de codificación,
// algoritmo y tablas de conversión— y exige calificación y entrenamiento
// formal para administrarlo. Ponerlo adentro de Symphomed sería una
// infracción de copyright, y algo peor: invitaría a que alguien sin
// entrenamiento lo "aplique" leyendo una pantalla, que es exactamente el
// modo en que un instrumento bueno da un resultado malo.
//
// El profesional lo aplica con sus materiales y su licencia; Symphomed anota
// qué hizo y qué le dio, igual que anota una glucemia sin ser el
// laboratorio.
const { Paciente, InstrumentoAplicado, INSTRUMENTOS_NEURO, Estudio } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { avisarCambio } = require("../services/realtime");

const requireMedico = requireAuth(["medico"]);

function limpiarPuntajes(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map(p => ({
      nombre: String(p?.nombre || "").trim().slice(0, 80),
      valor: String(p?.valor ?? "").trim().slice(0, 40),
    }))
    .filter(p => p.nombre && p.valor)
    .slice(0, 20);
}

module.exports = function (app) {
  // El catálogo es solo ayuda para la pantalla: nombres de instrumentos y de
  // los puntajes que devuelven. Nombrar un instrumento y decir qué campos
  // arroja está publicado en toda la literatura — no son los ítems, ni el
  // algoritmo, ni los puntos de corte.
  app.get("/medico/instrumentos/catalogo", limitMedico, requireMedico, (_req, res) => {
    res.json({ instrumentos: INSTRUMENTOS_NEURO });
  });

  app.get("/medico/pacientes/:pacienteId/instrumentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const aplicados = await InstrumentoAplicado.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: -1 }).lean();
    res.json({ aplicados });
  }));

  app.post("/medico/pacientes/:pacienteId/instrumentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const instrumento = String(req.body?.instrumento || "").trim();
    if (!instrumento) throw new ErrorHttp(400, "¿Qué instrumento se aplicó?");
    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    if (isNaN(fecha.getTime())) throw new ErrorHttp(400, "La fecha no es válida");
    // Un instrumento aplicado en el futuro es un error de tipeo, y si se
    // guarda desordena la línea de tiempo del paciente para siempre.
    if (fecha.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new ErrorHttp(400, "La fecha está en el futuro");

    // Si viene enganchado un PDF, tiene que ser un estudio de ESTE paciente:
    // sin este control se podría colgar el informe de otro.
    let estudioId = null;
    if (req.body?.estudioId) {
      const est = await Estudio.findOne({ _id: req.body.estudioId, pacienteId: paciente._id, medicoPhone }).select("_id").lean();
      if (!est) throw new ErrorHttp(400, "Ese archivo no es de este paciente");
      estudioId = est._id;
    }

    const aplicado = await InstrumentoAplicado.create({
      pacienteId: paciente._id, medicoPhone,
      instrumento: instrumento.slice(0, 80),
      version: String(req.body?.version || "").trim().slice(0, 40),
      modulo: String(req.body?.modulo || "").trim().slice(0, 40),
      fecha,
      aplicadoPor: String(req.body?.aplicadoPor || "").trim().slice(0, 120),
      matricula: String(req.body?.matricula || "").trim().slice(0, 40),
      puntajes: limpiarPuntajes(req.body?.puntajes),
      clasificacion: String(req.body?.clasificacion || "").trim().slice(0, 200),
      interpretacion: String(req.body?.interpretacion || "").trim().slice(0, 4000),
      estudioId,
    });

    registrar({ req, medicoPhone, accion: "registrar_instrumento", recurso: `InstrumentoAplicado:${aplicado._id}` });
    avisarCambio(medicoPhone);
    res.status(201).json({ ok: true, aplicado });
  }));

  app.patch("/medico/instrumentos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const aplicado = await obtenerOFallar(InstrumentoAplicado, { _id: req.params.id, medicoPhone }, "Registro no encontrado");

    for (const [campo, max] of [["instrumento", 80], ["version", 40], ["modulo", 40], ["aplicadoPor", 120], ["matricula", 40], ["clasificacion", 200], ["interpretacion", 4000]]) {
      if (req.body?.[campo] !== undefined) aplicado[campo] = String(req.body[campo]).trim().slice(0, max);
    }
    if (req.body?.fecha) {
      const f = new Date(req.body.fecha);
      if (!isNaN(f.getTime())) aplicado.fecha = f;
    }
    if (req.body?.puntajes !== undefined) aplicado.puntajes = limpiarPuntajes(req.body.puntajes);

    await aplicado.save();
    avisarCambio(medicoPhone);
    res.json({ ok: true, aplicado });
  }));

  app.delete("/medico/instrumentos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const aplicado = await obtenerOFallar(InstrumentoAplicado, { _id: req.params.id, medicoPhone }, "Registro no encontrado");
    await InstrumentoAplicado.deleteOne({ _id: aplicado._id });
    registrar({ req, medicoPhone, accion: "borrar_instrumento", recurso: `InstrumentoAplicado:${req.params.id}` });
    avisarCambio(medicoPhone);
    res.json({ ok: true });
  }));
};
