// Symphomed — El paciente virtual (ver ../pacienteVirtual.js).
//
// Solo cuentas de estudiante, con acceso vigente (usa IA) y con su cupo del
// mes. Armar un caso nuevo tarda: se prepara en segundo plano y la pantalla
// pregunta cada pocos segundos hasta que está listo.
const { Medico } = require("../../../db/models");
const { SimulacionPaciente, CasoVirtual } = require("../modelos");
const { requireAuth } = require("../../../services/auth");
const { limitMedico } = require("../../../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../../../services/httpHelpers");
const { sinCambios } = require("../../../services/realtime");
const { estadoDe: estadoDeEstudiante } = require("../cuenta");
const { marcarDiaDeEstudio, zonaDe, reportarEnBanco } = require("../estudio");
const { conCandado, claveDelPedido } = require("../candado");
const pv = require("../pacienteVirtual");
const { log } = require("../../../config");

const requireMedico = requireAuth(["medico"]);
const MOTIVOS_REPORTE_CASO = ["incoherente", "paciente", "evaluacion"];

function soloEstudiantes(req) {
  if (!req.adminUser.estudiante) throw new ErrorHttp(403, "El paciente virtual es de las cuentas de estudiante.");
  return req.adminUser.usuario;
}

// Nada de lo que pasa en una práctica cambia lo que muestran las otras
// pantallas: sin esto, cada pregunta al paciente le haría recargar el panel a
// la compu de al lado (services/realtime.js).
function escritura(req, res) {
  sinCambios(res);
  return soloEstudiantes(req);
}

module.exports = function (app) {
  // El cupo del mes, la práctica en curso (si hay) y las últimas.
  app.get("/medico/pacientes-virtuales", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    const medico = await Medico.findOne({ phone: medicoPhone }).select("phone estudiante").lean();
    const [cupo, abiertas, terminadas] = await Promise.all([
      pv.cupoDe(medico),
      SimulacionPaciente.find({ medicoPhone, estado: { $in: ["preparando", "en_curso", "evaluando"] } }).sort({ createdAt: -1 }).limit(1).lean(),
      SimulacionPaciente.find({ medicoPhone, estado: "terminada" }).sort({ terminadaEn: -1 }).limit(10)
        .select("area dificultad createdAt guion.diagnostico evaluacion.diagnostico evaluacion.preguntasClave").lean(),
    ]);
    res.json({
      cupo,
      areas: pv.AREAS,
      enCurso: abiertas[0] ? { _id: abiertas[0]._id, area: abiertas[0].area, estado: abiertas[0].estado, paciente: abiertas[0].guion?.paciente || null } : null,
      historial: terminadas.map(pv.resumenDe),
    });
  }));

  // Empezar una práctica nueva. La que estuviera abierta queda abandonada.
  //
  // De a una por estudiante (candado.js): con dos «empezar» juntos y un solo
  // cupo, el segundo se entera de que ya hay una en camino en vez de crear
  // otra (E03 del informe de QA). Con la clave de la pantalla, repetir el
  // pedido —se cortó la conexión antes de la respuesta— devuelve la misma
  // práctica en vez de gastar otro cupo.
  app.post("/medico/pacientes-virtuales", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const pedida = String(req.body?.area || "");
    const area = pedida === "cualquiera" ? pv.AREAS[Math.floor(Math.random() * pv.AREAS.length)] : pedida;
    const dificultad = String(req.body?.dificultad || "intermedio");
    if (!pv.AREAS.includes(area)) throw new ErrorHttp(400, "Elegí un área.");
    if (!pv.DIFICULTADES.includes(dificultad)) throw new ErrorHttp(400, "Elegí la dificultad.");
    const clave = claveDelPedido(req);
    const sim = await conCandado(`pv:${medicoPhone}`, "Ya estás empezando una práctica. Esperá un momento.", async () => {
      const repetida = clave ? await SimulacionPaciente.findOne({ medicoPhone, clave }).lean() : null;
      if (repetida) return repetida;
      const medico = await Medico.findOne({ phone: medicoPhone }).select("phone idioma estudiante").lean();
      const estado = await estadoDeEstudiante(medico);
      if (estado?.vencido) throw new ErrorHttp(402, estado.motivo);
      const cupo = await pv.cupoDe(medico);
      if (!cupo.quedan) throw new ErrorHttp(402, `Ya hiciste los ${cupo.limite} pacientes virtuales de este mes. El mes que viene se renuevan.`);
      await SimulacionPaciente.updateMany({ medicoPhone, estado: { $in: ["preparando", "en_curso"] } }, { $set: { estado: "abandonada" } });
      const nueva = await SimulacionPaciente.create({ medicoPhone, idioma: medico.idioma || "es", area, dificultad, ...(clave ? { clave } : {}) });
      // En segundo plano: la pantalla pregunta hasta que esté listo.
      pv.prepararSimulacion(nueva._id).catch(e => log.warn("[PACIENTE_VIRTUAL]", e.message));
      return nueva.toObject();
    });
    res.json({ simulacion: pv.vista(sim) });
  }));

  app.get("/medico/pacientes-virtuales/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    res.json({ simulacion: pv.vista(await pv.obtener(medicoPhone, req.params.id)) });
  }));

  // Una pregunta al paciente, o un pedido de examen o de estudio.
  //
  // De a un turno por práctica (candado.js). Antes el tope se miraba antes de
  // llamar a la IA y nada lo reservaba: con 79 de 80, dos preguntas juntas
  // pasaban las dos, se le pagaban dos respuestas a la IA y cada una salía
  // sin conocer la otra (E04 del informe de QA). Ahora la segunda espera su
  // turno, y el tope se vuelve a mirar al guardar. Con la clave de la
  // pantalla, repetir una pregunta cuya respuesta se perdió en el camino
  // devuelve la que ya se guardó, sin preguntarle de nuevo a la IA.
  app.post("/medico/pacientes-virtuales/:id/mensajes", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const tipo = ["pregunta", "examen", "estudio"].includes(req.body?.tipo) ? req.body.tipo : null;
    const pedido = String(req.body?.texto || "").trim().slice(0, pv.MAX_TEXTO);
    if (!tipo || !pedido) throw new ErrorHttp(400, "Escribí qué le querés preguntar o pedir.");
    const clave = claveDelPedido(req);
    const { _id } = await pv.obtener(medicoPhone, req.params.id);
    const nuevos = await conCandado(`pv-turno:${_id}`, "Esperá la respuesta del paciente antes de preguntar otra cosa.", async () => {
      const sim = await pv.obtener(medicoPhone, req.params.id);
      const ya = clave ? pv.turnoGuardado(sim, clave) : null;
      if (ya) return ya;
      if (sim.estado !== "en_curso") throw new ErrorHttp(409, "Esta práctica ya terminó.");
      if (pv.preguntasDe(sim) >= pv.MAX_MENSAJES) {
        throw new ErrorHttp(409, `Llegaste a ${pv.MAX_MENSAJES} mensajes: terminá y da tu diagnóstico.`);
      }
      let respuesta, hallazgo = null;
      try {
        if (tipo === "pregunta") respuesta = await pv.responderComoPaciente(sim, pedido);
        else { hallazgo = await pv.pedirHallazgo(sim, tipo, pedido); respuesta = hallazgo.texto; }
      } catch (e) {
        log.warn("[PACIENTE_VIRTUAL] respuesta:", e.message);
        throw new ErrorHttp(502, tipo === "pregunta" ? "El paciente no contestó. Probá de nuevo." : "No salió el resultado. Probá de nuevo.");
      }
      const ahora = new Date();
      const turno = [
        { rol: "estudiante", tipo, texto: pedido, en: ahora, ...(clave ? { clave } : {}) },
        { rol: tipo === "pregunta" ? "paciente" : "sistema", tipo, texto: respuesta, en: ahora },
      ];
      const push = { mensajes: { $each: turno } };
      if (hallazgo?.nuevo) push.hallazgos = { tipo, clave: hallazgo.clave, texto: hallazgo.texto };
      // El tope, otra vez al guardar: si el candado venció porque la IA tardó
      // de más, igual no se pasa.
      const r = await SimulacionPaciente.updateOne({ _id: sim._id, estado: "en_curso", ...pv.filtroConLugar() }, { $push: push });
      if (!r.modifiedCount) {
        const actual = await SimulacionPaciente.findById(sim._id).select("estado").lean();
        throw new ErrorHttp(409, actual?.estado === "en_curso"
          ? `Llegaste a ${pv.MAX_MENSAJES} mensajes: terminá y da tu diagnóstico.`
          : "Esta práctica ya terminó.");
      }
      return turno;
    }, { ms: 3 * 60 * 1000 });
    res.json({ mensajes: nuevos.map(pv.sinClave) });
  }));

  // Su diagnóstico, y recién ahí la evaluación y el caso entero.
  app.post("/medico/pacientes-virtuales/:id/terminar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const principal = String(req.body?.principal || "").trim().slice(0, 160);
    const crudos = Array.isArray(req.body?.diferenciales) ? req.body.diferenciales : String(req.body?.diferenciales || "").split(/[,;\n]/);
    const diferenciales = crudos.map(x => String(x || "").trim().slice(0, 160)).filter(Boolean).slice(0, 6);
    const plan = String(req.body?.plan || "").trim().slice(0, 600);
    if (principal.length < 3) throw new ErrorHttp(400, "Escribí tu diagnóstico principal.");
    const sim = await pv.obtener(medicoPhone, req.params.id);
    if (sim.estado !== "en_curso") throw new ErrorHttp(409, "Esta práctica ya terminó.");
    const preguntas = (sim.mensajes || []).filter(m => m.rol === "estudiante" && m.tipo === "pregunta").length;
    if (preguntas < pv.MIN_PREGUNTAS) throw new ErrorHttp(400, `Hacele al menos ${pv.MIN_PREGUNTAS} preguntas al paciente antes de terminar.`);
    const respuesta = { principal, diferenciales, plan, en: new Date() };
    // Si tocó dos veces, evalúa una sola. Y con el turno de la conversación:
    // si el paciente todavía está contestando una pregunta, se espera a esa
    // respuesta, que también va a la evaluación.
    const r = await conCandado(`pv-turno:${sim._id}`, "Esperá la respuesta del paciente antes de terminar.", () =>
      SimulacionPaciente.updateOne({ _id: sim._id, estado: "en_curso" }, { $set: { estado: "evaluando", respuesta } }));
    if (!r.modifiedCount) throw new ErrorHttp(409, "Esta práctica ya terminó.");
    // La conversación como quedó al cerrarla (pudo entrar una respuesta más
    // entre que se leyó y se cerró).
    const cerrada = await SimulacionPaciente.findById(sim._id).lean();
    let evaluacion;
    try {
      evaluacion = await pv.evaluar({ ...cerrada, respuesta });
    } catch (e) {
      log.warn("[PACIENTE_VIRTUAL] evaluación:", e.message);
      await SimulacionPaciente.updateOne({ _id: sim._id, estado: "evaluando" }, { $set: { estado: "en_curso" } });
      throw new ErrorHttp(502, "No se pudo armar la evaluación. Probá de nuevo en un rato.");
    }
    await SimulacionPaciente.updateOne({ _id: sim._id, estado: "evaluando" }, { $set: { estado: "terminada", evaluacion, terminadaEn: new Date() } });
    // Terminar una práctica cuenta como día de estudio; se anota antes de
    // contestar, para que el inicio ya la muestre.
    await marcarDiaDeEstudio(medicoPhone, await zonaDe(medicoPhone)).catch(e => log.warn("[ESTUDIO] racha:", e.message));
    res.json({ simulacion: pv.vista(await pv.obtener(medicoPhone, req.params.id)) });
  }));

  // «Este caso está mal»: con dos estudiantes distintos, sale del banco.
  app.post("/medico/pacientes-virtuales/:id/reportar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const motivo = String(req.body?.motivo || "");
    if (!MOTIVOS_REPORTE_CASO.includes(motivo)) throw new ErrorHttp(400, "Elegí qué está mal.");
    const sim = await pv.obtener(medicoPhone, req.params.id);
    if (!sim.casoId) throw new ErrorHttp(409, "Esta práctica no tiene caso todavía.");
    await reportarEnBanco(CasoVirtual, sim.casoId, medicoPhone, motivo, "oculto");
    res.json({ ok: true });
  }));
};
