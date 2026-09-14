// Symphomed Neurodesarrollo — El informe de avance para la familia.
//
// ═══ DE DÓNDE SALE ESTO Y POR QUÉ SE PRUEBA ASÍ ═══════════════════════════
//
// Una madre de un chico con autismo leve dijo que le serviría un informe de
// avance como el que le dan en la clase de programación de su hijo, "en el
// cual mencionaba sus fortalezas". Y dijo por qué muchas familias no podrían
// usarlo: el tema monetario, y que no saben usar muy bien el celular.
//
// Esas dos frases son el diseño entero. Y las dos se pueden romper sin que
// nada falle: alguien agrega un cobro, alguien mete una pestaña, alguien
// escribe "conducta disruptiva" en la plantilla. Todo seguiría "andando".
//
// Entonces esta prueba vigila tres cosas distintas:
//
//   1. LAS CUENTAS (comoLeFue): que lo que se le dice a una madre sobre su
//      hijo esté bien calculado. Es lo único acá que puede estar mal en
//      silencio y lo que más importa que esté bien.
//   2. LO QUE SALE POR EL ENLACE: que no viaje nada más que el informe.
//   3. LAS DOS FRASES DE LA MADRE, hechas prueba: nada de cobrar, nada de
//      cuentas, letra grande, una sola columna, cero palabras de consultorio.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const svc = require(path.join(RAIZ, "services", "informeFamilia"));
const RUTA = fs.readFileSync(path.join(RAIZ, "routes", "informeFamilia.js"), "utf8");
const PAGINA = fs.readFileSync(path.join(RAIZ, "public", "js", "informeFamilia.js"), "utf8");
// Los comentarios explican lo que NO hay que hacer, así que nombran justo lo
// que las pruebas buscan. Se sacan antes de mirar el código de verdad —es el
// mismo tropiezo que ya se corrigió en probar_kardex.js.
const sinComentarios = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const RUTA_CODIGO = sinComentarios(RUTA);
const PAGINA_CODIGO = sinComentarios(PAGINA);

const dias = (n) => new Date(Date.now() - n * 86400000);

console.log("── 1. Lo que de verdad cambió es CUÁNTA AYUDA necesita ──");
// Este es el corazón del informe, y va contra el reflejo de mostrar un
// porcentaje. El modelo ya lo decía en su propio comentario: "el objetivo
// real casi siempre es bajar la ayuda, no subir el porcentaje".
//
// Un chico que pasó de que le tomaran la mano a que le alcance con que le
// señalen AVANZÓ, aunque el porcentaje haya bajado. Si esto se calculara al
// revés, el informe le diría a una madre que su hijo retrocedió cuando no.
const bajoLaAyuda = svc.comoLeFue({
  titulo: "Pedir agua señalando", area: "comunicacion", estado: "activo",
  progreso: [
    { fecha: dias(50), logros: 9, intentos: 10, ayuda: "fisica_total" },
    { fecha: dias(10), logros: 5, intentos: 10, ayuda: "gestual" },
  ],
}, dias(60), new Date());
verificar("de «ayuda de la mano» a «que le señalen» se registra como avance", bajoLaAyuda.bajoLaAyuda === true);
verificar("  ...aunque el porcentaje haya BAJADO (90% → 50%)", bajoLaAyuda.bajoLaAyuda === true);
verificar("  ...y se dice cómo era antes y cómo es ahora, en castellano",
  bajoLaAyuda.ayudaAntes === "con ayuda de la mano" && bajoLaAyuda.ayudaAhora === "con que le señalen");

// Y al revés: si necesita MÁS ayuda que antes, no se disfraza de avance.
const subioLaAyuda = svc.comoLeFue({
  titulo: "Vestirse", estado: "activo",
  progreso: [
    { fecha: dias(50), logros: 5, intentos: 10, ayuda: "verbal" },
    { fecha: dias(10), logros: 9, intentos: 10, ayuda: "fisica_parcial" },
  ],
}, dias(60), new Date());
verificar("si ahora necesita MÁS ayuda, no se cuenta como que bajó", subioLaAyuda.bajoLaAyuda === false);
verificar("  ...y no se inventa un «antes» que no se va a mostrar", subioLaAyuda.ayudaAntes === "");

// Cuando la ayuda no cambió, la frase va sola, y armarla pegándole un prefijo
// a la otra da "Lo hace con que se lo recuerden", que no es castellano. Eso
// no se ve escribiendo el código: se ve leyendo la pantalla terminada.
verificar("con la ayuda sin cambios se usa una frase que se sostiene sola",
  subioLaAyuda.ayudaSola === "Todavía necesita un poco de ayuda física.");
verificar("  ...y todos los niveles tienen la suya, terminada en punto",
  svc.AYUDAS.every(n => /\.$/.test(svc.AYUDA_SOLA[n] || "")));
verificar("  ...y la página usa esa frase, no la otra con un prefijo",
  /a\.ayudaSola/.test(PAGINA_CODIGO) && !/Lo hace <b>\$\{esc\(a\.ayudaAhora\)/.test(PAGINA_CODIGO));

console.log("\n── 2. Las veces van en enteros, no en porcentaje ──");
// "8 de 10" se entiende sin traducir y además deja ver si fueron diez
// intentos o dos. "80%" esconde las dos cosas.
const sumado = svc.comoLeFue({
  titulo: "Saludar", estado: "logrado",
  progreso: [
    { fecha: dias(40), logros: 3, intentos: 5, ayuda: "verbal" },
    { fecha: dias(20), logros: 5, intentos: 5, ayuda: "independiente" },
  ],
}, dias(60), new Date());
verificar("se suman todas las sesiones del período: 8 de 10", sumado.veces === "8 de 10");
verificar("  ...y se dice en cuántos encuentros se trabajó", sumado.sesiones === 2);
verificar("  ...y que ya lo logró", sumado.logrado === true);
verificar("el servicio no arma porcentajes en ningún lado",
  !/%/.test(sinComentarios(fs.readFileSync(path.join(RAIZ, "services", "informeFamilia.js"), "utf8"))));

console.log("\n── 3. Sin registros no se rellena con una frase amable ──");
// Un informe donde todo "va muy bien" deja de servir a la segunda vez, y
// enseña a la familia a no abrirlo. Si no hay con qué, se dice que no hay.
verificar("un objetivo sin registros en el período devuelve null",
  svc.comoLeFue({ titulo: "X", progreso: [] }, dias(60), new Date()) === null);
verificar("  ...y un registro FUERA del período tampoco cuenta",
  svc.comoLeFue({ titulo: "X", progreso: [{ fecha: dias(200), logros: 1, intentos: 1, ayuda: "verbal" }] },
    dias(60), new Date()) === null);
verificar("un borrador vacío no se considera enviable",
  svc.tieneAlgoQueContar({ avances: [], fortalezas: [], enCasa: [], nota: "" }) === false);
verificar("  ...pero si el profesional escribió su párrafo, sí",
  svc.tieneAlgoQueContar({ avances: [], fortalezas: [], enCasa: [], nota: "Leo se soltó mucho." }) === true);
verificar("  ...y las fortalezas solas alcanzan",
  svc.tieneAlgoQueContar({ avances: [], fortalezas: ["Buena memoria visual"], enCasa: [] }) === true);
verificar("la ruta le dice al profesional qué falta, en vez de armar un informe vacío",
  /Todavía no hay avances registrados/.test(RUTA));

console.log("\n── 4. Las listas del modelo son listas, no texto ──");
// `fortalezas`, `intereses` y `estrategias` son arreglos en db/models.js.
// Tratarlos como cadenas da "ruido blanco,luz tenue" —una línea con comas
// donde tendrían que ir dos renglones— y nadie se entera: se ve casi bien.
verificar("listaLimpia devuelve un arreglo y saca los vacíos",
  Array.isArray(svc.listaLimpia(["  Memoria visual ", "", "  "])) &&
  svc.listaLimpia(["  Memoria visual ", "", "  "]).length === 1 &&
  svc.listaLimpia(["  Memoria visual ", "", "  "])[0] === "Memoria visual");
verificar("  ...y con algo que no es lista devuelve [], no ['undefined']",
  svc.listaLimpia("Memoria visual").length === 0 && svc.listaLimpia(null).length === 0);
verificar("las estrategias sensoriales se APLANAN (son una lista por modalidad)",
  /flatMap\(m => m\.estrategias/.test(fs.readFileSync(path.join(RAIZ, "services", "informeFamilia.js"), "utf8")));

console.log("\n── 5. Un informe que la familia ya leyó no se toca ──");
// Mismo criterio que el informe firmado: borrarlo de la base no lo borra del
// teléfono de la madre, solo destruye el registro de qué se le dijo.
verificar("un informe enviado no se puede editar",
  /estado === "enviado"[\s\S]{0,200}no se puede cambiar/.test(RUTA_CODIGO));
verificar("un informe enviado no se puede borrar",
  /estado === "enviado"\) throw new ErrorHttp\(409, "Un informe que la familia ya recibió no se borra/.test(RUTA_CODIGO));
verificar("el enlace se crea al ENVIAR, no antes: un borrador no se comparte",
  RUTA_CODIGO.indexOf("randomBytes") > RUTA_CODIGO.indexOf("/enviar"));
verificar("y por el enlace solo se abren los ENVIADOS",
  /findOne\(\{ tokenPublico: token, estado: "enviado" \}\)/.test(RUTA_CODIGO));

console.log("\n── 6. Las cifras no se pueden tipear a mano ──");
// Si el profesional pudiera reescribir "8 de 10", el informe dejaría de ser
// un registro de lo que pasó y pasaría a ser una redacción. Se puede QUITAR
// un avance del informe, no cambiar sus números.
verificar("de los avances solo se permite quitar, no reescribir",
  /informe\.avances = informe\.avances\.filter/.test(RUTA_CODIGO));
verificar("  ...y no hay ninguna asignación que meta avances del cuerpo del pedido",
  !/informe\.avances = b\.avances/.test(RUTA_CODIGO));

console.log("\n── 7. Por el enlace no sale nada más que el informe ──");
// El enlace ES la credencial, y puede terminar reenviado a un grupo de
// WhatsApp. Lo que no salga de acá, no se filtra.
const paraLaFamilia = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("function paraLaFamilia"),
  RUTA_CODIGO.indexOf("module.exports"));
["pacienteId", "medicoPhone", "enviadoA", "tokenPublico", "_id"].forEach(campo =>
  verificar(`  «${campo}» no viaja al navegador de la familia`, !new RegExp(`\\b${campo}\\b`).test(paraLaFamilia)));
verificar("un token corto ni se busca en la base", /token\.length < 20/.test(RUTA_CODIGO));
verificar("la puerta pública tiene su propio límite de pedidos",
  /rateLimit\("avanceFamilia"/.test(RUTA_CODIGO));

console.log("\n── 8. «El tema monetario»: la familia no paga ni se registra ──");
// Es la primera razón que dio la madre por la que muchas familias no podrían
// usar algo así. Si algún día aparece un cobro o un registro acá, esta
// prueba se pone roja antes que la familia se entere.
verificar("la página de la familia no pide iniciar sesión",
  !/login|contraseña|registrar|crear cuenta/i.test(PAGINA_CODIGO));
verificar("  ...ni cobra nada", !/precio|pagar|plan|suscri|Bs |US\$/i.test(PAGINA_CODIGO));
verificar("la ruta pública no exige token de sesión",
  !/requireMedico/.test(RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("/informe-familia/:token"))));

console.log("\n── 9. «No saben utilizar muy bien el celular» ──");
// La segunda razón, y la que decide toda la pantalla. En la práctica
// significa: no encuentra un menú, no entiende un ícono sin texto, no sabe
// qué es una pestaña, y si algo cambia solo cree que lo rompió.
verificar("no hay pestañas, acordeones ni «ver más»",
  !/class="tabs|data-tab|acordeon|ver más|Ver más/.test(PAGINA_CODIGO));
// Un solo botón en toda la página, y encima opcional.
const botones = [...PAGINA_CODIGO.matchAll(/<button/g)].length;
verificar(`hay un solo botón en toda la página (hay ${botones})`, botones === 1);
verificar("  ...y ese botón dice lo que hace, con palabras", /Guardar o imprimir/.test(PAGINA));
verificar("la hoja se puede imprimir (se lleva a la escuela)", /window\.print\(\)/.test(PAGINA_CODIGO));

const CSS = fs.readFileSync(path.join(RAIZ, "public", "estilos.css"), "utf8");
const hoja = CSS.slice(CSS.indexOf(".av-hoja{"), CSS.indexOf(".av-cabecera"));
const base = Number((hoja.match(/font-size:(\d+)px/) || [])[1] || 0);
verificar(`la letra base es de al menos 17 px (es ${base})`, base >= 17);
// Fondo claro siempre, aunque Symphomed esté en oscuro: es un documento, se
// imprime, y se lee con la pantalla al sol.
verificar("la hoja va en claro aunque la app esté en oscuro", /background:#fff/.test(hoja));
verificar("y a 640 px sigue siendo UNA columna", !/grid-template-columns|display:flex/.test(hoja));

console.log("\n── 10. Cero palabras de consultorio ──");
// Si una frase necesita que alguien la traduzca, no va. Esta lista no es
// exhaustiva: es la que se cuela sola cuando alguien copia y pega del código
// del profesional, que es como pasa siempre.
const JERGA = ["hiperreactividad", "vestibular", "propioceptivo", "DSM", "nivel de apoyo",
  "conducta disruptiva", "estereotipia", "adherencia", "línea de base", "TEA",
  "trastorno", "déficit", "patolog", "diagnóstic", "terapia", "paciente", "sesión terapéutica"];
JERGA.forEach(p => verificar(`  no aparece «${p}»`, !new RegExp(p, "i").test(PAGINA_CODIGO)));

console.log("\n── 11. El mensaje de WhatsApp no anuncia nada ──");
// La vista previa aparece en la pantalla bloqueada de un teléfono que en
// muchas casas es compartido, y acá el dato es más sensible que en cualquier
// otro aviso de Symphomed: una condición del neurodesarrollo no se anuncia
// en una notificación.
const mensaje = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("const texto ="), RUTA_CODIGO.indexOf("enviarTextoOPlantilla"));
["autis", "TEA", "trastorno", "terapia", "diagnóstic", "discapacidad", "síndrome"].forEach(p =>
  verificar(`  el mensaje no dice «${p}»`, !new RegExp(p, "i").test(mensaje)));
// La URL se lee en la vista previa del mensaje y queda en el historial del
// navegador. "avance" no insinúa nada; "neuro" o "autismo" sí.
verificar("y la URL tampoco: es /avance/, y no nombra la condición",
  /\/avance\/\$\{informe\.tokenPublico\}/.test(RUTA_CODIGO) &&
  !/\/(neuro|autismo|tea)\b/i.test(RUTA_CODIGO));
verificar("el título de la pestaña del navegador tampoco nombra nada",
  /document\.title = "Informe de avance"/.test(PAGINA_CODIGO));

console.log("\n── 12. Las fortalezas van PRIMERO ──");
// Es lo único que la madre mencionó del informe que le gustó, y es lo
// contrario de lo que recibe siempre: todo lo que le llega de la escuela y
// de los consultorios está escrito en déficit. Si alguien reordena la
// página, esto se pone rojo.
const iFortalezas = PAGINA_CODIGO.indexOf("Lo que hace bien");
const iAvances = PAGINA_CODIGO.indexOf("En qué avanzó");
const iSigue = PAGINA_CODIGO.indexOf("En qué seguimos trabajando");
verificar("«Lo que hace bien» va antes que «En qué avanzó»", iFortalezas > 0 && iFortalezas < iAvances);
verificar("  ...y lo que cuesta va al final", iAvances < iSigue);
verificar("y lo que sirve en casa se comparte con la familia",
  /Lo que pueden hacer en casa/.test(PAGINA_CODIGO));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
