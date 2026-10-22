// Avisos transaccionales, nunca códigos de acceso ni concesión de permisos.
// La solicitud guarda su último aviso en la misma escritura atómica que su estado.
const crypto = require("crypto");
const axios = require("axios");
const { Medico } = require("../db/models");
const { CONFIG, log } = require("../config");
const MAX_INTENTOS = 5;
const VENTANA = 23 * 3600 * 1000; // Menor que las 24 h de idempotencia de Resend.

function disponible() {
  return Boolean(CONFIG.RESEND_API_KEY && CONFIG.CORREO_CUENTAS_REMITENTE);
}
function contenido(tipo, idioma, ingreso) {
  const pt = idioma === "pt";
  const mensajes = pt ? {
    recibida: ["Recebemos sua solicitação — Symphomed", "Recebemos sua solicitação de acesso profissional. Ela será analisada pela equipe. O acesso clínico depende da aprovação."],
    aprobada: ["Acesso profissional aprovado — Symphomed", "Sua solicitação de acesso profissional foi aprovada. Entre novamente com Google para atualizar sua sessão. A aprovação não altera as condições do seu plano."],
    corregir: ["Revise sua solicitação — Symphomed", "Sua solicitação não foi aprovada nesta revisão. Entre com Google para consultar o motivo e, se necessário, corrigir seus dados e enviar novamente."],
  } : {
    recibida: ["Recibimos tu solicitud — Symphomed", "Recibimos tu solicitud de acceso profesional. Nuestro equipo la revisará. El acceso clínico requiere aprobación."],
    aprobada: ["Acceso profesional aprobado — Symphomed", "Tu solicitud de acceso profesional fue aprobada. Volvé a entrar con Google para actualizar tu sesión. La aprobación no cambia las condiciones de tu plan."],
    corregir: ["Revisá tu solicitud — Symphomed", "Tu solicitud no fue aprobada en esta revisión. Entrá con Google para consultar el motivo y, si corresponde, corregir los datos y volver a enviarla."],
  };
  if (!mensajes[tipo]) throw new Error("Tipo de aviso no válido");
  const [subject, cuerpo] = mensajes[tipo];
  // No incluye matrícula, motivo del rechazo, documentos, tokens ni datos de pacientes.
  return { subject, text: `${cuerpo}\n\n${ingreso}\n\n${pt ? "Este e-mail é apenas um aviso. Não contém um código de acesso." : "Este correo es solo un aviso. No contiene un código de acceso."}` };
}

async function procesarUno() {
  if (!disponible()) return false; // Sin configurar, conserva los avisos pendientes.
  const ahora = new Date(), bloqueo = crypto.randomUUID();
  const m = await Medico.findOneAndUpdate({
    "solicitud.correo.estado": { $in: ["pendiente", "enviando"] },
    "solicitud.correo.proximoIntento": { $lte: ahora },
  }, { $set: { "solicitud.correo.estado": "enviando", "solicitud.correo.bloqueo": bloqueo,
    "solicitud.correo.proximoIntento": new Date(ahora.getTime() + 120000) } }, { new: true });
  if (!m) return false;
  const aviso = m.solicitud.correo;
  // Una respuesta tardía no modifica un aviso nuevo ni el trabajo de otro proceso.
  const filtro = { _id: m._id, "solicitud.correo.id": aviso.id, "solicitud.correo.bloqueo": bloqueo,
    "solicitud.correo.estado": "enviando" };
  const guardar = campos => Medico.updateOne(filtro, { $set: Object.fromEntries(
    Object.entries(campos).map(([k, v]) => [`solicitud.correo.${k}`, v])) });
  const inicio = aviso.iniciadoEn || ahora;
  if (ahora - new Date(inicio) >= VENTANA) { await guardar({ estado: "expirado" }); return true; }
  if ((aviso.intentos || 0) >= MAX_INTENTOS) { await guardar({ estado: "error" }); return true; }
  // Nunca usa req.body.email ni el email de contacto histórico sin verificar.
  if (!m.googleSub || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.googleEmail || "") ||
      (aviso.destino && aviso.destino !== m.googleEmail)) {
    await guardar({ estado: "sin_correo" }); return true;
  }
  const intentos = (aviso.intentos || 0) + 1;
  try {
    const ingreso = new URL(aviso.ingreso || CONFIG.APP_URL || "https://app.symphomed.com");
    if (ingreso.protocol !== "https:" || ingreso.username || ingreso.password) throw new Error("URL inválida");
    // Congela el cuerpo y destinatario para que los reintentos compartan la misma clave y contenido.
    const datos = { destino: aviso.destino || m.googleEmail, idioma: aviso.idioma || (m.idioma === "pt" ? "pt" : "es"),
      ingreso: ingreso.origin, remitente: aviso.remitente || CONFIG.CORREO_CUENTAS_REMITENTE };
    const guardado = await guardar({ ...datos, iniciadoEn: inicio, intentos });
    if (!guardado.modifiedCount) return true;
    const resultado = await axios.post("https://api.resend.com/emails", {
      from: datos.remitente, to: [datos.destino], ...contenido(aviso.tipo, datos.idioma, datos.ingreso),
    }, { timeout: 10000, maxRedirects: 0, headers: { Authorization: `Bearer ${CONFIG.RESEND_API_KEY}`,
      "Content-Type": "application/json", "Idempotency-Key": `cuenta-${aviso.id}` } });
    if (!resultado.data?.id) throw new Error("Proveedor sin confirmación");
    await guardar({ estado: "enviado", enviadoEn: new Date(), proveedorId: resultado.data.id });
  } catch (_) {
    // No registrar errores Axios completos: pueden contener la API key o el destinatario.
    await guardar({ intentos, iniciadoEn: inicio, estado: intentos >= MAX_INTENTOS ? "error" : "pendiente",
      proximoIntento: new Date(Date.now() + 60000 * 2 ** (intentos - 1)) });
    log.warn("[CORREO_CUENTAS] No se confirmó un envío; consultar el estado en el panel.");
  }
  return true;
}
let ocupado = false;
async function procesar() {
  if (ocupado) return;
  ocupado = true;
  try { for (let i = 0; i < 25 && await procesarUno(); i++); }
  finally { ocupado = false; }
}
function programar() {
  const ejecutar = () => procesar().catch(() => log.warn("[CORREO_CUENTAS] No se pudo procesar la cola."));
  ejecutar();
  return setInterval(ejecutar, 30000).unref();
}
module.exports = { contenido, disponible, procesarUno, procesar, programar };
