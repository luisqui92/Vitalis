// Symphomed — El razonamiento diagnóstico de un estudiante sobre una de sus
// consultas (ver ../tutor.js).
//
// Él escribe su diagnóstico y sus diferenciales; recién entonces se arma el
// análisis. Una vez por consulta: es un ejercicio, y volver a pedirlo hasta
// «acertar» no le enseña nada. Se guarda en su propia colección
// (RazonamientoDiagnostico), no en la consulta: la consulta es del núcleo.
const { Medico, Paciente, ConsultaMedica } = require("../../../db/models");
const { RazonamientoDiagnostico } = require("../modelos");
const { requireAuth } = require("../../../services/auth");
const { limitMedico } = require("../../../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../../../services/httpHelpers");
const { registrar } = require("../../../services/auditoria");
const { zonaValida } = require("../../../services/zonaHoraria");
const extensiones = require("../../../services/extensiones");
const { log } = require("../../../config");
const { razonamientoDiagnostico, PALABRAS_MINIMAS } = require("../tutor");
const { crearTarjetasDeConsulta, marcarDiaDeEstudio } = require("../estudio");
const { frenarSinAcceso } = require("../restricciones");

const requireMedico = requireAuth(["medico"]);
const CAMPOS = "principal diferenciales resultado en";

const sinId = ({ principal, diferenciales, resultado, en }) => ({ principal, diferenciales, resultado, en });

// Al abrir la consulta, su razonamiento viaja con ella (el punto
// «consulta.detalle» del núcleo → consulta.extras.razonamiento). Solo en
// las cuentas de estudiante: a un médico no le agrega nada.
async function razonamientoDeLaConsulta({ req, consulta }) {
  if (!req.adminUser?.estudiante) return {};
  const rz = await RazonamientoDiagnostico.findOne({ consultaId: consulta._id, medicoPhone: req.adminUser.usuario }).select(CAMPOS).lean();
  return rz ? { razonamiento: sinId(rz) } : {};
}

module.exports = function (app) {
  extensiones.enganchar("consulta.detalle", razonamientoDeLaConsulta);

  app.post("/medico/consultas/:id/razonamiento", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    if (!req.adminUser.estudiante) throw new ErrorHttp(403, "El razonamiento guiado es de las cuentas de estudiante.");
    const medicoPhone = req.adminUser.usuario;
    const consulta = await obtenerOFallar(ConsultaMedica, { _id: req.params.id, medicoPhone }, "Consulta no encontrada");
    if (await RazonamientoDiagnostico.exists({ consultaId: consulta._id })) throw new ErrorHttp(409, "Ya hiciste el razonamiento de esta consulta.");
    const principal = String(req.body?.principal || "").trim().slice(0, 160);
    const crudos = Array.isArray(req.body?.diferenciales) ? req.body.diferenciales : String(req.body?.diferenciales || "").split(/[,;\n]/);
    const diferenciales = crudos.map(x => String(x || "").trim().slice(0, 160)).filter(Boolean).slice(0, 6);
    if (principal.length < 3) throw new ErrorHttp(400, "Escribí tu diagnóstico principal antes de ver el razonamiento.");
    const transcripcion = consulta.transcripcionCompleta || consulta.transcripcionEnVivo || "";
    if (transcripcion.split(/\s+/).filter(Boolean).length < PALABRAS_MINIMAS) {
      throw new ErrorHttp(400, "Esta consulta no tiene transcripción suficiente para razonar sobre ella.");
    }
    await frenarSinAcceso(req);

    const [paciente, medico] = await Promise.all([
      Paciente.findOne({ _id: consulta.pacienteId, medicoPhone }).lean(),
      Medico.findOne({ phone: medicoPhone }).select("idioma zonaHoraria").lean(),
    ]);
    let resultado;
    try {
      resultado = await razonamientoDiagnostico(transcripcion, { principal, diferenciales }, medico?.idioma, paciente);
    } catch (e) {
      log.warn("[TUTOR] razonamiento:", e.message);
      throw new ErrorHttp(502, "No se pudo armar el razonamiento. Probá de nuevo en un rato.");
    }
    // Si tocó dos veces seguidas, gana el primero: la base no deja dos por
    // consulta.
    let guardado;
    try {
      guardado = await RazonamientoDiagnostico.create({ medicoPhone, consultaId: consulta._id, principal, diferenciales, resultado, en: new Date() });
    } catch (e) {
      if (e?.code === 11000) throw new ErrorHttp(409, "Ya hiciste el razonamiento de esta consulta.");
      throw e;
    }
    registrar({ req, medicoPhone, accion: "razonamiento_estudiante", recurso: `ConsultaMedica:${consulta._id}` });
    // De este razonamiento salen sus tarjetas de repaso, y razonar un caso
    // cuenta como día de estudio (../estudio.js). Si algo de eso falla, el
    // razonamiento ya quedó guardado: las tarjetas se vuelven a intentar al
    // abrir «Estudiar».
    const zona = zonaValida(medico?.zonaHoraria);
    const [tarjetas] = await Promise.all([
      crearTarjetasDeConsulta(consulta._id).catch(e => { log.warn("[ESTUDIO] tarjetas:", e.message); return 0; }),
      marcarDiaDeEstudio(medicoPhone, zona).catch(e => { log.warn("[ESTUDIO] racha:", e.message); }),
    ]);
    res.json({ razonamiento: sinId(guardado.toObject()), tarjetas });
  }));
};

module.exports.razonamientoDeLaConsulta = razonamientoDeLaConsulta;
