// Symphomed — Descargar el Kardex del paciente en PDF.
//
// Qué trae y qué no: services/kardexPdf.js (es la «historia completa» del
// resumen compartido, más las recetas). Acá va lo del pedido:
//
// · SOLO EL MÉDICO DEL PACIENTE. Con su sesión, como todo /medico/.
// · QUEDA AUDITADO. Bajar la historia clínica entera de alguien es un acto
//   que en dos años alguien puede preguntar quién hizo, igual que compartirla.
// · NO SE GUARDA EN NINGÚN LADO. Se arma en el momento y se entrega; no queda
//   copia en el servidor ni en cachés intermedias (Cache-Control: no-store).
const { Paciente, Medico, Membrete, Receta, ConsultaMedica } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");
const { leerKardex } = require("../services/kardexDatos");
const { armarContenido, normalizarSecciones } = require("../services/resumenCompartido");
const { armarKardexPdf, nombreArchivo } = require("../services/kardexPdf");
const { idiomaDeCuenta } = require("../services/idiomas");
const extensiones = require("../services/extensiones");

const requireMedico = requireAuth(["medico"]);

module.exports = function (app) {
  // ?tz=America/Sao_Paulo — la zona del navegador, para que la hora de cada
  // consulta salga como la vio el médico. Si no viene o no existe, la de su
  // país (services/idiomas/<idioma>/index.js).
  app.get("/medico/pacientes/:id/kardex.pdf", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.id, medicoPhone }, "Paciente no encontrado");

    const [datos, medico, membrete, recetas, consultasSinConfirmar] = await Promise.all([
      leerKardex(paciente),
      Medico.findOne({ phone: medicoPhone }).select("nombre especialidad matricula conselho idioma").lean(),
      Membrete.findOne({ medicoPhone }).lean(),
      Receta.find({ pacienteId: paciente._id, medicoPhone }).sort({ fecha: -1 }).lean(),
      // Las que tienen nota pero el médico no confirmó: no salen, pero el PDF
      // dice cuántas son, para que no parezca que faltan consultas.
      ConsultaMedica.countDocuments({ pacienteId: paciente._id, medicoPhone, confirmadaEn: null, notaClinicaEstado: "completado" }),
    ]);

    const idioma = idiomaDeCuenta(medico);
    const generadoEn = new Date();
    const zonaHoraria = typeof req.query.tz === "string" ? req.query.tz : "";
    const contenido = armarContenido(datos, { alcance: "completo", secciones: normalizarSecciones(null, "completo") });
    // Lo que los módulos necesitan que se lea primero (services/extensiones.js).
    const alertas = await extensiones.lista("kardex.alertas", { medicoPhone, paciente, idioma });
    const pdf = armarKardexPdf({
      contenido, paciente, recetas, consultasSinConfirmar, medico, membrete, idioma, zonaHoraria, generadoEn, alertas,
    });
    const nombre = nombreArchivo({ idioma, paciente, generadoEn, zonaHoraria });

    registrar({ req, medicoPhone, accion: "exportar_kardex_pdf", recurso: `Paciente:${paciente._id}` });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "no-store",
      "Content-Length": String(pdf.length),
    });
    res.send(pdf);
  }));
};
