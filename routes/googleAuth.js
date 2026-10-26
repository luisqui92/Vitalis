const { Medico } = require("../db/models");
const google = require("../services/googleAcceso");
const { requireAuth, verificarPassword, generarToken } = require("../services/auth");
const { verificarCodigo } = require("../services/totp");
const { tokenDeMedico, datosDeSesion } = require("../services/sesionMedico");
const { registrar } = require("../services/auditoria");
const { limitAuth, limitMedico, limitGoogleConfig, limitGoogleInicio, limitGoogleEntrada } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const requireSesion = requireAuth(["medico", "admin"]);

module.exports = function (app) {
  app.get("/medico/google/config", limitGoogleConfig, (_req, res) => {
    res.set("Cache-Control", "no-store").json({ disponible: Boolean(google.configuracion()) });
  });
  app.post("/medico/google/iniciar", limitGoogleInicio, asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-store").json(await google.iniciar(req, res));
  }));
  app.post("/medico/google/entrar", limitGoogleEntrada, asyncRoute(async (req, res) => {
    const perfil = await google.comprobar(req);
    // Nunca enlazar automáticamente por email ni por teléfono declarado.
    const medico = await Medico.findOne({ googleSub: perfil.sub });
    res.set("Cache-Control", "no-store");
    if (!medico) return res.json({ registro: true, nombre: perfil.nombre, email: perfil.email, googleTicket: google.ticketRegistro(perfil) });
    if (["pendiente", "rechazada"].includes(medico.estadoCuenta)) return res.json({
      solicitud: true, solicitudTicket: google.ticketSolicitud(perfil), nombre: medico.nombre,
      estado: medico.estadoCuenta, motivo: medico.solicitud?.motivo || "", datos: medico.solicitud,
      telefonoVerificado: Boolean(medico.telefonoVerificado), phone: medico.phone,
    });
    google.comprobarEstado(medico);
    if (medico.dosFA?.activo) return res.json({
      requiere2fa: true, tempToken: generarToken(medico.phone, "medico_2fa_pendiente", 300000),
    });
    registrar({ req, medicoPhone: medico.phone, accion: "login_google" });
    res.json({ token: tokenDeMedico(medico), ...datosDeSesion(medico) });
  }));
  app.get("/medico/google/estado", limitMedico, requireSesion, asyncRoute(async (req, res) => {
    const m = await Medico.findOne({ phone: req.adminUser.usuario }).select("googleEmail googleSub googleSolo telefonoVerificado").lean();
    res.set("Cache-Control", "no-store").json({ disponible: Boolean(google.configuracion()),
      vinculado: Boolean(m?.googleSub), email: m?.googleEmail || "", soloGoogle: Boolean(m?.googleSolo),
      telefonoVerificado: Boolean(m?.telefonoVerificado) });
  }));
  app.post("/medico/google/vincular", limitAuth, requireSesion, asyncRoute(async (req, res) => {
    const m = await Medico.findOne({ phone: req.adminUser.usuario });
    google.comprobarEstado(m);
    // Para vincular no alcanza con una sesión abierta: confirmar la clave y el 2FA.
    if (m.googleSolo || !(await verificarPassword(String(req.body?.password || ""), m.passwordHash)).ok ||
        (m.dosFA?.activo && !verificarCodigo(m.dosFA.secreto, String(req.body?.codigo || "")))) {
      throw new ErrorHttp(401, "Confirmá tu contraseña y, si corresponde, el código de tu app autenticadora.");
    }
    if (m.googleSub) throw new ErrorHttp(409, "Tu cuenta ya tiene Google vinculado.");
    const perfil = await google.comprobar(req);
    let r;
    try {
      r = await Medico.updateOne({ _id: m._id, googleSub: { $exists: false } }, { $set: {
        googleSub: perfil.sub, googleEmail: perfil.email, googleVinculadoEn: new Date(),
      } });
    } catch (e) {
      if (e.code === 11000) throw new ErrorHttp(409, "Esa cuenta de Google ya está vinculada.");
      throw e;
    }
    if (!r.modifiedCount) throw new ErrorHttp(409, "La cuenta cambió. Volvé a abrir Configuración.");
    registrar({ req, medicoPhone: m.phone, accion: "vincular_google" });
    res.json({ ok: true });
  }));
};
