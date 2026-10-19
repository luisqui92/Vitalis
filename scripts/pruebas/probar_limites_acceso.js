// Symphomed — Los límites de la puerta: de qué IP viene un pedido y qué se
// cuenta (services/ratelimit.js).
//
// Lo que se prueba:
//   1. La IP es la que vio nginx (el último valor de X-Forwarded-For, con
//      «trust proxy» como en index.js), no la que escribe el cliente. Antes
//      se tomaba el primero, y cambiándolo en cada pedido se probaban
//      contraseñas sin límite (auditoría de QA, M1). Lo mismo para la IP que
//      queda guardada en el consentimiento de la teleconsulta, en el pedido
//      de reseteo y en el de baja.
//   2. Si nginx no manda X-Forwarded-For: un aviso en el log, una sola vez,
//      y X-Real-IP como respaldo.
//   3. En el login cuenta lo que sale mal: diez médicos de una misma clínica
//      entran seguidos desde la IP del router (M12), y quien prueba
//      contraseñas sigue frenado a los ocho errores, aunque los mande todos
//      a la vez.
//   4. El registro cuenta todo: lo que hay que frenar ahí es lo que entra a
//      la fila.
//   5. El login de los socios tiene límite por cuenta, como el del médico:
//      con muchas IPs no se prueban contraseñas sin tope contra un socio.
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
// cabeceras: las que llegarían desde nginx (o sin nginx, si no se ponen).
function pedir(puerto, metodo, ruta, { token, cuerpo, cabeceras = {} } = {}) {
  return new Promise((resolve) => {
    const headers = { ...cabeceras };
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
// Lo que arma nginx con $proxy_add_x_forwarded_for: lo que haya escrito el
// cliente, y al final la IP que vio de verdad.
const desde = (real, escritaPorElCliente) => ({ "x-forwarded-for": escritaPorElCliente ? `${escritaPorElCliente}, ${real}` : real });

// Los avisos del log, para ver el de «falta X-Forwarded-For». Antes de cargar
// nada: el aviso sale una sola vez por proceso.
const { log } = require(path.join(RAIZ, "config"));
const avisos = [];
const warnOriginal = log.warn;
log.warn = (...a) => { avisos.push(a.join(" ")); warnOriginal(...a); };

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "limites_acceso";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  const { getIP } = require(path.join(RAIZ, "services", "ratelimit"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  // Como index.js: un salto de proxy, el nginx propio.
  app.set("trust proxy", 1);
  app.use(express.json());
  for (const r of ["medicoAuth", "socio", "reseteoClave", "solicitudBaja", "teleconsulta"]) require(path.join(RAIZ, "routes", r))(app);
  app.get("/prueba-ip", (req, res) => res.json({ ip: getIP(req) }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, op) => pedir(servidor.address().port, m, ruta, op);

  const clave = await hashPassword("Prueba123.");

  console.log("── 1. La IP es la que vio nginx, no la que escribe el cliente ──");
  let r = await P("GET", "/prueba-ip", { cabeceras: desde("203.0.113.9", "1.2.3.4") });
  verificar("«1.2.3.4, 203.0.113.9» → 203.0.113.9 (la que agregó nginx)", r.cuerpo?.ip === "203.0.113.9");
  await M.Medico.create({ phone: "70081001", nombre: "Dra. Atacada", passwordHash: clave, activo: true });
  const estados = [];
  for (let i = 0; i < 12; i++) {
    r = await P("POST", "/medico/login", { cuerpo: { phone: "70081001", password: "mala" + i }, cabeceras: desde("203.0.113.9", `10.0.0.${i + 1}`) });
    estados.push(r.estado);
  }
  verificar(`cambiando lo que escribe el cliente en cada intento, el noveno ya choca con el límite (${estados.join(" ")})`,
    estados.slice(0, 8).every(e => e === 401) && estados.slice(8).every(e => e === 429));

  const tele = await M.Teleconsulta.create({ medicoPhone: "70081001", pacienteId: new mongoose.Types.ObjectId(),
    token: "t".repeat(40), tokenExpira: new Date(Date.now() + 36e5) });
  r = await P("POST", `/teleconsulta-publica/${tele.token}/consentimiento`, { cuerpo: { acepto: true }, cabeceras: desde("198.51.100.21", "6.6.6.6") });
  const teleEnBase = await M.Teleconsulta.findById(tele._id).lean();
  verificar("el consentimiento de la teleconsulta guarda la IP real", r.estado === 200 && teleEnBase.consentimiento.ip === "198.51.100.21");
  await M.Medico.create({ phone: "70081002", nombre: "Dr. Olvidadizo", passwordHash: clave, activo: true, estadoCuenta: "aprobada" });
  r = await P("POST", "/reseteo-clave/solicitar", { cuerpo: { telefono: "70081002" }, cabeceras: desde("198.51.100.22", "6.6.6.6") });
  const reseteo = await M.SolicitudReseteo.findOne({ telefono: "70081002" }).lean();
  verificar("el pedido de reseteo guarda la IP real", r.estado === 200 && reseteo?.ip === "198.51.100.22");
  await M.Medico.create({ phone: "70081003", nombre: "Dr. Se Va", passwordHash: clave, activo: true });
  r = await P("POST", "/medico/baja/solicitar", { token: generarToken("70081003", "medico", 36e5), cuerpo: {}, cabeceras: desde("198.51.100.23", "6.6.6.6") });
  const baja = await M.SolicitudBaja.findOne({ telefono: "70081003" }).lean();
  verificar("el pedido de baja guarda la IP real", r.estado === 200 && baja?.ip === "198.51.100.23");

  console.log("\n── 2. Sin X-Forwarded-For: aviso una vez, y X-Real-IP de respaldo ──");
  verificar("todavía no hubo ningún aviso (todo llegó con X-Forwarded-For)", !avisos.some(a => /sin X-Forwarded-For/.test(a)));
  r = await P("GET", "/prueba-ip", { cabeceras: { "x-real-ip": "198.51.100.30" } });
  verificar("desde esta máquina, sin X-Forwarded-For y con X-Real-IP → X-Real-IP (un nginx que pone solo esa)", r.cuerpo?.ip === "198.51.100.30");
  r = await P("GET", "/prueba-ip");
  verificar("sin ninguna de las dos → la de la conexión", r.cuerpo?.ip === "127.0.0.1");
  await P("GET", "/prueba-ip");
  const avisosXff = avisos.filter(a => /sin X-Forwarded-For/.test(a));
  verificar(`  ...y el aviso salió UNA vez (${avisosXff.length}), diciendo qué línea de nginx falta`,
    avisosXff.length === 1 && /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/.test(avisosXff[0]));
  r = await P("GET", "/prueba-ip", { cabeceras: { "x-forwarded-for": "198.51.100.31", "x-real-ip": "6.6.6.6" } });
  verificar("con X-Forwarded-For, X-Real-IP no cuenta", r.cuerpo?.ip === "198.51.100.31");

  console.log("\n── 3. En el login cuenta lo que sale mal ──");
  const CLINICA = "190.129.0.10";
  for (let i = 0; i < 10; i++) {
    await M.Medico.create({ phone: `7008200${i}`, nombre: `Dr. Consultorio ${i + 1}`, passwordHash: clave, activo: true });
  }
  const turno = [];
  for (let i = 0; i < 10; i++) turno.push((await P("POST", "/medico/login", { cuerpo: { phone: `7008200${i}`, password: "Prueba123." }, cabeceras: desde(CLINICA) })).estado);
  verificar(`diez médicos de la misma clínica entran seguidos desde la IP del router (${turno.join(" ")})`, turno.every(e => e === 200));
  const errores = [];
  for (let i = 0; i < 8; i++) errores.push((await P("POST", "/medico/login", { cuerpo: { phone: "70082000", password: "mala" + i }, cabeceras: desde(CLINICA) })).estado);
  r = await P("POST", "/medico/login", { cuerpo: { phone: "70082001", password: "Prueba123." }, cabeceras: desde(CLINICA) });
  verificar(`ocho errores desde esa IP (${errores.join(" ")}) → el siguiente, aunque esté bien, espera (429)`, errores.every(e => e === 401) && r.estado === 429);
  const aLaVez = await Promise.all(Array.from({ length: 14 }, (_, i) =>
    P("POST", "/medico/login", { cuerpo: { phone: "70082002", password: "mala" + i }, cabeceras: desde("198.51.100.40") })));
  const cuenta = (e) => aLaVez.filter(x => x.estado === e).length;
  verificar(`catorce errores A LA VEZ desde una IP → pasan ocho y el resto espera (${cuenta(401)} × 401, ${cuenta(429)} × 429)`,
    cuenta(401) === 8 && cuenta(429) === 6);

  console.log("\n── 4. El registro cuenta todo ──");
  const solicitudes = [];
  for (let i = 0; i < 9; i++) {
    solicitudes.push((await P("POST", "/medico/registro", { cuerpo: { phone: `7008300${i}`, nombre: "Dra. Nueva", password: "Prueba123.", matricula: "MP-1" }, cabeceras: desde("198.51.100.50") })).estado);
  }
  verificar(`ocho solicitudes aceptadas desde una IP y la novena espera (${solicitudes.join(" ")})`,
    solicitudes.slice(0, 8).every(e => e === 200) && solicitudes[8] === 429);

  console.log("\n── 5. El login de socios tiene límite por cuenta ──");
  await M.Socio.create({ phone: "72081001", nombre: "Distribuidora de Prueba", passwordHash: clave, activo: true });
  const contraSocio = [];
  for (let i = 0; i < 11; i++) {
    contraSocio.push((await P("POST", "/socio/login", { cuerpo: { phone: "72081001", password: "mala" + i }, cabeceras: desde(`198.51.101.${i + 1}`) })).estado);
  }
  verificar(`once contraseñas desde once IPs distintas → la undécima ya choca con el límite de la cuenta (${contraSocio.join(" ")})`,
    contraSocio.slice(0, 10).every(e => e === 401) && contraSocio[10] === 429);
  r = await P("POST", "/socio/login", { cuerpo: { phone: "72081002", password: "mala" }, cabeceras: desde("198.51.101.99") });
  verificar("  ...y frena solo a esa cuenta: otro socio sigue contestando", r.estado === 401);
  r = await P("POST", "/medico/login", { cuerpo: { phone: "72081001", password: "mala" }, cabeceras: desde("198.51.101.98") });
  verificar("  ...ni cierra la puerta del médico con el mismo número", r.estado === 401);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
