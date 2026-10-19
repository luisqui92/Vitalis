// Symphomed — Los signos vitales y las recetas ópticas tienen rangos.
//
// routes/mediciones.js solo revisaba que el valor fuera un número: entraban
// una SpO₂ de 300, un peso de −5, un Infinity, una presión 80/120 o un tipo
// inventado, y de ahí a la curva y a las alertas. En las recetas ópticas el
// eje solo tenía el min/max del HTML, que el navegador no hace cumplir, y
// salía un eje de 500° impreso (auditoría de QA, M3). Lo que se prueba:
//   1. Mediciones fuera de lo posible → 400, y no se guardan.
//   2. Lo raro pero real se sigue guardando: un ave, un prematuro, una
//      hipotermia grave, una bradicardia fetal.
//   3. Recetas ópticas fuera de rango → 400; un lactante y una adición de
//      baja visión, no.
//   4. La pantalla muestra el error del servidor (antes se lo tragaba).
const path = require("path");
const fs = require("fs");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.setTimeout(10000, () => req.destroy(new Error("sin respuesta")));
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  console.log("── 0. La tabla de tipos ──");
  const { TIPOS_MEDICION } = require(path.join(RAIZ, "services", "medicionesTipos"));
  const sinRango = Object.entries(TIPOS_MEDICION)
    .filter(([, m]) => !Array.isArray(m.rango) || !(m.rango[0] < m.rango[1]) || (m.doble && !(m.rangoSecundario?.[0] < m.rangoSecundario?.[1])))
    .map(([k]) => k);
  verificar(`cada tipo de services/medicionesTipos.js tiene su rango${sinRango.length ? " — faltan: " + sinRango.join(", ") : ""}`, sinRango.length === 0);

  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de prueba. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "rangos_clinicos";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  app.use(express.json());
  for (const r of ["mediciones", "recetas"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  // Un médico por sección: limitMedico deja 60 pedidos por minuto a cada uno.
  const MEDICOS = ["70055001", "70055002", "70055003"];
  for (const phone of MEDICOS) await M.Medico.create({ phone, nombre: `Dr. ${phone}`, passwordHash: "x", activo: true });
  const tk = Object.fromEntries(MEDICOS.map(p => [p, generarToken(p, "medico", 36e5)]));
  const pacientes = {};
  for (const phone of MEDICOS) pacientes[phone] = await M.Paciente.create({ medicoPhone: phone, nombre: "Ana Pérez" });
  const medir = (phone) => (cuerpo) => pedir(puerto, "POST", `/medico/pacientes/${pacientes[phone]._id}/mediciones`, tk[phone], { fecha: "2026-09-16", ...cuerpo });

  console.log("\n── 1. Mediciones fuera de lo posible ──");
  let medicion = medir(MEDICOS[0]);
  const malas = [
    ["una SpO₂ de 300", { tipo: "saturacion", valor: 300 }],
    ["un peso de −5", { tipo: "peso", valor: -5 }],
    ["un valor «Infinity»", { tipo: "glucosa", valor: "Infinity" }],
    ["una temperatura de 370 (la coma que faltó)", { tipo: "temperatura", valor: 370 }],
    ["un tipo inventado", { tipo: "cualquier<b>cosa", valor: 10 }],
    ["una presión 80/120 (dada vuelta)", { tipo: "presion", valor: 80, valorSecundario: 120 }],
    ["una presión sin diastólica", { tipo: "presion", valor: 120 }],
    ["una presión con la diastólica en 0", { tipo: "presion", valor: 120, valorSecundario: 0 }],
    ["una medición del año 3000", { tipo: "peso", valor: 70, fecha: "3000-01-01" }],
  ];
  for (const [que, cuerpo] of malas) {
    const r = await medicion(cuerpo);
    verificar(`${que} → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && !!r.cuerpo?.error);
  }
  verificar("  ...y no se guardó ninguna", (await M.Medicion.countDocuments()) === 0);

  console.log("\n── 2. Lo raro pero real se guarda ──");
  medicion = medir(MEDICOS[1]);
  const buenas = [
    ["una presión 120/80", { tipo: "presion", valor: 120, valorSecundario: 80 }],
    ["la frecuencia cardíaca de un canario (600 lpm)", { tipo: "frecuenciaCardiaca", valor: 600 }],
    ["el IMC de un prematuro extremo (4,8)", { tipo: "imc", valor: 4.8 }],
    ["su peso (0,35 kg)", { tipo: "peso", valor: 0.35 }],
    ["una hipotermia grave (18 °C)", { tipo: "temperatura", valor: 18 }],
    ["una bradicardia fetal grave (45 lpm)", { tipo: "fcf", valor: 45 }],
    ["un toro de 1200 kg", { tipo: "peso", valor: 1200 }],
    ["una presión intraocular de 0", { tipo: "presionIntraocularOD", valor: 0 }],
  ];
  for (const [que, cuerpo] of buenas) {
    const r = await medicion(cuerpo);
    verificar(`${que} → 201 (${r.estado}${r.estado !== 201 ? ": " + r.cuerpo?.error : ""})`, r.estado === 201);
  }
  const r2 = await medicion({ tipo: "peso", valor: 70, valorSecundario: 5 });
  verificar("un peso con un segundo número suelto → se guarda sin él (no «70/5 kg»)", r2.estado === 201 && r2.cuerpo?.medicion?.valorSecundario === null);

  console.log("\n── 3. Recetas ópticas ──");
  const P = (cuerpo) => pedir(puerto, "POST", `/medico/pacientes/${pacientes[MEDICOS[2]]._id}/recetas-opticas`, tk[MEDICOS[2]], { fecha: "2026-09-16", ...cuerpo });
  const opticasMalas = [
    ["un eje de 500°", { od: { esfera: -2, cilindro: -1, eje: 500 } }],
    ["una esfera de 99", { od: { esfera: 99 } }],
    ["una esfera «abc»", { od: { esfera: "abc" } }],
    ["un cilindro de −15", { oi: { esfera: -1, cilindro: -15, eje: 90 } }],
    ["un cilindro sin eje", { od: { esfera: -2, cilindro: -1 } }],
    ["una adición de 12", { od: { esfera: 1, adicion: 12 } }],
    ["una distancia pupilar «abc»", { od: { esfera: -2 }, distanciaPupilar: "abc" }],
    ["una distancia pupilar de 10 mm", { od: { esfera: -2 }, distanciaPupilar: 10 }],
  ];
  for (const [que, cuerpo] of opticasMalas) {
    const r = await P(cuerpo);
    verificar(`${que} → 400 (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && !!r.cuerpo?.error);
  }
  verificar("  ...y no se guardó ninguna", (await M.RecetaOptica.countDocuments()) === 0);
  const opticasBuenas = [
    ["una receta común (−2,25 −0,75 a 180°, DP 62)", { od: { esfera: -2.25, cilindro: -0.75, eje: 180 }, oi: { esfera: -2 }, distanciaPupilar: 62 }],
    ["la DP de un lactante (38 mm)", { od: { esfera: 3 }, distanciaPupilar: 38 }],
    ["una adición de baja visión (+6)", { od: { esfera: 1, adicion: 6 } }],
    ["un cilindro de 0 sin eje", { od: { esfera: -1, cilindro: 0 } }],
  ];
  for (const [que, cuerpo] of opticasBuenas) {
    const r = await P(cuerpo);
    verificar(`${que} → 201 (${r.estado}${r.estado !== 201 ? ": " + r.cuerpo?.error : ""})`, r.estado === 201);
  }

  console.log("\n── 4. La pantalla muestra el error ──");
  const front = fs.readFileSync(path.join(RAIZ, "public", "js", "mediciones.js"), "utf8");
  const alAgregar = front.slice(front.indexOf('getElementById("btnAgregarMedicion").onclick'));
  verificar("al agregar una medición, el catch pinta e.error (antes era un catch vacío)",
    /catch \(e\) \{[\s\S]{0,400}e\.error/.test(alAgregar.slice(0, 1500)) && /id="medErr"/.test(front));
  for (const idioma of ["es", "pt"]) {
    const textos = fs.readFileSync(path.join(RAIZ, "public", "i18n", idioma, "mediciones.js"), "utf8");
    verificar(`  ...con el texto de respaldo en ${idioma}`, /"evo\.errGuardar":/.test(textos));
  }

  // La auditoría se escribe sin esperar a la respuesta: se le da un momento.
  await new Promise(ok => setTimeout(ok, 200));
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
