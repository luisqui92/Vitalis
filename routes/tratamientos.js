// Vitalis Odonto — Catálogo de tratamientos (reutilizable, con precio) y
// plan de tratamiento por paciente (ítems opcionalmente ligados a una
// pieza del odontograma, con pagos registrados contra cada uno).
const { Paciente, CatalogoTratamiento, TratamientoPlan } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

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
    registrar({ req, medicoPhone, accion: "crear_catalogo_tratamiento", recurso: `CatalogoTratamiento:${item._id}` });
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
    registrar({ req, medicoPhone, accion: "editar_catalogo_tratamiento", recurso: `CatalogoTratamiento:${item._id}` });
    res.json({ ok: true, item });
  }));

  app.delete("/medico/catalogo-tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await CatalogoTratamiento.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "No encontrado");
    registrar({ req, medicoPhone, accion: "borrar_catalogo_tratamiento", recurso: `CatalogoTratamiento:${req.params.id}` });
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
    const regionFacial = String(req.body?.regionFacial || "").trim();

    const item = await TratamientoPlan.create({
      pacienteId: paciente._id, medicoPhone, nombre, precio, piezaFdi, regionFacial,
      notas: String(req.body?.notas || "").trim(),
    });
    registrar({ req, medicoPhone, accion: "crear_tratamiento_plan", recurso: `TratamientoPlan:${item._id}` });
    res.status(201).json({ ok: true, item });
  }));

  app.patch("/medico/tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(TratamientoPlan, { _id: req.params.id, medicoPhone }, "No encontrado");
    if (req.body?.nombre !== undefined) item.nombre = String(req.body.nombre).trim();
    if (req.body?.notas !== undefined) item.notas = String(req.body.notas).trim();
    if (req.body?.piezaFdi !== undefined) item.piezaFdi = req.body.piezaFdi ? Number(req.body.piezaFdi) : null;
    if (req.body?.regionFacial !== undefined) item.regionFacial = String(req.body.regionFacial).trim();
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
    registrar({ req, medicoPhone, accion: "editar_tratamiento_plan", recurso: `TratamientoPlan:${item._id}` });
    res.json({ ok: true, item });
  }));

  app.delete("/medico/tratamientos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const r = await TratamientoPlan.deleteOne({ _id: req.params.id, medicoPhone });
    if (r.deletedCount === 0) throw new ErrorHttp(404, "No encontrado");
    registrar({ req, medicoPhone, accion: "borrar_tratamiento_plan", recurso: `TratamientoPlan:${req.params.id}` });
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
    const pago = item.pagos[item.pagos.length - 1];
    registrar({ req, medicoPhone, accion: "registrar_pago", recurso: `TratamientoPlan:${item._id}`, detalle: `pago ${pago._id} monto ${monto}` });
    res.status(201).json({ ok: true, item });
  }));

  app.delete("/medico/tratamientos/:id/pagos/:pagoId", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const item = await obtenerOFallar(TratamientoPlan, { _id: req.params.id, medicoPhone }, "No encontrado");
    const antes = item.pagos.length;
    item.pagos = item.pagos.filter(p => String(p._id) !== req.params.pagoId);
    if (item.pagos.length === antes) throw new ErrorHttp(404, "Pago no encontrado");
    await item.save();
    registrar({ req, medicoPhone, accion: "borrar_pago", recurso: `TratamientoPlan:${item._id}`, detalle: `pago ${req.params.pagoId}` });
    res.json({ ok: true });
  }));
};
