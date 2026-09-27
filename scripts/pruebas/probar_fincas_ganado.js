// Symphomed Ganadería — fincas y el dueño que recibe las alertas.
//
// ═══ POR QUÉ EL DUEÑO ═════════════════════════════════════════════════════
//
// Quien decide cuándo se faena o se vende la leche es el dueño, no el
// veterinario. Una alerta de retiro que solo le llega al veterinario depende
// de que él se acuerde de reenviarla. Esta prueba verifica que el aviso le
// llegue a los dos, y sobre todo lo que NO puede pasar: que un número del
// dueño mal cargado deje al veterinario sin su aviso, o que el trabajo de
// cada hora le vuelva a escribir para siempre por culpa de un número ajeno.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// El envío de WhatsApp se reemplaza ANTES de requerir nada que lo use, para
// que services/alertaRetiroGanado.js agarre esta versión al desestructurar.
// Anota a quién se le mandó; un número que termina en 000 simula un número
// que Meta rechaza.
const enviados = [];
const whatsapp = require(path.join(RAIZ, "services", "metaWhatsapp"));
whatsapp.enviarTextoOPlantilla = async (destino, texto) => {
  if (String(destino).endsWith("000")) throw new Error("número inválido (simulado)");
  enviados.push({ destino, texto });
  return { ok: true };
};

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

async function main() {
  let MongoMemoryServer;
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar (npm i --no-save mongodb-memory-server).");
    process.exit(0);
  }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "fincas_prueba";

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Finca, LoteGanado, EventoLote } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { procesarRetirosLiberados } = require(path.join(RAIZ, "services", "alertaRetiroGanado"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dr. Campo A", passwordHash: hash, tipoEspecialidad: "veterinaria" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Campo B (ajeno)", passwordHash: hash, tipoEspecialidad: "veterinaria" });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "lotesGanado"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const GET = (ruta, tk) => pedir(puerto, "GET", ruta, tk);
  const POST = (ruta, tk, c) => pedir(puerto, "POST", ruta, tk, c);
  const PATCH = (ruta, tk, c) => pedir(puerto, "PATCH", ruta, tk, c);

  console.log("── 1. Crear una finca con su dueño ──");
  const rF = await POST("/medico/fincas", tkA, {
    nombre: "Estancia Los Álamos", ubicacion: "Km 12 carretera a Cotoca",
    duenoNombre: "Don Ramiro", duenoTelefono: "7123-4567",
  });
  verificar("se crea (201)", rF.estado === 201);
  verificar("  ...con código F-0001", rF.cuerpo?.finca?.codigo === "F-0001");
  verificar("  ...y el teléfono queda solo con dígitos (sin el guion)", rF.cuerpo?.finca?.duenoTelefono === "71234567");
  const fincaId = rF.cuerpo.finca._id;

  const rSinNombre = await POST("/medico/fincas", tkA, { duenoNombre: "x" });
  verificar("una finca sin nombre → 400", rSinNombre.estado === 400);

  console.log("\n── 2. Un lote se engancha a su finca ──");
  const rL = await POST("/medico/lotes", tkA, {
    especie: "bovino", nombre: "Rodeo lechero", cantidadInicial: 40, fechaIngreso: "2026-01-10", fincaId,
  });
  verificar("el lote se crea con su finca", rL.estado === 201 && rL.cuerpo?.lote?.fincaId === fincaId);
  const loteId = rL.cuerpo.lote._id;

  const rSuelto = await POST("/medico/lotes", tkA, {
    especie: "avicola", nombre: "Galpón suelto", cantidadInicial: 500, fechaIngreso: "2026-01-10",
  });
  verificar("un lote sin finca sigue siendo válido", rSuelto.estado === 201 && rSuelto.cuerpo?.lote?.fincaId === null);

  const rIdMalo = await POST("/medico/lotes", tkA, {
    especie: "bovino", nombre: "x", cantidadInicial: 1, fechaIngreso: "2026-01-10", fincaId: "no-es-un-id",
  });
  verificar("un fincaId con forma inválida → 400, no un 500", rIdMalo.estado === 400);

  const rFincaAjena = await POST("/medico/lotes", tkB, {
    especie: "bovino", nombre: "x", cantidadInicial: 1, fechaIngreso: "2026-01-10", fincaId,
  });
  verificar("el médico B no puede colgar un lote de la finca de A → 404", rFincaAjena.estado === 404);

  console.log("\n── 3. Listas y detalle ──");
  const rLista = await GET("/medico/fincas", tkA);
  verificar("la lista de fincas cuenta 1 lote activo", rLista.cuerpo?.fincas?.[0]?.lotesActivos === 1);
  const rListaB = await GET("/medico/fincas", tkB);
  verificar("el médico B no ve la finca de A", rListaB.cuerpo?.fincas?.length === 0);

  const rLotes = await GET("/medico/lotes", tkA);
  const conFinca = rLotes.cuerpo?.lotes?.find(l => l._id === loteId);
  verificar("cada lote de la lista trae el nombre de su finca", conFinca?.fincaNombre === "Estancia Los Álamos");

  const rFiltrado = await GET(`/medico/lotes?fincaId=${fincaId}`, tkA);
  verificar("filtrar por finca deja solo sus lotes", rFiltrado.cuerpo?.lotes?.length === 1);

  const rDetalle = await GET(`/medico/lotes/${loteId}`, tkA);
  verificar("el detalle del lote trae la finca con el dueño", rDetalle.cuerpo?.finca?.duenoNombre === "Don Ramiro");

  console.log("\n── 4. Editar sin borrar lo que no se tocó ──");
  const rEdit = await PATCH(`/medico/fincas/${fincaId}`, tkA, { duenoTelefono: "76543210" });
  verificar("cambia el teléfono", rEdit.cuerpo?.finca?.duenoTelefono === "76543210");
  verificar("  ...y la ubicación sigue ahí", rEdit.cuerpo?.finca?.ubicacion === "Km 12 carretera a Cotoca");
  const rEditAjena = await PATCH(`/medico/fincas/${fincaId}`, tkB, { nombre: "Robada" });
  verificar("el médico B no puede editar la finca de A → 404", rEditAjena.estado === 404);

  const rMover = await PATCH(`/medico/lotes/${rSuelto.cuerpo.lote._id}`, tkA, { fincaId });
  verificar("un lote suelto se puede pasar a una finca", rMover.cuerpo?.lote?.fincaId === fincaId);
  const rSoltar = await PATCH(`/medico/lotes/${rSuelto.cuerpo.lote._id}`, tkA, { fincaId: null });
  verificar("  ...y volver a quedar suelto", rSoltar.estado === 200 && rSoltar.cuerpo?.lote?.fincaId === null);

  console.log("\n── 5. El aviso de retiro le llega al dueño también ──");
  enviados.length = 0;
  const rTrat = await POST(`/medico/lotes/${loteId}/eventos`, tkA, {
    tipo: "tratamiento", fecha: new Date().toISOString(), producto: "Oxitetraciclina", diasRetiroLeche: 5,
  });
  verificar("el tratamiento se carga", rTrat.estado === 201);
  // El aviso sale fuera del camino de la respuesta: se le da un momento.
  for (let i = 0; i < 20 && enviados.length < 2; i++) await new Promise(r => setTimeout(r, 50));
  const destinos = enviados.map(e => e.destino);
  verificar("le llega al veterinario", destinos.includes("70000001"));
  verificar("  ...y al dueño, con el prefijo del país puesto", destinos.includes("59176543210"));
  verificar("  ...una vez a cada uno", destinos.length === 2);

  console.log("\n── 6. Sin finca, o sin teléfono del dueño, solo al veterinario ──");
  enviados.length = 0;
  const loteSinFinca = await LoteGanado.create({
    medicoPhone: "70000001", especie: "porcino", nombre: "Corral", codigo: "L-0090",
    cantidadInicial: 10, cantidadActual: 10, fechaIngreso: new Date("2026-01-01"),
  });
  await POST(`/medico/lotes/${loteSinFinca._id}/eventos`, tkA, {
    tipo: "tratamiento", fecha: new Date().toISOString(), producto: "X", diasRetiroCarne: 3,
  });
  for (let i = 0; i < 20 && enviados.length < 1; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 100));
  verificar("un lote sin finca avisa solo al veterinario", enviados.length === 1 && enviados[0].destino === "70000001");

  console.log("\n── 7. Si el dueño ES el veterinario, no se le escribe dos veces ──");
  enviados.length = 0;
  const fincaPropia = await Finca.create({ medicoPhone: "70000001", nombre: "Mi campo", duenoTelefono: "70000001" });
  const lotePropio = await LoteGanado.create({
    medicoPhone: "70000001", fincaId: fincaPropia._id, especie: "bovino", nombre: "Mis vacas", codigo: "L-0091",
    cantidadInicial: 5, cantidadActual: 5, fechaIngreso: new Date("2026-01-01"),
  });
  await POST(`/medico/lotes/${lotePropio._id}/eventos`, tkA, {
    tipo: "tratamiento", fecha: new Date().toISOString(), producto: "Y", diasRetiroCarne: 3,
  });
  for (let i = 0; i < 20 && enviados.length < 1; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 100));
  verificar("un solo mensaje", enviados.length === 1);

  console.log("\n── 8. Un número del dueño que falla no tumba el aviso al veterinario ──");
  enviados.length = 0;
  const fincaMala = await Finca.create({ medicoPhone: "70000001", nombre: "Número malo", duenoTelefono: "59111111000" });
  const loteMalo = await LoteGanado.create({
    medicoPhone: "70000001", fincaId: fincaMala._id, especie: "bovino", nombre: "Vacas", codigo: "L-0092",
    cantidadInicial: 5, cantidadActual: 5, fechaIngreso: new Date("2026-01-01"),
  });
  // Un retiro ya vencido, para que lo levante el trabajo de cada hora.
  const eventoViejo = await EventoLote.create({
    medicoPhone: "70000001", loteId: loteMalo._id, tipo: "tratamiento",
    fecha: new Date(Date.now() - 20 * 86400000), producto: "Z", diasRetiroCarne: 5,
  });
  const pasada = await procesarRetirosLiberados();
  verificar("el veterinario recibe el aviso de liberación", enviados.some(e => e.destino === "70000001" && /ya está libre/.test(e.texto)));
  verificar("  ...la pasada no cuenta un fallo por culpa del número del dueño", pasada.fallidos === 0);
  const eventoTrasPasada = await EventoLote.findById(eventoViejo._id).lean();
  verificar("  ...y el evento queda marcado: no se le vuelve a escribir cada hora",
    eventoTrasPasada.avisoLiberacionEnviado === true);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
