// Symphomed Neurodesarrollo — El informe a la familia sale una sola vez.
//
// Enviar miraba el estado sobre lo que había leído, armaba el enlace en
// memoria, mandaba el WhatsApp y recién después guardaba. Con dos «enviar» a
// la vez (dos pestañas, o dos personas del equipo tratante) salían dos
// mensajes, cada uno con su enlace, y el primero no abría: la familia recibía
// un enlace roto del número oficial (verificación del informe de QA del 16 de
// octubre de 2026, M13). Lo que se prueba:
//   1. Dos «enviar» a la vez: sale un WhatsApp, y su enlace abre.
//   2. Si el WhatsApp falla, vuelve a ser borrador y se puede mandar de nuevo.
//   3. Un cambio que se cruza con el envío no cambia lo que la familia recibió.
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

// WhatsApp de mentira, que tarda un poco (es lo que da lugar a que dos envíos
// se crucen) y que se puede hacer fallar. Va antes de cargar la ruta: la ruta
// se queda con la función al cargarse.
const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
const enviados = [];
let fallaElProximo = false;
meta.enviarTextoOPlantilla = async (destino, texto) => {
  await new Promise((r) => setTimeout(r, 150));
  if (fallaElProximo) { fallaElProximo = false; throw new Error("Meta no contestó"); }
  enviados.push({ destino, texto });
  return { ok: true };
};

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "informe_familia_envio";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const MED = "70098001";
  await M.Medico.create({ phone: MED, nombre: "Lic. Ana Fono", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const FAMILIA = "59170000098";
  const pac = await M.Paciente.create({ medicoPhone: MED, nombre: "Tomás Rojas", telefono: FAMILIA });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "informeFamilia"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);
  const borrador = () => M.InformeFamilia.create({ pacienteId: pac._id, medicoPhone: MED, desde: new Date("2026-09-01"), hasta: new Date("2026-10-01"),
    nombre: "Tomás Rojas", fortalezas: ["Memoria visual"], nota: "Tomás avanzó mucho este mes.", profesional: "Lic. Ana Fono" });
  const tokenDe = (enlace) => String(enlace || "").split("/avance/")[1];

  console.log("── 1. Dos «enviar» a la vez ──");
  const inf1 = await borrador();
  const dos = await Promise.all([1, 2].map(() => P("POST", `/medico/informes-familia/${inf1._id}/enviar`, tk, {})));
  const gano = dos.find(x => x.estado === 200);
  verificar(`uno se envía y el otro → 409 (${dos.map(x => x.estado).sort().join(", ")})`, dos.map(x => x.estado).sort().join() === "200,409");
  verificar(`  ...sale un solo WhatsApp (salieron ${enviados.length})`, enviados.length === 1 && enviados[0].destino === FAMILIA);
  const guardado1 = await M.InformeFamilia.findById(inf1._id).lean();
  verificar("  ...y el enlace que se mandó es el que quedó guardado", !!gano && enviados[0].texto.includes(gano.cuerpo.enlace)
    && tokenDe(gano.cuerpo.enlace) === guardado1.tokenPublico && guardado1.estado === "enviado" && guardado1.enviadoA === FAMILIA);
  let r = await P("GET", `/informe-familia/${tokenDe(enviados[0]?.texto.match(/https?:\/\/\S+/)?.[0])}`);
  verificar(`  ...la familia lo abre (${r.estado})`, r.estado === 200 && r.cuerpo?.informe?.nombre === "Tomás Rojas");

  console.log("\n── 2. Si el WhatsApp falla ──");
  const inf2 = await borrador();
  fallaElProximo = true;
  r = await P("POST", `/medico/informes-familia/${inf2._id}/enviar`, tk, {});
  const guardado2 = await M.InformeFamilia.findById(inf2._id).lean();
  verificar(`no salió → 502, y sigue siendo borrador, sin enlace (${r.estado}, ${guardado2.estado})`,
    r.estado === 502 && guardado2.estado === "borrador" && !guardado2.tokenPublico && !guardado2.enviadoEn);
  r = await P("PATCH", `/medico/informes-familia/${inf2._id}`, tk, { nota: "Una nota corregida." });
  verificar("  ...se puede seguir editando", r.estado === 200);
  r = await P("POST", `/medico/informes-familia/${inf2._id}/enviar`, tk, {});
  verificar("  ...y mandar de nuevo", r.estado === 200 && (await M.InformeFamilia.findById(inf2._id).lean()).estado === "enviado");

  console.log("\n── 3. Un cambio que se cruza con el envío ──");
  // El PATCH lee el informe y guarda después. Se lo frena justo después de
  // leer, y se envía en el medio: dos personas del equipo, o dos pestañas.
  const findByIdOriginal = M.InformeFamilia.findById;
  let freno = null;
  M.InformeFamilia.findById = function (...a) {
    const q = findByIdOriginal.apply(this, a);
    if (freno) {
      const f = freno; freno = null;
      const exec = q.exec.bind(q);
      q.exec = async (...b) => { const doc = await exec(...b); f.llego(); await f.soltar; return doc; };
    }
    return q;
  };
  const inf3 = await borrador();
  let soltar, llego;
  const enElMedio = new Promise((ok) => { llego = ok; });
  freno = { llego, soltar: new Promise((ok) => { soltar = ok; }) };
  const patch = P("PATCH", `/medico/informes-familia/${inf3._id}`, tk, { nota: "Otra nota, escrita en la otra pestaña." });
  await enElMedio;
  const envio = await P("POST", `/medico/informes-familia/${inf3._id}/enviar`, tk, {});
  soltar();
  const tarde = await patch;
  M.InformeFamilia.findById = findByIdOriginal;
  const guardado3 = await M.InformeFamilia.findById(inf3._id).lean();
  verificar(`se envía (${envio.estado}) y el cambio que llega tarde → 409 (${tarde.estado})`, envio.estado === 200 && tarde.estado === 409);
  r = await P("GET", `/informe-familia/${tokenDe(envio.cuerpo?.enlace)}`);
  verificar("  ...la familia ve la nota con la que se envió", guardado3.nota === "Tomás avanzó mucho este mes." && r.cuerpo?.informe?.nota === "Tomás avanzó mucho este mes.");

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
