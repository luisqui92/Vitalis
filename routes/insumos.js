// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Insumos del consultorio
// ═══════════════════════════════════════════════════════════════════════════
// El stock real: anestesia, guantes, resina, vacunas. Quién es el dueño y
// cómo se toca el stock está en services/insumos.js — acá solo entran y
// salen pedidos.
//
// Lo abre el profesional con su propia cuenta. Si tiene clínica, el stock es
// del centro y lo comparte con sus colegas; si trabaja solo, es suyo. Eso lo
// resuelve duenoDe() y ninguna ruta lo decide por su cuenta.
const { Insumo, MovimientoInsumo, UNIDADES_INSUMO, TIPOS_MOV_INSUMO, Paciente } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const {
  duenoDe, insumoDelDueno, registrarMovimiento, loQueFalta, valorDelStock,
} = require("../services/insumos");

const requireMedico = requireAuth(["medico"]);

// Un consultorio no tiene mil insumos distintos. El tope existe igual, por
// lo mismo que en todas las demás listas: una consulta sin límite anda bien
// hasta el día que no.
const TOPE = 300;

module.exports = function (app) {
  // ─── EL DEPÓSITO ─────────────────────────────────────────────────────────
  app.get("/medico/insumos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const incluirBajas = req.query.todos === "1";
    const filtro = { ...duenoDe(req) };
    if (!incluirBajas) filtro.activo = true;

    const [insumos, falta, valor] = await Promise.all([
      Insumo.find(filtro).sort({ nombre: 1 }).limit(TOPE).lean(),
      loQueFalta(req),
      valorDelStock(req),
    ]);
    res.json({ insumos, falta, valor, opciones: { UNIDADES_INSUMO, TIPOS_MOV_INSUMO }, tope: TOPE });
  }));

  app.post("/medico/insumos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) throw new ErrorHttp(400, "El insumo necesita un nombre");

    const insumo = await Insumo.create({
      ...duenoDe(req),
      nombre,
      categoria: String(req.body?.categoria || "").trim(),
      unidad: UNIDADES_INSUMO.includes(req.body?.unidad) ? req.body.unidad : "unidad",
      stockMinimo: Math.max(0, Number(req.body?.stockMinimo) || 0),
      costoUnitarioCentavos: Math.max(0, Number(req.body?.costoUnitarioCentavos) || 0),
      venceEl: req.body?.venceEl ? new Date(req.body.venceEl) : null,
      nota: String(req.body?.nota || "").trim().slice(0, 500),
    });

    // El stock inicial entra como MOVIMIENTO y no como un campo, para que el
    // primer número del inventario tenga el mismo respaldo que todos los
    // demás. Un stock inicial puesto a mano es el único número que nunca se
    // puede explicar después.
    const inicial = Number(req.body?.stockInicial) || 0;
    if (inicial > 0) {
      await registrarMovimiento(req, insumo, {
        tipo: "entrada", cantidad: inicial,
        costoUnitarioCentavos: insumo.costoUnitarioCentavos,
        motivo: "Carga inicial",
      });
    }

    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "crear_insumo", recurso: `Insumo:${insumo._id}` });
    res.status(201).json({ ok: true, insumo });
  }));

  app.patch("/medico/insumos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const insumo = await insumoDelDueno(req, req.params.id);

    for (const campo of ["nombre", "categoria", "nota"]) {
      if (req.body?.[campo] !== undefined) insumo[campo] = String(req.body[campo]).trim();
    }
    if (UNIDADES_INSUMO.includes(req.body?.unidad)) insumo.unidad = req.body.unidad;
    if (req.body?.stockMinimo !== undefined) insumo.stockMinimo = Math.max(0, Number(req.body.stockMinimo) || 0);
    if (req.body?.venceEl !== undefined) insumo.venceEl = req.body.venceEl ? new Date(req.body.venceEl) : null;
    if (req.body?.activo !== undefined) insumo.activo = !!req.body.activo;

    // El stock NO se edita acá. Cambiarlo a mano deja un número sin
    // movimiento que lo respalde, que es justo lo que este módulo evita.
    // Para corregirlo está el movimiento de tipo "ajuste".
    if (req.body?.stock !== undefined) {
      throw new ErrorHttp(400, "El stock no se edita a mano: cargá un movimiento de ajuste");
    }

    await insumo.save();
    res.json({ ok: true, insumo });
  }));

  // ─── MOVER STOCK ─────────────────────────────────────────────────────────
  app.post("/medico/insumos/:id/movimientos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const insumo = await insumoDelDueno(req, req.params.id);
    const tipo = req.body?.tipo;
    if (!TIPOS_MOV_INSUMO.includes(tipo)) throw new ErrorHttp(400, "Tipo de movimiento desconocido");

    // Si se dice a qué paciente se le usó, el paciente tiene que ser de
    // quien lo carga. Sin esto, el campo sería una forma de averiguar si un
    // id de paciente existe en otro consultorio.
    let pacienteId = null;
    if (req.body?.pacienteId) {
      const p = await Paciente.findOne({ _id: req.body.pacienteId, medicoPhone: req.adminUser.usuario }).select("_id").lean();
      if (!p) throw new ErrorHttp(404, "Paciente no encontrado");
      pacienteId = p._id;
    }

    const { movimiento, insumo: actualizado } = await registrarMovimiento(req, insumo, {
      tipo,
      cantidad: req.body?.cantidad,
      costoUnitarioCentavos: req.body?.costoUnitarioCentavos,
      motivo: req.body?.motivo,
      venceEl: req.body?.venceEl,
      pacienteId,
      fecha: req.body?.fecha,
    });

    registrar({ req, medicoPhone: req.adminUser.usuario, accion: `insumo_${tipo}`, recurso: `Insumo:${insumo._id}` });
    res.status(201).json({ ok: true, movimiento, insumo: actualizado });
  }));

  // ─── LA HISTORIA DE UN INSUMO ────────────────────────────────────────────
  // Es lo que se mira cuando el número del estante no coincide con el de la
  // pantalla, así que viene ordenada de lo más nuevo a lo más viejo y con el
  // stock que quedó después de cada movimiento.
  app.get("/medico/insumos/:id/movimientos", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const insumo = await insumoDelDueno(req, req.params.id);
    const movimientos = await MovimientoInsumo.find({ insumoId: insumo._id })
      .sort({ fecha: -1 }).limit(TOPE).lean();
    res.json({ insumo, movimientos, tope: TOPE });
  }));

  app.delete("/medico/insumos/:id", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const insumo = await insumoDelDueno(req, req.params.id);
    // Se da de baja, no se borra: los movimientos de un insumo borrado
    // dejarían de tener a qué referirse, y con ellos se va el historial de
    // consumo del consultorio.
    insumo.activo = false;
    await insumo.save();
    registrar({ req, medicoPhone: req.adminUser.usuario, accion: "baja_insumo", recurso: `Insumo:${insumo._id}` });
    res.json({ ok: true, dadoDeBaja: true });
  }));
};
