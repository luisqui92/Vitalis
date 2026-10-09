// Symphomed — Lo que una cuenta de estudiante no puede hacer.
//
// ═══ QUÉ, Y POR QUÉ LO FRENA EL SERVIDOR ══════════════════════════════════
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
// ═══ SIEMPRE ACTIVO ════════════════════════════════════════════════════════
//
// Esto se monta aunque el módulo esté apagado (MODULO_ESTUDIANTES=apagado):
// apagar el módulo saca las funciones de estudio, no las reglas de las
// cuentas que ya existen. Un estudiante nunca puede pasar a recetar porque
// alguien apagó un interruptor.
//
// Todo entra al núcleo por sus puntos de extensión (services/extensiones.js):
// el núcleo no sabe que existen los estudiantes.
const { Medico, ConsultaMedica } = require("../../db/models");
const { verificarToken } = require("../../services/auth");
const { ErrorHttp } = require("../../services/httpHelpers");
const extensiones = require("../../services/extensiones");
const { NIVELES, esEstudiante, estadoDe } = require("./cuenta");
const { textosDe } = require("./textos");

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

// Va antes de todas las rutas (index.js monta el módulo ahí). Solo mira el
// token: la marca «estudiante» la pone el login, por el punto «sesion.token».
function middlewareEstudiantes(req, res, next) {
  if (!req.path.startsWith("/medico/")) return next();
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query?.token;
  const payload = token ? verificarToken(token) : null;
  if (!payload?.estudiante || !rutaBloqueada(req.method, req.path)) return next();
  return res.status(403).json({ error: "Esto no está disponible en una cuenta de estudiante.", estudiante: true });
}

// ─── Vencida o sin horas, no graba ─────────────────────────────────────────
//
// Se mira al pedir el token de la vista previa —que es cuando empieza a
// grabar—, al pedir la nota en vivo y al subir. Lo usa también el
// razonamiento (rutas/razonamiento.js), que gasta IA.
async function frenarSinAcceso(req) {
  if (!req.adminUser?.estudiante) return;
  const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("phone estudiante").lean();
  const estado = await estadoDe(medico);
  if (estado?.bloqueado) throw new ErrorHttp(402, estado.motivo);
}

const NIVELES_VALIDOS = Object.keys(NIVELES);
const esCuentaDeEstudiante = async (medicoPhone) =>
  Boolean(await Medico.exists({ phone: medicoPhone, "estudiante.nivel": { $in: NIVELES_VALIDOS } }));

// ─── Los enganches con el núcleo ───────────────────────────────────────────
//
// Funciones con nombre (no flechas sueltas): montar dos veces no engancha
// dos veces (services/extensiones.js las cuenta una sola vez).

// La marca que mira el middleware en cada pedido, sin ir a la base.
function marcaDelToken(medico) {
  return esEstudiante(medico) ? { estudiante: true } : {};
}

// Para que la pantalla dibuje el Symphomed simple. Igual que el rol: no es
// el permiso, el permiso lo revisa el servidor.
function datosDeLaSesion(medico) {
  return {
    estudiante: esEstudiante(medico)
      ? { nivel: medico.estudiante.nivel, hasta: medico.estudiante.hasta, horasMes: medico.estudiante.horasMes }
      : null,
  };
}

// La nota de un estudiante lleva la marca para siempre, aunque se reciba.
function marcarConsulta(req) {
  return req.adminUser?.estudiante ? { deEstudiante: true } : {};
}

// De lo que pida al confirmar, no receta, no agenda reconsultas por WhatsApp
// ni arma presupuestos. La nota, la medicación y los antecedentes sí: es su
// caso.
function recortarAlConfirmar(req) {
  return req.adminUser?.estudiante ? { receta: false, reconsulta: null, tratamientos: [] } : {};
}

async function puedeEscribirle({ medicoPhone }) {
  return !(await esCuentaDeEstudiante(medicoPhone));
}

// Primero en el Kardex en PDF: la cuenta es de estudiante hoy, o alguna
// consulta de este paciente se grabó cuando lo era.
async function alertaDelKardex({ medicoPhone, paciente, idioma }) {
  const deEstudiante = await esCuentaDeEstudiante(medicoPhone)
    || Boolean(await ConsultaMedica.exists({ pacienteId: paciente._id, medicoPhone, deEstudiante: true }));
  return deEstudiante ? [textosDe(idioma).kardexAlerta] : [];
}

function montar(app) {
  app.use(middlewareEstudiantes);
  extensiones.enganchar("sesion.token", marcaDelToken);
  extensiones.enganchar("sesion.datos", datosDeLaSesion);
  extensiones.enganchar("consulta.antesDeGrabar", frenarSinAcceso);
  extensiones.enganchar("consulta.alCrear", marcarConsulta);
  extensiones.enganchar("consulta.alConfirmar", recortarAlConfirmar);
  extensiones.enganchar("paciente.mensajes", puedeEscribirle);
  extensiones.enganchar("kardex.alertas", alertaDelKardex);
}

module.exports = { montar, rutaBloqueada, middlewareEstudiantes, frenarSinAcceso, RUTAS_BLOQUEADAS };
