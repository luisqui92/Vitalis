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
const { Paciente, InstrumentoAplicado, INSTRUMENTOS_NEURO, CALIFICACIONES_INSTRUMENTO, Estudio } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { avisarCambio } = require("../services/realtime");
const { fichaNeuroOFallar, objetoNeuroOFallar } = require("../services/equipoNeuro");

const requireMedico = requireAuth(["medico"]);

// Qué calificación pide el instrumento que se está cargando. El nombre llega
// como texto libre —hay una opción "Otro" y hay quien escribe "WISC V" sin
// guion— así que se normaliza antes de buscarlo. Lo que no se reconoce cae
// en "profesional", que es el criterio prudente y no el cómodo.
const normalizar = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]/g, "");

function calificacionDe(nombreInstrumento) {
  const buscado = normalizar(nombreInstrumento);
  const enCatalogo = INSTRUMENTOS_NEURO.find(i => normalizar(i.nombre) === buscado);
  return enCatalogo?.quienPuede || "profesional";
}

// ═══ LA ÚNICA REGLA QUE SYMPHOMED PUEDE HACER CUMPLIR DE VERDAD ════════════
//
// Symphomed NO puede verificar una certificación: no hay registro público
// de quién tiene el curso de ADOS-2, y fingir que sí lo verifica sería peor
// que no controlar nada, porque le daría al centro una garantía falsa.
//
// Lo que sí puede hacer, y hace acá: no dejar que un instrumento de nivel C
// quede registrado SIN EL NOMBRE Y LA MATRÍCULA de quien lo aplicó. No
// habilita ni deshabilita a nadie —eso no le corresponde— pero convierte
// "alguien cargó un ADOS-2" en "lo aplicó tal persona, con tal matrícula,
// tal día". Que es exactamente lo que hay que poder contestar si algún día
// alguien pregunta, y lo que hoy no quedaba registrado en ningún lado.
function exigirFirmaSiCorresponde(nivel, aplicadoPor, matricula) {
  if (nivel !== "certificado") return;
  if (!aplicadoPor || !matricula) {
    throw new ErrorHttp(400,
      "Este instrumento exige la calificación que pide su editor. Symphomed no verifica credenciales, " +
      "pero no guarda el resultado sin el nombre y la matrícula de quien lo aplicó. " +
      "Si lo hizo una evaluadora externa, poné sus datos.");
  }
}

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
    // Va también la tabla de calificaciones: la pantalla tiene que poder
    // decir, ANTES de que el profesional empiece a cargar, qué pide el
    // instrumento que eligió. Enterarse al apretar "Guardar" sería tarde.
    res.json({ instrumentos: INSTRUMENTOS_NEURO, calificaciones: CALIFICACIONES_INSTRUMENTO });
  });

  app.get("/medico/pacientes/:pacienteId/instrumentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    // Si el chico tiene equipo tratante, la ficha es la titular y no la de
    // quien pregunta. Ver services/equipoNeuro.js.
    const { pacienteId, medicoPhone } = await fichaNeuroOFallar(req, req.params.pacienteId);
    const paciente = { _id: pacienteId };
    const aplicados = await InstrumentoAplicado.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: -1 }).lean();
    res.json({ aplicados });
  }));

  app.post("/medico/pacientes/:pacienteId/instrumentos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    // Si el chico tiene equipo tratante, la ficha es la titular y no la de
    // quien pregunta. Ver services/equipoNeuro.js.
    const { pacienteId, medicoPhone } = await fichaNeuroOFallar(req, req.params.pacienteId);
    const paciente = { _id: pacienteId };

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

    const aplicadoPor = String(req.body?.aplicadoPor || "").trim().slice(0, 120);
    const matricula = String(req.body?.matricula || "").trim().slice(0, 40);
    const quienPuede = calificacionDe(instrumento);
    exigirFirmaSiCorresponde(quienPuede, aplicadoPor, matricula);

    const aplicado = await InstrumentoAplicado.create({
      pacienteId: paciente._id, medicoPhone,
      instrumento: instrumento.slice(0, 80),
      version: String(req.body?.version || "").trim().slice(0, 40),
      modulo: String(req.body?.modulo || "").trim().slice(0, 40),
      fecha,
      aplicadoPor, matricula, quienPuede,
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
    const aplicado = await objetoNeuroOFallar(req, InstrumentoAplicado, req.params.id, "Registro no encontrado");

    for (const [campo, max] of [["instrumento", 80], ["version", 40], ["modulo", 40], ["aplicadoPor", 120], ["matricula", 40], ["clasificacion", 200], ["interpretacion", 4000]]) {
      if (req.body?.[campo] !== undefined) aplicado[campo] = String(req.body[campo]).trim().slice(0, max);
    }
    if (req.body?.fecha) {
      const f = new Date(req.body.fecha);
      if (!isNaN(f.getTime())) aplicado.fecha = f;
    }
    if (req.body?.puntajes !== undefined) aplicado.puntajes = limpiarPuntajes(req.body.puntajes);

    // La misma regla que al crear, porque si no la edición sería la puerta
    // de atrás: guardar el ADOS-2 con la firma puesta y después vaciarla de
    // un PATCH. Se recalcula el nivel además, por si lo que cambió fue el
    // nombre del instrumento.
    aplicado.quienPuede = calificacionDe(aplicado.instrumento);
    exigirFirmaSiCorresponde(aplicado.quienPuede, aplicado.aplicadoPor, aplicado.matricula);

    await aplicado.save();
    avisarCambio(medicoPhone);
    res.json({ ok: true, aplicado });
  }));

  app.delete("/medico/instrumentos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const aplicado = await objetoNeuroOFallar(req, InstrumentoAplicado, req.params.id, "Registro no encontrado");
    await InstrumentoAplicado.deleteOne({ _id: aplicado._id });
    registrar({ req, medicoPhone, accion: "borrar_instrumento", recurso: `InstrumentoAplicado:${req.params.id}` });
    avisarCambio(medicoPhone);
    res.json({ ok: true });
  }));
};
