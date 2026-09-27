// Symphomed Ganadería — el dueño entra a su finca por su enlace.
//
// ═══ LO QUE NO PUEDE FALLAR ═══════════════════════════════════════════════
//
//   · El enlace abre UNA finca. Un lote de otra finca —aunque sea del mismo
//     veterinario— no se ve ni se toca, y da 404 como uno que no existe.
//   · Cortar el acceso, emitir uno nuevo o cambiar el WhatsApp del dueño
//     deja el enlace viejo sin servir en ese mismo momento.
//   · El dueño carga producción, muertes y gastos con las MISMAS reglas que
//     el veterinario (no más muertes que animales vivos, no días futuros), y
//     no puede vacunar, tratar ni cerrar un lote.
//   · El enlace no se guarda en la base: solo su hash.
//   · El dueño borra sus gastos, no los del veterinario.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const crypto = require("crypto");
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
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de datos."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "acceso_dueno_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Finca, LoteGanado, EventoLote, GastoLote, RegistroProduccion, LlaveFinca, AuditLog } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  const { sumarDias, diaDe } = require(path.join(RAIZ, "services", "produccion"));
  await mongoose.connection.dropDatabase();
  await LlaveFinca.syncIndexes();

  // WhatsApp de mentira: se anota lo que se mandó. Se reemplaza ANTES de
  // cargar la ruta, que toma la función al requerirse.
  const whatsapp = require(path.join(RAIZ, "services", "metaWhatsapp"));
  const enviados = [];
  let whatsappFalla = false;
  whatsapp.enviarTextoOPlantilla = async (destino, texto, respaldo) => {
    if (whatsappFalla) throw new Error("sin conexión");
    enviados.push({ destino, texto, respaldo });
    return { ok: true };
  };

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000001", nombre: "Dra. Campo", passwordHash: hash, moneda: "BOB" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Ajeno", passwordHash: hash });
  const tkA = generarToken("70000001", "medico", 36e5);
  const tkB = generarToken("70000002", "medico", 36e5);

  const fincaA = await Finca.create({ medicoPhone: "70000001", codigo: "F-0001", nombre: "Estancia Los Álamos", duenoNombre: "Ramiro Paz", duenoTelefono: "71234567" });
  const fincaOtra = await Finca.create({ medicoPhone: "70000001", codigo: "F-0002", nombre: "Granja Vecina", duenoNombre: "Otro", duenoTelefono: "76543210" });
  const fincaSinTel = await Finca.create({ medicoPhone: "70000001", codigo: "F-0003", nombre: "Sin teléfono" });
  const base = { medicoPhone: "70000001", fechaIngreso: new Date("2026-08-01"), edadIngresoDias: 1 };
  const tambo = await LoteGanado.create({ ...base, fincaId: fincaA._id, especie: "bovino", nombre: "Tambo", codigo: "L-0001", proposito: "leche", cantidadInicial: 30, cantidadActual: 30 });
  // Pollitas de 11 días: les toca la 1ª de Gumboro.
  const galpon = await LoteGanado.create({ ...base, fechaIngreso: new Date(Date.now() - 10 * 864e5), fincaId: fincaA._id, especie: "avicola", nombre: "Galpón 1", codigo: "L-0002", proposito: "postura", cantidadInicial: 1000, cantidadActual: 1000 });
  const cerrado = await LoteGanado.create({ ...base, fincaId: fincaA._id, especie: "porcino", nombre: "Vendido", codigo: "L-0003", cantidadInicial: 10, cantidadActual: 10, estado: "cerrado" });
  const ajeno = await LoteGanado.create({ ...base, fincaId: fincaOtra._id, especie: "bovino", nombre: "De la vecina", codigo: "L-0004", cantidadInicial: 20, cantidadActual: 20 });

  const hoy = diaDe(new Date());
  const ayer = sumarDias(hoy, -1);
  // Un antibiótico con retiro de leche vigente: el dueño tiene que verlo.
  await EventoLote.create({ medicoPhone: "70000001", loteId: tambo._id, tipo: "tratamiento", fecha: new Date(`${sumarDias(hoy, -2)}T00:00:00Z`), producto: "Oxitetraciclina", diasRetiroLeche: 5 });
  await GastoLote.create({ medicoPhone: "70000001", loteId: galpon._id, dia: ayer, categoria: "sanidad", montoCentavos: 5000, moneda: "BOB", registradoPor: "Dra. Campo" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "lotesGanado"))(app);
  require(path.join(RAIZ, "routes", "accesoDueno"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const GET = (ruta, tk) => pedir(puerto, "GET", ruta, tk);
  const POST = (ruta, tk, b) => pedir(puerto, "POST", ruta, tk, b);
  const PUT = (ruta, tk, b) => pedir(puerto, "PUT", ruta, tk, b);
  const PATCH = (ruta, tk, b) => pedir(puerto, "PATCH", ruta, tk, b);
  const DELETE = (ruta, tk) => pedir(puerto, "DELETE", ruta, tk);
  const llaveDe = (enlace) => String(enlace || "").split("/campo/")[1];

  console.log("── 1. El veterinario emite el acceso ──");
  const e1 = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, tkA, {});
  verificar("se emite (200) y vuelve el enlace /campo/…", e1.estado === 200 && /\/campo\/[A-Za-z0-9_-]{30,}$/.test(e1.cuerpo?.enlace || ""));
  verificar("  ...mandado por WhatsApp al dueño (con prefijo del país)", e1.cuerpo?.enviado === true && enviados[0]?.destino === "59171234567");
  verificar("  ...con la plantilla acceso_finca y 3 valores", enviados[0]?.respaldo?.plantilla === "acceso_finca" && enviados[0]?.respaldo?.parametros?.length === 3);
  verificar("  ...y el mensaje lleva el enlace", enviados[0]?.texto.includes(e1.cuerpo?.enlace));
  const llave1 = llaveDe(e1.cuerpo?.enlace);
  const guardada = await LlaveFinca.findOne({ fincaId: fincaA._id, revocadaEn: null }).lean();
  verificar("en la base NO está el enlace, está su hash", guardada && !JSON.stringify(guardada).includes(llave1)
    && guardada.tokenHash === crypto.createHash("sha256").update(llave1).digest("hex"));

  const sinTel = await POST(`/medico/fincas/${fincaSinTel._id}/acceso-dueno`, tkA, {});
  verificar("una finca sin WhatsApp del dueño → 400", sinTel.estado === 400);
  const deOtro = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, tkB, {});
  verificar("otro veterinario no puede emitir el acceso de esta finca → 404", deOtro.estado === 404);
  const sinSesion = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, null, {});
  verificar("sin sesión → 401", sinSesion.estado === 401);

  const fincas = await GET("/medico/fincas", tkA);
  const fA = fincas.cuerpo?.fincas?.find(f => f._id === String(fincaA._id));
  verificar("la lista de fincas dice que tiene acceso, y a qué número", fA?.accesoDueno?.enviadaA === "59171234567");
  verificar("  ...sin devolver el enlace", !JSON.stringify(fincas.cuerpo).includes(llave1));
  verificar("  ...y la otra finca no tiene", fincas.cuerpo?.fincas?.find(f => f._id === String(fincaOtra._id))?.accesoDueno === null);

  console.log("\n── 2. El dueño ve SU finca ──");
  const d = await GET(`/campo/${llave1}/datos`);
  verificar("abre (200)", d.estado === 200);
  verificar("  ...con el nombre de la finca y del veterinario", d.cuerpo?.finca?.nombre === "Estancia Los Álamos" && d.cuerpo?.veterinario?.nombre === "Dra. Campo");
  const nombres = (d.cuerpo?.lotes || []).map(l => l.nombre).sort();
  verificar("  ...solo los lotes ACTIVOS de esta finca (no el cerrado ni el de la vecina)", JSON.stringify(nombres) === JSON.stringify(["Galpón 1", "Tambo"]));
  const dTambo = d.cuerpo?.lotes?.find(l => l.nombre === "Tambo");
  verificar("  ...y ve que la leche está en retiro por la oxitetraciclina", dTambo?.retirosVigentes?.some(r => r.producto === "Oxitetraciclina" && r.fechaLibreLeche));
  const dGalpon = d.cuerpo?.lotes?.find(l => l.nombre === "Galpón 1");
  verificar("  ...y las vacunas que tocan (1ª de Gumboro)", dGalpon?.vacunasPorHacer?.some(v => v.id === "gumboro_1" && v.estado === "pendiente"));
  verificar("  ...sin las que ya no se pueden dar ni las que faltan semanas", dGalpon?.vacunasPorHacer?.every(v => v.estado === "pendiente" || v.estado === "vencida"));
  verificar("  ...sin el teléfono del veterinario en ningún lado", !JSON.stringify(d.cuerpo).includes("70000001"));
  const usada = await LlaveFinca.findOne({ fincaId: fincaA._id, revocadaEn: null }).lean();
  verificar("abrirla cuenta como uso", usada.usos === 1 && usada.ultimoUso);
  verificar("un enlace inventado → 404", (await GET(`/campo/${"x".repeat(32)}/datos`)).estado === 404);
  verificar("un enlace corto → 404", (await GET("/campo/abc/datos")).estado === 404);

  console.log("\n── 3. El dueño carga ──");
  const p1 = await PUT(`/campo/${llave1}/lotes/${tambo._id}/produccion`, null, { dia: ayer, cantidad: 420 });
  verificar("la leche de ayer (200)", p1.estado === 200);
  verificar("  ...y le avisa que está en retiro", p1.cuerpo?.enRetiro === true && p1.cuerpo?.productoRetiro === "Oxitetraciclina");
  const reg = await RegistroProduccion.findOne({ loteId: tambo._id, dia: ayer }).lean();
  verificar("  ...queda marcada como carga del dueño, con su nombre", reg?.origen === "dueno" && reg?.registradoPor === "Ramiro Paz");
  const p2 = await PUT(`/campo/${llave1}/lotes/${galpon._id}/produccion`, null, { dia: ayer, cantidad: 850 });
  verificar("los huevos de ayer (200)", p2.estado === 200);
  verificar("un día futuro → 400", (await PUT(`/campo/${llave1}/lotes/${tambo._id}/produccion`, null, { dia: sumarDias(hoy, 5), cantidad: 10 })).estado === 400);

  const m1 = await POST(`/campo/${llave1}/lotes/${galpon._id}/mortalidad`, null, { dia: hoy, cantidadMuertes: 12, causaPresunta: "calor" });
  verificar("12 muertes (201)", m1.estado === 201);
  verificar("  ...el lote baja a 988", (await LoteGanado.findById(galpon._id).lean()).cantidadActual === 988);
  const ev = await EventoLote.findOne({ loteId: galpon._id, tipo: "mortalidad" }).lean();
  verificar("  ...evento marcado como del dueño", ev?.origen === "dueno" && ev?.causaPresunta === "calor");
  verificar("más muertes que animales vivos → 400", (await POST(`/campo/${llave1}/lotes/${galpon._id}/mortalidad`, null, { dia: hoy, cantidadMuertes: 5000 })).estado === 400);
  verificar("muertes en cero → 400", (await POST(`/campo/${llave1}/lotes/${galpon._id}/mortalidad`, null, { dia: hoy, cantidadMuertes: 0 })).estado === 400);
  verificar("muertes con fecha futura → 400", (await POST(`/campo/${llave1}/lotes/${galpon._id}/mortalidad`, null, { dia: sumarDias(hoy, 3), cantidadMuertes: 1 })).estado === 400);

  const g1 = await POST(`/campo/${llave1}/lotes/${galpon._id}/gastos`, null, { dia: ayer, categoria: "alimento", monto: "800.5", kg: 500 });
  verificar("un gasto de alimento (201), en centavos y en la moneda de la cuenta", g1.estado === 201 && g1.cuerpo?.gasto?.montoCentavos === 80050 && g1.cuerpo?.gasto?.moneda === "BOB");
  verificar("un gasto vacío → 400", (await POST(`/campo/${llave1}/lotes/${galpon._id}/gastos`, null, { dia: ayer, categoria: "otros" })).estado === 400);

  console.log("\n── 4. Lo que el dueño NO puede ──");
  verificar("cargar en el lote de otra finca del mismo veterinario → 404",
    (await PUT(`/campo/${llave1}/lotes/${ajeno._id}/produccion`, null, { dia: ayer, cantidad: 1 })).estado === 404);
  verificar("  ...ni muertes", (await POST(`/campo/${llave1}/lotes/${ajeno._id}/mortalidad`, null, { dia: ayer, cantidadMuertes: 1 })).estado === 404);
  verificar("  ...y el lote de la vecina sigue con 20", (await LoteGanado.findById(ajeno._id).lean()).cantidadActual === 20);
  verificar("cargar en un lote cerrado → 404", (await POST(`/campo/${llave1}/lotes/${cerrado._id}/gastos`, null, { dia: ayer, categoria: "otros", monto: 5 })).estado === 404);
  verificar("un loteId que no es un id → 404", (await PUT(`/campo/${llave1}/lotes/nada/produccion`, null, { dia: ayer, cantidad: 1 })).estado === 404);
  verificar("no hay ruta para vacunar/tratar desde el enlace", (await POST(`/campo/${llave1}/lotes/${tambo._id}/eventos`, null, { tipo: "tratamiento", producto: "X", fecha: hoy })).estado === 404);
  verificar("el enlace no sirve como sesión de veterinario", (await GET(`/medico/lotes/${tambo._id}`, llave1)).estado === 401);
  const gastoVet = await GastoLote.findOne({ loteId: galpon._id, origen: "" }).lean();
  verificar("borrar un gasto que cargó el veterinario → 404", (await DELETE(`/campo/${llave1}/gastos/${gastoVet._id}`)).estado === 404);
  verificar("  ...y sigue ahí", Boolean(await GastoLote.findById(gastoVet._id).lean()));
  const suyo = g1.cuerpo?.gasto?._id;
  verificar("borrar SU gasto → 200", (await DELETE(`/campo/${llave1}/gastos/${suyo}`)).estado === 200);
  verificar("  ...y ya no está", !(await GastoLote.findById(suyo).lean()));

  console.log("\n── 5. Las cargas quedan en la auditoría del veterinario ──");
  const audit = await AuditLog.find({ medicoPhone: "70000001", accion: /^campo_/ }).lean();
  verificar("producción, muertes, gasto y borrado: 5 registros «por el dueño»", audit.length === 5 && audit.every(a => a.detalle === "por el dueño"));

  console.log("\n── 6. Cortar el acceso ──");
  const e2 = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, tkA, {});
  const llave2 = llaveDe(e2.cuerpo?.enlace);
  verificar("emitir otro da un enlace distinto", llave2 && llave2 !== llave1);
  verificar("  ...y el viejo deja de servir (404)", (await GET(`/campo/${llave1}/datos`)).estado === 404);
  verificar("  ...ni para cargar", (await PUT(`/campo/${llave1}/lotes/${tambo._id}/produccion`, null, { dia: ayer, cantidad: 1 })).estado === 404);
  verificar("  ...el nuevo sí", (await GET(`/campo/${llave2}/datos`)).estado === 200);
  verificar("una sola llave viva por finca", (await LlaveFinca.countDocuments({ fincaId: fincaA._id, revocadaEn: null })) === 1);

  const rv = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno/revocar`, tkA, {});
  verificar("el veterinario lo corta", rv.estado === 200 && rv.cuerpo?.revocadas === 1);
  verificar("  ...y el enlace deja de servir", (await GET(`/campo/${llave2}/datos`)).estado === 404);
  verificar("otro veterinario no puede cortarlo → 404", (await POST(`/medico/fincas/${fincaA._id}/acceso-dueno/revocar`, tkB, {})).estado === 404);

  const e3 = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, tkA, {});
  const llave3 = llaveDe(e3.cuerpo?.enlace);
  const sinCambio = await PATCH(`/medico/fincas/${fincaA._id}`, tkA, { ubicacion: "Km 12" });
  verificar("editar la finca sin tocar el WhatsApp NO corta el acceso", sinCambio.cuerpo?.accesoRevocado === false && (await GET(`/campo/${llave3}/datos`)).estado === 200);
  const conCambio = await PATCH(`/medico/fincas/${fincaA._id}`, tkA, { duenoTelefono: "79999999" });
  verificar("cambiar el WhatsApp del dueño SÍ lo corta (y lo dice)", conCambio.cuerpo?.accesoRevocado === true);
  verificar("  ...el enlace del dueño anterior ya no sirve", (await GET(`/campo/${llave3}/datos`)).estado === 404);

  console.log("\n── 7. Si WhatsApp falla, el acceso igual queda ──");
  whatsappFalla = true;
  const e4 = await POST(`/medico/fincas/${fincaA._id}/acceso-dueno`, tkA, {});
  verificar("responde 200 con enviado:false y el enlace para mandarlo a mano", e4.estado === 200 && e4.cuerpo?.enviado === false && llaveDe(e4.cuerpo?.enlace));
  verificar("  ...y el enlace funciona", (await GET(`/campo/${llaveDe(e4.cuerpo?.enlace)}/datos`)).estado === 200);

  // Sin WhatsApp configurado el envío no falla: devuelve null. Tampoco es
  // «enviado».
  whatsappFalla = false;
  const enviarDeVerdad = whatsapp.enviarTextoOPlantilla;
  whatsapp.enviarTextoOPlantilla = async () => null;
  delete require.cache[require.resolve(path.join(RAIZ, "routes", "accesoDueno"))];
  const app2 = express();
  app2.use(express.json());
  require(path.join(RAIZ, "routes", "accesoDueno"))(app2);
  const srv2 = http.createServer(app2);
  await new Promise((res) => srv2.listen(0, "127.0.0.1", res));
  const eNull = await pedir(srv2.address().port, "POST", `/medico/fincas/${fincaA._id}/acceso-dueno`, tkA, {});
  verificar("WhatsApp sin configurar (devuelve null) → enviado:false, no «enviado»", eNull.estado === 200 && eNull.cuerpo?.enviado === false);
  srv2.close();
  whatsapp.enviarTextoOPlantilla = enviarDeVerdad;

  console.log("\n── 8. Una cuenta de Brasil ──");
  await Medico.create({ phone: "5511999990000", nombre: "Dra. Fazenda", passwordHash: hash, moneda: "BRL", idioma: "pt" });
  const tkBR = generarToken("5511999990000", "medico", 36e5);
  const fBR = await Finca.create({ medicoPhone: "5511999990000", codigo: "F-0001", nombre: "Fazenda Boa Vista", duenoNombre: "João", duenoTelefono: "11988887777" });
  const eBR = await POST(`/medico/fincas/${fBR._id}/acceso-dueno`, tkBR, {});
  const ultimo = enviados[enviados.length - 1];
  verificar("el número se completa con el 55", ultimo?.destino === "5511988887777");
  verificar("el mensaje va en portugués y la plantilla con idioma pt", /fazenda Fazenda Boa Vista/.test(ultimo?.texto) && ultimo?.respaldo?.idioma === "pt");
  const dBR = await GET(`/campo/${llaveDe(eBR.cuerpo?.enlace)}/datos`);
  verificar("la página del dueño viene en portugués y en reales", dBR.cuerpo?.idioma === "pt" && dBR.cuerpo?.moneda === "BRL");

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
