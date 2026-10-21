// Reglas puras de la práctica odontológica. Nunca escribe en el odontograma
// de un paciente real. La comparación del registro no depende de una IA.
const AREAS = {
  odo_anatomia: "anatomía y morfología dental",
  odo_cariologia: "cariología y odontología restauradora",
  odo_endodoncia: "endodoncia y dolor dental",
  odo_periodoncia: "periodoncia",
  odo_cirugia: "cirugía y urgencias odontológicas",
  odo_pediatria: "odontopediatría",
  odo_prevencion: "prevención y salud bucal comunitaria",
};
const TEMAS = {
  odo_anatomia: ["nomenclatura FDI", "superficies dentales", "dentición temporal y permanente", "morfología coronaria", "oclusión básica"],
  odo_cariologia: ["riesgo de caries", "detección de lesiones", "actividad de la lesión", "prevención individualizada", "materiales restauradores"],
  odo_endodoncia: ["anamnesis del dolor", "pruebas de sensibilidad pulpar", "diagnóstico diferencial", "exploración periapical", "interpretación de hallazgos"],
  odo_periodoncia: ["sondaje periodontal", "sangrado al sondaje", "factores de riesgo", "higiene oral", "reevaluación periodontal"],
  odo_cirugia: ["antecedentes y alergias", "signos de alarma", "traumatismo dental", "consentimiento informado", "derivación oportuna"],
  odo_pediatria: ["dentición temporal", "comunicación con cuidadores", "prevención de caries", "traumatismos", "hábitos de higiene"],
  odo_prevencion: ["educación del paciente", "higiene interdental", "factores de riesgo", "hábitos alimentarios", "seguimiento individualizado"],
};
const PERMANENTES = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
const TEMPORALES = [55,54,53,52,51,61,62,63,64,65,85,84,83,82,81,71,72,73,74,75];
const ESTADOS = ["sano", "caries", "restauracion", "fractura", "sellante", "ausente", "corona", "endodoncia", "implante"];
const GLOBALES = ["ausente", "corona", "endodoncia", "implante"];
const DENTICIONES = ["permanente", "temporal", "mixta"];
const dientesDe = (denticion) => denticion === "temporal" ? TEMPORALES : denticion === "mixta" ? [...PERMANENTES, ...TEMPORALES] : PERMANENTES;
const superficiesDe = (diente) => ["M", "D", "V", "L", Number(diente) % 10 <= 3 ? "I" : "O"];
const esDental = (area) => Object.hasOwn(AREAS, area);
const texto = (s, n) => typeof s === "string" ? s.trim().slice(0, n) : "";
const lista = (xs, n = 8) => (Array.isArray(xs) ? xs : []).map(s => texto(s, 300)).filter(Boolean).slice(0, n);

function validarRegistro(registro, denticion) {
  if (!DENTICIONES.includes(denticion) || !Array.isArray(registro) || registro.length > 312) {
    throw new Error("Odontograma inválido.");
  }
  const permitidos = new Set(dientesDe(denticion)), claves = new Set(), porDiente = new Map();
  const salida = registro.map(r => {
    if (!r || !Number.isInteger(r.diente) || !permitidos.has(r.diente) || !ESTADOS.includes(r.estado)) throw new Error("Diente o estado inválido.");
    const superficie = r.superficie;
    if (GLOBALES.includes(r.estado) ? superficie !== "pieza" : !superficiesDe(r.diente).includes(superficie)) {
      throw new Error("La superficie no corresponde a ese diente o estado.");
    }
    const clave = `${r.diente}:${superficie}`;
    if (claves.has(clave)) throw new Error("No repitas una superficie.");
    claves.add(clave);
    const anteriores = porDiente.get(r.diente) || [];
    // Un diente ausente no puede tener superficies ni tratamientos.
    if ((r.estado === "ausente" && anteriores.length) || anteriores.includes("ausente")) throw new Error("Un diente ausente no admite otros hallazgos.");
    anteriores.push(r.estado); porDiente.set(r.diente, anteriores);
    return { diente: r.diente, superficie, estado: r.estado, nota: texto(r.nota, 200) };
  });
  return salida.sort((a, b) => a.diente - b.diente || a.superficie.localeCompare(b.superficie));
}

function sanearCaso(raw) {
  if (!raw || !DENTICIONES.includes(raw.denticion)) return null;
  try {
    const odontograma = validarRegistro(raw.odontograma, raw.denticion);
    const planClave = lista(raw.planClave);
    if (planClave.length < 3) return null;
    return { denticion: raw.denticion, odontograma, planClave };
  } catch { return null; }
}

function compararRegistro(esperado, entregado) {
  const clave = r => `${r.diente}:${r.superficie}`;
  const a = new Map(esperado.map(r => [clave(r), r]));
  const b = new Map(entregado.map(r => [clave(r), r]));
  const correctos = [], faltaron = [], diferentes = [], adicionales = [];
  for (const [k, r] of a) {
    const elegido = b.get(k);
    if (!elegido) faltaron.push(r);
    else if (elegido.estado === r.estado) correctos.push(r);
    else diferentes.push({ ...r, elegido: elegido.estado });
  }
  // Lo no descrito por el guion NO equivale a sano ni se califica como error.
  for (const [k, r] of b) if (!a.has(k)) adicionales.push(r);
  return { correctos, faltaron, diferentes, adicionales };
}

function instruccionesCaso() {
  return `
ESPECIALIDAD: ODONTOLOGÍA. El estudiante practica entrevista odontológica,
exploración extraoral e intraoral, registro por pieza/superficie, razonamiento
y planificación. Usá nomenclatura FDI de dos dígitos. Sin dosis de medicamentos.
La dificultad debe corresponder a un alumno, sin simular destrezas manuales.
Incluí antecedentes médicos, alergias, medicación, hábitos, salud bucal,
expectativas, consentimiento y signos que obligan a derivar cuando correspondan.
Los hallazgos y resultados quedan FIJOS: todas las pruebas necesarias deben
existir en examenFisico/estudios, con nombres claros. No inventes imágenes:
las radiografías se representan únicamente mediante un informe simulado.
No afirmes que este caso fue revisado por un odontólogo.
Añadí al JSON "odontologia": {
  "denticion": "permanente|temporal|mixta",
  "odontograma": [{"diente": 16, "superficie": "O", "estado": "caries", "nota": "hallazgo del examen"}],
  "planClave": ["prioridad y justificación", "opciones y consentimiento", "prevención y seguimiento"]
}.
En odontograma registrá SOLO hallazgos que el examen describa expresamente.
Superficies: M mesial, D distal, V vestibular, L lingual/palatina, O oclusal
(premolares/molares), I incisal (incisivos/caninos).
Estados por superficie: sano, caries, restauracion, fractura, sellante.
Estados de toda la pieza ("superficie":"pieza"): ausente, corona, endodoncia,
implante. No mezcles ausencia con otros hallazgos. No repitas superficies.
Dientes permanentes 11–18,21–28,31–38,41–48; temporales 51–55,61–65,71–75,81–85.
Un odontograma vacío es válido si no hay hallazgos dentarios específicos.
El odontograma y el plan esperado son secretos hasta entregar la práctica.`;
}

function instruccionesEvaluacion() {
  return `
Evaluás como docente de odontología. Además de la entrevista, exploración,
diagnóstico y comunicación, evaluá el plan de tratamiento contra
odontologia.planClave: prioridades, justificación, alternativas,
consentimiento, prevención, seguimiento y derivación cuando corresponda.
No des por hechas acciones que no constan en la conversación o la entrega.
Añadí "planTratamiento":{"adecuadas":["..."],"faltaron":["..."],"inadecuadas":["..."]}.
No califiques el odontograma: se compara por reglas independientes.
Sin dosis ni procedimientos invasivos paso a paso. Es práctica formativa.`;
}

function sanearPlan(r) {
  return { adecuadas: lista(r?.adecuadas), faltaron: lista(r?.faltaron), inadecuadas: lista(r?.inadecuadas) };
}

// Tarjetas derivadas de lo que ya se evaluó, sin otra llamada de IA.
function tarjetasDeSimulacion(sim) {
  if (sim.estado !== "terminada" || !esDental(sim.area)) return [];
  const g = sim.guion, ev = sim.evaluacion || {};
  const caso = { sexo: g.paciente?.sexo, edad: g.paciente?.edad, motivo: g.motivo, sintomas: g.historia, fecha: sim.terminadaEn };
  const tarjetas = [];
  if (ev.diagnostico?.acerto !== true) {
    const opciones = [g.diagnostico, ...g.diferenciales.map(d => d.diagnostico)].slice(0, 5);
    tarjetas.push({ tipo: "dx", opciones, correcta: 0, respuesta: [g.diagnostico], aFavor: [g.perla] });
  }
  const faltaron = (ev.preguntasClave || []).filter(x => !x.hecha).map(x => x.pregunta);
  if (faltaron.length) tarjetas.push({ tipo: "faltoPreguntar", respuesta: faltaron });
  const banderas = (ev.banderasRojas || []).filter(x => !x.explorada).map(x => x.bandera);
  if (banderas.length) tarjetas.push({ tipo: "banderas", respuesta: banderas });
  const plan = [...(ev.planTratamiento?.faltaron || []), ...(ev.planTratamiento?.inadecuadas || []).map(x => `Revisar: ${x}`)];
  if (plan.length) tarjetas.push({ tipo: "planDental", respuesta: plan });
  const odo = ev.odontograma || {};
  const errores = [...(odo.faltaron || []), ...(odo.diferentes || [])];
  if (errores.length) tarjetas.push({ tipo: "odontograma", registroEsperado: errores, respuesta: [] });
  return tarjetas.map(t => ({ ...t, caso, carrera: "odontologia", area: sim.area, perla: g.perla, simulacionId: sim._id }));
}

module.exports = {
  AREAS, TEMAS, PERMANENTES, TEMPORALES, ESTADOS, GLOBALES, DENTICIONES,
  dientesDe, superficiesDe, esDental, validarRegistro, sanearCaso,
  compararRegistro, instruccionesCaso, instruccionesEvaluacion, sanearPlan, tarjetasDeSimulacion,
};
