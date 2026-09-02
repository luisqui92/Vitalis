// Vitalis — Que en la teleconsulta se sepa quién habló, y no se adivine.
//
// En la consulta presencial las dos voces entran por el mismo micrófono y lo
// único que hay es la diarización: un modelo mirando timbres y decidiendo
// "acá cambió el hablante". Devuelve "A" y "B" sin saber cuál es el médico.
//
// En la teleconsulta hay algo mejor y hay que no desperdiciarlo: el micrófono
// del médico y el audio del paciente son dos fuentes distintas, se graban en
// canales separados, y entonces el canal 1 ES el médico. Un dato.
//
// Lo que se prueba acá es que esa cadena no se corte en ningún eslabón:
// que se pida multicanal, que NO se pida diarización encima, y que el canal
// se traduzca a la persona correcta.
process.env.ASSEMBLYAI_API_KEY = "clave-de-prueba";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const fs = require("fs");
const path = require("path");
const Module = require("module");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// AssemblyAI no se llama de verdad: se intercepta axios y se guarda con qué
// la habrían llamado. Lo que se prueba es QUÉ SE PIDE, no que ellos anden.
const pedidos = [];
let respuestaUtterances = [];
const cargarOriginal = Module.prototype.require;
Module.prototype.require = function (nombre) {
  if (nombre === "axios") {
    return {
      post: async (url, cuerpo) => {
        pedidos.push({ url, cuerpo });
        if (url.includes("/upload")) return { data: { upload_url: "https://falso/audio" } };
        return { data: { id: "trans-1" } };
      },
      get: async () => ({
        data: {
          status: "completed",
          text: "consulta de prueba",
          audio_duration: 120,
          utterances: respuestaUtterances,
        },
      }),
    };
  }
  return cargarOriginal.apply(this, arguments);
};

const { transcribirConsultaMedica } = require(path.join(RAIZ, "services", "assemblyai"));

(async () => {
  console.log("── 1. La teleconsulta pide dos canales, no diarización ──");
  pedidos.length = 0;
  respuestaUtterances = [
    { speaker: "A", channel: "1", text: "¿Qué le pasa?", start: 0, end: 2000 },
    { speaker: "B", channel: "2", text: "Me duele la cabeza", start: 2000, end: 5000 },
  ];
  const tele = await transcribirConsultaMedica(Buffer.from("audio"), "medicina_general", "es", { multicanal: true });
  const cuerpoTele = pedidos.find(p => p.url.includes("/transcript"))?.cuerpo || {};

  verificar("pide multichannel", cuerpoTele.multichannel === true);
  // Pedir diarización sobre un audio donde ya sabemos quién es quién es
  // pedirle al modelo que dude de un dato que ya tenemos. Además, la API no
  // acepta las dos cosas juntas.
  verificar("  ...y NO pide speaker_labels encima", !("speaker_labels" in cuerpoTele));
  verificar("  ...ni speaker_options", !("speaker_options" in cuerpoTele));

  console.log("\n── 2. El canal se traduce a la persona ──");
  verificar("canal 1 es el médico", tele.segmentos[0].quien === "medico");
  verificar("canal 2 es el paciente", tele.segmentos[1].quien === "paciente");
  verificar("  ...y el texto sigue siendo el suyo",
    tele.segmentos[1].texto === "Me duele la cabeza");

  console.log("\n── 3. La consulta presencial no cambió ──");
  pedidos.length = 0;
  respuestaUtterances = [{ speaker: "A", text: "hola", start: 0, end: 1000 }];
  const presencial = await transcribirConsultaMedica(Buffer.from("audio"), "medicina_general", "es");
  const cuerpoPres = pedidos.find(p => p.url.includes("/transcript"))?.cuerpo || {};

  verificar("sigue pidiendo speaker_labels", cuerpoPres.speaker_labels === true);
  verificar("  ...con el rango de hablantes", Boolean(cuerpoPres.speaker_options));
  verificar("  ...y NO pide multichannel", !("multichannel" in cuerpoPres));
  // Lo importante: no se inventa un "médico" sobre una adivinanza.
  verificar('el hablante queda vacío, no "medico"', presencial.segmentos[0].quien === "");
  verificar("  ...y se conserva la letra de la diarización",
    presencial.segmentos[0].hablante === "A");

  console.log("\n── 4. Un canal que no llega no se inventa ──");
  // Si el navegador grabó mono, o la respuesta no trae canal, es preferible
  // "no sé" antes que etiquetar de médico algo que dijo el paciente: ese es
  // el error que después nadie revisa, porque suena bien.
  pedidos.length = 0;
  respuestaUtterances = [
    { speaker: "A", text: "sin canal", start: 0, end: 1000 },
    { speaker: "B", channel: "7", text: "canal raro", start: 1000, end: 2000 },
  ];
  const roto = await transcribirConsultaMedica(Buffer.from("audio"), "medicina_general", "es", { multicanal: true });
  verificar("sin canal queda vacío", roto.segmentos[0].quien === "");
  verificar("un canal desconocido queda vacío", roto.segmentos[1].quien === "");
  verificar("  ...pero el texto se guarda igual, que es lo que importa",
    roto.transcripcionCompleta === "consulta de prueba" && roto.segmentos.length === 2);

  console.log("\n── 5. Las dos puntas de la convención coinciden ──");
  // El canal izquierdo es el médico porque grabacionTele.js lo conecta a la
  // entrada 0 del mezclador. Si alguien da vuelta una punta sin la otra, la
  // transcripción sale con los papeles cambiados y NADA falla: el médico lee
  // sus propias palabras atribuidas al paciente.
  const grab = fs.readFileSync(path.join(RAIZ, "public", "js", "grabacionTele.js"), "utf8");
  const medicoALaIzquierda = /pistasMedico\[0\]\]\)\)\.connect\(mezclador,\s*0,\s*0\)/.test(grab);
  const pacienteALaDerecha = /pistasPaciente\[0\]\]\)\)\.connect\(mezclador,\s*0,\s*1\)/.test(grab);
  verificar("el médico va al canal izquierdo (entrada 0)", medicoALaIzquierda);
  verificar("el paciente va al canal derecho (entrada 1)", pacienteALaDerecha);

  console.log("\n── 6. Sin las dos puntas no se graba ──");
  // Grabar solo al médico daría un audio donde el paciente no existe, y la
  // nota clínica saldría de media consulta sin que nada avise.
  verificar("no se graba sin audio del paciente",
    /if \(!pistasMedico\.length \|\| !pistasPaciente\.length\) return false;/.test(grab));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
