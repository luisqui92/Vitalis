// Symphomed — WhatsApp de reservas vía la API oficial de Meta (Cloud API):
// el webhook que recibe los mensajes entrantes (verificación + mensajes
// reales) y el estado que ve el médico desde la Agenda. Reemplaza al
// esquema anterior con Baileys (QR + sesión vinculada) — acá no hay nada
// que escanear, la conexión es HTTPS directo con Meta.
const crypto = require("crypto");
const { CONFIG, log } = require("../config");
const { requireAuth } = require("../services/auth");
const { enviarTexto, enviarBotones, enviarLista, marcarLeido, obtenerEstado } = require("../services/metaWhatsapp");
const { procesarMensajeEntrante } = require("../services/reservaCitas");
const { asyncRoute } = require("../services/httpHelpers");
const { rateLimit } = require("../services/ratelimit");

const requireMedico = requireAuth(["medico"]);

// ═══ POR QUÉ ESTO NO ES OPCIONAL ═══════════════════════════════════════════
//
// /webhook/meta-whatsapp es una URL pública que no pide token: tiene que
// serlo, porque quien la llama es Meta y no tiene forma de iniciar sesión.
// Lo único que distingue un mensaje real de uno inventado es la firma que
// Meta pone en la cabecera X-Hub-Signature-256.
//
// Sin comprobarla, cualquiera que sepa la URL manda un POST con el número de
// un paciente adentro y Symphomed le cree: le cancela la cita, le llena la
// agenda al médico de reservas falsas, o le pisa la conversación a alguien
// que está reservando en ese momento. Y cada mensaje libre llama a la IA, así
// que además se paga.
//
// El verify token de acá arriba NO cubre esto: Meta lo usa una sola vez, el
// día que se da de alta la URL, y nunca más.
function firmaValida(req) {
  const cabecera = String(req.get("x-hub-signature-256") || "");
  if (!cabecera.startsWith("sha256=") || !req.cuerpoCrudo) return false;
  const esperada = "sha256=" + crypto
    .createHmac("sha256", CONFIG.WHATSAPP_APP_SECRET)
    .update(req.cuerpoCrudo)
    .digest("hex");
  // Longitudes distintas antes del timingSafeEqual: si no coinciden, tira en
  // vez de devolver false, y una excepción acá sería un 500 en vez de un 403.
  const a = Buffer.from(cabecera);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Un techo por si algún día la firma se configura mal y alguien encuentra la
// URL igual: 240 pedidos por minuto es muchísimo más de lo que manda Meta por
// un consultorio, y muchísimo menos de lo que cuesta una factura de IA.
const limitWebhook = rateLimit("webhook_whatsapp", 240, 60 * 1000, "Demasiados pedidos");

module.exports = function (app) {
  app.get("/medico/whatsapp/estado", requireMedico, asyncRoute(async (req, res) => {
    res.json(await obtenerEstado());
  }));

  // ─── VERIFICACIÓN DEL WEBHOOK (Meta la llama una sola vez, al guardar
  // esta URL como Callback URL en el dashboard de WhatsApp → Configuration) ──
  app.get("/webhook/meta-whatsapp", (req, res) => {
    const modo = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (modo === "subscribe" && CONFIG.WHATSAPP_VERIFY_TOKEN && token === CONFIG.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  // ─── MENSAJES ENTRANTES ──────────────────────────────────────────────────
  // Meta espera un 200 rápido (no espera a que termine de procesar) — por
  // eso se responde primero y se procesa después, igual que ya se hacía con
  // el procesamiento en segundo plano de las consultas médicas.
  app.post("/webhook/meta-whatsapp", limitWebhook, (req, res) => {
    // Falla CERRADO, igual que el webhook de Vapi. Es incómodo a propósito:
    // si esto dejara pasar los mensajes cuando falta el secreto, el día que
    // alguien despliegue sin la variable el agujero volvería solo y en
    // silencio. Mejor que las reservas por WhatsApp no anden —se nota en
    // horas— a que anden para cualquiera.
    if (!CONFIG.WHATSAPP_APP_SECRET) {
      log.error("[WHATSAPP webhook] WHATSAPP_APP_SECRET no configurado — rechazando. Las reservas por WhatsApp NO funcionan hasta ponerlo.");
      return res.sendStatus(503);
    }
    if (!firmaValida(req)) {
      log.warn(`[WHATSAPP webhook] firma inválida desde ${req.ip} — descartado`);
      return res.sendStatus(403);
    }

    // Recién ahora se confía. Meta espera un 200 rápido y no aguarda a que
    // terminemos de procesar, así que se responde primero.
    res.sendStatus(200);
    procesarWebhook(req.body).catch(e => log.error("[WHATSAPP webhook]", e.message));
  });
};

async function procesarWebhook(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return; // puede ser un evento de status (delivered/read/failed), no un mensaje entrante

  const numero = msg.from;
  let texto = "";
  if (msg.type === "text") {
    texto = msg.text?.body || "";
  } else if (msg.type === "interactive") {
    texto = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
  } else {
    return; // audio/imagen/ubicación/etc. — no soportado por ahora
  }
  if (!numero || !texto.trim()) return;

  marcarLeido(msg.id).catch(() => {});

  const nombrePerfil = value?.contacts?.[0]?.profile?.name || "";
  const respuesta = await procesarMensajeEntrante(numero, texto.trim(), nombrePerfil);
  if (!respuesta) return;

  if (respuesta.tipo === "botones") await enviarBotones(numero, respuesta.texto, respuesta.botones);
  else if (respuesta.tipo === "lista") await enviarLista(numero, respuesta.texto, respuesta.textoBoton, respuesta.filas);
  else await enviarTexto(numero, respuesta.texto);
}
