// Symphomed — Cuentas de estudiante: estudiantes, internos y residentes.
//
// ═══ QUÉ ES ═══════════════════════════════════════════════════════════════
//
// Un Symphomed más simple para quien todavía se está formando: graba la
// consulta, tiene sus casos y su nota, y aprende a escribir una historia
// clínica viendo cómo queda ordenado lo que contó. Entra con un código de
// invitación que da Symphomed (scripts/codigos_estudiante.js): uno por
// persona, con su vencimiento y sus horas de audio por mes.
//
// ═══ LO QUE UN ESTUDIANTE NO HACE, Y POR QUÉ LO BLOQUEA EL SERVIDOR ═══════
//
// No receta, no le escribe a pacientes (WhatsApp, recordatorios, resúmenes,
// informes), no da turnos ni hace teleconsulta, no cobra. Una nota de
// estudiante no tiene validez sin la firma del médico responsable, y nada
// de lo que hace puede llegarle a un paciente como si viniera de un médico.
//
// Esconder los botones no alcanza: el que conoce la ruta la llama igual.
// Por eso hay una lista de rutas bloqueadas (abajo) que se revisa en cada
// pedido, antes de cualquier ruta, mirando una marca del token de sesión.
// Lo que sale solo, sin que nadie toque una ruta —el recordatorio de
// medicamento al paciente—, se frena donde se envía.
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
const { ConsultaMedica } = require("../db/models");

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

// ─── Las rutas que un estudiante no puede usar ─────────────────────────────
//
// [métodos, ruta]. «escritura» bloquea todo lo que no sea GET: ver su propia
// agenda vacía o la lista de sus recetas (ninguna) no le hace daño a nadie, y
// pantallas como el inicio del escritorio las piden. «todo» bloquea también
// la lectura, porque ahí leer ya hace algo (abrir una sesión de Memed, una
// sala de video) o porque no tiene nada que ver con un estudiante.
const RUTAS_BLOQUEADAS = [
  ["escritura", /^\/medico\/recetas(-opticas)?(\/|$)/],
  ["escritura", /^\/medico\/pacientes\/[^/]+\/recetas(-opticas)?(\/|$)/],
  ["todo", /^\/medico\/(pacientes\/[^/]+\/)?memed(\/|$)/],
  // Reconsulta: agenda y le escribe al paciente por WhatsApp.
  ["todo", /^\/medico\/consultas\/[^/]+\/reconsulta(\/|$)/],
  // Presupuesto: es cobrar.
  ["todo", /^\/medico\/consultas\/[^/]+\/tratamientos-sugeridos(\/|$)/],
  // Lo que le llega al paciente: su llave, resúmenes, informes enviados.
  ["todo", /^\/medico\/pacientes\/[^/]+\/llave(\/|$)/],
  ["escritura", /^\/medico\/pacientes\/[^/]+\/resumenes(\/|$)/],
  ["escritura", /^\/medico\/resumenes(\/|$)/],
  ["todo", /^\/medico\/informes(-familia)?\/[^/]+\/enviar$/],
  // Turnos, horario de reservas, teleconsulta.
  ["escritura", /^\/medico\/(citas|horario)(\/|$)/],
  ["todo", /^\/medico\/(teleconsulta|teleconsultas)(\/|$)/],
  ["todo", /^\/medico\/pacientes\/[^/]+\/teleconsulta(\/|$)/],
  // Plata: cobros, presupuestos, insumos, recargas.
  ["escritura", /^\/medico\/(finanzas|tratamientos|catalogo-tratamientos|insumos)(\/|$)/],
  ["escritura", /^\/medico\/pacientes\/[^/]+\/tratamientos(\/|$)/],
  ["todo", /^\/medico\/recargas(\/|$)/],
  // WhatsApp del consultorio y equipos de la clínica (la Caja DICOM).
  ["todo", /^\/medico\/(whatsapp|dicom|equipos|rayos)(\/|$)/],
];

function rutaBloqueada(metodo, ruta) {
  const esLectura = metodo === "GET" || metodo === "HEAD";
  return RUTAS_BLOQUEADAS.some(([alcance, re]) => re.test(ruta) && (alcance === "todo" || !esLectura));
}

// Va antes de todas las rutas (index.js). Solo mira el token: la marca
// «estudiante» la pone el login (routes/medicoAuth.js → tokenDeMedico).
function middlewareEstudiantes(req, res, next) {
  if (!req.path.startsWith("/medico/")) return next();
  const { verificarToken } = require("./auth");
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query?.token;
  const payload = token ? verificarToken(token) : null;
  if (!payload?.estudiante || !rutaBloqueada(req.method, req.path)) return next();
  return res.status(403).json({ error: "Esto no está disponible en una cuenta de estudiante.", estudiante: true });
}

module.exports = { NIVELES, generarCodigo, normalizarCodigo, esEstudiante, estadoDe, rutaBloqueada, middlewareEstudiantes, inicioDelMes };
