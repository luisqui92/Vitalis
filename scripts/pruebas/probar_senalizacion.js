// Symphomed — Que a la sala de señalización no entre un tercero.
//
// El audio y el video de una teleconsulta van directo entre los dos
// navegadores; por el servidor pasa solo el arranque de la negociación. Pero
// ese arranque es justamente lo que hace falta para conectarse: quien logre
// entrar a la señalización de una sala ajena puede negociar su propia
// conexión y quedar escuchando una consulta médica.
//
// Por eso se prueba lo mismo que en cualquier puerta: que sin llave no se
// entra, que la llave de una sala no abre otra, y que no entran más de dos.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
const { iniciarSenalizacion } = require(path.join(RAIZ, "services", "senalizacion"));
const video = require(path.join(RAIZ, "services", "video"));

let WebSocket;
try { ({ WebSocket } = require(path.join(RAIZ, "node_modules", "ws"))); }
catch { ({ WebSocket } = require("ws")); }

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Abre un socket y junta lo que llega. Resuelve con el objeto para poder
// mirar los mensajes después, sin carreras.
function conectar(puerto, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}/ws-tele?token=${encodeURIComponent(token || "")}`);
    const recibidos = [];
    let cerrado = null;
    ws.on("message", (d) => { try { recibidos.push(JSON.parse(d)); } catch { /* ruido */ } });
    ws.on("close", (codigo) => { cerrado = codigo; resolve({ ws, recibidos, cerrado: () => cerrado }); });
    ws.on("open", () => setTimeout(() => resolve({ ws, recibidos, cerrado: () => cerrado }), 120));
    ws.on("error", () => { /* el close que sigue resuelve */ });
  });
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const servidor = http.createServer();
  iniciarSenalizacion(servidor);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;

  const sala = video.nombreDeSala();
  const otraSala = video.nombreDeSala();
  const tkMedico = video.tokenDeSenal(sala, "medico");
  const tkPaciente = video.tokenDeSenal(sala, "paciente");

  console.log("── 1. Sin llave no se entra ──");
  const sinToken = await conectar(puerto, "");
  verificar("sin token se rechaza la conexión", sinToken.cerrado() === 4001);

  const inventado = await conectar(puerto, "esto.no.es.un.token");
  verificar("con un token inventado tampoco", inventado.cerrado() === 4001);

  // Un token de sesión de médico NO sirve acá: son cosas distintas y el
  // día que alguien las mezcle, un médico cualquiera entra a cualquier sala.
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const deMedicoComun = await conectar(puerto, generarToken("70000001", "medico", 36e5));
  verificar("un token de sesión de médico no abre la señalización", deMedicoComun.cerrado() === 4001);

  console.log("\n── 2. Los dos legítimos se encuentran ──");
  const medico = await conectar(puerto, tkMedico);
  verificar("el médico entra", medico.cerrado() === null);
  verificar("  ...y le dicen que espere, porque está solo",
    medico.recibidos.some(m => m.tipo === "esperando"));

  const paciente = await conectar(puerto, tkPaciente);
  await esperar(150);
  verificar("el paciente entra", paciente.cerrado() === null);
  verificar("  ...y a los dos se les avisa que ya están los dos",
    medico.recibidos.some(m => m.tipo === "listo") && paciente.recibidos.some(m => m.tipo === "listo"));

  // Uno solo arma la oferta, o las dos chocan y no conecta nunca.
  const quienesInician = [
    ...medico.recibidos.filter(m => m.tipo === "listo").map(m => m.iniciar),
    ...paciente.recibidos.filter(m => m.tipo === "listo").map(m => m.iniciar),
  ];
  verificar("  ...y UNO SOLO arranca la negociación",
    quienesInician.filter(Boolean).length === 1);

  console.log("\n── 3. Se relaya la negociación y nada más ──");
  medico.ws.send(JSON.stringify({ tipo: "oferta", sdp: { tipo: "prueba" } }));
  await esperar(150);
  verificar("la oferta del médico le llega al paciente",
    paciente.recibidos.some(m => m.tipo === "oferta"));

  // Un relay que reenvía cualquier cosa es un chat anónimo gratis montado
  // adentro de un sistema de historias clínicas.
  medico.ws.send(JSON.stringify({ tipo: "cualquier_cosa", texto: "hola" }));
  await esperar(150);
  verificar("un mensaje que no es de la negociación NO se relaya",
    !paciente.recibidos.some(m => m.tipo === "cualquier_cosa"));

  console.log("\n── 4. Un tercero no escucha ──");
  // La llave de otra sala no abre esta. Es el caso que importa: alguien con
  // una teleconsulta propia y legítima intentando entrar a la ajena.
  const intruso = await conectar(puerto, video.tokenDeSenal(otraSala, "paciente"));
  intruso.ws.send(JSON.stringify({ tipo: "oferta", sdp: { tipo: "intruso" } }));
  await esperar(150);
  verificar("un token de OTRA sala no recibe nada de esta",
    !intruso.recibidos.some(m => m.tipo === "oferta"));
  verificar("  ...y su oferta no llega a los de la sala legítima",
    !medico.recibidos.some(m => m.sdp?.tipo === "intruso") &&
    !paciente.recibidos.some(m => m.sdp?.tipo === "intruso"));

  console.log("\n── 5. Reconectar reemplaza, no duplica ──");
  // Se le cortó el wifi al paciente y vuelve. El socket viejo no sirve para
  // nada y dejarlo abierto solo confunde a quien está del otro lado.
  const pacienteOtraVez = await conectar(puerto, tkPaciente);
  await esperar(150);
  verificar("el socket anterior del paciente se cierra", paciente.cerrado() === 4002);
  verificar("  ...y el nuevo queda conectado", pacienteOtraVez.cerrado() === null);

  console.log("\n── 6. Al colgar se avisa al otro ──");
  pacienteOtraVez.ws.close();
  await esperar(200);
  verificar("el médico se entera de que el paciente se fue",
    medico.recibidos.some(m => m.tipo === "se_fue"));

  medico.ws.close();
  intruso.ws.close();
  await esperar(200);
  const { salasAbiertas } = require(path.join(RAIZ, "services", "senalizacion"));
  verificar("y la sala vacía se libera", salasAbiertas() === 0);

  await new Promise((r) => servidor.close(r));
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
