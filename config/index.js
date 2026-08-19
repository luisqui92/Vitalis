// Vitalis — Config y Logger

// Sin esto, un .env en el servidor es solo un archivo de texto sin efecto —
// las variables de entorno tienen que venir sí o sí del entorno real del
// proceso (systemd, el ecosystem de PM2, o exportadas a mano en la shell).
// override:true es a propósito: PM2 puede tener variables viejas guardadas
// internamente desde el primer arranque del proceso (ej. una contraseña de
// Mongo ya rotada) que sobreviven a "pm2 restart --update-env" — sin esto,
// dotenv las respeta y el .env del disco queda sin efecto aunque lo edites.
// El .env tiene que ser siempre la fuente de verdad.
require("dotenv").config({ override: true });

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

  // WhatsApp de reservas — API oficial de Meta (reemplaza a Baileys/QR).
  // WHATSAPP_TOKEN: token de acceso (Meta → tu app → WhatsApp → API Setup).
  // WHATSAPP_PHONE_NUMBER_ID: el ID interno del número (no el número en sí).
  // WHATSAPP_VERIFY_TOKEN: string que vos definís, y se configura IGUAL del
  // lado de Meta al guardar la Callback URL — confirma que la verificación
  // del webhook la está pidiendo realmente Meta.
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",

  // "Súper número": un mismo WhatsApp que reparte entre varios consultorios
  // propios (uno por especialidad) — el paciente primero elige cuál busca,
  // y de ahí en más esa conversación queda atada a ESE médico. Lista de
  // teléfonos de Medico, en el orden en que se muestran; vacío = se
  // mantiene el comportamiento de siempre (un solo consultorio fijo, con
  // SALUD_WHATSAPP_MEDICO_PHONE).
  WHATSAPP_ESPECIALIDADES_MEDICOS: (process.env.WHATSAPP_ESPECIALIDADES_MEDICOS || "").split(",").map(s => s.trim()).filter(Boolean),

  // Recepcionista de voz (Vapi): secreto compartido para verificar que un
  // webhook de /vapi/webhook/:medicoPhone realmente viene de Vapi (se
  // configura igual en el dashboard de Vapi, como credencial del Server
  // URL) — sin esto, cualquiera que adivine la URL podría agendar/cancelar
  // citas a nombre de un paciente.
  VAPI_SERVER_SECRET: process.env.VAPI_SERVER_SECRET || "",

  // Llamada de voz por navegador (sin número de teléfono): la página
  // pública de reserva usa el SDK web de Vapi con estas dos — a
  // diferencia de VAPI_SERVER_SECRET, estas SÍ se exponen al navegador
  // (vía GET /reserva-publica/config), es justamente para lo que están
  // pensadas — Vapi las llama "Public Key" y Assistant ID, no dan acceso
  // a nada sensible por sí solas.
  VAPI_PUBLIC_KEY: process.env.VAPI_PUBLIC_KEY || "",
  VAPI_ASSISTANT_ID: process.env.VAPI_ASSISTANT_ID || "",

  // Notificaciones del navegador (Web Push). La pública se le entrega al
  // navegador para suscribirse; la privada firma cada envío y no sale de
  // acá. Se generan una sola vez con:
  //   node -e "console.log(require('web-push').generateVAPIDKeys())"
  // Si se cambian, todas las suscripciones existentes dejan de servir y
  // cada médico tiene que volver a activar las notificaciones.
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || "",
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || "",
  // A quién contactar si desde este servidor se manda push mal formado.
  // Solo se acepta mailto: o https:.
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || "mailto:soporte@chatgo.ia.bo",
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
  // JWT_SECRET es requerida (no solo advertida): sin ella, crypto.createHmac
  // revienta en el primer login/request autenticado con un error críptico en
  // vez de fallar limpio al arrancar.
  const required = ["MONGODB_URI", "OPENAI_KEY", "JWT_SECRET"];
  const warned = ["ASSEMBLYAI_API_KEY", "SALUD_WHATSAPP_MEDICO_PHONE", "GOOGLE_SERVICE_ACCOUNT_JSON", "APP_URL", "VAPI_SERVER_SECRET", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ESPECIALIDADES_MEDICOS", "VAPI_PUBLIC_KEY", "VAPI_ASSISTANT_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
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
