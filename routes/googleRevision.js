const revision = require("../services/googleRevision");
const google = require("../services/googleAcceso");
const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { esOperador } = require("../services/operadores");
const { limitRegistro, rateLimitPorClave, claveDeMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const requireSesion = requireAuth(["medico", "admin"]);
const limitOperador = rateLimitPorClave("googleRevisionOperador", 60, 60000, "Esperá un momento antes de continuar.", claveDeMedico);
const requireOperador = (req, res, next) => asyncRoute(async () => {
  if (!esOperador(req.adminUser.usuario)) throw new ErrorHttp(403, "Esta cuenta no puede aprobar vinculaciones.");
  const m = await Medico.findOne({ phone: req.adminUser.usuario }).select("dosFA activo").lean();
  if (!m?.activo || !m.dosFA?.activo) throw new ErrorHttp(403, "Activá la verificación en dos pasos en Configuración y volvé a ingresar para aprobar vinculaciones.");
  next();
})(req, res);

module.exports = app => {
  app.post("/medico/google/solicitar-vinculacion", limitRegistro, asyncRoute(async (req, res) => {
    const identidad = await google.identidadParaRegistro(req);
    if (!identidad) throw new ErrorHttp(401, "Primero confirmá tu cuenta de Google.");
    if (!await revision.solicitar(req.body?.phone, identidad)) throw new ErrorHttp(409, "Contactá con Symphomed para habilitar la vinculación de tu cuenta existente.");
    res.set("Cache-Control", "no-store").json({ vinculacionPendiente: true });
  }));
  app.get("/medico/operador/vinculaciones-google", limitOperador, requireSesion, requireOperador, asyncRoute(async (_req, res) => {
    res.set("Cache-Control", "no-store").json({ solicitudes: await revision.pendientes() });
  }));
  app.post("/medico/operador/vinculaciones-google/:cuentaId/:solicitudId", limitOperador, requireSesion, requireOperador, asyncRoute(async (req, res) => {
    if (!["aprobar", "rechazar"].includes(req.body?.accion)) throw new ErrorHttp(400, "Decisión inválida.");
    const aprobar = req.body.accion === "aprobar";
    if (aprobar && req.body.confirmoIdentidad !== true) throw new ErrorHttp(400, "Confirmá la identidad del solicitante antes de aprobar.");
    const r = await revision.decidir({ ...req.params, aprobar, email: req.body.email, actor: req.adminUser.usuario });
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: aprobar ? "aprobar_vinculacion_google" : "rechazar_vinculacion_google", recurso: `Medico:${req.params.cuentaId}`, detalle: r.phone });
    res.set("Cache-Control", "no-store").json({ ok: true });
  }));
};
