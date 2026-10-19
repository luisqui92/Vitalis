// Symphomed — Que la puerta no delate quién tiene cuenta, y que un código de
// 2FA sirva una sola vez.
//
// Lo que se prueba:
//   1. El login corre bcrypt aunque el teléfono no exista, y aunque la cuenta
//      tenga el hash viejo (SHA-256). Antes un teléfono sin cuenta contestaba
//      en 1 ms y uno con cuenta en 250: midiendo el tiempo se armaba la lista
//      de médicos (auditoría de QA, B-L2). Lo mismo en el login de socios.
//      Se cuenta cuántas veces se llama a bcrypt, que no depende de lo rápida
//      que sea la máquina.
//   2. Un código de 2FA sirve UNA vez: ni con el mismo pase, ni con otro, ni
//      dos a la vez. El código con que se activó el 2FA tampoco sirve para
//      entrar (B-L3).
//   3. /medico/registro-estudiante no dice si un teléfono tiene cuenta a quien
//      no tiene un código válido. Antes, con un código inventado, contestaba
//      409 «ya tiene una cuenta» a un teléfono registrado y 400 a uno libre.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
// Cada pedido «desde nginx» con su propia IP (la app tiene «trust proxy» como
// index.js): acá se prueban errores a propósito, y no es el límite por IP lo
// que se está mirando (eso es probar_limites_acceso.js).
let nIp = 0;
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = { "x-forwarded-for": `198.18.7.${(nIp++ % 250) + 1}` };
    if (token) headers.authorization = "Bearer " + token;
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// bcrypt, contado: cada compare que hace el login.
const bcrypt = require(path.join(RAIZ, "node_modules", "bcryptjs"));
let compares = 0;
const compareOriginal = bcrypt.compare;
bcrypt.compare = (...a) => { compares++; return compareOriginal(...a); };

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "login_seguro";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { CodigoEstudiante } = require(path.join(RAIZ, "modulos", "estudiantes", "modelos"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { totp, generarSecreto } = require(path.join(RAIZ, "services", "totp"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  for (const r of ["medicoAuth", "socio"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);

  const clave = await hashPassword("Prueba123.");
  const crypto = require("crypto");

  console.log("── 1. Exista o no la cuenta, el login tarda lo mismo ──");
  await M.Medico.create({ phone: "70094001", nombre: "Dra. Existe", passwordHash: clave, activo: true });
  // Una cuenta de antes de bcrypt: el hash viejo, SHA-256 en hex.
  await M.Medico.create({ phone: "70094002", nombre: "Dr. De Antes", activo: true,
    passwordHash: crypto.createHash("sha256").update("Vieja123.").digest("hex") });
  let antes = compares;
  let r = await P("POST", "/medico/login", null, { phone: "70094999", password: "loquesea" });
  verificar(`un teléfono SIN cuenta → 401, y bcrypt corre igual (${compares - antes} vez)`, r.estado === 401 && compares - antes === 1);
  antes = compares;
  const conCuenta = await P("POST", "/medico/login", null, { phone: "70094001", password: "loquesea" });
  verificar("  ...con cuenta y la clave mal → el mismo 401, el mismo mensaje y también una vez",
    conCuenta.estado === 401 && conCuenta.cuerpo?.error === r.cuerpo?.error && compares - antes === 1);
  antes = compares;
  r = await P("POST", "/medico/login", null, { phone: "70094002", password: "loquesea" });
  verificar(`una cuenta con el hash viejo y la clave mal → 401, y bcrypt corre igual (${compares - antes} vez): no contesta más rápido`, r.estado === 401 && compares - antes === 1);
  r = await P("POST", "/medico/login", null, { phone: "70094002", password: "Vieja123." });
  const migrada = await M.Medico.findOne({ phone: "70094002" }).lean();
  verificar("  ...y con la clave bien entra, y el hash pasa a bcrypt como siempre", r.estado === 200 && /^\$2/.test(migrada.passwordHash));
  await M.Socio.create({ phone: "72094001", nombre: "Distribuidora", passwordHash: clave, activo: true });
  antes = compares;
  r = await P("POST", "/socio/login", null, { phone: "72094999", password: "loquesea" });
  verificar(`el login de socios, con un teléfono sin cuenta → 401 y bcrypt corre igual (${compares - antes} vez)`, r.estado === 401 && compares - antes === 1);
  r = await P("POST", "/socio/login", null, { phone: "72094001", password: "Prueba123." });
  verificar("  ...y el socio de verdad entra", r.estado === 200 && !!r.cuerpo?.token);

  console.log("\n── 2. Un código de 2FA sirve una sola vez ──");
  const secreto = generarSecreto();
  await M.Medico.create({ phone: "70094010", nombre: "Dr. Con 2FA", passwordHash: clave, activo: true, dosFA: { activo: true, secreto } });
  const pase = async () => (await P("POST", "/medico/login", null, { phone: "70094010", password: "Prueba123." })).cuerpo?.tempToken;
  // El código se calcula UNA vez y se reusa tal cual: es lo que haría quien
  // lo vio por encima del hombro.
  const codigo = totp(secreto);
  const pase1 = await pase();
  r = await P("POST", "/medico/login/2fa", null, { tempToken: pase1, codigo });
  verificar("la primera vez → entra", r.estado === 200 && !!r.cuerpo?.token);
  r = await P("POST", "/medico/login/2fa", null, { tempToken: pase1, codigo });
  verificar("el mismo código otra vez, con el mismo pase → 401", r.estado === 401 && /ya se usó/.test(r.cuerpo?.error || ""));
  r = await P("POST", "/medico/login/2fa", null, { tempToken: await pase(), codigo });
  verificar("  ...ni con un pase nuevo (otra contraseña bien escrita)", r.estado === 401);
  // La auditoría se escribe sin esperarla (services/auditoria.js).
  let intentos = 0;
  for (let i = 0; i < 50 && !intentos; i++) {
    intentos = await M.AuditLog.countDocuments({ medicoPhone: "70094010", accion: "login_2fa_repetido" });
    if (!intentos) await new Promise((ok) => setTimeout(ok, 20));
  }
  verificar("  ...y queda en la actividad de la cuenta como código repetido", intentos >= 1);

  const secreto2 = generarSecreto();
  await M.Medico.create({ phone: "70094011", nombre: "Dra. Dos Pestañas", passwordHash: clave, activo: true, dosFA: { activo: true, secreto: secreto2 } });
  const [pA, pB] = await Promise.all([1, 2].map(async () => (await P("POST", "/medico/login", null, { phone: "70094011", password: "Prueba123." })).cuerpo?.tempToken));
  const codigo2 = totp(secreto2);
  const aLaVez = await Promise.all([pA, pB].map(t => P("POST", "/medico/login/2fa", null, { tempToken: t, codigo: codigo2 })));
  verificar(`el mismo código, dos a la vez → entra UNO (${aLaVez.map(x => x.estado).sort().join(", ")})`, aLaVez.map(x => x.estado).sort().join() === "200,401");

  await M.Medico.create({ phone: "70094012", nombre: "Dr. Recién Activa", passwordHash: clave, activo: true });
  const tkActiva = generarToken("70094012", "medico", 36e5);
  r = await P("POST", "/medico/2fa/iniciar", tkActiva, {});
  const codigoActivacion = totp(r.cuerpo.secreto);
  r = await P("POST", "/medico/2fa/confirmar", tkActiva, { codigo: codigoActivacion });
  verificar("activar el 2FA con un código → 200", r.estado === 200);
  r = await P("POST", "/medico/login/2fa", null, {
    tempToken: (await P("POST", "/medico/login", null, { phone: "70094012", password: "Prueba123." })).cuerpo?.tempToken, codigo: codigoActivacion });
  verificar("  ...y ese mismo código ya no sirve para entrar", r.estado === 401);

  console.log("\n── 3. El registro de estudiantes no delata teléfonos ──");
  const vence = new Date(Date.now() + 30 * 86400000);
  await CodigoEstudiante.create({ codigo: "EST-AAAA11", nivel: "interno", meses: 6, horasMes: 6, vence });
  const REG = (codigo, phone) => ({ codigo, phone, nombre: "Ana Interna", password: "Prueba123.", universidad: "Univalle" });
  const registrado = await P("POST", "/medico/registro-estudiante", null, REG("EST-INVENT", "70094001"));
  const libre = await P("POST", "/medico/registro-estudiante", null, REG("EST-INVENT", "70094888"));
  verificar(`con un código inventado, un teléfono CON cuenta contesta igual que uno libre (${registrado.estado} y ${libre.estado})`,
    registrado.estado === 400 && libre.estado === 400 && registrado.cuerpo?.error === libre.cuerpo?.error);
  r = await P("POST", "/medico/registro-estudiante", null, REG("EST-AAAA11", "70094001"));
  verificar("  ...con un código válido, sí se le dice que ya tiene cuenta (409), y el código no se gasta",
    r.estado === 409 && !(await CodigoEstudiante.findOne({ codigo: "EST-AAAA11" }).lean()).usadoPor);
  r = await P("POST", "/medico/registro-estudiante", null, REG("EST-AAAA11", "59170094002"));
  verificar("  ...y con un código válido y un teléfono libre, entra", r.estado === 200 && !!r.cuerpo?.token);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
