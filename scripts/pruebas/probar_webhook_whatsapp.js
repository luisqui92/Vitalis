// Symphomed — Que el webhook de WhatsApp no le crea a cualquiera.
//
// ═══ QUÉ PASABA ANTES ══════════════════════════════════════════════════════
//
// /webhook/meta-whatsapp aceptaba cualquier POST y lo procesaba como si fuera
// un mensaje real de WhatsApp. Con el número de un paciente adentro del
// cuerpo, cualquiera podía:
//
//   - cancelarle la cita a ese paciente,
//   - llenarle la agenda al médico de reservas falsas,
//   - pisarle la conversación a alguien que estaba reservando,
//   - y hacernos gastar en IA sin límite, porque cada mensaje libre
//     llama al modelo.
//
// No hacía falta ningún token: solo saber la URL, que es pública por
// necesidad —Meta no puede iniciar sesión—.
//
// ═══ POR QUÉ ESTA PRUEBA ES ASÍ ════════════════════════════════════════════
//
// Lo que se prueba no es que la firma se calcule bien: eso lo hace crypto.
// Se prueba que un cuerpo SIN firma válida no llegue nunca a procesarse. Por
// eso el espía no mira la respuesta HTTP —un 200 o un 403 no dicen si algo se
// procesó por detrás—, sino si procesarWebhook llegó a correr.
//
// Ese es exactamente el error que tenía el código viejo: contestaba 200 y
// procesaba después. Una prueba que solo mirara el código de estado lo habría
// dado por bueno.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/prueba";
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-prueba";
const SECRETO = "secreto-de-prueba-de-meta";
process.env.WHATSAPP_APP_SECRET = SECRETO;

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// El mensaje que mandaría un atacante: "cancelar", a nombre de un paciente.
const CUERPO = JSON.stringify({
  entry: [{ changes: [{ value: {
    messages: [{ from: "59170000001", type: "text", text: { body: "cancelar" }, id: "wamid.PRUEBA" }],
  } }] }],
});

function firmar(cuerpo, secreto) {
  return "sha256=" + crypto.createHmac("sha256", secreto).update(Buffer.from(cuerpo)).digest("hex");
}

(async () => {
  // ─── El espía ───────────────────────────────────────────────────────────
  // Se reemplaza reservaCitas antes de que la ruta lo cargue. Si el mensaje
  // llega hasta acá, es que el webhook se lo creyó.
  let procesados = [];
  const rutaReserva = require.resolve(path.join(RAIZ, "services", "reservaCitas"));
  require.cache[rutaReserva] = {
    id: rutaReserva, filename: rutaReserva, loaded: true, exports: {
      procesarMensajeEntrante: async (numero, texto) => {
        procesados.push({ numero, texto });
        return null; // sin respuesta: no queremos que intente hablar con Meta
      },
    },
  };

  const app = express();
  // Igual que index.js: el cuerpo crudo solo para esta ruta. Si esto se
  // cambiara allá y acá no, la prueba pasaría y producción quedaría rota —
  // por eso más abajo se comprueba que index.js siga teniendo el verify.
  app.use(express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      if (String(req.originalUrl || "").startsWith("/webhook/meta-whatsapp")) req.cuerpoCrudo = buf;
    },
  }));
  require(path.join(RAIZ, "routes", "whatsappSalud"))(app);

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));

  const postear = (cuerpo, firma) => new Promise(res => {
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port,
      path: "/webhook/meta-whatsapp", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(cuerpo),
        ...(firma ? { "X-Hub-Signature-256": firma } : {}),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => res({ estado: r.statusCode, texto: t })); });
    req.on("error", () => res({ estado: 0 }));
    req.write(cuerpo);
    req.end();
  });

  // Procesar es asíncrono (se contesta 200 y se sigue por detrás), así que
  // hay que darle un respiro antes de afirmar que NO se procesó.
  const seProceso = async () => {
    await new Promise(r => setTimeout(r, 60));
    return procesados.length > 0;
  };

  console.log("── 1. Sin firma: el caso que estaba abierto ──");
  procesados = [];
  const sinFirma = await postear(CUERPO, null);
  verificar("lo rechaza con 403", sinFirma.estado === 403);
  verificar("y NO llegó a procesarse", !(await seProceso()));

  console.log("\n── 2. Con una firma inventada ──");
  procesados = [];
  const falsa = await postear(CUERPO, firmar(CUERPO, "otro-secreto"));
  verificar("lo rechaza con 403", falsa.estado === 403);
  verificar("y NO llegó a procesarse", !(await seProceso()));

  console.log("\n── 3. Firma válida pero de OTRO cuerpo ──");
  // El caso sutil: alguien intercepta una entrega real de Meta y le cambia el
  // número de teléfono, conservando la firma. Si el HMAC se calculara sobre
  // el cuerpo ya parseado y vuelto a serializar, esto pasaría.
  procesados = [];
  const otroCuerpo = JSON.stringify({
    entry: [{ changes: [{ value: {
      messages: [{ from: "59199999999", type: "text", text: { body: "cancelar" }, id: "wamid.OTRO" }],
    } }] }],
  });
  const cambiado = await postear(otroCuerpo, firmar(CUERPO, SECRETO));
  verificar("lo rechaza con 403", cambiado.estado === 403);
  verificar("y NO llegó a procesarse", !(await seProceso()));

  console.log("\n── 4. La entrega de verdad, firmada por Meta ──");
  procesados = [];
  const buena = await postear(CUERPO, firmar(CUERPO, SECRETO));
  verificar("contesta 200", buena.estado === 200);
  const llego = await seProceso();
  verificar("y SÍ se procesa", llego);
  verificar("con el número y el texto correctos",
    llego && procesados[0].numero === "59170000001" && procesados[0].texto === "cancelar");

  console.log("\n── 5. Sin el App Secret configurado ──");
  // Falla cerrado, como el webhook de Vapi. Si dejara pasar, el día que
  // alguien despliegue sin la variable el agujero volvería solo.
  const { CONFIG } = require(path.join(RAIZ, "config"));
  const guardado = CONFIG.WHATSAPP_APP_SECRET;
  CONFIG.WHATSAPP_APP_SECRET = "";
  procesados = [];
  const sinSecreto = await postear(CUERPO, firmar(CUERPO, SECRETO));
  verificar("contesta 503 y no adivina", sinSecreto.estado === 503);
  verificar("y NO procesa nada", !(await seProceso()));
  CONFIG.WHATSAPP_APP_SECRET = guardado;

  servidor.close();

  console.log("\n── 5b. Las notas de voz, y que nunca se quede mudo ──");
  // ═══ EL BUG QUE ESTO ATAJA ═══════════════════════════════════════════════
  //
  // Acá había un `return` pelado para todo lo que no fuera texto o botón. Un
  // paciente mandaba un audio —que es como escribe muchísima gente, y sobre
  // todo los pacientes mayores, que son los que más citas necesitan— y el bot
  // no contestaba NADA. Doble palomita y silencio. Para esa persona el
  // consultorio no atendía, y en el log no quedaba ni una línea.
  const ruta = require("fs").readFileSync(path.join(RAIZ, "routes", "whatsappSalud.js"), "utf8");

  verificar("los audios se transcriben en vez de descartarse",
    /msg\.type === "audio"/.test(ruta) && /escucharNotaDeVoz/.test(ruta));
  verificar("  ...con el motor que ya transcribe consultas", /transcribirNotaDeVoz/.test(ruta));
  // Lo que no es texto, botón ni audio tiene que contestar algo igual: el
  // silencio es la peor respuesta posible porque no se distingue de estar roto.
  verificar("una foto o una ubicación reciben respuesta, no silencio",
    !/return; \/\/ audio\/imagen/.test(ruta) &&
    /todavía no puedo abrir ese tipo de archivo/.test(ruta));

  // El orden importa: con el aviso DESPUÉS de transcribir, el paciente ve
  // silencio varios segundos, manda el audio otra vez, y se transcriben dos —
  // cobrando dos y contestando dos veces.
  const iAviso = ruta.indexOf("Estoy escuchando tu audio");
  const iBajar = ruta.indexOf("await bajarMedia(mediaId)");
  verificar("  ...y el «estoy escuchando» sale ANTES de transcribir",
    iAviso > 0 && iBajar > 0 && iAviso < iBajar);

  // Las tres formas de fallar tienen que terminar en un mensaje al paciente.
  verificar("un audio mudo se responde", /No llegué a escuchar nada/.test(ruta));
  verificar("un audio demasiado largo se responde", /un poco largo para mí/.test(ruta));
  verificar("y si la transcripción falla, también", /no pude escuchar tu audio/.test(ruta));
  verificar("el tope de duración es configurable", /WA_AUDIO_SEGUNDOS_MAX/.test(ruta));

  // Bajar el archivo de Meta son DOS pedidos, y el segundo también necesita el
  // token aunque la URL parezca pública. Sin la cabecera devuelve 401 y el
  // audio nunca llega.
  const meta = require("fs").readFileSync(path.join(RAIZ, "services", "metaWhatsapp.js"), "utf8");
  const bajada = meta.slice(meta.indexOf("async function bajarMedia"));
  verificar("la descarga manda el token en los dos pedidos",
    (bajada.match(/Bearer \$\{CONFIG\.WHATSAPP_TOKEN\}/g) || []).length >= 2);
  verificar("  ...y corta por tamaño antes de bajar el archivo",
    /if \(Number\(tam\) > TOPE_BYTES\)/.test(bajada));

  console.log("\n── 6. index.js sigue guardando el cuerpo crudo ──");
  // Sin el verify de express.json no hay bytes con los que comprobar el HMAC,
  // y TODO lo de arriba empezaría a dar 403 en producción aunque las pruebas
  // pasen: acá la ruta se monta con su propio express.json.
  const indice = require("fs").readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("express.json lleva verify", /express\.json\(\{[\s\S]{0,400}?verify:/.test(indice));
  verificar("y guarda req.cuerpoCrudo para el webhook",
    /cuerpoCrudo\s*=\s*buf/.test(indice) && /webhook\/meta-whatsapp/.test(indice));

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
