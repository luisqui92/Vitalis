// Symphomed — La fila de entrada: quién pidió cuenta y quién decide.
//
// ═══ POR QUÉ HAY UNA FILA ══════════════════════════════════════════════════
//
// Hasta ahora cualquiera con un teléfono se creaba una cuenta de médico y
// entraba. Dos cosas pasaban con eso, y la segunda es la grave:
//
//   · el saldo arranca en cero pero el bloqueo recién entra a las cinco
//     consultas en negativo, así que cada cuenta falsa se llevaba cinco
//     transcripciones pagadas por Symphomed;
//
//   · y cualquiera podía cargar pacientes REALES en esta base. Symphomed queda
//     como responsable del tratamiento de historias clínicas subidas por
//     gente que nunca nadie verificó. Eso no es un problema de costos.
//
// Registrarse ahora no da acceso: da un lugar en una fila.
//
// ═══ QUIÉN APRUEBA ═════════════════════════════════════════════════════════
//
// Los mismos de OPERADORES_SALDO, con el mismo segundo factor obligatorio.
// No es pereza de no hacer una lista nueva: aprobar una cuenta y acreditar
// un pago son la misma clase de acto —decisiones sobre quién está adentro y
// con cuánto—, y las dos tienen que quedar auditadas con nombre y apellido.
// El día que haga falta separarlas, se separa acá y en services/operadores.js,
// no en quince lugares.
const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { esOperador } = require("../services/operadores");
const { registrar } = require("../services/auditoria");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { enviarTextoOPlantilla, normalizarDestino, PLANTILLAS } = require("../services/metaWhatsapp");
const { CONFIG, log } = require("../config");

// Igual que el panel de pagos: acá entra también una cuenta administrativa,
// porque quien administra Symphomed no tiene por qué ser médico.
const requireSesion = requireAuth(["medico", "admin"]);

// El mismo doble candado que routes/operadorSaldo.js: estar en la lista del
// entorno Y tener el segundo factor puesto. Aprobar cuentas es dar de alta a
// alguien en un sistema de historias clínicas; si la sesión de quien aprueba
// se roba con una contraseña, se puede dar de alta a cualquiera.
function requireAprobador(req, res, next) {
  const phone = req.adminUser?.usuario;
  if (!esOperador(phone)) {
    // 404 y no 403: a quien no aprueba no se le confirma que esta pantalla
    // existe.
    log.warn(`[CUENTAS] ${phone} intentó ver las solicitudes y no está en OPERADORES_SALDO`);
    registrar({ req, medicoPhone: phone, accion: "solicitudes_cuenta_denegado", exito: false });
    return res.status(404).json({ error: "No encontrado" });
  }
  Medico.findOne({ phone }).select("dosFA nombre").lean()
    .then((medico) => {
      if (!medico?.dosFA?.activo) {
        return res.status(403).json({
          error: "Para aprobar cuentas tenés que tener la verificación en dos pasos activa. Activala en Configuración y volvé a entrar.",
          requiere2fa: true,
        });
      }
      req.aprobador = medico;
      next();
    })
    .catch(next);
}

// No se usa obtenerOFallar: ese ayudante EXIGE medicoPhone en el filtro, y
// hace bien — existe para que nadie traiga por accidente el paciente o la
// consulta de otro médico. Acá el recurso buscado ES un médico, identificado
// por su teléfono, así que ese candado no aplica y forzarlo sería aflojarlo
// para todos los demás.
async function traerSolicitud(phone) {
  const medico = await Medico.findOne({ phone: String(phone || "").trim() });
  if (!medico) throw new ErrorHttp(404, "Esa solicitud no existe");
  return medico;
}

async function avisarCuentaAprobada(medico) {
  const esBrasil = medico.moneda === "BRL" || medico.idioma === "pt";
  const destino = normalizarDestino(medico.phone, esBrasil ? "BR" : "BO");
  if (!destino) throw new Error("la cuenta no tiene un teléfono válido");

  const nombre = medico.nombre || "Profesional";
  const ingreso = CONFIG.APP_URL || "https://app.symphomed.com";
  const portugues = medico.idioma === "pt";
  const texto = portugues
    ? `Olá ${nombre}, sua conta da Symphomed foi aprovada.\n\nVocê já pode entrar em ${ingreso} com o telefone que cadastrou.\n\nPor segurança, não compartilhe sua senha.`
    : `Hola ${nombre}, tu cuenta de Symphomed fue aprobada.\n\nYa podés ingresar en ${ingreso} con el teléfono que registraste.\n\nPor seguridad, no compartas tu contraseña.`;

  // Meta rechazó la variante pt_BR de esta plantilla en esta cuenta.
  // Dentro de las 24 h se mantiene el texto libre en portugués; fuera de la
  // ventana se usa la plantilla española aprobada para no perder el aviso.
  const resultado = await enviarTextoOPlantilla(destino, texto, {
    plantilla: PLANTILLAS.cuentaAprobada,
    parametros: [nombre, ingreso],
    idioma: "es",
  });
  if (!resultado) throw new Error("WhatsApp Meta no está configurado");
}

module.exports = function (app) {

  // ─── LA FILA ───────────────────────────────────────────────────────────
  app.get("/medico/solicitudes-cuenta", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const pendientes = await Medico.find({ estadoCuenta: "pendiente" })
      .select("phone nombre especialidad tipoEspecialidad matricula idioma solicitud createdAt")
      .sort({ "solicitud.pedidaEn": 1 })   // la más vieja primero: nadie espera de más
      .limit(200)
      .lean();

    // Las últimas resueltas, para poder revisar una decisión reciente sin
    // tener que buscar en el log de auditoría.
    const recientes = await Medico.find({ estadoCuenta: { $in: ["aprobada", "rechazada"] }, "solicitud.resueltaEn": { $ne: null } })
      .select("phone nombre estadoCuenta matricula solicitud")
      .sort({ "solicitud.resueltaEn": -1 })
      .limit(15)
      .lean();

    res.json({ pendientes, recientes });
  }));

  // ─── APROBAR ───────────────────────────────────────────────────────────
  app.post("/medico/solicitudes-cuenta/:phone/aprobar", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const medico = await traerSolicitud(req.params.phone);

    // Aprobar dos veces no es un error del que haya que quejarse —dos
    // pestañas abiertas, un doble toque— pero tampoco puede reescribir quién
    // aprobó y cuándo. Se contesta que ya estaba y no se toca nada.
    if (medico.estadoCuenta === "aprobada") {
      return res.json({ ok: true, yaEstaba: true, phone: medico.phone });
    }

    medico.estadoCuenta = "aprobada";
    medico.activo = true;
    medico.solicitud.resueltaEn = new Date();
    medico.solicitud.resueltaPor = quien;
    medico.solicitud.motivo = "";
    await medico.save();

    registrar({ req, medicoPhone: quien, accion: "cuenta_aprobada", recurso: `Medico:${medico.phone}`,
      detalle: `${medico.nombre} — matrícula ${medico.matricula || "no declarada"}` });
    log.info(`[CUENTAS] ${quien} aprobó a ${medico.nombre} (${medico.phone})`);

    res.json({ ok: true, phone: medico.phone, nombre: medico.nombre });

    // La aprobación ya quedó guardada: el aviso es importante, pero una
    // caída de Meta no puede revertirla ni convertir la respuesta en 500.
    avisarCuentaAprobada(medico)
      .then(() => registrar({ req, medicoPhone: quien, accion: "cuenta_aprobada_whatsapp",
        recurso: `Medico:${medico.phone}` }))
      .catch((e) => {
        registrar({ req, medicoPhone: quien, accion: "cuenta_aprobada_whatsapp",
          recurso: `Medico:${medico.phone}`, detalle: e.message, exito: false });
        log.error(`[CUENTAS] cuenta aprobada, pero no se pudo avisar por WhatsApp a ${medico.phone}: ${e.message}`);
      });
  }));

  // ─── RECHAZAR ──────────────────────────────────────────────────────────
  app.post("/medico/solicitudes-cuenta/:phone/rechazar", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    // El motivo es obligatorio, y no por burocracia: un "no" sin explicación
    // produce un segundo intento idéntico y un WhatsApp preguntando por qué.
    // Además es lo único que va a quedar escrito de esta decisión.
    const motivo = String(req.body?.motivo || "").trim().slice(0, 300);
    if (!motivo) throw new ErrorHttp(400, "Poné el motivo del rechazo: es lo que va a leer quien lo pidió");

    const medico = await traerSolicitud(req.params.phone);
    if (medico.estadoCuenta === "aprobada") {
      throw new ErrorHttp(409, "Esa cuenta ya está aprobada y en uso. Para darla de baja usá la desactivación, no el rechazo.");
    }

    medico.estadoCuenta = "rechazada";
    medico.activo = false;
    medico.solicitud.resueltaEn = new Date();
    medico.solicitud.resueltaPor = quien;
    medico.solicitud.motivo = motivo;
    await medico.save();

    registrar({ req, medicoPhone: quien, accion: "cuenta_rechazada", recurso: `Medico:${medico.phone}`, detalle: motivo });
    log.info(`[CUENTAS] ${quien} rechazó a ${medico.nombre} (${medico.phone}): ${motivo}`);

    res.json({ ok: true, phone: medico.phone });
  }));
};
