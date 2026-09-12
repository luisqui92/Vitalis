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
  // Este aparece cuando la plantilla SÍ está aprobada y el envío igual se
  // cae. Es fácil confundirlo con un problema de plantilla y perder una
  // tarde: no falta nada del lado del código, falta la tarjeta.
  131042: "La cuenta de WhatsApp Business no tiene método de pago. Los mensajes que INICIA la plataforma " +
          "—confirmaciones de cita, reconsultas, informes— se cobran y no salen sin una tarjeta cargada. " +
          "El bot de reservas sigue andando igual: esas conversaciones las inicia el paciente y son gratis.",
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

// ─── PLANTILLAS ────────────────────────────────────────────────────────────
//
// ═══ LA VENTANA DE 24 HORAS ════════════════════════════════════════════════
//
// Meta deja mandar texto libre SOLO dentro de las 24 h desde el último
// mensaje del paciente. Fuera de esa ventana, únicamente plantillas
// aprobadas de antemano.
//
// No es un detalle: de los cinco lugares donde Symphomed manda algo, el único
// que siempre cae adentro es la respuesta del bot de reservas. Los otros
// cuatro los inicia la plataforma —la confirmación de una cita que cargó el
// médico, el aviso de reconsulta, el informe— y un paciente que reservó desde
// la página web puede no haberle escrito nunca al WhatsApp. Sin plantilla,
// esos mensajes fallan con 131047 y el paciente no recibe nada.
//
// ═══ POR QUÉ SE INTENTA PRIMERO EL TEXTO LIBRE ═════════════════════════════
//
// Se podría mandar siempre la plantilla y listo. No conviene: la plantilla
// está congelada en lo que Meta aprobó —cambiarle una coma es volver a pedir
// aprobación, que tarda— y una conversación abierta por plantilla se cobra
// como tal aunque el paciente estuviera escribiendo hace dos minutos.
//
// Así el paciente que está conversando recibe el mensaje natural y completo,
// y la plantilla queda de red para cuando no hay otra forma.
const PLANTILLAS = {
  citaConfirmada: "cita_confirmada",
  reconsulta: "reconsulta_sugerida",
  informeListo: "informe_listo",
};

// Los códigos con los que Meta dice "esto no entra por la ventana". El 470 es
// el nombre viejo del mismo rechazo y todavía aparece en cuentas antiguas.
const FUERA_DE_VENTANA = new Set([131047, 470]);

function codigoDe(e) {
  const err = e?.response?.data?.error || {};
  return Number(err.code ?? err.error_subcode ?? 0);
}

// idioma: "es" o "pt". Una plantilla se aprueba POR IDIOMA, así que pedir
// "pt" cuando solo se aprobó "es" no falla en silencio: Meta devuelve 132001
// y el log ya lo traduce a algo que se entiende.
async function enviarPlantilla(destino, nombre, parametros = [], idioma = "es") {
  return mandar({
    to: destino,
    type: "template",
    template: {
      name: nombre,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: "body", parameters: parametros.map(p => ({ type: "text", text: String(p ?? "") })) }]
        : [],
    },
  });
}

// Texto libre, y si Meta lo rechaza por la ventana, la plantilla.
//
// OJO CON EL ORDEN: `parametros` tiene que coincidir EXACTO con los {{1}},
// {{2}}… del cuerpo que se aprobó en Meta. Es el acoplamiento más frágil de
// todo esto —vive mitad acá y mitad en un panel web al que este código no
// puede preguntarle nada— y por eso está escrito en WHATSAPP_PLANTILLAS.md y
// comprobado en scripts/pruebas/probar_plantillas.js.
async function enviarTextoOPlantilla(destino, texto, respaldo) {
  try {
    return await enviarTexto(destino, texto);
  } catch (e) {
    if (!FUERA_DE_VENTANA.has(codigoDe(e))) throw e;
    log.info(`[WHATSAPP] Fuera de la ventana de 24 h con ${destino} — se manda la plantilla «${respaldo.plantilla}»`);
    return enviarPlantilla(destino, respaldo.plantilla, respaldo.parametros, respaldo.idioma || "es");
  }
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

module.exports = {
  enviarTexto, enviarBotones, enviarLista, marcarLeido, obtenerEstado,
  enviarPlantilla, enviarTextoOPlantilla, PLANTILLAS, bajarMedia,
};

// ─── Bajar un archivo que mandó el paciente ────────────────────────────────
//
// Meta no manda el audio en el webhook: manda un identificador. Bajarlo son
// DOS pedidos —primero se pregunta la URL, después se baja— y el segundo
// también necesita el token, aunque la URL parezca pública. Sin la cabecera
// devuelve 401 y el archivo nunca llega.
//
// La URL vence a los cinco minutos, así que no sirve guardarla: se usa o se
// pierde.
const TOPE_BYTES = 16 * 1024 * 1024; // lo que deja subir WhatsApp

async function bajarMedia(mediaId) {
  if (!CONFIG.WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN no configurado");

  const meta = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}` },
    timeout: 15000,
  });
  const { url, mime_type: tipo, file_size: tam } = meta.data || {};
  if (!url) throw new Error("Meta no devolvió la URL del archivo");
  // Se corta ANTES de bajarlo, no después: no tiene sentido traer diez megas
  // para descartarlos. El límite real lo pone WhatsApp, esto es el cinturón.
  if (Number(tam) > TOPE_BYTES) throw new Error(`El archivo pesa ${tam} bytes, más del tope`);

  const archivo = await axios.get(url, {
    headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: TOPE_BYTES,
  });
  return { buffer: Buffer.from(archivo.data), tipo };
}
