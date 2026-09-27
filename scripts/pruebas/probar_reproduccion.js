// Symphomed Ganadería — reproducción de vacas y cerdas.
//
// ═══ LO QUE MÁS FÁCIL SE ROMPE ════════════════════════════════════════════
//
// El estado de una hembra se calcula de su historia, no se guarda. Eso
// evita dos verdades, pero pone todo el peso en el cálculo: si confunde un
// diagnóstico viejo con uno nuevo, una vaca vacía figura preñada, nadie la
// vuelve a servir, y se pierde un ciclo entero — veintiún días de una vaca
// que no produce. Por eso la primera mitad de esta prueba son historias
// armadas a mano, una por cada trampa conocida.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const r = require(path.join(RAIZ, "services", "reproduccion"));
const HOY = new Date("2026-09-27T12:00:00Z");
const hace = (n) => new Date(HOY.getTime() - n * 86400000);
const vaca = { especie: "bovino" };
const cerda = { especie: "porcino" };

console.log("── 1. El estado sale de la historia ──");
verificar("sin eventos, una vaca está vacía", r.estadoReproductivo(vaca, [], HOY).prenez === "vacia");

const servida = r.estadoReproductivo(vaca, [{ tipo: "servicio", fecha: hace(10) }], HOY);
verificar("servida y sin diagnóstico → «servida», no «preñada»", servida.prenez === "servida");
verificar("  ...ya con fecha probable de parto (servicio + 283 días)",
  servida.fechaProbableParto && Math.round((servida.fechaProbableParto - hace(10)) / 86400000) === 283);

const prenada = r.estadoReproductivo(vaca, [
  { tipo: "servicio", fecha: hace(60) },
  { tipo: "diagnostico", fecha: hace(20), resultado: "prenada" },
], HOY);
verificar("servicio + diagnóstico positivo → preñada", prenada.prenez === "prenada");

console.log("\n── 2. Las trampas ──");
// Diagnóstico «vacía», la vuelven a servir: el «vacía» viejo NO puede
// dejarla vacía — es de antes del servicio nuevo.
const reservida = r.estadoReproductivo(vaca, [
  { tipo: "servicio", fecha: hace(80) },
  { tipo: "diagnostico", fecha: hace(45), resultado: "vacia" },
  { tipo: "servicio", fecha: hace(30) },
], HOY);
verificar("un diagnóstico «vacía» de ANTES del servicio nuevo no cuenta", reservida.prenez === "servida");

// Un «preñada» de la gestación anterior no dice nada después del parto.
const trasParto = r.estadoReproductivo(vaca, [
  { tipo: "servicio", fecha: hace(400) },
  { tipo: "diagnostico", fecha: hace(360), resultado: "prenada" },
  { tipo: "parto", fecha: hace(117), criasVivas: 1 },
], HOY);
verificar("después del parto, el «preñada» de la gestación anterior ya no vale", trasParto.prenez === "vacia");
verificar("  ...y está lactando", trasParto.lactando === true);
verificar("  ...con 117 días abiertos", trasParto.diasAbiertos === 117);

// Lactando Y preñada otra vez: las dos cosas a la vez, que es lo normal en
// un tambo.
const lactandoYPrenada = r.estadoReproductivo(vaca, [
  { tipo: "parto", fecha: hace(150) },
  { tipo: "servicio", fecha: hace(70) },
  { tipo: "diagnostico", fecha: hace(30), resultado: "prenada" },
], HOY);
verificar("puede estar lactando y preñada a la vez", lactandoYPrenada.lactando && lactandoYPrenada.prenez === "prenada");
verificar("  ...y los días abiertos terminan en el servicio que prendió (150-70 = 80), no hoy",
  lactandoYPrenada.diasAbiertos === 80);

const secada = r.estadoReproductivo(vaca, [
  { tipo: "parto", fecha: hace(300) },
  { tipo: "secado", fecha: hace(10) },
], HOY);
verificar("secada, ya no está lactando", secada.lactando === false);

const abortada = r.estadoReproductivo(vaca, [
  { tipo: "servicio", fecha: hace(100) },
  { tipo: "diagnostico", fecha: hace(60), resultado: "prenada" },
  { tipo: "aborto", fecha: hace(5) },
], HOY);
verificar("un aborto cierra la preñez: vuelve a vacía", abortada.prenez === "vacia");
verificar("  ...y un aborto no es un parto: no está lactando", abortada.lactando === false);

// Los eventos pueden llegar desordenados (el veterinario carga hoy lo de
// la semana pasada).
const desordenada = r.estadoReproductivo(vaca, [
  { tipo: "diagnostico", fecha: hace(20), resultado: "prenada" },
  { tipo: "servicio", fecha: hace(60) },
], HOY);
verificar("eventos cargados fuera de orden dan el mismo estado", desordenada.prenez === "prenada");

const cerdaServida = r.estadoReproductivo(cerda, [{ tipo: "servicio", fecha: hace(5) }], HOY);
verificar("una cerda pare a los 114 días, no a los 283",
  Math.round((cerdaServida.fechaProbableParto - hace(5)) / 86400000) === 114);

console.log("\n── 3. Las alertas: lo que se atrasó se dice ──");
const tipos = (animal, eventos) => r.alertas(animal, r.estadoReproductivo(animal, eventos, HOY), HOY).map(a => a.tipo);

verificar("servida hace 40 días sin diagnóstico → diagnóstico pendiente",
  tipos(vaca, [{ tipo: "servicio", fecha: hace(40) }]).includes("diagnostico_pendiente"));
verificar("  ...pero servida hace 10 días todavía no (antes de los 35 no es confiable)",
  !tipos(vaca, [{ tipo: "servicio", fecha: hace(10) }]).includes("diagnostico_pendiente"));

verificar("preñada y pare en 10 días → parto próximo",
  tipos(vaca, [{ tipo: "servicio", fecha: hace(273) }, { tipo: "diagnostico", fecha: hace(230), resultado: "prenada" }]).includes("parto_proximo"));
verificar("preñada y pare en 100 días → nada que avisar",
  tipos(vaca, [{ tipo: "servicio", fecha: hace(183) }, { tipo: "diagnostico", fecha: hace(140), resultado: "prenada" }]).length === 0);
verificar("la fecha pasó hace 20 días y no hay parto cargado → parto atrasado",
  tipos(vaca, [{ tipo: "servicio", fecha: hace(303) }, { tipo: "diagnostico", fecha: hace(260), resultado: "prenada" }]).includes("parto_atrasado"));

verificar("vaca vacía a los 117 días del parto → vacía prolongada",
  tipos(vaca, [{ tipo: "parto", fecha: hace(117) }]).includes("vacia_prolongada"));
verificar("  ...a los 60 días todavía no", !tipos(vaca, [{ tipo: "parto", fecha: hace(60) }]).includes("vacia_prolongada"));
verificar("  ...y en la cerda no se usa (su ritmo lo marca el destete)",
  !tipos(cerda, [{ tipo: "parto", fecha: hace(117) }]).includes("vacia_prolongada"));

console.log("\n── 4. Indicadores ──");
const ind = r.indicadores([
  { tipo: "parto", fecha: hace(800), criasVivas: 11 },
  { tipo: "parto", fecha: hace(400), criasVivas: 13 },
  { tipo: "parto", fecha: hace(20), criasVivas: 12 },
  { tipo: "destete", fecha: hace(380), criasDestetadas: 10 },
]);
verificar("3 partos", ind.partos === 3);
verificar("intervalo entre partos promedio: (400 + 380) / 2 = 390", ind.intervaloEntrePartosPromedio === 390);
verificar("crías vivas promedio: 12", ind.criasVivasPromedio === 12);
verificar("con un solo parto, el intervalo es «no se sabe», no 0",
  r.indicadores([{ tipo: "parto", fecha: hace(10) }]).intervaloEntrePartosPromedio === null);

console.log("\n── 5. El resumen del lote ──");
const resumen = r.resumenLote([
  { animalId: 1, identificador: "A1", activa: true, prenez: "prenada", fechaProbableParto: new Date(HOY.getTime() + 5 * 86400000), alertas: [] },
  { animalId: 2, identificador: "A2", activa: true, prenez: "vacia", alertas: [] },
  { animalId: 3, identificador: "A3", activa: true, prenez: "servida", alertas: [{ tipo: "diagnostico_pendiente" }] },
  { animalId: 4, identificador: "A4", activa: false, prenez: "prenada", fechaProbableParto: new Date(HOY.getTime() + 2 * 86400000), alertas: [] },
], HOY);
verificar("cuenta solo las hembras activas (3, no 4)", resumen.hembras === 3);
verificar("  ...y el % de preñez es sobre ellas (1 de 3)", Math.abs(resumen.porcentajePrenez - 100 / 3) < 1e-9);
verificar("una vendida preñada no aparece en próximos partos",
  resumen.proximosPartos.length === 1 && resumen.proximosPartos[0].identificador === "A1");
verificar("cuenta los diagnósticos pendientes", resumen.diagnosticosPendientes === 1);

// ═══ 6. LAS RUTAS, contra una base de verdad ════════════════════════════
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
    console.log("\n⏭️  Rutas SALTEADAS: no hay base de datos (npm i --no-save mongodb-memory-server).");
    console.log(fallos === 0 ? "\n🏁 TODO BIEN (sin rutas)" : `\n💥 ${fallos} problema(s)`);
    process.exit(fallos === 0 ? 0 : 1);
  }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "reproduccion_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, LoteGanado, AnimalGanado } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await AnimalGanado.init(); // el índice único ES lo que se prueba abajo

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Tambo", passwordHash: hash, tipoEspecialidad: "veterinaria" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash, tipoEspecialidad: "veterinaria" });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);

  const rodeo = await LoteGanado.create({ medicoPhone: "70000001", especie: "bovino", nombre: "Tambo", codigo: "L-0001", cantidadInicial: 50, cantidadActual: 50, fechaIngreso: new Date("2025-01-01") });
  const galpon = await LoteGanado.create({ medicoPhone: "70000001", especie: "avicola", nombre: "Galpón", codigo: "L-0002", cantidadInicial: 1000, cantidadActual: 1000, fechaIngreso: new Date("2025-01-01") });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "reproduccion"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const GET = (ruta, tk) => pedir(puerto, "GET", ruta, tk);
  const POST = (ruta, tk, c) => pedir(puerto, "POST", ruta, tk, c);
  const PATCH = (ruta, tk, c) => pedir(puerto, "PATCH", ruta, tk, c);
  const dia = (n) => new Date(Date.now() - n * 86400000).toISOString();

  console.log("\n── 6. Hembras de un lote ──");
  const rV = await POST(`/medico/lotes/${rodeo._id}/animales`, tkA, { identificador: "1042", nombre: "Manchita", raza: "Holando" });
  verificar("se agrega una vaca (201)", rV.estado === 201 && rV.cuerpo?.animal?.especie === "bovino");
  const vacaId = rV.cuerpo.animal._id;

  const rDup = await POST(`/medico/lotes/${rodeo._id}/animales`, tkA, { identificador: "1042" });
  verificar("el mismo arete dos veces en el lote → 409", rDup.estado === 409);
  const rAve = await POST(`/medico/lotes/${galpon._id}/animales`, tkA, { identificador: "G1" });
  verificar("en un lote de aves no hay seguimiento reproductivo → 400", rAve.estado === 400);
  const rSinId = await POST(`/medico/lotes/${rodeo._id}/animales`, tkA, { nombre: "Sin arete" });
  verificar("sin identificador → 400", rSinId.estado === 400);
  const rAjena = await POST(`/medico/lotes/${rodeo._id}/animales`, tkB, { identificador: "X" });
  verificar("el médico B no puede agregar al lote de A → 404", rAjena.estado === 404);
  const rIdMalo = await GET("/medico/animales/no-es-un-id", tkA);
  verificar("un id con forma inválida → 404, no 500", rIdMalo.estado === 404);

  console.log("\n── 7. Eventos y estado ──");
  const rServ = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "servicio", fecha: dia(50), metodo: "inseminacion", reproductor: "Toro Rubí (pajuela)" });
  verificar("se carga el servicio", rServ.estado === 201);
  verificar("  ...y la respuesta ya trae el estado recalculado: servida", rServ.cuerpo?.reproduccion?.prenez === "servida");
  verificar("  ...con el diagnóstico pendiente (50 días > 35)",
    rServ.cuerpo?.reproduccion?.alertas?.some(a => a.tipo === "diagnostico_pendiente"));

  const rDiag = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "diagnostico", fecha: dia(2), resultado: "prenada" });
  verificar("diagnóstico positivo → preñada", rDiag.cuerpo?.reproduccion?.prenez === "prenada");

  const rSinResultado = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "diagnostico", fecha: dia(1) });
  verificar("un diagnóstico sin resultado → 400", rSinResultado.estado === 400);
  const rFuturo = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "parto", fecha: new Date(Date.now() + 30 * 86400000).toISOString() });
  verificar("un evento con fecha futura → 400", rFuturo.estado === 400);
  const rNegativo = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "parto", fecha: dia(1), criasVivas: -1 });
  verificar("crías negativas → 400", rNegativo.estado === 400);
  const rTipo = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "brujeria", fecha: dia(1) });
  verificar("un tipo que no existe → 400", rTipo.estado === 400);
  const rEvAjeno = await POST(`/medico/animales/${vacaId}/eventos`, tkB, { tipo: "servicio", fecha: dia(1) });
  verificar("el médico B no puede cargar eventos en la vaca de A → 404", rEvAjeno.estado === 404);

  console.log("\n── 8. El resumen del lote ──");
  await POST(`/medico/lotes/${rodeo._id}/animales`, tkA, { identificador: "1043" });
  const rLista = await GET(`/medico/lotes/${rodeo._id}/animales`, tkA);
  verificar("la lista trae las 2 vacas", rLista.cuerpo?.animales?.length === 2);
  verificar("  ...cada una con su estado reproductivo calculado",
    rLista.cuerpo?.animales?.find(a => a._id === vacaId)?.reproduccion?.prenez === "prenada");
  verificar("  ...y el resumen: 1 de 2 preñadas (50%)",
    rLista.cuerpo?.resumen?.hembras === 2 && rLista.cuerpo?.resumen?.porcentajePrenez === 50);
  verificar("  ...con su parto en la lista de próximos partos",
    rLista.cuerpo?.resumen?.proximosPartos?.[0]?.identificador === "1042");
  const rListaB = await GET(`/medico/lotes/${rodeo._id}/animales`, tkB);
  verificar("el médico B no ve las vacas de A → 404", rListaB.estado === 404);

  console.log("\n── 9. Dar de baja ──");
  const rBaja = await PATCH(`/medico/animales/${vacaId}/baja`, tkA, { motivo: "vendida" });
  verificar("se da de baja", rBaja.estado === 200 && rBaja.cuerpo?.animal?.activa === false);
  const rEvBaja = await POST(`/medico/animales/${vacaId}/eventos`, tkA, { tipo: "parto", fecha: dia(0) });
  verificar("  ...y ya no admite eventos", rEvBaja.estado === 400);
  const rTrasBaja = await GET(`/medico/lotes/${rodeo._id}/animales`, tkA);
  verificar("  ...ni cuenta para el % de preñez de hoy (0 de 1)",
    rTrasBaja.cuerpo?.resumen?.hembras === 1 && rTrasBaja.cuerpo?.resumen?.prenadas === 0);
  const rFicha = await GET(`/medico/animales/${vacaId}`, tkA);
  verificar("  ...pero su historia sigue ahí", rFicha.cuerpo?.eventos?.length === 2);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
