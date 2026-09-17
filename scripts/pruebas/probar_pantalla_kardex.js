// Symphomed — La pantalla del Kardex: jerarquía, teclado y fechas.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Las cuatro cosas que cubre salieron de una auditoría externa, y las cuatro
// tienen la misma propiedad incómoda: NO TIRAN NINGÚN ERROR. La pantalla
// carga, la consola queda limpia, las pruebas de backend pasan. Solo se ven
// usando la app, y por eso vivieron meses.
//
//   1. LA JERARQUÍA. Vincular la persona y armar una videoconsulta estaban
//      arriba de las pestañas, empujando la ficha clínica cientos de píxeles
//      en celular. Se abría un paciente y había que scrollear para ver por
//      qué se lo abrió.
//
//   2. EL TECLADO. La lista de pacientes eran <div> con onclick: no se
//      alcanzan con Tab, no se abren con Enter, y un lector de pantalla no
//      los anuncia como algo que se pueda activar.
//
//   3. EL ANCHO. El breakpoint se calculaba UNA vez al cargar. Girar una
//      tablet dejaba el shell de escritorio adentro de una ventana angosta
//      hasta recargar.
//
//   4. LAS FECHAS. 23 lugares con "es-BO" escrito a mano, y uno de ellos en
//      el informe que recibe la familia: a una madre brasileña le llegaba
//      "16 de septiembre" en vez de "16 de setembro".
//
// Se prueban leyendo los archivos y no levantando un navegador: son
// propiedades del código —qué etiqueta se usa, qué locale, dónde está cada
// bloque— y una prueba de texto las agarra igual y corre en un segundo.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
// Sin comentarios: este archivo los tiene llenos de ejemplos de lo que NO
// hay que hacer, y sin sacarlos una prueba se agarraría de su propia
// explicación en vez del código.
const sinComentarios = (s) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const pacientes = sinComentarios(leer("public", "js", "pacientes.js"));
const personas = sinComentarios(leer("public", "js", "personas.js"));
const escritorio = sinComentarios(leer("public", "js", "escritorio.js"));
const i18n = leer("public", "js", "i18n.js");
const css = leer("public", "estilos.css");

// ═══ 1. LA JERARQUÍA CLÍNICA ═══════════════════════════════════════════════
console.log("── 1. Arriba solo identidad y alertas ──");

// El orden se mide DENTRO de pintarKardex() y no en todo el archivo: el
// primer `<div class="tabs"` del archivo es la barra de navegación del
// celular, que no tiene nada que ver con las pestañas de la ficha. Medir
// sobre el archivo entero daba un falso negativo.
const kardex = pacientes.slice(pacientes.indexOf("function pintarKardex("));
const posAlerta = kardex.indexOf("bloquePersonaHtml()");
const posTabs = kardex.indexOf('<div class="tabs" role="tablist"');
const posContenido = kardex.indexOf('id="tabContent"');
const posMas = kardex.indexOf('class="kardex-mas"');

verificar("la alerta de alergias va ANTES de las pestañas",
  posAlerta > 0 && posAlerta < posTabs);
verificar("lo administrativo va DESPUÉS del contenido clínico",
  posMas > posContenido);
verificar("vincular persona ya no está arriba",
  kardex.indexOf("bloquePersonaAccionesHtml()") > posContenido);
verificar("la videoconsulta tampoco",
  kardex.indexOf("teleMedCajaHtml") > posContenido);
verificar("van plegadas en «Más acciones», no sueltas",
  /<details class="kardex-mas">/.test(kardex));
// <details> nativo: se abre con teclado sin una línea de JavaScript.
const bloqueMas = kardex.slice(posMas, kardex.indexOf("</details>", posMas));
verificar("y «Más acciones» es <details> nativo, no un div con onclick",
  bloqueMas.length > 0 && !/onclick|addEventListener/.test(bloqueMas));

// La alerta y el trámite tienen que ir a cajas DISTINTAS, si no vuelven a
// quedar pegados.
verificar("la alerta y el formulario son dos cajas separadas",
  /personaAlertaBox/.test(personas) && /getElementById\("personaBox"\)/.test(personas));
verificar("sin persona vinculada la alerta se limpia (no queda la del paciente anterior)",
  /pintarSinPersona[\s\S]{0,400}?personaAlertaBox[\s\S]{0,120}?innerHTML = ""/.test(personas));
verificar("la alerta de alergias se anuncia sola a un lector de pantalla",
  /persona-alergias" role="alert"/.test(personas));

// ═══ 2. EL TECLADO ═════════════════════════════════════════════════════════
console.log("\n── 2. Se puede usar sin mouse ──");
verificar("un paciente de la lista es un <button>, no un <div>",
  /<button type="button" class="item item-paciente"/.test(pacientes));
verificar("y lleva type=\"button\" (sin eso, adentro de un form recarga la página)",
  /<button type="button" class="item item-paciente"/.test(pacientes));
verificar("las pestañas declaran semántica de pestañas",
  /role="tablist"/.test(pacientes) && /role="tab"/.test(pacientes) && /role="tabpanel"/.test(pacientes));
verificar("con aria-selected, que es lo que lee el lector de pantalla",
  /aria-selected="\$\{tabActiva === key\}"/.test(pacientes));
// Declarar role="tablist" sin flechas es peor que no declararlo: se le
// promete al usuario una forma de navegar que después no existe.
verificar("y las flechas funcionan de verdad (si no, la semántica miente)",
  /ArrowRight/.test(pacientes) && /ArrowLeft/.test(pacientes));
verificar("Home y End también", /"Home"/.test(pacientes) && /"End"/.test(pacientes));
verificar("tabindex rodante: Tab no obliga a pasar por las doce pestañas",
  /tabindex="\$\{tabActiva === key \? "0" : "-1"\}"/.test(pacientes));
verificar("el foco vuelve a la pestaña después de repintar",
  /kardexFocoEnTabs/.test(pacientes));
verificar("y hay un anillo de foco visible (sin eso, llegar con Tab no sirve)",
  /:focus-visible/.test(css) && /outline:2px solid var\(--primary\)/.test(css));

// ═══ 3. EL ANCHO ═══════════════════════════════════════════════════════════
console.log("\n── 3. La pantalla se adapta al cambiar de tamaño ──");
verificar("el ancho se consulta cada vez, no una sola",
  /function esEscritorio\(\)/.test(escritorio) && !/const ES_ESCRITORIO/.test(escritorio));
verificar("y se escucha el cambio de tamaño",
  /addEventListener\("change", alCambiarElAncho\)/.test(escritorio));
verificar("con respaldo para navegadores viejos",
  /addListener\(alCambiarElAncho\)/.test(escritorio));
verificar("al cambiar, se repinta la pantalla actual",
  /alCambiarElAncho[\s\S]{0,600}?volverA\(\)/.test(escritorio));
// La salvaguarda no puede depender del mismo código que salvaguarda.
verificar("y hay una salvaguarda CSS que no depende del JavaScript",
  /@media\(max-width:1023px\)\{[\s\S]{0,200}?\.escr-shell\{display:none!important/.test(css));
verificar("más un tope de ancho para que nada empuje la página de costado",
  /overflow-x:hidden/.test(css));

// ═══ 4. LAS FECHAS ═════════════════════════════════════════════════════════
console.log("\n── 4. Las fechas hablan el idioma del médico ──");
verificar("hay un formateador compartido", /function fechaCorta\(/.test(i18n) && /function fechaLarga\(/.test(i18n));
verificar("y uno para la hora", /function horaCorta\(/.test(i18n));
verificar("toleran fechas vacías sin escribir «Invalid Date» en una ficha",
  /if \(!f\) return "—"/.test(i18n) && /isNaN\(d\)/.test(i18n));

// Ninguna pantalla puede tener el locale escrito a mano.
const conLocaleAMano = [];
for (const f of fs.readdirSync(path.join(RAIZ, "public", "js"))) {
  if (!f.endsWith(".js") || f === "i18n.js") continue;
  // reservarPublico.js corre ANTES del login, sin idioma del médico: ahí el
  // locale fijo es correcto y no una omisión.
  if (f === "reservarPublico.js") continue;
  // socioPanel.js es la página del socio (/socio), que todavía no está
  // traducida: no carga i18n.js, así que no tiene de dónde sacar el idioma.
  // Es una deuda conocida y anotada en el propio archivo, no un descuido —
  // el socio es una figura nueva y por ahora no hay ninguno en Brasil. El día
  // que haya, se pasa a i18n y esta línea se borra.
  if (f === "socioPanel.js") continue;
  const txt = sinComentarios(fs.readFileSync(path.join(RAIZ, "public", "js", f), "utf8"));
  if (/toLocale\w*\("es-BO"|toLocale\w*\("pt-BR"/.test(txt)) conLocaleAMano.push(f);
}
verificar("ninguna pantalla tiene el idioma escrito a mano", conLocaleAMano.length === 0);
if (conLocaleAMano.length) console.log("   quedan en:", conLocaleAMano.join(", "));

// ═══ 5. LA HORA, QUE ERA EL BUG DE VERDAD ══════════════════════════════════
console.log("\n── 5. La agenda no está corrida una hora ──");
const agenda = sinComentarios(leer("public", "js", "agenda.js"));
verificar("la agenda ya no fuerza la hora de Bolivia",
  !/America\/La_Paz/.test(agenda));
verificar("usa la zona del aparato de quien mira",
  /horaCorta\(/.test(agenda));
// Esto sigue pendiente y la prueba lo deja anotado para que no se olvide:
// el bot manda horas desde el servidor, donde no hay navegador.
const reserva = fs.readFileSync(path.join(RAIZ, "services", "reservaCitas.js"), "utf8");
if (/America\/La_Paz/.test(reserva)) {
  console.log("ℹ️  PENDIENTE: services/reservaCitas.js sigue mandando horas en zona de Bolivia.");
  console.log("   Necesita un campo de zona horaria en Medico — se rompe cuando haya un cliente en Brasil.");
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
