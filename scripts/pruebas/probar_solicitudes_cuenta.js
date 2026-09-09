// Symphomed — Que registrarse no sea entrar.
//
// Hasta ahora cualquiera con un teléfono se creaba una cuenta de médico y
// quedaba adentro de un sistema de historias clínicas, al instante. Ahora
// registrarse pone a la persona en una fila.
//
// Lo que se prueba acá es cada eslabón de esa puerta, incluido el que es
// fácil olvidar: que las cuentas QUE YA EXISTÍAN sigan entrando. Un cambio
// así, mal hecho, deja a todos los médicos que hoy trabajan afuera de su
// propio sistema, con sus pacientes en la sala de espera.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.OPERADORES_SALDO = "70000009";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Cada pedido llega con su propia IP. No es para esquivar el limitador: es
// que los médicos de verdad no comparten una sola IP, y con todos cayendo en
// 127.0.0.1 el noveno intento de la prueba chocaba con el límite de auth
// (8 cada 10 minutos) y fallaban comprobaciones que no tenían nada que ver.
let nPedido = 0;
function pedir(servidor, metodo, ruta, token, cuerpo) {
  const ipFalsa = `203.0.113.${(nPedido++ % 250) + 1}`;
  return new Promise((resolver) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        "X-Forwarded-For": ipFalsa,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, (res) => {
      let texto = "";
      res.on("data", (d) => { texto += d; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(texto); } catch { /* no era JSON */ }
        resolver({ estado: res.statusCode, cuerpo: json });
      });
    });
    req.on("error", () => resolver({ estado: 0, cuerpo: null }));
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vitalis_prueba");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  require(path.join(RAIZ, "routes", "solicitudesCuenta"))(app);
  // Sin esto un throw de una ruta async sale como HTML de Express y las
  // comprobaciones de mensaje no encuentran nada.
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const POST = (ruta, token, cuerpo) => pedir(servidor, "POST", ruta, token, cuerpo);
  const GET = (ruta, token) => pedir(servidor, "GET", ruta, token);

  const REGISTRO = {
    phone: "70000001", nombre: "Dra. Nueva", password: "Prueba123.",
    matricula: "MP-4455", tipoEspecialidad: "medicina_general", mensaje: "Atiendo en Cochabamba",
  };

  console.log("── 1. Registrarse ya no es entrar ──");
  const alta = await POST("/medico/registro", null, REGISTRO);
  verificar("la solicitud se acepta", alta.estado === 200);
  verificar("  ...y avisa que queda pendiente", alta.cuerpo?.pendiente === true);

  const enBase = await Medico.findOne({ phone: REGISTRO.phone }).lean();
  verificar("la cuenta nace apagada", enBase.activo === false);
  verificar("  ...y en estado pendiente", enBase.estadoCuenta === "pendiente");
  verificar("  ...con la matrícula guardada", enBase.matricula === "MP-4455");
  verificar("  ...y lo que escribió, entero", enBase.solicitud.mensaje === "Atiendo en Cochabamba");

  const login = await POST("/medico/login", null, { phone: REGISTRO.phone, password: REGISTRO.password });
  verificar("con la contraseña correcta TODAVÍA no entra", login.estado === 403);
  verificar("  ...y no se le da ningún token", !login.cuerpo?.token);
  // Antes esto caía en "teléfono o contraseña incorrectos" y el médico se
  // pasaba la tarde reescribiendo bien una contraseña que ya estaba bien.
  verificar("  ...y se le dice que está en revisión, no que erró la clave",
    /revisión/i.test(login.cuerpo?.error || ""));

  console.log("\n── 2. Sin matrícula no hay solicitud ──");
  const sinMatricula = await POST("/medico/registro", null, { ...REGISTRO, phone: "70000002", matricula: "" });
  verificar("se rechaza", sinMatricula.estado === 400);
  verificar("  ...diciendo qué falta", /matrícula/i.test(sinMatricula.cuerpo?.error || ""));

  console.log("\n── 3. Un teléfono sin cuenta no se delata ──");
  // Si a un teléfono desconocido se le dijera algo distinto que a uno
  // pendiente, se podría averiguar quién tiene cuenta en Symphomed probando
  // números. Los dos casos sin la contraseña correcta contestan igual.
  const inexistente = await POST("/medico/login", null, { phone: "79999999", password: "loquesea" });
  const pendienteMalaClave = await POST("/medico/login", null, { phone: REGISTRO.phone, password: "claveEquivocada" });
  verificar("teléfono inexistente: 401", inexistente.estado === 401);
  verificar("pendiente con clave mala: el MISMO 401",
    pendienteMalaClave.estado === 401 && pendienteMalaClave.cuerpo?.error === inexistente.cuerpo?.error);

  console.log("\n── 4. Las cuentas que ya existían siguen entrando ──");
  // El caso que rompe un sistema en producción. Las cuentas viejas no tienen
  // estadoCuenta guardado: si el default fuera "pendiente", el despliegue
  // dejaría afuera a todos los médicos que hoy trabajan.
  await Medico.collection.insertOne({
    phone: "70000003", nombre: "Dr. De Siempre",
    passwordHash: await hashPassword("Prueba123."), activo: true,
  });
  const viejo = await POST("/medico/login", null, { phone: "70000003", password: "Prueba123." });
  verificar("una cuenta anterior al cambio entra igual", viejo.estado === 200 && Boolean(viejo.cuerpo?.token));

  console.log("\n── 5. La fila la ve solo quien aprueba ──");
  const hash = await hashPassword("Prueba123.");
  await Medico.create({ phone: "70000008", nombre: "Dr. Cualquiera", passwordHash: hash, activo: true });
  await Medico.create({
    phone: "70000009", nombre: "Quien Aprueba", passwordHash: hash, activo: true,
    dosFA: { activo: true, secreto: "X" },
  });
  const tkCualquiera = generarToken("70000008", "medico", 3600 * 1000);
  const tkAprobador = generarToken("70000009", "medico", 3600 * 1000);

  const ajeno = await GET("/medico/solicitudes-cuenta", tkCualquiera);
  // 404 y no 403: a quien no aprueba no se le confirma que esta pantalla existe.
  verificar("un médico común recibe 404, no 'no tenés permiso'", ajeno.estado === 404);

  const cola = await GET("/medico/solicitudes-cuenta", tkAprobador);
  verificar("quien aprueba ve la fila", cola.estado === 200);
  verificar("  ...con la solicitud adentro",
    (cola.cuerpo?.pendientes || []).some(s => s.phone === REGISTRO.phone));

  console.log("\n── 6. Sin segundo factor no se aprueba a nadie ──");
  await Medico.updateOne({ phone: "70000009" }, { $set: { "dosFA.activo": false } });
  const sin2fa = await POST(`/medico/solicitudes-cuenta/${REGISTRO.phone}/aprobar`, tkAprobador, {});
  verificar("se rechaza", sin2fa.estado === 403);
  verificar("  ...y se dice que falta el 2FA", sin2fa.cuerpo?.requiere2fa === true);
  await Medico.updateOne({ phone: "70000009" }, { $set: { "dosFA.activo": true } });

  console.log("\n── 7. Aprobar abre la puerta ──");
  const aprobada = await POST(`/medico/solicitudes-cuenta/${REGISTRO.phone}/aprobar`, tkAprobador, {});
  verificar("se aprueba", aprobada.estado === 200);

  const yaEntra = await POST("/medico/login", null, { phone: REGISTRO.phone, password: REGISTRO.password });
  verificar("ahora sí entra", yaEntra.estado === 200 && Boolean(yaEntra.cuerpo?.token));

  const tras = await Medico.findOne({ phone: REGISTRO.phone }).lean();
  verificar("queda escrito QUIÉN aprobó", tras.solicitud.resueltaPor === "70000009");
  verificar("  ...y cuándo", Boolean(tras.solicitud.resueltaEn));

  // Dos pestañas abiertas, un doble toque: no puede reescribir quién aprobó.
  const deNuevo = await POST(`/medico/solicitudes-cuenta/${REGISTRO.phone}/aprobar`, tkAprobador, {});
  verificar("aprobar dos veces no rompe ni reescribe",
    deNuevo.estado === 200 && deNuevo.cuerpo?.yaEstaba === true);

  console.log("\n── 8. Rechazar exige un motivo, y el motivo se le dice ──");
  await POST("/medico/registro", null, { ...REGISTRO, phone: "70000004", nombre: "Dr. Rechazado" });

  const sinMotivo = await POST("/medico/solicitudes-cuenta/70000004/rechazar", tkAprobador, {});
  verificar("sin motivo no se puede rechazar", sinMotivo.estado === 400);

  const rechazo = await POST("/medico/solicitudes-cuenta/70000004/rechazar", tkAprobador, { motivo: "La matrícula no figura en el colegio" });
  verificar("con motivo, se rechaza", rechazo.estado === 200);

  const trasRechazo = await POST("/medico/login", null, { phone: "70000004", password: REGISTRO.password });
  verificar("no entra", trasRechazo.estado === 403);
  // Un "no" sin explicación produce un segundo intento idéntico y un
  // WhatsApp preguntando por qué.
  verificar("  ...y se le dice el motivo",
    /colegio/i.test(trasRechazo.cuerpo?.error || ""));

  console.log("\n── 9. Una cuenta en uso no se 'rechaza' ──");
  // Rechazar borra el acceso de alguien que ya está trabajando, con
  // pacientes cargados, por un botón que estaba pensado para otra cosa.
  const rechazarAprobada = await POST(`/medico/solicitudes-cuenta/${REGISTRO.phone}/rechazar`, tkAprobador, { motivo: "me arrepentí" });
  verificar("se frena y se explica cuál es la vía correcta",
    rechazarAprobada.estado === 409 && /baja|desactiva/i.test(rechazarAprobada.cuerpo?.error || ""));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
