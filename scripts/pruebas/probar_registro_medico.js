// Symphomed — Lo que entra por el registro de médicos (POST /medico/registro).
//
// Lo que se prueba:
//   1. El nombre sale en los WhatsApp que reciben los pacientes desde el
//      número oficial: tiene tope de largo, solo letras y poco más, y nada que
//      WhatsApp convierta en enlace («clinica.com», «bit.ly/…», «wa.me/…»).
//      La especialidad tampoco puede tener enlaces, y se corta a 80
//      caracteres. Antes un nombre de tres mil caracteres con un enlace se
//      guardaba entero (auditoría de QA, B2).
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

// Cada pedido «desde nginx» con su propia IP (la app tiene «trust proxy» como
// index.js): el registro cuenta todo lo que entra (services/ratelimit.js), y
// acá no es el límite lo que se está mirando (eso es probar_limites_acceso.js).
let nIp = 0;
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = { "x-forwarded-for": `198.18.9.${(nIp++ % 250) + 1}` };
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

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "registro_medico";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico } = require(path.join(RAIZ, "db", "models"));
    await mongoose.connection.dropDatabase();
  await Medico.syncIndexes();

  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);

  let n = 0;
  const REG = (extra = {}) => ({
    phone: `700951${String(n++).padStart(2, "0")}`, nombre: "Dra. Fulana Pérez", password: "Prueba123.",
    matricula: "MP-4455", tipoEspecialidad: "medicina_general", ...extra,
  });
  const guardado = (phone) => Medico.findOne({ phone }).lean();

  console.log("── 1. El nombre no sirve de anzuelo ──");
  let datos = REG({ nombre: "Dr. Pérez " + "a".repeat(3000) + " https://phish.example/pago" });
  let r = await P("POST", "/medico/registro", null, datos);
  verificar(`un nombre de tres mil caracteres con un enlace → 400 (${r.estado}), y no se guarda`, r.estado === 400 && !(await guardado(datos.phone)));
  for (const nombre of ["Dr. Pérez pagos-clinicasur.com", "Turno bit.ly/3xYz", "Dra. Ana wa.me/59170000000", "Dr. Pérez www.pagos.com", "Dra. Ana 70000000"]) {
    datos = REG({ nombre });
    r = await P("POST", "/medico/registro", null, datos);
    verificar(`  «${nombre}» → 400 (${r.estado})`, r.estado === 400 && /nombre/i.test(r.cuerpo?.error || "") && !(await guardado(datos.phone)));
  }
  for (const nombre of ["Dra. Fulana Pérez (veterinaria)", "João D'Ávila", "J.C. Núñez-Ortega", "Dª Conceição"]) {
    datos = REG({ nombre });
    r = await P("POST", "/medico/registro", null, datos);
    verificar(`un nombre de verdad, «${nombre}» → 200 (${r.estado})`, r.estado === 200 && (await guardado(datos.phone))?.nombre === nombre);
  }
  datos = REG({ nombre: "Dra. Ana\nPérez" });
  r = await P("POST", "/medico/registro", null, datos);
  verificar("un salto de línea en el nombre queda como un espacio: no arma un renglón aparte en el mensaje",
    r.estado === 200 && (await guardado(datos.phone))?.nombre === "Dra. Ana Pérez");

  datos = REG({ especialidad: "Turnos en pagos-clinicasur.com/turno" });
  r = await P("POST", "/medico/registro", null, datos);
  verificar(`una especialidad con un enlace → 400 (${r.estado})`, r.estado === 400 && /especialidad/i.test(r.cuerpo?.error || "") && !(await guardado(datos.phone)));
  datos = REG({ especialidad: "Ginecología/Obstetricia" + " y más".repeat(5000) });
  r = await P("POST", "/medico/registro", null, datos);
  const larga = (await guardado(datos.phone))?.especialidad || "";
  verificar(`una especialidad de treinta mil caracteres se guarda cortada a 80 (${larga.length})`, r.estado === 200 && larga.length === 80 && larga.startsWith("Ginecología/Obstetricia"));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
