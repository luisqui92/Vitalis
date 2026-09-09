// Symphomed — WhatsApp de reservas vía la API oficial de Meta (Cloud API), en
// vez de Baileys (cliente no oficial, sesión por QR). Reemplaza por completo
// a services/baileysWhatsapp.js: acá no hay sesión que vincular ni QR que
// escanear — la autenticación es un token de Meta, y los mensajes salen por
// HTTPS directo a la Graph API. "destino" es siempre el número tal cual lo
// manda WhatsApp en el campo "from" del webhook (formato internacional sin
// "+", ej "59176543210") — no hace falta reconstruir ninguna dirección.
const axios = require("axios");
const { CONFIG, log } = require("../config");

function urlMensajes() {
  return `https://graph.facebook.com/v21.0/${CONFIG.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}
function headers() {
  return { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`, "Content-Type": "application/json" };
}

// Los códigos de Meta que NO son bugs nuestros, con qué hacer en cada caso.
// Están acá y no en un README porque el momento en que hacen falta es cuando
// alguien está mirando el log a las once de la noche.
const PISTAS = {
  131030: "La app está en modo DESARROLLO: solo escribe a los números de la lista de prueba. " +
          "Pasala a Activa en developers.facebook.com → tu app → selector Desarrollo/Activa.",
  131047: "Pasaron más de 24 h desde el último mensaje del paciente: ya no se puede mandar texto libre, " +
          "hay que usar una plantilla aprobada.",
  131026: "Ese número no tiene WhatsApp o no puede recibir mensajes.",
  132000: "La plantilla no existe o los parámetros no coinciden con los que se aprobaron.",
  132001: "La plantilla no existe con ese nombre y en ese idioma.",
  133010: "El número no está registrado en la API. Revisá WHATSAPP_PHONE_NUMBER_ID.",
  190: "El token venció o fue revocado. Generá uno nuevo en Meta y actualizá WHATSAPP_TOKEN.",
  100: "Parámetro inválido — suele ser un WHATSAPP_PHONE_NUMBER_ID que no corresponde al token.",
};

async function mandar(body) {
  if (!CONFIG.WHATSAPP_TOKEN || !CONFIG.WHATSAPP_PHONE_NUMBER_ID) {
    log.warn("[WHATSAPP] No configurado — no se mandó el mensaje a", body.to);
    return null;
  }
  try {
    const res = await axios.post(urlMensajes(), { messaging_product: "whatsapp", recipient_type: "individual", ...body }, { headers: headers(), timeout: 15000 });
    return res.data;
  } catch (e) {
    const err = e.response?.data?.error || {};
    const codigo = err.code ?? err.error_subcode ?? "";
    // El mensaje de Meta describe el síntoma; el CÓDIGO dice si hay que tocar
    // código o tocar la consola de Meta. Sin esa distinción, un problema de
    // configuración se investiga como si fuera un bug — que es exactamente lo
    // que pasó con el 131030: los recordatorios fallaban en silencio porque la
    // app estaba en modo Desarrollo, y en el log parecía un error de envío.
    const pista = PISTAS[codigo];
    log.error(`[WHATSAPP] Falló el envío a ${body.to} (código ${codigo || "?"}): ` +
      (err.message || e.message));
    if (pista) log.error(`[WHATSAPP] → ${pista}`);
    throw e;
  }
}

async function enviarTexto(destino, texto) {
  return mandar({ to: destino, type: "text", text: { body: texto } });
}

// botones: hasta 3, [{id, title}] — límite de Meta: título de hasta 20
// caracteres, se recorta acá para no depender de que cada caller lo respete.
async function enviarBotones(destino, textoBody, botones) {
  return mandar({
    to: destino,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: textoBody },
      action: { buttons: botones.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}

// filas: hasta 10, [{id, title, description}] — límites de Meta: título 24
// caracteres, descripción 72.
async function enviarLista(destino, textoBody, textoBoton, filas) {
  return mandar({
    to: destino,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: textoBody },
      action: {
        button: textoBoton.slice(0, 20),
        sections: [{ rows: filas.slice(0, 10).map(f => ({ id: f.id, title: f.title.slice(0, 24), description: (f.description || "").slice(0, 72) })) }],
      },
    },
  });
}

// Marca el mensaje entrante como leído (el paciente ve el doble check azul)
// — puramente cosmético, nunca debe frenar el flujo real si falla.
async function marcarLeido(messageId) {
  if (!messageId || !CONFIG.WHATSAPP_TOKEN || !CONFIG.WHATSAPP_PHONE_NUMBER_ID) return;
  try {
    await axios.post(urlMensajes(), { messaging_product: "whatsapp", status: "read", message_id: messageId }, { headers: headers(), timeout: 8000 });
  } catch (e) { /* no crítico */ }
}

// Sin QR ni sesión que vincular con la API oficial — "conectado" es
// simplemente "hay credenciales cargadas". El médico ya no tiene nada que
// escanear ni una sesión que se pueda caer sola.
async function obtenerEstado() {
  const configurado = Boolean(CONFIG.WHATSAPP_TOKEN && CONFIG.WHATSAPP_PHONE_NUMBER_ID);
  return { configurado, conectado: configurado };
}

module.exports = { enviarTexto, enviarBotones, enviarLista, marcarLeido, obtenerEstado };
