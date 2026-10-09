// Symphomed — Simulacros por especialidad (ver ../simulacros.js).
//
// Solo cuentas de estudiante, con acceso vigente y con su cupo del mes. Si
// faltan preguntas en el banco se generan en segundo plano, y la pantalla
// pregunta cada pocos segundos hasta que está listo.
const { Medico } = require("../../../db/models");
const { Simulacro } = require("../modelos");
const { requireAuth } = require("../../../services/auth");
const { limitMedico } = require("../../../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../../../services/httpHelpers");
const { sinCambios } = require("../../../services/realtime");
const { estadoDe: estadoDeEstudiante } = require("../cuenta");
const { zonaDe, MOTIVOS_REPORTE } = require("../estudio");
const { conCandado, claveDelPedido } = require("../candado");
const sim = require("../simulacros");
const { log } = require("../../../config");

const requireMedico = requireAuth(["medico"]);

function soloEstudiantes(req) {
  if (!req.adminUser.estudiante) throw new ErrorHttp(403, "Los simulacros son de las cuentas de estudiante.");
  return req.adminUser.usuario;
}

// Responder no cambia lo que muestran las otras pantallas (services/realtime.js).
function escritura(req, res) {
  sinCambios(res);
  return soloEstudiantes(req);
}

module.exports = function (app) {
  // El cupo, cómo le va por área, el que tenga abierto y los últimos.
  app.get("/medico/simulacros", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    // Un examen que quedó a medio cerrar se completa acá (simulacros.js).
    await sim.completarCierresPendientes(medicoPhone, await zonaDe(medicoPhone))
      .catch(e => log.warn("[SIMULACROS] cierre pendiente:", e.message));
    const medico = await Medico.findOne({ phone: medicoPhone }).select("phone estudiante").lean();
    const [cupo, progreso, abiertos, terminados] = await Promise.all([
      sim.cupoDe(medico),
      sim.progreso(medicoPhone),
      Simulacro.find({ medicoPhone, estado: { $in: ["preparando", "listo"] } }).sort({ createdAt: -1 }).limit(1).select("area modo cantidad estado preguntas.elegida").lean(),
      Simulacro.find({ medicoPhone, estado: "terminado" }).sort({ terminadoEn: -1 }).limit(10).select("area modo cantidad aciertos terminadoEn").lean(),
    ]);
    const abierto = abiertos[0];
    res.json({
      cupo, progreso, areas: sim.AREAS, cantidades: sim.CANTIDADES,
      enCurso: abierto ? { _id: abierto._id, area: abierto.area, modo: abierto.modo, cantidad: abierto.cantidad, estado: abierto.estado,
        respondidas: (abierto.preguntas || []).filter(p => p.elegida != null).length } : null,
      historial: terminados,
    });
  }));

  // De a uno por estudiante (candado.js): con dos «empezar» juntos y un solo
  // cupo, el segundo se entera de que ya hay uno en camino en vez de crear
  // otro (E03 del informe de QA). Con la clave de la pantalla, repetir el
  // pedido devuelve el mismo simulacro.
  app.post("/medico/simulacros", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const area = String(req.body?.area || "");
    const cantidad = Number(req.body?.cantidad);
    const modo = String(req.body?.modo || "practica");
    if (area !== "mixto" && !sim.AREAS.includes(area)) throw new ErrorHttp(400, "Elegí un área.");
    if (!sim.CANTIDADES.includes(cantidad)) throw new ErrorHttp(400, "Elegí cuántas preguntas.");
    if (!sim.MODOS.includes(modo)) throw new ErrorHttp(400, "Elegí el modo.");
    const clave = claveDelPedido(req);
    const simulacro = await conCandado(`simulacro:${medicoPhone}`, "Ya estás empezando un simulacro. Esperá un momento.", async () => {
      const repetido = clave ? await Simulacro.findOne({ medicoPhone, clave }).lean() : null;
      if (repetido) return repetido;
      const medico = await Medico.findOne({ phone: medicoPhone }).select("phone idioma estudiante").lean();
      const estado = await estadoDeEstudiante(medico);
      if (estado?.vencido) throw new ErrorHttp(402, estado.motivo);
      const cupo = await sim.cupoDe(medico);
      if (!cupo.quedan) throw new ErrorHttp(402, `Ya hiciste los ${cupo.limite} simulacros de este mes. El mes que viene se renuevan.`);
      // Uno abierto a la vez: el que estaba a medias se da por terminado.
      const viejos = await Simulacro.find({ medicoPhone, estado: "listo" }).select("_id").lean();
      const zona = await zonaDe(medicoPhone);
      for (const v of viejos) await sim.terminar(medicoPhone, String(v._id), zona).catch(() => {});
      await Simulacro.updateMany({ medicoPhone, estado: "preparando" }, { $set: { estado: "error" } });
      const nuevo = await Simulacro.create({ medicoPhone, idioma: medico.idioma || "es", area, cantidad, modo, ...(clave ? { clave } : {}) });
      sim.prepararSimulacro(nuevo._id).catch(e => log.warn("[SIMULACROS]", e.message));
      return nuevo.toObject();
    });
    res.json({ simulacro: await sim.vista(simulacro) });
  }));

  app.get("/medico/simulacros/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = soloEstudiantes(req);
    const s = await sim.obtener(medicoPhone, req.params.id);
    if (s.cierrePendiente) {
      await sim.completarCierre(medicoPhone, s._id, await zonaDe(medicoPhone))
        .catch(e => log.warn("[SIMULACROS] cierre pendiente:", e.message));
    }
    res.json({ simulacro: await sim.vista(s) });
  }));

  app.post("/medico/simulacros/:id/responder", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const zona = await zonaDe(medicoPhone);
    res.json(await sim.responder(medicoPhone, req.params.id, req.body?.indice, req.body?.opcion, zona));
  }));

  app.post("/medico/simulacros/:id/terminar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const zona = await zonaDe(medicoPhone);
    res.json({ simulacro: await sim.vista(await sim.terminar(medicoPhone, req.params.id, zona)) });
  }));

  app.post("/medico/simulacros/preguntas/:id/reportar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = escritura(req, res);
    const motivo = String(req.body?.motivo || "");
    if (!MOTIVOS_REPORTE.includes(motivo)) throw new ErrorHttp(400, "Elegí qué está mal.");
    await sim.reportarPregunta(medicoPhone, req.params.id, motivo);
    res.json({ ok: true });
  }));
};
