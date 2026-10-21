const { Medico } = require("../db/models");
const { requireAuth } = require("../services/auth");
const google = require("../services/googleAcceso");
const { datosProfesionales, nuevaSolicitud } = require("../services/perfilesCuenta");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { limitAuth, limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const telefono = require("../services/verificarTelefono");
const requireSesion = requireAuth(["medico", "admin"]);

function datosDePerfil(m) {
  return { perfil: m.estudiante?.nivel ? "educativo" : "profesional", historica: !m.perfilAcceso,
    formacion: m.formacion, solicitud: m.solicitud,
    habilitacion: m.verificacionProfesional?.estado || "sin_verificacion_registrada",
    phone: m.phone, telefonoVerificado: Boolean(m.telefonoVerificado), whatsappDisponible: telefono.disponible() };
}

module.exports = function (app) {
  app.get("/medico/perfil-acceso", limitMedico, requireSesion, asyncRoute(async (req, res) => {
    const m = await Medico.findOne({ phone: req.adminUser.usuario });
    res.set("Cache-Control", "no-store").json(datosDePerfil(m));
  }));
  app.post("/medico/perfil-acceso/solicitar-profesional", limitAuth, requireSesion, asyncRoute(async (req, res) => {
    const m = await Medico.findOne({ phone: req.adminUser.usuario });
    if (!m.estudiante?.nivel) throw new ErrorHttp(409, "Esta solicitud corresponde a cuentas educativas.");
    if (m.solicitud?.tipo === "conversion" && m.solicitud.estado === "pendiente") throw new ErrorHttp(409, "Ya tenés una solicitud en revisión.");
    const solicitud = nuevaSolicitud(datosProfesionales(req.body), "conversion");
    const r = await Medico.updateOne({ _id: m._id, activo: true, "estudiante.nivel": { $exists: true },
      "solicitud.estado": { $ne: "pendiente" } }, { $set: { solicitud } });
    if (!r.modifiedCount) throw new ErrorHttp(409, "Tu cuenta cambió. Actualizá la pantalla.");
    registrar({ req, medicoPhone: m.phone, accion: "solicitar_cambio_profesional" });
    res.json({ ok: true, pendiente: true });
  }));
  // Un ticket de solicitud solo puede gestionar la solicitud y verificar su teléfono.
  // No se entrega un token clínico a una cuenta pendiente o rechazada.
  app.post("/medico/google/solicitud/actualizar", limitAuth, asyncRoute(async (req, res) => {
    const m = await google.cuentaDeSolicitud(req);
    const solicitud = nuevaSolicitud(datosProfesionales(req.body));
    const r = await Medico.updateOne({ _id: m._id, estadoCuenta: m.estadoCuenta,
      "solicitud.revision": m.solicitud?.revision || { $in: [null, ""] } }, { $set: {
      solicitud, estadoCuenta: "pendiente", activo: false, perfilAcceso: "profesional",
      verificacionProfesional: { estado: "pendiente" }, matricula: solicitud.matricula, tipoEspecialidad: solicitud.tipoEspecialidad,
      "formacion.nivel": solicitud.etapa,
    } });
    if (!r.modifiedCount) throw new ErrorHttp(409, "La solicitud cambió. Volvé a entrar con Google.");
    registrar({ req, medicoPhone: m.phone, accion: "actualizar_solicitud_profesional" });
    res.json({ ok: true, pendiente: true });
  }));
  for (const accion of ["enviar", "confirmar"]) {
    const ejecutar = async (req, res, m) => {
      const datos = await telefono[accion](m, req.body || {});
      if (accion === "confirmar") registrar({ req, medicoPhone: m.phone, accion: "telefono_verificado_whatsapp" });
      res.set("Cache-Control", "no-store").json(datos);
    };
    app.post(`/medico/telefono/${accion}`, limitAuth, requireSesion, asyncRoute(async (req, res) => {
      const m = await Medico.findOne({ phone: req.adminUser.usuario });
      await ejecutar(req, res, m);
    }));
    app.post(`/medico/google/solicitud/telefono/${accion}`, limitAuth, asyncRoute(async (req, res) => {
      await ejecutar(req, res, await google.cuentaDeSolicitud(req));
    }));
  }
};
