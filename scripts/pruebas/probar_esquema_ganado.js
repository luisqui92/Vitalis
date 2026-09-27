// Symphomed Ganadería — el calendario sanitario por especie.
//
// ═══ LO QUE MÁS FÁCIL SE ROMPE ════════════════════════════════════════════
//
// El cruce entre lo que el veterinario ESCRIBIÓ como producto y la vacuna
// del esquema. Si falla para un lado, un lote vacunado aparece con vacunas
// pendientes y el veterinario deja de creerle a la pantalla. Si falla para
// el otro —una sigla corta que "encaja" adentro de cualquier palabra—, un
// lote SIN vacunar aparece al día, que es peor.
//
// Y las dosis: la segunda aplicación de Newcastle es el refuerzo, aunque el
// veterinario no haya escrito "2da dosis".
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const http = require("http");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const e = require(path.join(RAIZ, "services", "esquemaGanado"));
const HOY = new Date("2026-09-27T15:00:00Z");
const haceDias = (n) => new Date(HOY.getTime() - n * 86400000);

console.log("── 1. Reconocer la vacuna en lo que se escribió ──");
[["Newcastle + Bronquitis", "newcastle"], ["Newcastle + Bronquitis", "bronquitis"], ["cepa La Sota", "newcastle"],
 ["NC-IB", "newcastle"], ["GUMBORO intermedia", "gumboro"], ["Circovac (PCV2)", "circovirus"],
 ["Vacuna anti-rábica", "rabia"], ["Brucelosis cepa 19", "brucelosis"], ["Ivermectina 1%", "desparasitacion"],
 ["Carbunco sintomático + gangrena", "clostridiales"], ["Carbunco bacteridiano", "carbunco"]]
  .forEach(([producto, grupo]) => verificar(`«${producto}» → ${grupo}`, e.esDelGrupo(producto, grupo)));
// Las siglas cortas no pueden encajar adentro de otras palabras.
verificar("«Bacterina concentrada» NO es Newcastle (tiene «nc» adentro, pero no es la sigla)", !e.esDelGrupo("Bacterina concentrada", "newcastle"));
verificar("«Vitamina con fibra» NO es IBR (tiene «ibr» adentro)", !e.esDelGrupo("Vitamina con fibra", "ibr_dvb"));
verificar("«Carbunco sintomático» NO es carbunco bacteridiano (son dos enfermedades distintas)", !e.esDelGrupo("Carbunco sintomático", "carbunco"));

console.log("\n── 2. Pollos: dosis por edad ──");
// Pollitos de 1 día que entraron hace 20 días → hoy tienen 21 días.
const pollos = { especie: "avicola", proposito: "carne", edadIngresoDias: 1, fechaIngreso: haceDias(20) };
const aplicaciones = [
  { tipo: "vacunacion", fecha: haceDias(20), producto: "Marek" },
  { tipo: "vacunacion", fecha: haceDias(13), producto: "Newcastle + Bronquitis" },
  { tipo: "vacunacion", fecha: haceDias(3), producto: "Newcastle La Sota" },
];
const cal = e.calendarioLote(pollos, aplicaciones, HOY);
const item = (id) => cal.items.find(i => i.id === id);
verificar("la edad del lote es 21 días", cal.edadDias === 21);
verificar("Marek aplicado → al día", item("marek").estado === "al_dia");
verificar("la 1ª de Newcastle es la primera aplicación", item("newcastle_1").estado === "al_dia" && new Date(item("newcastle_1").aplicada.fecha).getTime() === haceDias(13).getTime());
verificar("la SEGUNDA aplicación de Newcastle cuenta como refuerzo, sin que diga «2da»", item("newcastle_2").estado === "al_dia");
verificar("bronquitis, aplicada en la misma vacuna que Newcastle → al día", item("bronquitis_1").estado === "al_dia");
verificar("Gumboro 1ª (ventana 10-16) sin aplicar a los 21 días → PERDIDA, no pendiente", item("gumboro_1").estado === "perdida");
verificar("Gumboro 2ª (ventana 18-24) a los 21 días → pendiente", item("gumboro_2").estado === "pendiente");
verificar("  ...con las fechas de su ventana", Boolean(item("gumboro_2").desdeFecha && item("gumboro_2").hastaFecha));
verificar("pollos de engorde: las vacunas de ponedoras no aparecen", !item("viruela"));
verificar("se cuentan 2 para atender (la perdida y la pendiente)", cal.atender === 2);

const ponedoras = { ...pollos, proposito: "huevo" };
verificar("ponedoras: sí aparece viruela aviar", Boolean(e.calendarioLote(ponedoras, [], HOY).items.find(i => i.id === "viruela")));

console.log("\n── 3. Sin la edad, no se adivina ──");
const sinEdad = e.calendarioLote({ ...pollos, edadIngresoDias: null }, [], HOY);
verificar("un ítem por edad sin edad del lote → «sin_edad»", sinEdad.items.find(i => i.id === "gumboro_1").estado === "sin_edad");
verificar("  ...y el calendario pide la edad", sinEdad.faltaEdad === true);

console.log("\n── 4. Rodeo adulto: vacunas periódicas ──");
const rodeo = { especie: "bovino", proposito: "carne", edadIngresoDias: null, fechaIngreso: haceDias(800) };
const calRodeo = e.calendarioLote(rodeo, [
  { tipo: "vacunacion", fecha: haceDias(400), producto: "Rabia" },
  { tipo: "vacunacion", fecha: haceDias(100), producto: "Polivalente clostridial" },
  { tipo: "tratamiento", fecha: haceDias(30), producto: "Ivermectina" },
], HOY);
const r = (id) => calRodeo.items.find(i => i.id === id);
verificar("rabia aplicada hace 400 días (cada 365) → vencida", r("rabia").estado === "vencida");
verificar("clostridiales anual, aplicado hace 100 días → al día, con la próxima fecha", r("clostridiales_anual").estado === "al_dia" && r("clostridiales_anual").proxima);
verificar("una desparasitación cargada como TRATAMIENTO igual cuenta", r("desparasitacion").estado === "al_dia");
verificar("carbunco nunca aplicado, en un rodeo sin edad cargada → pendiente (es un adulto)", r("carbunco").estado === "pendiente");
verificar("aftosa es de campaña oficial: no se le inventa fecha", r("aftosa").estado === "campana" && !r("aftosa").proxima);
verificar("un rodeo de carne no muestra IBR/DVB (es para leche y cría)", !r("ibr_dvb"));
verificar("un rodeo lechero sí", Boolean(e.calendarioLote({ ...rodeo, proposito: "leche" }, [], HOY).items.find(i => i.id === "ibr_dvb")));

console.log("\n── 5. Cerdos ──");
const lechones = { especie: "porcino", proposito: "engorde", edadIngresoDias: 21, fechaIngreso: haceDias(2) };
const calCerdos = e.calendarioLote(lechones, [], HOY);
verificar("lechones de 23 días: circovirus (18-28) pendiente", calCerdos.items.find(i => i.id === "circovirus").estado === "pendiente");
verificar("  ...micoplasma (7-21) ya perdida", calCerdos.items.find(i => i.id === "micoplasma").estado === "perdida");
verificar("un engorde no muestra las vacunas de reproductoras", !calCerdos.items.find(i => i.id === "reproductoras"));

console.log("\n── 5b. El nombre que se precarga al «Registrar» pone la vacuna al día ──");
// El botón «Registrar» completa el producto con el nombre de la vacuna en el
// idioma del médico. Si ese nombre no lo reconoce su propio grupo, el
// veterinario guarda la aplicación y la vacuna SIGUE pendiente — un botón
// que no hace lo que dice.
const vm = require("vm");
for (const idioma of ["es", "pt"]) {
  const ctx = { I18N: { [idioma]: {} }, Object };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "i18n", idioma, "ganaderia.js"), "utf8"), ctx);
  const dic = ctx.I18N[idioma];
  const malos = [];
  for (const [especie, esquema] of Object.entries(e.ESQUEMAS)) {
    for (const it of esquema) {
      const nombre = dic["ganaderia.cal.item." + it.id];
      if (!nombre || !e.esDelGrupo(nombre, it.grupo)) malos.push(`${especie}/${it.id} («${nombre}»)`);
    }
  }
  verificar(`[${idioma}] cada nombre de vacuna es reconocido por su propio grupo`, malos.length === 0);
  malos.forEach(m => console.log("   ", m));
}

verificar("una especie sin esquema no inventa uno", e.calendarioLote({ especie: "equino" }, [], HOY) === null);
verificar("el archivo avisa que no lo revisó un veterinario",
  /NO LO REVISÓ TODAVÍA UN VETERINARIO/.test(fs.readFileSync(path.join(RAIZ, "services", "esquemaGanado.js"), "utf8")));

// ═══ 6. LA RUTA ══════════════════════════════════════════════════════════
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
      res.on("end", () => { let json = null; try { json = JSON.parse(texto); } catch { /* no es JSON */ } resolve({ estado: res.statusCode, cuerpo: json }); });
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
  if (!MongoMemoryServer) { console.log("\n⏭️  Ruta SALTEADA."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "esquema_ganado_prueba";
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Medico.create({ phone: "70000001", nombre: "Dra. Campo", passwordHash: await hashPassword("Prueba123.") });
  const tk = generarToken("70000001", "medico", 36e5);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "lotesGanado"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;

  console.log("\n── 6. La ruta ──");
  const hoy = new Date().toISOString().slice(0, 10);
  const rL = await pedir(puerto, "POST", "/medico/lotes", tk, { especie: "avicola", nombre: "Galpón", cantidadInicial: 100, fechaIngreso: hoy, edadIngresoDias: 1 });
  verificar("el lote se crea con la edad al ingreso", rL.estado === 201 && rL.cuerpo?.lote?.edadIngresoDias === 1);
  const rMala = await pedir(puerto, "POST", "/medico/lotes", tk, { especie: "avicola", nombre: "X", cantidadInicial: 1, fechaIngreso: hoy, edadIngresoDias: -3 });
  verificar("una edad negativa → 400", rMala.estado === 400);
  const id = rL.cuerpo.lote._id;
  const rD = await pedir(puerto, "GET", `/medico/lotes/${id}`, tk);
  verificar("el detalle trae el calendario de la especie", rD.cuerpo?.calendario?.items?.some(i => i.id === "marek"));
  await pedir(puerto, "POST", `/medico/lotes/${id}/eventos`, tk, { tipo: "vacunacion", fecha: new Date().toISOString(), producto: "Marek" });
  const rD2 = await pedir(puerto, "GET", `/medico/lotes/${id}`, tk);
  verificar("cargar la vacuna la pone al día en el calendario", rD2.cuerpo?.calendario?.items?.find(i => i.id === "marek")?.estado === "al_dia");

  const rSin = await pedir(puerto, "POST", "/medico/lotes", tk, { especie: "porcino", nombre: "Lechones", cantidadInicial: 10, fechaIngreso: hoy });
  const rP = await pedir(puerto, "PATCH", `/medico/lotes/${rSin.cuerpo.lote._id}`, tk, { edadIngresoDias: 25 });
  verificar("la edad al ingreso se puede cargar después", rP.cuerpo?.lote?.edadIngresoDias === 25);

  await pedir(puerto, "PATCH", `/medico/lotes/${id}/cerrar`, tk, { motivoCierre: "faenado" });
  const rC = await pedir(puerto, "GET", `/medico/lotes/${id}`, tk);
  verificar("un lote cerrado ya no muestra calendario", rC.cuerpo?.calendario === null);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
