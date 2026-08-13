// Vitalis Odonto — Catálogo de tratamientos (reutilizable, con precio) y
// plan de tratamiento por paciente (ítems opcionalmente ligados a una
// pieza del odontograma, con pagos registrados contra cada uno).
const { Paciente, CatalogoTratamiento, TratamientoPlan } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ─── CATÁLOGO ────────────────────────────────────────────────────────────
  app.get("/medico/catalogo-tratamientos", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const catalogo = await CatalogoTratamiento.find({ medicoPhone }).sort({ nombre: 1 }).lean();
    res.json({ catalogo });
  }));

  app.post("/medico/catalogo-tratamientos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const nombre = String(req.body?.nombre || "").trim();
    const precio = Number(req.body?.precio);
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    if (!Number.isFinite(precio) || precio < 0) throw new ErrorHttp(400, "precio inválido");

    const item = await CatalogoTratamiento.create({ medicoPhone, nombre, precio });
    res.status(201).json({ ok: true, item });
  }));

  app.patch("/medico/catalogo-tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(CatalogoTratamiento, { _id: req.params.id, medicoPhone }, "No encontrado");
    if (req.body?.nombre !== undefined) item.nombre = String(req.body.nombre).trim();
    if (req.body?.precio !== undefined) {
      const precio = Number(req.body.precio);
      if (!Number.isFinite(precio) || precio < 0) throw new ErrorHttp(400, "precio inválido");
      item.precio = precio;
    }
    await item.save();
    res.json({ ok: true, item });
  }));

  app.delete("/medico/catalogo-tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await CatalogoTratamiento.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "No encontrado");
    res.json({ ok: true });
  }));

  // ─── PLAN DE TRATAMIENTO POR PACIENTE ────────────────────────────────────
  app.get("/medico/pacientes/:pacienteId/tratamientos", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const tratamientos = await TratamientoPlan.find({ pacienteId: req.params.pacienteId, medicoPhone }).sort({ createdAt: 1 }).lean();
    res.json({ tratamientos });
  }));

  app.post("/medico/pacientes/:pacienteId/tratamientos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const nombre = String(req.body?.nombre || "").trim();
    const precio = Number(req.body?.precio);
    if (!nombre) throw new ErrorHttp(400, "nombre es requerido");
    if (!Number.isFinite(precio) || precio < 0) throw new ErrorHttp(400, "precio inválido");
    const piezaFdi = req.body?.piezaFdi ? Number(req.body.piezaFdi) : null;

    const item = await TratamientoPlan.create({
      pacienteId: paciente._id, medicoPhone, nombre, precio, piezaFdi,
      notas: String(req.body?.notas || "").trim(),
    });
    res.status(201).json({ ok: true, item });
  }));

  app.patch("/medico/tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(TratamientoPlan, { _id: req.params.id, medicoPhone }, "No encontrado");
    if (req.body?.nombre !== undefined) item.nombre = String(req.body.nombre).trim();
    if (req.body?.notas !== undefined) item.notas = String(req.body.notas).trim();
    if (req.body?.piezaFdi !== undefined) item.piezaFdi = req.body.piezaFdi ? Number(req.body.piezaFdi) : null;
    if (req.body?.precio !== undefined) {
      const precio = Number(req.body.precio);
      if (!Number.isFinite(precio) || precio < 0) throw new ErrorHttp(400, "precio inválido");
      item.precio = precio;
    }
    if (req.body?.estado !== undefined) {
      if (!["pendiente", "en_proceso", "realizado"].includes(req.body.estado)) throw new ErrorHttp(400, "estado inválido");
      item.estado = req.body.estado;
    }
    await item.save();
    res.json({ ok: true, item });
  }));

  app.delete("/medico/tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await TratamientoPlan.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "No encontrado");
    res.json({ ok: true });
  }));

  // ─── PAGOS ────────────────────────────────────────────────────────────────
  app.post("/medico/tratamientos/:id/pagos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(TratamientoPlan, { _id: req.params.id, medicoPhone }, "No encontrado");
    const monto = Number(req.body?.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new ErrorHttp(400, "monto inválido");
    item.pagos.push({ monto, notas: String(req.body?.notas || "").trim() });
    await item.save();
    res.status(201).json({ ok: true, item });
  }));

  app.delete("/medico/tratamientos/:id/pagos/:pagoId", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(TratamientoPlan, { _id: req.params.id, medicoPhone }, "No encontrado");
    const antes = item.pagos.length;
    item.pagos = item.pagos.filter(p => String(p._id) !== req.params.pagoId);
    if (item.pagos.length === antes) throw new ErrorHttp(404, "Pago no encontrado");
    await item.save();
    res.json({ ok: true, item });
  }));
};
