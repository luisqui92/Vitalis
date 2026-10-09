// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Recordatorios de medicación al paciente, por WhatsApp
// ═══════════════════════════════════════════════════════════════════════════
//
// El médico escribe "cada 3 días" en el campo de frecuencia de un
// medicamento, como ya hacía antes de que esto existiera. Lo nuevo: si ese
// texto se entiende con confianza como un intervalo en DÍAS, Symphomed le
// manda solo un WhatsApp al paciente cada vez que toca, hasta que el
// medicamento se dé de baja (fechaFin) o alguien apague el recordatorio a
// mano desde el Kardex.
//
// ═══ POR QUÉ SOLO DÍAS, NUNCA HORAS ════════════════════════════════════════
//
// "Cada 8 horas" no se detecta a propósito. Un recordatorio cada pocas horas
// sería spam de un canal que el paciente no eligió, y además cada mensaje
// que Symphomed inicia fuera de la ventana de 24 h se manda por plantilla —
// y se cobra. Un intervalo de días es el caso real que motivó esto
// ("cada tres días tienen que ser recuerdo al paciente") y el único donde un
// mensaje diario o cada varios días tiene sentido como recordatorio, no
// como ruido.
//
// ═══ POR QUÉ LA DETECCIÓN PUEDE FALLAR, Y ESTÁ BIEN QUE FALLE CALLADA ═════
//
// "frecuencia" es texto libre — lo que el médico ya escribía antes de que
// existiera esta función, no un campo nuevo pensado para que una máquina lo
// lea. Frente a algo ambiguo, esta función NO adivina: devuelve null, y el
// medicamento se guarda igual, simplemente sin recordatorio automático. Un
// falso negativo (no se activó cuando sí correspondía) es mucho menos grave
// que un falso positivo (se activó con un intervalo inventado) — el primero
// se nota porque no llega ningún mensaje, el segundo manda un WhatsApp de
// salud con un horario que nadie dijo.
const { CONFIG, log } = require("../config");
const { esCuentaBrasil } = require("./idiomas");
const { Medicamento, Paciente, Medico } = require("../db/models");
const { enviarTextoOPlantilla, PLANTILLAS } = require("./metaWhatsapp");
const extensiones = require("./extensiones");

// ─── DETECCIÓN ──────────────────────────────────────────────────────────────
//
// Español y portugués a la vez: "cada" e "a cada" comparten la palabra que
// importa, así que un solo patrón cubre los dos sin tener que separar por
// idioma del médico — lo que se lee es lo que el médico tipeó, no una
// traducción.
function detectarIntervaloDias(frecuencia) {
  const t = String(frecuencia || "").toLowerCase().trim();
  if (!t) return null;

  // "cada 3 días" / "cada 3 dias" / "a cada 3 dias"
  const conNumero = t.match(/cada\s+(\d{1,2})\s*d[ií]as?\b/);
  if (conNumero) {
    const n = Number(conNumero[1]);
    // Más de un mes entre dosis no es un intervalo de recordatorio, es un
    // dato raro — mejor no activar nada que activar con un número que
    // probablemente es otra cosa (un error de tipeo, un código de lote).
    return n >= 1 && n <= 30 ? n : null;
  }

  // "diario" / "diariamente" / "todos los días" / "todo dia" / "una vez al día"
  if (/\bdiari[oa]s?(mente)?\b|todos?\s+(los\s+)?d[ií]as?|una\s+vez\s+al\s+d[ií]a|1\s+vez\s+al\s+d[ií]a/.test(t)) {
    return 1;
  }

  // "una vez por semana" / "semanal" / "semanalmente"
  if (/una\s+vez\s+por\s+semana|semanal(mente)?\b/.test(t)) {
    return 7;
  }

  return null;
}

// Recalcula recordatorio.activo/intervaloDias/detectadoDe a partir de la
// frecuencia y de si el paciente tiene teléfono. Se llama al crear o editar
// un medicamento — ver routes/medicamentos.js. Conserva ultimoEnviado y
// vecesEnviado cuando el intervalo detectado no cambió, para no reiniciar
// el conteo por haber tocado otro campo del mismo medicamento.
function recalcularRecordatorio(medicamento, frecuencia, tieneTelefono) {
  const anterior = medicamento.recordatorio || {};
  const intervaloDias = tieneTelefono ? detectarIntervaloDias(frecuencia) : null;

  medicamento.recordatorio = {
    activo: intervaloDias != null,
    intervaloDias,
    detectadoDe: intervaloDias != null ? frecuencia : "",
    ultimoEnviado: intervaloDias === anterior.intervaloDias ? (anterior.ultimoEnviado || null) : null,
    vecesEnviado: intervaloDias === anterior.intervaloDias ? (anterior.vecesEnviado || 0) : 0,
  };
}

// ─── EL ENVÍO ───────────────────────────────────────────────────────────────
async function enviarRecordatorio(medicamento, paciente, medico) {
  const esBrasil = esCuentaBrasil(medico);
  const primerNombre = String(paciente.nombre || "").split(" ")[0] || paciente.nombre;
  const quien = medico?.nombre || "tu médico";
  const dosis = medicamento.dosis ? ` (${medicamento.dosis})` : "";

  const texto = esBrasil
    ? `Olá ${primerNombre}, é hora de tomar ${medicamento.nombre}${dosis}, conforme indicado por ${quien}.\n\nSe já parou de tomar, avise seu médico para atualizar o tratamento.`
    : `Hola ${primerNombre}, te recordamos tomar ${medicamento.nombre}${dosis}, según indicó ${quien}.\n\nSi ya dejaste de tomarlo, avisale a tu médico para actualizar el tratamiento.`;

  // pacienteTelefono viaja tal cual está cargado, sin normalizarDestino —
  // mismo criterio que routes/citas.js con cita.pacienteTelefono: el médico
  // ya lo carga en formato internacional, y renormalizar un número que
  // puede venir de un país distinto al del médico arriesgaría romperlo en
  // vez de arreglarlo.
  return enviarTextoOPlantilla(paciente.telefono, texto, {
    plantilla: PLANTILLAS.recordatorioMedicamento,
    parametros: [primerNombre, medicamento.nombre + dosis, quien],
    idioma: medico?.idioma,
  });
}

// ─── EL TRABAJO EN SEGUNDO PLANO ───────────────────────────────────────────
//
// Basado en INTERVALO, no en día de calendario: el próximo aviso es
// "el anterior + N días", nunca "tal día del mes". Evita el problema de qué
// hora del día mandar el recordatorio (no hay una zona horaria única —
// Bolivia y Brasil difieren— ni una hora en que todos los pacientes estén
// despiertos) a costa de que el horario del día se corra con el de la
// pasada del trabajo. Para un recordatorio de "cada 3 días" ese corrimiento
// no importa; si algún día hiciera falta un horario exacto, es un problema
// distinto y más grande que esta primera versión no resuelve.
async function procesarRecordatoriosVencidos() {
  const ahora = new Date();
  const candidatos = await Medicamento.find({
    "recordatorio.activo": true,
    $or: [{ fechaFin: null }, { fechaFin: { $gte: ahora } }],
  }).lean();

  let enviados = 0, fallidos = 0;
  for (const medicamento of candidatos) {
    const base = medicamento.recordatorio.ultimoEnviado
      || medicamento.fechaInicio
      || medicamento.createdAt;
    const proximo = new Date(base).getTime() + medicamento.recordatorio.intervaloDias * 86400000;
    if (ahora.getTime() < proximo) continue;

    try {
      const [paciente, medico] = await Promise.all([
        Paciente.findById(medicamento.pacienteId).select("nombre telefono").lean(),
        Medico.findOne({ phone: medicamento.medicoPhone }).select("nombre idioma moneda").lean(),
      ]);
      // Una cuenta que no le escribe a sus pacientes (lo decide un módulo,
      // por el punto «paciente.mensajes» de services/extensiones.js): el
      // recordatorio se apaga en vez de salir.
      if (!(await extensiones.permite("paciente.mensajes", { medicoPhone: medicamento.medicoPhone }))) {
        await Medicamento.updateOne({ _id: medicamento._id }, { $set: { "recordatorio.activo": false } });
        continue;
      }
      // El paciente pudo perder el teléfono (se lo borraron de la ficha) o
      // la ficha pudo borrarse entera desde que se activó el recordatorio —
      // se apaga en vez de reintentar para siempre contra un destino que ya
      // no existe.
      if (!paciente?.telefono) {
        await Medicamento.updateOne({ _id: medicamento._id }, { $set: { "recordatorio.activo": false } });
        continue;
      }
      await enviarRecordatorio(medicamento, paciente, medico);
      await Medicamento.updateOne({ _id: medicamento._id }, {
        $set: { "recordatorio.ultimoEnviado": ahora },
        $inc: { "recordatorio.vecesEnviado": 1 },
      });
      enviados++;
    } catch (e) {
      fallidos++;
      log.error(`[RECORDATORIO_MEDICAMENTO] no se pudo avisar a ${medicamento.pacienteId} (medicamento ${medicamento._id}): ${e.message}`);
    }
  }
  if (enviados || fallidos) {
    log.info(`[RECORDATORIO_MEDICAMENTO] pasada: ${enviados} enviado(s), ${fallidos} fallido(s)`);
  }
  return { enviados, fallidos };
}

// ─── PROGRAMACIÓN ───────────────────────────────────────────────────────────
// Cada hora: un intervalo en días no necesita una precisión mayor, y correr
// seguido no cuesta nada — la consulta ya sale filtrada por
// "recordatorio.activo" con su propio índice, y de esos pocos, la mayoría
// ni siquiera está vencida todavía.
const HORAS_INTERVALO = 1;
let temporizador = null;

function programar() {
  if (temporizador) return;
  const ms = HORAS_INTERVALO * 3600000;

  // El primero a los 2 minutos y no en el acto, mismo motivo que
  // services/backup.js: si el servidor está reiniciando en loop, no hace
  // falta que además compita por mandar WhatsApps.
  setTimeout(() => {
    procesarRecordatoriosVencidos().catch(e => log.error("[RECORDATORIO_MEDICAMENTO] falló la pasada:", e.message));
  }, 2 * 60 * 1000);

  temporizador = setInterval(() => {
    procesarRecordatoriosVencidos().catch(e => log.error("[RECORDATORIO_MEDICAMENTO] falló la pasada:", e.message));
  }, ms);
  if (temporizador.unref) temporizador.unref();

  log.info(`[RECORDATORIO_MEDICAMENTO] programado cada ${HORAS_INTERVALO} h`);
}

module.exports = {
  detectarIntervaloDias, recalcularRecordatorio, enviarRecordatorio,
  procesarRecordatoriosVencidos, programar,
};
