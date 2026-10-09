// Symphomed — Un informe firmado dice siempre lo que decía el día que se
// firmó: el membrete (centro, profesional, matrícula, logo, firma) y los
// datos del paciente quedan congelados al firmar.
//
// Antes, la vista pública, la verificación y la impresión leían el membrete
// y el paciente de HOY: cambiar la matrícula o el logo cambiaba todos los
// informes ya entregados (informe de QA del 9 de octubre de 2026). Lo que se
// prueba:
//   1. Firmar congela el membrete y el paciente; cambiarlos después no cambia
//      el informe firmado (enlace del paciente, verificación, impresión,
//      WhatsApp), y sí el borrador.
//   2. Una copia del membrete por versión, no una por informe.
//   3. Dos «firmar» a la vez: uno solo firma, con un solo enlace.
//   4. Los firmados antes de este cambio se congelan al arrancar, con lo que
//      mostraban hasta ese momento.
const path = require("path");
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
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// WhatsApp de mentira: se guarda lo que se iba a mandar.
const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
const enviados = [];
meta.enviarTextoOPlantilla = async (destino, texto) => { enviados.push({ destino, texto }); return { ok: true }; };

const LOGO_VIEJO = "data:image/png;base64," + Buffer.from("logo-viejo").toString("base64");
const LOGO_NUEVO = "data:image/png;base64," + Buffer.from("logo-nuevo").toString("base64");
const FIRMA = "data:image/png;base64," + Buffer.from("firma").toString("base64");

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "informe_congelado";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  for (const modelo of [M.MembreteEmitido, M.Informe, M.Membrete]) await modelo.syncIndexes();

  const MED = "70096001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Imagen", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const pac = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Pérez", telefono: "59170000096", sexo: "F", fechaNacimiento: new Date("1990-05-10") });

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const rutas = require(path.join(RAIZ, "routes", "informes"));
  rutas(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);

  const MEMBRETE_DE_FIRMA = { nombreCentro: "Centro de Imagen Sur", profesionalNombre: "Dra. Imagen", profesionalTitulo: "Médica radióloga",
    profesionalRegistro: "MAT-1111", logo: LOGO_VIEJO, firma: FIRMA };
  await P("PATCH", "/medico/membrete", tk, MEMBRETE_DE_FIRMA);
  const nuevoInforme = async (conclusion = "Sin hallazgos patológicos.") => {
    const id = (await P("POST", `/medico/pacientes/${pac._id}/informes`, tk, { titulo: "Radiografía de tórax" })).cuerpo.informe._id;
    await P("PATCH", `/medico/informes/${id}`, tk, { conclusion });
    return id;
  };

  console.log("── 1. Firmar congela el membrete y el paciente ──");
  const id1 = await nuevoInforme();
  let r = await P("POST", `/medico/informes/${id1}/firmar`, tk);
  const token1 = r.cuerpo?.enlace?.split("/informe/")[1];
  verificar("firmar → 200, con su enlace", r.estado === 200 && !!token1);
  // Después de firmar, cambia todo: el membrete y el paciente.
  await P("PATCH", "/medico/membrete", tk, { nombreCentro: "Centro Nuevo", profesionalNombre: "Dr. Otro", profesionalRegistro: "MAT-9999", logo: LOGO_NUEVO });
  await M.Paciente.updateOne({ _id: pac._id }, { $set: { nombre: "Ana Pérez de Gómez", codigo: "P-9999", fechaNacimiento: new Date("1980-01-01") } });
  r = await P("GET", `/informe-publico/${token1}`);
  const pub = r.cuerpo;
  verificar("el enlace del paciente: el membrete del día que se firmó (centro, profesional, matrícula, logo, firma)",
    r.estado === 200 && pub.membrete.nombreCentro === "Centro de Imagen Sur" && pub.membrete.profesionalNombre === "Dra. Imagen"
    && pub.membrete.profesionalRegistro === "MAT-1111" && pub.membrete.logo === LOGO_VIEJO && pub.membrete.firma === FIRMA);
  verificar("  ...y el paciente como estaba: nombre, código y edad de ese día",
    pub.paciente.nombre === "Ana Pérez" && pub.paciente.codigo !== "P-9999" && pub.paciente.edad === 36);
  verificar("  ...lo que sale al paciente no trae nada de más (ni teléfono, ni la huella de la versión)",
    !("telefono" in pub.paciente) && !("huella" in pub.membrete) && !("medicoPhone" in pub.membrete));
  r = await P("GET", `/informe-publico/${token1}/verificar`);
  verificar("verificar el informe: el profesional y el centro que lo firmaron", r.cuerpo.valido === true && r.cuerpo.profesional === "Dra. Imagen" && r.cuerpo.centro === "Centro de Imagen Sur");
  r = await P("GET", `/medico/informes/${id1}/completo`, tk);
  verificar("imprimirlo de nuevo desde el consultorio: igual que el día que se firmó",
    r.cuerpo.membrete.profesionalRegistro === "MAT-1111" && r.cuerpo.membrete.logo === LOGO_VIEJO && r.cuerpo.paciente.nombre === "Ana Pérez" && r.cuerpo.paciente.edad === 36);
  verificar("  ...con el teléfono de hoy (es para mandarlo, no va impreso)", r.cuerpo.paciente.telefono === "59170000096");
  r = await P("POST", `/medico/informes/${id1}/enviar`, tk, {});
  verificar("mandarlo por WhatsApp: firma el centro que lo emitió", r.estado === 200 && /Centro de Imagen Sur/.test(enviados.at(-1)?.texto) && !/Centro Nuevo/.test(enviados.at(-1)?.texto));
  const borrador = await nuevoInforme();
  r = await P("GET", `/medico/informes/${borrador}/completo`, tk);
  verificar("un borrador, en cambio, se ve con el membrete y el paciente de hoy",
    r.cuerpo.membrete.nombreCentro === "Centro Nuevo" && r.cuerpo.membrete.logo === LOGO_NUEVO && r.cuerpo.paciente.nombre === "Ana Pérez de Gómez");

  console.log("\n── 2. Una copia del membrete por versión ──");
  const id2 = await nuevoInforme();
  const id3 = await nuevoInforme();
  await P("POST", `/medico/informes/${id2}/firmar`, tk);
  await P("POST", `/medico/informes/${id3}/firmar`, tk);
  const [i1, i2, i3] = await Promise.all([id1, id2, id3].map(id => M.Informe.findById(id).lean()));
  verificar("dos informes firmados con el mismo membrete → la misma copia", String(i2.membreteEmitido) === String(i3.membreteEmitido));
  verificar("  ...y el de antes del cambio, otra", String(i1.membreteEmitido) !== String(i2.membreteEmitido) && (await M.MembreteEmitido.countDocuments({ medicoPhone: MED })) === 2);

  console.log("\n── 3. Dos «firmar» a la vez ──");
  const id4 = await nuevoInforme();
  const dos = await Promise.all([1, 2].map(() => P("POST", `/medico/informes/${id4}/firmar`, tk)));
  const i4 = await M.Informe.findById(id4).lean();
  verificar("uno firma y el otro → 409; queda un solo enlace, el que se le dio al que firmó",
    dos.map(x => x.estado).sort().join() === "200,409" && dos.find(x => x.estado === 200).cuerpo.enlace.endsWith(i4.tokenPublico));
  r = await P("PATCH", `/medico/informes/${id4}`, tk, { conclusion: "otra cosa" });
  verificar("un firmado no se edita (como antes)", r.estado === 409);

  console.log("\n── 4. Los firmados antes de este cambio ──");
  // Firmado con el código anterior: sin copia del membrete ni del paciente.
  const viejo = await M.Informe.create({ pacienteId: pac._id, medicoPhone: MED, codigo: "INF-VIEJO", conclusion: "Normal", estado: "firmado",
    firmadoEn: new Date("2026-01-15"), tokenPublico: "token-de-un-informe-viejo-0001", tokenExpira: new Date(Date.now() + 86400000) });
  r = await P("GET", "/informe-publico/token-de-un-informe-viejo-0001");
  verificar("antes de congelarlo, se ve con lo de hoy (como hasta ahora)", r.cuerpo.membrete.nombreCentro === "Centro Nuevo");
  const n = await rutas.congelarInformesFirmados();
  await P("PATCH", "/medico/membrete", tk, { nombreCentro: "Centro Tercero", profesionalRegistro: "MAT-3333" });
  r = await P("GET", "/informe-publico/token-de-un-informe-viejo-0001");
  verificar(`al arrancar se congela (${n}), con lo que mostraba hasta ese momento; después ya no cambia`,
    n === 1 && r.cuerpo.membrete.nombreCentro === "Centro Nuevo" && r.cuerpo.membrete.profesionalRegistro === "MAT-9999" && r.cuerpo.paciente.nombre === "Ana Pérez de Gómez");
  verificar("  ...sin crear otra copia del mismo membrete", String((await M.Informe.findById(viejo._id).lean()).membreteEmitido) === String(i2.membreteEmitido));
  verificar("arrancar otra vez no congela nada más", (await rutas.congelarInformesFirmados()) === 0);
  const arranque = require("fs").readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("  ...y el servidor lo hace al arrancar (index.js)", /require\("\.\/routes\/informes"\)\.congelarInformesFirmados\(\)/.test(arranque));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
