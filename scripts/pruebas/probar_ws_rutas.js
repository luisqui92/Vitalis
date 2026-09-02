// Vitalis — Que los dos WebSocket convivan en el mismo servidor.
//
// Esto existe por un error que estuvo en producción y que ninguna prueba
// agarraba: /ws (tiempo real) y /ws-tele (teleconsulta) montados con
// { server, path } se destruían las conexiones entre ellos.
//
// Lo que lo hacía invisible es que probar_senalizacion.js levanta SOLO la
// señalización, y ese es justo el caso que funciona. El error aparecía
// únicamente con los dos montados a la vez — o sea, solo en producción.
//
// Por eso esta prueba monta LOS DOS, como index.js, y recién ahí pregunta.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const RAIZ = path.join(__dirname, "..", "..");

const { iniciarSenalizacion } = require(path.join(RAIZ, "services", "senalizacion"));
const { iniciarServidorTiempoReal } = require(path.join(RAIZ, "services", "realtime"));
const { tokenDeSenal } = require(path.join(RAIZ, "services", "video"));
const { generarToken } = require(path.join(RAIZ, "services", "auth"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Se conecta y espera el primer mensaje del servidor. Devuelve qué pasó:
// abrió y habló, se cerró, o el handshake falló.
function tocarPuerta(url, msEspera = 2500) {
  return new Promise((resolver) => {
    let resuelto = false;
    const listo = (r) => { if (!resuelto) { resuelto = true; resolver(r); } };
    const c = new WebSocket(url);
    const reloj = setTimeout(() => { listo({ que: "silencio" }); c.terminate(); }, msEspera);
    c.on("message", (m) => {
      clearTimeout(reloj);
      listo({ que: "mensaje", texto: String(m) });
      c.close();
    });
    c.on("open", () => {
      // El tiempo real no saluda: si abrió y no dice nada, con que la
      // conexión siga viva alcanza.
      setTimeout(() => { if (!resuelto && c.readyState === WebSocket.OPEN) { clearTimeout(reloj); listo({ que: "abierto" }); c.close(); } }, 300);
    });
    c.on("close", (codigo) => { clearTimeout(reloj); listo({ que: "cerrado", codigo }); });
    c.on("error", (e) => { clearTimeout(reloj); listo({ que: "error", detalle: e.message }); });
  });
}

(async () => {
  const servidor = http.createServer((_q, r) => r.end("ok"));

  // El orden importa: es el mismo de index.js, y con el error viejo el
  // primero en montarse era el que mataba al segundo.
  iniciarServidorTiempoReal(servidor);
  iniciarSenalizacion(servidor);

  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const base = `ws://127.0.0.1:${servidor.address().port}`;

  console.log("── Con los dos montados, los dos tienen que andar ──");

  const tele = await tocarPuerta(
    `${base}/ws-tele?token=${encodeURIComponent(tokenDeSenal("vit-prueba", "medico"))}`);
  verificar("/ws-tele conecta y saluda",
    tele.que === "mensaje" && /esperando/.test(tele.texto));
  if (tele.que !== "mensaje") console.log(`   (llegó: ${JSON.stringify(tele)})`);

  const real = await tocarPuerta(
    `${base}/ws?token=${encodeURIComponent(generarToken("70000001", "medico", 3600 * 1000))}`);
  // Con el error viejo esto abría y después se llenaba de basura: el otro
  // WebSocketServer escribía un "HTTP/1.1 400" adentro de una conexión que
  // ya era WebSocket ("Invalid WebSocket frame: RSV1 must be clear").
  verificar("/ws conecta y la conexión NO se corrompe", real.que === "abierto");
  if (real.que !== "abierto") console.log(`   (llegó: ${JSON.stringify(real)})`);

  console.log("\n── Lo que no es de nadie no entra ──");
  const inventada = await tocarPuerta(`${base}/ws-inventado`);
  verificar("una ruta que no existe se rechaza",
    inventada.que === "error" || inventada.que === "cerrado");

  console.log("\n── El token sigue siendo el candado ──");
  const sinToken = await tocarPuerta(`${base}/ws-tele`);
  verificar("/ws-tele sin token cierra con 4001",
    sinToken.que === "cerrado" && sinToken.codigo === 4001);

  const realSinToken = await tocarPuerta(`${base}/ws?token=inventado`);
  verificar("/ws con un token inventado cierra con 4001",
    realSinToken.que === "cerrado" && realSinToken.codigo === 4001);

  console.log("\n── Registrar dos veces la misma ruta no se permite ──");
  // Si el segundo módulo ganara en silencio, el primero dejaría de recibir
  // conexiones y nadie se enteraría hasta que un médico llame.
  let reventó = false;
  try { iniciarSenalizacion(servidor); } catch { reventó = true; }
  verificar("el segundo dueño de /ws-tele no arranca", reventó);

  servidor.close();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
