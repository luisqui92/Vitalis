// Vitalis — WhatsApp de reservas vía la API oficial de Meta (Cloud API):
// el webhook que recibe los mensajes entrantes (verificación + mensajes
// reales) y el estado que ve el médico desde la Agenda. Reemplaza al
// esquema anterior con Baileys (QR + sesión vinculada) — acá no hay nada
// que escanear, la conexión es HTTPS directo con Meta.
const { CONFIG, log } = require("../config");
const { requireAuth } = require("../services/auth");
const { enviarTexto, enviarBotones, enviarLista, marcarLeido, obtenerEstado } = require("../services/metaWhatsapp");
const { procesarMensajeEntrante } = require("../services/reservaCitas");
const { asyncRoute } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

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
  app.post("/webhook/meta-whatsapp", (req, res) => {
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
