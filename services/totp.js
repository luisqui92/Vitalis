// Symphomed — 2FA con TOTP (RFC 6238), compatible con Google Authenticator /
// Authy / cualquier app estándar. Sin librería externa: es HMAC-SHA1 +
// truncamiento dinámico (RFC 4226) sobre el tiempo actual — Node ya trae
// todo lo necesario en el módulo "crypto".
const crypto = require("crypto");

const PERIODO_SEG = 30; // ventana estándar de Google Authenticator
const DIGITOS = 6;

// ─── Base32 (RFC 4648, sin padding) — los apps de 2FA esperan el secreto
// codificado así, no en hex/base64. ────────────────────────────────────
const ALFABETO_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "", salida = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) {
    const trozo = bits.slice(i, i + 5).padEnd(5, "0");
    salida += ALFABETO_B32[parseInt(trozo, 2)];
  }
  return salida;
}

function base32Decode(str) {
  const limpio = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of limpio) bits += ALFABETO_B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generarSecreto() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, el tamaño estándar recomendado
}

// HOTP (RFC 4226): HMAC-SHA1(secreto, contador de 8 bytes big-endian) →
// truncamiento dinámico → últimos DIGITOS dígitos decimales.
function hotp(secretoBase32, contador) {
  const key = base32Decode(secretoBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codigo =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codigo % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

function totp(secretoBase32, tiempoMs = Date.now()) {
  const contador = Math.floor(tiempoMs / 1000 / PERIODO_SEG);
  return hotp(secretoBase32, contador);
}

// Acepta el código del paso actual y un paso antes/después (±30s) para
// tolerar el reloj del celular ligeramente desincronizado — sin esto,
// cualquier pequeño desfasaje deja al médico bloqueado afuera.
//
// Con { devolverPaso: true } devuelve el número del paso de 30 s que
// coincidió (o null), para que el login rechace un código ya usado: dentro
// de su ventana, el mismo código visto por encima del hombro servía otra vez
// (routes/medicoAuth.js, auditoría de QA B-L3).
function verificarCodigo(secretoBase32, codigo, ventana = 1, { devolverPaso = false } = {}) {
  const no = devolverPaso ? null : false;
  const limpio = String(codigo || "").trim();
  if (!/^\d{6}$/.test(limpio)) return no;
  const ahora = Date.now();
  for (let paso = -ventana; paso <= ventana; paso++) {
    const instante = ahora + paso * PERIODO_SEG * 1000;
    if (totp(secretoBase32, instante) === limpio) {
      return devolverPaso ? Math.floor(instante / 1000 / PERIODO_SEG) : true;
    }
  }
  return no;
}

function generarUriOtpAuth(secretoBase32, cuenta, emisor = "Symphomed") {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  const params = new URLSearchParams({
    secret: secretoBase32,
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PERIODO_SEG),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}

module.exports = { generarSecreto, totp, verificarCodigo, generarUriOtpAuth, base32Encode, base32Decode };
