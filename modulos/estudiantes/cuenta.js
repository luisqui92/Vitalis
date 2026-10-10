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
// Cuentan las dos cosas que se pagan: lo que se transcribió (la duración la
// da el servicio de transcripción, no el navegador) y el tiempo que estuvo
// abierta la vista previa en vivo (lo mide el servidor, que es por donde
// pasa: services/vistaPrevia.js). Una grabación y su vista previa son la
// misma hora de consulta: se cuenta la más larga de las dos, no la suma.
// Una vista previa sin grabación subida cuenta entera.
//
// La vista previa se corta en el tope, en el momento (segunda revisión de QA
// del 9 de octubre de 2026, E06). La grabación no: la que se empezó con
// horas se sube aunque la vista previa la haya pasado del tope, y recién la
// siguiente se frena. Cortar la grabación le tiraría a la basura una
// consulta con el paciente adelante.
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
const { ConsultaMedica, VistaPrevia } = require("../../db/models");

// Lo que trae cada nivel si el código no dice otra cosa.
//
// Las horas salen del costo. Una hora de consulta grabada cuesta unos
// US$ 1,25 (octubre de 2026): la vista previa en vivo (AssemblyAI en tiempo
// real con modo médico, US$ 0,60), la transcripción final (US$ 0,43) y la IA
// de la nota, la nota en vivo y el tutor (unos US$ 0,20). Con estas horas, ni
// el que usa todo el mes deja pérdida, aun pagando impuestos; antes eran 6,
// 12 y 25 h, y con esas un estudiante que usaba todo costaba más de lo que
// pagaba. El paciente virtual y los simulacros son centavos.
const NIVELES = {
  estudiante: { horasMes: 3, pacientesMes: 20, simulacrosMes: 30, precio: { BOB: 4900, BRL: 2900 } },
  interno: { horasMes: 6, pacientesMes: 30, simulacrosMes: 45, precio: { BOB: 8900, BRL: 4900 } },
  residente: { horasMes: 12, pacientesMes: 40, simulacrosMes: 60, precio: { BOB: 17900, BRL: 9900 } },
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

// Los segundos de audio que usó este mes. Cada vista previa suma lo que dura
// más que su grabación (si la grabación ya tiene duración), o entera.
// sinVistaPrevia: la de la grabación que se está subiendo, que no cuenta
// para decidir si se puede subir (ver arriba).
async function segundosDelMes(medicoPhone, ahora, sinVistaPrevia) {
  const desde = inicioDelMes(ahora);
  const [consultas, vistas] = await Promise.all([
    ConsultaMedica.find({ medicoPhone, createdAt: { $gte: desde } }).select("duracionSegundos").lean(),
    VistaPrevia.find({ medicoPhone, inicio: { $gte: desde } }).select("segundos consultaId").lean(),
  ]);
  const duracion = new Map(consultas.map(c => [String(c._id), Number(c.duracionSegundos) || 0]));
  let segundos = [...duracion.values()].reduce((a, b) => a + b, 0);
  for (const v of vistas) {
    if (sinVistaPrevia && String(v._id) === String(sinVistaPrevia)) continue;
    segundos += Math.max(0, (Number(v.segundos) || 0) - (duracion.get(String(v.consultaId)) || 0));
  }
  return segundos;
}

// Cómo está la cuenta: cuánto audio usó este mes, cuándo vence y si puede
// grabar. Lo usan la pantalla (para avisar antes) y el servidor (para frenar).
async function estadoDe(medico, ahora = new Date(), { sinVistaPrevia = null } = {}) {
  if (!esEstudiante(medico)) return null;
  const e = medico.estudiante;
  const segundosUsados = Math.round(await segundosDelMes(medico.phone, ahora, sinVistaPrevia));
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
