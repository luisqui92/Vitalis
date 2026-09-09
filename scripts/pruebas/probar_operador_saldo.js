// Symphomed — Los candados de la pantalla que fabrica dinero.
//
// Todo lo demás del sistema lee o escribe datos clínicos. Esto EMITE SALDO:
// quien llegue puede darse plata infinita, y el fraude no se ve como un error
// sino como una recarga más entre otras.
//
// Lo que se verifica acá no es que la pantalla funcione — es que NO funcione
// para quien no corresponde. Contra la app real y una base descartable,
// porque los candados viven en middlewares que no existen fuera de Express.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.PRECIO_CONSULTA_CENTAVOS = "1200";
process.env.RECARGA_MINIMA_CENTAVOS = "10000";
// Los dos que pueden acreditar. Todo el resto del sistema no debería poder,
// por más admin de clínica o director que sea.
// 70000005 es la cuenta de pagos que NO atiende pacientes: ver la sección 14.
process.env.OPERADORES_SALDO = "70000001, 70000002, 70000005";

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
    console.log("   Esto NO es un ✅: la pantalla que emite saldo quedó sin probar.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  const { Medico, MovimientoSaldo, Clinica, SolicitudRecarga, ConfigPago } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await MovimientoSaldo.init();

  const hash = await hashPassword("Prueba123.");
  const clinica = await Clinica.create({ nombre: "Clínica X" });
  const con2fa = { activo: true, secreto: "SECRETO", secretoPendiente: "" };

  // El operador como debe ser: en la lista Y con segundo factor.
  await Medico.create({ phone: "70000001", nombre: "Luis (operador)", passwordHash: hash, dosFA: con2fa });
  // En la lista pero SIN 2FA: no tiene que poder.
  await Medico.create({ phone: "70000002", nombre: "Ana (operadora sin 2FA)", passwordHash: hash });
  // Un médico común, con 2FA — tener 2FA no convierte a nadie en operador.
  await Medico.create({ phone: "70000003", nombre: "Dr. Común", passwordHash: hash, dosFA: con2fa });
  // El administrador de una clínica: manda sobre siete consultorios y aun así
  // no puede emitir un centavo.
  await Medico.create({ phone: "70000004", nombre: "Admin de clínica", passwordHash: hash, rol: "admin", clinicaId: clinica._id, dosFA: con2fa });
  // La cuenta que existe SOLO para aprobar pagos: administrativa, sin clínica
  // y sin pacientes. Es la separación entre quien maneja la plata y quien la
  // gasta, que antes no se podía ni configurar.
  await Medico.create({ phone: "70000005", nombre: "María (pagos)", passwordHash: hash, rol: "admin", clinicaId: null, dosFA: con2fa });
  // El destinatario de las recargas.
  await Medico.create({ phone: "79999999", nombre: "Dra. Destino", passwordHash: hash, tipoEspecialidad: "ginecologia" });
  // Una médica en Brasil: paga por Pix, en reales, a otra cuenta. Ver la
  // sección 15 sobre por qué mostrarle la cuenta boliviana es perder plata.
  await Medico.create({ phone: "79999998", nombre: "Dra. Brasil", passwordHash: hash, idioma: "pt" });

  const tk = {
    operador: generarToken("70000001", "medico", 36e5),
    sin2fa: generarToken("70000002", "medico", 36e5),
    comun: generarToken("70000003", "medico", 36e5),
    adminClinica: generarToken("70000004", "admin", 36e5, { admin: true, clinicaId: String(clinica._id) }),
    pagos: generarToken("70000005", "admin", 36e5, { admin: true }),
    destino: generarToken("79999999", "medico", 36e5),
    brasil: generarToken("79999998", "medico", 36e5),
  };

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "operadorSaldo"))(app);
  require(path.join(RAIZ, "routes", "recargas"))(app);
  // Se monta por una sola razón, y está en la sección 14: el segundo factor
  // es OBLIGATORIO para acreditar, y se activa por estas rutas. Si le
  // contestaran 403 a una cuenta administrativa, la cuenta de pagos quedaría
  // trabada para siempre en "activá el 2FA" sin ninguna pantalla que se lo
  // permitiera — un candado sin llave, que desde afuera parece un permiso mal
  // configurado y no un bug.
  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const GET = (ruta, token) => pedir(puerto, "GET", ruta, token);
  const POST = (ruta, token, cuerpo) => pedir(puerto, "POST", ruta, token, cuerpo);

  const acreditar = (token, cuerpo) => POST("/medico/operador/acreditar", token, cuerpo);
  const DELETE = (ruta, token) => pedir(puerto, "DELETE", ruta, token);

  console.log("── 1. Quién NO puede emitir saldo ──");
  // El administrativo de clínica SÍ pasa el requireAuth —desde que el
  // operador de pagos puede ser una cuenta admin, estas rutas aceptan ese
  // rol— y se estrella contra el candado que corresponde: no está en
  // OPERADORES_SALDO. Se acepta 404 o 403 porque lo que importa es que no
  // acredite, no con qué número se le dice que no.
  for (const [quien, token] of [
    ["un médico común", tk.comun],
    ["el administrador de una clínica", tk.adminClinica],
    ["el propio médico que recibe", tk.destino],
  ]) {
    const r = await acreditar(token, { phone: "79999999", bolivianos: 200, referencia: "intento " + quien });
    verificar(`${quien} no puede acreditar (${r.estado})`, r.estado === 404 || r.estado === 403);
  }
  const sinToken = await acreditar(null, { phone: "79999999", bolivianos: 200, referencia: "sin token" });
  verificar("sin sesión tampoco", sinToken.estado === 401);
  verificar("y a nadie se le confirma que la pantalla existe (404, no 403)",
    (await GET("/medico/operador/buscar?q=dra", tk.comun)).estado === 404);
  verificar("no se acreditó ni un centavo en el intento",
    await MovimientoSaldo.countDocuments({}) === 0);

  console.log("\n── 2. Estar en la lista no alcanza: hace falta 2FA ──");
  const r2 = await acreditar(tk.sin2fa, { phone: "79999999", bolivianos: 200, referencia: "sin segundo factor" });
  verificar("un operador sin 2FA es rechazado", r2.estado === 403);
  verificar("  ...y se le dice que lo active", r2.cuerpo?.requiere2fa === true);
  const est2 = await GET("/medico/operador/estado", tk.sin2fa);
  verificar("  ...la pantalla se entera antes de que escriba nada",
    est2.cuerpo?.operador === true && est2.cuerpo?.dosFAActivo === false);
  verificar("y sigue sin haber movimientos", await MovimientoSaldo.countDocuments({}) === 0);

  console.log("\n── 3. El operador de verdad sí puede ──");
  const est = await GET("/medico/operador/estado", tk.operador);
  verificar("se reconoce como operador", est.cuerpo?.operador === true && est.cuerpo?.dosFAActivo === true);
  const estComun = await GET("/medico/operador/estado", tk.comun);
  verificar("y a un médico común le dice que no, sin ruido", estComun.estado === 200 && estComun.cuerpo?.operador === false);

  const ok = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "QR BCP 1111" });
  verificar("acredita Bs 200", ok.estado === 200 && ok.cuerpo?.saldoCentavos === 20000);
  verificar("  ...y devuelve para cuántas consultas alcanza", ok.cuerpo?.consultasRestantes === 16);

  const mov = await MovimientoSaldo.findOne({ medicoPhone: "79999999" }).lean();
  verificar("el movimiento guarda QUIÉN acreditó, con su teléfono", mov.acreditadoPor === "70000001");
  verificar("  ...y contra qué referencia", mov.referencia === "QR BCP 1111");

  console.log("\n── 4. Las mismas reglas que por consola ──");
  // Un segundo camino para crear plata con reglas distintas es cómo aparecen
  // los agujeros. Estas rutas reusan services/saldo.js sin atajos.
  const repetida = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "qr bcp  1111" });
  verificar("la misma referencia se rechaza, aunque venga escrita distinto", repetida.estado === 409);
  verificar("  ...diciendo cuándo se acreditó la primera", /ya se acreditó/.test(repetida.cuerpo?.error || ""));

  const chica = await acreditar(tk.operador, { phone: "79999999", bolivianos: 50, referencia: "QR chico" });
  verificar("por debajo del mínimo frena", chica.estado === 422);
  const chicaIgual = await acreditar(tk.operador, { phone: "79999999", bolivianos: 50, referencia: "QR chico", igual: true });
  verificar("  ...pero se puede autorizar igual", chicaIgual.estado === 200 && chicaIgual.cuerpo?.saldoCentavos === 25000);

  const sinRef = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200, referencia: "  " });
  verificar("sin referencia no acredita, y con un error legible y no un 500",
    sinRef.estado === 400 && /referencia/i.test(sinRef.cuerpo?.error || ""));
  const negativa = await acreditar(tk.operador, { phone: "79999999", bolivianos: -500, referencia: "negativa" });
  verificar("un monto negativo tampoco", negativa.estado === 400);
  const inexistente = await acreditar(tk.operador, { phone: "70009999", bolivianos: 200, referencia: "a nadie" });
  verificar("a una cuenta que no existe tampoco", inexistente.estado === 404);

  console.log("\n── 5. El techo por operación ──");
  // No protege de un operador deshonesto, que puede hacer varias cargas. Sí
  // del dedo que se resbala y convierte Bs 200 en Bs 200000.
  const enorme = await acreditar(tk.operador, { phone: "79999999", bolivianos: 200000, referencia: "dedo resbalado" });
  verificar("Bs 200.000 de una sola vez se rechaza", enorme.estado === 400);
  verificar("  ...y el saldo quedó donde estaba",
    (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === 25000);

  console.log("\n── 6. Un operador de recargas no ve historias clínicas ──");
  const busca = await GET("/medico/operador/buscar?q=destino", tk.operador);
  const encontrado = busca.cuerpo?.medicos?.[0];
  verificar("la búsqueda encuentra por nombre", encontrado?.phone === "79999999");
  const campos = new Set(Object.keys(encontrado || {}));
  const prohibidos = ["passwordHash", "dosFA", "pacientes", "consultas", "clinicaId"];
  const filtrados = prohibidos.filter(c => campos.has(c));
  verificar(
    filtrados.length === 0 ? "y devuelve identidad y saldo, nada más" : `DEVUELVE DE MÁS: ${filtrados.join(", ")}`,
    filtrados.length === 0
  );
  verificar("ni el hash de la contraseña aparece en el JSON crudo", !busca.texto.includes("passwordHash"));

  console.log("\n── 7. Avisar que pagué NO acredita nada ──");
  // La garantía central del circuito. Si una solicitud pudiera acreditarse
  // sola, cualquier médico se cargaría saldo escribiendo un número en un
  // formulario.
  const saldoAntes = (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos;
  const aviso = await POST("/medico/recargas", tk.destino, { bolivianos: 300, referencia: "QR mio 777" });
  verificar("el médico puede avisar que pagó", aviso.estado === 201);
  verificar("  ...y queda PENDIENTE", aviso.cuerpo?.solicitud?.estado === "pendiente");
  verificar("  ...sin mover un centavo", (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === saldoAntes);
  verificar("  ...y sin generar ningún movimiento",
    await MovimientoSaldo.countDocuments({ referenciaClave: "QR MIO 777" }) === 0);

  // Un aviso pendiente por vez: cinco avisos del mismo pago es cómo el
  // operador termina acreditando dos veces la misma transferencia.
  const duplicado = await POST("/medico/recargas", tk.destino, { bolivianos: 300, referencia: "QR mio 778" });
  verificar("no puede avisar dos veces mientras uno esté pendiente", duplicado.estado === 409);

  const sinRefAviso = await POST("/medico/recargas", tk.comun, { bolivianos: 200, referencia: "" });
  verificar("un aviso sin referencia se rechaza", sinRefAviso.estado === 400);

  console.log("\n── 8. La cola es solo del operador ──");
  verificar("un médico común no ve la cola",
    (await GET("/medico/operador/solicitudes", tk.comun)).estado === 404);
  const cola = await GET("/medico/operador/solicitudes", tk.operador);
  verificar("el operador sí, y ve 1 pendiente", cola.estado === 200 && cola.cuerpo?.pendientes === 1);
  verificar("  ...con el saldo actual del médico al lado",
    typeof cola.cuerpo?.solicitudes?.[0]?.saldo?.saldoBs === "string");

  // Y que nadie pueda aprobar el suyo propio.
  const solId = cola.cuerpo.solicitudes[0]._id;
  const autoAprobar = await POST(`/medico/operador/solicitudes/${solId}/aprobar`, tk.destino, {});
  verificar("el propio médico no puede aprobar su aviso", autoAprobar.estado === 404 || autoAprobar.estado === 403);
  verificar("  ...y su saldo sigue igual", (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === saldoAntes);

  console.log("\n── 9. Aprobar acredita lo que vio el OPERADOR ──");
  // El médico declaró Bs 300 pero en el banco entraron Bs 250. Se acredita lo
  // del banco: confiar en el número declarado sería dejar que el médico se
  // ponga su propio saldo con un paso extra.
  const aprobada = await POST(`/medico/operador/solicitudes/${solId}/aprobar`, tk.operador, { bolivianos: 250 });
  verificar("se aprueba", aprobada.estado === 200);
  verificar("  ...y se acreditaron 250, no los 300 declarados",
    (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === saldoAntes + 25000);
  const solAprobada = await SolicitudRecarga.findById(solId).lean();
  verificar("  ...la solicitud queda acreditada", solAprobada.estado === "acreditada");
  verificar("  ...guardando lo declarado Y lo acreditado",
    solAprobada.montoCentavos === 30000 && solAprobada.montoAcreditadoCentavos === 25000);
  verificar("  ...y quién la revisó", solAprobada.revisadaPor === "70000001");
  const yaNo = await POST(`/medico/operador/solicitudes/${solId}/aprobar`, tk.operador, { bolivianos: 250 });
  verificar("no se puede aprobar dos veces", yaNo.estado === 404);

  console.log("\n── 10. Rechazar exige motivo ──");
  await POST("/medico/recargas", tk.destino, { bolivianos: 100, referencia: "QR mio 999" });
  const cola2 = await GET("/medico/operador/solicitudes", tk.operador);
  const solId2 = cola2.cuerpo.solicitudes[0]._id;
  const sinMotivo = await POST(`/medico/operador/solicitudes/${solId2}/rechazar`, tk.operador, {});
  verificar("sin motivo no se rechaza", sinMotivo.estado === 400);
  const rechazo = await POST(`/medico/operador/solicitudes/${solId2}/rechazar`, tk.operador, { motivo: "No encontramos ese pago en el banco" });
  verificar("con motivo sí", rechazo.estado === 200);
  const mias = await GET("/medico/recargas", tk.destino);
  const rechazada = mias.cuerpo.solicitudes.find(x => x.estado === "rechazada");
  verificar("el médico ve el rechazo con su motivo", /no encontramos/i.test(rechazada?.motivoRechazo || ""));
  verificar("  ...y no ve quién lo rechazó", !("revisadaPor" in rechazada));

  console.log("\n── 11. Cancelar el propio aviso ──");
  await POST("/medico/recargas", tk.destino, { bolivianos: 150, referencia: "QR mio 1000" });
  const mias2 = await GET("/medico/recargas", tk.destino);
  const pendienteId = mias2.cuerpo.solicitudes.find(x => x.estado === "pendiente")._id;
  const ajena = await DELETE(`/medico/recargas/${pendienteId}`, tk.comun);
  verificar("nadie puede cancelar el aviso de otro", ajena.estado === 404);
  const propia = await DELETE(`/medico/recargas/${pendienteId}`, tk.destino);
  verificar("el dueño sí puede cancelarlo", propia.estado === 200);
  verificar("  ...y puede volver a avisar",
    (await POST("/medico/recargas", tk.destino, { bolivianos: 150, referencia: "QR mio 1001" })).estado === 201);

  console.log("\n── 12. El panel de pagos ──");
  const resumen = await GET("/medico/operador/resumen", tk.operador);
  verificar("el operador ve el resumen", resumen.estado === 200);
  // Es una LISTA por moneda, no un total: ver la sección 16 sobre por qué
  // sumar bolivianos con reales da una cifra falsa que nadie mira con
  // sospecha.
  verificar("  ...con lo que entró este mes, por moneda",
    Array.isArray(resumen.cuerpo?.cargasMes) && typeof resumen.cuerpo.cargasMes[0]?.monto === "string");
  verificar("  ...y cuántas recargas fueron", resumen.cuerpo?.cargasMes?.[0]?.n > 0);
  // El consumo se guarda en negativo (es una resta); mostrarlo así se lee
  // como un error, por eso se da vuelta.
  verificar("el consumo se muestra en positivo",
    (resumen.cuerpo?.consumoMes || []).every(c => !String(c.monto).startsWith("-")));
  verificar("las últimas cargas traen el nombre del médico, no solo el teléfono",
    resumen.cuerpo?.ultimasCargas?.every(c => c.nombre && c.nombre !== c.medicoPhone));
  verificar("  ...y quién las acreditó", resumen.cuerpo?.ultimasCargas?.[0]?.acreditadoPor === "70000001");
  verificar("un médico común no ve el panel de pagos",
    (await GET("/medico/operador/resumen", tk.comun)).estado === 404);

  // Y la deuda: alguien que atendió con el saldo agotado.
  await Medico.updateOne({ phone: "70000003" }, { $set: { saldoCentavos: -3600 } });
  const conDeuda = await GET("/medico/operador/resumen", tk.operador);
  verificar("aparece quién está en negativo", conDeuda.cuerpo?.enNegativo?.some(m => m.phone === "70000003"));
  verificar("  ...y la deuda se muestra en positivo y por moneda",
    conDeuda.cuerpo?.deudaTotal?.some(d => d.moneda === "BOB" && d.monto === "36.00"));

  console.log("\n── 13. Dónde nos pagan, editable sin SSH ──");
  const PUT = (ruta, token, cuerpo) => pedir(puerto, "PUT", ruta, token, cuerpo);
  verificar("un médico común no puede ver los datos de pago",
    (await GET("/medico/operador/datos-pago", tk.comun)).estado === 404);
  // Y sobre todo: no puede CAMBIARLOS. Cambiar el número de cuenta es
  // desviarse todos los pagos futuros sin tocar un solo saldo.
  const intento = await PUT("/medico/operador/datos-pago", tk.comun, { banco: "Mi banco", cuenta: "123" });
  verificar("ni cambiarlos — desviaría todos los pagos futuros", intento.estado === 404);

  const guardado = await PUT("/medico/operador/datos-pago", tk.operador, {
    banco: "Banco BCP", cuenta: "201-5012345-3-45", titular: "Luis Quiroga",
    documento: "1234567 SC", whatsapp: "+591 6274-1818",
  });
  verificar("el operador sí puede guardarlos", guardado.estado === 200);
  verificar("  ...y el WhatsApp queda solo con dígitos", guardado.cuerpo?.whatsapp === "59162741818");

  // Lo que importa de verdad: que el MÉDICO vea lo que se guardó.
  const loQueVeElMedico = await GET("/medico/recargas/datos-pago", tk.destino);
  verificar("el médico ve la cuenta nueva al ir a recargar",
    loQueVeElMedico.cuerpo?.cuenta === "201-5012345-3-45");
  verificar("  ...y el titular", loQueVeElMedico.cuerpo?.titular === "Luis Quiroga");

  const enBase = await ConfigPago.findOne({ clave: "unico" }).lean();
  verificar("queda registrado quién los cambió", enBase.actualizadoPor === "70000001");

  // Cambiarlos otra vez no crea un segundo documento POR PAÍS: es la cuenta
  // de la empresa en Bolivia, no una configuración por persona. (Brasil sí
  // tiene la suya, y de eso se ocupa la sección 15.)
  await PUT("/medico/operador/datos-pago", tk.operador, { banco: "Otro banco", cuenta: "999" });
  verificar("editar de nuevo no duplica la configuración",
    await ConfigPago.countDocuments({ clave: "unico" }) === 1);

  console.log("\n── 16. Bolivianos y reales no se suman ──");
  // El bug que esto ataja no da error: da un número. El panel sumaba TODOS
  // los movimientos y lo mostraba como "Bs", así que con un solo médico
  // brasileño la cifra del mes ya era falsa — y una cifra falsa en un panel
  // de plata no se nota nunca, porque nadie mira un total y sospecha.
  await Medico.updateOne({ phone: "79999998" }, { $set: { moneda: "BRL", dosFA: con2fa } });
  await Medico.updateOne({ phone: "79999999" }, { $set: { moneda: "BOB" } });

  const cargaBr = await acreditar(tk.operador, { phone: "79999998", bolivianos: 300, referencia: "PIX BR 1" });
  verificar("se puede acreditar a un médico que cobra en reales", cargaBr.estado === 200);

  const movBr = await MovimientoSaldo.findOne({ referenciaClave: "PIX BR 1" }).lean();
  verificar("  ...y el movimiento queda anotado en BRL", movBr?.moneda === "BRL");
  const movBo = await MovimientoSaldo.findOne({ referenciaClave: "QR BCP 1111" }).lean();
  verificar("  ...mientras el boliviano sigue en BOB", movBo?.moneda === "BOB");

  const resumen2 = await GET("/medico/operador/resumen", tk.operador);
  const porMoneda = Object.fromEntries((resumen2.cuerpo?.cargasMes || []).map(c => [c.moneda, c]));
  verificar("el resumen separa las dos monedas", Boolean(porMoneda.BOB && porMoneda.BRL));
  verificar("  ...y NO existe un total que las mezcle",
    resumen2.cuerpo?.cargasMes?.length === 2 && !("bs" in (resumen2.cuerpo.cargasMes[0] || {})));
  verificar("  ...cada una con su símbolo",
    porMoneda.BOB?.simbolo === "Bs" && porMoneda.BRL?.simbolo === "R$");
  verificar("  ...y los reales no se contaron entre los bolivianos",
    Number(porMoneda.BRL.monto) === 300);

  // Que la búsqueda diga la moneda importa: el operador ve las dos en la
  // misma lista, y "200" sin unidad al lado de un nombre es un error esperando.
  const busca2 = await GET("/medico/operador/buscar?q=Brasil", tk.operador);
  verificar("la búsqueda dice en qué moneda cobra cada médico",
    busca2.cuerpo?.medicos?.[0]?.simbolo === "R$");

  console.log("\n── 15. Cada país cobra en su cuenta, y no se mezclan ──");
  // El error que esto previene no es cosmético. Un médico brasileño que ve
  // la cuenta boliviana transfiere reales a un banco que no los recibe: no
  // es un pago que "todavía no se acreditó", es plata que no vuelve.
  //
  // Se prueba ANTES de cargar los datos de Brasil, que es el estado real de
  // hoy: Bolivia configurada y Brasil recién empezando.
  const brSinCargar = await GET("/medico/recargas/datos-pago", tk.brasil);
  verificar("la médica de Brasil NO ve el banco boliviano",
    brSinCargar.cuerpo?.banco !== "Otro banco" && !brSinCargar.cuerpo?.banco);
  verificar("  ...ni su número de cuenta", brSinCargar.cuerpo?.cuenta !== "999");
  verificar("  ...y se le dice que su país es br", brSinCargar.cuerpo?.pais === "br");

  const guardadoBr = await PUT("/medico/operador/datos-pago", tk.operador, {
    pais: "br", banco: "Pix", cuenta: "ff439919-4119-405d-838a-6c3e3efd8b55",
    titular: "BRLA DIGITAL LTDA", documento: "12345678000199",
  });
  verificar("el operador puede cargar la cuenta de Brasil", guardadoBr.estado === 200);
  verificar("  ...y queda guardada aparte, sin pisar la de Bolivia",
    await ConfigPago.countDocuments({}) === 2);

  const brCargada = await GET("/medico/recargas/datos-pago", tk.brasil);
  verificar("ahora la médica de Brasil ve SU cuenta",
    brCargada.cuerpo?.cuenta === "ff439919-4119-405d-838a-6c3e3efd8b55");

  // Y lo simétrico, que es la mitad que se olvida: cargar Brasil no puede
  // haberle cambiado la cuenta a los médicos de Bolivia.
  const boSigueIgual = await GET("/medico/recargas/datos-pago", tk.destino);
  verificar("y la de Bolivia quedó intacta",
    boSigueIgual.cuerpo?.cuenta === "999" && boSigueIgual.cuerpo?.pais === "bo");

  // El país sale de la cuenta del médico, no de lo que mande el navegador:
  // si viajara en el pedido, elegir país sería elegir a qué cuenta pagarle.
  const intentaElegir = await GET("/medico/recargas/datos-pago?pais=br", tk.destino);
  verificar("un médico no puede pedir la cuenta del otro país",
    intentaElegir.cuerpo?.pais === "bo" && intentaElegir.cuerpo?.cuenta === "999");

  console.log("\n── 14. El que maneja la plata no tiene por qué ser médico ──");
  // Hasta acá, el operador SIEMPRE era además una cuenta de médico: consumía
  // Bs 12 por consulta y podía aprobar sus propias recargas. Mientras el
  // único operador sea el dueño, da igual. El día que entra otra persona a
  // manejar cobranzas, no: quien administra la plata no debería ser el mismo
  // que la gasta, y esa separación ni siquiera se podía configurar.
  //
  // Lo que se prueba acá es que ahora se puede, y que abrir esa puerta no
  // abrió ninguna otra.
  const estPagos = await GET("/medico/operador/estado", tk.pagos);
  verificar("una cuenta administrativa puede ser operadora",
    estPagos.estado === 200 && estPagos.cuerpo?.operador === true && estPagos.cuerpo?.dosFAActivo === true);

  const saldoPrevio = (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos;
  const acreditaPagos = await acreditar(tk.pagos, { phone: "79999999", bolivianos: 150, referencia: "QR MARIA 4242" });
  verificar("y acredita como cualquier operador", acreditaPagos.estado === 200);
  verificar("  ...quedando registrada como la responsable",
    (await MovimientoSaldo.findOne({ referenciaClave: "QR MARIA 4242" }).lean())?.acreditadoPor === "70000005");
  verificar("  ...y el saldo del médico subió Bs 150",
    (await Medico.findOne({ phone: "79999999" }).lean()).saldoCentavos === saldoPrevio + 15000);

  // Lo importante del otro lado: aceptar el rol "admin" NO le dio el permiso
  // a todos los admin. El portero sigue siendo la lista del .env.
  const adminFuera = await acreditar(tk.adminClinica, { phone: "79999999", bolivianos: 999, referencia: "no debería" });
  verificar("un admin que NO está en OPERADORES_SALDO sigue afuera (404)", adminFuera.estado === 404);
  verificar("  ...y no dejó rastro de plata",
    await MovimientoSaldo.countDocuments({ referenciaClave: "NO DEBERÍA" }) === 0);

  // Y que la separación sea de verdad: esta cuenta no puede actuar como
  // médico ni para lo más inofensivo del circuito, que es avisar un pago
  // propio. No atiende, así que no consume: no hay nada que cobrarle.
  const pagosComoMedico = await POST("/medico/recargas", tk.pagos, { bolivianos: 100, referencia: "para mí" });
  verificar("y no puede usar las rutas de médico ni para avisar un pago propio",
    pagosComoMedico.estado === 403);

  // El candado 2 es obligatorio: si la cuenta no pudiera activar su segundo
  // factor, este tipo de cuenta no serviría para nada.
  const dosFAPagos = await GET("/medico/2fa/estado", tk.pagos);
  verificar("puede consultar su propio segundo factor", dosFAPagos.estado === 200);
  const iniciaPagos = await POST("/medico/2fa/iniciar", tk.pagos, {});
  verificar("  ...y activarlo, que sin eso la cuenta sería un candado sin llave",
    iniciaPagos.estado === 200 && typeof iniciaPagos.cuerpo?.qr === "string");
  // Pero sigue sin poder mirar nada clínico: 2FA no es un permiso, es una
  // puerta con llave sobre los permisos que ya tenía.
  const auditPagos = await GET("/medico/auditoria", tk.pagos);
  verificar("  ...y su log de accesos es solo el suyo",
    auditPagos.estado === 200 && (auditPagos.cuerpo?.eventos || []).every(e => e.medicoPhone === "70000005"));

  await new Promise((r) => servidor.close(r));
  await new Promise((r) => setTimeout(r, 400));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongo.detener();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 la prueba se cayó:", e.stack || e.message);
  process.exit(1);
});
