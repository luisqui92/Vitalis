const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const { ErrorHttp } = require("./httpHelpers");
const { enviarCodigoAcceso } = require("./metaWhatsapp");

const schema = new mongoose.Schema({
  _id: String, ventanaDesde: Date, envios: Number, ultimoEnvio: Date,
  nonce: String, codigoHash: String, vence: Date, intentos: Number, listo: Boolean,
});
const Desafio = mongoose.models.VerificacionTelefono || mongoose.model("VerificacionTelefono", schema);
const DIA = 86400000, MINUTO = 60000;
function disponible() { return Boolean(CONFIG.WHATSAPP_TOKEN && CONFIG.WHATSAPP_PHONE_NUMBER_ID && CONFIG.WHATSAPP_AUTH_TEMPLATE && process.env.JWT_SECRET); }
function hash(phone, nonce, codigo) { return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${phone}:${nonce}:${codigo}`).digest("hex"); }

async function enviar(m) {
  if (m.telefonoVerificado) return { ok: true, verificado: true };
  if (!disponible()) throw new ErrorHttp(503, "La verificación por WhatsApp todavía no está configurada. Tu teléfono sigue sin verificar.");
  if (!/^[1-9]\d{7,14}$/.test(m.phone)) throw new ErrorHttp(400, "El teléfono necesita código de país. Contactá con soporte para corregirlo.");
  const ahora = new Date();
  try { await Desafio.create({ _id: m.phone, ventanaDesde: ahora, envios: 0, ultimoEnvio: new Date(0), intentos: 0, listo: false }); }
  catch (e) { if (e.code !== 11000) throw e; }
  await Desafio.updateOne({ _id: m.phone, ventanaDesde: { $lte: new Date(+ahora - DIA) } }, { $set: { ventanaDesde: ahora, envios: 0 } });
  const nonce = crypto.randomBytes(24).toString("hex");
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const reservado = await Desafio.findOneAndUpdate({ _id: m.phone, envios: { $lt: 5 }, ultimoEnvio: { $lte: new Date(+ahora - MINUTO) } }, {
    $set: { nonce, codigoHash: hash(m.phone, nonce, codigo), vence: new Date(+ahora + 10 * MINUTO), ultimoEnvio: ahora, intentos: 0, listo: false },
    $inc: { envios: 1 },
  }, { new: true });
  if (!reservado) throw new ErrorHttp(429, "Esperá un minuto entre envíos. El máximo es cinco códigos cada 24 horas.");
  try {
    const r = await enviarCodigoAcceso(m.phone, codigo);
    if (!r?.messages?.[0]?.id) throw new Error("sin confirmación del proveedor");
  } catch {
    // No registrar códigos, respuestas del proveedor ni credenciales.
    throw new ErrorHttp(502, "No se pudo enviar el código por WhatsApp. Tu teléfono sigue sin verificar. Intentá más tarde.");
  }
  await Desafio.updateOne({ _id: m.phone, nonce }, { $set: { listo: true } });
  return { ok: true, enviado: true, venceEn: 600, reenviarEn: 60 };
}

async function confirmar(m, body) {
  if (m.telefonoVerificado) return { ok: true, verificado: true };
  const codigo = typeof body.codigo === "string" ? body.codigo.trim() : "";
  if (!/^\d{6}$/.test(codigo)) throw new ErrorHttp(400, "Ingresá los seis dígitos del código.");
  // Reserva atómica de un intento, incluso para intentos concurrentes.
  const d = await Desafio.findOneAndUpdate({ _id: m.phone, listo: true, vence: { $gt: new Date() }, intentos: { $lt: 5 } }, { $inc: { intentos: 1 } }, { new: true });
  if (!d) throw new ErrorHttp(400, "El código venció, ya se usó o agotó los intentos. Solicitá uno nuevo.");
  const esperado = Buffer.from(d.codigoHash, "hex"), recibido = Buffer.from(hash(m.phone, d.nonce, codigo), "hex");
  if (esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) throw new ErrorHttp(400, "Código incorrecto.");
  const r = await Desafio.updateOne({ _id: m.phone, nonce: d.nonce, listo: true, codigoHash: d.codigoHash, vence: { $gt: new Date() } }, {
    $set: { listo: false }, $unset: { codigoHash: 1 },
  });
  if (!r.modifiedCount) throw new ErrorHttp(409, "El código cambió o ya se usó. Intentá de nuevo.");
  const cuenta = await Medico.updateOne({ _id: m._id, phone: m.phone }, { $set: { telefonoVerificado: true, telefonoVerificadoEn: new Date() } });
  if (!cuenta.matchedCount) throw new ErrorHttp(409, "Tu cuenta cambió. Volvé a ingresar.");
  return { ok: true, verificado: true };
}

module.exports = { disponible, enviar, confirmar };
