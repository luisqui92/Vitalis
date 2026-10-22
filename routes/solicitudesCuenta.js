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
const { log } = require("../config");
const { pendiente, filtroRevision, revisionProfesional, nuevoAvisoCuenta } = require("../services/perfilesCuenta");

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

module.exports = function (app) {

  // ─── LA FILA ───────────────────────────────────────────────────────────
  app.get("/medico/solicitudes-cuenta", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const pendientes = await Medico.find({ $or: [{ estadoCuenta: "pendiente" }, { "solicitud.tipo": "conversion", "solicitud.estado": "pendiente" }] })
      .select("phone nombre especialidad tipoEspecialidad matricula idioma solicitud createdAt telefonoVerificado googleEmail formacion")
      .sort({ "solicitud.pedidaEn": 1 })   // la más vieja primero: nadie espera de más
      .limit(200)
      .lean();

    // Las últimas resueltas, para poder revisar una decisión reciente sin
    // tener que buscar en el log de auditoría.
    const recientes = await Medico.find({ estadoCuenta: { $in: ["aprobada", "rechazada"] }, "solicitud.resueltaEn": { $ne: null } })
      .select("phone nombre estadoCuenta matricula solicitud verificacionProfesional")
      .sort({ "solicitud.resueltaEn": -1 })
      .limit(15)
      .lean();

    res.json({ pendientes, recientes });
  }));

  // Reenvío explícito por el mismo operador autorizado, sin cambiar permisos.
  app.post("/medico/solicitudes-cuenta/:phone/reenviar-correo", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const m = await traerSolicitud(req.params.phone), aviso = m.solicitud?.correo;
    if (!aviso || !["error", "expirado", "sin_correo"].includes(aviso.estado) || req.body?.avisoId !== aviso.id) {
      throw new ErrorHttp(409, "El aviso cambió o no necesita reenvío. Actualizá el panel.");
    }
    if (!m.googleSub || !m.googleEmail) throw new ErrorHttp(409, "Esta cuenta no tiene un correo Google verificado.");
    const reciente = aviso.iniciadoEn && Date.now() - new Date(aviso.iniciadoEn).getTime() < 23 * 3600 * 1000;
    const campos = reciente
      ? { "solicitud.correo.estado": "pendiente", "solicitud.correo.intentos": 0, "solicitud.correo.proximoIntento": new Date() }
      : { "solicitud.correo": nuevoAvisoCuenta(aviso.tipo) };
    const r = await Medico.updateOne({ _id: m._id, "solicitud.correo.id": aviso.id, "solicitud.correo.estado": aviso.estado }, { $set: campos });
    if (!r.modifiedCount) throw new ErrorHttp(409, "El aviso cambió. Actualizá el panel.");
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "cuenta_correo_reintento", recurso: `Medico:${m.phone}` });
    res.json({ ok: true });
  }));

  // ─── APROBAR ───────────────────────────────────────────────────────────
  app.post("/medico/solicitudes-cuenta/:phone/aprobar", limitMedico, requireSesion, requireAprobador, asyncRoute(async (req, res) => {
    const quien = req.adminUser.usuario;
    const medico = await traerSolicitud(req.params.phone);

    if (!pendiente(medico)) throw new ErrorHttp(409, "Esta solicitud ya fue resuelta. Actualizá el panel.");
    const verificacion = revisionProfesional(medico, req.body, quien);
    const ahora = new Date();
    const conversion = medico.solicitud?.tipo === "conversion";
    const set = {
      estadoCuenta: "aprobada", activo: true, perfilAcceso: "profesional", verificacionProfesional: verificacion,
      matricula: verificacion.matricula, tipoEspecialidad: verificacion.tipoEspecialidad,
      sesionesDesde: ahora, "solicitud.estado": "aprobada", "solicitud.resueltaEn": ahora,
      "solicitud.resueltaPor": quien, "solicitud.motivo": "", "solicitud.correo": nuevoAvisoCuenta("aprobada"),
    };
    if (conversion) {
      // Conserva formación e historial, pero no convierte un plan de estudio en un plan clínico gratuito.
      set.formacion = { carrera: medico.estudiante.carrera || "medicina", nivel: verificacion.etapa, nivelEducativoAnterior: medico.estudiante.nivel,
        universidad: medico.estudiante.universidad || "", periodo: medico.formacion?.periodo || "", acreditacion: "invitacion" };
      set.especialidad = verificacion.profesion;
      set["suscripcion.ambito"] = "educativo";
    }
    const r = await Medico.updateOne(filtroRevision(medico), { $set: set,
      ...(conversion ? { $unset: { estudiante: 1 } } : {}) });
    if (!r.modifiedCount) throw new ErrorHttp(409, "La solicitud cambió mientras la revisabas. Actualizá el panel.");

    registrar({ req, medicoPhone: quien, accion: "cuenta_aprobada", recurso: `Medico:${medico.phone}`,
      detalle: `${medico.nombre} — matrícula ${verificacion.matricula} — ${verificacion.metodo}: ${verificacion.referencia}` });
    log.info(`[CUENTAS] ${quien} aprobó a ${medico.nombre} (${medico.phone})`);

    res.json({ ok: true, phone: medico.phone, nombre: medico.nombre });

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
    if (!pendiente(medico)) throw new ErrorHttp(409, "Esta solicitud ya fue resuelta. Actualizá el panel.");
    if (String(req.body?.revision ?? "") !== (medico.solicitud?.revision || "")) throw new ErrorHttp(409, "La solicitud cambió. Actualizá el panel.");
    const conversion = medico.solicitud?.tipo === "conversion";
    const set = { "solicitud.correo": nuevoAvisoCuenta("corregir"), "solicitud.estado": "rechazada", "solicitud.resueltaEn": new Date(), "solicitud.resueltaPor": quien, "solicitud.motivo": motivo };
    if (!conversion) Object.assign(set, { estadoCuenta: "rechazada", activo: false, sesionesDesde: new Date() });
    const r = await Medico.updateOne(filtroRevision(medico), { $set: set });
    if (!r.modifiedCount) throw new ErrorHttp(409, "La solicitud cambió mientras la revisabas. Actualizá el panel.");

    registrar({ req, medicoPhone: quien, accion: "cuenta_rechazada", recurso: `Medico:${medico.phone}`, detalle: motivo });
    log.info(`[CUENTAS] ${quien} rechazó a ${medico.nombre} (${medico.phone}): ${motivo}`);

    res.json({ ok: true, phone: medico.phone });
  }));
};
