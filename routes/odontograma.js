// Symphomed Odonto — Odontograma: la ficha dental de cada paciente, pieza por
// pieza (numeración FDI). Se crea solo, con las 32 piezas permanentes en
// "sano", la primera vez que un odontólogo la abre para un paciente —
// así nunca hay que dar de alta nada a mano antes de poder usarlo.
const { Paciente, Odontograma, ESTADOS_PIEZA_DENTAL, PIEZAS_FDI_PERMANENTE } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

async function obtenerOCrearOdontograma(pacienteId, medicoPhone) {
  let odontograma = await Odontograma.findOne({ pacienteId, medicoPhone });
  if (!odontograma) {
    odontograma = await Odontograma.create({
      pacienteId,
      medicoPhone,
      piezas: PIEZAS_FDI_PERMANENTE.map(numero => ({ numero, estado: "sano", notas: "", historial: [] })),
    });
  }
  return odontograma;
}

module.exports = function (app) {
  // ─── VER ODONTOGRAMA (lo crea si es la primera vez) ─────────────────────
  app.get("/medico/pacientes/:pacienteId/odontograma", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const odontograma = await obtenerOCrearOdontograma(paciente._id, medicoPhone);
    registrar({ req, medicoPhone, accion: "ver_odontograma", recurso: `Paciente:${paciente._id}` });
    res.json({ odontograma });
  }));

  // ─── ACTUALIZAR UNA PIEZA ────────────────────────────────────────────────
  app.patch("/medico/pacientes/:pacienteId/odontograma/:numero", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const numero = parseInt(req.params.numero, 10);
    if (!PIEZAS_FDI_PERMANENTE.includes(numero)) throw new ErrorHttp(400, "Número de pieza inválido");

    const estado = String(req.body?.estado || "").trim();
    if (!ESTADOS_PIEZA_DENTAL.includes(estado)) throw new ErrorHttp(400, "Estado inválido");
    const notas = String(req.body?.notas || "").trim();

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const odontograma = await obtenerOCrearOdontograma(paciente._id, medicoPhone);

    const pieza = odontograma.piezas.find(p => p.numero === numero);
    if (!pieza) throw new ErrorHttp(404, "Pieza no encontrada");

    pieza.estado = estado;
    pieza.notas = notas;
    pieza.historial.push({ fecha: new Date(), estado, notas });
    await odontograma.save();

    registrar({ req, medicoPhone, accion: "editar_odontograma", recurso: `Paciente:${paciente._id}`, detalle: `Pieza ${numero} -> ${estado}` });
    res.json({ ok: true, pieza });
  }));
};
