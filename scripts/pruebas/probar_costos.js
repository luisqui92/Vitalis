// Symphomed Ganadería — alimento y costos.
//
// ═══ LO QUE NO PUEDE FALLAR ═══════════════════════════════════════════════
//
//   · La conversión alimenticia tiene que usar el alimento del MISMO tramo
//     que los pesajes. Con alimento de antes del primer pesaje, el engorde
//     parecería peor de lo que es, y el veterinario cambiaría una ración
//     que estaba bien.
//   · El costo por litro se mide con gastos y producción de los mismos 30
//     días — y aparte sobre la leche vendible, que es donde se ve lo que
//     cuesta un tratamiento con retiro.
//   · Bolivianos y reales no se suman nunca.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const cerca = (a, b) => a != null && Math.abs(a - b) < 1e-9;

const c = require(path.join(RAIZ, "services", "costos"));
const { sumarDias, diaDe } = require(path.join(RAIZ, "services", "produccion"));
const HOY = new Date("2026-09-27T15:00:00Z");
const dia = (n) => sumarDias(diaDe(HOY), -n);
const fechaDe = (n) => new Date(`${dia(n)}T00:00:00Z`);

console.log("── 1. Conversión alimenticia ──");
const pollos = { cantidadActual: 1000 };
const pesajes = [
  { fecha: fechaDe(28), pesoPromedioKg: 0.2 },
  { fecha: fechaDe(0), pesoPromedioKg: 2.2 },
];
const alimento = [
  { dia: dia(35), categoria: "alimento", kg: 999 },   // ANTES del primer pesaje: no cuenta
  { dia: dia(28), categoria: "alimento", kg: 500 },   // el mismo día del primer pesaje: tampoco
  { dia: dia(20), categoria: "alimento", kg: 1500 },
  { dia: dia(5), categoria: "alimento", kg: 1700 },
  { dia: dia(10), categoria: "sanidad", montoCentavos: 5000 }, // no es alimento
];
const conv = c.conversionAlimenticia(pollos, alimento, pesajes);
verificar("kg ganados: (2,2 − 0,2) × 1000 = 2000", cerca(conv.kgGanados, 2000));
verificar("alimento del tramo: 1500 + 1700 = 3200 (sin lo de antes ni lo del día del primer pesaje)", conv.kgAlimento === 3200);
verificar("conversión: 3200 / 2000 = 1,6", cerca(conv.valor, 1.6));
verificar("con un solo pesaje no hay conversión (y se dice por qué)",
  c.conversionAlimenticia(pollos, alimento, [pesajes[0]]).motivo === "faltan_pesajes");
verificar("si el peso no subió, tampoco (no se divide por cero ni por negativo)",
  c.conversionAlimenticia(pollos, alimento, [{ fecha: fechaDe(10), pesoPromedioKg: 2 }, { fecha: fechaDe(0), pesoPromedioKg: 1.9 }]).motivo === "sin_ganancia");
verificar("sin alimento cargado en el tramo, se dice",
  c.conversionAlimenticia(pollos, [], pesajes).motivo === "sin_alimento_en_el_tramo");

console.log("\n── 2. Totales y costo por animal ──");
const gastos = [
  { dia: dia(40), categoria: "compra_animales", montoCentavos: 500000 },
  { dia: dia(20), categoria: "alimento", montoCentavos: 300000, kg: 1500 },
  { dia: dia(3), categoria: "alimento", montoCentavos: 100000, kg: 700 },
  { dia: dia(2), categoria: "sanidad", montoCentavos: 20000 },
  { dia: dia(1), categoria: "alimento", kg: 70 }, // alimento propio: kilos sin plata
];
const r = c.resumenCostos(pollos, gastos, { pesajes, hoy: HOY });
verificar("total: 5000 + 3000 + 1000 + 200 = Bs 9200", r.total === 920000);
verificar("por categoría: alimento Bs 4000", r.porCategoria.alimento === 400000);
verificar("costo por animal vivo: 9200 / 1000 = Bs 9,20", cerca(r.costoPorAnimal, 920));
verificar("alimento por animal por día (últimos 7 días): (700 + 70) / 7 / 1000 = 0,11 kg",
  cerca(r.alimentoPorAnimalDia, 0.11));
verificar("el alimento sin monto igual suma kilos", r.alimentoKgTotal === 2270);

console.log("\n── 3. Costo por litro, y por litro vendible ──");
const vacas = { cantidadActual: 30 };
const serie = [];
for (let n = 29; n >= 0; n--) serie.push({ dia: dia(n), cantidad: 100, enRetiro: n < 10 });
const gastosTambo = [
  { dia: dia(45), categoria: "compra_animales", montoCentavos: 9000000 }, // fuera de la ventana de 30 días
  { dia: dia(15), categoria: "alimento", montoCentavos: 150000 },
  { dia: dia(5), categoria: "sanidad", montoCentavos: 30000 },
];
const rt = c.resumenCostos(vacas, gastosTambo, { tipoProduccion: "leche", serieProduccion: serie, hoy: HOY });
verificar("en la ventana de 30 días: 3000 L, 2000 vendibles", rt.porUnidad.litros === 3000 && rt.porUnidad.vendibles === 2000);
verificar("la compra de animales de hace 45 días NO entra al costo del litro", rt.porUnidad.costo30 === 180000);
verificar("costo por litro: Bs 1800 / 3000 L = Bs 0,60", cerca(rt.porUnidad.costoPorLitro, 60));
verificar("costo por litro VENDIBLE: Bs 1800 / 2000 L = Bs 0,90 — lo que costó el retiro", cerca(rt.porUnidad.costoPorLitroVendible, 90));

console.log("\n── 4. Costo por docena de huevos ──");
const ponedoras = { cantidadActual: 1000 };
const serieH = [];
for (let n = 29; n >= 0; n--) serieH.push({ dia: dia(n), cantidad: 850 });
const rh = c.resumenCostos(ponedoras, [{ dia: dia(10), categoria: "alimento", montoCentavos: 510000 }], { tipoProduccion: "huevos", serieProduccion: serieH, hoy: HOY });
verificar("25.500 huevos = 2125 docenas; Bs 5100 / 2125 = Bs 2,40 la docena", cerca(rh.porUnidad.costoPorDocena, 240));
verificar("sin gastos, no hay costo por unidad (no un «0» engañoso)",
  c.resumenCostos(ponedoras, [], { tipoProduccion: "huevos", serieProduccion: serieH, hoy: HOY }).porUnidad.costoPorDocena === null);

// ═══ 5. LAS RUTAS ════════════════════════════════════════════════════════
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({
      host: "127.0.0.1", port: puerto, method: metodo, path: ruta,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(datos ? { "content-type": "application/json", "content-length": Buffer.byteLength(datos) } : {}),
      },
    }, (res) => {
      let texto = "";
      res.on("data", (ch) => { texto += ch; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(texto); } catch { /* no es JSON */ }
        resolve({ estado: res.statusCode, cuerpo: json });
      });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("\n⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "costos_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, LoteGanado, GastoLote } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Campo", passwordHash: hash, moneda: "BOB" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);
  const lote = await LoteGanado.create({ medicoPhone: "70000001", especie: "porcino", nombre: "Engorde", codigo: "L-0001", cantidadInicial: 100, cantidadActual: 100, fechaIngreso: new Date("2026-01-01") });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "costos"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const GET = (ruta, tk) => pedir(puerto, "GET", ruta, tk);
  const POST = (ruta, tk, b) => pedir(puerto, "POST", ruta, tk, b);
  const DELETE = (ruta, tk) => pedir(puerto, "DELETE", ruta, tk);
  const ayer = sumarDias(diaDe(new Date()), -1);

  console.log("\n── 5. Cargar gastos ──");
  const r1 = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "alimento", concepto: "Balanceado inicial", monto: "1500.55", kg: 2000 });
  verificar("se carga (201)", r1.estado === 201);
  verificar("  ...con el monto en centavos, redondeado (150055)", r1.cuerpo?.gasto?.montoCentavos === 150055);
  verificar("  ...y la moneda de la cuenta", r1.cuerpo?.gasto?.moneda === "BOB");
  const rSoloKg = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "alimento", kg: 300 });
  verificar("alimento propio: solo kilos, sin plata, es válido", rSoloKg.estado === 201 && rSoloKg.cuerpo?.gasto?.montoCentavos === null);
  const rVacio = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "alimento" });
  verificar("un alimento sin plata NI kilos → 400", rVacio.estado === 400);
  const rSanSinMonto = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "sanidad", kg: 5 });
  verificar("un gasto de sanidad necesita monto (los kilos solo valen en alimento) → 400", rSanSinMonto.estado === 400);
  const rCat = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "caprichos", monto: 1 });
  verificar("una categoría que no existe → 400", rCat.estado === 400);
  const rNeg = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: ayer, categoria: "otros", monto: -10 });
  verificar("un monto negativo → 400", rNeg.estado === 400);
  const rFut = await POST(`/medico/lotes/${lote._id}/gastos`, tkA, { dia: sumarDias(diaDe(new Date()), 10), categoria: "otros", monto: 10 });
  verificar("un día futuro → 400", rFut.estado === 400);
  const rAjeno = await POST(`/medico/lotes/${lote._id}/gastos`, tkB, { dia: ayer, categoria: "otros", monto: 10 });
  verificar("el médico B no puede cargar en el lote de A → 404", rAjeno.estado === 404);

  console.log("\n── 6. El resumen, y la plata que no se mezcla ──");
  await GastoLote.create({ medicoPhone: "70000001", loteId: lote._id, dia: ayer, categoria: "otros", montoCentavos: 99999, moneda: "BRL" });
  const rRes = await GET(`/medico/lotes/${lote._id}/costos`, tkA);
  verificar("el total suma solo bolivianos (1500,55), no los reales", rRes.cuerpo?.resumen?.total === 150055);
  verificar("  ...y avisa que hay 1 gasto en otra moneda fuera de la cuenta", rRes.cuerpo?.gastosOtraMoneda === 1);
  verificar("  ...pero lo sigue listando", rRes.cuerpo?.gastos?.length === 3);
  verificar("el costo por animal es Bs 15,0055 (total / 100 cerdos)", cerca(rRes.cuerpo?.resumen?.costoPorAnimal, 1500.55));
  verificar("un lote de cerdos no tiene costo por litro ni por docena", rRes.cuerpo?.resumen?.porUnidad === null);
  const rResB = await GET(`/medico/lotes/${lote._id}/costos`, tkB);
  verificar("el médico B no ve los costos de A → 404", rResB.estado === 404);

  console.log("\n── 7. Borrar un gasto mal cargado ──");
  const id = r1.cuerpo.gasto._id;
  verificar("el médico B no puede borrarlo → 404", (await DELETE(`/medico/gastos/${id}`, tkB)).estado === 404);
  verificar("el dueño sí", (await DELETE(`/medico/gastos/${id}`, tkA)).estado === 200 && await GastoLote.countDocuments({ _id: id }) === 0);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
