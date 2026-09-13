// Symphomed Pet — Los esquemas de vacunación de perros y gatos.
//
// ═══ POR QUÉ ESTO ES EL CORAZÓN DE UNA VETERINARIA, Y NO UN EXTRA ══════════
//
// A una clínica veterinaria el paciente no le vuelve porque se enferme: le
// vuelve porque le toca la vacuna. Es el único motivo predecible de que un
// perro sano cruce la puerta, y es de donde sale la mitad de los ingresos
// recurrentes.
//
// Hasta ahora Symphomed guardaba vacunas como texto libre: nombre, dosis,
// fecha, notas. Sirve para anotar lo que pasó y no sirve para lo único que
// importa, que es saber QUÉ FALTA Y CUÁNDO. Con eso, el veterinario tenía
// que llevar el calendario en la cabeza o en un cuaderno, que es exactamente
// lo que Symphomed existe para no hacerle hacer.
//
// Y la página de symphomed.com ya prometía "esquema de vacunas propio".
//
// ═══ ESTO ES UN PUNTO DE PARTIDA, NO UN PROTOCOLO ══════════════════════════
//
// Mismo criterio que services/vigilancia.js, y por la misma razón: los
// esquemas cambian por país, por marca de vacuna y por situación
// epidemiológica. En Bolivia la antirrábica tiene campañas propias; en Brasil
// el calendario de leishmaniosis no se parece a nada de acá.
//
// Los ítems se crean SUELTOS en la ficha del animal y de ahí son del
// veterinario: los edita, los borra o agrega los suyos. Si mañana cambia una
// guía, cambia lo que él tenga cargado — no una tabla nuestra que le pise lo
// que decidió. Por eso tampoco se guarda una "fuente" que dé a entender
// autoridad.
//
// ⚠️ NO LOS REVISÓ TODAVÍA UN VETERINARIO. Están armados con los esquemas
// más difundidos (WSAVA para el núcleo, práctica habitual regional para el
// resto), pero hasta que alguien que atiende los lea, tratalos como un
// borrador informado y no como algo verificado.

// Cada ítem: desde qué edad corresponde (en SEMANAS, no meses — un cachorro
// se vacuna cada tres semanas y en meses no se puede expresar), hasta
// cuándo, y cada cuánto se repite después.
//
//   cadaSemanas null  = una sola vez
//   hastaSemanas null = de ahí en adelante, toda la vida
//
// nucleo: la que se pone siempre, en cualquier animal. El resto depende de
// dónde vive y qué hace, y por eso va marcado aparte: un perro de
// departamento que no sale del barrio no necesita lo mismo que uno de campo.
const ESQUEMA_PERRO = [
  { nombre: "Polivalente (quíntuple/séxtuple) — 1ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 6, hastaSemanas: 9, cadaSemanas: null,
    nota: "Moquillo, parvovirus, hepatitis, parainfluenza. Antes de las 6 semanas los anticuerpos de la madre todavía la neutralizan." },
  { nombre: "Polivalente — 2ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 9, hastaSemanas: 12, cadaSemanas: null,
    nota: "Tres semanas después de la primera." },
  { nombre: "Polivalente — 3ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 12, hastaSemanas: 16, cadaSemanas: null,
    nota: "" },
  { nombre: "Polivalente — 4ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 16, hastaSemanas: 20, cadaSemanas: null,
    nota: "La última del cachorro no debe ponerse antes de las 16 semanas: es la que de verdad cierra la inmunidad." },
  { nombre: "Polivalente — refuerzo anual", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 68, hastaSemanas: null, cadaSemanas: 52,
    nota: "Un año después de la última del cachorro, y de ahí en adelante." },
  { nombre: "Antirrábica", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 12, hastaSemanas: null, cadaSemanas: 52,
    nota: "Obligatoria por ley en casi toda la región. Conviene registrar el lote: es la que piden para viajar y para guarderías." },
  { nombre: "Tos de las perreras (Bordetella)", categoria: "Según riesgo", nucleo: false,
    desdeSemanas: 8, hastaSemanas: null, cadaSemanas: 52,
    nota: "Para perros que van a guardería, peluquería, paseos en grupo o exposiciones." },
  { nombre: "Leptospirosis", categoria: "Según riesgo", nucleo: false,
    desdeSemanas: 12, hastaSemanas: null, cadaSemanas: 52,
    nota: "Zonas con roedores, inundaciones o contacto con agua estancada. Es zoonosis: protege también a la familia." },
  { nombre: "Desparasitación interna", categoria: "Antiparasitario", nucleo: true,
    desdeSemanas: 2, hastaSemanas: 24, cadaSemanas: 2,
    nota: "En el cachorro, cada dos semanas hasta los seis meses." },
  { nombre: "Desparasitación interna — adulto", categoria: "Antiparasitario", nucleo: true,
    desdeSemanas: 24, hastaSemanas: null, cadaSemanas: 13,
    nota: "Cada tres meses. Más seguido si hay chicos en la casa o el perro caza." },
];

const ESQUEMA_GATO = [
  { nombre: "Triple felina — 1ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 8, hastaSemanas: 10, cadaSemanas: null,
    nota: "Panleucopenia, rinotraqueítis y calicivirus." },
  { nombre: "Triple felina — 2ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 11, hastaSemanas: 14, cadaSemanas: null,
    nota: "Tres a cuatro semanas después de la primera." },
  { nombre: "Triple felina — 3ª dosis", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 16, hastaSemanas: 20, cadaSemanas: null,
    nota: "No antes de las 16 semanas." },
  { nombre: "Triple felina — refuerzo", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 68, hastaSemanas: null, cadaSemanas: 52,
    nota: "Anual o cada tres años según la vacuna y el riesgo del gato: consultar el prospecto." },
  { nombre: "Antirrábica", categoria: "Núcleo", nucleo: true,
    desdeSemanas: 12, hastaSemanas: null, cadaSemanas: 52,
    nota: "" },
  { nombre: "Leucemia felina (FeLV)", categoria: "Según riesgo", nucleo: false,
    desdeSemanas: 8, hastaSemanas: null, cadaSemanas: 52,
    nota: "Para gatos con salida a la calle o que conviven con otros. Antes conviene testear: no se vacuna a un gato ya positivo." },
  { nombre: "Desparasitación interna", categoria: "Antiparasitario", nucleo: true,
    desdeSemanas: 3, hastaSemanas: 24, cadaSemanas: 3,
    nota: "Cada tres semanas hasta los seis meses." },
  { nombre: "Desparasitación interna — adulto", categoria: "Antiparasitario", nucleo: true,
    desdeSemanas: 24, hastaSemanas: null, cadaSemanas: 13,
    nota: "Cada tres meses. Los gatos cazadores, más seguido." },
];

// La especie se escribe a mano en la ficha, así que llega de cualquier forma:
// "Perro", "canino", "CAN", "perrito". Se normaliza acá y no en cada pantalla
// —si no, cada una lo resuelve distinto y el esquema aparece en una y no en
// otra sin que se entienda por qué.
const ESQUEMAS = { perro: ESQUEMA_PERRO, gato: ESQUEMA_GATO };

function especieDe(texto) {
  const t = String(texto || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/perr|can(ino)?\b|cachorr|cuzc/.test(t)) return "perro";
  if (/gat|felin|michi/.test(t)) return "gato";
  return null;   // vacío: no se inventa un esquema para un conejo
}

function esquemaPara(especie) {
  return ESQUEMAS[especieDe(especie)] || null;
}

// ═══ EL ESTADO DE CADA ÍTEM ════════════════════════════════════════════════
//
// Mismo criterio que estadoVigilancia: lo que se perdió se DICE, no se
// esconde. Un cachorro al que se le pasó la tercera dosis no está "al día
// con lo que se puso": está con el esquema incompleto, y el veterinario
// tiene que verlo en rojo.
function estadoVacuna(item, edadSemanas, aplicaciones) {
  const hechas = (aplicaciones || []).slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ultima = hechas[0] || null;

  if (edadSemanas < (item.desdeSemanas ?? 0)) return { estado: "futuro", ultima };

  const fueraDeVentana = item.hastaSemanas != null && edadSemanas > item.hastaSemanas;

  if (!ultima) {
    if (fueraDeVentana && !item.cadaSemanas) return { estado: "perdida", ultima: null };
    return { estado: "pendiente", ultima: null };
  }

  if (!item.cadaSemanas) return { estado: "al_dia", ultima };

  const semanasDesde = (Date.now() - new Date(ultima.fecha).getTime()) / (7 * 86400000);
  if (fueraDeVentana) return { estado: "no_aplica", ultima };
  return {
    estado: semanasDesde >= item.cadaSemanas ? "vencida" : "al_dia",
    ultima,
    semanasDesde,
    // Cuándo toca la próxima. Es EL dato de la pantalla: es lo que el
    // veterinario le dice al dueño antes de que se vaya, y lo que después
    // dispara el recordatorio.
    proxima: new Date(new Date(ultima.fecha).getTime() + item.cadaSemanas * 7 * 86400000),
  };
}

// Edad en semanas. En un cachorro la diferencia entre seis y nueve semanas
// decide si la vacuna sirve o la neutralizan los anticuerpos de la madre, así
// que los meses no alcanzan.
function edadEnSemanas(fechaNacimiento, ahora = new Date()) {
  if (!fechaNacimiento) return null;
  return Math.floor((ahora - new Date(fechaNacimiento)) / (7 * 86400000));
}

module.exports = {
  ESQUEMAS, ESQUEMA_PERRO, ESQUEMA_GATO,
  especieDe, esquemaPara, estadoVacuna, edadEnSemanas,
};
