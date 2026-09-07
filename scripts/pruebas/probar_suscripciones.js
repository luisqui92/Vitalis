// Vitalis — Las dos formas de pagar, y que no se pisen.
//
// Prepago: carga saldo y cada consulta descuenta.
// Plan:    paga por mes o por año y las consultas no descuentan.
//
// Lo que se prueba acá es la frontera entre los dos, que es donde se pierde
// plata sin que nadie lo note: un suscriptor al que igual le descuentan, un
// prepago al que no le cobran, un plan vencido que sigue dando servicio
// gratis, o una renovación que le come días al que pagó por adelantado.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const suscripciones = require(path.join(RAIZ, "services", "suscripciones"));
const monedas = require(path.join(RAIZ, "services", "monedas"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const HOY = new Date("2026-09-07T12:00:00Z");
const conPlanHasta = (fecha, plan = "mensual") => ({
  moneda: "BRL", suscripcion: { plan, hasta: new Date(fecha), desde: new Date("2026-01-01") },
});

console.log("── 1. Los precios de Brasil son los de Brasil ──");
// Antes el precio brasileño heredaba del boliviano si faltaba la variable,
// así que se cobraban Bs 12 disfrazados de R$ 12. Son mercados distintos.
verificar("la consulta cuesta R$ 10,00", monedas.config("BRL").precioConsulta === 1000);
verificar("  ...y NO hereda el número de Bolivia", monedas.config("BRL").precioConsulta !== monedas.config("BOB").precioConsulta);

const precios = suscripciones.estado({ moneda: "BRL" }, HOY).precios;
verificar("el plan mensual cuesta R$ 400,00", precios.mensual === 40000);
// El anual son doce meses al precio de once: el "mes gratis" es el mes trece,
// no un descuento suelto que después nadie sabe de dónde salió.
verificar("el anual cuesta 11 meses, no 12", precios.anual === 40000 * 11);
verificar("  ...y se anuncia 1 mes gratis", precios.mesesGratis === 1);

console.log("\n── 2. El plan se paga solo a las 40 consultas ──");
// No es casualidad y conviene no perderlo si algún día se tocan los números:
// si el plan valiera menos de 20 consultas nadie usaría el prepago, y si
// valiera más de 80 nadie tomaría el plan.
const equivale = precios.mensual / monedas.config("BRL").precioConsulta;
verificar(`son ${equivale} consultas`, equivale === 40);

console.log("\n── 3. Vigente es una fecha, no un booleano guardado ──");
verificar("un plan que vence mañana está vigente", suscripciones.vigente(conPlanHasta("2026-09-08T12:00:00Z"), HOY));
verificar("uno que venció ayer NO", !suscripciones.vigente(conPlanHasta("2026-09-06T12:00:00Z"), HOY));
verificar("una cuenta sin plan tampoco", !suscripciones.vigente({ moneda: "BRL" }, HOY));
// Un campo "activo: true" guardado se queda en true después de vencido y
// nadie se entera hasta que alguien no paga durante meses.
verificar("no hay ningún campo 'activo' que mantener",
  !("activo" in (suscripciones.estado(conPlanHasta("2026-10-07T12:00:00Z"), HOY))));

console.log("\n── 4. Se avisa antes de que venza, no el último día ──");
verificar("con 30 días no molesta", !suscripciones.estado(conPlanHasta("2026-10-07T12:00:00Z"), HOY).porVencer);
verificar("con 5 días sí avisa", suscripciones.estado(conPlanHasta("2026-09-12T12:00:00Z"), HOY).porVencer);
verificar("  ...y dice cuántos quedan", suscripciones.estado(conPlanHasta("2026-09-12T12:00:00Z"), HOY).diasRestantes === 5);

console.log("\n── 5. Renovar no le come días al que pagó adelantado ──");
// Si el período nuevo arrancara HOY, renovar antes de tiempo le regalaría
// días a Vitalis y se los sacaría al médico. Es de las cosas que el que pagó
// por adelantado SÍ descubre.
const vigenteHasta = conPlanHasta("2026-10-07T12:00:00Z");
const renovado = suscripciones.nuevoVencimiento(vigenteHasta, "mensual", HOY);
verificar("el mes nuevo se suma al vencimiento, no a hoy",
  renovado.toISOString().slice(0, 10) === "2026-11-07");

const vencido = conPlanHasta("2026-08-01T12:00:00Z");
const reactivado = suscripciones.nuevoVencimiento(vencido, "mensual", HOY);
verificar("si ya venció, arranca hoy (no se le cobran los días sin plan)",
  reactivado.toISOString().slice(0, 10) === "2026-10-07");

console.log("\n── 6. Un plan anual da doce meses ──");
verificar("desde cero, vence en un año",
  suscripciones.nuevoVencimiento({ moneda: "BRL" }, "anual", HOY).toISOString().slice(0, 10) === "2027-09-07");

console.log("\n── 7. Un plan inventado no activa nada ──");
let reventó = false;
try { suscripciones.nuevoVencimiento({ moneda: "BRL" }, "trimestral", HOY); } catch { reventó = true; }
verificar("tira error en vez de dar servicio gratis", reventó);
verificar("  ...y su precio es cero, no NaN", suscripciones.precioDelPlan("trimestral", "BRL") === 0);

console.log("\n── 8. Con plan no se avisa de saldo bajo ni se bloquea ──");
// Un médico que acaba de pagar R$ 400 no puede ver "te queda poco saldo".
// Se comprueba sobre el código de saldo.js, que es quien lo decide.
const fs = require("fs");
const saldo = fs.readFileSync(path.join(RAIZ, "services", "saldo.js"), "utf8");
verificar("el aviso de saldo bajo respeta el plan", /bajo:\s*!plan\.activa/.test(saldo));
verificar("el bloqueo también", /bloqueado:\s*!plan\.activa/.test(saldo));
// Y lo más importante: que el descuento sea CERO, no que se saltee el
// movimiento. Sin el movimiento no se sabe cuántas consultas hace un plan.
// "sinCargo" es plan vigente O consulta de cortesía: en los dos casos el
// movimiento se escribe con monto cero, no se saltea.
verificar("la consulta sin cargo se anota con monto cero",
  /montoCentavos:\s*sinCargo\s*\?\s*0\s*:/.test(saldo));
verificar("  ...y sigue pasando por el índice único de consultaId",
  /consultaId,?\s*\n\s*\}\);/.test(saldo) || saldo.includes("consultaId,"));

console.log("\n── 9. La ruta que activa el plan ──");
// Acá se crea servicio a cambio de un pago que alguien dice haber recibido.
// Los mismos candados que acreditar plata: lista de operadores, 2FA,
// referencia obligatoria y auditoría.
(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vitalis_prueba");
  process.env.OPERADORES_SALDO = "70000009";

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "operadorSaldo"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, AuditLog } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000009", nombre: "Quien Cobra", passwordHash: hash, activo: true, dosFA: { activo: true, secreto: "X" } });
  await Medico.create({ phone: "5511900001", nombre: "Dra. Ana Souza", passwordHash: hash, activo: true, moneda: "BRL" });
  const tk = generarToken("70000009", "medico", 3600 * 1000);
  const tkAjeno = generarToken("5511900001", "medico", 3600 * 1000);

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const POST = (ruta, token, cuerpo) => new Promise(res => {
    const datos = JSON.stringify(cuerpo || {});
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: "POST",
      headers: {
        "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}`,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j }); }); });
    req.on("error", () => res({ estado: 0 }));
    req.write(datos); req.end();
  });

  const ajeno = await POST("/medico/operador/plan", tkAjeno, { phone: "5511900001", plan: "mensual", referencia: "x" });
  verificar("un médico común recibe 404, no un cartel de permisos", ajeno.estado === 404);

  const sinRef = await POST("/medico/operador/plan", tk, { phone: "5511900001", plan: "mensual" });
  verificar("sin referencia del pago no se activa", sinRef.estado === 400);

  const inventado = await POST("/medico/operador/plan", tk, { phone: "5511900001", plan: "trimestral", referencia: "PIX-1" });
  verificar("un plan que no existe se rechaza", inventado.estado === 400);

  const ok = await POST("/medico/operador/plan", tk, { phone: "5511900001", plan: "mensual", referencia: "PIX-1" });
  verificar("con todo en orden se activa", ok.estado === 200);
  verificar("  ...y cobra el precio brasileño", ok.cuerpo.precioCentavos === 40000);

  const guardado = await Medico.findOne({ phone: "5511900001" }).lean();
  verificar("queda escrito quién lo activó", guardado.suscripcion.activadaPor === "70000009");
  verificar("  ...y en qué moneda se cobró", guardado.suscripcion.moneda === "BRL");

  const auditoria = await AuditLog.findOne({ accion: "plan_activado" }).lean();
  verificar("queda en el log de auditoría", Boolean(auditoria));
  verificar("  ...con la referencia del pago", /PIX-1/.test(auditoria.detalle || ""));

  // Renovar conserva desde cuándo es cliente: pisarlo con hoy borraría que
  // este médico paga desde hace un año.
  const desdeAntes = guardado.suscripcion.desde;
  const renov = await POST("/medico/operador/plan", tk, { phone: "5511900001", plan: "mensual", referencia: "PIX-2" });
  verificar("renovar se marca como renovación", renov.cuerpo.renovacion === true);
  const trasRenovar = await Medico.findOne({ phone: "5511900001" }).lean();
  verificar("  ...y conserva desde cuándo es cliente",
    new Date(trasRenovar.suscripcion.desde).getTime() === new Date(desdeAntes).getTime());
  verificar("  ...sumando el mes al vencimiento anterior",
    new Date(trasRenovar.suscripcion.hasta) > new Date(guardado.suscripcion.hasta));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
