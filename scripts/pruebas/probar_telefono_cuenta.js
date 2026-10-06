// Symphomed — El teléfono de una cuenta, escrito como sea (services/telefono.js).
//
// Caso real: una médica de Brasil se registró con «++5511956544830» y después
// no podía entrar escribiendo «+5511956544830»: el sistema guardaba el
// teléfono tal cual se tipeó y lo buscaba igual.
//
// Lo que se prueba:
//   · al registrarse se guarda solo con dígitos, y lo que no es un teléfono
//     se rechaza;
//   · no se puede registrar dos veces el mismo número escrito distinto;
//   · se entra escribiendo el número de cualquier forma, también en las
//     cuentas viejas guardadas con «+»;
//   · el límite de intentos por cuenta no se esquiva alternando formas;
//   · «olvidé mi clave» encuentra la cuenta y guarda el teléfono de la CUENTA.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

let nPedido = 0;
function pedir(servidor, metodo, ruta, cuerpo, ip) {
  const ipFalsa = ip || `198.51.100.${(nPedido++ % 250) + 1}`;
  return new Promise((resolver) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: { "X-Forwarded-For": ipFalsa, ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}) },
    }, (res) => {
      let texto = "";
      res.on("data", (d) => { texto += d; });
      res.on("end", () => { let json = null; try { json = JSON.parse(texto); } catch { /* no era JSON */ } resolver({ estado: res.statusCode, cuerpo: json }); });
    });
    req.on("error", () => resolver({ estado: 0, cuerpo: null }));
    if (datos) req.write(datos);
    req.end();
  });
}

const { soloDigitos, formasDe } = require(path.join(RAIZ, "services", "telefono"));

(async () => {
  console.log("── 1. Normalizar ──");
  verificar("«++5511956544830» → «5511956544830»", soloDigitos("++5511956544830") === "5511956544830");
  verificar("«+55 (11) 95654-4830» → «5511956544830»", soloDigitos("+55 (11) 95654-4830") === "5511956544830");
  verificar("se busca tal cual, en dígitos y con «+»", JSON.stringify(formasDe("+5511956544830")) === JSON.stringify(["+5511956544830", "5511956544830"]));
  verificar("una cuenta de demostración «123-01» se sigue buscando tal cual", formasDe("123-01")[0] === "123-01");

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "telefono_prueba";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  require(path.join(RAIZ, "routes", "reseteoClave"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const { Medico, SolicitudReseteo } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const POST = (ruta, cuerpo, ip) => pedir(servidor, "POST", ruta, cuerpo, ip);
  const REGISTRO = { nombre: "Dra. Brasil", password: "Prueba123.", matricula: "CRM-SP 123", idioma: "pt" };

  console.log("\n── 2. Registrarse ──");
  let r = await POST("/medico/registro", { ...REGISTRO, phone: "++5511956544830" });
  verificar("con «++5511956544830» → se acepta", r.estado === 200);
  const guardada = await Medico.findOne({ nombre: "Dra. Brasil" }).lean();
  verificar("  ...y se guarda «5511956544830», solo dígitos", guardada?.phone === "5511956544830");
  r = await POST("/medico/registro", { ...REGISTRO, phone: "+55 11 95654-4830" });
  verificar("el mismo número escrito de otra forma → 409, ya registrado", r.estado === 409);
  await Medico.create({ phone: "+59170001111", nombre: "Dr. Viejo Con Más", passwordHash: await hashPassword("Prueba123."), activo: true, estadoCuenta: "aprobada" });
  r = await POST("/medico/registro", { ...REGISTRO, phone: "59170001111" });
  verificar("una cuenta vieja guardada con «+» también cuenta como registrada → 409", r.estado === 409);
  r = await POST("/medico/registro", { ...REGISTRO, phone: "mi celular" });
  verificar("algo que no es un teléfono → 400", r.estado === 400);

  console.log("\n── 3. Entrar, escribiéndolo como sea ──");
  await Medico.updateOne({ phone: "5511956544830" }, { $set: { activo: true, estadoCuenta: "aprobada" } });
  for (const forma of ["+5511956544830", "5511956544830", "++5511956544830", "+55 11 95654-4830"]) {
    r = await POST("/medico/login", { phone: forma, password: "Prueba123." });
    verificar(`«${forma}» → entra`, r.estado === 200 && !!r.cuerpo?.token);
  }
  r = await POST("/medico/login", { phone: "+5511956544830", password: "Equivocada1" });
  verificar("con la contraseña mal → 401, igual que siempre", r.estado === 401);
  r = await POST("/medico/login", { phone: "59170001111", password: "Prueba123." });
  verificar("la cuenta vieja guardada «+59170001111» entra escribiendo «59170001111»", r.estado === 200);
  r = await POST("/medico/login", { phone: "+59170001111", password: "Prueba123." });
  verificar("  ...y escribiendo «+59170001111», como siempre", r.estado === 200);

  console.log("\n── 4. El límite por cuenta no se esquiva cambiando la forma ──");
  // Cada intento desde otra IP, para que el límite por IP no tape lo que se prueba.
  const formas = ["+5511956544830", "5511956544830", "++5511956544830", "55 11 95654 4830"];
  let bloqueado = null;
  for (let i = 0; i < 12; i++) {
    r = await POST("/medico/login", { phone: formas[i % formas.length], password: "Equivocada1" }, `192.0.2.${i + 1}`);
    if (r.estado === 429 && bloqueado === null) bloqueado = i + 1;
  }
  verificar(`alternando cuatro formas, se bloquea igual (en el intento ${bloqueado})`, bloqueado !== null && bloqueado <= 11);

  console.log("\n── 5. «Olvidé mi clave» ──");
  r = await POST("/reseteo-clave/solicitar", { telefono: "+55 11 95654-4830" }, "192.0.2.200");
  const pedido = await SolicitudReseteo.findOne({ tipo: "medico" }).lean();
  verificar("encuentra la cuenta escrita de otra forma", r.estado === 200 && !!pedido);
  verificar("  ...y el pedido guarda el teléfono de la CUENTA, para aplicarlo después", pedido?.telefono === "5511956544830");

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
