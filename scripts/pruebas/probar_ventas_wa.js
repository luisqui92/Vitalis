// Symphomed — El mismo WhatsApp para pacientes y para médicos.
//
// ═══ LOS DOS RIESGOS QUE JUSTIFICAN ESTA PRUEBA ═══════════════════════════
//
// 1. QUE EL MÉDICO SE COMA LA COLA DEL PACIENTE. El número es uno solo. Si la
//    separación se corre, un paciente que quiere reservar termina hablando
//    con el vendedor —o peor, un médico que pregunta el precio entra al flujo
//    de "elegí un día para tu cita"—. Las dos cosas se ven graciosas en una
//    captura y cuestan un cliente.
//
// 2. QUE LA IA INVENTE. Un precio inventado se lo dice a alguien que está
//    decidiendo si contratar, y después hay que sostenerlo o desdecirse. Y
//    nombrar un proveedor le entrega a un competidor el atajo entero —que es
//    justo lo que la página evita a propósito—.
//
// Lo segundo no se resuelve pidiéndoselo al prompt: un prompt es una
// sugerencia. Por eso hay un filtro después, y lo que se prueba acá es EL
// FILTRO, no la buena voluntad del modelo.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const ventas = require(path.join(RAIZ, "services", "asistenteVentas"));
const monedas = require(path.join(RAIZ, "services", "monedas"));
const saldo = require(path.join(RAIZ, "services", "saldo"));
const suscripciones = require(path.join(RAIZ, "services", "suscripciones"));

console.log("── 1. Los precios salen de donde se cobra, no del prompt ──");
// Si estuvieran escritos en el texto del prompt, el día que se cambie
// PRECIO_CONSULTA_CENTAVOS la IA seguiría diciendo el precio viejo a médicos
// que están por contratar. Y nadie se enteraría: el que escucha el precio
// equivocado no tiene con qué compararlo.
for (const moneda of ["BOB", "BRL"]) {
  const p = ventas.precios(moneda);
  const cfg = monedas.config(moneda);
  verificar(`[${moneda}] la consulta suelta es la misma que cobra saldo.js`,
    p.consulta === monedas.conSimbolo(cfg.precioConsulta, moneda));
  verificar(`[${moneda}] el plan mensual es el mismo que cobra suscripciones.js`,
    p.mensual === monedas.conSimbolo(suscripciones.precioMensual(moneda), moneda));
  verificar(`[${moneda}] el anual son doce meses al precio de once`,
    p.anual === monedas.conSimbolo(suscripciones.precioMensual(moneda) * 11, moneda));
  // Este número es EL argumento de venta —el punto desde el que conviene el
  // plan— y es el que dice symphomed.com. Se calcula, no se escribe.
  verificar(`[${moneda}] las ${p.consultasDelPlan} consultas del plan se calculan`,
    p.consultasDelPlan === Math.round(suscripciones.precioMensual(moneda) / cfg.precioConsulta));
  verificar(`[${moneda}] las consultas gratis son las de saldo.js`, p.gratis === saldo.CONSULTAS_GRATIS);
}

// La comprobación de verdad: se cambia el precio y el asistente tiene que
// cambiar con él, sin tocar una línea de código.
console.log("\n── 2. Si cambia el precio, cambia lo que dice ──");
const antes = ventas.precios("BOB");
process.env.PRECIO_CONSULTA_CENTAVOS = "2500";
process.env.PLAN_MENSUAL_CENTAVOS_BOB = "125000";
for (const m of ["monedas", "saldo", "suscripciones", "asistenteVentas"]) {
  delete require.cache[require.resolve(path.join(RAIZ, "services", m))];
}
const ventas2 = require(path.join(RAIZ, "services", "asistenteVentas"));
const despues = ventas2.precios("BOB");
verificar(`la consulta pasó de ${antes.consulta} a ${despues.consulta}`, antes.consulta !== despues.consulta);
verificar("y las consultas del plan se recalcularon solas (125000÷2500 = 50)",
  despues.consultasDelPlan === 50);
delete process.env.PRECIO_CONSULTA_CENTAVOS;
delete process.env.PLAN_MENSUAL_CENTAVOS_BOB;

console.log("\n── 3. El filtro de lo que no se cuenta ──");
// El prompt se lo pide a la IA. Esto no le pide nada a nadie: si la respuesta
// nombra un proveedor, se descarta y sale la genérica. Perder una respuesta
// cuesta mucho menos que regalar por dónde vamos.
const fugas = [
  "Usamos OpenAI para generar la nota clínica.",
  "La transcripción es con AssemblyAI, muy precisa.",
  "Está hecho en Node.js con MongoDB.",
  "Las recetas salen por Memed en Brasil.",
  "Corremos sobre AWS con Whisper para la voz.",
];
fugas.forEach(f => verificar(`se corta: «${f.slice(0, 42)}…»`, ventas.limpiar(f) === null));

const buenas = [
  "Reconoce lo que importa de la conversación y arma la nota clínica estructurada.",
  "El plan mensual es Bs 900 y equivale a 75 consultas.",
  "Las primeras 4 consultas no se cobran, y las historias se exportan completas cuando quiera.",
];
buenas.forEach(b => verificar(`pasa: «${b.slice(0, 42)}…»`, ventas.limpiar(b) === b));

// Mayúsculas y minúsculas no pueden ser la puerta de escape.
verificar("no se escapa por las mayúsculas", ventas.limpiar("Trabajamos con OPENAI y Claude") === null);
verificar("una respuesta vacía no rompe el filtro", ventas.limpiar(null) === null);

console.log("\n── 4. Médico o paciente: dónde se separa ──");
const bot = fs.readFileSync(path.join(RAIZ, "services", "reservaCitas.js"), "utf8");
// La separación tiene que estar ANTES de resolver el médico de la reserva. Si
// se corriera abajo, un médico entraría al flujo de citas y vería la lista de
// horarios de un consultorio ajeno.
const iSepara = bot.indexOf('sesion.paso === "medico" || esConsultaDeMedico');
const iReserva = bot.indexOf("const medicoPhone = sesion.datos?.medicoPhone");
verificar("la separación corre antes que la lógica de reserva",
  iSepara > 0 && iReserva > 0 && iSepara < iReserva);

// El ruteo por heurística: "dice Symphomed". Se ejecuta la función real.
const guion = bot.slice(bot.indexOf("function sinTildes"), bot.indexOf("const MAX_HISTORIAL"));
const { esConsultaDeMedico } = new Function(guion + "\nreturn { esConsultaDeMedico };")();

// Las frases exactas que mandan los botones de symphomed.com, en los tres
// idiomas. Si alguien cambia WA_TEXTO y no esto, los médicos que llegan de la
// página caen en el flujo de pacientes y nadie se entera.
const { WA_TEXTO } = require(path.join(RAIZ, "scripts", "diseno", "textos"));
Object.entries(WA_TEXTO).forEach(([idioma, frase]) =>
  verificar(`[${idioma}] el texto del botón de la página se reconoce`, esConsultaDeMedico(frase)));
verificar("  ...y también sin tildes, como lo escribe un celular",
  esConsultaDeMedico("hola quiero ver una demostracion de symphomed"));
verificar("  ...y si borró media frase antes de mandarla",
  esConsultaDeMedico("symphomed"));

// Y al revés: lo que escribe un paciente NO puede caer en ventas.
["hola", "quiero una cita", "buenas, necesito turno con el dentista",
 "cancelar", "a qué hora atienden?", "mi hijo tiene fiebre"]
  .forEach(p => verificar(`«${p}» sigue siendo paciente`, !esConsultaDeMedico(p)));

console.log("\n── 5. Las dos redes de seguridad ──");
// La heurística rutea, la IA corrige: si un paciente nombró Symphomed y la IA
// se da cuenta, el mensaje vuelve al flujo de reserva en vez de quedar
// atrapado en el vendedor.
verificar("un paciente mal ruteado vuelve al flujo de reserva",
  /if \(r\.intencion === "paciente"\)/.test(bot) && /return null;/.test(bot));
verificar("  ...y el que llama sabe seguir de largo con null",
  /const r = await atenderComoMedico[\s\S]{0,200}if \(r\) return r;/.test(bot));

// La sesión del médico tiene que durar más que la del paciente: un médico lee
// la respuesta, la piensa y vuelve a los diez minutos.
verificar("la sesión del médico dura más que la del paciente",
  /const tope = doc\.paso === "medico" \? MEDICO_MINUTOS_EXPIRA : SESION_MINUTOS_EXPIRA/.test(bot));

console.log("\n── 6. El contacto no se pierde ──");
// Se guarda desde el PRIMER mensaje, no recién cuando pide la demostración:
// el que preguntó el precio y no volvió igual es alguien a quien llamar, y es
// la mayoría.
verificar("el interesado se guarda en cada mensaje, no solo si pide demo",
  /await Interesado\.findOneAndUpdate\(\{ numero \}/.test(bot) &&
  bot.indexOf("Interesado.findOneAndUpdate") < bot.indexOf('if (r.intencion === "interesado") {\n    // Va como error'));
// Un estado que puso una persona no lo puede pisar el bot.
verificar("el bot no pisa un estado puesto por una persona",
  /!interesado \|\| interesado\.estado === "nuevo"/.test(bot));

const { Interesado } = require(path.join(RAIZ, "db", "models"));
const campos = Interesado.schema.obj;
verificar("el modelo guarda con qué llamarlo",
  ["numero", "nombre", "especialidad", "ciudad", "conversacion", "estado"].every(c => c in campos));
verificar("y el número es único: un médico, un contacto",
  campos.numero.unique === true);

console.log("\n── 6b. El mensaje que decide si atiende el teléfono ──");
// Salió de una conversación real. Un médico escribió "quiero ver una
// demostración de Symphomed" y el bot contestó:
//
//   «Confirmo que le escriben en breve para coordinar la demostración.»
//
// Obedeció al prompt al pie de la letra —decía "respondé confirmando que le
// escriben en breve"— y el resultado suena a formulario automático: voz
// pasiva, sin sujeto, sin cuándo, y sin preguntar lo único que hacía falta
// saber. El contacto quedó guardado sin especialidad, así que quien lo
// llame no sabe si mostrarle un odontograma o un esquema de vacunas.
// `ventas` ya es el módulo requerido arriba; acá hace falta el TEXTO del
// archivo, porque lo que se revisa es el prompt y no una función.
const codigoVentas = fs.readFileSync(path.join(RAIZ, "services", "asistenteVentas.js"), "utf8");
verificar("el prompt ya no manda contestar «le escriben en breve»",
  !/Respondé confirmando que le escriben en breve/.test(codigoVentas));
verificar("y prohíbe explícitamente esa frase y la voz pasiva",
  /NUNCA escribas "le escriben en breve"/.test(codigoVentas) && /voz pasiva/.test(codigoVentas));
verificar("si no sabe la especialidad, la pregunta en la misma respuesta",
  /SI NO SABÉS LA ESPECIALIDAD/.test(codigoVentas));
verificar("  ...y si ya la sabe, no la repregunta",
  /SI YA SABÉS LA ESPECIALIDAD/.test(codigoVentas));

// El historial de la charla se vence a la hora; el contacto no. Sin pasarle
// lo guardado, alguien que el mes pasado dijo que era veterinario vuelve a
// escribir y se lo preguntamos de nuevo — con la persona a la que le estamos
// vendiendo, justamente, memoria.
verificar("al armar la respuesta se le pasa lo que ya se sabe del contacto",
  /async function atenderMedico\(mensaje, historial = \[\], idioma = "es", sabido = null\)/.test(codigoVentas));
verificar("  ...y se le dice que no lo vuelva a preguntar",
  /no se lo vuelvas a preguntar/i.test(codigoVentas));
verificar("  ...y la ruta se lo pasa de verdad",
  /atenderMedico\(texto, historial, idioma, interesado\)/.test(bot));

console.log("\n── 6c. El «Hola» del segundo día ──");
// En la misma conversación real: el médico había escrito "Hola" antes y le
// contestó el bot de PACIENTES («¿cuál de nuestros consultorios buscás?»).
// Queda como que el sistema no se acuerda de él, justo con quien estamos
// vendiendo memoria. Si ya hay un interesado registrado, un saludo suelto
// sigue la conversación de ventas.
verificar("un saludo de alguien ya registrado entra por ventas",
  /saludoDeUnInteresado\(numero, t\)/.test(bot));
verificar("  ...pero solo si nadie lo contactó todavía",
  /estado === "nuevo" \|\| i\.estado === "interesado"/.test(bot));
// El 99 % de quien escribe a este número es un paciente: si un "hola"
// cualquiera entrara por ventas, se rompería el flujo que de verdad se usa.
verificar("un saludo de un número desconocido sigue yendo a reservas",
  /if \(!i\)|Boolean\(i\) &&/.test(bot));

console.log("\n── 7. La regla que hace seguro compartir número ──");
// Meta le pone UNA calificación de calidad al número, para todo. Si un médico
// que no pidió nada bloquea o reporta, el que deja de recibir mensajes es el
// PACIENTE que quería reservar. Por eso ventas solo RESPONDE.
const servicio = fs.readFileSync(path.join(RAIZ, "services", "asistenteVentas.js"), "utf8");
verificar("el asistente de ventas no manda nada por su cuenta",
  !/enviarTexto|enviarPlantilla|enviarTextoOPlantilla/.test(servicio));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
