// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Olvidé mi contraseña, con un humano en el medio
// ═══════════════════════════════════════════════════════════════════════════
//
// El porqué de fondo está en db/models.js, junto al modelo. Acá va lo del
// flujo:
//
// · CUATRO PUERTAS.
//     POST /reseteo-clave/solicitar        público, cualquiera puede tocarla
//     GET  /restablecer-clave/:token       público, solo con el enlace
//     POST /restablecer-clave/:token       público, solo con el enlace
//     /medico/operador/reseteos/*          admin, mismo candado que pagos
//
// · SOLICITAR NUNCA DICE SI EL TELÉFONO EXISTE. Contesta lo mismo exista o
//   no exista una cuenta, para que nadie pueda usarla como una lista de
//   médicos y socios de Symphomed probando números.
//
// · EL TOKEN NACE RECIÉN AL APROBAR, NUNCA ANTES. Un pedido "pendiente" no
//   tiene ningún enlace que filtrar: no hay nada que robar hasta que un
//   humano decidió que correspondía.
const crypto = require("crypto");
const { Medico, Socio, SolicitudReseteo } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { rateLimit, rateLimitPorClave, claveDeMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { enviarTextoOPlantilla, PLANTILLAS, normalizarDestino } = require("../services/metaWhatsapp");
const { esOperador } = require("../services/operadores");
const { hashPassword } = require("../services/auth");
const { CONFIG, log } = require("../config");
const { esCuentaBrasil } = require("../services/idiomas");

const requireSesion = requireAuth(["medico", "admin"]);

// Cinco por cuarto de hora: un pedido de reseteo es raro en el tráfico
// normal, y esta es la puerta que más conviene mantener angosta — es la que
// cualquiera puede tocar sin ninguna credencial.
const limitSolicitar = rateLimit("reseteoSolicitar", 5, 15 * 60 * 1000,
  "Demasiados pedidos seguidos. Esperá un momento.");
// Más ancho: acá adentro entra alguien con un enlace válido en la mano, y
// cargar el formulario y corregir una contraseña que no coincide con la
// confirmación son varias pedidas legítimas seguidas.
const limitToken = rateLimit("reseteoToken", 20, 60 * 1000,
  "Demasiados pedidos seguidos. Esperá un momento.");
// Por operador, no por IP — mismo criterio que limitOperador en
// routes/operadorSaldo.js: un operador resolviendo varios pedidos seguidos
// no tiene que pelear con su propia cuota.
const limitAdmin = rateLimitPorClave("reseteoAdmin", 60, 60 * 1000,
  "Demasiadas operaciones seguidas. Esperá un momento.", claveDeMedico);

// El mínimo de cada tipo de cuenta. Los mismos números que exigen las rutas
// de alta — routes/medicoAuth.js para médicos, routes/operadorSaldo.js para
// socios — repetidos acá porque el reseteo es otro camino hacia el mismo
// passwordHash, y aflojarlo en uno de los dos lo afloja en la práctica.
const MINIMO = { medico: 8, socio: 10 };

// Dos horas. Más corto que cualquier otro enlace de Symphomed a propósito:
// este no es algo que la familia vuelva a abrir en un mes —es una sesión de
// soporte en curso—, y entregar acceso a una cuenta es más sensible que
// entregar un informe. Si se pasó de las dos horas, se pide de nuevo: cuesta
// un botón.
const HORAS_VALIDEZ = 2;

const nuevoToken = () => crypto.randomBytes(24).toString("base64url");

function base(req) {
  return (CONFIG.APP_URL || "").replace(/\/+$/, "")
    || (req ? `${req.protocol}://${req.get("host")}` : "");
}

// El mismo doble candado que routes/operadorSaldo.js y routes/
// solicitudesCuenta.js: estar en la lista del entorno Y tener el segundo
// factor puesto. Aprobar un reseteo es la misma clase de decisión que
// aprobar una cuenta — quién entra al sistema — y por eso lo aprueba la
// misma gente, con el mismo candado, copiado a propósito en vez de
// compartido: ver el comentario de requireAprobador en solicitudesCuenta.js
// sobre por qué esta duplicación es la que ya existe en el código, no una
// nueva.
function requireAprobador(req, res, next) {
  const phone = req.adminUser?.usuario;
  if (!esOperador(phone)) {
    log.warn(`[RESETEO] ${phone} intentó ver los pedidos y no está en OPERADORES_SALDO`);
    registrar({ req, medicoPhone: phone, accion: "reseteo_clave_denegado", exito: false });
    return res.status(404).json({ error: "No encontrado" });
  }
  Medico.findOne({ phone }).select("dosFA nombre").lean()
    .then((medico) => {
      if (!medico?.dosFA?.activo) {
        return res.status(403).json({
          error: "Para aprobar reseteos tenés que tener la verificación en dos pasos activa. Activala en Configuración y volvé a entrar.",
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

  app.post("/reseteo-clave/solicitar", limitSolicitar, asyncRoute(async (req, res) => {
    const telefono = String(req.body?.telefono || "").trim();

    // El mismo mensaje SIEMPRE, sin importar lo que pase adentro. Es lo que
    // impide que esta ruta sirva para averiguar qué números están
    // registrados: probar cien teléfonos tiene que verse idéntico a probar
    // el propio.
    const respuesta = { ok: true,
      mensaje: "Si ese número está registrado, un administrador va a revisar el pedido y te va a escribir por WhatsApp." };
    if (!telefono) return res.json(respuesta);

    // Se buscan las dos, no una: un mismo número podría corresponder a un
    // médico y a un socio a la vez (nada en el alta de socios lo impide hoy —
    // solo se comprueba contra otros socios). Si pasa, se le arma un pedido a
    // cada cuenta y el admin decide con cuál seguir.
    const [medico, socio] = await Promise.all([
      Medico.findOne({ phone: telefono }).select("nombre activo estadoCuenta").lean(),
      Socio.findOne({ phone: telefono }).select("nombre activo").lean(),
    ]);

    const candidatos = [];
    // Una cuenta pendiente de aprobación o dada de baja no gana nada con un
    // reseteo: no puede entrar igual. Pedirle un enlace igual sería trabajo
    // del admin que no resuelve nada.
    if (medico && medico.activo && medico.estadoCuenta === "aprobada") {
      candidatos.push({ tipo: "medico", nombre: medico.nombre });
    }
    if (socio && socio.activo) {
      candidatos.push({ tipo: "socio", nombre: socio.nombre });
    }

    for (const c of candidatos) {
      // ═══ UN APROBADO QUE NADIE USÓ, Y CUYO TOKEN YA VENCIÓ ═══════════════
      //
      // "aprobada" no se convierte sola en "vencida" con el paso del tiempo
      // —el vencimiento es una propiedad de `tokenExpira`, se comprueba al
      // leer, no cambia el estado guardado—. Sin este paso, alguien que dejó
      // pasar las dos horas de su enlace no podría pedir uno nuevo NUNCA: el
      // índice único de abajo seguiría viendo esa solicitud vieja como
      // "viva" para siempre, y este bloque la saltaría cada vez creyendo que
      // ya hay un pedido en curso. Se lo encontró escribiendo la prueba de
      // flujo completo, no leyendo el código — es justo el tipo de cosa que
      // una lectura no agarra.
      await SolicitudReseteo.updateMany(
        { tipo: c.tipo, telefono, estado: "aprobada", tokenExpira: { $lt: new Date() } },
        { $set: { estado: "vencida" } });

      // No se pisa un pedido vivo: si ya hay uno pendiente o ya aprobado sin
      // usar Y sin vencer, este intento no hace nada — el índice único
      // parcial de la base es la garantía real, esto es solo para no ni
      // siquiera intentarlo.
      const yaHay = await SolicitudReseteo.findOne({
        tipo: c.tipo, telefono, estado: { $in: ["pendiente", "aprobada"] },
      }).lean();
      if (yaHay) continue;
      try {
        await SolicitudReseteo.create({
          tipo: c.tipo, telefono, nombre: c.nombre,
          ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "",
        });
      } catch (e) {
        // Choque contra el índice único: dos pedidos llegaron a la vez. El
        // segundo no tiene nada que hacer — el primero ya está en la cola.
        if (e.code !== 11000) throw e;
      }
    }

    res.json(respuesta);
  }));

  // ═══ LA PUERTA PÚBLICA: elegir la contraseña nueva ══════════════════════

  async function solicitudVivaOFallar(token) {
    if (!token || token.length < 20) throw new ErrorHttp(404, "Este enlace no es válido.");
    const s = await SolicitudReseteo.findOne({ token, estado: "aprobada" });
    if (!s) throw new ErrorHttp(404, "Este enlace no existe o ya no es válido.");
    if (s.tokenExpira < new Date()) throw new ErrorHttp(410, "Este enlace venció. Pedí uno nuevo desde la pantalla de entrar.");
    return s;
  }

  app.get("/restablecer-clave/:token", limitToken, asyncRoute(async (req, res) => {
    const s = await solicitudVivaOFallar(req.params.token);
    res.json({ nombre: s.nombre, tipo: s.tipo, minimo: MINIMO[s.tipo] });
  }));

  app.post("/restablecer-clave/:token", limitToken, asyncRoute(async (req, res) => {
    const s = await solicitudVivaOFallar(req.params.token);
    const password = String(req.body?.password || "");
    const minimo = MINIMO[s.tipo];
    if (password.length < minimo) {
      throw new ErrorHttp(400, `La contraseña tiene que tener al menos ${minimo} caracteres.`);
    }

    const Modelo = s.tipo === "medico" ? Medico : Socio;
    const cuenta = await Modelo.findOne({ phone: s.telefono });
    if (!cuenta) throw new ErrorHttp(404, "Esta cuenta ya no existe.");

    cuenta.passwordHash = await hashPassword(password);
    await cuenta.save();

    // El token queda muerto en el mismo acto: si alguien más tiene una
    // pestaña abierta con este enlace, la segunda vez que lo intente usar se
    // encuentra con "no existe", no con la posibilidad de pisar la
    // contraseña que la persona acaba de elegir.
    s.estado = "usada";
    s.usadaEn = new Date();
    await s.save();

    // Sin `req.adminUser`: quien hace esto no tiene sesión. Queda igual en
    // auditoría, con el teléfono de la cuenta afectada — es el mismo criterio
    // que compartir_resumen_paciente en routes/resumenCompartido.js.
    registrar({ req, medicoPhone: s.telefono, accion: "usar_reseteo_clave",
      recurso: `${s.tipo === "medico" ? "Medico" : "Socio"}:${cuenta._id}` });

    res.json({ ok: true, tipo: s.tipo });
  }));

  // ═══ EL ADMIN: la cola y las dos decisiones ══════════════════════════════

  app.get("/medico/operador/reseteos", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const pendientes = await SolicitudReseteo.find({ estado: "pendiente" })
      .sort({ pedidaEn: 1 }).limit(100).lean();
    res.json({ pedidos: pendientes });
  }));

  app.post("/medico/operador/reseteos/:id/aprobar", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const s = await SolicitudReseteo.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!s) throw new ErrorHttp(404, "No encontramos ese pedido, o ya fue resuelto.");

    const Modelo = s.tipo === "medico" ? Medico : Socio;
    const cuenta = await Modelo.findOne({ phone: s.telefono });
    if (!cuenta) throw new ErrorHttp(404, "Esa cuenta ya no existe.");

    s.token = nuevoToken();
    s.tokenExpira = new Date(Date.now() + HORAS_VALIDEZ * 3600000);
    s.estado = "aprobada";
    s.aprobadaPor = quien;
    s.aprobadaEn = new Date();
    await s.save();

    const enlace = `${base(req)}/restablecer/${s.token}`;
    const primerNombre = String(s.nombre || "").split(" ")[0] || "";
    // País e idioma salen de la cuenta, no del pedido: es a la cuenta a la
    // que se le manda el WhatsApp, con el mismo criterio que
    // avisarCuentaAprobada() en routes/solicitudesCuenta.js.
    const esBrasil = s.tipo === "medico"
      ? esCuentaBrasil(cuenta)
      : cuenta.pais === "BR";
    const idioma = esBrasil ? "pt" : "es";
    const destino = normalizarDestino(s.telefono, esBrasil ? "BR" : "BO");

    const texto = idioma === "pt"
      ? `Olá ${primerNombre}. Você pediu para redefinir sua senha da Symphomed.\n\n` +
        `Entre aqui para escolher uma nova. O link vale por ${HORAS_VALIDEZ} horas e serve uma única vez:\n\n${enlace}\n\n` +
        `Se não foi você, ignore esta mensagem: sua senha atual continua funcionando.`
      : `Hola ${primerNombre}. Pediste restablecer tu contraseña de Symphomed.\n\n` +
        `Entrá acá para elegir una nueva. El enlace vale por ${HORAS_VALIDEZ} horas y sirve una sola vez:\n\n${enlace}\n\n` +
        `Si no fuiste vos, ignorá este mensaje: tu contraseña actual sigue funcionando.`;

    registrar({ req, medicoPhone: quien, accion: "aprobar_reseteo_clave",
      recurso: `SolicitudReseteo:${s._id}`, detalle: `${s.tipo} ${s.telefono}` });

    if (!destino) {
      return res.json({ ok: true, enlace, enviadoA: null,
        aviso: "Ese teléfono no tiene un formato válido para WhatsApp. Copiá el enlace y mandáselo por otro medio." });
    }

    try {
      // Acá el chequeo es más estricto que en resumenCompartido.js o
      // informeFamilia.js: `enviarTextoOPlantilla` no tira excepción cuando
      // Meta no está configurado, devuelve `null` calladamente (ver
      // services/metaWhatsapp.js). En las otras rutas eso queda como un
      // "enviado" que no fue, y no importa demasiado —el destinatario puede
      // volver a pedir el enlace de otra forma—. Acá SÍ importa: si el admin
      // cree que se mandó y no se mandó, nadie se entera de que la persona
      // se quedó sin poder entrar. Por eso se revisa el resultado y no solo
      // si hubo excepción — mismo criterio que avisarCuentaAprobada() en
      // routes/solicitudesCuenta.js.
      const resultado = await enviarTextoOPlantilla(destino, texto,
        { plantilla: PLANTILLAS.reseteoClave, parametros: [primerNombre, enlace], idioma });
      if (!resultado) throw new Error("WhatsApp Meta no está configurado");
    } catch (e) {
      log.error("[RESETEO] falló el envío por WhatsApp:", e.response?.data?.error?.message || e.message);
      // El enlace YA es válido: que el envío falle no lo invalida. Se le
      // devuelve al admin para que lo mande él, mismo criterio que emitir la
      // llave del paciente.
      return res.json({ ok: true, enlace, enviadoA: null,
        aviso: "No se pudo mandar por WhatsApp. Copiá el enlace y mandáselo vos." });
    }

    res.json({ ok: true, enlace, enviadoA: destino });
  }));

  app.post("/medico/operador/reseteos/:id/rechazar", limitAdmin, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const s = await SolicitudReseteo.findOne({ _id: req.params.id, estado: "pendiente" });
    if (!s) throw new ErrorHttp(404, "No encontramos ese pedido, o ya fue resuelto.");

    s.estado = "rechazada";
    s.rechazadaPor = quien;
    s.rechazadaEn = new Date();
    s.nota = String(req.body?.nota || "").trim().slice(0, 300);
    await s.save();

    registrar({ req, medicoPhone: quien, accion: "rechazar_reseteo_clave",
      recurso: `SolicitudReseteo:${s._id}`, detalle: `${s.tipo} ${s.telefono}` });

    res.json({ ok: true });
  }));
};
