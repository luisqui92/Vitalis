// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Ganadería — alertas de retiro de medicamento, por WhatsApp
// ═══════════════════════════════════════════════════════════════════════════
//
// El período de retiro (services/lotesGanado.js) es el dato que más le
// importa al dueño antes de vender: mientras esté vigente, faenar el lote o
// vender su leche es un riesgo de inocuidad alimentaria real, no un detalle
// administrativo. Hasta ahora ese dato quedaba enterrado en la ficha del
// lote, esperando que alguien se acuerde de mirarlo.
//
// Acá pasa a ser dos avisos por WhatsApp, al teléfono del médico/veterinario
// (el mismo con el que entra a Symphomed, no un paciente):
//
//   1. Al cargar el evento: confirma las fechas, en el momento.
//   2. Cuando el retiro VENCE: avisa que ya se puede faenar o vender la
//      leche sin riesgo — el que de verdad evita que alguien confíe en la
//      memoria para algo así.
//
// Ningún competidor relevado (services/ganaderia — ver el estudio de
// mercado) ofrece esto como alerta proactiva.
const { log } = require("../config");
const { esCuentaBrasil } = require("./idiomas");
const { LoteGanado, EventoLote, Medico, Finca } = require("../db/models");
const { enviarTextoOPlantilla, normalizarDestino, PLANTILLAS } = require("./metaWhatsapp");

// ─── A QUIÉN SE LE AVISA ────────────────────────────────────────────────────
//
// Al veterinario siempre. Y al dueño de la finca, si el lote tiene una y el
// dueño tiene teléfono cargado: es él quien decide cuándo se faena o se
// vende la leche, así que una alerta de retiro que solo le llega al
// veterinario depende de que el veterinario se acuerde de reenviarla.
//
// El envío al dueño NO puede tumbar el del veterinario: si el número del
// dueño está mal escrito, el veterinario igual tiene que enterarse, y el
// evento igual tiene que quedar marcado como avisado (si no, el trabajo de
// cada hora le volvería a escribir al veterinario para siempre por culpa de
// un número ajeno). Por eso el del veterinario tira el error y el del dueño
// solo lo anota.
async function telefonoDelDueno(lote, medico) {
  if (!lote?.fincaId) return null;
  const finca = await Finca.findOne({ _id: lote.fincaId, medicoPhone: medico.phone }).select("duenoTelefono").lean();
  const tel = String(finca?.duenoTelefono || "").trim();
  if (!tel) return null;
  const destino = normalizarDestino(tel, medico?.moneda === "BRL" ? "BR" : "BO");
  // El dueño y el veterinario pueden ser la misma persona (un veterinario
  // que además tiene su propio campo): no se le manda el mismo aviso dos veces.
  return destino && destino !== normalizarDestino(medico.phone, medico?.moneda === "BRL" ? "BR" : "BO") ? destino : null;
}

async function avisar(lote, medico, texto, respaldo) {
  const resultado = await enviarTextoOPlantilla(medico.phone, texto, respaldo);
  const dueno = await telefonoDelDueno(lote, medico);
  if (dueno) {
    try {
      await enviarTextoOPlantilla(dueno, texto, respaldo);
    } catch (e) {
      log.error(`[ALERTA_RETIRO_GANADO] no se pudo avisar al dueño (${dueno}) del lote ${lote.codigo}: ${e.message}`);
    }
  }
  return resultado;
}

// ─── EL AVISO INMEDIATO, AL CARGAR EL EVENTO ────────────────────────────────
async function notificarRetiroRegistrado(evento, lote, medico) {
  const esBrasil = esCuentaBrasil(medico);
  const locale = esBrasil ? "pt-BR" : "es-BO";
  const partes = [];
  if (evento.diasRetiroCarne != null) {
    const libre = new Date(new Date(evento.fecha).getTime() + evento.diasRetiroCarne * 86400000);
    partes.push(esBrasil
      ? `abate liberado a partir de ${libre.toLocaleDateString(locale)}`
      : `libre para faena desde el ${libre.toLocaleDateString(locale)}`);
  }
  if (evento.diasRetiroLeche != null) {
    const libre = new Date(new Date(evento.fecha).getTime() + evento.diasRetiroLeche * 86400000);
    partes.push(esBrasil
      ? `leite liberado a partir de ${libre.toLocaleDateString(locale)}`
      : `leche libre desde el ${libre.toLocaleDateString(locale)}`);
  }
  if (!partes.length) return null; // sin período de retiro, no hay nada que avisar

  const texto = esBrasil
    ? `Registrado: ${evento.producto} no lote ${lote.codigo} (${lote.nombre}). Período de carência: ${partes.join(", ")}.`
    : `Se registró ${evento.producto} en el lote ${lote.codigo} (${lote.nombre}). Período de retiro: ${partes.join(", ")}.`;

  return avisar(lote, medico, texto, {
    plantilla: PLANTILLAS.retiroGanadoRegistrado,
    parametros: [lote.codigo, evento.producto, partes.join(", ")],
    idioma: medico?.idioma,
  });
}

// ─── EL TRABAJO EN SEGUNDO PLANO: EL RETIRO YA VENCIÓ ───────────────────────
//
// "Vencido" acá es lo contrario que en recordatorioMedicamento: no es que
// falte mandar algo, es que YA PASÓ la fecha en la que el lote vuelve a
// estar libre. Un evento con los dos retiros (carne y leche) espera a que
// venzan LOS DOS antes de avisar — avisar solo con el de carne cuando la
// leche todavía está en resguardo sería peor que no avisar nada.
async function procesarRetirosLiberados() {
  const ahora = new Date();
  const candidatos = await EventoLote.find({
    tipo: { $in: ["tratamiento", "vacunacion"] },
    avisoLiberacionEnviado: false,
    $or: [{ diasRetiroCarne: { $ne: null } }, { diasRetiroLeche: { $ne: null } }],
  }).lean();

  let enviados = 0, fallidos = 0;
  for (const evento of candidatos) {
    const fechaBase = new Date(evento.fecha).getTime();
    const libreCarne = evento.diasRetiroCarne != null ? fechaBase + evento.diasRetiroCarne * 86400000 : null;
    const libreLeche = evento.diasRetiroLeche != null ? fechaBase + evento.diasRetiroLeche * 86400000 : null;
    const fechasAplicables = [libreCarne, libreLeche].filter(f => f != null);
    const yaVencioTodo = fechasAplicables.every(f => ahora.getTime() >= f);
    if (!yaVencioTodo) continue;

    try {
      const [lote, medico] = await Promise.all([
        LoteGanado.findById(evento.loteId).select("codigo nombre medicoPhone fincaId").lean(),
        Medico.findOne({ phone: evento.medicoPhone }).select("phone nombre idioma moneda").lean(),
      ]);
      // El lote pudo cerrarse o borrarse entre que se cargó el evento y que
      // venció el retiro — no hay a quién avisarle ni de qué.
      if (!lote || !medico) {
        await EventoLote.updateOne({ _id: evento._id }, { $set: { avisoLiberacionEnviado: true } });
        continue;
      }
      await notificarRetiroLibre(evento, lote, medico);
      await EventoLote.updateOne({ _id: evento._id }, { $set: { avisoLiberacionEnviado: true } });
      enviados++;
    } catch (e) {
      fallidos++;
      log.error(`[ALERTA_RETIRO_GANADO] no se pudo avisar del evento ${evento._id}: ${e.message}`);
    }
  }
  if (enviados || fallidos) {
    log.info(`[ALERTA_RETIRO_GANADO] pasada: ${enviados} enviado(s), ${fallidos} fallido(s)`);
  }
  return { enviados, fallidos };
}

async function notificarRetiroLibre(evento, lote, medico) {
  const esBrasil = esCuentaBrasil(medico);
  const acciones = [];
  if (evento.diasRetiroCarne != null) acciones.push(esBrasil ? "abater" : "faenar");
  if (evento.diasRetiroLeche != null) acciones.push(esBrasil ? "vender o leite" : "vender la leche");

  const texto = esBrasil
    ? `O lote ${lote.codigo} (${lote.nombre}) já está livre: o período de carência de ${evento.producto} venceu. Já pode ${acciones.join(" e ")}.`
    : `El lote ${lote.codigo} (${lote.nombre}) ya está libre: venció el período de retiro de ${evento.producto}. Ya podés ${acciones.join(" y ")}.`;

  return avisar(lote, medico, texto, {
    plantilla: PLANTILLAS.retiroGanadoLibre,
    parametros: [lote.codigo, evento.producto],
    idioma: medico?.idioma,
  });
}

// ─── PROGRAMACIÓN ───────────────────────────────────────────────────────────
// Mismo criterio que services/recordatorioMedicamento.js: cada hora alcanza
// de sobra para un vencimiento medido en días, y arranca a los dos minutos
// para no competir con el arranque del servidor si está reiniciando en loop.
const HORAS_INTERVALO = 1;
let temporizador = null;

function programar() {
  if (temporizador) return;
  const ms = HORAS_INTERVALO * 3600000;

  setTimeout(() => {
    procesarRetirosLiberados().catch(e => log.error("[ALERTA_RETIRO_GANADO] falló la pasada:", e.message));
  }, 2 * 60 * 1000);

  temporizador = setInterval(() => {
    procesarRetirosLiberados().catch(e => log.error("[ALERTA_RETIRO_GANADO] falló la pasada:", e.message));
  }, ms);
  if (temporizador.unref) temporizador.unref();

  log.info(`[ALERTA_RETIRO_GANADO] programado cada ${HORAS_INTERVALO} h`);
}

module.exports = { notificarRetiroRegistrado, notificarRetiroLibre, procesarRetirosLiberados, programar };
