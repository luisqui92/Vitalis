const crypto = require("crypto");
const { Medico, AuditLog } = require("../db/models");
const google = require("./googleAcceso");
const { verificarCodigo } = require("./totp");
const { ErrorHttp } = require("./httpHelpers");

const DURACION = 2 * 60 * 60 * 1000;
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
const sinGoogle = { googleSub: { $exists: false } };

// Solo para la herramienta de soporte: no cambia la identidad usada por las fichas.
function patronTelefono(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  if (!/^\d{6,15}$/.test(digitos)) throw new Error("Escribí el teléfono con código de país (6 a 15 dígitos).");
  const separador = "[\\s()+.\\-]*";
  return new RegExp("^" + separador + digitos.split("").join(separador) + separador + "$");
}

function comprobarCuenta(m) {
  if (!m) throw new ErrorHttp(404, "No encontramos la cuenta.");
  google.comprobarEstado(m);
  if (m.googleSub || m.googleSolo) throw new ErrorHttp(409, "Esta cuenta ya tiene acceso con Google. No se reemplazará su identidad.");
}

// La emisión solo existe en CLI; ninguna ruta pública puede autorizar un enlace.
async function emitir({ cuentaId, email, actor }) {
  const config = google.configuracion();
  if (!config) throw new Error("Google no está configurado en este servidor.");
  email = String(email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Indicá el correo de Google del cliente.");
  const m = await Medico.findById(cuentaId);
  comprobarCuenta(m);
  const token = crypto.randomBytes(32).toString("base64url");
  const ahora = new Date(), vence = new Date(ahora.getTime() + DURACION);
  await AuditLog.create({ medicoPhone: actor, accion: "autorizar_vinculacion_google_ssh", recurso: `Medico:${m._id}`,
    detalle: "Autorización de soporte, correo restringido, validez de 2 horas" });
  const r = await Medico.updateOne({ _id: m._id, ...sinGoogle, activo: true }, { $set: {
    googleEnlaceSoporte: { hash: hashToken(token), email, vence, creadoEn: ahora, creadoPor: actor },
  } });
  if (!r.modifiedCount) throw new Error("La cuenta cambió; no se emitió el enlace.");
  return { enlace: config.origen + "/#vincular-google=" + token, vence };
}

async function confirmar(req) {
  google.mismoOrigen(req);
  const token = String(req.body?.enlaceToken || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ErrorHttp(400, "El enlace no es válido.");
  const filtro = { "googleEnlaceSoporte.hash": hashToken(token), "googleEnlaceSoporte.vence": { $gt: new Date() }, ...sinGoogle };
  const m = await Medico.findOne(filtro).lean();
  if (!m) throw new ErrorHttp(410, "El enlace venció, ya fue usado o fue reemplazado. Pedí uno nuevo a Symphomed.");
  comprobarCuenta(m);
  if (m.dosFA?.activo && !verificarCodigo(m.dosFA.secreto, String(req.body?.codigo || ""))) {
    throw new ErrorHttp(401, "Ingresá el código de tu app autenticadora. La vinculación no elimina el segundo factor.");
  }
  const identidad = await google.comprobar(req);
  if (identidad.email.toLowerCase() !== m.googleEnlaceSoporte.email) {
    throw new ErrorHttp(403, "Elegí la cuenta de Google que confirmaste con soporte.");
  }
  // La actualización y el consumo son un único cambio atómico, incluso con dos pestañas.
  // Los cambios de estado, permisos o 2FA mientras Google responde invalidan la operación.
  const guardas = { activo: true };
  for (const [k, valor] of Object.entries({ estadoCuenta: m.estadoCuenta, perfilAcceso: m.perfilAcceso,
    "verificacionProfesional.estado": m.verificacionProfesional?.estado,
    "dosFA.activo": m.dosFA?.activo, "dosFA.secreto": m.dosFA?.secreto })) {
    guardas[k] = valor === undefined ? { $exists: false } : valor;
  }
  let r;
  try {
    r = await Medico.updateOne({ ...filtro, ...guardas, _id: m._id, "googleEnlaceSoporte.vence": { $gt: new Date() } }, {
      $set: { googleSub: identidad.sub, googleEmail: identidad.email, googleVinculadoEn: new Date(), sesionesDesde: new Date() },
      $unset: { googleEnlaceSoporte: "" },
    });
  } catch (e) {
    if (e.code === 11000) throw new ErrorHttp(409, "Ese Google ya pertenece a otra cuenta de Symphomed. Contactá con soporte.");
    throw e;
  }
  if (!r.modifiedCount) throw new ErrorHttp(409, "La cuenta o el enlace cambiaron. Volvé a consultar con soporte.");
  return { phone: m.phone, cuentaId: m._id };
}

module.exports = { patronTelefono, emitir, confirmar };
