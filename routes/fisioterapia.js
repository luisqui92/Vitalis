// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Fisioterapia — evaluación, mapa de dolor, movilidad y objetivos
// ═══════════════════════════════════════════════════════════════════════════
// Ver db/models.js para el porqué de la forma de estos datos. En resumen:
// la evaluación es UNA por paciente y se edita; las mediciones de dolor y
// goniometría son SERIE DE TIEMPO y viven en colección aparte; los objetivos
// se miden sesión a sesión y lo que se busca bajar es la ayuda, no subir el
// porcentaje.
//
// A diferencia de Neurodesarrollo, acá NO hay ficha compartida de equipo: un
// kinesiólogo trabaja sobre su propia ficha, como el resto de Symphomed. Si
// algún día un centro de rehabilitación necesita el modelo de equipo, la
// regla ya está escrita en services/equipoNeuro.js y se extiende ahí —no se
// copia acá.
const {
  Paciente, EvaluacionFisio, MedicionFisio, ObjetivoFisio,
  REGIONES_CUERPO, LADOS_FISIO, TIPOS_DOLOR, BANDERAS_ROJAS, ARTICULACIONES_ROM, AREAS_OBJETIVO_FISIO,
} = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

const requireMedico = requireAuth(["medico"]);

// Cuántas mediciones se devuelven por clase. Un tratamiento de rehabilitación
// son treinta o cuarenta sesiones; 200 cubre varios episodios y evita que la
// pantalla de un paciente de años se traiga una serie interminable para
// dibujar un gráfico de diez puntos.
const TOPE_MEDICIONES = 200;

// Tope de puntos en el mapa. La anatomía ya lo acota —nadie marca cincuenta—
// pero sin límite explícito un script mal escrito puede inflar el documento.
const TOPE_PUNTOS_DOLOR = 40;

// Índice rápido de los rangos de referencia, para validar sin recorrer.
const ROM_POR_ARTICULACION = new Map(
  ARTICULACIONES_ROM.map(a => [a.articulacion, new Set(a.movimientos.map(m => m.clave))])
);

// La evaluación se crea vacía la primera vez que alguien abre la pestaña.
// Mismo criterio que el perfil de neuro: que la pantalla se dibuje completa
// desde el primer día en vez de aparecer en blanco sin dar ninguna pista de
// qué se espera cargar.
async function evaluacionDe(pacienteId, medicoPhone) {
  let ev = await EvaluacionFisio.findOne({ pacienteId, medicoPhone });
  if (!ev) ev = await EvaluacionFisio.create({ pacienteId, medicoPhone, puntosDolor: [] });
  return ev;
}

// El paciente tiene que ser del médico que pregunta. Se resuelve en una sola
// función para que ninguna ruta se olvide del medicoPhone y termine
// devolviendo la ficha de otro.
async function pacienteDelMedico(req) {
  const medicoPhone = req.adminUser.usuario;
  const paciente = await obtenerOFallar(
    Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado"
  );
  return { paciente, medicoPhone };
}

// Un objeto que se alcanza por su propio id (una medición, un objetivo) tiene
// que seguir siendo del médico que pregunta. 404 y no 403: un 403 confirma
// que el objeto existe, y eso ya es contar algo de un paciente ajeno.
async function objetoDelMedico(req, Modelo, id, mensaje) {
  const medicoPhone = req.adminUser.usuario;
  const doc = await Modelo.findOne({ _id: id, medicoPhone });
  if (!doc) throw new ErrorHttp(404, mensaje);
  return doc;
}

function numeroEnRango(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

module.exports = function (app) {
  // ═══ EVALUACIÓN ══════════════════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/fisio", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const evaluacion = await evaluacionDe(paciente._id, medicoPhone);
    res.json({
      evaluacion,
      opciones: { REGIONES_CUERPO, LADOS_FISIO, TIPOS_DOLOR, BANDERAS_ROJAS, ARTICULACIONES_ROM, AREAS_OBJETIVO_FISIO },
    });
  }));

  app.patch("/medico/pacientes/:pacienteId/fisio", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const ev = await evaluacionDe(paciente._id, medicoPhone);

    for (const campo of ["motivo", "mecanismo", "notas"]) {
      if (req.body?.[campo] !== undefined) ev[campo] = String(req.body[campo]).trim().slice(0, 2000);
    }
    if (req.body?.desde !== undefined) {
      ev.desde = req.body.desde ? new Date(req.body.desde) : null;
    }
    // Solo banderas conocidas. Una bandera inventada que llegue desde el
    // cliente se descarta en silencio: el campo existe para contarse y
    // mostrarse en rojo, y una clave que la pantalla no sabe dibujar sería
    // una alerta invisible.
    if (Array.isArray(req.body?.banderasRojas)) {
      ev.banderasRojas = [...new Set(req.body.banderasRojas.filter(b => BANDERAS_ROJAS.includes(b)))];
    }
    await ev.save();
    registrar({ req, medicoPhone, accion: "editar_evaluacion_fisio", recurso: `EvaluacionFisio:${ev._id}` });
    res.json({ ok: true, evaluacion: ev });
  }));

  // ─── MAPA DE DOLOR: marcar un punto sobre la silueta ─────────────────────
  app.post("/medico/pacientes/:pacienteId/fisio/dolor", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const ev = await evaluacionDe(paciente._id, medicoPhone);

    if (ev.puntosDolor.length >= TOPE_PUNTOS_DOLOR) {
      throw new ErrorHttp(400, `No se pueden marcar más de ${TOPE_PUNTOS_DOLOR} puntos`);
    }
    const intensidad = numeroEnRango(req.body?.intensidad, 0, 10);
    if (intensidad === null) throw new ErrorHttp(400, "La intensidad del dolor va de 0 a 10");

    ev.puntosDolor.push({
      region: REGIONES_CUERPO.includes(req.body?.region) ? req.body.region : "otra",
      lado: LADOS_FISIO.includes(req.body?.lado) ? req.body.lado : "central",
      vista: req.body?.vista === "espalda" ? "espalda" : "frente",
      x: numeroEnRango(req.body?.x, 0, 100) ?? 50,
      y: numeroEnRango(req.body?.y, 0, 100) ?? 50,
      intensidad,
      tipo: TIPOS_DOLOR.includes(req.body?.tipo) ? req.body.tipo : "sin_clasificar",
      notas: String(req.body?.notas || "").trim().slice(0, 500),
    });
    await ev.save();

    // El punto marcado también arranca la serie de tiempo. Se hace acá y no
    // en dos pedidos desde el navegador porque si el segundo falla queda un
    // dolor marcado que no aparece en ningún gráfico, y nadie se entera.
    await MedicionFisio.create({
      pacienteId: paciente._id, medicoPhone,
      clase: "dolor",
      zona: ev.puntosDolor[ev.puntosDolor.length - 1].region,
      lado: ev.puntosDolor[ev.puntosDolor.length - 1].lado,
      valor: intensidad,
      fecha: new Date(),
    });

    registrar({ req, medicoPhone, accion: "marcar_dolor_fisio", recurso: `EvaluacionFisio:${ev._id}` });
    res.status(201).json({ ok: true, evaluacion: ev });
  }));

  app.delete("/medico/pacientes/:pacienteId/fisio/dolor/:indice", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const ev = await evaluacionDe(paciente._id, medicoPhone);

    const i = Number(req.params.indice);
    if (!Number.isInteger(i) || i < 0 || i >= ev.puntosDolor.length) {
      throw new ErrorHttp(404, "Ese punto no existe");
    }
    ev.puntosDolor.splice(i, 1);
    await ev.save();
    // Las mediciones históricas NO se borran: el punto se saca del mapa de
    // hoy, pero que el paciente haya tenido dolor 8 hace tres semanas sigue
    // siendo cierto y es justo lo que muestra que mejoró.
    res.json({ ok: true, evaluacion: ev });
  }));

  // ═══ MEDICIONES (dolor y goniometría) ════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/fisio/mediciones", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const clase = req.query.clase === "goniometria" ? "goniometria" : req.query.clase === "dolor" ? "dolor" : null;

    const filtro = { pacienteId: paciente._id, medicoPhone };
    if (clase) filtro.clase = clase;

    const mediciones = await MedicionFisio.find(filtro)
      .sort({ fecha: -1 })
      .limit(TOPE_MEDICIONES)
      .lean();
    res.json({ mediciones, tope: TOPE_MEDICIONES });
  }));

  app.post("/medico/pacientes/:pacienteId/fisio/mediciones", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const clase = req.body?.clase === "goniometria" ? "goniometria" : "dolor";
    const zona = String(req.body?.zona || "").trim();

    // Cada clase valida contra su propia lista. Sin esto se puede guardar
    // "flexión de sacroilíaca", que después aparece en el gráfico como un
    // movimiento que no existe y nadie sabe de dónde salió.
    let movimiento = "";
    let valor;
    if (clase === "goniometria") {
      const movimientos = ROM_POR_ARTICULACION.get(zona);
      if (!movimientos) throw new ErrorHttp(400, "Esa articulación no está en la lista");
      movimiento = String(req.body?.movimiento || "").trim();
      if (!movimientos.has(movimiento)) throw new ErrorHttp(400, "Ese movimiento no corresponde a esa articulación");
      // Hasta 180°: más que eso es un error de tipeo, y un solo punto
      // disparatado arruina la escala de todo el gráfico.
      valor = numeroEnRango(req.body?.valor, 0, 180);
      if (valor === null) throw new ErrorHttp(400, "Los grados van de 0 a 180");
    } else {
      if (!REGIONES_CUERPO.includes(zona)) throw new ErrorHttp(400, "Esa región del cuerpo no está en la lista");
      valor = numeroEnRango(req.body?.valor, 0, 10);
      if (valor === null) throw new ErrorHttp(400, "El dolor va de 0 a 10");
    }

    const medicion = await MedicionFisio.create({
      pacienteId: paciente._id, medicoPhone, clase, zona, movimiento,
      lado: LADOS_FISIO.includes(req.body?.lado) ? req.body.lado : "central",
      valor,
      fecha: req.body?.fecha ? new Date(req.body.fecha) : new Date(),
      notas: String(req.body?.notas || "").trim().slice(0, 500),
    });
    registrar({ req, medicoPhone, accion: "medicion_fisio", recurso: `MedicionFisio:${medicion._id}` });
    res.status(201).json({ ok: true, medicion });
  }));

  app.delete("/medico/fisio/mediciones/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const doc = await objetoDelMedico(req, MedicionFisio, req.params.id, "Esa medición no existe");
    await MedicionFisio.deleteOne({ _id: doc._id });
    registrar({ req, medicoPhone, accion: "borrar_medicion_fisio", recurso: `MedicionFisio:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ═══ OBJETIVOS FUNCIONALES ═══════════════════════════════════════════════
  app.get("/medico/pacientes/:pacienteId/fisio/objetivos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    // Activos primero: "activo" < "logrado" < "suspendido" alfabéticamente,
    // que por casualidad es el orden en que le sirven al profesional.
    const objetivos = await ObjetivoFisio.find({ pacienteId: paciente._id, medicoPhone })
      .sort({ estado: 1, createdAt: -1 })
      .limit(TOPE_MEDICIONES)
      .lean();
    res.json({ objetivos, opciones: { AREAS_OBJETIVO_FISIO } });
  }));

  app.post("/medico/pacientes/:pacienteId/fisio/objetivos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const { paciente, medicoPhone } = await pacienteDelMedico(req);
    const titulo = String(req.body?.titulo || "").trim();
    if (!titulo) throw new ErrorHttp(400, "El objetivo necesita un título");

    const objetivo = await ObjetivoFisio.create({
      pacienteId: paciente._id, medicoPhone, titulo,
      area: AREAS_OBJETIVO_FISIO.includes(req.body?.area) ? req.body.area : "movilidad",
      criterio: String(req.body?.criterio || "").trim().slice(0, 1000),
    });
    registrar({ req, medicoPhone, accion: "crear_objetivo_fisio", recurso: `ObjetivoFisio:${objetivo._id}` });
    res.status(201).json({ ok: true, objetivo });
  }));

  // ─── REGISTRAR UNA SESIÓN DE TRABAJO SOBRE EL OBJETIVO ───────────────────
  app.post("/medico/fisio/objetivos/:id/progreso", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const objetivo = await objetoDelMedico(req, ObjetivoFisio, req.params.id, "Objetivo no encontrado");

    const intentos = Number(req.body?.intentos);
    const logros = Number(req.body?.logros);
    if (!Number.isFinite(intentos) || intentos <= 0) throw new ErrorHttp(400, "Poné cuántas repeticiones se intentaron");
    if (!Number.isFinite(logros) || logros < 0) throw new ErrorHttp(400, "Poné cuántas salieron");
    // Más logros que intentos es un error de tipeo, y si se guarda deja una
    // curva por encima del 100% que después nadie entiende.
    if (logros > intentos) throw new ErrorHttp(400, "No puede haber más logros que intentos");

    const dolor = numeroEnRango(req.body?.dolor, 0, 10);
    if (dolor === null) throw new ErrorHttp(400, "El dolor de la sesión va de 0 a 10");

    const AYUDAS = ["independiente", "verbal", "gestual", "fisica_parcial", "fisica_total"];
    objetivo.progreso.push({
      fecha: req.body?.fecha ? new Date(req.body.fecha) : new Date(),
      logros, intentos, dolor,
      ayuda: AYUDAS.includes(req.body?.ayuda) ? req.body.ayuda : "independiente",
      notas: String(req.body?.notas || "").trim().slice(0, 1000),
      profesional: String(req.body?.profesional || "").trim().slice(0, 120),
    });
    await objetivo.save();
    registrar({ req, medicoPhone, accion: "progreso_objetivo_fisio", recurso: `ObjetivoFisio:${objetivo._id}` });
    res.json({ ok: true, objetivo });
  }));

  app.patch("/medico/fisio/objetivos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const objetivo = await objetoDelMedico(req, ObjetivoFisio, req.params.id, "Objetivo no encontrado");

    if (["activo", "logrado", "suspendido"].includes(req.body?.estado)) {
      objetivo.estado = req.body.estado;
      objetivo.fechaCierre = req.body.estado === "activo" ? null : new Date();
    }
    if (req.body?.titulo !== undefined) objetivo.titulo = String(req.body.titulo).trim() || objetivo.titulo;
    if (req.body?.criterio !== undefined) objetivo.criterio = String(req.body.criterio).trim().slice(0, 1000);
    if (AREAS_OBJETIVO_FISIO.includes(req.body?.area)) objetivo.area = req.body.area;
    await objetivo.save();
    registrar({ req, medicoPhone, accion: "editar_objetivo_fisio", recurso: `ObjetivoFisio:${objetivo._id}` });
    res.json({ ok: true, objetivo });
  }));

  app.delete("/medico/fisio/objetivos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const borrado = await objetoDelMedico(req, ObjetivoFisio, req.params.id, "Objetivo no encontrado");
    await ObjetivoFisio.deleteOne({ _id: borrado._id });
    registrar({ req, medicoPhone, accion: "borrar_objetivo_fisio", recurso: `ObjetivoFisio:${req.params.id}` });
    res.json({ ok: true });
  }));
};
