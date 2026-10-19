// Symphomed — Una sesión vale mientras valga su cuenta (services/auth.js,
// sesionVigente).
//
// Un token dura 8 horas, y antes valía hasta vencer aunque la cuenta se
// diera de baja, se borrara o le cambiaran la contraseña: seguía entrando, y
// una cuenta de estudiante seguía pidiéndole respuestas a la IA (segunda
// revisión de QA del 9 de octubre de 2026, R02). Lo que se prueba:
//   1. Las cuentas de siempre (sin los campos nuevos) siguen entrando: el día
//      del despliegue ningún médico tiene «activo» ni «sesionesDesde».
//   2. Desactivada, borrada o con las sesiones cortadas → 401, en las rutas
//      de médico y en las de administración de la clínica.
//   3. Un estudiante dado de baja no le pide nada a la IA, ni por el freno
//      del módulo ni por la ruta.
//   4. El token va solo en la cabecera: en la URL queda escrito en el log de
//      nginx (auditoría de QA, M9).
//   5. «Cerrar todas las sesiones» corta las de los otros aparatos y le da a
//      la que lo pidió un token nuevo, el mismo que daría el login.
//   6. Activar el 2FA corta las sesiones que se abrieron sin él.
//   7. Las sesiones de socio también se cortan: suspendido o con la clave
//      restablecida, ya no entra con el token que tenía.
//   8. El tiempo real (/ws) sigue la misma regla, al conectar y en cada
//      latido, y corta al que dejó de contestar (B-L4).
//   9. El secreto del webhook de Vapi se compara en tiempo constante.
// El corte en cada flujo real (restablecer la clave, aprobar una baja,
// desvincular de la clínica, convertir a un estudiante) lo prueba la prueba
// de cada uno.
const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// La IA de mentira: solo cuenta si la llamaron.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
let llamadasIA = 0;
axios.post = async () => {
  llamadasIA++;
  return { data: { choices: [{ message: { content: JSON.stringify({ respuesta: "Hola" }) } }] } };
};

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "sesiones";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken, requireAuth, requireAdmin } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const clinica = await M.Clinica.create({ nombre: "Clínica de Prueba" });
  const express = require("express");
  const app = express();
  app.use(express.json());
  // El módulo de estudiantes, como en index.js (antes de las rutas), y una
  // ruta que le pregunta a la IA: la ayuda de Symphomed.
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  require(path.join(RAIZ, "routes", "asistenteSymphomed"))(app);
  for (const ruta of ["medicoAuth", "socio", "reseteoClave", "vapi"]) require(path.join(RAIZ, "routes", ruta))(app);
  app.get("/medico/prueba-sesion", requireAuth(["medico"]), (req, res) => res.json({ ok: true, quien: req.adminUser.usuario }));
  app.get("/admin/prueba-sesion", requireAdmin, (req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  // El tiempo real, con un latido corto para no esperar 30 segundos.
  const tiempoReal = require(path.join(RAIZ, "services", "realtime"));
  tiempoReal.AJUSTES.LATIDO_MS = 150;
  tiempoReal.iniciarServidorTiempoReal(servidor);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);
  const tk = (phone, rol = "medico", extra = {}) => generarToken(phone, rol, 36e5, extra);

  console.log("── 1. Las cuentas de siempre siguen entrando ──");
  // Como están hoy en producción: sin «activo» ni «sesionesDesde».
  await M.Medico.collection.insertOne({ phone: "70093001", nombre: "Dr. De Antes", passwordHash: "x", createdAt: new Date("2025-01-01") });
  let r = await P("GET", "/medico/prueba-sesion", tk("70093001"));
  verificar("una cuenta sin los campos nuevos (como todas las de producción) → entra", r.estado === 200 && r.cuerpo.quien === "70093001");
  await M.Medico.create({ phone: "70093002", nombre: "Dra. Activa", passwordHash: "x", activo: true });
  verificar("una cuenta activa → entra", (await P("GET", "/medico/prueba-sesion", tk("70093002"))).estado === 200);

  console.log("\n── 2. Sin cuenta, desactivada o con las sesiones cortadas → 401 ──");
  const abiertaAntes = tk("70093002");
  verificar("sin cuenta (el token es de un teléfono que no existe) → 401", (await P("GET", "/medico/prueba-sesion", tk("70093099"))).estado === 401);
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { activo: false } });
  r = await P("GET", "/medico/prueba-sesion", abiertaAntes);
  verificar("desactivada → 401, con «volvé a iniciar sesión»", r.estado === 401 && /iniciar sesión/.test(r.cuerpo?.error || ""));
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { activo: true } });
  verificar("  ...y si la reactivan, vuelve a entrar", (await P("GET", "/medico/prueba-sesion", abiertaAntes)).estado === 200);
  await esperar(5);
  await M.Medico.updateOne({ phone: "70093002" }, { $set: { sesionesDesde: new Date() } });
  verificar("con las sesiones cortadas (clave nueva, permisos nuevos) → la de antes, 401", (await P("GET", "/medico/prueba-sesion", abiertaAntes)).estado === 401);
  verificar("  ...y una sesión nueva entra", (await P("GET", "/medico/prueba-sesion", tk("70093002"))).estado === 200);
  await M.Medico.deleteOne({ phone: "70093001" });
  verificar("borrada → 401", (await P("GET", "/medico/prueba-sesion", tk("70093001"))).estado === 401);
  // La administración de la clínica pasa por otra puerta (requireAdmin).
  await M.Medico.create({ phone: "70093003", nombre: "Administración", passwordHash: "x", activo: true, rol: "admin", clinicaId: clinica._id });
  const tkAdmin = tk("70093003", "admin", { admin: true, clinicaId: String(clinica._id) });
  verificar("la administración de la clínica, con la cuenta activa → entra", (await P("GET", "/admin/prueba-sesion", tkAdmin)).estado === 200);
  await M.Medico.updateOne({ phone: "70093003" }, { $set: { activo: false } });
  verificar("  ...desactivada → 401", (await P("GET", "/admin/prueba-sesion", tkAdmin)).estado === 401);
  verificar("  ...y tampoco entra por las rutas de médico", (await P("GET", "/medico/prueba-sesion", tk("70093003", "admin"))).estado === 403);

  console.log("\n── 3. Un estudiante dado de baja no le pide nada a la IA ──");
  const est = { nivel: "interno", hasta: new Date(Date.now() + 90 * 86400000), horasMes: 6 };
  await M.Medico.create({ phone: "59170093004", nombre: "Est Activo", passwordHash: "x", activo: true, estudiante: est });
  const tkEst = tk("59170093004", "medico", { estudiante: true });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Cómo grabo una consulta?", historial: [] });
  const iaConCuenta = llamadasIA;
  verificar("con la cuenta activa, la ayuda contesta (y le pregunta a la IA)", r.estado === 200 && iaConCuenta > 0);
  await M.Medico.updateOne({ phone: "59170093004" }, { $set: { activo: false } });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Y ahora?", historial: [] });
  verificar("desactivado, con la sesión abierta → 401, sin llamar a la IA", r.estado === 401 && llamadasIA === iaConCuenta);
  await M.Medico.deleteOne({ phone: "59170093004" });
  r = await P("POST", "/medico/asistente", tkEst, { pregunta: "¿Y ahora?", historial: [] });
  verificar("borrado → 401, sin llamar a la IA", r.estado === 401 && llamadasIA === iaConCuenta);
  r = await P("POST", "/medico/pacientes-virtuales/000000000000000000000000/mensajes", tkEst, { tipo: "pregunta", texto: "hola" });
  verificar("  ...tampoco al paciente virtual: el freno del módulo corta antes (401)", r.estado === 401 && llamadasIA === iaConCuenta);

  // Espera a que algo pase, sin depender del reloj: a lo sumo «vueltas» × 20 ms.
  const hasta = async (condicion, vueltas = 150) => { for (let i = 0; i < vueltas && !condicion(); i++) await esperar(20); return condicion(); };
  // La auditoría se escribe sin esperarla (services/auditoria.js).
  const enActividad = async (phone, accion) => {
    let n = 0;
    for (let i = 0; i < 50 && !n; i++) { n = await M.AuditLog.countDocuments({ medicoPhone: phone, accion }); if (!n) await esperar(20); }
    return n;
  };
  const { verificarToken } = require(path.join(RAIZ, "services", "auth"));

  console.log("\n── 4. El token va solo en la cabecera ──");
  const tkCabecera = tk("70093002");
  verificar("una sesión válida mandada en la URL (?token=) → 401", (await P("GET", `/medico/prueba-sesion?token=${encodeURIComponent(tkCabecera)}`)).estado === 401);
  verificar("  ...la misma, en la cabecera → entra", (await P("GET", "/medico/prueba-sesion", tkCabecera)).estado === 200);
  await M.Medico.updateOne({ phone: "70093003" }, { $set: { activo: true } });
  verificar("  ...tampoco en la administración de la clínica", (await P("GET", `/admin/prueba-sesion?token=${encodeURIComponent(tkAdmin)}`)).estado === 401);
  const { claveDeMedico } = require(path.join(RAIZ, "services", "ratelimit"));
  verificar("  ...y el límite por médico tampoco la lee de la URL",
    claveDeMedico({ headers: {}, query: { token: tkCabecera }, socket: { remoteAddress: "198.51.100.1" } }) === "ip:198.51.100.1");

  console.log("\n── 5. Cerrar todas las sesiones ──");
  await M.Medico.create({ phone: "70093010", nombre: "Dra. Directora", passwordHash: "x", activo: true, rol: "director", clinicaId: clinica._id });
  const deDirectora = { admin: true, clinicaId: String(clinica._id) };
  const celular = tk("70093010", "medico", deDirectora);
  const compu = tk("70093010", "medico", deDirectora);
  await esperar(5);
  r = await P("POST", "/medico/sesiones/cerrar-todas", compu, {});
  const compuNueva = r.cuerpo?.token;
  verificar("desde la compu → 200, con un token nuevo", r.estado === 200 && !!compuNueva);
  verificar("  ...el celular perdido → 401", (await P("GET", "/medico/prueba-sesion", celular)).estado === 401);
  verificar("  ...el token de antes de la compu también → 401", (await P("GET", "/medico/prueba-sesion", compu)).estado === 401);
  verificar("  ...con el nuevo, la compu sigue adentro", (await P("GET", "/medico/prueba-sesion", compuNueva)).estado === 200);
  verificar("  ...y sigue siendo directora: administra su clínica (el mismo token que el login)", (await P("GET", "/admin/prueba-sesion", compuNueva)).estado === 200);
  verificar("  ...y queda en su actividad", (await enActividad("70093010", "cerrar_todas_las_sesiones")) === 1);
  await esperar(5);
  r = await P("POST", "/medico/sesiones/cerrar-todas", tkAdmin, {});
  verificar("una cuenta administrativa también puede, y sigue siendo administrativa (no pasa a médico)",
    r.estado === 200 && verificarToken(r.cuerpo.token)?.rol === "admin" && (await P("GET", "/admin/prueba-sesion", r.cuerpo.token)).estado === 200);
  await M.Medico.create({ phone: "59170093011", nombre: "Est Cuidadosa", passwordHash: "x", activo: true, estudiante: est });
  r = await P("POST", "/medico/sesiones/cerrar-todas", tk("59170093011", "medico", { estudiante: true }), {});
  verificar("  ...y un estudiante también (el módulo se lo deja: es de su cuenta)", r.estado === 200 && verificarToken(r.cuerpo.token)?.estudiante === true);

  console.log("\n── 6. Activar el 2FA corta las sesiones que se abrieron sin él ──");
  const { totp } = require(path.join(RAIZ, "services", "totp"));
  await M.Medico.create({ phone: "70093012", nombre: "Dr. Cuidadoso", passwordHash: "x", activo: true });
  const otraPestana = tk("70093012");
  const estaPestana = tk("70093012");
  await esperar(5);
  r = await P("POST", "/medico/2fa/iniciar", estaPestana, {});
  r = await P("POST", "/medico/2fa/confirmar", estaPestana, { codigo: totp(r.cuerpo.secreto) });
  const conDosFA = r.cuerpo?.token;
  verificar("activarlo → 200, con un token nuevo", r.estado === 200 && !!conDosFA);
  verificar("  ...la otra pestaña, abierta sin 2FA → 401", (await P("GET", "/medico/prueba-sesion", otraPestana)).estado === 401);
  verificar("  ...y esta sigue, con el nuevo", (await P("GET", "/medico/prueba-sesion", conDosFA)).estado === 200);

  console.log("\n── 7. Las sesiones de socio también se cortan ──");
  const socio = await M.Socio.create({ phone: "72093001", nombre: "Distribuidora de Prueba", passwordHash: "x", activo: true });
  const tkSocio = generarToken("72093001", "socio", 36e5, { socioId: String(socio._id) });
  verificar("un socio activo entra a su cartera", (await P("GET", "/socio/cuentas", tkSocio)).estado === 200);
  verificar("  ...pero no con el token en la URL", (await P("GET", `/socio/cuentas?token=${encodeURIComponent(tkSocio)}`)).estado === 401);
  await M.Socio.updateOne({ _id: socio._id }, { $set: { activo: false } });
  verificar("suspendido, con la sesión abierta → 401 (antes seguía viendo su cartera)", (await P("GET", "/socio/cuentas", tkSocio)).estado === 401);
  await M.Socio.updateOne({ _id: socio._id }, { $set: { activo: true } });
  verificar("  ...reactivado, vuelve a entrar", (await P("GET", "/socio/cuentas", tkSocio)).estado === 200);
  await esperar(5);
  const enlace = "r".repeat(40);
  await M.SolicitudReseteo.create({ tipo: "socio", telefono: "72093001", nombre: "Distribuidora de Prueba", estado: "aprobada", token: enlace, tokenExpira: new Date(Date.now() + 36e5) });
  r = await P("POST", `/restablecer-clave/${enlace}`, null, { password: "ClaveNueva12345" });
  verificar("restablecerle la clave → 200", r.estado === 200);
  verificar("  ...y la sesión que tenía abierta → 401", (await P("GET", "/socio/cuentas", tkSocio)).estado === 401);
  verificar("  ...una sesión nueva entra", (await P("GET", "/socio/cuentas", generarToken("72093001", "socio", 36e5, { socioId: String(socio._id) }))).estado === 200);

  console.log("\n── 8. El tiempo real sigue la misma regla, y tiene latido ──");
  const WebSocket = require(path.join(RAIZ, "node_modules", "ws"));
  const conectar = (token, opciones = {}) => new Promise((resolve) => {
    const c = new WebSocket(`ws://127.0.0.1:${servidor.address().port}/ws?token=${encodeURIComponent(token)}`, opciones);
    const s = { c, mensajes: 0, pings: 0, cerrado: null };
    c.on("message", () => { s.mensajes++; });
    c.on("ping", () => { s.pings++; });
    c.on("close", (codigo) => { s.cerrado = codigo; });
    c.on("error", () => {});
    c.on("open", () => resolve(s));
  });
  for (const phone of ["70093020", "70093021", "70093022"]) await M.Medico.create({ phone, nombre: "Dr. " + phone, passwordHash: "x", activo: true });
  await M.Medico.updateOne({ phone: "70093021" }, { $set: { activo: false } });
  const tkWs = tk("70093020");
  const abierto = await conectar(tkWs);
  // Se registra recién cuando la base dijo que sí: se avisa hasta que llegue.
  await hasta(() => { tiempoReal.avisarCambio("70093020"); return abierto.mensajes > 0; });
  verificar("con la cuenta activa, conecta y recibe los avisos", abierto.mensajes > 0 && abierto.cerrado === null);
  await hasta(() => abierto.pings >= 2);
  verificar(`  ...y el servidor le hace ping (${abierto.pings})`, abierto.pings >= 2 && abierto.cerrado === null);
  const deBaja = await conectar(tk("70093021"));
  await hasta(() => deBaja.cerrado !== null);
  verificar("una cuenta dada de baja → se cierra con 4001", deBaja.cerrado === 4001);
  await esperar(5);
  r = await P("POST", "/medico/sesiones/cerrar-todas", tk("70093020"), {});
  await hasta(() => abierto.cerrado !== null);
  verificar("«cerrar todas» desde otro aparato → el socket que YA estaba abierto se cierra con 4001", r.estado === 200 && abierto.cerrado === 4001);
  const mudo = await conectar(tk("70093022"), { autoPong: false });
  await hasta(() => mudo.cerrado !== null);
  verificar("un aparato que dejó de contestar (sin pong) → el servidor lo corta", mudo.cerrado !== null && mudo.cerrado !== 4001);

  console.log("\n── 9. El secreto de Vapi se compara en tiempo constante ──");
  // Que contesta lo mismo se ve pidiendo; que no se pueda medir carácter por
  // carácter, solo leyendo cómo compara.
  require(path.join(RAIZ, "config")).CONFIG.VAPI_SERVER_SECRET = "secreto-de-vapi-de-prueba";
  verificar("el secreto correcto → pasa", (await P("POST", "/vapi/webhook/70093002", "secreto-de-vapi-de-prueba", {})).estado === 200);
  verificar("  ...uno del mismo largo pero distinto → 401", (await P("POST", "/vapi/webhook/70093002", "secreto-de-vapi-de-prueBA", {})).estado === 401);
  verificar("  ...uno de otro largo → 401, no un 500", (await P("POST", "/vapi/webhook/70093002", "corto", {})).estado === 401);
  const fuenteVapi = require("fs").readFileSync(path.join(RAIZ, "routes", "vapi.js"), "utf8");
  verificar("  ...y compara con timingSafeEqual, no con !==",
    /timingSafeEqual/.test(fuenteVapi) && !/!==\s*CONFIG\.VAPI_SERVER_SECRET/.test(fuenteVapi));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
