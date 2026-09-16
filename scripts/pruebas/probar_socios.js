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
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
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

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
