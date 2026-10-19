// Symphomed — Recepcionista de voz (Vapi): las acciones que el asistente de
// voz puede ejecutar durante una llamada. Reusan la MISMA lógica de
// disponibilidad/reserva que ya usan WhatsApp y la reserva pública por link
// (services/agenda.js, services/crearCita.js) — acá no hay una máquina de
// estados propia como en reservaCitas.js porque quien conduce la
// conversación es el LLM de Vapi, no nosotros: cada función es una acción
// atómica que el asistente llama cuando la necesita, en el orden que él
// decide.
const mongoose = require("mongoose");
const { Medico, Cita } = require("../db/models");
const { obtenerHorariosDisponibles } = require("./agenda");
const { crearCitaConfirmada } = require("./crearCita");
const { eliminarEvento } = require("./googleCalendar");
const { formatearFechaCompleta } = require("./reservaCitas");
const { ZONA_POR_DEFECTO } = require("./zonaHoraria");
const { formasDe } = require("./telefono");
const { CONFIG } = require("../config");

// Para ver o cancelar citas el número tiene que ser el de la llamada (el
// caller ID, routes/vapi.js), nunca uno que diga quien llama: dictando el de
// otra persona se escuchaban sus citas y se las cancelaba (auditoría del
// comité de QA, octubre de 2026, A5). Sin ese número —una llamada desde la
// página web no lo trae— no se busca nada y se deriva al WhatsApp, donde
// Meta ya verificó el número del paciente.
const SIN_NUMERO_VERIFICADO = "No puedo ver ni cancelar citas en esta llamada: no tengo el número desde el que llama (pasa, por ejemplo, cuando llama desde la página web). No le pidas que te dicte un número. Decile que para ver o cancelar su cita escriba \"cancelar\" al WhatsApp del consultorio, o que llame desde el teléfono con el que reservó.";

// Por voz no hay un link que se gaste (routes/reservaPublica.js): el número
// lo dicta quien llama. Como mucho estas citas futuras por voz por número y
// consultorio, para que una sola llamada no pueda llenar la agenda (A4).
const CITAS_VOZ_POR_TELEFONO = 3;

// "Súper número" de voz: la misma idea que el súper número de WhatsApp
// (mismo WHATSAPP_ESPECIALIDADES_MEDICOS), pero acá no hay una sesión
// guardada — Vapi no la necesita, porque el LLM que conduce la llamada ya
// recuerda por su cuenta qué especialidad eligió el que llama, así que
// alcanza con que la vuelva a mandar como argumento en cada herramienta
// (por eso el parámetro "especialidad" en las funciones de abajo).
// medicoPhoneFijo viene de la URL del webhook (/vapi/webhook/:medicoPhone):
// si es un teléfono real, ese consultorio es fijo (como siempre); si es
// "super", se resuelve caso por caso según la especialidad que mande Vapi.
const ETIQUETA_ESPECIALIDAD = {
  medicina_general: "Medicina General",
  odontologia: "Odontología",
  estetica: "Estética",
  oftalmologia: "Oftalmología",
  veterinaria: "Veterinaria",
  ginecologia: "Ginecología y Obstetricia",
};

async function resolverMedicoPhone(medicoPhoneFijo, especialidad) {
  if (medicoPhoneFijo) return medicoPhoneFijo;
  if (!especialidad) return null;
  const telefonos = CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS;
  const medico = await Medico.findOne({ phone: { $in: telefonos }, tipoEspecialidad: especialidad, activo: true }).select("phone").lean();
  return medico?.phone || null;
}

// Para buscar (no para crear/modificar) alcanza con el teléfono del
// paciente — si en modo súper número el asistente no repitió la
// especialidad (puede pasar, es una llamada real, no todo sale perfecto),
// mejor buscar en todos los consultorios configurados que fallar de una.
async function resolverMedicoPhones(medicoPhoneFijo, especialidad) {
  const medicoPhone = await resolverMedicoPhone(medicoPhoneFijo, especialidad);
  if (medicoPhone) return [medicoPhone];
  if (!medicoPhoneFijo) return CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS;
  return [];
}

// Herramienta propia del modo "súper número": le dice al asistente qué
// especialidades puede ofrecer, para que se las lea al que llama antes de
// preguntar cuál busca.
async function listarEspecialidades() {
  const telefonos = CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS;
  if (!telefonos.length) return "Este número no tiene varias especialidades configuradas.";
  const medicos = await Medico.find({ phone: { $in: telefonos }, activo: true }).select("phone tipoEspecialidad").lean();
  const ordenadas = telefonos.map(ph => medicos.find(m => m.phone === ph)?.tipoEspecialidad).filter(Boolean);
  if (!ordenadas.length) return "Este número no tiene ninguna especialidad configurada todavía.";
  return "Las especialidades disponibles son: " + ordenadas.map(t => ETIQUETA_ESPECIALIDAD[t] || t).join(", ") + ".";
}

// Hasta 8 horarios concretos — una lista más larga es difícil de seguir
// por voz. Cada opción lleva su fecha en ISO entre paréntesis: es lo que
// el asistente tiene que copiar tal cual al llamar a agendar_cita (lo que
// dice en voz alta puede ser su propia versión más natural del texto, esto
// es el dato que necesita para la próxima llamada, no un guion literal).
async function consultarDisponibilidad(medicoPhoneFijo, { diasAdelante, especialidad } = {}) {
  const medicoPhone = await resolverMedicoPhone(medicoPhoneFijo, especialidad);
  if (!medicoPhone) return "No pude identificar el consultorio — preguntale primero qué especialidad busca (usá listar_especialidades si hace falta).";
  const dias = await obtenerHorariosDisponibles(medicoPhone, diasAdelante || 14);
  const opciones = [];
  for (const dia of dias) {
    for (const slot of dia.slots) {
      opciones.push(slot);
      if (opciones.length >= 8) break;
    }
    if (opciones.length >= 8) break;
  }
  if (!opciones.length) {
    return "No hay horarios disponibles cargados por ahora. Decile al paciente que se va a comunicar directo la clínica para coordinar.";
  }
  // El asistente de voz le DICTA estas horas al paciente por teléfono, así
  // que tienen que ser las del consultorio. Con la zona fija de Bolivia, un
  // paciente brasileño escuchaba una hora y llegaba a otra.
  const { Medico } = require("../db/models");
  const m = await Medico.findOne({ phone: medicoPhone }).select("zonaHoraria").lean();
  const zona = m?.zonaHoraria || ZONA_POR_DEFECTO;
  return opciones
    .map((s, i) => `Opción ${i + 1}: ${formatearFechaCompleta(s, zona)} (fechaHora: ${s.toISOString()})`)
    .join(". ");
}

async function agendarCita(medicoPhoneFijo, { fechaHora, pacienteNombre, pacienteTelefono, motivo, especialidad } = {}) {
  const medicoPhone = await resolverMedicoPhone(medicoPhoneFijo, especialidad);
  if (!medicoPhone) return "No pude identificar el consultorio — preguntale primero qué especialidad busca (usá listar_especialidades si hace falta).";
  const medico = await Medico.findOne({ phone: medicoPhone, activo: true });
  if (!medico) return "No se pudo agendar: el consultorio no está disponible en este momento.";

  const nombre = String(pacienteNombre || "").trim();
  const telefono = String(pacienteTelefono || "").trim();
  if (!fechaHora || !nombre || !telefono) {
    return "Faltan datos para agendar la cita: hace falta la fecha y hora exacta (de una opción ya consultada), el nombre completo del paciente, y un teléfono de contacto.";
  }
  const fecha = new Date(fechaHora);
  if (Number.isNaN(fecha.getTime())) {
    return "La fecha y hora no son válidas — volvé a consultar la disponibilidad y usá el valor exacto de 'fechaHora' de una de las opciones.";
  }
  if (fecha.getTime() <= Date.now()) {
    return "Esa fecha ya pasó — elegí un horario futuro de la disponibilidad.";
  }
  const yaTiene = await Cita.countDocuments({
    medicoPhone, pacienteTelefono: { $in: formasDe(telefono) }, origen: "voz", estado: "confirmada", fecha: { $gte: new Date() },
  });
  if (yaTiene >= CITAS_VOZ_POR_TELEFONO) {
    return `Ese número ya tiene ${yaTiene} citas próximas agendadas por teléfono, que es lo máximo por esta vía. No agendes otra: decile que, si necesita más, se comunique directo con la clínica o por WhatsApp.`;
  }

  try {
    const cita = await crearCitaConfirmada({
      medicoPhone, medico, pacienteTelefono: telefono, pacienteNombre: nombre,
      fecha, motivo: String(motivo || "").trim(), origen: "voz",
    });
    return `Listo, la cita quedó confirmada para ${formatearFechaCompleta(cita.fecha, medico.zonaHoraria)} a nombre de ${cita.pacienteNombre}.`;
  } catch (e) {
    // crearCitaConfirmada solo acepta uno de los horarios que se ofrecen: si
    // el asistente armó la fecha por su cuenta en vez de copiar la de una
    // opción, también cae acá.
    if (e.horarioOcupado) {
      return "Ese horario no está disponible (o se acaba de ocupar). Volvé a consultar la disponibilidad, ofrecele al paciente otro horario y usá el valor exacto de 'fechaHora' de la opción que elija.";
    }
    throw e;
  }
}

async function consultarMisCitas(medicoPhoneFijo, { pacienteTelefono, especialidad } = {}) {
  const medicoPhones = await resolverMedicoPhones(medicoPhoneFijo, especialidad);
  if (!medicoPhones.length) return "No pude identificar el consultorio — preguntale primero qué especialidad busca (usá listar_especialidades si hace falta).";
  const telefono = String(pacienteTelefono || "").trim();
  if (!telefono) return SIN_NUMERO_VERIFICADO;

  // formasDe: el caller ID llega con «+» y el WhatsApp guarda solo dígitos
  // (services/telefono.js). Comparado tal cual, quien reservó por WhatsApp
  // no encontraba su cita llamando desde ese mismo teléfono.
  const citas = await Cita.find({
    medicoPhone: { $in: medicoPhones }, pacienteTelefono: { $in: formasDe(telefono) }, estado: "confirmada", fecha: { $gte: new Date() },
  }).sort({ fecha: 1 }).lean();

  if (!citas.length) return "No encontré ninguna cita próxima confirmada con ese número de teléfono.";
  // Cada cita en la hora de su consultorio: con el súper número pueden ser de
  // cuentas de zonas distintas, y sin zona caía a la de La Paz.
  const zonas = new Map((await Medico.find({ phone: { $in: [...new Set(citas.map(c => c.medicoPhone))] } })
    .select("phone zonaHoraria").lean()).map(m => [m.phone, m.zonaHoraria]));
  return citas
    .map(c => `Cita el ${formatearFechaCompleta(c.fecha, zonas.get(c.medicoPhone))} a nombre de ${c.pacienteNombre} (citaId: ${c._id}).`)
    .join(" ");
}

async function cancelarCita(medicoPhoneFijo, { citaId, pacienteTelefono, especialidad } = {}) {
  // El número de la llamada es obligatorio siempre, también con el citaId:
  // con el id solo, desde cualquier teléfono, se cancelaba la cita de otra
  // persona (A5).
  const telefono = String(pacienteTelefono || "").trim();
  if (!telefono) return SIN_NUMERO_VERIFICADO;
  const suya = { pacienteTelefono: { $in: formasDe(telefono) }, estado: "confirmada", fecha: { $gte: new Date() } };

  let cita = null;
  if (citaId) {
    // El id viene de un consultar_mis_citas anterior en esta misma llamada,
    // pero se busca solo entre las citas de los consultorios que atiende
    // este número: el de la URL, o los del súper número. El secreto del
    // webhook es uno para todos los consultorios, y con el id solo se
    // cancelaba la cita de cualquiera (informe de QA del 9 de octubre de 2026).
    const alcance = medicoPhoneFijo ? [medicoPhoneFijo] : CONFIG.WHATSAPP_ESPECIALIDADES_MEDICOS;
    if (mongoose.isValidObjectId(citaId)) {
      cita = await Cita.findOne({ ...suya, _id: citaId, medicoPhone: { $in: alcance } });
    }
  } else {
    const medicoPhones = await resolverMedicoPhones(medicoPhoneFijo, especialidad);
    if (!medicoPhones.length) return "No pude identificar el consultorio — preguntale qué especialidad busca, o pedile el citaId si ya lo consultaste antes.";
    cita = await Cita.findOne({ ...suya, medicoPhone: { $in: medicoPhones } }).sort({ fecha: 1 });
  }
  if (!cita) {
    return "No encontré ninguna cita próxima confirmada para cancelar con el número desde el que llama. Si la reservó con otro número, decile que escriba \"cancelar\" al WhatsApp del consultorio desde ese número.";
  }

  const medico = await Medico.findOne({ phone: cita.medicoPhone }).select("googleCalendarId zonaHoraria").lean();
  cita.estado = "cancelada";
  await cita.save();
  if (medico?.googleCalendarId && cita.googleEventId) {
    await eliminarEvento(medico.googleCalendarId, cita.googleEventId);
  }
  return `Listo, cancelé la cita del ${formatearFechaCompleta(cita.fecha, medico?.zonaHoraria)}.`;
}

module.exports = { listarEspecialidades, consultarDisponibilidad, agendarCita, consultarMisCitas, cancelarCita };
