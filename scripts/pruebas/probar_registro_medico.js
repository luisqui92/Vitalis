// Symphomed — Lo que entra por el registro de médicos (POST /medico/registro).
//
// Lo que se prueba:
//   1. El nombre sale en los WhatsApp que reciben los pacientes desde el
//      número oficial: tiene tope de largo, solo letras y poco más, y nada que
//      WhatsApp convierta en enlace («clinica.com», «bit.ly/…», «wa.me/…»).
//      La especialidad tampoco puede tener enlaces, y se corta a 80
//      caracteres. Antes un nombre de tres mil caracteres con un enlace se
//      guardaba entero (auditoría de QA, B2).
//   2. Un teléfono con una solicitud RECHAZADA se puede volver a pedir: antes
//      el dueño real del número recibía 409 para siempre. Una pendiente, una
//      cuenta en uso o una cuenta de antes de la fila siguen dando 409.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.OPERADORES_SALDO = "70095009";

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
  const { Medico, AuditLog } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Medico.syncIndexes();

  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  require(path.join(RAIZ, "routes", "solicitudesCuenta"))(app);
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

  console.log("\n── 2. Un teléfono rechazado se puede volver a pedir ──");
  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70095009", nombre: "Quien Aprueba", passwordHash: hash, activo: true, dosFA: { activo: true, secreto: "X" } });
  const tkAprobador = generarToken("70095009", "medico", 3600 * 1000);

  // Alguien pide cuenta con el número de otra persona, y se rechaza.
  const ajeno = REG({ nombre: "Dr. Impostor", password: "DelOtro123." });
  r = await P("POST", "/medico/registro", null, ajeno);
  r = await P("POST", `/medico/solicitudes-cuenta/${ajeno.phone}/rechazar`, tkAprobador, { motivo: "El teléfono no es suyo" });
  verificar("la solicitud con el número ajeno se rechaza", r.estado === 200 && (await guardado(ajeno.phone))?.estadoCuenta === "rechazada");
  // El dueño real del número pide la suya.
  r = await P("POST", "/medico/registro", null, { ...ajeno, nombre: "Dra. Verdadera", password: "LaMia1234." });
  const filas = await Medico.find({ phone: ajeno.phone }).lean();
  verificar(`el dueño real ya no recibe 409: su solicitud entra (${r.estado})`, r.estado === 200 && r.cuerpo?.pendiente === true);
  verificar("  ...y queda UNA sola fila, la nueva, pendiente y apagada",
    filas.length === 1 && filas[0].nombre === "Dra. Verdadera" && filas[0].estadoCuenta === "pendiente" && filas[0].activo === false);
  r = await P("POST", "/medico/login", null, { phone: ajeno.phone, password: "DelOtro123." });
  verificar("  ...la contraseña del que fue rechazado ya no sirve (401)", r.estado === 401);
  r = await P("POST", "/medico/login", null, { phone: ajeno.phone, password: "LaMia1234." });
  verificar("  ...y con la suya se le dice que está en revisión (403)", r.estado === 403 && /revisión/i.test(r.cuerpo?.error || ""));
  r = await P("GET", "/medico/solicitudes-cuenta", tkAprobador);
  verificar("  ...y aparece en la fila de quien aprueba", (r.cuerpo?.pendientes || []).some(s => s.phone === ajeno.phone && s.nombre === "Dra. Verdadera"));
  // La auditoría se escribe sin esperarla (services/auditoria.js).
  let rastro = null;
  for (let i = 0; i < 50 && !rastro; i++) {
    rastro = await AuditLog.findOne({ medicoPhone: ajeno.phone, accion: "solicitud_cuenta", detalle: /reemplaza la rechazada/ }).lean();
    if (!rastro) await new Promise((ok) => setTimeout(ok, 20));
  }
  verificar("  ...y lo de la rechazada queda en la auditoría: quién la rechazó y por qué",
    /70095009/.test(rastro?.detalle || "") && /no es suyo/.test(rastro?.detalle || ""));

  const pendiente = REG({ nombre: "Dra. Esperando" });
  await P("POST", "/medico/registro", null, pendiente);
  const antes = await guardado(pendiente.phone);
  r = await P("POST", "/medico/registro", null, { ...pendiente, nombre: "Dr. Otro", password: "Otra12345." });
  const despues = await guardado(pendiente.phone);
  verificar(`una solicitud PENDIENTE no se pisa: 409 (${r.estado}), y sigue con su nombre y su contraseña`,
    r.estado === 409 && despues.nombre === "Dra. Esperando" && despues.passwordHash === antes.passwordHash);

  await Medico.create({ phone: "70095201", nombre: "Dr. En Uso", passwordHash: hash, activo: true, estadoCuenta: "aprobada" });
  r = await P("POST", "/medico/registro", null, REG({ phone: "70095201" }));
  verificar(`una cuenta en uso → 409 (${r.estado})`, r.estado === 409 && (await guardado("70095201"))?.nombre === "Dr. En Uso");
  // Las de antes de la fila no tienen estadoCuenta guardado.
  await Medico.collection.insertOne({ phone: "70095202", nombre: "Dr. De Siempre", passwordHash: hash, activo: true });
  r = await P("POST", "/medico/registro", null, REG({ phone: "70095202" }));
  verificar(`una cuenta de antes de la fila → 409 (${r.estado})`, r.estado === 409 && (await guardado("70095202"))?.nombre === "Dr. De Siempre");
  // Una cuenta vieja con «+», en uso, y una rechazada sin «+»: el número no está libre.
  await Medico.create({ phone: "+59170095203", nombre: "Dra. Con Más", passwordHash: hash, activo: true, estadoCuenta: "aprobada" });
  await Medico.create({ phone: "59170095203", nombre: "Dr. Rechazado", passwordHash: hash, activo: false, estadoCuenta: "rechazada" });
  r = await P("POST", "/medico/registro", null, REG({ phone: "59170095203" }));
  verificar(`con una rechazada y una en uso con «+» del mismo número → 409 (${r.estado}), y no se borra nada`,
    r.estado === 409 && (await Medico.countDocuments({ phone: { $in: ["59170095203", "+59170095203"] } })) === 2);

  await Medico.create({ phone: "70095204", nombre: "Dr. Rechazado", passwordHash: hash, activo: false, estadoCuenta: "rechazada", solicitud: { motivo: "x" } });
  const aLaVez = await Promise.all(["Dra. Una", "Dra. Otra"].map(nombre => P("POST", "/medico/registro", null, REG({ phone: "70095204", nombre }))));
  const estados = aLaVez.map(x => x.estado).sort().join(", ");
  verificar(`dos que vuelven a pedir el mismo número rechazado a la vez → entra una y la otra recibe 409, no 500 (${estados})`,
    estados === "200, 409" && (await Medico.countDocuments({ phone: "70095204" })) === 1);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
