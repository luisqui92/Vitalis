// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — plantillas de vigilancia de salud
// ═══════════════════════════════════════════════════════════════════════════
// El síndrome de Down trae asociadas condiciones que NO aparecen solas: hay
// que ir a buscarlas en momentos determinados. Si nadie lleva ese
// calendario, se pasan de largo años enteros — y eso es lo que pasa hoy en
// la mayoría de las familias.
//
// LÍMITE IMPORTANTE, y está acá arriba a propósito para que nadie lo pase
// por alto: esto es un PUNTO DE PARTIDA basado en las guías de supervisión
// de salud publicadas, no un protocolo. Symphomed no decide nada clínico. Los
// ítems se crean sueltos en la ficha del paciente y el profesional los
// edita, los borra o agrega los suyos: el protocolo que manda es el del
// médico tratante y el de su país.
//
// Por eso tampoco se guarda una "fuente" que dé a entender autoridad: se
// carga una vez, queda como datos del paciente, y de ahí en adelante es del
// médico. Si mañana cambia una guía, cambia lo que él tenga cargado, no una
// tabla nuestra que le pise lo que decidió.

// Cada ítem: desde qué edad corresponde (en meses), hasta cuándo, y cada
// cuánto se repite. cadaMeses null = una sola vez. hastaMeses null = de ahí
// en adelante, toda la vida.
const VIGILANCIA_SINDROME_DOWN = [
  { nombre: "Ecocardiograma", categoria: "Cardiología", desdeMeses: 0, hastaMeses: 3, cadaMeses: null,
    nota: "Cerca de la mitad de los recién nacidos con síndrome de Down tiene una cardiopatía congénita, y muchas no dan soplo al examinar." },
  { nombre: "Perfil tiroideo (TSH)", categoria: "Endocrinología", desdeMeses: 0, hastaMeses: null, cadaMeses: 12,
    nota: "El hipotiroidismo es frecuente y sus síntomas se confunden con los del propio síndrome." },
  { nombre: "Evaluación auditiva", categoria: "Audición", desdeMeses: 0, hastaMeses: null, cadaMeses: 12,
    nota: "Otitis a repetición y pérdida auditiva. Oír mal frena el lenguaje, y muchas veces se atribuye el retraso al síndrome cuando es el oído." },
  { nombre: "Evaluación oftalmológica", categoria: "Visión", desdeMeses: 0, hastaMeses: null, cadaMeses: 12,
    nota: "Cataratas, estrabismo y errores refractivos." },
  { nombre: "Hemograma completo", categoria: "Hematología", desdeMeses: 0, hastaMeses: null, cadaMeses: 12, nota: "" },
  { nombre: "Tamizaje de enfermedad celíaca", categoria: "Digestivo", desdeMeses: 24, hastaMeses: null, cadaMeses: 24,
    nota: "Ante síntomas digestivos, poco progreso de peso o anemia sin explicación." },
  { nombre: "Estudio de sueño (polisomnografía)", categoria: "Sueño", desdeMeses: 36, hastaMeses: 60, cadaMeses: null,
    nota: "La apnea del sueño es muy frecuente y se nota poco: se manifiesta como problemas de conducta y de atención durante el día." },
  { nombre: "Evaluación de columna cervical", categoria: "Traumatología", desdeMeses: 36, hastaMeses: null, cadaMeses: null,
    nota: "Inestabilidad atlantoaxial. Conviene tenerlo resuelto antes de autorizar deportes de contacto." },
  { nombre: "Control odontológico", categoria: "Odontología", desdeMeses: 12, hastaMeses: null, cadaMeses: 6, nota: "" },
  { nombre: "Control nutricional y de peso", categoria: "Nutrición", desdeMeses: 12, hastaMeses: null, cadaMeses: 12,
    nota: "Usar curvas específicas de síndrome de Down: contra las curvas comunes parece un retraso de crecimiento que no existe." },
];

// En autismo no hay un calendario de vigilancia médica equivalente — no es
// una condición con comorbilidades médicas de aparición predecible. Lo que
// sí hay son controles que se pasan por alto justamente porque cuesta más
// hacerlos, y esa es la razón de que estén acá.
const VIGILANCIA_TEA = [
  { nombre: "Evaluación auditiva", categoria: "Audición", desdeMeses: 0, hastaMeses: null, cadaMeses: 24,
    nota: "Descartar hipoacusia antes de atribuir al autismo la falta de respuesta al nombre." },
  { nombre: "Control odontológico", categoria: "Odontología", desdeMeses: 12, hastaMeses: null, cadaMeses: 6,
    nota: "Suele postergarse por la dificultad sensorial del procedimiento; conviene preparar la visita, no saltearla." },
  { nombre: "Evaluación del sueño", categoria: "Sueño", desdeMeses: 24, hastaMeses: null, cadaMeses: 12,
    nota: "Los trastornos del sueño son muy frecuentes y empeoran todo lo demás." },
  { nombre: "Evaluación nutricional", categoria: "Nutrición", desdeMeses: 24, hastaMeses: null, cadaMeses: 12,
    nota: "La selectividad alimentaria por causa sensorial puede dejar carencias." },
];

const PLANTILLAS_VIGILANCIA = {
  sindrome_down: { nombre: "Síndrome de Down", items: VIGILANCIA_SINDROME_DOWN },
  tea: { nombre: "Autismo (TEA)", items: VIGILANCIA_TEA },
};

// ─── ESTADO DE UN ÍTEM PARA UNA EDAD DADA ─────────────────────────────────
// "pendiente"  → corresponde ahora y nunca se hizo
// "atrasado"   → corresponde y venció el intervalo desde el último
// "al_dia"     → hecho dentro del intervalo
// "futuro"     → todavía no corresponde por edad
// "no_aplica"  → ya pasó la ventana de edad y no se repite
function estadoVigilancia(item, edadMeses) {
  const realizados = (item.realizados || []).slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ultimo = realizados[0] || null;

  if (edadMeses < (item.desdeMeses ?? 0)) return { estado: "futuro", ultimo };

  const fueraDeVentana = item.hastaMeses != null && edadMeses > item.hastaMeses;

  if (!ultimo) {
    // Nunca se hizo. Si ya se pasó la ventana y no se repite, se perdió la
    // oportunidad; se dice, no se esconde.
    if (fueraDeVentana && !item.cadaMeses) return { estado: "atrasado", ultimo: null };
    return { estado: "pendiente", ultimo: null };
  }

  // Ya se hizo alguna vez y no se repite: listo para siempre.
  if (!item.cadaMeses) return { estado: "al_dia", ultimo };

  const mesesDesde = (Date.now() - new Date(ultimo.fecha).getTime()) / (30.4375 * 86400000);
  if (fueraDeVentana) return { estado: "no_aplica", ultimo };
  return { estado: mesesDesde >= item.cadaMeses ? "atrasado" : "al_dia", ultimo, mesesDesde };
}

module.exports = { PLANTILLAS_VIGILANCIA, estadoVigilancia };
