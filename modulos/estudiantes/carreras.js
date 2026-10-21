// Symphomed — Las carreras de las cuentas de estudiante.
//
// Medicina fue la primera; enfermería, la segunda (octubre de 2026). Cada
// carrera dice qué niveles tiene, con qué especialidad del núcleo trabaja
// —eso decide el formato de su nota: la de enfermería sigue el proceso de
// atención de enfermería (services/notaClinica.js)— y en qué áreas practica
// con el paciente virtual y los simulacros.
//
// Las claves de las áreas no se repiten entre carreras (las de enfermería
// empiezan con «enf_»): así cada pregunta y cada caso del banco es de una
// sola carrera sin guardarla aparte, y lo de medicina que ya está en
// producción no cambia.
//
// La carrera sale del código de invitación (scripts/codigos_estudiante.js
// crear --carrera enfermeria) y queda en la cuenta. Una cuenta sin carrera
// es de medicina: son las que se crearon antes de que existieran otras.
const CARRERAS = {
  medicina: {
    niveles: ["estudiante", "interno", "residente"],
    tipoEspecialidad: "medicina_general",
    titulo: {
      es: { estudiante: "Estudiante de medicina", interno: "Interno de medicina", residente: "Médico residente" },
      pt: { estudiante: "Estudante de medicina", interno: "Interno de medicina", residente: "Médico residente" },
    },
    areasSimulacro: ["clinica", "pediatria", "gineco", "cirugia", "salud_publica"],
    areasPaciente: ["clinica", "pediatria", "gineco", "cirugia", "emergencias"],
  },
  enfermeria: {
    niveles: ["estudiante", "interno"],
    tipoEspecialidad: "enfermeria",
    titulo: {
      es: { estudiante: "Estudiante de enfermería", interno: "Interno de enfermería" },
      pt: { estudiante: "Estudante de enfermagem", interno: "Interno de enfermagem" },
    },
    areasSimulacro: ["enf_fundamentos", "enf_adulto", "enf_materno", "enf_pediatria", "enf_comunitaria", "enf_urgencias", "enf_salud_mental"],
    areasPaciente: ["enf_hospitalizacion", "enf_materno", "enf_pediatria", "enf_urgencias", "enf_comunitaria", "enf_geriatria"],
  },
  odontologia: {
    niveles: ["estudiante", "interno"], tipoEspecialidad: "odontologia",
    titulo: {
      es: { estudiante: "Estudiante de odontología", interno: "Interno de odontología" },
      pt: { estudiante: "Estudante de odontologia", interno: "Interno de odontologia" },
    },
    areasSimulacro: ["odo_anatomia", "odo_cariologia", "odo_endodoncia", "odo_periodoncia", "odo_cirugia", "odo_pediatria", "odo_prevencion"],
    areasPaciente: ["odo_cariologia", "odo_endodoncia", "odo_periodoncia", "odo_cirugia", "odo_pediatria", "odo_prevencion"],
  },
};

const CARRERA_POR_DEFECTO = "medicina";
const NOMBRES_CARRERA = Object.keys(CARRERAS);

const carreraValida = (c) => (Object.hasOwn(CARRERAS, c) ? c : CARRERA_POR_DEFECTO);
// La de una cuenta (Medico): sin carrera, medicina.
const carreraDe = (medico) => carreraValida(medico?.estudiante?.carrera);
const configDe = (carrera) => CARRERAS[carreraValida(carrera)];

// De qué carrera es un área (un área es de una sola).
function carreraDeArea(area) {
  for (const [nombre, c] of Object.entries(CARRERAS)) {
    if (c.areasSimulacro.includes(area) || c.areasPaciente.includes(area)) return nombre;
  }
  return null;
}

const nivelValido = (carrera, nivel) => configDe(carrera).niveles.includes(nivel);

// Cómo se presenta la cuenta («Estudiante de enfermería»), en su idioma.
function tituloDe(carrera, nivel, idioma) {
  const t = configDe(carrera).titulo;
  return (t[idioma] || t.es)[nivel] || "";
}

module.exports = {
  CARRERAS, CARRERA_POR_DEFECTO, NOMBRES_CARRERA,
  carreraValida, carreraDe, configDe, carreraDeArea, nivelValido, tituloDe,
};
