// Symphomed Vet — Mapa corporal: lesiones marcadas sobre la silueta del
// animal, cada una con su historial de controles (descripción, tamaño y
// foto por fecha), para poder ver si crece o cede.
const { Paciente, MapaCorporal, Estudio, REGIONES_CORPORALES, ESTADOS_LESION, LADOS_CUERPO } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

async function obtenerOCrearMapa(pacienteId, medicoPhone) {
  let mapa = await MapaCorporal.findOne({ pacienteId, medicoPhone });
  if (!mapa) mapa = await MapaCorporal.create({ pacienteId, medicoPhone, lesiones: [] });
  return mapa;
}

// Las fotos se guardan en el Centro de Estudios (el navegador las sube ahí
// primero y acá solo llega el id), así que hay que confirmar que esa foto
// sea de ESTE paciente y de ESTE médico antes de enlazarla.
async function validarEstudio(estudioId, pacienteId, medicoPhone) {
  if (!estudioId) return null;
  const estudio = await Estudio.findOne({ _id: estudioId, pacienteId, medicoPhone }).select("_id").lean();
  if (!estudio) throw new ErrorHttp(400, "Esa foto no existe o no es de este paciente");
  return estudio._id;
}

module.exports = function (app) {
  app.get("/medico/pacientes/:pacienteId/mapa-corporal", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const mapa = await obtenerOCrearMapa(paciente._id, medicoPhone);
    registrar({ req, medicoPhone, accion: "ver_mapa_corporal", recurso: `Paciente:${paciente._id}` });
    res.json({ mapa });
  }));

  // ─── MARCAR UNA LESIÓN NUEVA ───────────────────────────────────────────
  app.post("/medico/pacientes/:pacienteId/mapa-corporal", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const x = Number(req.body?.x), y = Number(req.body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
      throw new ErrorHttp(400, "Posición inválida");
    }
    const region = REGIONES_CORPORALES.includes(req.body?.region) ? req.body.region : "otra";
    const lado = LADOS_CUERPO.includes(req.body?.lado) ? req.body.lado : "izquierdo";
    const estado = ESTADOS_LESION.includes(req.body?.estado) ? req.body.estado : "activa";
    const titulo = String(req.body?.titulo || "").trim().slice(0, 120);
    const descripcion = String(req.body?.descripcion || "").trim().slice(0, 1000);
    const tamanoCm = req.body?.tamanoCm != null && req.body.tamanoCm !== "" ? Number(req.body.tamanoCm) : null;
    if (tamanoCm != null && (!Number.isFinite(tamanoCm) || tamanoCm < 0)) throw new ErrorHttp(400, "Tamaño inválido");
    const estudioId = await validarEstudio(req.body?.estudioId, paciente._id, medicoPhone);

    const mapa = await obtenerOCrearMapa(paciente._id, medicoPhone);
    mapa.lesiones.push({
      x, y, lado, region, titulo, estado,
      historial: [{ fecha: new Date(), descripcion, tamanoCm, estado, estudioId, fuente: "manual" }],
    });
    await mapa.save();

    registrar({ req, medicoPhone, accion: "marcar_lesion", recurso: `Paciente:${paciente._id}`, detalle: `${region} (${lado})` });
    res.json({ ok: true, lesion: mapa.lesiones[mapa.lesiones.length - 1] });
  }));

  // ─── AGREGAR UN CONTROL A UNA LESIÓN ───────────────────────────────────
  // El estado de la lesión pasa a ser el del último control: es lo que
  // significa "cómo está hoy".
  app.post("/medico/pacientes/:pacienteId/mapa-corporal/:lesionId/control", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const mapa = await obtenerOCrearMapa(paciente._id, medicoPhone);
    const lesion = mapa.lesiones.id(req.params.lesionId);
    if (!lesion) throw new ErrorHttp(404, "Esa lesión no existe");

    const estado = ESTADOS_LESION.includes(req.body?.estado) ? req.body.estado : lesion.estado;
    const descripcion = String(req.body?.descripcion || "").trim().slice(0, 1000);
    const tamanoCm = req.body?.tamanoCm != null && req.body.tamanoCm !== "" ? Number(req.body.tamanoCm) : null;
    if (tamanoCm != null && (!Number.isFinite(tamanoCm) || tamanoCm < 0)) throw new ErrorHttp(400, "Tamaño inválido");
    const estudioId = await validarEstudio(req.body?.estudioId, paciente._id, medicoPhone);

    lesion.historial.push({ fecha: new Date(), descripcion, tamanoCm, estado, estudioId, fuente: "manual" });
    lesion.estado = estado;
    await mapa.save();

    registrar({ req, medicoPhone, accion: "control_lesion", recurso: `Paciente:${paciente._id}`, detalle: `${lesion.region} -> ${estado}` });
    res.json({ ok: true, lesion });
  }));

  app.delete("/medico/pacientes/:pacienteId/mapa-corporal/:lesionId", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const mapa = await obtenerOCrearMapa(paciente._id, medicoPhone);
    const lesion = mapa.lesiones.id(req.params.lesionId);
    if (!lesion) throw new ErrorHttp(404, "Esa lesión no existe");
    lesion.deleteOne();
    await mapa.save();
    registrar({ req, medicoPhone, accion: "borrar_lesion", recurso: `Paciente:${paciente._id}` });
    res.json({ ok: true });
  }));
};
