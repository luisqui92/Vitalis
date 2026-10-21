const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Medico } = require("../db/models");
const { generarToken, verificarToken, hashPassword } = require("./auth");
const { ErrorHttp } = require("./httpHelpers");
const identidad = require("./googleIdentidad");
const { esOperador } = require("./operadores");
const { soloDigitos } = require("./telefono");

const desafioSchema = new mongoose.Schema({
  nonce: { type: String, required: true, unique: true },
  vence: { type: Date, required: true, expires: 0 },
});
const DesafioGoogle = mongoose.models.DesafioGoogle || mongoose.model("DesafioGoogle", desafioSchema);
const COOKIE = "symphomed_google";
let indices;

function configuracion() {
  const clientId = String(CONFIG.GOOGLE_LOGIN_CLIENT_ID || "").trim();
  let origen;
  try { origen = new URL(CONFIG.APP_URL); } catch { return null; }
  if (!clientId.endsWith(".apps.googleusercontent.com") || origen.username || origen.password ||
      (origen.protocol !== "https:" && !(origen.protocol === "http:" && origen.hostname === "localhost"))) return null;
  return { clientId, origen: origen.origin, seguro: origen.protocol === "https:" };
}

function mismoOrigen(req) {
  const c = configuracion();
  if (!c) throw new ErrorHttp(503, "El acceso con Google todavía no está configurado.");
  if (req.headers.origin !== c.origen || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    throw new ErrorHttp(403, "Volvé a abrir Symphomed para continuar.");
  }
  return c;
}

function nonceDelNavegador(req) {
  const valor = String(req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  const p = verificarToken(valor ? valor.slice(COOKIE.length + 1) : "");
  if (!p || p.rol !== "google_navegador") throw new ErrorHttp(401, "Volvé a pulsar Continuar con Google.");
  return p.usuario;
}

async function asegurarIndices() {
  if (!indices) indices = Promise.all([
    Medico.collection.createIndex({ googleSub: 1 }, { unique: true, sparse: true }),
    DesafioGoogle.createIndexes(),
  ]).catch(e => { indices = null; throw e; });
  await indices;
}

async function iniciar(req, res) {
  const c = mismoOrigen(req);
  await asegurarIndices();
  const nonce = crypto.randomBytes(32).toString("base64url");
  await DesafioGoogle.create({ nonce, vence: new Date(Date.now() + 600000) });
  res.cookie(COOKIE, generarToken(nonce, "google_navegador", 600000), {
    httpOnly: true, secure: c.seguro, sameSite: "lax", path: "/medico", maxAge: 600000,
  });
  return { clientId: c.clientId, nonce };
}

async function comprobar(req) {
  const c = mismoOrigen(req);
  const nonce = nonceDelNavegador(req);
  let perfil;
  try { perfil = await identidad.verificarGoogle(req.body?.credential, c.clientId, nonce); }
  catch { throw new ErrorHttp(401, "No pudimos verificar Google. Volvé a intentarlo."); }
  const desafio = await DesafioGoogle.findOneAndDelete({ nonce, vence: { $gt: new Date() } });
  if (!desafio) throw new ErrorHttp(401, "Este acceso ya se usó o venció. Volvé a pulsar Google.");
  return { ...perfil, nonce };
}

function ticketRegistro(perfil) {
  return generarToken(perfil.sub, "google_registro", 600000, {
    email: perfil.email, nombre: perfil.nombre, nonce: perfil.nonce,
  });
}

// Ambos registros llaman al mismo servicio. Google no decide el rol ni la carrera.
async function identidadParaRegistro(req) {
  if (!req.body?.googleTicket) return null;
  mismoOrigen(req);
  const p = verificarToken(req.body.googleTicket);
  if (!p || p.rol !== "google_registro" || p.nonce !== nonceDelNavegador(req)) {
    throw new ErrorHttp(401, "La confirmación de Google venció. Volvé a entrar con Google.");
  }
  await asegurarIndices();
  if (esOperador(soloDigitos(req.body.phone))) {
    throw new ErrorHttp(409, "Ese teléfono requiere una cuenta existente. Ingresá por tu acceso habitual y vinculá Google desde Configuración.");
  }
  if (await Medico.exists({ googleSub: p.usuario })) throw new ErrorHttp(409, "Esta cuenta de Google ya está registrada. Volvé a ingresar.");
  return {
    googleSub: p.usuario, googleEmail: p.email, googleVinculadoEn: new Date(),
    googleSolo: true, telefonoVerificado: false,
    // Compatible con las cuentas actuales, sin crear una contraseña conocida.
    passwordHash: await hashPassword(crypto.randomBytes(48).toString("base64url")),
  };
}

function comprobarEstado(medico) {
  if (medico.estadoCuenta === "pendiente") throw new ErrorHttp(403, "Tu solicitud todavía está en revisión.");
  if (medico.estadoCuenta === "rechazada" || !medico.activo) throw new ErrorHttp(403, "Tu cuenta no está habilitada. Contactá con Symphomed.");
}

module.exports = { configuracion, mismoOrigen, iniciar, comprobar, ticketRegistro, identidadParaRegistro, comprobarEstado };
