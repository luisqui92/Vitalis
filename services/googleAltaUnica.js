const { Medico, AuditLog } = require("../db/models");
const { comprobarEstado } = require("./googleAcceso");
const { patronTelefono } = require("./googleVinculacion");
const { soloDigitos } = require("./telefono");
const { ErrorHttp } = require("./httpHelpers");

async function autorizar(telefono, actor) {
  const cuentas = await Medico.find({ phone: patronTelefono(telefono) }).limit(2).lean();
  if (cuentas.length !== 1) throw new Error("El teléfono no identifica una única cuenta. No se modificó nada.");
  const m = cuentas[0];
  comprobarEstado(m);
  if (m.googleSub || m.googleSolo || m.googleAltaUnica?.usadaEn) throw new Error("La cuenta ya tiene Google o ya utilizó esta excepción.");
  // Se usa el correo que el operador autorizó como perteneciente al cliente.
  // Nunca tomarlo del formulario de registro ni adivinarlo por el teléfono.
  const email = String(m.googleEmail || m.email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Esta cuenta NO tiene un correo guardado válido. No se habilitó la excepción. Hace falta confirmar el correo del cliente.");
  }
  const ahora = new Date();
  const autorizacion = { telefono: soloDigitos(m.phone), email, autorizadaEn: ahora,
    autorizadaPor: actor, vence: new Date(ahora.getTime() + 48 * 3600000) };
  await AuditLog.create({ medicoPhone: actor, accion: "autorizar_google_alta_unica", recurso: `Medico:${m._id}`,
    detalle: "Un solo uso durante 48 horas; Google debe confirmar el correo preexistente" });
  const r = await Medico.updateOne({ _id: m._id, phone: m.phone, activo: true, googleSub: { $exists: false },
    "googleAltaUnica.usadaEn": { $exists: false },
    email: m.email === undefined ? { $exists: false } : m.email,
    googleEmail: m.googleEmail === undefined ? { $exists: false } : m.googleEmail },
  { $set: { googleAltaUnica: autorizacion } });
  if (!r.modifiedCount) throw new Error("La cuenta cambió. No se autorizó la excepción.");
  return { nombre: m.nombre, telefono: m.phone, email, vence: autorizacion.vence };
}

// `identidad` proviene EXCLUSIVAMENTE de identidadParaRegistro: ticket firmado
// por el servidor, identidad Google verificada y cookie/nonce del mismo navegador.
async function intentar(telefono, identidad) {
  if (!identidad?.googleSub || !identidad.googleEmail) return null;
  const m = await Medico.findOne({ "googleAltaUnica.telefono": soloDigitos(telefono) }).lean();
  if (!m) return null; // No cambia el registro del resto de las cuentas.
  const a = m.googleAltaUnica;
  if (soloDigitos(m.phone) !== soloDigitos(telefono) || a.usadaEn || m.googleSub || m.googleSolo || !(a.vence > new Date())) {
    throw new ErrorHttp(409, "Esta autorización ya se usó o venció. Si ya vinculaste Google, volvé a ingresar con Google.");
  }
  if (identidad.googleEmail.toLowerCase() !== a.email) {
    throw new ErrorHttp(403, "Elegí el Google que corresponde al correo ya registrado en tu cuenta.");
  }
  comprobarEstado(m);
  const filtro = { _id: m._id, phone: m.phone, activo: true, googleSub: { $exists: false },
    "googleAltaUnica.telefono": a.telefono, "googleAltaUnica.email": a.email,
    "googleAltaUnica.vence": { $gt: new Date() }, "googleAltaUnica.usadaEn": { $exists: false } };
  for (const [campo, valor] of Object.entries({ rol: m.rol, estadoCuenta: m.estadoCuenta, perfilAcceso: m.perfilAcceso,
    "verificacionProfesional.estado": m.verificacionProfesional?.estado, "dosFA.activo": m.dosFA?.activo,
    "dosFA.secreto": m.dosFA?.secreto })) filtro[campo] = valor === undefined ? { $exists: false } : valor;
  const ahora = new Date();
  const cambios = { googleSub: identidad.googleSub, googleEmail: identidad.googleEmail,
    googleVinculadoEn: ahora, sesionesDesde: ahora, "googleAltaUnica.usadaEn": ahora };
  let r;
  try { r = await Medico.updateOne(filtro, { $set: cambios, $unset: { googleEnlaceSoporte: "" } }); }
  catch (e) {
    if (e.code === 11000) throw new ErrorHttp(409, "Ese Google ya está asociado a otra cuenta.");
    throw e;
  }
  if (!r.modifiedCount) throw new ErrorHttp(409, "La cuenta cambió o la autorización ya fue utilizada. Volvé a ingresar con Google.");
  return { ...m, googleSub: identidad.googleSub, googleEmail: identidad.googleEmail, sesionesDesde: ahora };
}

module.exports = { autorizar, intentar };
