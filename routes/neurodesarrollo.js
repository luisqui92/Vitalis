// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — perfil, perfil sensorial, objetivos y vigilancia
// ═══════════════════════════════════════════════════════════════════════════
// Ver db/models.js para el porqué de la forma de estos datos. En resumen:
// acá el expediente no es un historial de enfermedad, es el mapa de una
// persona, y por eso no hay un campo "diagnóstico" con una etiqueta única.
const {
  Paciente, PerfilNeuro, ObjetivoNeuro, VigilanciaSalud,
  MODALIDADES_SENSORIALES, RESPUESTAS_SENSORIALES, AREAS_OBJETIVO, CONDICIONES_NEURO, FORMAS_COMUNICACION,
} = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { PLANTILLAS_VIGILANCIA, estadoVigilancia } = require("../services/vigilancia");

const requireMedico = requireAuth(["medico"]);

// El perfil se crea vacío la primera vez que alguien lo abre, con las ocho
// modalidades ya puestas en "sin_datos". Así el mapa sensorial se dibuja
// completo desde el primer día y se ve qué falta explorar, en vez de
// aparecer vacío y no dar ninguna pista de qué se espera cargar.
async function perfilDe(pacienteId, medicoPhone) {
  let perfil = await PerfilNeuro.findOne({ pacienteId, medicoPhone });
  if (!perfil) {
    perfil = await PerfilNeuro.create({
      pacienteId, medicoPhone,
      perfilSensorial: MODALIDADES_SENSORIALES.map(m => ({ modalidad: m, respuesta: "sin_datos" })),
    });
  } else if (perfil.perfilSensorial.length < MODALIDADES_SENSORIALES.length) {
    // Si en el futuro se agrega una modalidad, los perfiles viejos la
    // incorporan solos en vez de quedar a medias para siempre.
    const presentes = new Set(perfil.perfilSensorial.map(m => m.modalidad));
    for (const m of MODALIDADES_SENSORIALES) {
      if (!presentes.has(m)) perfil.perfilSensorial.push({ modalidad: m, respuesta: "sin_datos" });
    }
    await perfil.save();
  }
  return perfil;
}

function limpiarLista(v, max = 20) {
  if (!Array.isArray(v)) return undefined;
  return v.map(x => String(x).trim()).filter(Boolean).slice(0, max);
}

module.exports = function (app) {
  // ═══ PERFIL ══════════════════════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/neuro", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const perfil = await perfilDe(paciente._id, medicoPhone);
    res.json({ perfil, opciones: { CONDICIONES_NEURO, FORMAS_COMUNICACION, MODALIDADES_SENSORIALES, RESPUESTAS_SENSORIALES, AREAS_OBJETIVO } });
  }));

  app.patch("/medico/pacientes/:pacienteId/neuro", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const perfil = await perfilDe(paciente._id, medicoPhone);

    if (Array.isArray(req.body?.condiciones)) {
      perfil.condiciones = req.body.condiciones.filter(c => CONDICIONES_NEURO.includes(c));
    }
    if (req.body?.detalleCondicion !== undefined) perfil.detalleCondicion = String(req.body.detalleCondicion).trim();
    if (req.body?.comunicacion !== undefined) {
      perfil.comunicacion = FORMAS_COMUNICACION.includes(req.body.comunicacion) ? req.body.comunicacion : null;
    }
    if (req.body?.sistemaAumentativo !== undefined) perfil.sistemaAumentativo = String(req.body.sistemaAumentativo).trim();

    // Los niveles de apoyo son 1, 2 o 3 — o nada. Cualquier otra cosa se
    // guarda como "sin definir" en vez de inventar un nivel.
    for (const campo of ["apoyoComunicacionSocial", "apoyoConductasRestringidas"]) {
      if (req.body?.[campo] === undefined) continue;
      const n = Number(req.body[campo]);
      perfil[campo] = [1, 2, 3].includes(n) ? n : null;
    }

    const fortalezas = limpiarLista(req.body?.fortalezas);
    if (fortalezas) perfil.fortalezas = fortalezas;
    const intereses = limpiarLista(req.body?.intereses);
    if (intereses) perfil.intereses = intereses;

    perfil.perfilSugerido = false; // el profesional acaba de revisarlo
    await perfil.save();
    registrar({ req, medicoPhone, accion: "editar_perfil_neuro", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, perfil });
  }));

  // ═══ PERFIL SENSORIAL ════════════════════════════════════════════════════
  // Mismo patrón que el odontograma y el mapa ocular: se toca una zona, se
  // carga el hallazgo, y queda el historial con quién/cómo lo cargó.
  app.post("/medico/pacientes/:pacienteId/neuro/sensorial", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const modalidad = String(req.body?.modalidad || "").trim();
    const respuesta = String(req.body?.respuesta || "").trim();
    if (!MODALIDADES_SENSORIALES.includes(modalidad)) throw new ErrorHttp(400, "Modalidad sensorial desconocida");
    if (!RESPUESTAS_SENSORIALES.includes(respuesta)) throw new ErrorHttp(400, "Respuesta sensorial desconocida");

    const perfil = await perfilDe(paciente._id, medicoPhone);
    const item = perfil.perfilSensorial.find(m => m.modalidad === modalidad);
    if (!item) throw new ErrorHttp(500, "El perfil sensorial está incompleto");

    item.respuesta = respuesta;
    const desencadenantes = limpiarLista(req.body?.desencadenantes);
    if (desencadenantes) item.desencadenantes = desencadenantes;
    const estrategias = limpiarLista(req.body?.estrategias);
    if (estrategias) item.estrategias = estrategias;

    item.historial.push({
      fecha: new Date(),
      respuesta,
      notas: String(req.body?.notas || "").trim(),
      fuente: req.body?.fuente === "voz" ? "voz" : "manual",
      consultaId: req.body?.consultaId || null,
    });

    await perfil.save();
    registrar({ req, medicoPhone, accion: "editar_perfil_sensorial", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, perfil });
  }));

  // ═══ OBJETIVOS ═══════════════════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/neuro/objetivos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const objetivos = await ObjetivoNeuro.find({ pacienteId: paciente._id, medicoPhone }).sort({ estado: 1, createdAt: -1 }).lean();
    res.json({ objetivos });
  }));

  app.post("/medico/pacientes/:pacienteId/neuro/objetivos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const titulo = String(req.body?.titulo || "").trim();
    if (!titulo) throw new ErrorHttp(400, "El objetivo necesita un título");

    const objetivo = await ObjetivoNeuro.create({
      pacienteId: paciente._id, medicoPhone, titulo,
      area: AREAS_OBJETIVO.includes(req.body?.area) ? req.body.area : "comunicacion",
      criterio: String(req.body?.criterio || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "crear_objetivo_neuro", recurso: `ObjetivoNeuro:${objetivo._id}` });
    res.status(201).json({ ok: true, objetivo });
  }));

  // ─── REGISTRAR UNA SESIÓN DE TRABAJO SOBRE EL OBJETIVO ───────────────────
  app.post("/medico/neuro/objetivos/:id/progreso", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const objetivo = await obtenerOFallar(ObjetivoNeuro, { _id: req.params.id, medicoPhone }, "Objetivo no encontrado");

    const intentos = Number(req.body?.intentos);
    const logros = Number(req.body?.logros);
    if (!Number.isFinite(intentos) || intentos <= 0) throw new ErrorHttp(400, "Poné cuántas veces se intentó");
    if (!Number.isFinite(logros) || logros < 0) throw new ErrorHttp(400, "Poné cuántas veces salió");
    // Más logros que intentos es un error de tipeo, y si se guarda deja una
    // curva por encima del 100% que después nadie entiende.
    if (logros > intentos) throw new ErrorHttp(400, "No puede haber más logros que intentos");

    const AYUDAS = ["independiente", "verbal", "gestual", "fisica_parcial", "fisica_total"];
    objetivo.progreso.push({
      fecha: req.body?.fecha ? new Date(req.body.fecha) : new Date(),
      logros, intentos,
      ayuda: AYUDAS.includes(req.body?.ayuda) ? req.body.ayuda : "independiente",
      notas: String(req.body?.notas || "").trim(),
      profesional: String(req.body?.profesional || "").trim(),
    });
    await objetivo.save();
    registrar({ req, medicoPhone, accion: "progreso_objetivo_neuro", recurso: `ObjetivoNeuro:${objetivo._id}` });
    res.json({ ok: true, objetivo });
  }));

  app.patch("/medico/neuro/objetivos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const objetivo = await obtenerOFallar(ObjetivoNeuro, { _id: req.params.id, medicoPhone }, "Objetivo no encontrado");
    if (["activo", "logrado", "suspendido"].includes(req.body?.estado)) {
      objetivo.estado = req.body.estado;
      objetivo.fechaCierre = req.body.estado === "activo" ? null : new Date();
    }
    if (req.body?.titulo !== undefined) objetivo.titulo = String(req.body.titulo).trim() || objetivo.titulo;
    if (req.body?.criterio !== undefined) objetivo.criterio = String(req.body.criterio).trim();
    await objetivo.save();
    res.json({ ok: true, objetivo });
  }));

  app.delete("/medico/neuro/objetivos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const borrado = await ObjetivoNeuro.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!borrado) throw new ErrorHttp(404, "Objetivo no encontrado");
    registrar({ req, medicoPhone, accion: "borrar_objetivo_neuro", recurso: `ObjetivoNeuro:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ═══ VIGILANCIA DE SALUD ═════════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/neuro/vigilancia", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const items = await VigilanciaSalud.find({ pacienteId: paciente._id, medicoPhone }).sort({ desdeMeses: 1 }).lean();

    // La edad se calcula acá y no en el navegador para que el estado
    // ("atrasado", "al día") sea el mismo mirándolo desde donde sea.
    const edadMeses = paciente.fechaNacimiento
      ? (Date.now() - new Date(paciente.fechaNacimiento).getTime()) / (30.4375 * 86400000)
      : null;

    res.json({
      edadMeses,
      plantillas: Object.entries(PLANTILLAS_VIGILANCIA).map(([id, p]) => ({ id, nombre: p.nombre, cuantos: p.items.length })),
      items: items.map(i => ({ ...i, ...(edadMeses == null ? { estado: "sin_edad" } : estadoVigilancia(i, edadMeses)) })),
    });
  }));

  // ─── CARGAR UNA PLANTILLA ────────────────────────────────────────────────
  // No pisa lo que ya haya: si el ítem existe por nombre, se saltea. Así
  // volver a cargar la plantilla no borra los controles ya registrados ni
  // duplica la lista.
  app.post("/medico/pacientes/:pacienteId/neuro/vigilancia/plantilla", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const plantilla = PLANTILLAS_VIGILANCIA[String(req.body?.plantilla || "")];
    if (!plantilla) throw new ErrorHttp(400, "Plantilla desconocida");

    const existentes = new Set((await VigilanciaSalud.find({ pacienteId: paciente._id, medicoPhone }).lean()).map(i => i.nombre));
    const nuevos = plantilla.items
      .filter(i => !existentes.has(i.nombre))
      .map(i => ({ ...i, pacienteId: paciente._id, medicoPhone }));
    if (nuevos.length) await VigilanciaSalud.insertMany(nuevos);

    registrar({ req, medicoPhone, accion: "cargar_plantilla_vigilancia", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true, agregados: nuevos.length, yaEstaban: plantilla.items.length - nuevos.length });
  }));

  app.post("/medico/pacientes/:pacienteId/neuro/vigilancia", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "El control necesita un nombre");
    const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
    const item = await VigilanciaSalud.create({
      pacienteId: paciente._id, medicoPhone, nombre,
      categoria: String(req.body?.categoria || "").trim(),
      desdeMeses: Math.max(0, num(req.body?.desdeMeses, 0)),
      hastaMeses: req.body?.hastaMeses === "" || req.body?.hastaMeses == null ? null : num(req.body.hastaMeses, null),
      cadaMeses: req.body?.cadaMeses === "" || req.body?.cadaMeses == null ? null : num(req.body.cadaMeses, null),
      nota: String(req.body?.nota || "").trim(),
    });
    res.status(201).json({ ok: true, item });
  }));

  app.post("/medico/neuro/vigilancia/:id/realizado", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(VigilanciaSalud, { _id: req.params.id, medicoPhone }, "Control no encontrado");
    item.realizados.push({
      fecha: req.body?.fecha ? new Date(req.body.fecha) : new Date(),
      resultado: String(req.body?.resultado || "").trim(),
      estudioId: req.body?.estudioId || null,
    });
    await item.save();
    registrar({ req, medicoPhone, accion: "registrar_vigilancia", recurso: `VigilanciaSalud:${item._id}` });
    res.json({ ok: true, item });
  }));

  app.delete("/medico/neuro/vigilancia/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const borrado = await VigilanciaSalud.findOneAndDelete({ _id: req.params.id, medicoPhone });
    if (!borrado) throw new ErrorHttp(404, "Control no encontrado");
    res.json({ ok: true });
  }));
};
