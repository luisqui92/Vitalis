// Symphomed — Lo que una cuenta de estudiante puede hacer, y nada más.
//
// ═══ QUÉ, Y POR QUÉ LO FRENA EL SERVIDOR ══════════════════════════════════
//
// No receta, no le escribe a pacientes (WhatsApp, recordatorios, resúmenes,
// informes), no da turnos ni hace teleconsulta, no cobra, no firma. Una nota
// de estudiante no tiene validez sin la firma del médico responsable, y nada
// de lo que hace puede llegarle a un paciente como si viniera de un médico.
//
// Esconder los botones no alcanza: el que conoce la ruta la llama igual. Por
// eso el servidor revisa cada pedido de una cuenta de estudiante, antes de
// cualquier ruta, mirando una marca del token de sesión. Lo que sale solo,
// sin que nadie toque una ruta —el recordatorio de medicamento al paciente—,
// se frena donde se envía.
//
// ═══ UNA LISTA DE LO PERMITIDO, NO DE LO PROHIBIDO ════════════════════════
//
// Antes había una lista de lo prohibido, y falló dos veces (informe de QA del
// 9 de octubre de 2026): firmar un informe no estaba en la lista y quedaba
// abierto, y la lista comparaba la dirección letra por letra mientras Express
// acepta /MEDICO/... y una barra al final. Una lista de prohibidos falla
// abierta: lo que nadie anotó, pasa.
//
// Ahora es al revés:
//   · Leer (GET): lo suyo, sí —toda ruta ya está limitada a la cuenta que
//     llama—, salvo las lecturas que abren algo hacia afuera (una sesión de
//     Memed, una sala de video, el WhatsApp del consultorio).
//   · Escribir (todo lo demás): solo lo que está en ESCRITURA_PERMITIDA. Una
//     ruta nueva nace cerrada para estudiantes hasta que alguien decida
//     abrirla acá.
// La dirección se compara como la compara Express: sin distinguir
// mayúsculas y con la barra final opcional.
//
// Lo que gasta IA va marcado (IA) en la lista: con el acceso vencido no
// pasa, y se mira en cada pedido, no solo al empezar. Antes se miraba al
// empezar una práctica, y una que ya estaba abierta seguía preguntándole a
// la IA después de vencer (E05 del mismo informe).
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
const { NIVELES, MOTIVO_VENCIDO, esEstudiante, accesoVencido, estadoDe } = require("./cuenta");
const { textosDe } = require("./textos");
const { carreraDe } = require("./carreras");

// Como compara Express (sin «case sensitive» ni «strict routing»): /MEDICO/x/
// y /medico/x son la misma ruta.
const normalizar = (ruta) => String(ruta || "").toLowerCase().replace(/\/+$/, "") || "/";

const ID = "[^/]+";
const ruta = (patron) => new RegExp(`^/medico/${patron}$`);

// ─── Lo que un estudiante puede escribir ───────────────────────────────────
//
// [métodos, ruta] o [métodos, ruta, IA]. Lo de su cuenta, las fichas de SUS
// pacientes (que no salen de su cuenta), grabar y confirmar sus consultas, y
// lo del módulo. Nada que le llegue a un paciente, que se cobre, que se
// firme o que se comparta con otra cuenta.
//
// IA: la ruta le pide algo a la IA (o empieza algo que se lo va a pedir).
// Si abrís una ruta que gasta IA, marcala.
const IA = "ia";
const ESCRITURA_PERMITIDA = [
  // Entrar (no usan el token, pero puede viajar uno viejo).
  ["POST", ruta("login")], ["POST", ruta("login/2fa")], ["POST", ruta("registro-estudiante")],
  // Su cuenta.
  ["PATCH", ruta("idioma")],
  ["POST", ruta("2fa/(iniciar|confirmar|desactivar)")],
  ["POST", ruta("baja/solicitar")],
  ["POST DELETE", ruta("perfil/foto")],
  ["POST", ruta("push/(suscribir|baja|probar)")],
  // El celular como micrófono de la compu.
  ["POST", ruta("vinculacion/(vincular|comando|estado)")],
  // La ayuda de Symphomed.
  ["POST", ruta("asistente"), IA],
  // Sus pacientes y sus fichas.
  ["POST", ruta("pacientes")],
  ["PATCH", ruta(`pacientes/${ID}`)],
  ["POST", ruta(`pacientes/${ID}/(antecedentes-personales|antecedentes-familiares|medicamentos|vacunas|mediciones|estudios|recordatorios)`)],
  ["POST", ruta(`pacientes/${ID}/preguntar`), IA],
  ["PATCH DELETE", ruta(`(medicamentos|recordatorios)/${ID}`)],
  ["DELETE", ruta(`(vacunas|mediciones|estudios)/${ID}`)],
  ["PATCH", ruta(`estudios/${ID}/visor`)],
  // Las fichas de especialidad (también son solo de su paciente).
  ["PATCH", ruta(`pacientes/${ID}/(odontograma|examen-ocular|examen-ginecologico)(/${ID})*`)],
  ["POST", ruta(`pacientes/${ID}/(mapa-corporal|embarazo|instrumentos)`)],
  ["POST", ruta(`pacientes/${ID}/mapa-corporal/${ID}/control`)],
  ["DELETE", ruta(`pacientes/${ID}/mapa-corporal/${ID}`)],
  ["PATCH DELETE", ruta(`(embarazo|instrumentos)/${ID}`)],
  ["POST", ruta(`embarazo/${ID}/finalizar`)],
  ["PATCH", ruta(`pacientes/${ID}/(neuro|fisio)`)],
  ["POST", ruta(`pacientes/${ID}/neuro/(sensorial|objetivos|vigilancia|vigilancia/plantilla)`)],
  ["POST", ruta(`pacientes/${ID}/fisio/(dolor|mediciones|objetivos)`)],
  ["DELETE", ruta(`pacientes/${ID}/fisio/dolor/${ID}`)],
  ["POST", ruta(`(neuro|fisio)/objetivos/${ID}/progreso`)],
  ["PATCH DELETE", ruta(`(neuro|fisio)/objetivos/${ID}`)],
  ["POST", ruta(`neuro/vigilancia/${ID}/realizado`)],
  ["DELETE", ruta(`neuro/vigilancia/${ID}`)],
  ["DELETE", ruta(`fisio/mediciones/${ID}`)],
  // Grabar y confirmar sus consultas (el recorte de lo que confirma está en
  // recortarAlConfirmar, más abajo).
  ["POST", ruta("consultas"), IA],
  ["POST", ruta("consultas/nota-en-vivo"), IA],
  ["POST", ruta(`consultas/${ID}/razonamiento`), IA],
  // Lo que termina una consulta que ya subió: sale aunque el acceso venza
  // en el medio (ver cuenta.js).
  ["POST", ruta(`consultas/${ID}/(texto-en-vivo|nota/regenerar|confirmar|transcripcion/reintentar)`)],
  // Lo del módulo.
  ["POST DELETE", ruta(`estudio/tarjetas/${ID}/reportar`)],
  ["POST", ruta(`estudio/tarjetas/${ID}/responder`)],
  ["POST", ruta("(pacientes-virtuales|simulacros)"), IA],
  ["POST", ruta(`pacientes-virtuales/${ID}/(mensajes|terminar)`), IA],
  ["POST", ruta(`pacientes-virtuales/${ID}/reportar`)],
  // Contestar un simulacro no le pide nada a la IA: las preguntas ya están.
  ["POST", ruta(`simulacros/${ID}/(responder|terminar|reportar)`)],
  ["POST", ruta(`simulacros/preguntas/${ID}/reportar`)],
];

// ─── Lo que no puede ni leer ───────────────────────────────────────────────
//
// Porque ahí leer ya hace algo (abrir una sesión de Memed para recetar, una
// sala de video, pedir un cobro) o es para compartir con otros (el WhatsApp
// del consultorio, el equipo tratante). Las lecturas de estado que el panel
// pide para cualquier cuenta (si hay Memed, la bandeja de la Caja DICOM, los
// equipos de rayos) sí: son de su cuenta y le vuelven vacías.
const LECTURA_CERRADA = [
  /^\/medico\/pacientes\/[^/]+\/memed(\/|$)/,
  /^\/medico\/(teleconsulta|teleconsultas)(\/|$)/,
  /^\/medico\/pacientes\/[^/]+\/teleconsulta(\/|$)/,
  /^\/medico\/recargas(\/|$)/,
  /^\/medico\/(whatsapp|equipos)(\/|$)/,
  /^\/medico\/pacientes\/[^/]+\/equipo(\/|$)/,
];

// La regla que deja pasar este pedido, o null. Leer no gasta IA: las
// lecturas que se permiten son las que no hacen nada.
function reglaDe(metodo, rutaPedida) {
  const r = normalizar(rutaPedida);
  const m = String(metodo || "").toUpperCase();
  if (m === "GET" || m === "HEAD") return LECTURA_CERRADA.some(re => re.test(r)) ? null : { ia: false };
  const regla = ESCRITURA_PERMITIDA.find(([metodos, re]) => metodos.split(" ").includes(m) && re.test(r));
  return regla ? { ia: regla[2] === IA } : null;
}
const rutaPermitida = (metodo, rutaPedida) => Boolean(reglaDe(metodo, rutaPedida));
const rutaBloqueada = (metodo, rutaPedida) => !rutaPermitida(metodo, rutaPedida);
const gastaIA = (metodo, rutaPedida) => Boolean(reglaDe(metodo, rutaPedida)?.ia);

// Va antes de todas las rutas (index.js monta el módulo ahí). Mira la marca
// del token —la pone el login, por el punto «sesion.token»—, y solo va a la
// base si la ruta gasta IA, para ver si el acceso sigue vigente. A un médico
// no le cuesta nada: sin la marca, pasa derecho.
// Lo que no es /medico/ (las páginas públicas, /admin, /socio) no lo toca:
// ahí un token de médico no entra de todos modos.
async function middlewareEstudiantes(req, res, next) {
  const r = normalizar(req.path);
  if (r !== "/medico" && !r.startsWith("/medico/")) return next();
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query?.token;
  const payload = token ? verificarToken(token) : null;
  if (!payload?.estudiante) return next();
  const regla = reglaDe(req.method, req.path);
  if (!regla) return res.status(403).json({ error: "Esto no está disponible en una cuenta de estudiante.", estudiante: true });
  if (!regla.ia) return next();
  try {
    const medico = await Medico.findOne({ phone: payload.usuario }).select("phone estudiante activo").lean();
    // Sin cuenta, o dada de baja: no hay a quién cobrarle la IA. La ruta igual
    // lo frenaría (services/auth.js), pero esto no puede depender de eso.
    if (!medico || medico.activo === false) return res.status(401).json({ error: "Tu sesión ya no es válida. Volvé a iniciar sesión." });
    if (accesoVencido(medico)) return res.status(402).json({ error: MOTIVO_VENCIDO, vencido: true });
  } catch (e) {
    return next(e);
  }
  return next();
}

// ─── Vencida o sin horas, no graba ─────────────────────────────────────────
//
// Se mira al pedir el pase de la vista previa —que es cuando empieza a
// grabar—, mientras la vista previa está abierta (la corta en el tope), al
// pedir la nota en vivo y al subir. Lo usa también el razonamiento
// (rutas/razonamiento.js), que gasta IA.
//
// Al subir, la vista previa de esa misma grabación (req.vistaPrevia) no
// cuenta: la grabación que empezó con horas se sube (ver cuenta.js).
async function frenarSinAcceso(req) {
  if (!req.adminUser?.estudiante) return;
  const medico = await Medico.findOne({ phone: req.adminUser.usuario }).select("phone estudiante").lean();
  const estado = await estadoDe(medico, new Date(), { sinVistaPrevia: req.vistaPrevia?._id });
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
      ? { nivel: medico.estudiante.nivel, carrera: carreraDe(medico), hasta: medico.estudiante.hasta, horasMes: medico.estudiante.horasMes }
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
  extensiones.enganchar("vistaPrevia.durante", frenarSinAcceso);
  extensiones.enganchar("consulta.alCrear", marcarConsulta);
  extensiones.enganchar("consulta.alConfirmar", recortarAlConfirmar);
  extensiones.enganchar("paciente.mensajes", puedeEscribirle);
  extensiones.enganchar("kardex.alertas", alertaDelKardex);
}

module.exports = { montar, rutaPermitida, rutaBloqueada, gastaIA, normalizar, middlewareEstudiantes, frenarSinAcceso, ESCRITURA_PERMITIDA, LECTURA_CERRADA, IA };
