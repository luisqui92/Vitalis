// Symphomed — Una receta emitida no se borra: se anula, con el motivo.
//
// DELETE /medico/recetas/:id hacía un deleteOne. La receta ya podía estar en
// una farmacia o en manos del paciente, y del registro quedaba solo una línea
// de auditoría con el id: qué se había recetado, nadie lo podía saber
// (auditoría de QA, M8). Lo que se prueba:
//   1. Sin motivo no se anula (400), y la receta sigue igual.
//   2. Con motivo se anula: el documento queda, con la fecha y el motivo.
//      Anular dos veces → 409; dos pedidos a la vez → uno solo gana.
//   3. La anulada se sigue viendo, marcada: al abrirla, en la ficha, en la
//      lista del escritorio y en el Kardex en PDF.
//   4. Lo mismo para la receta óptica.
//   5. La pantalla pide el motivo y lo manda.
// Ojo con el schema: si a db/models.js le faltan anuladaEn y anuladaMotivo,
// Mongoose descarta el $set en silencio y la ruta contesta 200 sin anular
// nada. Por eso se mira la base, no solo la respuesta.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

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
      const trozos = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => {
        const crudo = Buffer.concat(trozos);
        let j = null; try { j = JSON.parse(crudo.toString("utf8")); } catch { /* no era JSON */ }
        resolve({ estado: res.statusCode, cuerpo: j, crudo });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error("sin respuesta")));
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}
// El texto del PDF: con pdftotext si está, y si no, lo que se dibuja en cada
// página, descomprimido.
function textoDelPdf(buf) {
  try {
    const archivo = path.join(os.tmpdir(), `anuladas-${process.pid}.pdf`);
    fs.writeFileSync(archivo, buf);
    try { return execFileSync("pdftotext", ["-layout", archivo, "-"]).toString("utf8").replace(/\s+/g, " "); }
    finally { fs.unlinkSync(archivo); }
  } catch {
    const s = buf.toString("latin1");
    const salida = [];
    for (const m of s.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
      const desde = m.index + m[0].length;
      try { salida.push(zlib.inflateSync(Buffer.from(s.slice(desde, desde + Number(m[1])), "latin1")).toString("latin1")); } catch { /* no es una página */ }
    }
    return salida.join("\n");
  }
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "recetas_anuladas";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const express = require("express");
  const app = express();
  app.use(express.json());
  for (const r of ["recetas", "pacientes", "dashboardEscritorio", "kardexPdf"]) require(path.join(RAIZ, "routes", r))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  const MED = "70044001", OTRO = "70044002", OPT = "70044003";
  for (const phone of [MED, OTRO, OPT]) await M.Medico.create({ phone, nombre: `Dr. ${phone}`, passwordHash: "x", activo: true, idioma: "es" });
  const tk = { [MED]: generarToken(MED, "medico", 36e5), [OTRO]: generarToken(OTRO, "medico", 36e5), [OPT]: generarToken(OPT, "medico", 36e5) };
  const P = (quien) => (metodo, ruta, cuerpo) => pedir(puerto, metodo, ruta, tk[quien], cuerpo);
  const yo = P(MED);
  const pac = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Pérez" });

  let r = await yo("POST", `/medico/pacientes/${pac._id}/recetas`, { medicamentos: [{ nombre: "Amoxicilina", dosis: "500 mg" }], fecha: "2026-09-16" });
  const id = r.cuerpo?.receta?._id;
  verificar("se emite una receta", r.estado === 201 && id);

  console.log("\n── 1. Sin motivo no se anula ──");
  for (const [que, cuerpo] of [["sin cuerpo", undefined], ["con el motivo vacío", { motivo: "" }], ["con espacios", { motivo: "   " }]]) {
    r = await yo("DELETE", `/medico/recetas/${id}`, cuerpo);
    verificar(`anular ${que} → 400 que pide el motivo (${r.estado}: ${r.cuerpo?.error})`, r.estado === 400 && /motivo/.test(r.cuerpo?.error || ""));
  }
  let enBase = await M.Receta.findById(id).lean();
  verificar("  ...y la receta sigue vigente", enBase && !enBase.anuladaEn);

  console.log("\n── 2. Con motivo se anula, y queda ──");
  r = await P(OTRO)("DELETE", `/medico/recetas/${id}`, { motivo: "No es mía" });
  verificar(`otro médico no la puede anular → 404 (${r.estado})`, r.estado === 404);
  r = await yo("DELETE", `/medico/recetas/${id}`, { motivo: "  Dosis equivocada, se reemplaza  " });
  verificar(`con motivo → 200 (${r.estado})`, r.estado === 200 && r.cuerpo?.ok === true);
  enBase = await M.Receta.findById(id).lean();
  verificar("  ...el documento SIGUE en la base (antes se borraba)", !!enBase);
  verificar("  ...con la fecha de anulación", enBase?.anuladaEn instanceof Date);
  verificar("  ...y el motivo, sin los espacios", enBase?.anuladaMotivo === "Dosis equivocada, se reemplaza");
  verificar("  ...con los medicamentos que tenía", enBase?.medicamentos?.[0]?.nombre === "Amoxicilina");
  r = await yo("DELETE", `/medico/recetas/${id}`, { motivo: "Otra vez" });
  verificar(`anularla otra vez → 409, y el motivo no cambia (${r.estado})`, r.estado === 409 && (await M.Receta.findById(id).lean())?.anuladaMotivo === "Dosis equivocada, se reemplaza");
  r = await yo("DELETE", "/medico/recetas/abc", { motivo: "x" });
  verificar(`una receta con id «abc» → 404 (${r.estado})`, r.estado === 404);

  const otra = (await yo("POST", `/medico/pacientes/${pac._id}/recetas`, { medicamentos: [{ nombre: "Ibuprofeno" }] })).cuerpo?.receta?._id;
  const [a, b] = await Promise.all([
    yo("DELETE", `/medico/recetas/${otra}`, { motivo: "primero" }),
    yo("DELETE", `/medico/recetas/${otra}`, { motivo: "segundo" }),
  ]);
  const motivoQueQuedo = (await M.Receta.findById(otra).lean())?.anuladaMotivo;
  const ganador = a.estado === 200 ? "primero" : "segundo";
  verificar(`dos anulaciones a la vez → una 200 y otra 409 (${a.estado}, ${b.estado})`, [a.estado, b.estado].sort().join() === "200,409");
  verificar("  ...y el motivo es el de la que ganó", motivoQueQuedo === ganador);

  console.log("\n── 3. La anulada se sigue viendo, marcada ──");
  r = await yo("GET", `/medico/recetas/${id}`);
  verificar("al abrirla → 200, con anuladaEn y el motivo", r.estado === 200 && !!r.cuerpo?.receta?.anuladaEn && r.cuerpo.receta.anuladaMotivo === "Dosis equivocada, se reemplaza");
  r = await yo("GET", `/medico/pacientes/${pac._id}`);
  const enFicha = (r.cuerpo?.recetas || []).find(x => String(x._id) === String(id));
  verificar("en la ficha del paciente sigue, marcada", r.estado === 200 && !!enFicha?.anuladaEn);
  r = await yo("GET", "/medico/recetas");
  const enEscritorio = (r.cuerpo?.recetas || []).find(x => String(x._id) === String(id));
  verificar("en la lista del escritorio sigue, marcada", r.estado === 200 && !!enEscritorio?.anuladaEn);
  r = await yo("GET", `/medico/pacientes/${pac._id}/kardex.pdf`);
  const texto = r.estado === 200 ? textoDelPdf(r.crudo) : "";
  verificar(`en el Kardex en PDF sale como ANULADA (${r.estado})`, /ANULADA/.test(texto));
  verificar("  ...con el motivo", /Dosis equivocada, se reemplaza/.test(texto));

  console.log("\n── 4. Receta óptica ──");
  const opt = P(OPT);
  const pacOpt = await M.Paciente.create({ medicoPhone: OPT, nombre: "Luis Rojas" });
  r = await opt("POST", `/medico/pacientes/${pacOpt._id}/recetas-opticas`, { od: { esfera: -2 }, fecha: "2026-09-16" });
  const idOpt = r.cuerpo?.receta?._id;
  r = await opt("DELETE", `/medico/recetas-opticas/${idOpt}`, {});
  verificar(`anular una óptica sin motivo → 400 (${r.estado})`, r.estado === 400);
  r = await opt("DELETE", `/medico/recetas-opticas/${idOpt}`, { motivo: "Se midió mal el OD" });
  const opticaEnBase = await M.RecetaOptica.findById(idOpt).lean();
  verificar(`con motivo → 200, y queda en la base, anulada (${r.estado})`, r.estado === 200 && !!opticaEnBase?.anuladaEn && opticaEnBase.anuladaMotivo === "Se midió mal el OD");
  r = await opt("GET", `/medico/pacientes/${pacOpt._id}/recetas-opticas`);
  verificar("en la lista sigue, marcada", (r.cuerpo?.recetas || []).some(x => String(x._id) === String(idOpt) && x.anuladaEn));
  r = await opt("GET", `/medico/recetas-opticas/${idOpt}`);
  verificar("al abrirla → 200, con el motivo", r.estado === 200 && r.cuerpo?.receta?.anuladaMotivo === "Se midió mal el OD");

  console.log("\n── 5. La pantalla ──");
  const front = fs.readFileSync(path.join(RAIZ, "public", "js", "recetas.js"), "utf8");
  verificar("pide el motivo y lo manda en el DELETE", /prompt\(pregunta\)/.test(front) && /method: "DELETE"[\s\S]{0,120}JSON\.stringify\(\{ motivo/.test(front));
  verificar("  ...ya no pregunta «¿Eliminar esta receta?»", !/confirmarBorrar/.test(front));
  verificar("  ...marca las anuladas y no les ofrece imprimir", /marcaAnulada\(r\)/.test(front) && /receta\.anuladaEn \? "" : `<button class="secondary no-imprimir" id="btnImprimirReceta"/.test(front));
  for (const idioma of ["es", "pt"]) {
    const textos = fs.readFileSync(path.join(RAIZ, "public", "i18n", idioma, "recetas.js"), "utf8");
    const faltan = ["receta.anulada", "receta.anuladaMotivo", "receta.motivoAnular", "receta.motivoAnularMemed", "receta.errMotivo", "receta.errAnular", "optica.motivoAnular"]
      .filter(k => !textos.includes(`"${k}":`));
    verificar(`  ...con sus textos en ${idioma}${faltan.length ? " — faltan: " + faltan.join(", ") : ""}`, faltan.length === 0);
  }

  // La auditoría se escribe sin esperar a la respuesta: se le da un momento.
  await new Promise(ok => setTimeout(ok, 200));
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
