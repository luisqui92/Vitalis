// ChatGo Salud — Registro y login de médicos (teléfono + contraseña,
// opcionalmente 2FA con TOTP) y consulta del propio log de auditoría.
const QRCode = require("qrcode");
const { Medico, AuditLog } = require("../db/models");
const { generarToken, verificarToken, hashPassword, verificarPassword, requireAuth } = require("../services/auth");
const { generarSecreto, generarUriOtpAuth, verificarCodigo } = require("../services/totp");
const { registrar } = require("../services/auditoria");
const { esOperador } = require("../services/operadores");
const { limitMedico, limitAuth, limitLoginPorCuenta, limit2faPorSesion } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

// El rol del TOKEN no es el mismo campo que el rol de la cuenta, y la
// diferencia es la que sostiene el permiso: un director es médico para todo
// efecto clínico (rol "medico"), y además administra (admin: true). Un
// administrativo NO es médico, así que su token lleva rol "admin" y las
// rutas clínicas lo rechazan solas, por el requireAuth(["medico"]) que ya
// tenían — sin agregar un chequeo nuevo en cada una de las 30 rutas.
function tokenDeMedico(medico) {
  const esAdmin = medico.rol === "admin" || medico.rol === "director";
  const rolToken = medico.rol === "admin" ? "admin" : "medico";
  return generarToken(medico.phone, rolToken, 8 * 60 * 60 * 1000, {
    ...(esAdmin ? { admin: true } : {}),
    ...(medico.clinicaId ? { clinicaId: String(medico.clinicaId) } : {}),
  });
}

function datosDeSesion(medico) {
  return {
    phone: medico.phone,
    nombre: medico.nombre,
    tipoEspecialidad: medico.tipoEspecialidad,
    idioma: medico.idioma || "es",
    rol: medico.rol || "medico",
    clinica: medico.clinicaId ? String(medico.clinicaId) : null,
    // Solo para que la pantalla sepa si dibujar la sección de pagos. NO es
    // un permiso: el permiso lo revisa el servidor en cada pedido contra
    // OPERADORES_SALDO, y quien mienta acá se encuentra con un 404. Igual
    // que rol, que también viaja así.
    operador: esOperador(medico.phone),
  };
}

module.exports = function (app) {
  // ─── REGISTRO ───────────────────────────────────────────────────────────
  app.post("/medico/registro", limitAuth, asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const nombre = String(req.body?.nombre || "").trim();
    const especialidad = String(req.body?.especialidad || "").trim();
    const tipoEspecialidad = ["odontologia", "estetica", "oftalmologia", "veterinaria", "ginecologia", "pediatria", "neurodesarrollo"].includes(req.body?.tipoEspecialidad) ? req.body.tipoEspecialidad : "medicina_general";
    const idioma = ["es", "pt"].includes(req.body?.idioma) ? req.body.idioma : "es";
    const password = String(req.body?.password || "");
    if (!phone || !nombre) throw new ErrorHttp(400, "phone y nombre son requeridos");
    if (password.length < 8) throw new ErrorHttp(400, "La contraseña debe tener al menos 8 caracteres");

    const yaExiste = await Medico.findOne({ phone });
    if (yaExiste) throw new ErrorHttp(409, "Ese teléfono ya está registrado");

    const medico = await Medico.create({ phone, nombre, especialidad, tipoEspecialidad, idioma, passwordHash: await hashPassword(password), activo: true });
    registrar({ req, medicoPhone: phone, accion: "registro" });
    res.json({ ok: true, phone: medico.phone, nombre: medico.nombre });
  }));

  // ─── LOGIN (paso 1: teléfono + contraseña) ──────────────────────────────
  // Si el médico tiene 2FA activo, no devuelve el token real todavía: da un
  // token de corta duración que solo sirve para el paso 2 (/medico/login/2fa).
  app.post("/medico/login", limitAuth, limitLoginPorCuenta, asyncRoute(async (req, res) => {
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
    const token = tokenDeMedico(medico);
    res.json({ token, ...datosDeSesion(medico) });
  }));

  // ─── LOGIN (paso 2: código de 2FA) ───────────────────────────────────────
  app.post("/medico/login/2fa", limitAuth, limit2faPorSesion, asyncRoute(async (req, res) => {
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
    const token = tokenDeMedico(medico);
    res.json({ token, ...datosDeSesion(medico) });
  }));

  // ─── IDIOMA DE LA CUENTA ────────────────────────────────────────────────
  // Cambiarlo cambia de acá en adelante: la pantalla, el idioma que se le
  // pide al transcriptor, qué prompt clínico se usa y en qué idioma le
  // escribe el bot a los pacientes de este médico.
  //
  // Lo que YA está escrito no se toca. Una nota clínica se lee como se
  // escribió — retraducir una historia clínica vieja sería reescribir un
  // documento que puede terminar en un juicio.
  app.patch("/medico/idioma", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const idioma = req.body?.idioma;
    if (!["es", "pt"].includes(idioma)) throw new ErrorHttp(400, "Idioma no válido");
    const medico = await Medico.findOneAndUpdate(
      { phone: req.adminUser.usuario, activo: true },
      { idioma },
      { new: true }
    );
    if (!medico) throw new ErrorHttp(404, "Médico no encontrado");
    registrar({ req, medicoPhone: medico.phone, accion: "cambiar_idioma", recurso: idioma });
    res.json({ ok: true, idioma: medico.idioma });
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
