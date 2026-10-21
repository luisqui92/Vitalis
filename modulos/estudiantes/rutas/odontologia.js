const { Medico } = require("../../../db/models");
const { SimulacionPaciente, TarjetaEstudio } = require("../modelos");
const { requireAuth } = require("../../../services/auth");
const { limitMedico } = require("../../../services/ratelimit");
const { asyncRoute, ErrorHttp } = require("../../../services/httpHelpers");
const { sinCambios } = require("../../../services/realtime");
const { estadoDe } = require("../cuenta");
const { conCandado } = require("../candado");
const pv = require("../pacienteVirtual");
const dental = require("../odontologia");
const requireMedico = requireAuth(["medico"]);

function estudiante(req, res) {
  sinCambios(res);
  if (!req.adminUser.estudiante) throw new ErrorHttp(403, "Esta práctica es de las cuentas de estudiante.");
  return req.adminUser.usuario;
}

async function practicaDental(phone, id) {
  const sim = await pv.obtener(phone, id); // Incluye propiedad e ID válido.
  if (!dental.esDental(sim.area) || !sim.guion?.odontologia) throw new ErrorHttp(400, "Esta práctica no tiene odontograma.");
  return sim;
}

async function crearRepasoDental(sim) {
  let creadas = 0;
  for (const tarjeta of dental.tarjetasDeSimulacion(sim)) {
    try {
      await TarjetaEstudio.create({ ...tarjeta, medicoPhone: sim.medicoPhone, consultaId: null, proxima: new Date() });
      creadas++;
    } catch (e) { if (e.code !== 11000) throw e; } // Reintentos concurrentes.
  }
  return creadas;
}

module.exports = function (app) {
  app.put("/medico/pacientes-virtuales/:id/odontograma", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const phone = estudiante(req, res);
    const revision = req.body?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ErrorHttp(400, "Revisión inválida.");
    const inicial = await practicaDental(phone, req.params.id);
    let registro;
    try { registro = dental.validarRegistro(req.body?.registro, inicial.guion.odontologia.denticion); }
    catch (e) { throw new ErrorHttp(400, e.message); }
    const medico = await Medico.findOne({ phone }).select("phone estudiante").lean();
    const acceso = await estadoDe(medico);
    if (acceso?.vencido) throw new ErrorHttp(402, acceso.motivo);
    const odontograma = await conCandado(`pv-turno:${inicial._id}`, "Esperá a que termine el pedido anterior.", async () => {
      const sim = await practicaDental(phone, req.params.id);
      if (sim.estado !== "en_curso") throw new ErrorHttp(409, "Esta práctica ya no se puede editar.");
      const actual = sim.odontograma || { revision: 0, registro: [] };
      // Si se perdió la respuesta al guardar, repetir no pisa una edición.
      if (actual.revision === revision + 1 && JSON.stringify(actual.registro) === JSON.stringify(registro)) return actual;
      if (actual.revision !== revision) throw new ErrorHttp(409, "El odontograma cambió en otra sesión. Volvé a abrir la práctica.");
      const siguiente = { registro, revision: revision + 1 };
      const filtroRevision = revision === 0
        ? { $or: [{ "odontograma.revision": 0 }, { odontograma: null }, { odontograma: { $exists: false } }] }
        : { "odontograma.revision": revision };
      const r = await SimulacionPaciente.updateOne(
        { _id: sim._id, medicoPhone: phone, estado: "en_curso", ...filtroRevision },
        { $set: { odontograma: siguiente } });
      if (!r.modifiedCount) throw new ErrorHttp(409, "La práctica cambió. Volvé a abrirla antes de guardar.");
      return siguiente;
    });
    res.json({ odontograma });
  }));

  app.post("/medico/pacientes-virtuales/:id/repaso", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const sim = await practicaDental(estudiante(req, res), req.params.id);
    if (sim.estado !== "terminada") throw new ErrorHttp(409, "Terminá la práctica antes de crear el repaso.");
    res.json({ creadas: await crearRepasoDental(sim) });
  }));
};
module.exports.crearRepasoDental = crearRepasoDental;
