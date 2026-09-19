// Symphomed — Socios e insumos.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Esta capa es la que más daño hace si se afloja, y el daño no se ve.
//
//   1. UN SOCIO NO PUEDE VER UN PACIENTE. Nunca, por ninguna ruta. Un socio
//      es un vendedor; el secreto médico no se reparte por la cadena
//      comercial. Si esto se rompe, no hay error en pantalla: simplemente
//      alguien que vende software ve el nombre de gente enferma.
//
//   2. UN SOCIO NO PUEDE VER LA CARTERA DE OTRO. Es su lista de clientes,
//      o sea su negocio entero. Filtrarla a un competidor es el peor daño
//      comercial que Symphomed le puede hacer a alguien que confió.
//
//   3. LOS CUPOS TIENEN QUE CUADRAR. Si el disponible miente, o se regala
//      producto o se le cobra de más a alguien que pagó.
//
//   4. EL STOCK ES LA SUMA DE LOS MOVIMIENTOS. Un stock que se puede editar
//      a mano es un número que nadie puede explicar.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

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
  process.env.MONGODB_URI = mongod.getUri("socios");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "socio"))(app);
  require(path.join(RAIZ, "routes", "insumos"))(app);
  require(path.join(RAIZ, "routes", "pacientes"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Socio, Clinica, Medico, LoteCupos, Paciente, Insumo } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword, verificarPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const clave = await hashPassword("Prueba1234!");

  // ─── Dos socios que compiten entre sí ──────────────────────────────────
  const socioA = await Socio.create({ nombre: "Distribuidora Andina", phone: "70200001", passwordHash: clave, activo: true, precioMayoristaCentavos: 40000 });
  const socioB = await Socio.create({ nombre: "Salud del Este", phone: "70200002", passwordHash: clave, activo: true, precioMayoristaCentavos: 45000 });
  const socioApagado = await Socio.create({ nombre: "Socio Suspendido", phone: "70200003", passwordHash: clave, activo: false });

  // A compró 10 cupos, B compró 3
  await LoteCupos.create({ socioId: socioA._id, cantidad: 10, precioUnitarioCentavos: 40000, registradoPor: "operador" });
  await LoteCupos.create({ socioId: socioB._id, cantidad: 3, precioUnitarioCentavos: 45000, registradoPor: "operador" });

  // Cartera de A: un centro y un profesional suelto
  const centroA = await Clinica.create({ nombre: "Centro Andino", socioId: socioA._id, activa: true, ciudad: "La Paz" });
  await Medico.create({ phone: "71000001", nombre: "Dra. Cliente de A", passwordHash: clave, activo: true, socioId: socioA._id });
  // Un médico DENTRO del centro: no debe gastar cupo propio
  await Medico.create({ phone: "71000002", nombre: "Dr. Del Centro", passwordHash: clave, activo: true, socioId: socioA._id, clinicaId: centroA._id });
  // Uno dado de baja: devuelve su cupo
  await Medico.create({ phone: "71000003", nombre: "Dr. De Baja", passwordHash: clave, activo: false, socioId: socioA._id });

  // Cartera de B
  const centroB = await Clinica.create({ nombre: "Centro del Este", socioId: socioB._id, activa: true, ciudad: "Santa Cruz" });

  // Un médico directo de Symphomed, sin socio
  const directo = await Medico.create({ phone: "71000009", nombre: "Dr. Directo", passwordHash: clave, activo: true });
  const pacienteDirecto = await Paciente.create({ nombre: "Paciente Privado", medicoPhone: "71000009", codigo: "P-0001" });

  const tkA = generarToken(socioA.phone, "socio", 3600000, { socioId: String(socioA._id) });
  const tkB = generarToken(socioB.phone, "socio", 3600000, { socioId: String(socioB._id) });
  const tkApagado = generarToken(socioApagado.phone, "socio", 3600000, { socioId: String(socioApagado._id) });
  const tkMedico = generarToken("71000009", "medico", 3600000);

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, token, metodo = "GET", cuerpo = null) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}`,
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j, texto: t }); }); });
    req.on("error", () => res({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });

  // ═══ 1. UN SOCIO NO LLEGA A UN PACIENTE ══════════════════════════════════
  console.log("── 1. Un socio no puede ver un paciente, por ninguna puerta ──");
  const rutasClinicas = [
    "/medico/pacientes",
    `/medico/pacientes/${pacienteDirecto._id}`,
    "/medico/insumos",
  ];
  let bloqueadas = 0;
  for (const ruta of rutasClinicas) {
    const r = await pedir(ruta, tkA);
    if (r.estado === 401 || r.estado === 403) bloqueadas++;
    else console.log(`   ⚠ ${ruta} devolvió ${r.estado}`);
  }
  verificar("todas las rutas de médico le cierran la puerta al socio",
    bloqueadas === rutasClinicas.length);
  // No es por una lista de rutas prohibidas: es que su rol no es "medico".
  const fuenteAuth = require("fs").readFileSync(path.join(RAIZ, "services", "auth.js"), "utf8");
  verificar("y no es por una lista de rutas, es porque su rol no es «medico»",
    /payload\.rol !== "socio"/.test(fuenteAuth));
  const fuenteRutas = require("fs").readFileSync(path.join(RAIZ, "routes", "socio.js"), "utf8");
  verificar("las rutas del socio no importan un solo modelo clínico",
    !/Paciente|ConsultaMedica|Receta|Estudio|Medicion\b/.test(
      fuenteRutas.replace(/^\s*\/\/.*$/gm, "")));

  // ═══ 2. UN SOCIO NO VE LA CARTERA DE OTRO ════════════════════════════════
  console.log("\n── 2. Un socio no ve los clientes de otro ──");
  const carteraA = await pedir("/socio/cuentas", tkA);
  const carteraB = await pedir("/socio/cuentas", tkB);
  verificar("A ve su cartera", carteraA.estado === 200);
  const nombresA = (carteraA.cuerpo?.cuentas || []).map(c => c.nombre);
  const nombresB = (carteraB.cuerpo?.cuentas || []).map(c => c.nombre);
  verificar("A NO ve el centro de B", !nombresA.includes("Centro del Este"));
  verificar("B NO ve el centro de A", !nombresB.includes("Centro Andino"));
  verificar("nadie ve al cliente directo de Symphomed",
    !nombresA.includes("Dr. Directo") && !nombresB.includes("Dr. Directo"));
  // Los médicos que están DENTRO de un centro no se listan aparte: ya están
  // contados como parte del centro.
  verificar("el médico de adentro del centro no se lista suelto",
    !nombresA.includes("Dr. Del Centro"));

  const espiar = await pedir(`/socio/clinicas/${centroB._id}`, tkA, "PATCH", { nombre: "Robado" });
  verificar("A no puede tocar una cuenta de B", espiar.estado === 404);
  verificar("y el rechazo es 404: no le confirma que esa cuenta existe", espiar.estado === 404);

  const bajaAjena = await pedir(`/socio/cuentas/clinica/${centroB._id}/baja`, tkA, "POST", { motivo: "x" });
  verificar("ni pedir la baja de una cuenta de B", bajaAjena.estado === 404);

  // ═══ 3. LOS CUPOS CUADRAN ════════════════════════════════════════════════
  console.log("\n── 3. Los cupos cuadran ──");
  const cuposA = await pedir("/socio/cupos", tkA);
  const c = cuposA.cuerpo || {};
  verificar("A compró 10", c.comprados === 10);
  // 1 centro + 1 profesional suelto activo = 2. El del centro no cuenta
  // (su cupo lo gastó el centro) y el dado de baja tampoco.
  verificar("usa 2 cupos: el centro y el profesional suelto", c.usados === 2);
  verificar("el médico de adentro del centro NO gasta cupo propio", c.porProfesionales === 1);
  verificar("el dado de baja devolvió su cupo", c.porProfesionales === 1);
  verificar("le quedan 8 disponibles", c.disponibles === 8);
  verificar("y sabe cuánto invirtió", c.invertidoCentavos === 400000);

  // ─── Se acaban los cupos ─────────────────────────────────────────────────
  const altaOk = await pedir("/socio/clinicas", tkA, "POST", { nombre: "Centro Nuevo", ciudad: "Oruro" });
  verificar("con cupo libre puede dar de alta", altaOk.estado === 201);

  // B tiene 3 cupos y 1 usado. Le damos de alta 2 más y el tercero debe fallar.
  await pedir("/socio/clinicas", tkB, "POST", { nombre: "B dos" });
  await pedir("/socio/clinicas", tkB, "POST", { nombre: "B tres" });
  const sinCupo = await pedir("/socio/clinicas", tkB, "POST", { nombre: "B cuatro" });
  verificar("sin cupos disponibles NO deja dar de alta", sinCupo.estado === 402);
  verificar("y lo dice en castellano, no con un código",
    /cupos/i.test(sinCupo.cuerpo?.error || ""));

  // ═══ 4. EL SOCIO NO SE REGALA CUPOS A SÍ MISMO ═══════════════════════════
  console.log("\n── 4. El socio no se emite crédito a sí mismo ──");
  verificar("no hay ninguna ruta para que el socio se cargue lotes",
    !/app\.post\("\/socio\/cupos/.test(fuenteRutas));
  const verLotes = await pedir("/socio/cupos/lotes", tkA);
  verificar("pero sí puede ver qué compró y cuándo",
    verLotes.estado === 200 && (verLotes.cuerpo?.lotes || []).length === 1);

  // ═══ 5. UN SOCIO SUSPENDIDO NO OPERA ═════════════════════════════════════
  console.log("\n── 5. Un socio suspendido no opera ──");
  const suspendido = await pedir("/socio/resumen", tkApagado);
  verificar("un socio desactivado no entra aunque tenga token válido", suspendido.estado === 403);

  // ═══ 6. LOS INSUMOS ══════════════════════════════════════════════════════
  console.log("\n── 6. El stock es la suma de los movimientos ──");
  const nuevo = await pedir("/medico/insumos", tkMedico, "POST", {
    nombre: "Guantes de nitrilo", categoria: "descartables", unidad: "caja",
    stockInicial: 10, stockMinimo: 3, costoUnitarioCentavos: 3500,
  });
  verificar("se crea un insumo", nuevo.estado === 201);
  const insumoId = nuevo.cuerpo?.insumo?._id;

  // El stock inicial tiene que haber quedado como MOVIMIENTO, no como campo.
  const hist0 = await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico);
  verificar("el stock inicial quedó como movimiento, no como número suelto",
    (hist0.cuerpo?.movimientos || []).length === 1 &&
    hist0.cuerpo.movimientos[0].tipo === "entrada" &&
    hist0.cuerpo.insumo.stock === 10);

  await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico, "POST", { tipo: "salida", cantidad: 4, motivo: "Uso del día" });
  const trasSalida = await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico);
  verificar("una salida baja el stock", trasSalida.cuerpo?.insumo?.stock === 6);
  verificar("y cada movimiento guarda cómo quedó el stock después",
    trasSalida.cuerpo.movimientos[0].stockDespues === 6);

  // El stock NO se edita a mano.
  const aMano = await pedir(`/medico/insumos/${insumoId}`, tkMedico, "PATCH", { stock: 99 });
  verificar("el stock NO se puede editar a mano", aMano.estado === 400);
  verificar("y el error dice qué hacer en su lugar",
    /ajuste/i.test(aMano.cuerpo?.error || ""));

  // El ajuste PONE el valor, no lo suma.
  await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico, "POST", { tipo: "ajuste", cantidad: 5, motivo: "Conteo físico" });
  const trasAjuste = await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico);
  verificar("el ajuste PONE el stock en el valor contado, no lo suma",
    trasAjuste.cuerpo?.insumo?.stock === 5);

  // Stock negativo se permite: la salida que se cargó tarde igual se registra.
  await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico, "POST", { tipo: "salida", cantidad: 8, motivo: "Se cargó tarde" });
  const negativo = await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico);
  verificar("un stock negativo se permite y se ve, en vez de perder la salida",
    negativo.cuerpo?.insumo?.stock === -3);

  // Lo que falta reponer
  await pedir(`/medico/insumos/${insumoId}/movimientos`, tkMedico, "POST", { tipo: "ajuste", cantidad: 2, motivo: "Repuesto parcial" });
  const deposito = await pedir("/medico/insumos", tkMedico);
  verificar("avisa lo que está por debajo del mínimo",
    (deposito.cuerpo?.falta?.bajos || []).some(i => i.nombre === "Guantes de nitrilo"));

  // Y lo de otro consultorio no se toca.
  const insumoAjeno = await Insumo.create({ medicoPhone: "70000999", nombre: "Insumo de otro", stock: 5 });
  const espiarInsumo = await pedir(`/medico/insumos/${insumoAjeno._id}/movimientos`, tkMedico);
  verificar("no se ve el insumo de otro consultorio", espiarInsumo.estado === 404);


  // ═══ 7. EL LADO DE SYMPHOMED: DAR DE ALTA Y CARGAR CUPOS ═════════════════
  //
  // Crear un socio y cargarle cupos es EMITIR CRÉDITO. Tiene que pasar por el
  // mismo guardia que aprobar una recarga: lista de operadores en el .env MÁS
  // verificación en dos pasos. Un socio nuevo con 50 cupos cargados por
  // alguien que no debía es plata regalada.
  console.log("\n── 7. Solo un operador da de alta socios y carga cupos ──");
  const rutasOperador = [
    ["GET", "/medico/operador/socios", null],
    ["POST", "/medico/operador/socios", { nombre: "Colado", phone: "70999999", password: "unaquesirva12" }],
    ["POST", `/medico/operador/socios/${socioA._id}/cupos`, { cantidad: 50, referencia: "x" }],
  ];
  let cerradas = 0;
  for (const [metodo, ruta, cuerpo] of rutasOperador) {
    // Probadas con el token de un SOCIO: el que más ganaría cargándose cupos.
    const r = await pedir(ruta, tkA, metodo, cuerpo);
    if (r.estado === 401 || r.estado === 403 || r.estado === 404) cerradas++;
    else console.log(`   ⚠ ${metodo} ${ruta} devolvió ${r.estado}`);
  }
  verificar("un socio no puede entrar a las rutas de operador", cerradas === rutasOperador.length);

  const fuenteOperador = require("fs").readFileSync(path.join(RAIZ, "routes", "operadorSaldo.js"), "utf8");
  verificar("las tres rutas de socios exigen requireOperador",
    (fuenteOperador.match(/operador\/socios[^"]*", limitOperador, requireSesion, requireOperador/g) || []).length >= 3);
  // requireOperador exige 2FA activo: es lo que separa "estar en la lista" de
  // "poder mover plata desde una sesión robada".
  verificar("y requireOperador exige verificación en dos pasos",
    /dosFA\?\.activo/.test(fuenteOperador));

  // Un lote sin referencia es un número que después nadie puede explicar.
  verificar("no se puede cargar un lote sin referencia de pago",
    /Poné la referencia del pago/.test(fuenteOperador));
  // El precio se congela en el lote: si mañana cambia el mayorista, lo
  // comprado el año pasado tiene que seguir valiendo lo que valió.
  verificar("el precio del lote se congela y no se lee del socio al calcular",
    /precioUnitarioCentavos/.test(fuenteOperador) && /congela/i.test(fuenteOperador));

  // ═══ 8. LA PANTALLA DEL SOCIO ════════════════════════════════════════════
  console.log("\n── 8. El panel del socio no puede pedir un paciente ──");
  const panel = require("fs").readFileSync(path.join(RAIZ, "public", "js", "socioPanel.js"), "utf8");
  const panelSinComentarios = panel.replace(/^\s*\/\/.*$/gm, "");
  verificar("el panel no llama a ninguna ruta clínica",
    !/\/medico\/pacientes|\/medico\/consultas|\/medico\/recetas/.test(panelSinComentarios));
  verificar("solo pega a rutas /socio/",
    [...panelSinComentarios.matchAll(/api\("(\/[^"`]*)/g)].every(m => m[1].startsWith("/socio/")));
  // Es una página aparte: un vendedor no carga el megabyte de código clínico,
  // y la separación física refuerza la de permisos.
  const html = require("fs").readFileSync(path.join(RAIZ, "public", "socio.html"), "utf8");
  verificar("es una página aparte, sin el JavaScript de la app médica",
    /socioPanel\.js/.test(html) && !/js\/pacientes\.js|js\/consultas\.js/.test(html));
  verificar("y el servidor la sirve en /socio",
    /app\.get\("\/socio"/.test(require("fs").readFileSync(path.join(RAIZ, "index.js"), "utf8")));

  // A una cuenta ya dada de baja se le ofrecía igual «Pedir la baja». El socio
  // la toca, el servidor la ignora, y queda sin saber si funcionó o si el
  // panel está roto — y su cupo ya estaba devuelto de todos modos.
  const panelSocio = require("fs").readFileSync(path.join(RAIZ, "public", "js", "socioPanel.js"), "utf8");
  verificar("no se le ofrece dar de baja a un cliente que ya está de baja",
    /\$\{cu\.activa \? `[\s\S]{0,320}?data-baja=/.test(panelSocio));

  // ─── 9. El alta del primer socio, corriendo el script de verdad ────────
  //
  // Todavía no hay pantalla de operador para socios: las rutas existen y nadie
  // las llama. Mientras tanto el alta se hace con un script, y ese script
  // tiene que respetar las MISMAS reglas que la ruta — si afloja la contraseña
  // o deja cargar un lote sin referencia, el camino cómodo pasa a ser el más
  // débil, que es exactamente como se cuelan los agujeros.
  //
  // Se corre como PROCESO APARTE y no se llama a su función: la mitad de lo
  // que hay que probar es el parseo de argv, y ahí vivía un bug de verdad —
  // con `--clave` ausente, un filtro por índice descartaba el teléfono y el
  // socio se creaba con el NOMBRE en el campo del teléfono. Ninguna lectura
  // del código lo iba a encontrar; hacía falta correrlo.
  //
  // Y por lo mismo se corre con un TOPE DE TIEMPO propio, más corto que el de
  // la prueba entera. Este script requiere services/auditoria, que requiere
  // services/ratelimit, que arranca un setInterval de limpieza — y si a ese
  // temporizador se le vuelve a caer el .unref(), el script no termina nunca
  // solo. Sin este tope, la señal de esa regresión sería la prueba entera
  // trabada, y nadie sabría por qué.
  console.log("\n── 9. El alta del primer socio, corriendo el script de verdad ──");
  const fsSocio = require("fs");
  const { spawn } = require("child_process");
  const rutaAlta = path.join(RAIZ, "scripts", "crear_socio.js");
  verificar("hay una forma de dar de alta al primer socio sin pantalla", fsSocio.existsSync(rutaAlta));

  function correrAlta(args, tope = 8000) {
    return new Promise((resolve) => {
      const hijo = spawn(process.execPath, [rutaAlta, ...args], {
        env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI },
      });
      let salida = "";
      let resuelto = false;
      const reloj = setTimeout(() => {
        if (resuelto) return;
        resuelto = true;
        hijo.kill("SIGKILL");
        // codigo:null es la marca de "no terminó solo", distinta de
        // cualquier código de salida real que el script pueda devolver.
        resolve({ codigo: null, salida, colgado: true });
      }, tope);
      hijo.stdout.on("data", (c) => { salida += c; });
      hijo.stderr.on("data", (c) => { salida += c; });
      hijo.on("close", (codigo) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(reloj);
        resolve({ codigo, salida, colgado: false });
      });
    });
  }

  const alta = fsSocio.readFileSync(rutaAlta, "utf8");
  const rutaOperador = fsSocio.readFileSync(path.join(RAIZ, "routes", "operadorSaldo.js"), "utf8");
  verificar("  ...que exige la misma contraseña mínima que la ruta del operador",
    /length < 10/.test(alta) && /length < 10/.test(rutaOperador));
  verificar("  ...y que no carga un lote sin referencia",
    /const referencia = /.test(alta) && /referencia,/.test(alta));

  // El bug real: sin --clave, el teléfono tiene que quedar en el TELÉFONO.
  const r1 = await correrAlta(["70200099", "Cliente Con Nombre Largo", "6"]);
  verificar("el script termina solo, sin quedar colgado", !r1.colgado);
  verificar("  ...y con código de salida 0", r1.codigo === 0);
  const s1 = await Socio.findOne({ phone: "70200099" }).lean();
  verificar("  ...creó el socio con el TELÉFONO en el campo del teléfono",
    Boolean(s1) && s1.phone === "70200099" && s1.nombre === "Cliente Con Nombre Largo");
  verificar("  ...y no uno con el nombre puesto donde va el teléfono (el bug real)",
    !(await Socio.findOne({ phone: "Cliente Con Nombre Largo" }).lean()));
  verificar("  ...con el lote de cupos que se le pidió",
    (await LoteCupos.countDocuments({ socioId: s1._id })) === 1);

  // Volver a correrlo NO le toca la contraseña ni le duplica el lote.
  const hashAntes = s1.passwordHash;
  const r2 = await correrAlta(["70200099", "Cliente Con Nombre Largo", "6"]);
  verificar("correrlo de nuevo no cuelga y sale con 0", !r2.colgado && r2.codigo === 0);
  const s1b = await Socio.findOne({ phone: "70200099" }).lean();
  verificar("  ...sin tocar la contraseña", s1b.passwordHash === hashAntes);
  verificar("  ...ni duplicar el lote", (await LoteCupos.countDocuments({ socioId: s1._id })) === 1);

  // ─── --clave: la única forma de recuperar el acceso ────────────────────
  const r3 = await correrAlta(["70200099", "--clave", "ClaveDePrueba99"]);
  verificar("--clave cambia la contraseña, sin colgarse", !r3.colgado && r3.codigo === 0);
  const s1c = await Socio.findOne({ phone: "70200099" });
  verificar("  ...y la nueva contraseña funciona de verdad",
    (await verificarPassword("ClaveDePrueba99", s1c.passwordHash)).ok);
  verificar("  ...y la vieja ya no", !(await verificarPassword("Prueba1234!", s1c.passwordHash)).ok);

  const r4 = await correrAlta(["70200099", "--clave", "corta"]);
  verificar("una contraseña corta se rechaza, sin colgarse", !r4.colgado && r4.codigo !== 0);
  verificar("  ...y no tocó la que ya estaba puesta",
    (await Socio.findOne({ phone: "70200099" }).lean()).passwordHash === s1c.passwordHash);

  const r5 = await correrAlta(["70200099", "--clave"]);
  verificar("--clave sin valor se rechaza, sin colgarse", !r5.colgado && r5.codigo !== 0);

  const r6 = await correrAlta(["70200000", "--clave", "ClaveDePrueba99"]);
  verificar("cambiarle la clave a un socio que no existe se rechaza, sin colgarse",
    !r6.colgado && r6.codigo !== 0);
  verificar("  ...y no lo crea de paso", !(await Socio.findOne({ phone: "70200000" }).lean()));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
