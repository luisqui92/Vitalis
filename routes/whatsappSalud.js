// Symphomed — WhatsApp de reservas vía la API oficial de Meta (Cloud API):
// el webhook que recibe los mensajes entrantes (verificación + mensajes
// reales) y el estado que ve el médico desde la Agenda. Reemplaza al
// esquema anterior con Baileys (QR + sesión vinculada) — acá no hay nada
// que escanear, la conexión es HTTPS directo con Meta.
const crypto = require("crypto");
const { CONFIG, log } = require("../config");
const { requireAuth } = require("../services/auth");
const { enviarTexto, enviarBotones, enviarLista, marcarLeido, obtenerEstado, bajarMedia } = require("../services/metaWhatsapp");
const { transcribirNotaDeVoz } = require("../services/assemblyai");
const { Medico } = require("../db/models");
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
  } else if (msg.type === "audio") {
    texto = await escucharNotaDeVoz(numero, msg);
    if (!texto) return;  // ya se le contestó adentro
  } else {
    // ═══ NUNCA MUDO ══════════════════════════════════════════════════════
    //
    // Acá antes había un return pelado. Una foto, una ubicación o un
    // contacto entraban y el bot no contestaba NADA: el paciente veía su
    // doble palomita y ningún mensaje, y lo que concluye no es "no soporta
    // ese formato", es "este consultorio no atiende".
    //
    // Un "no puedo con eso, mandámelo así" es infinitamente mejor que el
    // silencio, y cuesta un mensaje adentro de la ventana de 24 h, que es
    // gratis porque lo abrió el paciente.
    await enviarTexto(numero,
      "Perdón, todavía no puedo abrir ese tipo de archivo 🙏 Si querés reservar una cita, " +
      "escribime o mandame un audio y te ayudo.").catch(() => {});
    return;
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

// ─── Las notas de voz ──────────────────────────────────────────────────────
//
// ═══ POR QUÉ ESTO NO ES UN EXTRA ═══════════════════════════════════════════
//
// En Bolivia y en Brasil, muchísima gente no escribe por WhatsApp: manda
// audios. Y los que más audios mandan son justo los pacientes mayores, que
// son los que más citas necesitan y los que menos van a pelear con un teclado.
//
// Hasta ahora un audio caía en un `return` y el bot no contestaba nada. Para
// esa persona, el consultorio simplemente no atendía.
//
// La capacidad ya estaba en casa: el mismo motor que transcribe consultas.
// Lo único que faltaba era bajarle el archivo a Meta y conectarlo.

// Tope de duración. Un audio de reserva dura diez o quince segundos; uno de
// tres minutos es alguien contando su vida, y transcribirlo cuesta plata sin
// darle nada mejor al paciente. Se corta con cariño y se le pide el resumen.
const AUDIO_SEGUNDOS_MAX = Number(process.env.WA_AUDIO_SEGUNDOS_MAX || 90);

async function escucharNotaDeVoz(numero, msg) {
  const mediaId = msg.audio?.id;
  if (!mediaId) return "";

  // El aviso va ANTES de transcribir, no después: transcribir tarda unos
  // segundos y sin esto el paciente ve silencio y manda el audio de nuevo —
  // y entonces se transcriben dos y contesta dos veces.
  await enviarTexto(numero, "🎧 Estoy escuchando tu audio, dame un segundito…").catch(() => {});

  try {
    const { buffer } = await bajarMedia(mediaId);

    // El idioma y la especialidad salen del consultorio, no de una constante:
    // el vocabulario clínico que se le pasa al motor es distinto para un
    // odontólogo que para una ginecóloga, y en Brasil se dice losartana y no
    // losartán. Con súper número todavía no se sabe qué consultorio busca —
    // recién lo elige— así que ahí va el primero como aproximación.
    const phone = CONFIG.SALUD_WHATSAPP_MEDICO_PHONE || CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS[0];
    const medico = phone ? await Medico.findOne({ phone }).select("idioma tipoEspecialidad").lean() : null;

    const { texto, duracionSegundos } = await transcribirNotaDeVoz(
      buffer, medico?.tipoEspecialidad || "medicina_general", medico?.idioma || "es");

    if (duracionSegundos && duracionSegundos > AUDIO_SEGUNDOS_MAX) {
      log.warn(`[WHATSAPP audio] ${numero}: ${Math.round(duracionSegundos)}s, más del tope`);
      await enviarTexto(numero, "Uy, ese audio es un poco largo para mí 🙈 " +
        "¿Me lo contás en uno más cortito, o me escribís qué necesitás?").catch(() => {});
      return "";
    }

    if (!texto.trim()) {
      // Pasa de verdad: se aprieta el micrófono sin querer y sale un audio de
      // un segundo de ruido. Decirlo es mejor que quedarse callado.
      await enviarTexto(numero, "No llegué a escuchar nada en ese audio 🙏 " +
        "¿Me lo mandás de nuevo, o me escribís qué necesitás?").catch(() => {});
      return "";
    }

    log.info(`[WHATSAPP audio] ${numero}: ${Math.round(duracionSegundos || 0)}s → "${texto.slice(0, 60)}…"`);
    return texto;
  } catch (e) {
    // Que falle la transcripción no puede dejar al paciente hablando solo. Se
    // le pide por escrito y sigue por el camino de siempre — la reserva no
    // depende de que el audio ande.
    log.error(`[WHATSAPP audio] ${numero}: ${e.message}`);
    await enviarTexto(numero, "Perdón, no pude escuchar tu audio 🙏 " +
      "¿Me escribís qué necesitás? Así te ayudo igual.").catch(() => {});
    return "";
  }
}
