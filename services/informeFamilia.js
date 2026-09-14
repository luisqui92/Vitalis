// Symphomed Neurodesarrollo — El informe para la familia.
//
// ═══ DE DÓNDE SALE ESTO ════════════════════════════════════════════════════
//
// De una madre de un chico con autismo leve, textual: le serviría un informe
// de avance como el que le dan en la clase de programación de su hijo, "en el
// cual mencionaba sus fortalezas". Y agregó las dos razones por las que no
// todas las familias podrían usarlo:
//
//   1. el tema monetario
//   2. no saben utilizar muy bien el celular
//
// Esas dos frases son el diseño entero de este archivo, y de la pantalla que
// lo muestra. No son un requisito más: son los dos motivos por los que una
// función así normalmente no llega a quien más la necesita.
//
// ═══ LO QUE SE SIGUE DE ESO ════════════════════════════════════════════════
//
// · LA FAMILIA NO PAGA NADA, NUNCA. El informe es parte de lo que paga el
//   profesional. No hay cuenta, no hay login, no hay app que instalar, no
//   hay "registrate para ver". Llega por WhatsApp como un enlace que abre y
//   se lee, igual que el informe de un estudio (ver routes/informes.js).
//
// · SE ESCRIBE PARA UNA MADRE, NO PARA UN COLEGA. Nada de "hiperreactividad
//   vestibular", "conducta disruptiva" ni niveles del DSM. Si una frase
//   necesita que alguien la traduzca, no va.
//
// · LAS FORTALEZAS VAN PRIMERO. Es lo único que ella mencionó del informe de
//   Leo, y es lo contrario de lo que recibe siempre: todo lo que le llega de
//   la escuela y de los consultorios está escrito en déficit.
//
// ═══ LO QUE MÁS LE DICE A UNA MADRE NO ES EL PORCENTAJE ════════════════════
//
// El modelo guarda, por sesión, cuántas veces salió sobre cuántas se intentó
// Y CON CUÁNTA AYUDA. El comentario de ObjetivoNeuro ya lo decía: "el
// objetivo real casi siempre es bajar la ayuda, no subir el porcentaje".
//
// "Antes había que tomarle la mano; ahora le alcanza con que le señalen" es
// una frase que una madre entiende, recuerda y cuenta. "Pasó del 60% al 80%"
// no significa nada para nadie fuera del consultorio.
const { PerfilNeuro, ObjetivoNeuro, Paciente } = require("../db/models");

// De más ayuda a menos. El orden importa: es lo que permite decir si el chico
// necesita MENOS apoyo que antes, que es el avance de verdad.
const AYUDAS = ["fisica_total", "fisica_parcial", "gestual", "verbal", "independiente"];
const AYUDA_EN_PALABRAS = {
  fisica_total: "con ayuda de la mano",
  fisica_parcial: "con un poco de ayuda física",
  gestual: "con que le señalen",
  verbal: "con que se lo recuerden",
  independiente: "solo",
};

// El mismo dato dicho de otra forma, para cuando la ayuda NO cambió y la
// frase va sola. Hacen falta las dos: "Antes lo hacía con ayuda de la mano.
// Ahora, con que le señalen" se lee bien, pero "Lo hace con que se lo
// recuerden" no es castellano. Eso se ve leyendo la pantalla terminada y no
// escribiéndola, que es por lo que está separado en vez de armado pegándole
// un prefijo a la otra lista.
const AYUDA_SOLA = {
  fisica_total: "Todavía hay que tomarle la mano.",
  fisica_parcial: "Todavía necesita un poco de ayuda física.",
  gestual: "Le alcanza con que le señalen.",
  verbal: "Le alcanza con que se lo recuerden.",
  independiente: "Lo hace solo.",
};

const AREA_EN_PALABRAS = {
  comunicacion: "Comunicación", social: "Con otros", autonomia: "Autonomía",
  motor: "Movimiento", cognitivo: "Aprendizaje", conducta: "Conducta",
  sensorial: "Sentidos", academico: "Escuela", familiar: "En casa",
};

// El período por defecto. Dos meses y no uno: en neurodesarrollo un mes
// casi nunca muestra un cambio de nivel de ayuda, y un informe que dice
// "sigue igual" cuatro veces seguidas enseña a la familia a no abrirlo.
const PERIODO_DIAS = 60;

function listaLimpia(v, max = 20) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x).trim()).filter(Boolean).slice(0, max);
}

// Cómo le fue con un objetivo en el período, dicho en castellano.
//
// Devuelve null si no hay con qué: un objetivo sin registros en el período no
// se rellena con una frase amable. Un informe donde todo "va muy bien" deja
// de servir a la segunda vez.
function comoLeFue(objetivo, desde, hasta) {
  const enElPeriodo = (objetivo.progreso || [])
    .filter(p => new Date(p.fecha) >= desde && new Date(p.fecha) <= hasta)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  if (!enElPeriodo.length) return null;

  const totalLogros = enElPeriodo.reduce((s, p) => s + (p.logros || 0), 0);
  const totalIntentos = enElPeriodo.reduce((s, p) => s + (p.intentos || 0), 0);
  const primera = enElPeriodo[0];
  const ultima = enElPeriodo[enElPeriodo.length - 1];

  const iAntes = AYUDAS.indexOf(primera.ayuda);
  const iAhora = AYUDAS.indexOf(ultima.ayuda);
  // Lo que de verdad cambió: cuánta ayuda necesita.
  const bajoLaAyuda = iAhora > iAntes && iAntes >= 0;

  return {
    titulo: objetivo.titulo,
    area: AREA_EN_PALABRAS[objetivo.area] || "",
    sesiones: enElPeriodo.length,
    // En veces, no en porcentaje: "8 de 10" se entiende; "80%" hay que
    // traducirlo, y además esconde si fueron 10 intentos o 2.
    veces: totalIntentos > 0 ? `${totalLogros} de ${totalIntentos}` : "",
    ayudaAhora: AYUDA_EN_PALABRAS[ultima.ayuda] || "",
    ayudaSola: AYUDA_SOLA[ultima.ayuda] || "",
    bajoLaAyuda,
    ayudaAntes: bajoLaAyuda ? (AYUDA_EN_PALABRAS[primera.ayuda] || "") : "",
    logrado: objetivo.estado === "logrado",
  };
}

// El borrador. Se arma con lo que YA está registrado — no se le pide al
// profesional que vuelva a escribir lo que anotó sesión por sesión, que es
// exactamente por lo que hoy estos informes no existen: nadie tiene tiempo.
//
// Es un BORRADOR y no un envío: el profesional lo lee, lo corrige y recién
// ahí sale. Nada sobre un chico se manda a su familia sin que una persona lo
// haya leído.
async function armarBorrador({ pacienteId, medicoPhone, desde, hasta }) {
  const [paciente, perfil, objetivos] = await Promise.all([
    Paciente.findOne({ _id: pacienteId, medicoPhone }).select("nombre").lean(),
    PerfilNeuro.findOne({ pacienteId, medicoPhone }).lean(),
    ObjetivoNeuro.find({ pacienteId, medicoPhone }).lean(),
  ]);
  if (!paciente) return null;

  const avances = objetivos.map(o => comoLeFue(o, desde, hasta)).filter(Boolean);

  // Las estrategias sensoriales que SÍ funcionan, para que la familia las use
  // en casa. Es lo más útil que se puede compartir y hoy queda encerrado en
  // la ficha del profesional: la madre las descubre por ensayo y error, o no
  // las descubre.
  //
  // `estrategias` es una LISTA por cada modalidad sensorial, así que esto
  // aplana ocho listas en una. Tratarlas como texto daría "ruido blanco,luz
  // tenue" —una cadena con comas donde tendrían que ir dos renglones— que es
  // el error clásico de leer un arreglo del modelo como si fuera un campo.
  const enCasa = [...new Set(
    (perfil?.perfilSensorial || [])
      .flatMap(m => m.estrategias || [])
      .map(x => String(x).trim())
      .filter(Boolean)
  )];

  return {
    nombre: paciente.nombre,
    desde, hasta,
    // Primero las fortalezas. Es lo único que ella mencionó del informe de
    // Leo, y es lo contrario de lo que le llega siempre.
    fortalezas: listaLimpia(perfil?.fortalezas),
    intereses: listaLimpia(perfil?.intereses),
    avances,
    enCasa,
    // Lo que sigue. Sin fechas prometidas: un plazo escrito se lee como una
    // promesa, y en esto no se prometen plazos.
    siguiendo: objetivos
      .filter(o => o.estado === "activo" && !avances.some(a => a.titulo === o.titulo))
      .map(o => o.titulo),
    // El párrafo del profesional. Va vacío a propósito: es lo que hace que el
    // informe se sienta escrito por una persona y no generado, y es lo que la
    // madre va a leer dos veces. El resto es el andamio.
    nota: "",
  };
}

// Si no hay nada que contar, no se manda. Un informe de cortesía —"seguimos
// trabajando"— le enseña a la familia que estos mensajes no traen nada, y
// entonces el que sí trae algo tampoco se abre. Vale más que el profesional
// vea "todavía no hay con qué" en su pantalla.
//
// La nota escrita a mano cuenta: si el profesional se sentó a escribir un
// párrafo, hay algo que decir aunque los números no lo muestren.
function tieneAlgoQueContar(b) {
  if (!b) return false;
  return Boolean(
    b.avances?.length || b.fortalezas?.length ||
    b.enCasa?.length || String(b.nota || "").trim()
  );
}

module.exports = {
  armarBorrador, comoLeFue, tieneAlgoQueContar, listaLimpia,
  PERIODO_DIAS, AYUDA_EN_PALABRAS, AYUDA_SOLA, AREA_EN_PALABRAS, AYUDAS,
};
