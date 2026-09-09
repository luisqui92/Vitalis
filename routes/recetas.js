// ChatGo Salud — Receta Digital: se genera a partir de lo recetado en una
// consulta (o a mano) y queda lista para imprimir/guardar como PDF desde el
// navegador. Mandarla directo por WhatsApp queda pendiente hasta resolver
// la integración (Evolution API) — por ahora, el médico la imprime/descarga.
const { Paciente, Medico, Receta, RecetaOptica } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── CREAR RECETA ────────────────────────────────────────────────────────
  // Crearla ya es el acto de aprobación del médico (viene de una consulta que
  // ya revisó, o la escribió a mano); no hay un estado de "borrador" aparte.
  app.post("/medico/pacientes/:pacienteId/recetas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const medicamentos = (Array.isArray(req.body?.medicamentos) ? req.body.medicamentos : [])
      .map(m => ({
        nombre: String(m?.nombre || "").trim(),
        dosis: String(m?.dosis || "").trim(),
        frecuencia: String(m?.frecuencia || "").trim(),
        duracion: String(m?.duracion || "").trim(),
      }))
      .filter(m => m.nombre);
    if (medicamentos.length === 0) throw new ErrorHttp(400, "Agregá al menos un medicamento");

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();

    const receta = await Receta.create({
      pacienteId: paciente._id,
      medicoPhone,
      consultaId: req.body?.consultaId || null,
      medicamentos,
      indicaciones: String(req.body?.indicaciones || "").trim(),
      fecha,
    });
    registrar({ req, medicoPhone, accion: "crear_receta", recurso: `Receta:${receta._id}` });
    res.status(201).json({ ok: true, receta });
  }));

  // ─── VER UNA RECETA (con datos de médico/paciente para el encabezado) ──
  app.get("/medico/recetas/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const receta = await obtenerOFallar(Receta, { _id: req.params.id, medicoPhone }, "Receta no encontrada");
    const [paciente, medico] = await Promise.all([
      Paciente.findById(receta.pacienteId).select("nombre fechaNacimiento sexo").lean(),
      Medico.findOne({ phone: medicoPhone }).select("nombre especialidad").lean(),
    ]);
    registrar({ req, medicoPhone, accion: "ver_receta", recurso: `Receta:${receta._id}` });
    res.json({ receta, paciente, medico });
  }));

  // ─── ELIMINAR ────────────────────────────────────────────────────────────
  app.delete("/medico/recetas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await Receta.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "Receta no encontrada");
    registrar({ req, medicoPhone, accion: "borrar_receta", recurso: `Receta:${req.params.id}` });
    res.json({ ok: true });
  }));

  // ─── RECETA ÓPTICA (Symphomed Visión) — esfera/cilindro/eje/adición por ojo,
  // distinta a una receta de medicamentos. Mismo criterio: crearla ya es la
  // aprobación del médico. ──────────────────────────────────────────────
  function ladoOjoDesdeBody(body) {
    const num = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
    return {
      esfera: num(body?.esfera), cilindro: num(body?.cilindro),
      eje: num(body?.eje), adicion: num(body?.adicion),
    };
  }

  app.post("/medico/pacientes/:pacienteId/recetas-opticas", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const od = ladoOjoDesdeBody(req.body?.od);
    const oi = ladoOjoDesdeBody(req.body?.oi);
    const hayDatos = [od.esfera, od.cilindro, oi.esfera, oi.cilindro].some(v => v !== null);
    if (!hayDatos) throw new ErrorHttp(400, "Cargá al menos esfera o cilindro de algún ojo");

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    const distanciaPupilar = req.body?.distanciaPupilar ? Number(req.body.distanciaPupilar) : null;

    const receta = await RecetaOptica.create({
      pacienteId: paciente._id, medicoPhone, consultaId: req.body?.consultaId || null,
      od, oi, distanciaPupilar, notas: String(req.body?.notas || "").trim(), fecha,
    });
    registrar({ req, medicoPhone, accion: "crear_receta_optica", recurso: `RecetaOptica:${receta._id}` });
    res.status(201).json({ ok: true, receta });
  }));

  app.get("/medico/pacientes/:pacienteId/recetas-opticas", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const recetas = await RecetaOptica.find({ pacienteId: req.params.pacienteId, medicoPhone }).sort({ fecha: -1 }).lean();
    res.json({ recetas });
  }));

  app.get("/medico/recetas-opticas/:id", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const receta = await obtenerOFallar(RecetaOptica, { _id: req.params.id, medicoPhone }, "Receta óptica no encontrada");
    const [paciente, medico] = await Promise.all([
      Paciente.findById(receta.pacienteId).select("nombre fechaNacimiento sexo").lean(),
      Medico.findOne({ phone: medicoPhone }).select("nombre especialidad").lean(),
    ]);
    registrar({ req, medicoPhone, accion: "ver_receta_optica", recurso: `RecetaOptica:${receta._id}` });
    res.json({ receta, paciente, medico });
  }));

  app.delete("/medico/recetas-opticas/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await RecetaOptica.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "Receta óptica no encontrada");
    registrar({ req, medicoPhone, accion: "borrar_receta_optica", recurso: `RecetaOptica:${req.params.id}` });
    res.json({ ok: true });
  }));
};
