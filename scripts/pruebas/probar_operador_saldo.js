// Vitalis — Los candados de la pantalla que fabrica dinero.
//
// Todo lo demás del sistema lee o escribe datos clínicos. Esto EMITE SALDO:
// quien llegue puede darse plata infinita, y el fraude no se ve como un error
// sino como una recarga más entre otras.
//
// Lo que se verifica acá no es que la pantalla funcione — es que NO funcione
// para quien no corresponde. Contra la app real y una base descartable,
// porque los candados viven en middlewares que no existen fuera de Express.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.PRECIO_CONSULTA_CENTAVOS = "1200";
process.env.RECARGA_MINIMA_CENTAVOS = "10000";
// Los dos que pueden acreditar. Todo el resto del sistema no debería poder,
// por más admin de clínica o director que sea.
process.env.OPERADORES_SALDO = "70000001, 70000002";

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
        resolve({ estado: res.statusCode, cuerpo: json, texto });
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
    console.log("   MONGO_PRUEBAS=... o npm i --no-save mongodb-memory-server");
    console.log("   Esto NO es un ✅: la pantalla que emite saldo quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const { Medico, MovimientoSaldo, Clinica } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await MovimientoSaldo.init();

  const hash = await hashPassword("Prueba123.");
  const clinica = await Clinica.create({ nombre: "Clínica X" });
  const con2fa = { activo: true, secreto: "SECRETO", secretoPendiente: "" };

  // El operador como debe ser: en la lista Y con segundo factor.
  await Medico.create({ phone: "70000001", nombre: "Luis (operador)", passwordHash: hash, dosFA: con2fa });
  // En la lista pero SIN 2FA: no tiene que poder.
  await Medico.create({ phone: "70000002", nombre: "Ana (operadora sin 2FA)", passwordHash: hash });
  // Un médico común, con 2FA — tener 2FA no convierte a nadie en operador.
  await Medico.create({ phone: "70000003", nombre: "Dr. Común", passwordHash: hash, dosFA: con2fa });
  // El administrador de una clínica: manda sobre siete consultorios y aun así
  // no puede emitir un centavo.
  await Medico.create({ phone: "70000004", nombre: "Admin de clínica", passwordHash: hash, rol: "admin", clinicaId: clinica._id, dosFA: con2fa });
  // El destinatario de las recargas.
  await Medico.create({ phone: "79999999", nombre: "Dra. Destino", passwordHash: hash, tipoEspecialidad: "ginecologia" });

  const tk = {
    operador: generarToken("70000001", "medico", 36e5),
    sin2fa: generarToken("70000002", "medico", 36e5),
    comun: generarToken("70000003", "medico", 36e5),
    adminClinica: generarToken("70000004", "admin", 36e5, { admin: true, clinicaId: String(clinica._id) }),
    destino: generarToken("79999999", "medico", 36e5),
  };

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "operadorSaldo"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const GET = (ruta, token) => pedir(puerto, "GET", ruta, token);
  const POST = (ruta, token, cuerpo) => pedir(puerto, "POST", ruta, token, cuerpo);

  const acreditar = (token, cuerpo) => POST("/medico/operador/acreditar", token, cuerpo);

  console.log("── 1. Quién NO puede emitir saldo ──");
  // El administrativo de clínica no llega ni al chequeo de operador: lo frena
  // antes requireAuth(["medico"]), con un 403. Está igual de bloqueado, y por
  // eso acá se acepta cualquiera de los dos códigos — lo que importa es que
  // no acredite, no con qué número se le dice que no.
  for (const [quien, token] of [
    ["un médico común", tk.comun],
    ["el administrador de una clínica", tk.adminClinica],
    ["el propio médico que recibe", tk.destino],
  ]) {
    const r = await acreditar(token, { phone: "79999999", bolivianos: 200, referencia: "intento " + quien });
    verificar(`${quien} no puede acreditar (${r.estado})`, r.estado === 404 || r.estado === 403);
  }
  const sinToken = await acreditar(null, { phone: "79999999", bolivianos: 200, referencia: "sin token" });
  verificar("sin sesión tampoco", sinToken.estado === 401);
  verificar("y a nadie se le confirma que la pantalla existe (404, no 403)",
    (await GET("/medico/operador/buscar?q=dra", tk.comun)).estado === 404);
  verificar("no se acreditó ni un centavo en el intento",
    await MovimientoSaldo.countDocuments({}) === 0);

  console.log("\n── 2. Estar en la lista no alcanza: hace falta 2FA ──");
  const r2 = await acreditar(tk.sin2fa, { phone: "79999999", bolivianos: 200, referencia: "sin segundo factor" });
  verificar("un operador sin 2FA es rechazado", r2.estado === 403);
  verificar("  ...y se le dice que lo active", r2.cuerpo?.requiere2fa === true);
  const est2 = await GET("/medico/operador/estado", tk.sin2fa);
  verificar("  ...la pantalla se entera antes de que escriba nada",
    est2.cuerpo?.operador === true && est2.cuerpo?.dosFAActivo === false);
  verificar("y sigue sin haber movimientos", await MovimientoSaldo.countDocuments({}) === 0);

  console.log("\n── 3. El operador de verdad sí puede ──");
  const est = await GET("/medico/operador/estado", tk.operador);
  verificar("se reconoce como operador", est.cuerpo?.operador === true && est.cuerpo?.dosFAActivo === true);
  const estComun = await GET("/medico/operador/estado", tk.comun);
  verificar("y a un médico común le dice que no, sin ruido", estComun.estado === 200 && estComun.cuerpo?.operador === false);

  const ok = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "QR BCP 1111" });
  verificar("acredita Bs 200", ok.estado === 200 && ok.cuerpo?.saldoCentavos === 20000);
  verificar("  ...y devuelve para cuántas consultas alcanza", ok.cuerpo?.consultasRestantes === 16);

  const mov = await MovimientoSaldo.findOne({ medicoPhone: "79999999" }).lean();
  verificar("el movimiento guarda QUIÉN acreditó, con su teléfono", mov.acreditadoPor === "70000001");
  verificar("  ...y contra qué referencia", mov.referencia === "QR BCP 1111");

  console.log("\n── 4. Las mismas reglas que por consola ──");
  // Un segundo camino para crear plata con reglas distintas es cómo aparecen
  // los agujeros. Estas rutas reusan services/saldo.js sin atajos.
  const repetida = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "qr bcp  1111" });
  verificar("la misma referencia se rechaza, aunque venga escrita distinto", repetida.estado === 409);
  verificar("  ...diciendo cuándo se acreditó la primera", /ya se acreditó/.test(repetida.cuerpo?.error || ""));

  const chica = await acreditar(tk.operador, { phone: "79999999", bolivianos: 50, referencia: "QR chico" });
  verificar("por debajo del mínimo frena", chica.estado === 422);
  const chicaIgual = await acreditar(tk.operador, { phone: "79999999", bolivianos: 50, referencia: "QR chico", igual: true });
  verificar("  ...pero se puede autorizar igual", chicaIgual.estado === 200 && chicaIgual.cuerpo?.saldoCentavos === 25000);

  const sinRef = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "  " });
  verificar("sin referencia no acredita, y con un error legible y no un 500",
    sinRef.estado === 400 && /referencia/i.test(sinRef.cuerpo?.error || ""));
  const negativa = await acreditar(tk.operador, { phone: "79999999", bolivianos: -500, referencia: "negativa" });
  verificar("un monto negativo tampoco", negativa.estado === 400);
  const inexistente = await acreditar(tk.operador, { phone: "70009999", bolivianos: 200, referencia: "a nadie" });
  verificar("a una cuenta que no existe tampoco", inexistente.estado === 404);

  console.log("\n── 5. El techo por operación ──");
  // No protege de un operador deshonesto, que puede hacer varias cargas. Sí
  // del dedo que se resbala y convierte Bs 200 en Bs 200000.
  const enorme = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200000, referencia: "dedo resbalado" });
  verificar("Bs 200.000 de una sola vez se rechaza", enorme.estado === 400);
  verificar("  ...y el saldo quedó donde estaba",
    (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === 25000);

  console.log("\n── 6. Un operador de recargas no ve historias clínicas ──");
  const busca = await GET("/medico/operador/buscar?q=destino", tk.operador);
  const encontrado = busca.cuerpo?.medicos?.[0];
  verificar("la búsqueda encuentra por nombre", encontrado?.phone === "79999999");
  const campos = new Set(Object.keys(encontrado || {}));
  const prohibidos = ["passwordHash", "dosFA", "pacientes", "consultas", "clinicaId"];
  const filtrados = prohibidos.filter(c => campos.has(c));
  verificar(
    filtrados.length === 0 ? "y devuelve identidad y saldo, nada más" : `DEVUELVE DE MÁS: ${filtrados.join(", ")}`,
    filtrados.length === 0
  );
  verificar("ni el hash de la contraseña aparece en el JSON crudo", !busca.texto.includes("passwordHash"));

  await new Promise((r) => servidor.close(r));
  await new Promise((r) => setTimeout(r, 400));
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
