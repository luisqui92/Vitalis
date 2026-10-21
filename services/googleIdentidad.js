// Google Identity Services: firma y claims del ID token, nunca datos del formulario.
const crypto = require("crypto");
let cache = { keys: [], hasta: 0 };
let cargando;

async function clavesGoogle() {
  if (cache.hasta > Date.now()) return cache.keys;
  if (!cargando) cargando = (async () => {
    const { data } = await require("axios").get("https://www.googleapis.com/oauth2/v3/certs", {
      timeout: 10000, maxRedirects: 0, maxContentLength: 131072,
    });
    if (!Array.isArray(data.keys) || !data.keys.length) throw new Error("Google no disponible");
    cache = { keys: data.keys, hasta: Date.now() + 60000 };
    return cache.keys;
  })().finally(() => { cargando = null; });
  return cargando;
}

function validarTokenGoogle(token, clientId, nonce, claves, ahora = Date.now()) {
  if (typeof token !== "string" || token.length > 16000 || !clientId || !nonce) throw new Error("Credencial inválida");
  const partes = token.split(".");
  if (partes.length !== 3 || partes.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error("Credencial inválida");
  const cabecera = JSON.parse(Buffer.from(partes[0], "base64url").toString());
  if (cabecera.alg !== "RS256" || typeof cabecera.kid !== "string") throw new Error("Firma inválida");
  const jwk = claves.find(k => k.kid === cabecera.kid && k.kty === "RSA" && k.alg === "RS256" && k.use === "sig");
  if (!jwk) throw new Error("Firma inválida");
  const clave = crypto.createPublicKey({ key: jwk, format: "jwk" });
  if (!crypto.verify("RSA-SHA256", Buffer.from(partes[0] + "." + partes[1]), clave, Buffer.from(partes[2], "base64url"))) {
    throw new Error("Firma inválida");
  }
  const p = JSON.parse(Buffer.from(partes[1], "base64url").toString());
  const segundos = Math.floor(ahora / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(p.iss) || p.aud !== clientId ||
      (p.azp !== undefined && p.azp !== clientId) || p.nonce !== nonce ||
      !Number.isFinite(p.exp) || p.exp <= segundos || !Number.isFinite(p.iat) || p.iat > segundos + 60 ||
      p.iat < segundos - 600 || p.exp - p.iat > 7200 ||
      typeof p.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(p.sub) || p.email_verified !== true ||
      typeof p.email !== "string" || p.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    throw new Error("Identidad inválida o vencida");
  }
  return { sub: p.sub, email: p.email, nombre: String(p.name || "").slice(0, 120) };
}

async function verificarGoogle(token, clientId, nonce) {
  return validarTokenGoogle(token, clientId, nonce, await clavesGoogle());
}
module.exports = { verificarGoogle, validarTokenGoogle };
