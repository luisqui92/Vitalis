// Symphomed — Que un aviso de "algo cambió" no saque al médico de donde está.
//
// ═══ EL ERROR QUE ESTO ARREGLA ═════════════════════════════════════════════
//
// El servidor no manda eventos por tipo de dato: cada POST/PATCH/DELETE de un
// médico autenticado que termina bien dispara un genérico "algo cambió", y el
// frontend repinta la pantalla que esté mostrando (services/realtime.js).
//
// El problema es que "la pantalla que esté mostrando" se sabe solo si esa
// pantalla se registró al pintarse. Una que no se registra deja en pie a la
// ANTERIOR — y el aviso la repinta ENCIMA.
//
// Con la teleconsulta era brutal, porque entrar a la sala es en sí mismo un
// POST del propio médico: entraba, veía la videollamada dos segundos, y la
// ficha del paciente se repintaba sola encima. Sin error, sin nada que mirar
// en la consola. Parecía que el botón no funcionaba.
//
// Y no es la primera vez: el comentario de renderEquiposRayos en realtime.js
// cuenta exactamente lo mismo pasando con el alta de un equipo de rayos.
//
// Repintar la sala no es solo molesto: arranca los <video> del DOM y con
// ellos la conexión WebRTC. Corta la llamada con el paciente del otro lado.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Un navegador de mentira con lo mínimo que realtime.js toca. Las pantallas
// son espías: no pintan nada, solo anotan que las llamaron.
function montarFrontend() {
  const llamadas = [];
  const anotar = (nombre) => (...args) => { llamadas.push({ nombre, args }); };

  // El documento de mentira. realtime.js ahora sí toca el DOM: guarda y
  // restaura el scroll, y se abstiene de repintar si el médico está
  // escribiendo. Se le da lo mínimo para que eso se pueda COMPROBAR —un
  // stub que devuelve null para todo dejaría pasar las dos cosas sin probar
  // ninguna.
  const doc = {
    activeElement: null,
    cajaEscritorio: null,   // lo pone cada prueba si quiere simular escritorio
    getElementById(id) { return id === "escritorioContent" ? doc.cajaEscritorio : null; },
  };

  const ctx = {
    TOKEN: "token-de-prueba",
    location: { protocol: "https:", host: "salud.chatgo.ia.bo" },
    setTimeout: () => {},
    // Se ejecuta en el acto: en el navegador espera al próximo cuadro para
    // que el contenido ya esté medido, pero acá no hay nada que medir y
    // dejarlo sin llamar haría que el scroll nunca se restaure en la prueba.
    requestAnimationFrame: (fn) => fn(),
    document: doc,
    scrollTo: (x, y) => { ctx.scrollY = y; },
    scrollY: 0,
    console,
    // realtime.js crea el socket al conectar; acá nunca se llama a
    // conectarTiempoReal(), pero la clase tiene que existir igual.
    WebSocket: class { constructor() { this.readyState = 0; } close() {} },

    renderDashboard: anotar("renderDashboard"),
    renderAgenda: anotar("renderAgenda"),
    renderPacienteDetalle: anotar("renderPacienteDetalle"),
    pintarKardex: anotar("pintarKardex"),
    renderInicioEscritorio: anotar("renderInicioEscritorio"),
    renderRecordatorios: anotar("renderRecordatorios"),
    renderBandejaDicom: anotar("renderBandejaDicom"),
    renderEquiposRayos: anotar("renderEquiposRayos"),
    renderEditorInforme: anotar("renderEditorInforme"),
    renderMembrete: anotar("renderMembrete"),
    teleMedEntrar: anotar("teleMedEntrar"),
  };
  ctx.window = ctx;
  ctx.doc = doc;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "realtime.js"), "utf8"), ctx);
  return { ctx, llamadas };
}

// Lo que hace de verdad el aviso del servidor.
function llegaUnAvisoDeCambio(ctx) {
  ctx.refrescarPantallaActual();
}

console.log("── 1. La sala de la teleconsulta no se repinta ──");
{
  const { ctx, llamadas } = montarFrontend();

  // El médico está en la ficha del paciente...
  ctx.pintarKardex({ _id: "pac1" }, [], [], [], [], [], [], "consultas");
  // ...y entra a la videoconsulta.
  ctx.teleMedEntrar({ _id: "tele1" }, "pac1", "70000001");

  llamadas.length = 0;
  llegaUnAvisoDeCambio(ctx);

  verificar("un aviso de cambio NO repinta nada estando en la sala",
    llamadas.length === 0);
  verificar("  ...y sobre todo no vuelve a la ficha del paciente",
    !llamadas.some(l => l.nombre === "renderPacienteDetalle"));
  if (llamadas.length) console.log(`   (llamó a: ${llamadas.map(l => l.nombre).join(", ")})`);
}

console.log("\n── 2. Pero la ficha del paciente SÍ se sigue refrescando ──");
{
  // Que no se arregle lo de arriba apagando el tiempo real para todos.
  const { ctx, llamadas } = montarFrontend();
  ctx.pintarKardex({ _id: "pac1" }, [], [], [], [], [], [], "consultas");
  llamadas.length = 0;
  llegaUnAvisoDeCambio(ctx);
  const repinto = llamadas.find(l => l.nombre === "renderPacienteDetalle");
  verificar("se repinta la ficha", Boolean(repinto));
  verificar("  ...con el mismo paciente y la misma pestaña",
    repinto && repinto.args[0] === "pac1" && repinto.args[1] === "consultas");
}

console.log("\n── 3. Y al salir de la sala se vuelve a refrescar ──");
{
  // Si "salaTele" quedara pegada, el médico volvería a la ficha y esa ficha
  // no se actualizaría nunca más en toda la sesión.
  const { ctx, llamadas } = montarFrontend();
  ctx.teleMedEntrar({ _id: "tele1" }, "pac1", "70000001");
  ctx.pintarKardex({ _id: "pac1" }, [], [], [], [], [], [], "consultas");
  llamadas.length = 0;
  llegaUnAvisoDeCambio(ctx);
  verificar("vuelve a repintarse la ficha",
    llamadas.some(l => l.nombre === "renderPacienteDetalle"));
}

console.log("\n── 4. Las pantallas con texto a medio escribir siguen quietas ──");
for (const [pantalla, fn] of [["el editor de informes", "renderEditorInforme"], ["el membrete", "renderMembrete"]]) {
  const { ctx, llamadas } = montarFrontend();
  ctx[fn]("pac1", "inf1");
  llamadas.length = 0;
  llegaUnAvisoDeCambio(ctx);
  verificar(`${pantalla} no se repinta encima`, llamadas.length === 0);
}

console.log("\n── 5. Toda pantalla registrada tiene que tener un destino ──");
{
  // Una registrada que no esté ni en refrescarPantallaActual ni en la lista
  // de las que no se refrescan no rompe nada hoy, pero es una pantalla que
  // dejó de actualizarse sin que nadie lo decidiera.
  const fuente = fs.readFileSync(path.join(RAIZ, "public", "js", "realtime.js"), "utf8");
  const registradas = [...fuente.matchAll(/tipo:\s*"([a-zA-Z]+)"/g)].map(m => m[1]);
  const atendidas = new Set([
    ...[...fuente.matchAll(/tipo === "([a-zA-Z]+)"/g)].map(m => m[1]),
    ...[...(/PANTALLAS_SIN_REFRESCO = new Set\(\[([^\]]*)\]/.exec(fuente)?.[1] || "")
      .matchAll(/"([a-zA-Z]+)"/g)].map(m => m[1]),
  ]);
  const huerfanas = [...new Set(registradas)].filter(t => !atendidas.has(t));
  verificar(`ninguna quedó sin destino${huerfanas.length ? `: ${huerfanas.join(", ")}` : ""}`,
    huerfanas.length === 0);
}

console.log("\n── 6. Un repintado no pedido no puede mover la página ──");
// ═══ LO QUE REPORTÓ EL MÉDICO ═════════════════════════════════════════════
//
// "Cuando pregunto al Kardex se actualiza toda la página y tengo que volver a
// escrolear abajo para ver la respuesta."
//
// Eran dos cosas encadenadas. La primera está abajo, en el punto 5: preguntar
// es un POST, el middleware lo tomaba por escritura y le avisaba "algo
// cambió" al navegador DEL PROPIO MÉDICO.
//
// La segunda es esta: el repintado arma el HTML de cero y el navegador manda
// el scroll arriba de todo. Pasa igual con un aviso legítimo —una cita que
// entró por WhatsApp mientras el médico lee una historia clínica— y ahí es
// peor, porque no hay nada que explique por qué se movió la página.
{
  const { ctx } = montarFrontend();
  ctx.pintarKardex({ _id: "p1" }, null, null, null, null, null, null, "paciente");
  ctx.doc.cajaEscritorio = { scrollTop: 850 };
  ctx.scrollY = 0;
  llegaUnAvisoDeCambio(ctx);
  verificar("en el escritorio el scroll queda donde estaba", ctx.doc.cajaEscritorio.scrollTop === 850);
}
{
  const { ctx } = montarFrontend();
  ctx.pintarKardex({ _id: "p1" }, null, null, null, null, null, null, "paciente");
  ctx.doc.cajaEscritorio = null;   // celular: scrollea la ventana
  ctx.scrollY = 640;
  llegaUnAvisoDeCambio(ctx);
  verificar("y en el celular también", ctx.scrollY === 640);
}

console.log("\n── 7. Y no se repinta encima de lo que se está escribiendo ──");
// Repintar le arranca el campo del DOM con lo que llevaba adentro. No se
// pierde "un texto": se pierde a mitad de una frase, que es cuando más duele.
for (const etiqueta of ["INPUT", "TEXTAREA"]) {
  const { ctx, llamadas } = montarFrontend();
  ctx.pintarKardex({ _id: "p1" }, null, null, null, null, null, null, "paciente");
  const antes = llamadas.length;
  ctx.doc.activeElement = { tagName: etiqueta };
  llegaUnAvisoDeCambio(ctx);
  verificar(`con el foco en un <${etiqueta.toLowerCase()}> no repinta`, llamadas.length === antes);
}
{
  const { ctx, llamadas } = montarFrontend();
  ctx.pintarKardex({ _id: "p1" }, null, null, null, null, null, null, "paciente");
  const antes = llamadas.length;
  ctx.doc.activeElement = { tagName: "DIV", isContentEditable: true };
  llegaUnAvisoDeCambio(ctx);
  verificar("ni con el foco en un campo editable", llamadas.length === antes);
}
{
  // Y que no se pase de cauto: sin nadie escribiendo, tiene que repintar.
  const { ctx, llamadas } = montarFrontend();
  ctx.pintarKardex({ _id: "p1" }, null, null, null, null, null, null, "paciente");
  const antes = llamadas.length;
  ctx.doc.activeElement = { tagName: "BODY" };
  llegaUnAvisoDeCambio(ctx);
  verificar("pero sin nadie escribiendo, SÍ repinta", llamadas.length > antes);
}

console.log("\n── 8. Un POST que no cambia nada no avisa que algo cambió ──");
// La raíz del reporte. Preguntarle al Kardex es POST porque la pregunta va en
// el cuerpo, no porque escriba algo. El método no alcanza para saberlo.
{
  const realtime = require(path.join(RAIZ, "services", "realtime"));
  const { EventEmitter } = require("events");
  const fuente = fs.readFileSync(path.join(RAIZ, "services", "realtime.js"), "utf8");

  const res = new EventEmitter();
  res.locals = {};
  realtime.sinCambios(res);
  verificar("sinCambios(res) marca la respuesta", res.locals.sinCambios === true);
  verificar("  ...y el middleware la mira antes de avisar",
    /!res\.locals\.sinCambios/.test(fuente));
  // Y que siga alcanzando con el método para todo lo demás: si esto se
  // invirtiera, una escritura de verdad dejaría de avisar y las pantallas se
  // quedarían viejas sin que nadie note nada.
  verificar("  ...pero un POST normal sigue avisando",
    /const esEscritura = \["POST", "PATCH", "PUT", "DELETE"\]/.test(fuente));
}
// Y que las dos rutas que preguntan la usen. Son POST que no escriben nada:
// si alguna se olvidara, el síntoma vuelve y nadie lo relaciona con esto.
for (const ruta of ["memoriaClinica", "asistenteSymphomed"]) {
  const codigo = fs.readFileSync(path.join(RAIZ, "routes", ruta + ".js"), "utf8");
  verificar(`routes/${ruta}.js declara que no cambia nada`, /sinCambios\(res\);/.test(codigo));
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
