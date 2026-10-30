const crypto = require("crypto");
const { Medico, AuditLog } = require("../db/models");
const { comprobarEstado } = require("./googleAcceso");
const { patronTelefono } = require("./googleVinculacion");
const { soloDigitos } = require("./telefono");
const { ErrorHttp } = require("./httpHelpers");

const sinGoogle = { googleSub: { $exists: false } };
function vigente(m) {
  return Boolean(m?.googleRevision?.habilitada && m.googleRevision.vence > new Date() &&
    !m.googleRevision.usadaEn && !m.googleSub && !m.googleSolo);
}
function filtro(m) {
  return { _id: m._id, ...sinGoogle, "googleRevision.habilitada": true,
    "googleRevision.revision": m.googleRevision.revision,
    "googleRevision.vence": { $gt: new Date() }, "googleRevision.usadaEn": { $exists: false } };
}

// Solo SSH: habilita revisión humana para la cuenta elegida, sin conocer su email.
async function habilitar(telefono, actor) {
  const cuentas = await Medico.find({ phone: patronTelefono(telefono) }).limit(2).lean();
  if (cuentas.length !== 1) throw new Error("El teléfono no identifica una sola cuenta. No se modificó nada.");
  const m = cuentas[0]; comprobarEstado(m);
  if (m.googleSub || m.googleSolo || m.googleRevision?.usadaEn || m.googleAltaUnica?.usadaEn) throw new Error("La cuenta ya fue vinculada. No se reemplaza Google.");
  const ahora = new Date(), vence = new Date(ahora.getTime() + 48 * 3600000);
  await AuditLog.create({ medicoPhone: actor, accion: "habilitar_revision_google", recurso: `Medico:${m._id}` });
  const r = await Medico.updateOne({ _id: m._id, phone: m.phone, activo: true, ...sinGoogle,
    "googleRevision.usadaEn": { $exists: false } }, { $set: {
    "googleRevision.telefono": soloDigitos(m.phone), "googleRevision.habilitada": true,
    "googleRevision.revision": crypto.randomUUID(), "googleRevision.vence": vence,
    "googleRevision.autorizadaPor": actor, "googleRevision.autorizadaEn": ahora,
  }, $unset: { googleAltaUnica: "", googleEnlaceSoporte: "" } });
  if (!r.modifiedCount) throw new Error("La cuenta cambió. No se habilitó la revisión.");
  return { nombre: m.nombre, telefono: m.phone, vence };
}

// La identidad viene del ticket Google validado, nunca del correo del formulario.
async function solicitar(telefono, identidad) {
  if (!identidad?.googleSub || !identidad.googleEmail) return false;
  const m = await Medico.findOne({ "googleRevision.telefono": soloDigitos(telefono) }).lean();
  if (!m) return false;
  if (!vigente(m) || soloDigitos(m.phone) !== soloDigitos(telefono)) throw new ErrorHttp(409, "La vinculación ya se resolvió o venció. Volvé a ingresar con Google o contactá con Symphomed.");
  comprobarEstado(m);
  const solicitudes = m.googleRevision.solicitudes || [];
  const previa = solicitudes.find(s => s.googleSub === identidad.googleSub);
  if (previa?.estado === "pendiente") return true;
  if (previa) throw new ErrorHttp(409, "La solicitud ya fue revisada. Contactá con Symphomed.");
  if (solicitudes.length >= 50) throw new ErrorHttp(429, "Contactá con Symphomed para revisar la vinculación.");
  const solicitud = { id: crypto.randomUUID(), googleSub: identidad.googleSub,
    email: identidad.googleEmail, nombre: String(identidad.googleNombre || "").slice(0, 120),
    creadaEn: new Date(), estado: "pendiente" };
  const r = await Medico.updateOne({ ...filtro(m), activo: true }, {
    $push: { "googleRevision.solicitudes": solicitud },
    $set: { "googleRevision.revision": crypto.randomUUID() },
  });
  if (!r.modifiedCount) throw new ErrorHttp(409, "La solicitud cambió. Volvé a intentar.");
  return true;
}

async function pendientes() {
  const cuentas = await Medico.find({ ...sinGoogle, activo: true, "googleRevision.habilitada": true,
    "googleRevision.vence": { $gt: new Date() }, "googleRevision.usadaEn": { $exists: false },
    "googleRevision.solicitudes.estado": "pendiente" }).select("nombre phone googleRevision").limit(50).lean();
  return cuentas.flatMap(m => (m.googleRevision.solicitudes || []).filter(s => s.estado === "pendiente").map(s => ({
    cuentaId: String(m._id), solicitudId: s.id, nombre: m.nombre, phone: m.phone,
    email: s.email, creadaEn: s.creadaEn,
  }))).sort((a, b) => new Date(a.creadaEn) - new Date(b.creadaEn));
}

async function decidir({ cuentaId, solicitudId, aprobar, email, actor }) {
  if (!/^[a-f\d]{24}$/i.test(String(cuentaId)) || !/^[a-f\d-]{36}$/i.test(String(solicitudId))) throw new ErrorHttp(400, "Solicitud inválida.");
  const m = await Medico.findById(cuentaId).lean();
  const s = m?.googleRevision?.solicitudes?.find(s => s.id === solicitudId && s.estado === "pendiente");
  if (!vigente(m) || !s) throw new ErrorHttp(409, "La solicitud ya se resolvió o venció. Actualizá el panel.");
  if (aprobar && email !== s.email) throw new ErrorHttp(409, "Revisá el correo de la solicitud antes de aprobar.");
  if (aprobar) comprobarEstado(m);
  const ahora = new Date();
  const consulta = { ...filtro(m), "googleRevision.solicitudes": { $elemMatch: { id: s.id, estado: "pendiente" } } };
  if (aprobar) {
    // No habilitar ni recuperar permisos que hayan cambiado mientras se revisaba.
    for (const [k, v] of Object.entries({ activo: m.activo, phone: m.phone, rol: m.rol,
      estadoCuenta: m.estadoCuenta, perfilAcceso: m.perfilAcceso,
      "verificacionProfesional.estado": m.verificacionProfesional?.estado,
      "dosFA.activo": m.dosFA?.activo, "dosFA.secreto": m.dosFA?.secreto })) consulta[k] = v === undefined ? { $exists: false } : v;
  }
  const cambios = { "googleRevision.revision": crypto.randomUUID(),
    "googleRevision.solicitudes.$.estado": aprobar ? "aprobada" : "rechazada",
    "googleRevision.solicitudes.$.decididaPor": actor, "googleRevision.solicitudes.$.decididaEn": ahora };
  if (aprobar) Object.assign(cambios, { googleSub: s.googleSub, googleEmail: s.email,
    googleVinculadoEn: ahora, sesionesDesde: ahora, "googleRevision.usadaEn": ahora,
    "googleRevision.habilitada": false });
  let r;
  try { r = await Medico.updateOne(consulta, { $set: cambios }); }
  catch (e) {
    if (e.code === 11000) throw new ErrorHttp(409, "Ese Google ya está asociado a otra cuenta. No se vinculó.");
    throw e;
  }
  if (!r.modifiedCount) throw new ErrorHttp(409, "La solicitud cambió. Actualizá el panel antes de decidir.");
  return { phone: m.phone };
}

module.exports = { habilitar, solicitar, pendientes, decidir };
