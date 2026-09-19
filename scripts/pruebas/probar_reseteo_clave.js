// Symphomed — Olvidé mi contraseña, de punta a punta.
//
// ═══ QUÉ SE VIGILA ACÁ, Y POR QUÉ ═══════════════════════════════════════════
//
// Esta ruta entrega acceso a una cuenta. Lo que puede salir mal acá no es
// "se ve feo": es que alguien entre a la cuenta de otro, o que se filtre qué
// teléfonos son médicos o socios de Symphomed. Ninguna de las dos cosas da un
// error — dan un 200 que parece perfecto.
//
// Se levanta el servidor de verdad y se hace el recorrido completo, igual que
// probar_resumen_flujo.js: los errores que importan acá viven en el orden de
// los `if`, no en la lectura del código.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.APP_URL = "https://app.symphomed.test";
// Antes de requerir routes/reseteoClave.js: services/operadores.js lee
// OPERADORES_SALDO al cargar el módulo, una sola vez, y la ruta captura esa
// lista en el cierre de requireAprobador. Fijarla después de haber hecho el
// require no sirve de nada — el middleware ya quedó armado con la lista
// vacía de antes.
// "70000004" también es operador —está en la lista— pero se crea SIN 2FA
// activo. Si solo hubiera un teléfono en la lista, "sin 2FA" y "no es
// operador" serían indistinguibles: los dos caen en el mismo 404 antes de
// llegar a la comprobación que de verdad se quiere probar.
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
  process.env.MONGODB_URI = mongod.getUri("reseteo");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "reseteoClave"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Socio, SolicitudReseteo, AuditLog } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword, verificarPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await SolicitudReseteo.init();  // el índice parcial es lo que se prueba

  const clave = await hashPassword("ClaveVieja1234!");

  const con2fa = { activo: true, secreto: "SECRETO", secretoPendiente: "" };
  const aprobador = await Medico.create({ phone: "70000001", nombre: "Operadora", passwordHash: clave, dosFA: con2fa, activo: true });
  const comun = await Medico.create({ phone: "70000002", nombre: "Dr. Común", passwordHash: clave, dosFA: con2fa, activo: true });
  // "comun" (70000002) no está en la lista: cubre "no es operador".
  // Este de acá SÍ está en la lista pero sin 2FA activo — la rama que de
  // verdad hay que probar, distinta de "no es operador".
  const sinDosFa = await Medico.create({ phone: "70000004", nombre: "Operador sin 2FA", passwordHash: clave, activo: true });

  // El médico cuya contraseña se va a perder.
  const medico = await Medico.create({ phone: "71000001", nombre: "Dra. Alejandra Quiroga",
    passwordHash: clave, activo: true, estadoCuenta: "aprobada", idioma: "es" });
  // Una cuenta pendiente de aprobación: pedir el reseteo no le sirve de nada.
  const pendiente = await Medico.create({ phone: "71000002", nombre: "Dr. Pendiente",
    passwordHash: clave, activo: true, estadoCuenta: "pendiente" });
  // Una desactivada, por la misma razón.
  const inactivo = await Medico.create({ phone: "71000003", nombre: "Dr. Inactivo",
    passwordHash: clave, activo: false, estadoCuenta: "aprobada" });

  const socio = await Socio.create({ phone: "72000001", nombre: "Distribuidora Andina",
    passwordHash: clave, activo: true });

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

  // ═══ 1. NADIE PUEDE AVERIGUAR QUÉ TELÉFONO EXISTE ═══════════════════════
  console.log("── 1. Solicitar no filtra si el teléfono existe ──");

  const conCuenta = await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000001" });
  const sinCuenta = await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "70009999999" });
  verificar("las dos responden 200", conCuenta.estado === 200 && sinCuenta.estado === 200);
  verificar("con EXACTAMENTE el mismo mensaje", conCuenta.cuerpo.mensaje === sinCuenta.cuerpo.mensaje);
  // El cuerpo COMPLETO, no solo los nombres de sus claves. Comparar claves
  // dejaba pasar un campo como `existe: true/false` —mismas claves, valores
  // que sí filtran— y eso es precisamente lo que esta ruta existe para
  // impedir. El texto entero, tal cual viajó, es la única comparación que no
  // se puede burlar agregando un campo con el nombre correcto.
  verificar("y las dos respuestas son BYTE POR BYTE la misma, sin ningún campo de más",
    conCuenta.texto === sinCuenta.texto);

  verificar("  ...pero SÍ creó el pedido, del lado del servidor",
    await SolicitudReseteo.exists({ tipo: "medico", telefono: "71000001", estado: "pendiente" }));
  verificar("  ...y el teléfono inexistente no creó nada",
    !(await SolicitudReseteo.exists({ telefono: "70009999999" })));

  // ═══ 2. UNA CUENTA QUE NO PUEDE ENTRAR IGUAL, NO GENERA PEDIDO ═══════════
  console.log("\n── 2. Cuentas que no pueden entrar igual no generan trabajo ──");
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000002" });
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000003" });
  verificar("una cuenta pendiente de aprobación no genera pedido",
    !(await SolicitudReseteo.exists({ telefono: "71000002" })));
  verificar("una cuenta desactivada tampoco",
    !(await SolicitudReseteo.exists({ telefono: "71000003" })));

  // ═══ 3. NO SE APILAN PEDIDOS ═════════════════════════════════════════════
  console.log("\n── 3. Pedir dos veces no llena la cola de dos filas iguales ──");
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000001" });
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000001" });
  verificar("sigue habiendo UN solo pedido pendiente para ese teléfono",
    await SolicitudReseteo.countDocuments({ telefono: "71000001", estado: "pendiente" }) === 1);

  // ═══ 4. UN PEDIDO PENDIENTE TODAVÍA NO ABRE NADA ═════════════════════════
  console.log("\n── 4. Sin aprobar, no hay ningún enlace que abrir ──");
  verificar("un pedido recién creado no tiene token",
    (await SolicitudReseteo.findOne({ telefono: "71000001" })).token === null);

  // ═══ 5. LA COLA ES SOLO PARA OPERADORES ══════════════════════════════════
  console.log("\n── 5. La cola de pedidos, con el mismo candado que pagos ──");
  for (const [quien, token] of [["un médico común", tkComun], ["un operador sin 2FA", tkSinDosFa], ["sin sesión", null]]) {
    const r = await pedir("/medico/operador/reseteos", token);
    verificar(`${quien} no puede ver la cola`, r.estado === 404 || r.estado === 401 || r.estado === 403);
  }
  const cola = await pedir("/medico/operador/reseteos", tkAprobador);
  verificar("el operador SÍ la ve", cola.estado === 200 && cola.cuerpo.pedidos.length >= 1);
  const pedido = cola.cuerpo.pedidos.find(p => p.telefono === "71000001");
  verificar("  ...y trae el nombre, para no tener que adivinar a quién le manda el enlace",
    Boolean(pedido) && pedido.nombre === "Dra. Alejandra Quiroga");

  // ═══ 6. APROBAR ═══════════════════════════════════════════════════════════
  console.log("\n── 6. Aprobar genera el enlace ──");
  for (const [quien, token] of [["un médico común", tkComun], ["un operador sin 2FA", tkSinDosFa]]) {
    const r = await pedir(`/medico/operador/reseteos/${pedido._id}/aprobar`, token, "POST", {});
    verificar(`${quien} no puede aprobar`, r.estado === 404 || r.estado === 403);
  }
  const aprobado = await pedir(`/medico/operador/reseteos/${pedido._id}/aprobar`, tkAprobador, "POST", {});
  verificar("el operador aprueba y recibe el enlace", aprobado.estado === 200 && /\/restablecer\//.test(aprobado.cuerpo.enlace || ""));
  verificar("  ...con el dominio público, no el del servidor de pruebas",
    aprobado.cuerpo.enlace.startsWith("https://app.symphomed.test/restablecer/"));
  // Sin credenciales de Meta configuradas en la prueba, el envío no puede
  // haber pasado — y la ruta tiene que DECIRLO, no reportar éxito de más.
  verificar("  ...y como no hay WhatsApp configurado, lo dice: enviadoA es null",
    aprobado.cuerpo.enviadoA === null && Boolean(aprobado.cuerpo.aviso));
  const token = aprobado.cuerpo.enlace.split("/restablecer/")[1];

  const aprobarDeNuevo = await pedir(`/medico/operador/reseteos/${pedido._id}/aprobar`, tkAprobador, "POST", {});
  verificar("aprobar un pedido que ya no está pendiente se rechaza", aprobarDeNuevo.estado === 404);

  // ═══ 7. LA PÁGINA PÚBLICA ════════════════════════════════════════════════
  console.log("\n── 7. Elegir la contraseña nueva ──");
  const abrir = await pedir(`/restablecer-clave/${token}`, null);
  verificar("el enlace abre y dice a quién pertenece", abrir.estado === 200 && abrir.cuerpo.nombre === "Dra. Alejandra Quiroga");
  verificar("  ...y el mínimo de un médico (8), no el de un socio", abrir.cuerpo.minimo === 8);

  const corta = await pedir(`/restablecer-clave/${token}`, null, "POST", { password: "corta1" });
  verificar("una contraseña corta se rechaza", corta.estado === 400);
  verificar("  ...sin tocar la contraseña vieja",
    (await verificarPassword("ClaveVieja1234!", (await Medico.findById(medico._id)).passwordHash)).ok);

  const cambiada = await pedir(`/restablecer-clave/${token}`, null, "POST", { password: "ClaveNueva1234!" });
  verificar("una contraseña válida se acepta", cambiada.estado === 200);
  const medicoActualizado = await Medico.findById(medico._id);
  verificar("  ...y la contraseña nueva funciona de verdad",
    (await verificarPassword("ClaveNueva1234!", medicoActualizado.passwordHash)).ok);
  verificar("  ...y la vieja ya no",
    !(await verificarPassword("ClaveVieja1234!", medicoActualizado.passwordHash)).ok);

  const solicitudUsada = await SolicitudReseteo.findOne({ token });
  verificar("el pedido queda marcado como usado", solicitudUsada.estado === "usada" && Boolean(solicitudUsada.usadaEn));

  const reusar = await pedir(`/restablecer-clave/${token}`, null);
  verificar("el mismo enlace no se puede volver a abrir", reusar.estado === 404);
  const reusarPost = await pedir(`/restablecer-clave/${token}`, null, "POST", { password: "OtraClave1234!" });
  verificar("  ...ni volver a usar para cambiar la contraseña otra vez", reusarPost.estado === 404);

  // ═══ 8. UN ENLACE VENCIDO SE COMPORTA IGUAL QUE UNO CORTADO ══════════════
  console.log("\n── 8. Un enlace vencido no abre ──");
  await SolicitudReseteo.create({
    tipo: "medico", telefono: medico.phone, nombre: medico.nombre, estado: "aprobada",
    token: "v".repeat(30), tokenExpira: new Date(Date.now() - 3600000),
  });
  const vencido = await pedir(`/restablecer-clave/${"v".repeat(30)}`, null);
  verificar("un enlace vencido contesta 410, no 404", vencido.estado === 410);

  // ═══ 8b. UN APROBADO QUE NADIE USÓ, Y QUE VENCIÓ, NO BLOQUEA PARA SIEMPRE ═
  //
  // Es el bug real que apareció escribiendo esta prueba, no leyendo el
  // código: sin este paso, la solicitud "aprobada" de arriba —cuyo token ya
  // venció pero cuyo ESTADO sigue diciendo "aprobada"— chocaría contra el
  // índice único y ningún pedido nuevo podría crearse para este teléfono.
  // Nunca. La persona que dejó pasar las dos horas se quedaría sin forma de
  // volver a intentarlo.
  console.log("\n── 8b. Un enlace aprobado y vencido no bloquea el próximo pedido ──");
  verificar("la solicitud de arriba sigue diciendo «aprobada» en la base (no se limpia sola)",
    (await SolicitudReseteo.findOne({ token: "v".repeat(30) })).estado === "aprobada");
  const solicitarDeNuevo = await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: medico.phone });
  verificar("pedirlo de nuevo sigue devolviendo 200, como siempre", solicitarDeNuevo.estado === 200);
  verificar("  ...y la vieja, vencida, queda marcada como tal",
    (await SolicitudReseteo.findOne({ token: "v".repeat(30) })).estado === "vencida");
  verificar("  ...mientras se crea un pedido PENDIENTE nuevo, de verdad",
    await SolicitudReseteo.exists({ telefono: medico.phone, tipo: "medico", estado: "pendiente" }));

  // ═══ 9. RECHAZAR ══════════════════════════════════════════════════════════
  console.log("\n── 9. Rechazar, y volver a pedirlo después ──");
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000001" });
  const pedidoNuevo = (await pedir("/medico/operador/reseteos", tkAprobador)).cuerpo.pedidos.find(p => p.telefono === "71000001");
  const rechazado = await pedir(`/medico/operador/reseteos/${pedidoNuevo._id}/rechazar`, tkAprobador, "POST", {});
  verificar("se puede rechazar", rechazado.estado === 200);
  verificar("  ...y NO se manda ningún WhatsApp al rechazar (no hay nada que decir)",
    (await SolicitudReseteo.findById(pedidoNuevo._id)).token === null);

  // Con el anterior resuelto (rechazado), un pedido nuevo tiene que poder
  // crearse: el índice parcial solo bloquea pendiente/aprobada, no rechazada.
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "71000001" });
  verificar("después de un rechazo, se puede volver a pedir",
    await SolicitudReseteo.exists({ telefono: "71000001", estado: "pendiente" }));

  // ═══ 10. TAMBIÉN FUNCIONA PARA UN SOCIO ══════════════════════════════════
  console.log("\n── 10. Lo mismo, para un socio ──");
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: "72000001" });
  verificar("un socio también genera pedido", await SolicitudReseteo.exists({ tipo: "socio", telefono: "72000001" }));
  const pedidoSocio = (await pedir("/medico/operador/reseteos", tkAprobador)).cuerpo.pedidos.find(p => p.telefono === "72000001");
  const aprobadoSocio = await pedir(`/medico/operador/reseteos/${pedidoSocio._id}/aprobar`, tkAprobador, "POST", {});
  const tokenSocio = aprobadoSocio.cuerpo.enlace.split("/restablecer/")[1];
  const abrirSocio = await pedir(`/restablecer-clave/${tokenSocio}`, null);
  verificar("  ...con el mínimo de un socio (10), no el de un médico", abrirSocio.cuerpo.minimo === 10);
  verificar("  ...y dice que es un socio", abrirSocio.cuerpo.tipo === "socio");

  const cortaSocio = await pedir(`/restablecer-clave/${tokenSocio}`, null, "POST", { password: "corta123" });
  verificar("8 caracteres no alcanzan para un socio, aunque alcancen para un médico", cortaSocio.estado === 400);
  const okSocio = await pedir(`/restablecer-clave/${tokenSocio}`, null, "POST", { password: "ClaveDeSocio99" });
  verificar("10 sí alcanzan", okSocio.estado === 200);
  verificar("  ...y cambió el Socio, no un Medico con el mismo teléfono por error",
    (await verificarPassword("ClaveDeSocio99", (await Socio.findById(socio._id)).passwordHash)).ok);

  // ═══ 11. UN TELÉFONO QUE ES LAS DOS COSAS A LA VEZ ═══════════════════════
  //
  // Nada en el alta de un socio impide hoy que comparta número con un médico
  // (ver el comentario en routes/reseteoClave.js). Si pasa, las dos tienen
  // que quedar pedidas, y el admin decide con cuál seguir.
  console.log("\n── 11. Un teléfono que es médico Y socio a la vez ──");
  const dupTelefono = "73000001";
  await Medico.create({ phone: dupTelefono, nombre: "Dr. Doble", passwordHash: clave, activo: true, estadoCuenta: "aprobada" });
  await Socio.create({ phone: dupTelefono, nombre: "Socio Doble", passwordHash: clave, activo: true });
  await pedir("/reseteo-clave/solicitar", null, "POST", { telefono: dupTelefono });
  verificar("se crea un pedido de médico", await SolicitudReseteo.exists({ tipo: "medico", telefono: dupTelefono }));
  verificar("  ...y uno de socio, sin que se pisen", await SolicitudReseteo.exists({ tipo: "socio", telefono: dupTelefono }));

  // ═══ 12. QUEDA EN AUDITORÍA ═══════════════════════════════════════════════
  console.log("\n── 12. Cada paso queda anotado ──");
  for (const accion of ["aprobar_reseteo_clave", "rechazar_reseteo_clave", "usar_reseteo_clave"]) {
    verificar(`se registra «${accion}»`, await AuditLog.exists({ accion }));
  }
  // Quien usa el enlace no tiene sesión — el registro tiene que llevar el
  // teléfono de la cuenta afectada igual, no quedar en blanco.
  const usoAuditado = await AuditLog.findOne({ accion: "usar_reseteo_clave" }).sort({ createdAt: -1 });
  verificar("  ...con el teléfono de la cuenta, aunque quien lo usó no tenía sesión",
    Boolean(usoAuditado?.medicoPhone));

  // ═══ 13. NINGÚN VALOR DE CONTRASEÑA VIAJA POR EL MENSAJE ═══════════════
  //
  // El texto SÍ habla de contraseñas —es de lo que trata el mensaje—; lo que
  // no puede pasar es que el VALOR de una viaje ahí. Los únicos datos que se
  // interpolan en el cuerpo tienen que ser el nombre y el enlace: nunca
  // `password`, `claveNueva` ni `passwordHash`.
  console.log("\n── 13. Ningún valor de contraseña viaja por el mensaje ──");
  const RUTA_CODIGO = require("fs").readFileSync(path.join(RAIZ, "routes", "reseteoClave.js"), "utf8");
  const bloqueTexto = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("const texto = idioma"), RUTA_CODIGO.indexOf("registrar({ req, medicoPhone: quien, accion: \"aprobar_reseteo_clave\""));
  verificar("el cuerpo del mensaje solo interpola primerNombre, enlace y la constante de horas",
    bloqueTexto.length > 0 &&
    !/\$\{(password|claveNueva|passwordHash|cuenta\.\w*[Pp]ass\w*)\}/.test(bloqueTexto));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
