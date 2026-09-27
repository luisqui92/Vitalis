// Symphomed Ganadería — la planilla de Excel.
//
// ═══ LO QUE NO PUEDE FALLAR ═══════════════════════════════════════════════
//
//   · Que abra. Un .xlsx que Excel dice «dañado» es peor que no tenerlo: el
//     productor se lo manda al contador y queda mal. Se lee de vuelta acá
//     (descomprimiendo el zip), y si hay Python con openpyxl, también con un
//     lector que no escribimos nosotros.
//   · Fechas como fechas y en el día civil correcto (un 5/9 no puede salir
//     4/9), y números como números.
//   · Un texto que empieza con «=» queda como texto, nunca como fórmula.
//   · Cada uno baja SOLO lo suyo: otro veterinario da 404; el dueño baja su
//     finca y ni un lote de otra.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const zlib = require("zlib");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ─── Leer un .xlsx sin librerías ───────────────────────────────────────────
function leerZip(buf) {
  const archivos = {};
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const metodo = buf.readUInt16LE(i + 8);
    const tamComp = buf.readUInt32LE(i + 18);
    const largoNombre = buf.readUInt16LE(i + 26);
    const largoExtra = buf.readUInt16LE(i + 28);
    const nombre = buf.slice(i + 30, i + 30 + largoNombre).toString("utf8");
    const inicio = i + 30 + largoNombre + largoExtra;
    const datos = buf.slice(inicio, inicio + tamComp);
    archivos[nombre] = (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString("utf8");
    i = inicio + tamComp;
  }
  return archivos;
}

const desXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// → { nombreHoja: [[celdas de la fila 1], [fila 2], …] } con {v, s, tipo}
function leerLibro(buf) {
  const a = leerZip(buf);
  const nombres = [...a["xl/workbook.xml"].matchAll(/<sheet name="([^"]*)" sheetId="(\d+)"/g)].map(m => desXml(m[1]));
  const libro = {};
  nombres.forEach((nombre, idx) => {
    const x = a[`xl/worksheets/sheet${idx + 1}.xml`];
    const filas = [];
    for (const f of x.matchAll(/<row r="(\d+)">(.*?)<\/row>/gs)) {
      const fila = [];
      for (const c of f[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/gs)) {
        const col = c[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const attrs = c[2];
        const texto = /<t[^>]*>(.*?)<\/t>/s.exec(c[3]);
        const num = /<v>(.*?)<\/v>/.exec(c[3]);
        const formula = /<f>(.*?)<\/f>/s.exec(c[3]);
        fila[col] = {
          v: formula ? "=" + desXml(formula[1]) : texto ? desXml(texto[1]) : Number(num[1]),
          tipo: formula ? "formula" : /t="inlineStr"/.test(attrs) ? "texto" : "numero",
          s: Number((/s="(\d+)"/.exec(attrs) || [])[1] || 0),
        };
      }
      filas.push(fila);
    }
    libro[nombre] = filas;
  });
  return { libro, archivos: a };
}

// Serie de Excel → "YYYY-MM-DD"
const diaDeSerie = (n) => new Date((n - 25569) * 86400000).toISOString().slice(0, 10);
const col = (hoja, titulo) => hoja[0].findIndex(c => c && c.v === titulo);

function pedir(puerto, ruta, token) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: puerto, path: ruta, headers: token ? { authorization: "Bearer " + token } : {} }, (res) => {
      const trozos = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => resolve({ estado: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos) }));
    }).on("error", reject);
  });
}

(async () => {
  console.log("── 1. El generador solo ──");
  const { generarXlsx, crc32, letraColumna, serieExcel } = require(path.join(RAIZ, "services", "xlsx"));
  verificar("CRC-32 correcto (valor de referencia de «123456789»)", crc32(Buffer.from("123456789")) === 0xcbf43926);
  verificar("columnas: A, Z, AA, AZ, BA", ["A", "Z", "AA", "AZ", "BA"].join() === [0, 25, 26, 51, 52].map(letraColumna).join());
  verificar("5/9/2026 como día civil, sea texto o fecha UTC", serieExcel("2026-09-05") === serieExcel(new Date("2026-09-05T00:00:00Z")) && diaDeSerie(serieExcel("2026-09-05")) === "2026-09-05");
  const chico = leerLibro(generarXlsx([
    { nombre: "Uno/dos:tres", columnas: [{ titulo: "Texto" }, { titulo: "N", tipo: "numero" }], filas: [["=1+1", 5], ["a\u0001b <&>", null]] },
    { nombre: "uno dos tres", columnas: [{ titulo: "X" }], filas: [] },
  ]));
  const nombresHojas = Object.keys(chico.libro);
  verificar("nombres de hoja sin caracteres prohibidos y sin repetirse", nombresHojas[0] === "Uno dos tres" && nombresHojas[1] === "uno dos tres 2");
  const h0 = chico.libro["Uno dos tres"];
  verificar("«=1+1» queda como TEXTO, no como fórmula", h0[1][0].tipo === "texto" && h0[1][0].v === "=1+1" && !/<f>/.test(chico.archivos["xl/worksheets/sheet1.xml"]));
  verificar("caracteres de control fuera, <&> escapados y de vuelta", h0[2][0].v === "ab <&>");
  verificar("una celda vacía no se escribe", h0[2][1] === undefined);

  // ─── Con datos de verdad ────────────────────────────────────────────────
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "exportar_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("Prueba123.");
  await M.Medico.create({ phone: "70000001", nombre: "Dra. Campo", passwordHash: hash, moneda: "BOB", idioma: "es" });
  await M.Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);
  const finca = await M.Finca.create({ medicoPhone: "70000001", codigo: "F-0001", nombre: "Estancia Los Álamos", duenoNombre: "Ramiro", duenoTelefono: "71234567" });
  const otra = await M.Finca.create({ medicoPhone: "70000001", codigo: "F-0002", nombre: "Granja Vecina" });
  const base = { medicoPhone: "70000001", fechaIngreso: new Date("2026-06-01"), edadIngresoDias: 700 };
  const tambo = await M.LoteGanado.create({ ...base, fincaId: finca._id, especie: "bovino", nombre: "Tambo", codigo: "L-0001", proposito: "leche", cantidadInicial: 30, cantidadActual: 28 });
  const vendido = await M.LoteGanado.create({ ...base, fincaId: finca._id, especie: "porcino", nombre: "Engorde vendido", codigo: "L-0002", cantidadInicial: 50, cantidadActual: 50, estado: "cerrado", fechaCierre: new Date("2026-09-01"), motivoCierre: "vendido" });
  const vecino = await M.LoteGanado.create({ ...base, fincaId: otra._id, especie: "avicola", nombre: "Galpón vecino", codigo: "L-0003", cantidadInicial: 100, cantidadActual: 100 });

  await M.EventoLote.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "mortalidad", fecha: new Date("2026-09-05T00:00:00Z"), cantidadMuertes: 2, causaPresunta: "=HIPERVINCULO(\"http://x\")", origen: "dueno", registradoPor: "Ramiro" });
  await M.EventoLote.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "tratamiento", fecha: new Date("2026-09-10T00:00:00Z"), producto: "Oxitetraciclina", diasRetiroLeche: 5, diasRetiroCarne: 28, cantidadAplicada: 28 });
  await M.RegistroProduccion.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "leche", dia: "2026-09-12", cantidad: 420.5, animales: 25 });
  await M.RegistroProduccion.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "leche", dia: "2026-09-16", cantidad: 400, animales: 25 });
  await M.GastoLote.create({ medicoPhone: "70000001", loteId: tambo._id, dia: "2026-09-05", categoria: "alimento", concepto: "Balanceado", montoCentavos: 150055, moneda: "BOB", kg: 500 });
  await M.GastoLote.create({ medicoPhone: "70000001", loteId: tambo._id, dia: "2026-09-06", categoria: "otros", montoCentavos: 9999, moneda: "BRL" });
  const vaca = await M.AnimalGanado.create({ medicoPhone: "70000001", loteId: tambo._id, especie: "bovino", identificador: "V-017", nombre: "Lucera" });
  await M.EventoReproductivo.create({ medicoPhone: "70000001", animalId: vaca._id, loteId: tambo._id, tipo: "servicio", fecha: new Date("2026-08-01T00:00:00Z"), metodo: "inseminacion", reproductor: "Toro X" });
  await M.EventoLote.create({ medicoPhone: "70000001", loteId: vecino._id, tipo: "mortalidad", fecha: new Date("2026-09-05T00:00:00Z"), cantidadMuertes: 1, causaPresunta: "NO_DEBE_SALIR" });
  const llave = crypto.randomBytes(24).toString("base64url");
  await M.LlaveFinca.create({ fincaId: finca._id, medicoPhone: "70000001", tokenHash: crypto.createHash("sha256").update(llave).digest("hex") });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "exportarGanado"))(app);
  require(path.join(RAIZ, "routes", "accesoDueno"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;

  console.log("\n── 2. La planilla de la finca (veterinario) ──");
  const r = await pedir(puerto, `/medico/fincas/${finca._id}/excel`, tkA);
  verificar("baja (200) como .xlsx, con nombre de archivo sin tildes", r.estado === 200 &&
    r.headers["content-type"].includes("spreadsheetml") && /filename="Estancia_Los_Alamos_\d{4}-\d{2}-\d{2}\.xlsx"/.test(r.headers["content-disposition"]));
  const { libro } = leerLibro(r.cuerpo);
  verificar("hojas: Lotes, Sanidad y eventos, Producción, Gastos, Animales, Reproducción, Calendario sanitario",
    JSON.stringify(Object.keys(libro)) === JSON.stringify(["Lotes", "Sanidad y eventos", "Producción", "Gastos", "Animales", "Reproducción", "Calendario sanitario"]));
  const L = libro["Lotes"];
  verificar("Lotes: los dos de la finca (también el cerrado), no el de la vecina", L.length === 3 && L.slice(1).map(f => f[0].v).sort().join() === "L-0001,L-0002");
  const filaTambo = L.find(f => f[0]?.v === "L-0001");
  verificar("  ...animales actuales 28 como NÚMERO", filaTambo[col(L, "Animales actuales")].v === 28 && filaTambo[col(L, "Animales actuales")].tipo === "numero");
  verificar("  ...mortalidad 6,67 %", filaTambo[col(L, "Mortalidad %")].v === 6.67);
  verificar("  ...gasto total en Bs SIN sumar los reales (1500,55)", filaTambo[col(L, "Gasto total (BOB)")].v === 1500.55);
  verificar("  ...la fecha de ingreso es una FECHA (serie con formato)", diaDeSerie(filaTambo[col(L, "Fecha de ingreso")].v) === "2026-06-01" && filaTambo[col(L, "Fecha de ingreso")].s === 2);
  const filaVendido = L.find(f => f[0]?.v === "L-0002");
  verificar("  ...el cerrado dice Cerrado, con fecha y motivo", filaVendido[col(L, "Estado")].v === "Cerrado" && filaVendido[col(L, "Motivo de cierre")].v === "vendido");

  const E = libro["Sanidad y eventos"];
  const muerte = E.find(f => f[col(E, "Tipo")]?.v === "Mortalidad");
  verificar("Eventos: la muerte del 5/9 sale el 5/9 (no el 4/9)", diaDeSerie(muerte[col(E, "Fecha")].v) === "2026-09-05");
  verificar("  ...la causa que empieza con «=» es texto", muerte[col(E, "Causa")].tipo === "texto" && muerte[col(E, "Causa")].v.startsWith("=HIPERVINCULO"));
  verificar("  ...dice que la anotó el dueño", muerte[col(E, "Anotado por")].v === "Ramiro (dueño)");
  const trat = E.find(f => f[col(E, "Tipo")]?.v === "Tratamiento");
  verificar("  ...el tratamiento con leche libre desde el 15/9 y carne desde el 8/10",
    diaDeSerie(trat[col(E, "Leche en retiro hasta")].v) === "2026-09-15" && diaDeSerie(trat[col(E, "Carne en retiro hasta")].v) === "2026-10-08");
  verificar("  ...y nada del lote de la otra finca", !JSON.stringify(libro).includes("NO_DEBE_SALIR"));

  const P = libro["Producción"];
  const p12 = P.find(f => f[1]?.tipo === "numero" && diaDeSerie(f[1].v) === "2026-09-12");
  verificar("Producción: 420,5 L el 12/9, en retiro (tratamiento del 10/9 con 5 días)", p12[col(P, "Cantidad")].v === 420.5 && p12[col(P, "En retiro")].v === "Sí");
  const p16 = P.find(f => f[1]?.tipo === "numero" && diaDeSerie(f[1].v) === "2026-09-16");
  verificar("  ...el 16/9 ya no está en retiro", p16[col(P, "En retiro")].v === "No");
  verificar("  ...litros por vaca 420,5 / 25 = 16,82", p12[col(P, "Por animal (L/vaca o % postura)")].v === 16.82);

  const G = libro["Gastos"];
  verificar("Gastos: los dos, cada uno con su moneda", G.length === 3 && G.slice(1).map(f => f[col(G, "Moneda")].v).sort().join() === "BOB,BRL");
  verificar("  ...el monto como número con dos decimales", G.find(f => f[col(G, "Moneda")]?.v === "BOB")[col(G, "Monto")].v === 1500.55 && G[1][col(G, "Monto")].s === 3);
  const A = libro["Animales"];
  verificar("Animales: la vaca V-017, servida", A[1][col(A, "Identificador")].v === "V-017" && A[1][col(A, "Preñez")].v === "Servida");
  verificar("Reproducción: el servicio por inseminación", libro["Reproducción"][1][col(libro["Reproducción"], "Método")].v === "Inseminación");
  verificar("Calendario: solo de los lotes activos", libro["Calendario sanitario"].slice(1).every(f => f[0].v.startsWith("L-0001")));

  // Un lector que no escribimos nosotros
  const tmp = path.join(os.tmpdir(), `finca_${process.pid}.xlsx`);
  fs.writeFileSync(tmp, r.cuerpo);
  const py = spawnSync("python3", ["-c", `
import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb["Sanidad y eventos"]
fila = [c for c in ws.iter_rows(min_row=2, values_only=True) if c[2] == "Mortalidad"][0]
print(wb.sheetnames[0], fila[1].strftime("%Y-%m-%d"), ws.freeze_panes)
`, tmp], { encoding: "utf8" });
  if (py.status === 0) verificar("openpyxl lo abre, con la fecha bien y el encabezado fijo", py.stdout.trim() === "Lotes 2026-09-05 A2");
  else console.log("⏭️  (sin python3/openpyxl: se salta la lectura cruzada)", (py.stderr || "").split("\n").slice(-2).join(" "));
  fs.unlinkSync(tmp);

  console.log("\n── 3. Un lote solo, y todo Ganadería ──");
  const rl = await pedir(puerto, `/medico/lotes/${tambo._id}/excel`, tkA);
  verificar("el lote: una sola fila en Lotes", rl.estado === 200 && leerLibro(rl.cuerpo).libro["Lotes"].length === 2);
  const rt = await pedir(puerto, "/medico/ganaderia/excel?estado=activo", tkA);
  const Lt = leerLibro(rt.cuerpo).libro["Lotes"];
  verificar("todo Ganadería, solo activos: tambo y galpón vecino", rt.estado === 200 && Lt.slice(1).map(f => f[0].v).sort().join() === "L-0001,L-0003");

  console.log("\n── 4. Cada uno lo suyo ──");
  verificar("otro veterinario: finca → 404", (await pedir(puerto, `/medico/fincas/${finca._id}/excel`, tkB)).estado === 404);
  verificar("otro veterinario: lote → 404", (await pedir(puerto, `/medico/lotes/${tambo._id}/excel`, tkB)).estado === 404);
  const rtB = await pedir(puerto, "/medico/ganaderia/excel", tkB);
  verificar("otro veterinario: su «todo» sale vacío", rtB.estado === 200 && leerLibro(rtB.cuerpo).libro["Lotes"].length === 1);
  verificar("sin sesión → 401", (await pedir(puerto, `/medico/fincas/${finca._id}/excel`)).estado === 401);
  verificar("un id inválido → 404", (await pedir(puerto, "/medico/lotes/nada/excel", tkA)).estado === 404);

  const rd = await pedir(puerto, `/campo/${llave}/excel`);
  const Ld = leerLibro(rd.cuerpo).libro;
  verificar("el dueño baja SU finca: solo el lote activo (como en su página)", rd.estado === 200 && Ld["Lotes"].length === 2 && Ld["Lotes"][1][0].v === "L-0001");
  verificar("  ...y nada de la vecina", !JSON.stringify(Ld).includes("NO_DEBE_SALIR") && !JSON.stringify(Ld).includes("L-0003"));
  verificar("un enlace inventado → 404", (await pedir(puerto, `/campo/${"z".repeat(32)}/excel`)).estado === 404);
  // La auditoría se escribe sin esperar (services/auditoria.js), así que la
  // última descarga puede tardar un instante en aparecer: se espera un poco
  // en vez de contar de inmediato.
  let audit = 0;
  for (let i = 0; i < 20 && audit < 5; i++) {
    audit = await M.AuditLog.countDocuments({ accion: { $in: ["exportar_ganaderia_excel", "campo_exportar_excel"] } });
    if (audit < 5) await new Promise((r) => setTimeout(r, 100));
  }
  verificar("cada descarga queda en la auditoría", audit >= 5);

  console.log("\n── 5. En portugués ──");
  await M.Medico.updateOne({ phone: "70000001" }, { $set: { idioma: "pt", moneda: "BRL" } });
  const rp = await pedir(puerto, `/medico/fincas/${finca._id}/excel`, tkA);
  const Lp = leerLibro(rp.cuerpo).libro;
  verificar("hojas y encabezados en portugués", Object.keys(Lp)[1] === "Sanidade e eventos" && Lp["Lotes"][0][col(Lp["Lotes"], "Animais atuais")] !== undefined);
  verificar("  ...y el total en reales, sin los bolivianos (99,99)", Lp["Lotes"].find(f => f[0]?.v === "L-0001")[col(Lp["Lotes"], "Gasto total (BRL)")].v === 99.99);

  servidor.close();
  // La auditoría se escribe sin esperar (services/auditoria.js): un momento
  // para que termine antes de cerrar la base.
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
