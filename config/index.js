// Vitalis — Config y Logger

const CONFIG = {
  OPENAI_KEY: process.env.OPENAI_KEY,
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  APP_URL: process.env.APP_URL || "",

  TIMEOUT_OPENAI: 45000,
  TIMEOUT_ASSEMBLYAI: 120000, // por cada llamada (subir audio, pedir transcripción, cada poll)
  TIMEOUT_TRANSCRIPCION_TOTAL: 1200000, // 20 min: corre en segundo plano, hay margen de sobra para consultas de 45 min

  // Usado por services/utils.js (fechaStrBolivia) para calcular el día
  // boliviano (vinculación del celular como micrófono remoto).
  OFFSET_HORAS: -4,

  // ─── WhatsApp de reservas (Baileys, corre en este mismo proceso) + Google
  // Calendar. Si no están configuradas, esos servicios fallan de forma
  // controlada (no rompen el resto de la app).
  SALUD_WHATSAPP_MEDICO_PHONE: process.env.SALUD_WHATSAPP_MEDICO_PHONE || "",
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
};

// ─── LOGGER ────────────────────────────────────────────────────────────────
const log = {
  info:  (...a) => console.log(new Date().toISOString(), "[INFO]",  ...a),
  warn:  (...a) => console.warn(new Date().toISOString(), "[WARN]",  ...a),
  error: (...a) => console.error(new Date().toISOString(), "[ERROR]", ...a),
  debug: (...a) => console.log(new Date().toISOString(), "[DEBUG]", ...a),
};

if (!process.env.JWT_SECRET) {
  log.error("❌ JWT_SECRET no está definido. Generá uno con: openssl rand -hex 32");
}
if (!process.env.ASSEMBLYAI_API_KEY) {
  log.warn("⚠️  ASSEMBLYAI_API_KEY no configurado — la transcripción de consultas fallará hasta que lo configures.");
}
if (process.env.SALUD_WHATSAPP_MEDICO_PHONE && !process.env.APP_URL) {
  log.error("❌ APP_URL no está definido — el link de reserva que manda el WhatsApp va a salir roto (sin dominio). Definilo como, por ejemplo: APP_URL=https://salud.chatgo.ia.bo");
}

// ─── VALIDACIÓN DE VARIABLES DE ENTORNO ─────────────────────────────────────
function validateConfig() {
  const required = ["MONGODB_URI", "OPENAI_KEY"];
  const warned = ["JWT_SECRET", "ASSEMBLYAI_API_KEY", "SALUD_WHATSAPP_MEDICO_PHONE", "GOOGLE_SERVICE_ACCOUNT_JSON", "APP_URL"];
  const missing = required.filter(k => !process.env[k]);
  const warnings = warned.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error("❌ Faltan variables de entorno requeridas:", missing.join(", "));
    console.error("   Vitalis NO puede arrancar sin estas variables.");
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.warn("⚠️ Variables opcionales no definidas:", warnings.join(", "));
    console.warn("   Vitalis funciona igual, pero esas funciones específicas van a estar apagadas.");
  }
  return true;
}

module.exports = { CONFIG, log, validateConfig };
