// Symphomed — Leer el kardex de un paciente para sacarlo del consultorio.
//
// Lo usan el resumen compartido (routes/resumenCompartido.js) y el Kardex en
// PDF (routes/kardexPdf.js). Una sola lectura para los dos: si cada uno
// armara la suya, un día uno de los dos empieza a sacar algo que el otro no
// (una nota sin confirmar, una transcripción) y nadie lo nota.
//
// Qué entra y qué no lo decide services/resumenCompartido.js → armarContenido;
// esto solo trae los documentos.
const {
  PersonaClinica, ConsultaMedica, Medicamento, Informe, Vacuna, Medicion, TratamientoPlan,
} = require("../db/models");

async function leerKardex(paciente) {
  const filtro = { pacienteId: paciente._id, medicoPhone: paciente.medicoPhone };
  const [persona, consultas, medicamentos, informes, vacunas, mediciones, tratamientos] = await Promise.all([
    paciente.personaId ? PersonaClinica.findById(paciente.personaId).lean() : null,
    // Solo las confirmadas por el médico: una nota clínica que la IA escribió
    // y que él todavía no revisó no puede salir del consultorio. Es un
    // borrador de máquina, igual que el brief.
    //
    // Y sin la transcripción: nunca sale (ver SIEMPRE_FUERA), así que ni se
    // trae. Además es lo más pesado de la consulta.
    ConsultaMedica.find({ ...filtro, confirmadaEn: { $ne: null } })
      .select("-transcripcionCompleta -segmentos").sort({ createdAt: -1 }).lean(),
    Medicamento.find(filtro).sort({ fechaInicio: -1 }).lean(),
    Informe.find({ ...filtro, estado: "firmado" }).sort({ fechaEstudio: -1 }).lean(),
    Vacuna.find(filtro).sort({ fecha: -1 }).lean(),
    Medicion.find(filtro).sort({ fecha: -1 }).limit(200).lean(),
    TratamientoPlan.find(filtro).sort({ createdAt: 1 }).lean(),
  ]);
  return { paciente, persona, consultas, medicamentos, informes, vacunas, mediciones, tratamientos };
}

module.exports = { leerKardex };
