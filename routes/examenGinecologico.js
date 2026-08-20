// Vitalis Gineco — Mapa ginecológico: la ficha de cada paciente órgano por
// órgano (útero, endometrio, cuello, ovarios, trompas, mamas). Se crea solo,
// con los 9 órganos en "normal", la primera vez que se abre — mismo criterio
// que el odontograma y el mapa ocular.
const { Paciente, ExamenGinecologico, ORGANOS_GINECO, HALLAZGOS_GINECO } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { registrar } = require("../services/auditoria");
const { registrarCorreccion } = require("../services/correccionesIA");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");

const requireMedico = requireAuth(["medico"]);

async function obtenerOCrearExamenGineco(pacienteId, medicoPhone) {
  let examen = await ExamenGinecologico.findOne({ pacienteId, medicoPhone });
  if (!examen) {
    const organos = ORGANOS_GINECO.map(organo => ({ organo, hallazgo: "normal", notas: "", historial: [] }));
    examen = await ExamenGinecologico.create({ pacienteId, medicoPhone, organos });
  }
  return examen;
}

module.exports = function (app) {
  app.get("/medico/pacientes/:pacienteId/examen-ginecologico", requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const examen = await obtenerOCrearExamenGineco(paciente._id, medicoPhone);
    registrar({ req, medicoPhone, accion: "ver_examen_ginecologico", recurso: `Paciente:${paciente._id}` });
    res.json({ examen });
  }));

  app.patch("/medico/pacientes/:pacienteId/examen-ginecologico/:organo", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const { organo } = req.params;
    if (!ORGANOS_GINECO.includes(organo)) throw new ErrorHttp(400, "Órgano inválido");

    const hallazgo = String(req.body?.hallazgo || "").trim();
    if (!HALLAZGOS_GINECO.includes(hallazgo)) throw new ErrorHttp(400, "Hallazgo inválido");
    const notas = String(req.body?.notas || "").trim();

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const examen = await obtenerOCrearExamenGineco(paciente._id, medicoPhone);

    const item = examen.organos.find(o => o.organo === organo);
    if (!item) throw new ErrorHttp(404, "Órgano no encontrado");

    // Si lo último vino de la voz y ahora la médica lo corrige a mano, es
    // justo lo que queremos poder revisar después para medir a la IA.
    const ultimo = item.historial[item.historial.length - 1];
    if (ultimo?.fuente === "voz") {
      registrarCorreccion({
        medicoPhone, tipo: "examen_ginecologico", consultaId: ultimo.consultaId,
        campo: organo, valorSugerido: item.hallazgo, valorFinal: hallazgo,
      });
    }

    item.hallazgo = hallazgo;
    item.notas = notas;
    item.historial.push({ fecha: new Date(), hallazgo, notas, fuente: "manual" });
    await examen.save();

    registrar({ req, medicoPhone, accion: "editar_examen_ginecologico", recurso: `Paciente:${paciente._id}`, detalle: `${organo} -> ${hallazgo}` });
    res.json({ ok: true, item });
  }));
};
