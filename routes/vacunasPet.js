// Symphomed Pet — El esquema de vacunación del animal, con lo que falta.
//
// ═══ LA DIFERENCIA CON LA LISTA DE VACUNAS QUE YA HABÍA ════════════════════
//
// Las vacunas ya se podían anotar: nombre, dosis, fecha, notas. Eso sirve
// para dejar constancia de lo que pasó, y no sirve para lo único que el
// veterinario necesita mirar antes de que el dueño se vaya: QUÉ FALTA.
//
// Acá no se guarda nada nuevo. Se cruzan las vacunas YA CARGADAS contra el
// esquema de la especie y se dice el estado de cada una. Así no hay dos
// verdades que mantener en sincronía: la vacuna aplicada sigue siendo la
// única fuente, y el esquema es una lectura sobre ella.
//
// ═══ POR QUÉ EL ESTADO SE CALCULA ACÁ Y NO EN EL NAVEGADOR ═════════════════
//
// Mismo criterio que la vigilancia de neurodesarrollo: si lo calculara cada
// pantalla, el mismo animal podría verse "al día" en el celular y "vencido"
// en el escritorio según cuál tenga el reloj corrido o el código viejo. El
// estado de una vacuna vencida no puede depender de por dónde se mire.
const { Paciente, Vacuna } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, obtenerOFallar } = require("../services/httpHelpers");
const { sinCambios } = require("../services/realtime");
const { esquemaPara, especieDe, estadoVacuna, edadEnSemanas } = require("../services/esquemaVacunas");

const requireMedico = requireAuth(["medico"]);

// Qué aplicaciones cargadas corresponden a cada ítem del esquema.
//
// Se cruza por texto porque es lo que hay: la vacuna se anotó a mano, y el
// veterinario escribe "quíntuple", "polivalente" o "V5" para la misma cosa.
// Se comparan las palabras con peso —no la cadena entera— para que "Polivalente
// — 2ª dosis" encuentre "polivalente 2da" y no encuentre "antirrábica".
const VACIAS = new Set(["de", "la", "el", "los", "las", "dosis", "y", "refuerzo", "interna", "adulto", "segun", "riesgo"]);

function palabras(texto) {
  return String(texto || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ª°ᵃ\s]/g, " ")
    .split(/\s+/)
    .filter(p => p.length > 2 && !VACIAS.has(p));
}

function corresponde(item, vacuna) {
  const delItem = palabras(item.nombre);
  const anotado = new Set(palabras(vacuna.nombre + " " + (vacuna.dosis || "")));
  if (!delItem.length) return false;
  // Alcanza con que coincida la palabra que identifica la vacuna. El número
  // de dosis se compara aparte: sin eso, "1ª dosis" y "2ª dosis" de la misma
  // polivalente se llevarían las dos aplicaciones cada una.
  const coincideNombre = delItem.some(p => anotado.has(p));
  if (!coincideNombre) return false;

  const ordinalItem = (item.nombre.match(/(\d)ª/) || [])[1];
  if (!ordinalItem) return true;
  const texto = (vacuna.nombre + " " + (vacuna.dosis || "")).toLowerCase();
  return texto.includes(ordinalItem + "ª") || texto.includes(ordinalItem + "a ") ||
         texto.includes(ordinalItem + "da") || texto.includes(ordinalItem + "ra") ||
         texto.includes(ordinalItem + "ta") || texto.includes(ordinalItem + "°");
}

module.exports = function (app) {
  app.get("/medico/pacientes/:pacienteId/vacunas/esquema", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    const esquema = esquemaPara(paciente.especie);
    if (!esquema) {
      // No se inventa un esquema. Un conejo, un ave o una ficha sin especie
      // cargada no tienen calendario acá, y decirlo es mejor que mostrar el
      // de perro "por si acaso".
      return res.json({
        especie: especieDe(paciente.especie), esquema: null,
        motivo: paciente.especie ? "sin_esquema" : "sin_especie",
      });
    }

    const edad = edadEnSemanas(paciente.fechaNacimiento);
    const aplicadas = await Vacuna.find({ pacienteId: paciente._id, medicoPhone }).lean();

    const items = esquema.map(item => {
      const suyas = aplicadas.filter(v => corresponde(item, v));
      return {
        ...item,
        aplicadas: suyas.map(v => ({ _id: v._id, nombre: v.nombre, dosis: v.dosis, fecha: v.fecha })),
        // Sin fecha de nacimiento no se puede saber si toca: se dice, no se
        // adivina. Es dato que el veterinario puede completar en un segundo.
        ...(edad == null ? { estado: "sin_edad" } : estadoVacuna(item, edad, suyas)),
      };
    });

    // Lo que el veterinario mira primero, ya contado: cuántas faltan.
    const pendientes = items.filter(i => ["pendiente", "vencida", "perdida"].includes(i.estado)).length;

    res.json({
      especie: especieDe(paciente.especie),
      edadSemanas: edad,
      pendientes,
      items,
    });
  }));

  // Los que no son perro ni gato igual pueden ver qué esquemas hay, para
  // saber que existen antes de cargar la especie.
  app.get("/medico/vacunas/esquemas", limitMedico, requireMedico, asyncRoute(async (_req, res) => {
    res.json({
      esquemas: [
        { especie: "perro", items: esquemaPara("perro").length },
        { especie: "gato", items: esquemaPara("gato").length },
      ],
    });
  }));
};
