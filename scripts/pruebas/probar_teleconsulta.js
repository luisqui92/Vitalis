// Vitalis — Que no se pueda entrar a una teleconsulta sin consentir la grabación.
//
// Todo lo demás de este archivo es higiene. Lo que importa es una sola cosa:
// que el candado del consentimiento esté DEL LADO DEL SERVIDOR y no sea una
// casilla que la pantalla muestra y la ruta ignora.
//
// Grabar a un paciente sin que lo autorice no es un problema de formulario:
// esa grabación no es respaldo clínico, no es prueba, y en Brasil (LGPD) y
// en Bolivia es ilegal. Una prueba que confirme el candado hoy es lo que
// impide que dentro de seis meses alguien lo saque "para simplificar".
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
// Ya no hay proveedor de video: la llamada va directo entre los dos
// navegadores. Lo único que reparte el servidor es el token de señalización,
// y se cuenta más abajo.

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({
      host: "127.0.0.1", port: puerto, method: metodo, path: ruta,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(datos ? { "content-type": "application/json", "content-length": Buffer.byteLength(datos) } : {}),
      },
    }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(texto); } catch { /* algunos errores no son JSON */ }
        resolve({ estado: res.statusCode, cuerpo: json });
      });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

async function conseguirMongo() {
  if (process.env.MONGO_PRUEBAS) {
    const nombre = (process.env.MONGO_PRUEBAS.split("/").pop() || "").split("?")[0].toLowerCase();
    if (!/prueba|test/.test(nombre)) {
      console.error(`❌ MONGO_PRUEBAS apunta a "${nombre}", que no dice ser de prueba. No.`);
      process.exit(1);
    }
    return { uri: process.env.MONGO_PRUEBAS, detener: async () => {} };
  }
  let MongoMemoryServer;
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) return null;
  const s = await MongoMemoryServer.create();
  return { uri: s.getUri() + "vitalis_prueba", detener: () => s.stop() };
}

async function main() {
  const mongo = await conseguirMongo();
  if (!mongo) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar.");
    console.log("   Esto NO es un ✅: el candado del consentimiento quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const { Medico, Paciente, Teleconsulta } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  // Se cuenta cuántos tokens de señalización se reparten, sin cambiar lo que
  // hacen: un token es el derecho a entrar a la sala, así que "no se emitió
  // ninguno" es la forma de comprobar que el candado del consentimiento no
  // dejó pasar a nadie.
  //
  // Antes acá se sustituían crearSala/tokenDeEntrada/borrarSala, que eran de
  // cuando había un proveedor de video. Esas funciones ya no existen: los
  // reemplazos no los llamaba nadie y el contador daba 0 siempre — la prueba
  // pasaba sin poder fallar nunca, que es peor que no tenerla.
  const video = require(path.join(RAIZ, "services", "video"));
  const emitirTokenDeVerdad = video.tokenDeSenal;
  let tokensEmitidos = 0;
  video.tokenDeSenal = (sala, rol) => { tokensEmitidos++; return emitirTokenDeVerdad(sala, rol); };

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Uno", passwordHash: hash });
  await Medico.create({ phone: "70000002", nombre: "Dr. Dos", passwordHash: hash });
  const paciente = await Paciente.create({ medicoPhone: "70000001", nombre: "Juan Pérez" });
  const ajeno = await Paciente.create({ medicoPhone: "70000002", nombre: "Paciente Ajeno" });

  const tk = {
    uno: generarToken("70000001", "medico", 36e5),
    dos: generarToken("70000002", "medico", 36e5),
  };

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "teleconsulta"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const GET = (ruta, token) => pedir(puerto, "GET", ruta, token);
  const POST = (ruta, token, cuerpo) => pedir(puerto, "POST", ruta, token, cuerpo);

  console.log("── 1. Crear el enlace ──");
  const creada = await POST(`/medico/pacientes/${paciente._id}/teleconsulta`, tk.uno, {});
  verificar("el médico crea la teleconsulta", creada.estado === 201);
  const tele = creada.cuerpo.teleconsulta;
  verificar("  ...y recibe un enlace para mandarle al paciente", /^\/teleconsulta\/.{20,}/.test(tele.enlace || ""));
  verificar("  ...que arranca SIN consentimiento", tele.consentimiento.aceptado === false);

  // Dos toques al botón no dejan al paciente con tres links en el WhatsApp.
  const otraVez = await POST(`/medico/pacientes/${paciente._id}/teleconsulta`, tk.uno, {});
  verificar("tocar de nuevo devuelve la MISMA, no una segunda",
    otraVez.cuerpo?.yaExistia === true && String(otraVez.cuerpo.teleconsulta._id) === String(tele._id));

  const ajena = await POST(`/medico/pacientes/${ajeno._id}/teleconsulta`, tk.uno, {});
  verificar("no se puede abrir una teleconsulta con el paciente de otro", ajena.estado === 404);

  const tokenPublico = tele.enlace.split("/").pop();

  console.log("\n── 2. EL CANDADO: sin consentimiento no se entra ──");
  const sinConsentir = await POST(`/teleconsulta-publica/${tokenPublico}/entrar`, null, {});
  verificar("el paciente NO consigue token de sala sin aceptar la grabación", sinConsentir.estado === 403);
  verificar("  ...y se le dice por qué", /aceptar la grabación/i.test(sinConsentir.cuerpo?.error || ""));
  verificar("  ...y no se emitió ningún token", tokensEmitidos === 0);

  // El intento de saltearse la pantalla: mandar "acepto: false" y entrar.
  const fingido = await POST(`/teleconsulta-publica/${tokenPublico}/consentimiento`, null, { acepto: false });
  verificar("mandar acepto:false no consiente nada", fingido.estado === 400);
  verificar("  ...y sigue sin poder entrar",
    (await POST(`/teleconsulta-publica/${tokenPublico}/entrar`, null, {})).estado === 403);

  console.log("\n── 3. Lo que ve el paciente antes de aceptar ──");
  const vista = await GET(`/teleconsulta-publica/${tokenPublico}`);
  verificar("el enlace abre", vista.estado === 200);
  verificar("  ...con el texto que va a aceptar, a la vista",
    /grabada y transcrita/i.test(vista.cuerpo?.textoConsentimiento || ""));
  verificar("  ...y sin el teléfono del médico", !JSON.stringify(vista.cuerpo).includes("70000001"));

  console.log("\n── 4. Acepta y entra ──");
  const acepta = await POST(`/teleconsulta-publica/${tokenPublico}/consentimiento`, null, { acepto: true });
  verificar("acepta", acepta.estado === 200);

  const enBase = await Teleconsulta.findById(tele._id).lean();
  verificar("queda guardado CUÁNDO aceptó", Boolean(enBase.consentimiento.fecha));
  // Si mañana cambia la redacción, hay que poder mostrar la que aceptó esta
  // persona, no la de hoy.
  verificar("  ...y el TEXTO que aceptó, copiado", /grabada y transcrita/i.test(enBase.consentimiento.texto));

  const entra = await POST(`/teleconsulta-publica/${tokenPublico}/entrar`, null, {});
  verificar("ahora sí entra", entra.estado === 200 && Boolean(entra.cuerpo?.token));

  console.log("\n── 5. El médico entra a su sala ──");
  const medicoEntra = await POST(`/medico/teleconsulta/${tele._id}/entrar`, tk.uno, {});
  verificar("el médico entra", medicoEntra.estado === 200 && Boolean(medicoEntra.cuerpo?.token));
  verificar("  ...y le dice si el paciente ya consintió", medicoEntra.cuerpo?.consentimiento === true);
  const ajenoEntra = await POST(`/medico/teleconsulta/${tele._id}/entrar`, tk.dos, {});
  verificar("otro médico no entra a una sala que no es suya", ajenoEntra.estado === 404);

  console.log("\n── 6. Cuando termina, el enlace deja de servir ──");
  await POST(`/medico/teleconsulta/${tele._id}/terminar`, tk.uno, {});
  const despues = await POST(`/teleconsulta-publica/${tokenPublico}/entrar`, null, {});
  verificar("terminada, el enlace del paciente ya no abre la sala", despues.estado === 404);

  console.log("\n── 7. Un enlace vencido tampoco ──");
  // Un enlace de consulta que sirve para siempre es uno que alguien reenvía.
  const vieja = await Teleconsulta.create({
    medicoPhone: "70000001", pacienteId: paciente._id, pacienteNombre: "Juan Pérez",
    token: "vencido-" + "x".repeat(20), tokenExpira: new Date(Date.now() - 1000),
    salaNombre: "vit-vieja",
    consentimiento: { aceptado: true, fecha: new Date(), ip: "1.1.1.1", texto: "…" },
  });
  const conVencido = await POST(`/teleconsulta-publica/${vieja.token}/entrar`, null, {});
  verificar("vencido no entra, ni con consentimiento aceptado", conVencido.estado === 404);
  verificar("  ...y al abrirlo se le dice que venció",
    (await GET(`/teleconsulta-publica/${vieja.token}`)).cuerpo?.estado === "vencida");

  const inexistente = await GET("/teleconsulta-publica/noexiste" + "z".repeat(20));
  verificar("un enlace inventado no existe", inexistente.estado === 404);

  await new Promise((r) => servidor.close(r));
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongo.detener();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
