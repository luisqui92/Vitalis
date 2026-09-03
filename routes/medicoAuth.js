// ChatGo Salud — Registro y login de médicos (teléfono + contraseña,
// opcionalmente 2FA con TOTP) y consulta del propio log de auditoría.
const QRCode = require("qrcode");
const { Medico, AuditLog } = require("../db/models");
const { generarToken, verificarToken, hashPassword, verificarPassword, requireAuth } = require("../services/auth");
const { generarSecreto, generarUriOtpAuth, verificarCodigo } = require("../services/totp");
const { registrar } = require("../services/auditoria");
const { esOperador, todosLosOperadores } = require("../services/operadores");
const { notificarMedico } = require("../services/push");
const { log } = require("../config");
const { limitMedico, limitAuth, limitLoginPorCuenta, limit2faPorSesion } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");

// Las únicas rutas de este archivo que piden sesión son las de 2FA y la del
// propio log de accesos: todas son sobre LA CUENTA QUE LLAMA, ninguna toca un
// paciente. Por eso acá entra también el administrativo.
//
// No es un detalle de comodidad. El operador de pagos tiene el segundo factor
// OBLIGATORIO (candado 2 de routes/operadorSaldo.js), y mientras esto decía
// solo ["medico"] una cuenta admin no podía activarlo ni aunque quisiera:
// /medico/2fa/iniciar le contestaba 403. Quedaba trabada para siempre en
// "activá el 2FA" sin ninguna pantalla que se lo permitiera.
const requireMedico = requireAuth(["medico", "admin"]);

// Le avisa a quien aprueba que hay alguien esperando. Sin esto la fila
// existe pero nadie la mira, y el médico que pidió cuenta se queda sin
// respuesta pensando que Vitalis no anda.
async function avisarSolicitudPendiente(medico) {
  const aprobadores = todosLosOperadores();
  if (!aprobadores.length) {
    // Nadie configurado es una fila que no avanza nunca. Que se vea en el
    // log del arranque no alcanza: esto pasa meses después.
    log.warn(`[CUENTAS] ${medico.nombre} pidió cuenta y OPERADORES_SALDO está vacía — nadie va a enterarse`);
    return;
  }
  await Promise.all(aprobadores.map(phone => notificarMedico(phone, {
    titulo: "Nueva solicitud de cuenta",
    cuerpo: `${medico.nombre} — matrícula ${medico.matricula || "no declarada"}`,
    url: "/",
  }).catch(() => {})));
}

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
    // La moneda decide bajo qué reglas trabaja esta cuenta, no solo cómo se
    // muestra el saldo: en Brasil la receta va por Memed porque ahí una
    // receta necesita firma digital. Por eso viaja en la sesión — el
    // navegador tiene que saber qué botón de recetar dibujar.
    moneda: medico.moneda || "BOB",
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
    const matricula = String(req.body?.matricula || "").trim().slice(0, 60);
    const mensaje = String(req.body?.mensaje || "").trim().slice(0, 600);
    if (!phone || !nombre) throw new ErrorHttp(400, "phone y nombre son requeridos");
    if (password.length < 8) throw new ErrorHttp(400, "La contraseña debe tener al menos 8 caracteres");
    // No se verifica contra ningún registro —no hay una API del colegio
    // médico— así que exigirla no prueba nada por sí sola. Pero obliga a
    // que mentir sea una decisión consciente, y le da a quien aprueba algo
    // concreto que mirar en vez de un nombre suelto.
    if (!matricula) throw new ErrorHttp(400, "Falta la matrícula profesional");

    const yaExiste = await Medico.findOne({ phone });
    if (yaExiste) throw new ErrorHttp(409, "Ese teléfono ya está registrado");

    // ─── LA CUENTA NACE APAGADA ─────────────────────────────────────────
    //
    // Registrarse no da acceso: pone a la persona en una fila. Acá adentro
    // hay historias clínicas de gente real, y esa puerta no se abre a un
    // nombre y una contraseña que nadie miró.
    //
    // activo: false Y estadoCuenta: "pendiente" son dos cosas distintas a
    // propósito. "activo" es el interruptor que ya usaba todo el sistema
    // para dejar entrar o no; "estadoCuenta" es POR QUÉ. Sin el segundo, un
    // médico legítimo esperando aprobación y uno dado de baja se ven igual,
    // y no se les puede decir cosas distintas.
    const medico = await Medico.create({
      phone, nombre, especialidad, tipoEspecialidad, idioma,
      passwordHash: await hashPassword(password),
      matricula,
      activo: false,
      estadoCuenta: "pendiente",
      solicitud: { pedidaEn: new Date(), mensaje },
    });
    registrar({ req, medicoPhone: phone, accion: "solicitud_cuenta", detalle: `matrícula: ${matricula || "(sin matrícula)"}` });
    log.info(`[CUENTAS] nueva solicitud de ${nombre} (${phone}) — matrícula ${matricula || "no declarada"}`);

    // Avisar a quien aprueba, sin que la respuesta dependa de eso: si el
    // aviso falla, la solicitud igual quedó guardada y se ve en el panel.
    avisarSolicitudPendiente(medico).catch(e => log.warn("[CUENTAS] no se pudo avisar la solicitud:", e.message));

    res.json({ ok: true, pendiente: true, phone: medico.phone, nombre: medico.nombre });
  }));

  // ─── LOGIN (paso 1: teléfono + contraseña) ──────────────────────────────
  // Si el médico tiene 2FA activo, no devuelve el token real todavía: da un
  // token de corta duración que solo sirve para el paso 2 (/medico/login/2fa).
  app.post("/medico/login", limitAuth, limitLoginPorCuenta, asyncRoute(async (req, res) => {
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");
    if (!phone || !password) throw new ErrorHttp(400, "phone y password son requeridos");

    // Se busca SIN filtrar por activo, y el estado de la cuenta se mira
    // DESPUÉS de verificar la contraseña. El orden es la parte que importa:
    // si se dijera "tu cuenta está pendiente" a quien no sabe la contraseña,
    // cualquiera podría averiguar qué teléfonos tienen cuenta en Vitalis
    // probando números. Primero probás que sos vos; recién ahí te contamos
    // en qué estado está lo tuyo.
    const medico = await Medico.findOne({ phone });
    const { ok, requiereRehash } = medico
      ? await verificarPassword(password, medico.passwordHash)
      : { ok: false, requiereRehash: false };

    if (!ok) {
      registrar({ req, medicoPhone: phone, accion: "login_fallido", exito: false });
      throw new ErrorHttp(401, "Teléfono o contraseña incorrectos");
    }

    // Contraseña correcta pero la cuenta todavía no entra. Antes esto caía en
    // el mismo "teléfono o contraseña incorrectos" de arriba, y un médico
    // legítimo esperando aprobación se pasaba la tarde reescribiendo bien una
    // contraseña que ya estaba bien.
    if (medico.estadoCuenta === "pendiente") {
      registrar({ req, medicoPhone: phone, accion: "login_pendiente", exito: false });
      throw new ErrorHttp(403, "Tu solicitud todavía está en revisión. Te avisamos por WhatsApp apenas la aprobemos.");
    }
    if (medico.estadoCuenta === "rechazada") {
      registrar({ req, medicoPhone: phone, accion: "login_rechazada", exito: false });
      throw new ErrorHttp(403, medico.solicitud?.motivo
        ? `Tu solicitud no fue aprobada: ${medico.solicitud.motivo}`
        : "Tu solicitud no fue aprobada. Escribinos si creés que es un error.");
    }
    // Aprobada pero apagada: es una baja o una suspensión, no una fila.
    if (!medico.activo) {
      registrar({ req, medicoPhone: phone, accion: "login_inactiva", exito: false });
      throw new ErrorHttp(403, "Tu cuenta está desactivada. Escribinos para reactivarla.");
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
