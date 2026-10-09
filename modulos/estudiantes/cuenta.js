// Symphomed — La cuenta de estudiante: estudiantes, internos y residentes.
//
// ═══ QUÉ ES ═══════════════════════════════════════════════════════════════
//
// Un Symphomed más simple para quien todavía se está formando: graba la
// consulta, tiene sus casos y su nota, y aprende a escribir una historia
// clínica viendo cómo queda ordenado lo que contó. Entra con un código de
// invitación que da Symphomed (scripts/codigos_estudiante.js): uno por
// persona, con su vencimiento y sus horas de audio por mes.
//
// Lo que un estudiante NO hace (recetar, escribirle a pacientes, cobrar) y
// cómo lo frena el servidor está en restricciones.js.
//
// ═══ LO QUE CUESTA ═════════════════════════════════════════════════════════
//
// Lo caro es la transcripción. Cada nivel trae sus horas de audio por mes;
// pasado el tope no se empiezan consultas nuevas hasta el mes siguiente.
// Vencido el acceso, entra y ve sus casos, pero no graba.
//
// El paciente virtual y los simulacros (etapa 4) también usan IA, mucho más
// barata que el audio (centavos de dólar por práctica), pero con su tope por
// mes para que nadie la use sin límite.
const { ConsultaMedica } = require("../../db/models");

// Lo que trae cada nivel si el código no dice otra cosa.
const NIVELES = {
  estudiante: { horasMes: 6, pacientesMes: 20, simulacrosMes: 30, precio: { BOB: 4900, BRL: 2900 } },
  interno: { horasMes: 12, pacientesMes: 30, simulacrosMes: 45, precio: { BOB: 8900, BRL: 4900 } },
  residente: { horasMes: 25, pacientesMes: 40, simulacrosMes: 60, precio: { BOB: 17900, BRL: 9900 } },
};

// Sin letras que se confunden al dictarlas o copiarlas (0/O, 1/I/L).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generarCodigo() {
  const crypto = require("crypto");
  let s = "";
  for (const b of crypto.randomBytes(6)) s += ALFABETO[b % ALFABETO.length];
  return "EST-" + s;
}

// «est-ab12cd» o « EST AB12CD » → «EST-AB12CD».
function normalizarCodigo(texto) {
  const limpio = String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!limpio) return "";
  return limpio.startsWith("EST") ? "EST-" + limpio.slice(3) : "EST-" + limpio;
}

const esEstudiante = (medico) => Boolean(medico?.estudiante?.nivel);

function inicioDelMes(ahora = new Date()) {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
}

// Cómo está la cuenta: cuánto audio usó este mes, cuándo vence y si puede
// grabar. Lo usan la pantalla (para avisar antes) y el servidor (para frenar).
async function estadoDe(medico, ahora = new Date()) {
  if (!esEstudiante(medico)) return null;
  const e = medico.estudiante;
  const [suma] = await ConsultaMedica.aggregate([
    { $match: { medicoPhone: medico.phone, createdAt: { $gte: inicioDelMes(ahora) } } },
    { $group: { _id: null, segundos: { $sum: { $ifNull: ["$duracionSegundos", 0] } } } },
  ]);
  const segundosUsados = Math.round(suma?.segundos || 0);
  const horasMes = Number(e.horasMes) || NIVELES[e.nivel]?.horasMes || 0;
  const hasta = e.hasta ? new Date(e.hasta) : null;
  const vencido = !hasta || hasta <= ahora;
  const sinHoras = horasMes > 0 && segundosUsados >= horasMes * 3600;
  const diasRestantes = hasta ? Math.max(0, Math.ceil((hasta - ahora) / 86400000)) : 0;
  return {
    nivel: e.nivel,
    hasta,
    diasRestantes,
    horasMes,
    horasUsadas: Math.round(segundosUsados / 360) / 10,
    vencido,
    sinHoras,
    bloqueado: vencido || sinHoras,
    motivo: vencido
      ? "Tu acceso de estudiante venció. Pedí la renovación a Symphomed para seguir grabando; tus casos siguen acá."
      : sinHoras
        ? `Usaste las ${horasMes} horas de audio de este mes. El mes que viene se renuevan; si necesitás más, pedíselas a Symphomed.`
        : "",
  };
}

module.exports = { NIVELES, generarCodigo, normalizarCodigo, esEstudiante, estadoDe, inicioDelMes };
