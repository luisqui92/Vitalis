// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Telemedicina — la consulta por video
// ═══════════════════════════════════════════════════════════════════════════
//
// El médico genera un enlace y se lo manda al paciente por WhatsApp. El
// paciente lo abre, lee qué se va a grabar, acepta, y entra. Sin cuenta, sin
// contraseña, sin instalar nada — el mismo patrón del informe público,
// porque pedirle a un paciente que se registre para una consulta es perder
// la consulta.
//
// ═══ EL CONSENTIMIENTO ES LA LLAVE DE LA PUERTA ════════════════════════════
//
// Esto es lo único de este archivo que no se puede negociar: SIN
// CONSENTIMIENTO NO SE EMITE EL TOKEN DE LA SALA. No es una casilla que la
// pantalla muestra y el servidor ignora, ni un aviso que se puede saltear
// con F12: la ruta que entrega el token lo verifica en la base y contesta
// 403 si no está.
//
// Grabar a un paciente sin que lo autorice no es un problema de formulario.
// Esa grabación no sirve para nada —no es respaldo clínico ni es prueba— y
// en Brasil (LGPD) y en Bolivia es ilegal. Poner el candado el primer día
// cuesta esto; agregarlo después, sobre consultas ya grabadas, no se puede.
//
// ═══ POR QUÉ EL ENLACE VIVE POCO ═══════════════════════════════════════════
//
// Un enlace de consulta que sirve tres meses es un enlace que alguien
// reenvía por WhatsApp y termina abriendo un tercero. El del informe dura 90
// días porque el paciente tiene que poder volver a leerlo; una consulta pasa
// una vez y a una hora.
const crypto = require("crypto");
const { Paciente, Teleconsulta } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico, rateLimit } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const video = require("../services/video");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);

// Más suelto que el del médico porque de acá cuelga gente sin cuenta, con
// conexiones malas, recargando. Pero acotado: es una ruta pública.
const limitPublico = rateLimit("teleconsulta", 40, 60 * 1000,
  "Demasiadas peticiones. Esperá un momento.");

const HORAS_VALIDEZ_ENLACE = Number(process.env.TELECONSULTA_HORAS_ENLACE || 24);

// El texto que el paciente acepta. Se guarda COPIADO en cada teleconsulta,
// no referenciado: si mañana cambia la redacción, lo que hay que poder
// mostrar es lo que decía el día que esa persona apretó el botón.
const TEXTO_CONSENTIMIENTO =
  "Autorizo a que esta consulta por video sea grabada y transcrita para que el " +
  "profesional pueda escribir mi historia clínica. La grabación es parte de mi " +
  "historia clínica, la guarda mi profesional y no se comparte con nadie más sin " +
  "mi autorización. Puedo pedir que se borre en cualquier momento.";

function paraElMedico(t) {
  return {
    _id: t._id,
    pacienteId: t.pacienteId,
    pacienteNombre: t.pacienteNombre,
    estado: t.estado,
    enlace: `/teleconsulta/${t.token}`,
    expira: t.tokenExpira,
    consentimiento: {
      aceptado: Boolean(t.consentimiento?.aceptado),
      fecha: t.consentimiento?.fecha || null,
      // La IP del paciente NO viaja al médico: sirve para auditar un
      // consentimiento discutido, no para que nadie la mire de rutina.
    },
    iniciadaEn: t.iniciadaEn,
    terminadaEn: t.terminadaEn,
    createdAt: t.createdAt,
  };
}

function vigente(t) {
  return t && t.estado !== "cancelada" && t.estado !== "terminada" && t.tokenExpira > new Date();
}

module.exports = function (app) {
  // ─── ¿ESTÁ DISPONIBLE? ──────────────────────────────────────────────────
  // La pantalla pregunta antes de ofrecer el botón: prometer una videollamada
  // que después no abre es peor que no ofrecerla.
  app.get("/medico/teleconsulta/estado", limitMedico, requireMedico, asyncRoute(async (_req, res) => {
    res.json({ disponible: video.configurado(), horasValidezEnlace: HORAS_VALIDEZ_ENLACE });
  }));

  // ─── CREAR EL ENLACE ────────────────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/teleconsulta", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    if (!video.configurado()) throw new ErrorHttp(503, "La teleconsulta no está configurada en este servidor");
    const medicoPhone = req.adminUser.usuario;
    const paciente = await Paciente.findOne({ _id: req.params.pacienteId, medicoPhone }).select("nombre").lean();
    if (!paciente) throw new ErrorHttp(404, "Paciente no encontrado");

    // Si ya hay una vigente para este paciente se devuelve ESA. Generar un
    // enlace nuevo cada vez que el médico toca el botón deja al paciente con
    // tres links en el WhatsApp y sin saber cuál abrir.
    const yaHay = await Teleconsulta.findOne({
      medicoPhone, pacienteId: paciente._id,
      estado: { $in: ["creada", "en_curso"] }, tokenExpira: { $gt: new Date() },
    });
    if (yaHay) return res.json({ ok: true, teleconsulta: paraElMedico(yaHay), yaExistia: true });

    const teleconsulta = await Teleconsulta.create({
      medicoPhone, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
      token: crypto.randomBytes(24).toString("base64url"),
      tokenExpira: new Date(Date.now() + HORAS_VALIDEZ_ENLACE * 3600000),
      salaNombre: video.nombreDeSala(),
    });
    registrar({ req, medicoPhone, accion: "teleconsulta_creada", recurso: `Paciente:${paciente._id}` });
    res.status(201).json({ ok: true, teleconsulta: paraElMedico(teleconsulta) });
  }));

  // ─── LAS MÍAS ───────────────────────────────────────────────────────────
  app.get("/medico/teleconsultas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const lista = await Teleconsulta.find({ medicoPhone: req.adminUser.usuario })
      .sort({ createdAt: -1 }).limit(30).lean();
    res.json({ teleconsultas: lista.map(paraElMedico) });
  }));

  // ─── ENTRAR (MÉDICO) ────────────────────────────────────────────────────
  // El médico NO necesita el consentimiento del paciente para entrar a su
  // propia sala: el candado del consentimiento es sobre GRABAR, y sobre que
  // el paciente entre sabiendo. Un médico esperando en una sala vacía no
  // graba nada.
  app.post("/medico/teleconsulta/:id/entrar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const t = await Teleconsulta.findOne({ _id: req.params.id, medicoPhone });
    if (!vigente(t)) throw new ErrorHttp(404, "Esa teleconsulta ya no está disponible");

    // No hay sala que crear en ningún proveedor: la llamada va directo de un
    // navegador al otro. Lo que se entrega es el permiso para entrar a la
    // señalización y por dónde intentar conectarse.
    const token = video.tokenDeSenal(t.salaNombre, "medico");

    if (t.estado === "creada") {
      t.estado = "en_curso";
      t.iniciadaEn = new Date();
      await t.save();
    }
    registrar({ req, medicoPhone, accion: "teleconsulta_entrar", recurso: `Teleconsulta:${t._id}` });
    res.json({
      sala: t.salaNombre, token, ice: video.iceServers(), hayTurn: video.hayTurn(),
      // Para que la pantalla sepa si ya puede grabar o todavía está esperando
      // que el paciente acepte.
      consentimiento: Boolean(t.consentimiento?.aceptado),
      pacienteNombre: t.pacienteNombre,
    });
  }));

  // ─── TERMINAR ───────────────────────────────────────────────────────────
  app.post("/medico/teleconsulta/:id/terminar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const t = await Teleconsulta.findOne({ _id: req.params.id, medicoPhone: req.adminUser.usuario });
    if (!t) throw new ErrorHttp(404, "No encontrada");
    t.estado = "terminada";
    t.terminadaEn = new Date();
    await t.save();
    // La sala se borra después de responder: el médico no tiene por qué
    // esperar a un tercero para que se le cierre la pantalla.
    res.json({ ok: true });
  }));

  app.post("/medico/teleconsulta/:id/cancelar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const t = await Teleconsulta.findOne({ _id: req.params.id, medicoPhone: req.adminUser.usuario });
    if (!t) throw new ErrorHttp(404, "No encontrada");
    t.estado = "cancelada";
    await t.save();
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "teleconsulta_cancelada", recurso: `Teleconsulta:${t._id}` });
    res.json({ ok: true });
  }));

  // ═══ LO PÚBLICO — acá entra el paciente, sin cuenta ═════════════════════

  // Qué ve al abrir el enlace. No dice el teléfono del médico ni el id del
  // paciente: solo lo necesario para saber que llegó bien.
  app.get("/teleconsulta-publica/:token", limitPublico, asyncRoute(async (req, res) => {
    const t = await Teleconsulta.findOne({ token: req.params.token }).lean();
    if (!t) throw new ErrorHttp(404, "Este enlace no existe");
    if (t.estado === "cancelada") return res.json({ estado: "cancelada" });
    if (t.estado === "terminada") return res.json({ estado: "terminada" });
    if (t.tokenExpira < new Date()) return res.json({ estado: "vencida" });
    res.json({
      estado: t.estado,
      pacienteNombre: t.pacienteNombre,
      consentimientoAceptado: Boolean(t.consentimiento?.aceptado),
      textoConsentimiento: TEXTO_CONSENTIMIENTO,
    });
  }));

  // El paciente acepta. Se guarda el texto que aceptó, cuándo y desde dónde.
  app.post("/teleconsulta-publica/:token/consentimiento", limitPublico, asyncRoute(async (req, res) => {
    const t = await Teleconsulta.findOne({ token: req.params.token });
    if (!vigente(t)) throw new ErrorHttp(404, "Este enlace ya no está disponible");
    if (req.body?.acepto !== true) throw new ErrorHttp(400, "Hace falta aceptar para poder entrar");

    if (!t.consentimiento?.aceptado) {
      t.consentimiento = {
        aceptado: true, fecha: new Date(),
        ip: String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim(),
        texto: TEXTO_CONSENTIMIENTO,
      };
      await t.save();
      log.info(`[TELECONSULTA] consentimiento aceptado en ${t._id}`);
    }
    res.json({ ok: true });
  }));

  // ─── ENTRAR (PACIENTE) ──────────────────────────────────────────────────
  //
  // ACÁ ESTÁ EL CANDADO. Sin consentimiento guardado en la base, no hay
  // token, y sin token no se entra a la sala (es privada). No alcanza con
  // que la pantalla haya mostrado la casilla.
  app.post("/teleconsulta-publica/:token/entrar", limitPublico, asyncRoute(async (req, res) => {
    const t = await Teleconsulta.findOne({ token: req.params.token });
    if (!vigente(t)) throw new ErrorHttp(404, "Este enlace ya no está disponible");
    if (!t.consentimiento?.aceptado) {
      throw new ErrorHttp(403, "Hace falta aceptar la grabación antes de entrar a la consulta");
    }
    if (!video.configurado()) throw new ErrorHttp(503, "La videollamada no está disponible en este momento");

    const token = video.tokenDeSenal(t.salaNombre, "paciente");
    res.json({ sala: t.salaNombre, token, ice: video.iceServers(), hayTurn: video.hayTurn() });
  }));
};

// Expuesto para las pruebas: es el texto que define qué se está autorizando.
module.exports.TEXTO_CONSENTIMIENTO = TEXTO_CONSENTIMIENTO;
