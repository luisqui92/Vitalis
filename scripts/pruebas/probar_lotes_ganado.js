// Symphomed Ganadería — lotes de producción animal.
//
// ═══ POR QUÉ EL LOTE ES UNA ENTIDAD APARTE DE PACIENTE ═════════════════════
//
// Nadie lleva ficha individual de 8.000 pollos de un galpón: se maneja y se
// trata como grupo. Esta prueba verifica lo que hace a un lote distinto de
// un paciente — mortalidad ACUMULADA que resta de a poco, un evento que
// aplica a TODO el lote de una carga, y un período de retiro que vence solo,
// sin que nadie tenga que acordarse de revisarlo. Contra la app real y una
// base descartable, como el resto de las pruebas de rutas.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

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
        try { json = JSON.parse(texto); } catch { /* algunos errores no son JSON */ }
        resolve({ estado: res.statusCode, cuerpo: json, texto });
      });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

async function conseguirMongo() {
  if (process.env.MONGO_PRUEBAS) {
    const nombre = (process.env.MONGO_PRUEBAS.split("/").pop() || "").split("?")[0].toLowerCase();
    if (!/prueba|test/.test(nombre)) {
      console.error(`❌ MONGO_PRUEBAS apunta a "${nombre}", que no dice ser de prueba. No.`);
      process.exit(1);
    }
    return { uri: process.env.MONGO_PRUEBAS, detener: async () => {} };
  }
  let MongoMemoryServer;
  for (const c of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(c)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) return null;
  const s = await MongoMemoryServer.create();
  return { uri: s.getUri() + "vitalis_prueba", detener: () => s.stop() };
}

async function main() {
  const mongo = await conseguirMongo();
  if (!mongo) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar.");
    console.log("   MONGO_PRUEBAS=... o npm i --no-save mongodb-memory-server");
    console.log("   Esto NO es un ✅: el módulo de ganadería quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const { Medico } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dr. Ganadería A", passwordHash: hash });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ganadería B (ajeno)", passwordHash: hash });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "lotesGanado"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const GET = (ruta, token) => pedir(puerto, "GET", ruta, token);
  const POST = (ruta, token, cuerpo) => pedir(puerto, "POST", ruta, token, cuerpo);
  const PATCH = (ruta, token, cuerpo) => pedir(puerto, "PATCH", ruta, token, cuerpo);

  console.log("── 1. Crear un lote de cada especie, con código correlativo ──");
  const rBovino = await POST("/medico/lotes", tkA, {
    especie: "bovino", nombre: "Rodeo lechero norte", cantidadInicial: 40,
    fechaIngreso: "2026-01-10", proposito: "leche",
  });
  verificar("bovino se crea (201)", rBovino.estado === 201);
  verificar("  ...con código L-0001", rBovino.cuerpo?.lote?.codigo === "L-0001");
  verificar("  ...cantidadActual arranca igual a cantidadInicial",
    rBovino.cuerpo?.lote?.cantidadActual === 40);

  const rPorcino = await POST("/medico/lotes", tkA, {
    especie: "porcino", nombre: "Corral de engorde 2", cantidadInicial: 200,
    fechaIngreso: "2026-02-01", proposito: "engorde",
  });
  verificar("porcino se crea con el siguiente código (L-0002)",
    rPorcino.estado === 201 && rPorcino.cuerpo?.lote?.codigo === "L-0002");

  const rAvicola = await POST("/medico/lotes", tkA, {
    especie: "avicola", nombre: "Galpón 3", cantidadInicial: 1000,
    fechaIngreso: "2026-03-01", proposito: "carne", ubicacion: "Finca Los Álamos",
  });
  verificar("avícola se crea con el siguiente código (L-0003)",
    rAvicola.estado === 201 && rAvicola.cuerpo?.lote?.codigo === "L-0003");
  const idAvicola = rAvicola.cuerpo.lote._id;

  console.log("\n── 2. Lo que no es una de las tres especies, se rechaza ──");
  const rEspecieMala = await POST("/medico/lotes", tkA, {
    especie: "equino", nombre: "x", cantidadInicial: 1, fechaIngreso: "2026-01-01",
  });
  verificar("especie inválida → 400", rEspecieMala.estado === 400);
  const rSinCantidad = await POST("/medico/lotes", tkA, {
    especie: "bovino", nombre: "x", cantidadInicial: 0, fechaIngreso: "2026-01-01",
  });
  verificar("cantidadInicial en 0 → 400", rSinCantidad.estado === 400);
  const rSinFecha = await POST("/medico/lotes", tkA, {
    especie: "bovino", nombre: "x", cantidadInicial: 5, fechaIngreso: "no es una fecha",
  });
  verificar("fechaIngreso inválida → 400", rSinFecha.estado === 400);

  console.log("\n── 3. Mortalidad: resta de cantidadActual, nunca de más ──");
  const rMuerte1 = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "mortalidad", fecha: "2026-03-05", cantidadMuertes: 30, causaPresunta: "estrés calórico",
  });
  verificar("se registra la mortalidad (201)", rMuerte1.estado === 201);
  verificar("  ...y el lote queda en 970", rMuerte1.cuerpo?.lote?.cantidadActual === 970);

  const rMuerte2 = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "mortalidad", fecha: "2026-03-10", cantidadMuertes: 20,
  });
  verificar("segunda mortalidad: queda en 950", rMuerte2.cuerpo?.lote?.cantidadActual === 950);

  const rMuerteExcesiva = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "mortalidad", fecha: "2026-03-11", cantidadMuertes: 99999,
  });
  verificar("reportar más muertes que animales vivos → 400 (no se inventa un número negativo)",
    rMuerteExcesiva.estado === 400);

  console.log("\n── 4. El % de mortalidad se calcula sobre cantidadInicial, no sobre lo que queda ──");
  const detalle1 = await GET(`/medico/lotes/${idAvicola}`, tkA);
  verificar("total de muertes acumuladas: 50", detalle1.cuerpo?.mortalidad?.totalMuertes === 50);
  verificar("5% de mortalidad sobre 1.000 iniciales (no sobre 950 actuales)",
    Math.abs(detalle1.cuerpo?.mortalidad?.porcentaje - 5) < 1e-9);

  console.log("\n── 5. Vacunación/tratamiento masivo, con período de retiro ──");
  const rTratamientoReciente = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "tratamiento", fecha: new Date().toISOString(), producto: "Enrofloxacina",
    dosis: "10mg/kg", viaAplicacion: "agua de bebida", diasRetiroCarne: 10,
  });
  verificar("el tratamiento se carga (201)", rTratamientoReciente.estado === 201);
  verificar("  ...cantidadAplicada por defecto es toda la cantidad viva del lote",
    rTratamientoReciente.cuerpo?.evento?.cantidadAplicada === 950);

  const rSinProducto = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "tratamiento", fecha: "2026-03-12",
  });
  verificar("un tratamiento sin producto → 400", rSinProducto.estado === 400);

  // Uno viejo, con un retiro de 10 días que ya venció hace mucho.
  await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "vacunacion", fecha: "2026-01-01", producto: "Newcastle",
    diasRetiroCarne: 10,
  });

  const detalle2 = await GET(`/medico/lotes/${idAvicola}`, tkA);
  const retiros = detalle2.cuerpo?.retirosVigentes || [];
  verificar("el retiro reciente (todavía dentro de los 10 días) SIGUE vigente",
    retiros.some(r => r.producto === "Enrofloxacina"));
  verificar("el retiro viejo (de enero, hace meses) YA NO aparece como vigente",
    !retiros.some(r => r.producto === "Newcastle"));

  console.log("\n── 6. Pesaje: curva ordenada por fecha, aunque se cargue fuera de orden ──");
  await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "pesaje", fecha: "2026-03-15", tamanoMuestra: 20, pesoPromedioKg: 1.8,
  });
  // Se carga DESPUÉS pero es de una fecha ANTERIOR — pasa en la vida real
  // (el encargado del galpón manda el dato tarde).
  await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "pesaje", fecha: "2026-03-08", tamanoMuestra: 20, pesoPromedioKg: 1.1,
  });
  const detalle3 = await GET(`/medico/lotes/${idAvicola}`, tkA);
  const curva = detalle3.cuerpo?.curvaPeso || [];
  verificar("la curva tiene los dos pesajes", curva.length === 2);
  verificar("  ...ordenados por fecha aunque se hayan cargado al revés",
    curva[0]?.pesoPromedioKg === 1.1 && curva[1]?.pesoPromedioKg === 1.8);

  const rPesajeMalo = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "pesaje", fecha: "2026-03-16", tamanoMuestra: 0, pesoPromedioKg: 1.5,
  });
  verificar("una muestra de tamaño 0 → 400", rPesajeMalo.estado === 400);

  console.log("\n── 7. Un tipo de evento que no existe, se rechaza ──");
  const rTipoMalo = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "brujeria", fecha: "2026-03-16",
  });
  verificar("tipo inválido → 400", rTipoMalo.estado === 400);

  console.log("\n── 8. Cerrar un lote: no admite más eventos, y no se cierra dos veces ──");
  const rCerrar = await PATCH(`/medico/lotes/${idAvicola}/cerrar`, tkA, { motivoCierre: "faenado" });
  verificar("se cierra (200)", rCerrar.estado === 200 && rCerrar.cuerpo?.lote?.estado === "cerrado");
  verificar("  ...con fecha de cierre", !!rCerrar.cuerpo?.lote?.fechaCierre);

  const rEventoEnCerrado = await POST(`/medico/lotes/${idAvicola}/eventos`, tkA, {
    tipo: "pesaje", fecha: "2026-04-01", tamanoMuestra: 10, pesoPromedioKg: 2.2,
  });
  verificar("cargar un evento en un lote cerrado → 400", rEventoEnCerrado.estado === 400);

  const rCerrarDeNuevo = await PATCH(`/medico/lotes/${idAvicola}/cerrar`, tkA, {});
  verificar("cerrar un lote ya cerrado → 400", rCerrarDeNuevo.estado === 400);

  console.log("\n── 9. Aislamiento: un médico no ve ni toca los lotes de otro ──");
  const rListaB = await GET("/medico/lotes", tkB);
  verificar("el médico B no ve ningún lote (todos son de A)",
    Array.isArray(rListaB.cuerpo?.lotes) && rListaB.cuerpo.lotes.length === 0);

  const rDetalleAjeno = await GET(`/medico/lotes/${idAvicola}`, tkB);
  verificar("el médico B pidiendo el lote de A → 404, no 403 (no delata que existe)",
    rDetalleAjeno.estado === 404);

  const rEventoAjeno = await POST(`/medico/lotes/${idAvicola}/eventos`, tkB, {
    tipo: "mortalidad", fecha: "2026-03-20", cantidadMuertes: 5,
  });
  verificar("el médico B no puede cargar un evento en el lote de A", rEventoAjeno.estado === 404);

  const rListaA = await GET("/medico/lotes?estado=activo", tkA);
  verificar("el médico A, filtrando por activos, ya no ve el galpón cerrado",
    !rListaA.cuerpo?.lotes?.some(l => l._id === idAvicola));

  servidor.close();
  await mongoose.disconnect();
  await mongo.detener();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
