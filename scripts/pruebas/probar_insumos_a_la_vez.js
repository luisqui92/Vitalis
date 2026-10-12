// Symphomed — Movimientos de insumos a la vez: el stock no pierde ninguno.
//
// El stock nuevo se calculaba desde la copia que había leído la ruta y se
// guardaba ese número. Con un stock de 10, dos salidas a la vez (3 y 4)
// dejaban 6 o 7 en vez de 3, aunque los dos movimientos quedaran anotados
// (revisión integral del 11 de octubre de 2026, S08). Lo que se prueba:
//   1. Dos salidas a la vez: quedan 3, y cada movimiento dice lo que dejó.
//   2. Veinte movimientos mezclados a la vez: el stock es la suma.
//   3. Un ajuste en medio de salidas: vale el orden en que se aplicaron.
//   4. Si el movimiento no se puede guardar, el stock vuelve a como estaba.
//   5. Lo de antes (movimientos sin número de orden) sigue cuadrando.
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

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "insumos_a_la_vez";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const insumos = require(path.join(RAIZ, "services", "insumos"));
  const { revisarStock } = insumos;
  await mongoose.connection.dropDatabase();
  // El caso exacto del informe depende de que los dos pedidos lean el insumo
  // antes de que cualquiera escriba. Con la barrera puesta, la ruta espera a
  // que los dos hayan leído: así se prueba siempre, no cuando toca.
  let barrera = null;
  const leerInsumo = insumos.insumoDelDueno;
  insumos.insumoDelDueno = async (...a) => {
    const insumo = await leerInsumo(...a);
    if (barrera) { if (++barrera.llegaron >= barrera.cuantos) barrera.soltar(); await barrera.listo; }
    return insumo;
  };
  const conBarrera = (cuantos) => { let soltar; const listo = new Promise((r) => { soltar = r; }); barrera = { cuantos, llegaron: 0, soltar, listo }; };

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "insumos"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const MED = "70055001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Insumos", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const P = (ruta, cuerpo) => pedir(servidor.address().port, "POST", ruta, tk, cuerpo);
  const nuevo = async (nombre, stockInicial) => {
    const r = await P("/medico/insumos", { nombre, stockInicial });
    return r;
  };
  const mover = (id, tipo, cantidad) => P(`/medico/insumos/${id}/movimientos`, { tipo, cantidad });
  const stock = async (id) => (await M.Insumo.findById(id).lean()).stock;
  // Cada movimiento tiene que decir el stock que da aplicar todos, en su orden, hasta él.
  const cadaUnoCuadra = async (id) => {
    const movs = await M.MovimientoInsumo.find({ insumoId: id }).sort({ orden: 1, createdAt: 1 }).lean();
    let s = 0;
    for (const m of movs) {
      s = m.tipo === "entrada" ? s + m.cantidad : m.tipo === "salida" ? s - m.cantidad : m.cantidad;
      if (Math.abs(s - m.stockDespues) > 1e-9) return false;
    }
    return true;
  };

  console.log("── 1. Dos salidas a la vez ──");
  const r0 = await nuevo("Guantes", 10);
  const guantes = r0.cuerpo?.insumo?._id;
  verificar(`al crearlo con 10, la respuesta ya dice 10 (${r0.cuerpo?.insumo?.stock})`, r0.estado === 201 && r0.cuerpo?.insumo?.stock === 10);
  conBarrera(2);
  const [s1, s2] = await Promise.all([mover(guantes, "salida", 3), mover(guantes, "salida", 4)]);
  barrera = null;
  verificar(`salidas de 3 y 4 a la vez (${s1.estado}, ${s2.estado}) → quedan 3 (${await stock(guantes)})`, s1.estado === 201 && s2.estado === 201 && await stock(guantes) === 3);
  const despues = [s1.cuerpo.movimiento.stockDespues, s2.cuerpo.movimiento.stockDespues].sort((a, b) => a - b);
  verificar(`  ...cada movimiento dice lo que dejó: ${despues.join(" y ")} (uno de los dos, el 3)`, despues[0] === 3 && [6, 7].includes(despues[1]));
  verificar("  ...con números de orden distintos, después de la carga inicial", new Set([s1.cuerpo.movimiento.orden, s2.cuerpo.movimiento.orden]).size === 2
    && [s1, s2].every(x => [2, 3].includes(x.cuerpo.movimiento.orden)));
  verificar("  ...y el libro cuadra, movimiento por movimiento", (await revisarStock(guantes)).cuadra && await cadaUnoCuadra(guantes));

  console.log("\n── 2. Veinte a la vez ──");
  const gasas = (await nuevo("Gasas", 10)).cuerpo.insumo._id;
  const mezcla = await Promise.all(Array.from({ length: 20 }, (_, i) => mover(gasas, i % 2 ? "salida" : "entrada", i % 2 ? 2 : 1)));
  verificar(`20 movimientos (10 entradas de 1, 10 salidas de 2) → 10 + 10 − 20 = 0 (${await stock(gasas)})`, mezcla.every(x => x.estado === 201) && await stock(gasas) === 0);
  verificar("  ...el libro cuadra, movimiento por movimiento", (await revisarStock(gasas)).cuadra && await cadaUnoCuadra(gasas));

  console.log("\n── 3. Un ajuste en medio de salidas ──");
  const resina = (await nuevo("Resina", 20)).cuerpo.insumo._id;
  const conAjuste = await Promise.all([mover(resina, "salida", 2), mover(resina, "ajuste", 15), mover(resina, "salida", 1), mover(resina, "salida", 4)]);
  const ajuste = conAjuste[1].cuerpo.movimiento;
  const final = await stock(resina);
  verificar(`el ajuste dice 15, y lo que vino después se le resta: queda ${final}`, ajuste.stockDespues === 15 && (await revisarStock(resina)).cuadra && await cadaUnoCuadra(resina));
  verificar("  ...y el stock final es el que dice el último movimiento aplicado",
    final === (await M.MovimientoInsumo.findOne({ insumoId: resina }).sort({ orden: -1 }).lean()).stockDespues);

  console.log("\n── 4. Si el movimiento no se guarda, el stock vuelve ──");
  const agujas = (await nuevo("Agujas", 10)).cuerpo.insumo._id;
  const crearOriginal = M.MovimientoInsumo.create;
  M.MovimientoInsumo.create = async () => { throw new Error("la base no contestó"); };
  const falla = await mover(agujas, "salida", 4);
  const fallaAjuste = await mover(agujas, "ajuste", 99);
  M.MovimientoInsumo.create = crearOriginal;
  verificar(`una salida que no se pudo anotar (${falla.estado}) no baja el stock: sigue en ${await stock(agujas)}`, falla.estado === 500 && await stock(agujas) === 10);
  verificar(`  ...ni un ajuste (${fallaAjuste.estado})`, fallaAjuste.estado === 500 && await stock(agujas) === 10 && (await revisarStock(agujas)).cuadra);

  console.log("\n── 5. Lo de antes sigue cuadrando ──");
  const viejo = await M.Insumo.create({ medicoPhone: MED, nombre: "Anestesia", stock: 5 });
  await M.MovimientoInsumo.create({ insumoId: viejo._id, medicoPhone: MED, tipo: "entrada", cantidad: 5, stockDespues: 5 });
  const rv = await mover(viejo._id, "salida", 2);
  verificar(`un insumo con movimientos sin orden: la salida deja 3 (${rv.cuerpo?.movimiento?.stockDespues}) y cuadra`, rv.estado === 201 && await stock(viejo._id) === 3 && (await revisarStock(viejo._id)).cuadra);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
