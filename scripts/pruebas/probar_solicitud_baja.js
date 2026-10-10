// Symphomed — Cerrar la propia cuenta, de punta a punta.
//
// ═══ QUÉ SE VIGILA ACÁ, Y POR QUÉ ═══════════════════════════════════════════
//
// Esta ruta EXISTE por 5.1.1(v) de Apple y la política de borrado de cuenta
// de Google Play — no por un pedido de un médico. Lo que puede salir mal acá
// tiene dos caras opuestas: que alguien apague la cuenta de otro médico sin
// que un operador de verdad lo haya decidido, o que un cierre aprobado se
// lleve puesta la historia clínica de los pacientes — que es exactamente lo
// que routes/solicitudBaja.js dice que NO hace.
//
// Se levanta el servidor de verdad, igual que probar_reseteo_clave.js: el
// orden de los `if` y qué campo se toca de verdad importan más que la
// lectura del código.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPERADORES_SALDO = "70000001,70000004";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("baja");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "solicitudBaja"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, SolicitudBaja, AuditLog } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword, verificarPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await SolicitudBaja.init(); // el índice parcial es lo que se prueba

  const clave = await hashPassword("ClaveVieja1234!");
  const con2fa = { activo: true, secreto: "SECRETO", secretoPendiente: "" };

  const aprobador = await Medico.create({ phone: "70000001", nombre: "Operadora", passwordHash: clave, dosFA: con2fa, activo: true });
  const comun = await Medico.create({ phone: "70000002", nombre: "Dr. Común", passwordHash: clave, dosFA: con2fa, activo: true });
  const sinDosFa = await Medico.create({ phone: "70000004", nombre: "Operador sin 2FA", passwordHash: clave, activo: true });

  // El médico que se va a arrepentir de todos modos, y sigue con acceso
  // hasta que alguien lo apruebe.
  const medico = await Medico.create({ phone: "71000001", nombre: "Dra. Alejandra Quiroga",
    passwordHash: clave, activo: true, estadoCuenta: "aprobada", dosFA: con2fa });

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, token, metodo = "GET", cuerpo = null) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}`,
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j, texto: t }); }); });
    req.on("error", () => res({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });

  const tkAprobador = generarToken("70000001", "medico", 3600000);
  const tkComun = generarToken("70000002", "medico", 3600000);
  const tkSinDosFa = generarToken("70000004", "medico", 3600000);
  const tkMedico = generarToken("71000001", "medico", 3600000);

  // ═══ 1. PEDIRLO REQUIERE SESIÓN ══════════════════════════════════════════
  console.log("── 1. Sin sesión, no se puede pedir el cierre de nadie ──");
  const sinSesion = await pedir("/medico/baja/solicitar", null, "POST", { motivo: "" });
  verificar("sin token, 401", sinSesion.estado === 401);
  verificar("  ...y no creó ningún pedido", !(await SolicitudBaja.exists({})));

  // ═══ 2. EL MÉDICO PIDE EL SUYO ═══════════════════════════════════════════
  console.log("\n── 2. Un médico pide cerrar su propia cuenta ──");
  const pedido = await pedir("/medico/baja/solicitar", tkMedico, "POST", { motivo: "Me jubilo" });
  verificar("responde 200", pedido.estado === 200);
  verificar("  ...y crea el pedido pendiente", await SolicitudBaja.exists({ telefono: "71000001", estado: "pendiente" }));
  verificar("  ...con el motivo guardado", (await SolicitudBaja.findOne({ telefono: "71000001" })).motivo === "Me jubilo");
  verificar("  ...y la cuenta SIGUE activa: pedir no es lo mismo que aprobar",
    (await Medico.findById(medico._id)).activo === true);

  const estado = await pedir("/medico/baja/estado", tkMedico);
  verificar("el médico puede ver que tiene un pedido pendiente", estado.estado === 200 && estado.cuerpo.pendiente === true);

  // ═══ 3. NO SE APILAN PEDIDOS ═════════════════════════════════════════════
  console.log("\n── 3. Pedirlo dos veces no llena la cola de filas iguales ──");
  await pedir("/medico/baja/solicitar", tkMedico, "POST", { motivo: "otra vez" });
  verificar("sigue habiendo UN solo pedido pendiente para ese teléfono",
    await SolicitudBaja.countDocuments({ telefono: "71000001", estado: "pendiente" }) === 1);

  // ═══ 4. LA COLA ES SOLO PARA OPERADORES ══════════════════════════════════
  console.log("\n── 4. La cola de pedidos, con el mismo candado que pagos y reseteos ──");
  for (const [quien, token] of [["un médico común", tkComun], ["un operador sin 2FA", tkSinDosFa], ["sin sesión", null]]) {
    const r = await pedir("/medico/operador/bajas", token);
    verificar(`${quien} no puede ver la cola`, r.estado === 404 || r.estado === 401 || r.estado === 403);
  }
  const cola = await pedir("/medico/operador/bajas", tkAprobador);
  verificar("el operador SÍ la ve", cola.estado === 200 && cola.cuerpo.pedidos.length === 1);
  const pedidoCola = cola.cuerpo.pedidos[0];
  verificar("  ...con el nombre y el motivo, para decidir con contexto",
    pedidoCola.nombre === "Dra. Alejandra Quiroga" && pedidoCola.motivo === "Me jubilo");

  // ═══ 5. APROBAR ES EJECUTAR, EN EL ACTO ══════════════════════════════════
  console.log("\n── 5. Aprobar apaga la cuenta ya mismo ──");
  for (const [quien, token] of [["un médico común", tkComun], ["un operador sin 2FA", tkSinDosFa]]) {
    const r = await pedir(`/medico/operador/bajas/${pedidoCola._id}/aprobar`, token, "POST", {});
    verificar(`${quien} no puede aprobar`, r.estado === 404 || r.estado === 403);
  }
  verificar("  ...y esos intentos fallidos no tocaron nada", (await Medico.findById(medico._id)).activo === true);

  const aprobado = await pedir(`/medico/operador/bajas/${pedidoCola._id}/aprobar`, tkAprobador, "POST", {});
  verificar("el operador aprueba", aprobado.estado === 200);

  const medicoCerrado = await Medico.findById(medico._id);
  verificar("  ...y la cuenta queda apagada EN EL ACTO", medicoCerrado.activo === false);
  verificar("  ...con la contraseña vieja invalidada (no sirve para entrar de nuevo)",
    !(await verificarPassword("ClaveVieja1234!", medicoCerrado.passwordHash)).ok);
  verificar("  ...y el 2FA también apagado, para que no quede una llave vieja pendiente",
    medicoCerrado.dosFA?.activo === false);

  const solicitudResuelta = await SolicitudBaja.findById(pedidoCola._id);
  verificar("el pedido queda marcado «aprobada», con quién y cuándo",
    solicitudResuelta.estado === "aprobada" && solicitudResuelta.aprobadaPor === "70000001" && Boolean(solicitudResuelta.aprobadaEn));

  const aprobarDeNuevo = await pedir(`/medico/operador/bajas/${pedidoCola._id}/aprobar`, tkAprobador, "POST", {});
  verificar("aprobar un pedido que ya no está pendiente se rechaza", aprobarDeNuevo.estado === 404);

  // ═══ 6. LA CUENTA CERRADA YA NO ENTRA ═══════════════════════════════════
  //
  // Ni con la sesión que tenía abierta (se corta al aprobar la baja) ni con
  // una nueva: requireAuth mira la cuenta en cada pedido (segunda revisión
  // de QA del 9 de octubre de 2026, R02). Antes la sesión abierta seguía
  // entrando hasta que vencía el token.
  console.log("\n── 6. Una cuenta ya cerrada no entra, ni genera un pedido nuevo sobre sí misma ──");
  const pedidosAntes = await SolicitudBaja.countDocuments({ telefono: "71000001" });
  const conLaAbierta = await pedir("/medico/baja/solicitar", tkMedico, "POST", { motivo: "" });
  verificar("la sesión que estaba abierta → 401: se cortó con la baja", conLaAbierta.estado === 401);
  const conUnaNueva = await pedir("/medico/baja/solicitar", generarToken("71000001", "medico", 3600000), "POST", { motivo: "" });
  verificar("  ...y una sesión nueva tampoco entra (401): la cuenta está apagada", conUnaNueva.estado === 401);
  verificar("  ...sin crear otro pedido", (await SolicitudBaja.countDocuments({ telefono: "71000001" })) === pedidosAntes);

  // ═══ 7. RECHAZAR NO TOCA LA CUENTA ═══════════════════════════════════════
  console.log("\n── 7. Rechazar deja la cuenta como estaba ──");
  const otroMedico = await Medico.create({ phone: "71000002", nombre: "Dr. Se Arrepiente",
    passwordHash: clave, activo: true, estadoCuenta: "aprobada" });
  const tkOtro = generarToken("71000002", "medico", 3600000);
  await pedir("/medico/baja/solicitar", tkOtro, "POST", { motivo: "" });
  const pedidoOtro = (await pedir("/medico/operador/bajas", tkAprobador)).cuerpo.pedidos.find(p => p.telefono === "71000002");
  const rechazado = await pedir(`/medico/operador/bajas/${pedidoOtro._id}/rechazar`, tkAprobador, "POST", { nota: "no reconozco el pedido" });
  verificar("se puede rechazar", rechazado.estado === 200);
  verificar("  ...y la cuenta SIGUE activa", (await Medico.findById(otroMedico._id)).activo === true);
  verificar("  ...con la nota guardada",
    (await SolicitudBaja.findById(pedidoOtro._id)).nota === "no reconozco el pedido");

  // Con el anterior resuelto (rechazado), un pedido nuevo tiene que poder
  // crearse: el índice parcial solo bloquea "pendiente".
  const pedirOtraVez = await pedir("/medico/baja/solicitar", tkOtro, "POST", { motivo: "" });
  verificar("después de un rechazo, se puede volver a pedir", pedirOtraVez.estado === 200);

  // ═══ 8. QUEDA EN AUDITORÍA ════════════════════════════════════════════════
  console.log("\n── 8. Cada paso queda anotado ──");
  for (const accion of ["solicitar_baja_cuenta", "aprobar_baja_cuenta", "rechazar_baja_cuenta"]) {
    verificar(`se registra «${accion}»`, await AuditLog.exists({ accion }));
  }

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
