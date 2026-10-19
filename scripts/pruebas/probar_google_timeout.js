// Symphomed — Si Google Calendar no contesta, la reserva no se queda
// esperando para siempre (services/googleCalendar.js).
//
// Ninguna de las llamadas a Google tenía timeout, y axios sin timeout espera
// para siempre. La reserva por link, la de voz y la de WhatsApp le preguntan
// a Google qué está ocupado antes de confirmar: si Google no contestaba,
// quedaban colgadas, y la agenda del médico también (auditoría del comité de
// QA, octubre de 2026, A7). Lo que se prueba:
//   1. Las cinco llamadas (el token y las cuatro del calendario) salen con un
//      timeout de 10 segundos como mucho.
//   2. Con un servidor que acepta la conexión y no contesta nunca, preguntar
//      qué está ocupado termina a los 10 segundos y sigue sin Google, como
//      cuando Google da error.
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

(async () => {
  // Una cuenta de servicio de mentira, con una clave de verdad para poder
  // firmar el pedido del token.
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { CONFIG } = require(path.join(RAIZ, "config"));
  CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "symphomed@prueba.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const axios = require(path.join(RAIZ, "node_modules", "axios"));
  const google = require(path.join(RAIZ, "services", "googleCalendar"));
  const CAL = "dra@gmail.com";
  const cita = { fecha: new Date(Date.UTC(2030, 4, 8, 14, 0)), duracionMinutos: 30, pacienteNombre: "Paciente", motivo: "" };

  console.log("── 1. Cada llamada sale con su timeout ──");
  const vistas = [];
  axios.defaults.adapter = async (config) => {
    vistas.push({ metodo: config.method, url: config.url, timeout: config.timeout });
    const data = config.url.includes("oauth2") ? { access_token: "token-de-prueba", expires_in: 3600 }
      : config.url.includes("freeBusy") ? { calendars: { [CAL]: { busy: [] } } }
      : { id: "evento-1" };
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
  await google.crearEvento(CAL, cita);
  await google.actualizarEvento(CAL, "evento-1", cita);
  await google.eliminarEvento(CAL, "evento-1");
  await google.obtenerOcupadoEnRango(CAL, cita.fecha, new Date(cita.fecha.getTime() + 3600000));
  const llamadas = ["post oauth2", "post /events", "patch /events/", "delete /events/", "post freeBusy"];
  for (const que of llamadas) {
    const [metodo, trozo] = que.split(" ");
    const vista = vistas.find(v => v.metodo === metodo && v.url.includes(trozo));
    verificar(`${que} → timeout ${vista?.timeout || 0} ms`, vista && vista.timeout > 0 && vista.timeout <= 10000);
  }

  console.log("\n── 2. Google acepta la conexión y no contesta nunca ──");
  // Un servidor local que se queda callado. Las llamadas van a parar ahí en
  // vez de a Google, por el adaptador http de siempre (el que aplica el
  // timeout de verdad).
  const callado = http.createServer(() => { /* nunca contesta */ });
  await new Promise((ok) => callado.listen(0, "127.0.0.1", ok));
  axios.defaults.adapter = "http";
  axios.interceptors.request.use((config) => {
    config.url = config.url.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${callado.address().port}`);
    config.proxy = false;
    return config;
  });
  const TOPE = 15000;
  const inicio = Date.now();
  const resultado = await Promise.race([
    google.obtenerOcupadoEnRango(CAL, cita.fecha, new Date(cita.fecha.getTime() + 3600000)),
    new Promise((ok) => setTimeout(() => ok("colgada"), TOPE)),
  ]);
  const ms = Date.now() - inicio;
  verificar(`preguntar qué está ocupado termina sin Google (${ms} ms) y la reserva sigue`,
    Array.isArray(resultado) && resultado.length === 0 && ms < TOPE);

  callado.closeAllConnections();
  callado.close();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
