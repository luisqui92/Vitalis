// Symphomed Ganadería — producción: leche y huevos.
//
// ═══ LO QUE NO PUEDE FALLAR ═══════════════════════════════════════════════
//
//   · La leche de un día en retiro tiene que salir marcada como no
//     vendible. Si no, termina en el tanque: es un riesgo de inocuidad, no
//     un error de pantalla.
//   · Cargar el mismo día dos veces CORRIGE, no suma. Si sumara, un
//     encargado que se equivoca y vuelve a cargar le duplica al dueño la
//     producción del día.
//   · Una caída de postura se mide en %, no en huevos: si murieron
//     gallinas, los huevos bajan sin que las que quedan pongan menos, y eso
//     no es un síntoma.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const p = require(path.join(RAIZ, "services", "produccion"));
const HOY = new Date("2026-09-27T15:00:00Z");
const dia = (n) => p.sumarDias(p.diaDe(HOY), -n); // hace n días, "YYYY-MM-DD"

console.log("── 1. Qué leche está en retiro ──");
const tratado = [{ tipo: "tratamiento", fecha: new Date(`${dia(3)}T00:00:00Z`), diasRetiroLeche: 5, producto: "Oxitetraciclina" }];
const enRetiro = p.diasEnRetiroLeche(tratado);
verificar("el día de la aplicación ya está en retiro", Boolean(enRetiro(dia(3))));
verificar("el último día del retiro (aplicación + 4) también", Boolean(enRetiro(dia(-1))));
verificar("el día de la liberación (aplicación + 5) ya NO", !enRetiro(dia(-2)));
verificar("el día anterior a la aplicación tampoco", !enRetiro(dia(4)));
verificar("un retiro solo de carne no toca la leche",
  !p.diasEnRetiroLeche([{ tipo: "tratamiento", fecha: new Date(), diasRetiroCarne: 10 }])(p.diaDe(new Date())));

console.log("\n── 2. El resumen de leche ──");
const leche = [];
for (let n = 13; n >= 7; n--) leche.push({ dia: dia(n), cantidad: 500 });
for (let n = 6; n >= 0; n--) leche.push({ dia: dia(n), cantidad: 400 });
const rl = p.resumenProduccion("leche", leche, { eventosLote: tratado, hoy: HOY });
verificar("promedio de los últimos 7 días: 400", rl.promedio7 === 400);
verificar("de la semana anterior: 500", rl.promedioPrevio7 === 500);
verificar("variación -20%", Math.round(rl.variacionPct) === -20);
verificar("una caída del 20% dispara la alerta (umbral 15%)", rl.alertas.some(a => a.tipo === "caida" && a.pct === 20));
const marcados = rl.serie.filter(r => r.enRetiro).map(r => r.dia);
verificar("los 4 días de la semana cubiertos por el retiro salen marcados", marcados.length === 4 && marcados.includes(dia(3)) && marcados.includes(dia(0)));
verificar("  ...con el producto que lo causó", rl.serie.find(r => r.dia === dia(0)).productoRetiro === "Oxitetraciclina");
verificar("litros vendibles de la semana = 7 días − 4 en retiro = 1200", rl.vendible7 === 1200);
verificar("y se avisa cuánta leche no se puede vender", rl.alertas.some(a => a.tipo === "leche_en_retiro" && a.litros === 1600));

const estable = p.resumenProduccion("leche", [{ dia: dia(8), cantidad: 500 }, { dia: dia(1), cantidad: 470 }], { hoy: HOY });
verificar("una baja del 6% no es alerta (es ruido normal)", !estable.alertas.some(a => a.tipo === "caida"));

// Si nadie cargó nada en la última semana, no hay promedio de "esta
// semana" — no se muestra el viejo como si fuera el de hoy.
const viejo = p.resumenProduccion("leche", [{ dia: dia(20), cantidad: 500 }], { hoy: HOY });
verificar("sin registros esta semana, el promedio es «no hay», no el de hace 20 días", viejo.promedio7 === null);

console.log("\n── 3. Huevos: la caída se mide en % de postura ──");
// Murieron gallinas (de 1000 a 800) pero las que quedan ponen igual (85%).
const huevosConMortalidad = [];
for (let n = 13; n >= 7; n--) huevosConMortalidad.push({ dia: dia(n), cantidad: 850, animales: 1000 });
for (let n = 6; n >= 0; n--) huevosConMortalidad.push({ dia: dia(n), cantidad: 680, animales: 800 });
const rh = p.resumenProduccion("huevos", huevosConMortalidad, { hoy: HOY });
verificar("% de postura: 680 de 800 = 85%", rh.ultimo.porAnimal === 85);
verificar("menos huevos por mortalidad, pero la misma postura → NO es alerta", !rh.alertas.some(a => a.tipo === "caida"));
const posturaEnCaida = [];
for (let n = 13; n >= 7; n--) posturaEnCaida.push({ dia: dia(n), cantidad: 900, animales: 1000 });
for (let n = 6; n >= 0; n--) posturaEnCaida.push({ dia: dia(n), cantidad: 750, animales: 1000 });
verificar("postura de 90% a 75% con las mismas gallinas → alerta de caída",
  p.resumenProduccion("huevos", posturaEnCaida, { hoy: HOY }).alertas.some(a => a.tipo === "caida"));
verificar("los huevos no tienen «leche en retiro»",
  !p.resumenProduccion("huevos", posturaEnCaida, { eventosLote: tratado, hoy: HOY }).serie.some(r => r.enRetiro));

console.log("\n── 4. Control lechero individual ──");
const parto = new Date(`${dia(40)}T00:00:00Z`);
verificar("días en leche: control de hoy, parida hace 40 días → 40", p.diasEnLeche(parto, dia(0)) === 40);
verificar("sin parto cargado, no hay días en leche", p.diasEnLeche(null, dia(0)) === null);
const rc = p.resumenControles([
  { dia: dia(400), litros: 30 }, // lactancia anterior
  { dia: dia(30), litros: 22 },
  { dia: dia(10), litros: 28 },
], parto);
verificar("el promedio de la lactancia no mezcla la anterior: (22+28)/2 = 25", rc.promedioLactancia === 25);
verificar("el pico es el de esta lactancia (28), no el viejo (30)", rc.pico.litros === 28);
const lote = p.resumenControlLote([
  { animalId: "a", dia: dia(5), litros: 20 },
  { animalId: "a", dia: dia(1), litros: 18 },
  { animalId: "b", dia: dia(1), litros: 30 },
], new Map([["a", { identificador: "1042" }], ["b", { identificador: "1043" }]]));
verificar("el control del lote es el del último día (2 vacas)", lote.dia === dia(1) && lote.vacas === 2);
verificar("  ...de la mejor a la peor", lote.vacasDelDia[0].identificador === "1043");

// ═══ 5. LAS RUTAS, contra una base de verdad ════════════════════════════
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
      res.on("data", (c) => { texto += c; });
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
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) {
    console.log("\n⏭️  Rutas SALTEADAS: no hay base de datos.");
    process.exit(fallos === 0 ? 0 : 1);
  }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "produccion_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, LoteGanado, EventoLote, AnimalGanado, RegistroProduccion, ControlLechero } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await RegistroProduccion.init();
  await ControlLechero.init();

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Tambo", passwordHash: hash });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);
  const base = { medicoPhone: "70000001", cantidadInicial: 40, cantidadActual: 40, fechaIngreso: new Date("2026-01-01") };
  const tambo = await LoteGanado.create({ ...base, especie: "bovino", nombre: "Tambo", codigo: "L-0001" });
  const galpon = await LoteGanado.create({ ...base, especie: "avicola", nombre: "Ponedoras", codigo: "L-0002", cantidadInicial: 1000, cantidadActual: 950 });
  const corral = await LoteGanado.create({ ...base, especie: "porcino", nombre: "Engorde", codigo: "L-0003" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "produccion"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const GET = (ruta, tk) => pedir(puerto, "GET", ruta, tk);
  const PUT = (ruta, tk, c) => pedir(puerto, "PUT", ruta, tk, c);
  const DELETE = (ruta, tk) => pedir(puerto, "DELETE", ruta, tk);
  const hoy = p.diaDe(new Date());
  const ayer = p.sumarDias(hoy, -1);

  console.log("\n── 5. Cargar producción por día ──");
  const r1 = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: ayer, cantidad: 480, animales: 30 });
  verificar("se carga la leche de ayer", r1.estado === 200 && r1.cuerpo?.registro?.tipo === "leche");
  const r2 = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: ayer, cantidad: 520 });
  verificar("cargar el MISMO día otra vez corrige el número (520), no suma", r2.cuerpo?.registro?.cantidad === 520);
  verificar("  ...y sigue habiendo un solo registro de ese día",
    await RegistroProduccion.countDocuments({ loteId: tambo._id, dia: ayer }) === 1);

  const rCerdo = await PUT(`/medico/lotes/${corral._id}/produccion`, tkA, { dia: ayer, cantidad: 10 });
  verificar("un lote de cerdos no lleva producción diaria → 400", rCerdo.estado === 400);
  const rFuturo = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: p.sumarDias(hoy, 5), cantidad: 10 });
  verificar("un día que todavía no pasó → 400", rFuturo.estado === 400);
  const rFormato = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: "27/09/2026", cantidad: 10 });
  verificar("un día mal escrito → 400", rFormato.estado === 400);
  const rInexistente = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: "2026-02-30", cantidad: 10 });
  verificar("el 30 de febrero → 400", rInexistente.estado === 400);
  const rNeg = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: ayer, cantidad: -5 });
  verificar("una cantidad negativa → 400", rNeg.estado === 400);
  const rAjeno = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkB, { dia: ayer, cantidad: 1 });
  verificar("el médico B no puede cargar en el lote de A → 404", rAjeno.estado === 404);

  console.log("\n── 6. La leche en retiro se avisa al cargarla ──");
  await EventoLote.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "tratamiento", fecha: new Date(`${ayer}T00:00:00Z`), producto: "Oxitetraciclina", diasRetiroLeche: 4 });
  const rRetiro = await PUT(`/medico/lotes/${tambo._id}/produccion`, tkA, { dia: hoy, cantidad: 500 });
  verificar("la respuesta avisa que esa leche está en retiro", rRetiro.cuerpo?.enRetiro === true);
  verificar("  ...y por qué producto", rRetiro.cuerpo?.productoRetiro === "Oxitetraciclina");
  const rLeche = await GET(`/medico/lotes/${tambo._id}/produccion`, tkA);
  verificar("el resumen marca los dos días en retiro",
    rLeche.cuerpo?.resumen?.serie?.filter(r => r.enRetiro).length === 2);
  verificar("  ...y ninguno de los dos cuenta como vendible", rLeche.cuerpo?.resumen?.vendible7 === 0);

  console.log("\n── 7. Huevos ──");
  const rH = await PUT(`/medico/lotes/${galpon._id}/produccion`, tkA, { dia: ayer, cantidad: 800 });
  verificar("sin gallinas indicadas, se toman las vivas del lote (950)", rH.cuerpo?.registro?.animales === 950);
  const rDeMas = await PUT(`/medico/lotes/${galpon._id}/produccion`, tkA, { dia: ayer, cantidad: 800, animales: 5000 });
  verificar("más gallinas que las vivas del lote → 400", rDeMas.estado === 400);
  const rHuevos = await GET(`/medico/lotes/${galpon._id}/produccion`, tkA);
  verificar("el % de postura sale calculado (800 de 950 ≈ 84.2%)",
    Math.abs(rHuevos.cuerpo?.resumen?.ultimo?.porAnimal - (800 / 950) * 100) < 1e-9);
  verificar("el GET de un lote de cerdos dice que no aplica", (await GET(`/medico/lotes/${corral._id}/produccion`, tkA)).cuerpo?.tipo === null);

  console.log("\n── 8. Control lechero de una vaca ──");
  const vaca = await AnimalGanado.create({ medicoPhone: "70000001", loteId: tambo._id, especie: "bovino", identificador: "1042" });
  const cerda = await AnimalGanado.create({ medicoPhone: "70000001", loteId: corral._id, especie: "porcino", identificador: "C7" });
  const rC = await PUT(`/medico/animales/${vaca._id}/controles-lecheros`, tkA, { dia: ayer, litros: 24.5 });
  verificar("se carga el control", rC.estado === 200 && rC.cuerpo?.control?.litros === 24.5);
  await PUT(`/medico/animales/${vaca._id}/controles-lecheros`, tkA, { dia: ayer, litros: 25 });
  verificar("el mismo día otra vez corrige, no duplica", await ControlLechero.countDocuments({ animalId: vaca._id }) === 1);
  const rCerda = await PUT(`/medico/animales/${cerda._id}/controles-lecheros`, tkA, { dia: ayer, litros: 5 });
  verificar("el control lechero es para vacas: una cerda → 400", rCerda.estado === 400);
  const rVacaAjena = await PUT(`/medico/animales/${vaca._id}/controles-lecheros`, tkB, { dia: ayer, litros: 5 });
  verificar("el médico B no puede cargar controles en la vaca de A → 404", rVacaAjena.estado === 404);
  const rControles = await GET(`/medico/animales/${vaca._id}/controles-lecheros`, tkA);
  verificar("la ficha trae el último control (25 L)", rControles.cuerpo?.ultimo?.litros === 25);
  const rLote = await GET(`/medico/lotes/${tambo._id}/produccion`, tkA);
  verificar("el lote muestra el último control individual (1 vaca, 25 L)",
    rLote.cuerpo?.controlLote?.vacas === 1 && rLote.cuerpo?.controlLote?.promedio === 25);

  console.log("\n── 9. Borrar un registro mal cargado ──");
  const idHuevos = rH.cuerpo.registro._id;
  const rBorrarAjeno = await DELETE(`/medico/produccion/${idHuevos}`, tkB);
  verificar("el médico B no puede borrar un registro de A → 404", rBorrarAjeno.estado === 404);
  const rBorrar = await DELETE(`/medico/produccion/${idHuevos}`, tkA);
  verificar("el dueño sí", rBorrar.estado === 200 && await RegistroProduccion.countDocuments({ _id: idHuevos }) === 0);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
