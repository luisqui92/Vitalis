// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Cerrar la propia cuenta, con un humano en el medio
// ═══════════════════════════════════════════════════════════════════════════
//
// El porqué de fondo está en db/models.js, junto al modelo SolicitudBaja.
// Acá va lo del flujo:
//
// · TRES PUERTAS.
//     POST /medico/baja/solicitar       médico con sesión, pide su propio cierre
//     GET  /medico/baja/estado          médico con sesión, ve si ya pidió
//     /medico/operador/bajas/*          admin, mismo candado que pagos y reseteos
//
// · APROBAR ES EJECUTAR. A diferencia de un reseteo de contraseña, acá no
//   hay un enlace de por medio que alguien más tenga que usar después:
//   cuando el operador aprueba, la cuenta se apaga en el mismo acto.
//
// · NO BORRA HISTORIAS CLÍNICAS. Apaga el acceso del médico — ver el
//   comentario largo en db/models.js sobre por qué.
const { Medico, SolicitudBaja } = require("../db/models");
const { requireAuth, hashPassword } = require("../services/auth");
const crypto = require("crypto");
const { rateLimit, rateLimitPorClave, claveDeMedico, getIP } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { esOperador } = require("../services/operadores");
const { log } = require("../config");

const requireMedico = requireAuth(["medico"]);
const requireSesion = requireAuth(["medico", "admin"]);

// Angosto: pedir el cierre de la cuenta propia no es algo que pase seguido
// en el tráfico normal, mismo criterio que limitSolicitar en
// routes/reseteoClave.js.
const limitSolicitar = rateLimit("bajaSolicitar", 5, 15 * 60 * 1000,
  "Demasiados pedidos seguidos. Esperá un momento.");
const limitAdmin = rateLimitPorClave("bajaAdmin", 60, 60 * 1000,
  "Demasiadas operaciones seguidas. Esperá un momento.", claveDeMedico);

// El mismo doble candado que routes/reseteoClave.js y routes/
// operadorSaldo.js: estar en la lista del entorno Y tener el segundo factor
// puesto. Cerrar una cuenta es la misma clase de decisión que aprobar un
// reseteo — quién sigue teniendo acceso al sistema — y por eso la aprueba la
// misma gente, con el mismo candado, copiado a propósito (ver el comentario
// de requireAprobador en solicitudesCuenta.js sobre por qué esta
// duplicación es la que ya existe en el código, no una nueva).
function requireAprobador(req, res, next) {
  const phone = req.adminUser?.usuario;
  if (!esOperador(phone)) {
    log.warn(`[BAJA] ${phone} intentó ver los pedidos y no está en OPERADORES_SALDO`);
    registrar({ req, medicoPhone: phone, accion: "baja_cuenta_denegado", exito: false });
    return res.status(404).json({ error: "No encontrado" });
  }
  Medico.findOne({ phone }).select("dosFA nombre").lean()
    .then((medico) => {
      if (!medico?.dosFA?.activo) {
        return res.status(403).json({
          error: "Para aprobar cierres de cuenta tenés que tener la verificación en dos pasos activa. Activala en Configuración y volvé a entrar.",
          requiere2fa: true,
        });
      }
      req.aprobador = medico;
      next();
    })
    .catch(next);
}

module.exports = function (app) {

  // ═══ EL PEDIDO ════════════════════════════════════════════════════════

  app.post("/medico/baja/solicitar", limitSolicitar, requireMedico, asyncRoute(async (req, res) => {
    const telefono = req.adminUser.usuario;
    const medico = await Medico.findOne({ phone: telefono }).select("nombre activo").lean();
    if (!medico) throw new ErrorHttp(404, "No encontramos tu cuenta");
    if (!medico.activo) throw new ErrorHttp(409, "Tu cuenta ya está cerrada");

    const motivo = String(req.body?.motivo || "").trim().slice(0, 500);

    try {
      await SolicitudBaja.create({
        tipo: "medico", telefono, nombre: medico.nombre, motivo,
        // La que vio nginx, no la que escribe el cliente (services/ratelimit.js).
        ip: getIP(req),
      });
    } catch (e) {
      // Choque contra el índice único: ya había un pedido pendiente. No es
      // un error para quien lo pide — su pedido sigue en la cola igual.
      if (e.code !== 11000) throw e;
    }

    registrar({ req, medicoPhone: telefono, accion: "solicitar_baja_cuenta" });
    res.json({ ok: true, mensaje: "Recibimos tu pedido. Un administrador lo va a revisar." });
  }));

  app.get("/medico/baja/estado", requireMedico, asyncRoute(async (req, res) => {
    const pedido = await SolicitudBaja.findOne({
      tipo: "medico", telefono: req.adminUser.usuario, estado: "pendiente",
    }).select("pedidaEn").lean();
    res.json({ pendiente: Boolean(pedido), pedidaEn: pedido?.pedidaEn || null });
  }));

  // ═══ EL ADMIN: la cola y las dos decisiones ══════════════════════════════

  app.get("/medico/operador/bajas", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const pendientes = await SolicitudBaja.find({ estado: "pendiente" })
      .sort({ pedidaEn: 1 }).limit(100).lean();
    res.json({ pedidos: pendientes });
  }));

  app.post("/medico/operador/bajas/:id/aprobar", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const s = await SolicitudBaja.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!s) throw new ErrorHttp(404, "No encontramos ese pedido, o ya fue resuelto.");

    const medico = await Medico.findOne({ phone: s.telefono });
    if (!medico) throw new ErrorHttp(404, "Esa cuenta ya no existe.");

    // Apaga el acceso — mismo interruptor que ya usa todo el sistema (ver
    // el login en routes/medicoAuth.js: "activo: false" ya contesta
    // "Tu cuenta está desactivada"). La contraseña se invalida además, con
    // un hash al azar que nadie puede reproducir: si algún día se reactiva
    // la cuenta a pedido, entra por un reseteo nuevo, no con la vieja.
    medico.activo = false;
    // Y las sesiones abiertas se cortan ahora, no cuando venzan
    // (services/auth.js, sesionVigente).
    medico.sesionesDesde = new Date();
    medico.passwordHash = await hashPassword(crypto.randomBytes(24).toString("hex"));
    medico.dosFA = { activo: false, secreto: "", secretoPendiente: "" };
    await medico.save();

    s.estado = "aprobada";
    s.aprobadaPor = quien;
    s.aprobadaEn = new Date();
    await s.save();

    registrar({ req, medicoPhone: quien, accion: "aprobar_baja_cuenta",
      recurso: `SolicitudBaja:${s._id}`, detalle: s.telefono });

    res.json({ ok: true });
  }));

  app.post("/medico/operador/bajas/:id/rechazar", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const s = await SolicitudBaja.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!s) throw new ErrorHttp(404, "No encontramos ese pedido, o ya fue resuelto.");

    s.estado = "rechazada";
    s.rechazadaPor = quien;
    s.rechazadaEn = new Date();
    s.nota = String(req.body?.nota || "").trim().slice(0, 300);
    await s.save();

    registrar({ req, medicoPhone: quien, accion: "rechazar_baja_cuenta",
      recurso: `SolicitudBaja:${s._id}`, detalle: s.telefono });

    res.json({ ok: true });
  }));
};
