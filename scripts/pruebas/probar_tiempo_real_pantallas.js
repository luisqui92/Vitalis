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

  const ctx = {
    TOKEN: "token-de-prueba",
    location: { protocol: "https:", host: "salud.chatgo.ia.bo" },
    setTimeout: () => {},
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

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
