// ChatGo Salud — Registro y login de médicos (teléfono + contraseña,
// opcionalmente 2FA con TOTP) y consulta del propio log de auditoría.
const QRCode = require("qrcode");
const { Medico, AuditLog } = require("../db/models");
const { generarToken, verificarToken, hashPassword, verificarPassword, requireAuth } = require("../services/auth");
const { generarSecreto, generarUriOtpAuth, verificarCodigo } = require("../services/totp");
const { registrar } = require("../services/auditoria");
const { limitMedico, limitAuth } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── REGISTRO ───────────────────────────────────────────────────────────
  app.post("/medico/registro", limitAuth, asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const nombre = String(req.body?.nombre || "").trim();
    const especialidad = String(req.body?.especialidad || "").trim();
    const password = String(req.body?.password || "");
    if (!phone || !nombre) throw new ErrorHttp(400, "phone y nombre son requeridos");
    if (password.length < 8) throw new ErrorHttp(400, "La contraseña debe tener al menos 8 caracteres");

    const yaExiste = await Medico.findOne({ phone });
    if (yaExiste) throw new ErrorHttp(409, "Ese teléfono ya está registrado");

    const medico = await Medico.create({ phone, nombre, especialidad, passwordHash: await hashPassword(password), activo: true });
    registrar({ req, medicoPhone: phone, accion: "registro" });
    res.json({ ok: true, phone: medico.phone, nombre: medico.nombre });
  }));

  // ─── LOGIN (paso 1: teléfono + contraseña) ──────────────────────────────
  // Si el médico tiene 2FA activo, no devuelve el token real todavía: da un
  // token de corta duración que solo sirve para el paso 2 (/medico/login/2fa).
  app.post("/medico/login", limitAuth, asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");
    if (!phone || !password) throw new ErrorHttp(400, "phone y password son requeridos");

    const medico = await Medico.findOne({ phone, activo: true });
    const { ok, requiereRehash } = medico
      ? await verificarPassword(password, medico.passwordHash)
      : { ok: false, requiereRehash: false };

    if (!ok) {
      registrar({ req, medicoPhone: phone, accion: "login_fallido", exito: false });
      throw new ErrorHttp(401, "Teléfono o contraseña incorrectos");
    }

    // Migración transparente: la contraseña era correcta pero el hash
    // guardado todavía era el formato viejo (SHA-256) — se re-guarda ya en
    // bcrypt sin que el médico tenga que hacer nada.
    if (requiereRehash) {
      medico.passwordHash = await hashPassword(password);
      await medico.save();
    }

    if (medico.dosFA?.activo) {
      const tempToken = generarToken(medico.phone, "medico_2fa_pendiente", 5 * 60 * 1000);
      return res.json({ requiere2fa: true, tempToken });
    }

    registrar({ req, medicoPhone: phone, accion: "login" });
    const token = generarToken(medico.phone, "medico");
    res.json({ token, phone: medico.phone, nombre: medico.nombre });
  }));

  // ─── LOGIN (paso 2: código de 2FA) ───────────────────────────────────────
  app.post("/medico/login/2fa", limitAuth, asyncRoute(async (req, res) => {
    const tempToken = String(req.body?.tempToken || "");
    const codigo = String(req.body?.codigo || "").trim();
    const payload = verificarToken(tempToken);
    if (!payload || payload.rol !== "medico_2fa_pendiente") {
      throw new ErrorHttp(401, "Sesión de login expirada, iniciá sesión de nuevo");
    }
    const medico = await Medico.findOne({ phone: payload.usuario, activo: true });
    if (!medico?.dosFA?.activo || !verificarCodigo(medico.dosFA.secreto, codigo)) {
      registrar({ req, medicoPhone: payload.usuario, accion: "login_2fa_fallido", exito: false });
      throw new ErrorHttp(401, "Código incorrecto");
    }
    registrar({ req, medicoPhone: medico.phone, accion: "login" });
    const token = generarToken(medico.phone, "medico");
    res.json({ token, phone: medico.phone, nombre: medico.nombre });
  }));

  // ─── 2FA: estado, activar, confirmar, desactivar ────────────────────────
  app.get("/medico/2fa/estado", requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("dosFA.activo").lean();
    res.json({ activo: Boolean(medico?.dosFA?.activo) });
  }));

  app.post("/medico/2fa/iniciar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medico = await Medico.findOne({ phone: req.adminUser.usuario });
    const secreto = generarSecreto();
    medico.dosFA.secretoPendiente = secreto;
    await medico.save();
    const uri = generarUriOtpAuth(secreto, medico.phone, "Vitalis");
    const qr = await QRCode.toDataURL(uri);
    res.json({ secreto, qr });
  }));

  app.post("/medico/2fa/confirmar", limitAuth, requireMedico, asyncRoute(async (req, res) => {
    const codigo = String(req.body?.codigo || "").trim();
    const medico = await Medico.findOne({ phone: req.adminUser.usuario });
    if (!medico.dosFA?.secretoPendiente) throw new ErrorHttp(400, "No hay una activación de 2FA en curso");
    if (!verificarCodigo(medico.dosFA.secretoPendiente, codigo)) throw new ErrorHttp(401, "Código incorrecto");
    medico.dosFA.secreto = medico.dosFA.secretoPendiente;
    medico.dosFA.secretoPendiente = "";
    medico.dosFA.activo = true;
    await medico.save();
    registrar({ req, medicoPhone: medico.phone, accion: "2fa_activado" });
    res.json({ ok: true });
  }));

  app.post("/medico/2fa/desactivar", limitAuth, requireMedico, asyncRoute(async (req, res) => {
    const password = String(req.body?.password || "");
    const medico = await Medico.findOne({ phone: req.adminUser.usuario });
    const { ok } = await verificarPassword(password, medico.passwordHash);
    if (!ok) throw new ErrorHttp(401, "Contraseña incorrecta");
    medico.dosFA = { activo: false, secreto: "", secretoPendiente: "" };
    await medico.save();
    registrar({ req, medicoPhone: medico.phone, accion: "2fa_desactivado" });
    res.json({ ok: true });
  }));

  // ─── AUDITORÍA: últimos accesos de esta cuenta ──────────────────────────
  app.get("/medico/auditoria", requireMedico, asyncRoute(async (req, res) => {
    const eventos = await AuditLog.find({ medicoPhone: req.adminUser.usuario })
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ eventos });
  }));
};
