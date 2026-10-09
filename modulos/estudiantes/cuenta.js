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
//
// El tope de horas es blando, a propósito: suma lo que ya se transcribió
// (la duración la da el servicio de transcripción, no el navegador), y lo
// que se está transcribiendo todavía no cuenta. Con varios audios subiendo
// juntos justo en el borde (los que el celular guardó sin señal, por
// ejemplo), se pasa del tope por esas consultas; la siguiente ya se frena.
// Reservar antes obligaría a creerle al navegador cuánto dura el audio, que
// es justo lo que no hay que hacer (informe de QA del 9 de octubre de 2026,
// E06).
//
// Vencido el acceso, entra y ve sus casos, pero no gasta IA: no graba, no
// le pregunta nada al paciente virtual, a la historia de un paciente ni a la
// ayuda, y no empieza prácticas ni simulacros (las rutas marcadas IA en
// restricciones.js). La práctica que tenía abierta lo espera hasta que
// renueve. Lo que ya subió termina igual: la nota de esa consulta sale.
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

const MOTIVO_VENCIDO = "Tu acceso de estudiante venció. Pedí la renovación a Symphomed; mientras tanto, tus casos siguen acá.";

// Sin ir a la base: lo que cuesta mirarlo antes de cada pedido que gasta IA.
// Una cuenta de estudiante sin fecha cuenta como vencida.
function accesoVencido(medico, ahora = new Date()) {
  if (!esEstudiante(medico)) return false;
  const hasta = medico.estudiante.hasta ? new Date(medico.estudiante.hasta) : null;
  return !hasta || hasta <= ahora;
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
  const vencido = accesoVencido(medico, ahora);
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
      ? MOTIVO_VENCIDO
      : sinHoras
        ? `Usaste las ${horasMes} horas de audio de este mes. El mes que viene se renuevan; si necesitás más, pedíselas a Symphomed.`
        : "",
  };
}

module.exports = { NIVELES, MOTIVO_VENCIDO, generarCodigo, normalizarCodigo, esEstudiante, accesoVencido, estadoDe, inicioDelMes };
