// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — El equipo tratante de un chico
// ═══════════════════════════════════════════════════════════════════════════
// El porqué está en db/models.js. Acá vive LA REGLA DE ACCESO, y vive en un
// solo lugar a propósito: si cada ruta de neuro resolviera por su cuenta de
// quién es la ficha, alcanzaría con que una se olvide para que el permiso
// deje de existir — y no fallaría nada visible, que es la peor forma de
// romper un permiso.
//
// Todas las rutas de la rama piden la ficha por `fichaNeuro()` y ninguna
// consulta `{ pacienteId, medicoPhone }` a mano. probar_equipo_neuro.js lo
// comprueba leyendo el código.
const { Paciente, Medico, EquipoNeuro } = require("../db/models");
const { ErrorHttp } = require("./httpHelpers");
const { registrar } = require("./auditoria");

// La rama tiene su propia regla, así que hay que saber si estamos en ella.
// Se mira la especialidad de LA CUENTA, nunca algo que venga en el pedido.
async function esDeNeuro(medicoPhone) {
  const m = await Medico.findOne({ phone: medicoPhone }).select("tipoEspecialidad clinicaId").lean();
  return { neuro: m?.tipoEspecialidad === "neurodesarrollo", clinicaId: m?.clinicaId || null };
}

// ═══ QUIÉN PUEDE USAR EL EQUIPO ════════════════════════════════════════════
//
// La misma regla para todo camino que lleve a la ficha de otro o al equipo:
// estar en el equipo, ser de neuro y seguir en el centro del equipo. Lo
// último se mira en la cuenta, AHORA: si se fue del centro, el equipo puede
// tardar en actualizarse y eso no puede darle acceso. Antes, entrar por la
// ficha propia enlazada miraba solo lo primero, y quien ya se había ido del
// centro seguía llegando a la titular (revisión integral del 11 de octubre
// de 2026, S01).
async function puedeUsarEquipo(equipo, medicoPhone) {
  if (!esMiembro(equipo, medicoPhone)) return false;
  const { neuro, clinicaId } = await esDeNeuro(medicoPhone);
  return neuro && Boolean(clinicaId) && String(clinicaId) === String(equipo.clinicaId);
}

// ═══ LA FUNCIÓN QUE DECIDE TODO ════════════════════════════════════════════
//
// Devuelve sobre QUÉ ficha hay que trabajar, que puede no ser la que se pidió:
//
//   · Si el profesional es dueño de esa ficha → la suya, como siempre.
//   · Si no es dueño pero está en el equipo del chico → la ficha titular del
//     equipo, y queda auditado que la abrió.
//   · Si no es ninguna de las dos → 404. No 403: un "no tenés permiso"
//     confirma que la ficha existe, y con eso se puede averiguar si un chico
//     se atiende en el centro probando ids.
//
// El `pacienteId` que llega puede ser el del propio profesional (abrió su
// ficha) o el titular del equipo (entró desde la lista compartida). Los dos
// tienen que funcionar, porque desde la pantalla se puede llegar por
// cualquiera de los dos caminos.
async function fichaNeuro(req, pacienteId, { paraEscribir = false } = {}) {
  const medicoPhone = req.adminUser.usuario;

  // 1. El camino de siempre: es su propia ficha.
  const propia = await Paciente.findOne({ _id: pacienteId, medicoPhone })
    .select("_id nombre personaId").lean();
  if (propia) {
    const equipo = propia.personaId
      ? await EquipoNeuro.findOne({ personaId: propia.personaId, activo: true }).lean()
      : null;
    // Ojo con esto: si el chico TIENE equipo, hasta su propio profesional
    // trabaja sobre la ficha titular. Si no, cada uno seguiría escribiendo en
    // la suya y "compartido" sería una etiqueta sin nada detrás.
    if (equipo && String(equipo.pacienteIdTitular) !== String(propia._id)) {
      // Lo sacaron del equipo, se fue del centro o dejó la rama: la ficha
      // propia no es un atajo a la titular.
      if (!(await puedeUsarEquipo(equipo, medicoPhone))) return null;
      registrarAcceso(req, medicoPhone, equipo, paraEscribir ? "escribir_ficha_equipo" : "ficha_equipo");
      return { pacienteId: equipo.pacienteIdTitular, medicoPhone: equipo.medicoPhoneTitular, equipo, compartida: true };
    }
    return { pacienteId: propia._id, medicoPhone, equipo, compartida: Boolean(equipo) };
  }

  // 2. No es suya. ¿Está en el equipo del chico?
  // La rama es la única con esta regla: si la cuenta no es de neuro, no
  // corresponde, aunque figure en un equipo por un arrastre de datos.
  const equipo = await EquipoNeuro.findOne({ pacienteIdTitular: pacienteId, activo: true }).lean();
  if (!equipo || !(await puedeUsarEquipo(equipo, medicoPhone))) return null;

  registrarAcceso(req, medicoPhone, equipo, paraEscribir ? "escribir_ficha_equipo" : "ficha_equipo");
  return { pacienteId: equipo.pacienteIdTitular, medicoPhone: equipo.medicoPhoneTitular, equipo, compartida: true };
}

// Igual que fichaNeuro pero tira el 404 en vez de devolver null, que es lo
// que quiere el 90% de las rutas.
async function fichaNeuroOFallar(req, pacienteId, opciones) {
  const f = await fichaNeuro(req, pacienteId, opciones);
  if (!f) throw new ErrorHttp(404, "Paciente no encontrado");
  return f;
}

// ═══ LOS OBJETOS A LOS QUE SE LLEGA POR SU PROPIO ID ═══════════════════════
//
// Un objetivo, un ítem de vigilancia o un instrumento se editan por su id, sin
// pasar por el paciente. Si esos endpoints siguieran filtrando por
// `medicoPhone` a secas, la ficha sería compartida para LEER y privada para
// ESCRIBIR: la TO vería el objetivo "pedir agua señalando" y no podría cargar
// lo que trabajó. Que es exactamente la mitad inútil de compartir.
async function objetoNeuroOFallar(req, Modelo, id, mensaje = "No encontrado") {
  const medicoPhone = req.adminUser.usuario;
  const doc = await Modelo.findById(id);
  if (!doc) throw new ErrorHttp(404, mensaje);
  if (doc.medicoPhone === medicoPhone) return doc;

  const equipo = await EquipoNeuro.findOne({ pacienteIdTitular: doc.pacienteId, activo: true }).lean();
  if (!equipo || !(await puedeUsarEquipo(equipo, medicoPhone))) throw new ErrorHttp(404, mensaje);

  registrarAcceso(req, medicoPhone, equipo, "escribir_ficha_equipo");
  return doc;
}

function esMiembro(equipo, medicoPhone) {
  if (!equipo) return false;
  if (equipo.medicoPhoneTitular === medicoPhone) return true;
  return (equipo.miembros || []).some(m => m.medicoPhone === medicoPhone);
}

// Se audita LA LECTURA, no solo la escritura. En el resto de Symphomed no
// hace falta —un médico leyendo su propia ficha no es un evento— pero acá sí:
// el sentido de que la familia autorice es que después se pueda ver quién
// entró. Una autorización sin rastro de uso no es una autorización.
//
// No se audita cuando el profesional abre su propia ficha sin equipo: eso
// sería registrar cada pantalla de la aplicación.
function registrarAcceso(req, medicoPhone, equipo, accion) {
  if (medicoPhone === equipo.medicoPhoneTitular) return;
  registrar({
    req, medicoPhone, accion,
    recurso: `EquipoNeuro:${equipo._id}`,
    detalle: `persona:${equipo.personaId} ficha:${equipo.pacienteIdTitular}`,
  });
}

module.exports = { fichaNeuro, fichaNeuroOFallar, objetoNeuroOFallar, esMiembro, esDeNeuro, puedeUsarEquipo };
