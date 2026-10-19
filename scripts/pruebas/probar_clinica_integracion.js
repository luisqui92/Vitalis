// Symphomed — La clínica contra una base de datos de verdad.
//
// Todas las demás pruebas de la clínica son de permisos o de estructura del
// código: valen, pero ninguna había ejecutado nunca una consulta contra
// Mongo. Cosas que solo se rompen acá:
//
//   · una agregación con $group mal armada devuelve [] en vez de fallar, y
//     el panel muestra ceros perfectos;
//   · un índice único que en la teoría impide reservar dos veces el mismo
//     horario, y en la práctica está mal declarado;
//   · un filtro por clinicaId que compara un ObjectId con un string y no
//     matchea nunca (o peor: matchea de más).
//
// Esta prueba levanta la app de verdad —las rutas reales, el auth real, el
// rate limit real— contra una base descartable, arma una clínica de tres
// consultorios y verifica lo que el administrador ve y lo que no.
//
// ═══ CÓMO CORRERLA ═════════════════════════════════════════════════════════
//
//   MONGO_PRUEBAS="mongodb://localhost:27017/vitalis_prueba" node scripts/pruebas/probar_clinica_integracion.js
//
// o, sin ningún Mongo instalado:
//
//   npm i --no-save mongodb-memory-server
//   node scripts/pruebas/probar_clinica_integracion.js
//
// mongodb-memory-server NO está en package.json a propósito: se baja un
// binario de 120 MB, y el servidor de producción no tiene por qué pagarlo en
// cada despliegue. Si no está y no hay MONGO_PRUEBAS, la prueba se saltea
// diciéndolo fuerte — nunca finge haber pasado.
//
// ═══ SOBRE LA BASE QUE USA ═════════════════════════════════════════════════
//
// Borra todo lo que toca. Por eso se niega a correr contra cualquier base
// cuyo nombre no diga que es de prueba, y contra la MONGODB_URI configurada.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
// El panel cuenta «hoy» y «el mes» en la zona de la clínica (la de La Paz,
// la de siempre), no en la del servidor. La prueba arma sus citas con la hora
// local del proceso, así que se fija la misma zona: si no, entre las 00:00 y
// las 04:00 UTC sus citas de «hoy» caerían en el día siguiente de La Paz.
process.env.TZ = "America/La_Paz";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ─── DE DÓNDE SALE LA BASE ────────────────────────────────────────────────
async function conseguirMongo() {
  if (process.env.MONGO_PRUEBAS) {
    const uri = process.env.MONGO_PRUEBAS;
    // La prueba borra colecciones enteras. Que el nombre de la base tenga
    // que decir "prueba" o "test" es barato y evita el accidente que no se
    // puede deshacer.
    const nombre = (uri.split("/").pop() || "").split("?")[0].toLowerCase();
    if (!/prueba|test/.test(nombre)) {
      console.error(`❌ MONGO_PRUEBAS apunta a la base "${nombre}", que no dice ser de prueba.`);
      console.error("   Esta prueba BORRA lo que toca. Usá una base cuyo nombre incluya 'prueba' o 'test'.");
      process.exit(1);
    }
    if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
      console.error("❌ MONGO_PRUEBAS es la MISMA base que MONGODB_URI (la de la aplicación). No.");
      process.exit(1);
    }
    return { uri, detener: async () => {} };
  }

  let MongoMemoryServer;
  for (const candidato of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(candidato)); break; } catch { /* seguimos buscando */ }
  }
  if (!MongoMemoryServer) return null;

  const servidor = await MongoMemoryServer.create();
  return { uri: servidor.getUri() + "vitalis_prueba", detener: () => servidor.stop() };
}

// ─── UN CLIENTE HTTP MÍNIMO ───────────────────────────────────────────────
// Sin supertest ni nada: el proyecto no tiene dependencias de desarrollo y
// no vale la pena estrenar una para esto.
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
        try { json = JSON.parse(texto); } catch { /* algunas respuestas de error no son JSON */ }
        resolve({ estado: res.statusCode, cuerpo: json, texto });
      });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

async function main() {
  const mongo = await conseguirMongo();
  if (!mongo) {
    console.log("⏭️  SALTEADA: no hay base de datos para probar.");
    console.log("   Corré con MONGO_PRUEBAS=mongodb://localhost:27017/vitalis_prueba,");
    console.log("   o instalá el Mongo de mentira: npm i --no-save mongodb-memory-server");
    console.log("");
    console.log("   Esto NO es un ✅: la clínica queda sin probar contra una base real.");
    process.exit(0);
  }

  process.env.MONGODB_URI = mongo.uri;
  const mongoose = require("mongoose");
  await mongoose.connect(mongo.uri);
  console.log(`🗄️  base de prueba: ${mongo.uri.replace(/\/\/.*@/, "//…@")}\n`);

  const {
    Clinica, Medico, Paciente, PersonaClinica, ConsultaMedica, Cita, TratamientoPlan,
  } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));

  // Base limpia: si quedó algo de una corrida anterior, los números no
  // cierran y la prueba miente en las dos direcciones.
  await mongoose.connection.dropDatabase();
  // Borrar la base se lleva también los índices que Mongoose empezó a armar
  // al conectarse, y rearmarlos es asíncrono: sin esperarlos, la prueba del
  // índice único de citas pasaba o fallaba según quién llegaba primero (la
  // mitad de las corridas). Se esperan antes de cargar nada.
  await Cita.syncIndexes();

  // ─── LA CLÍNICA ─────────────────────────────────────────────────────────
  const clinicaA = await Clinica.create({ nombre: "Clínica San Rafael", ciudad: "Santa Cruz" });
  const clinicaB = await Clinica.create({ nombre: "Otra Clínica", ciudad: "La Paz" });

  const hash = await hashPassword("Prueba123.");
  const nuevoMedico = (datos) => Medico.create({ passwordHash: hash, ...datos });

  const ana = await nuevoMedico({ phone: "70000001", nombre: "Dra. Ana", clinicaId: clinicaA._id, rol: "medico", vinculo: "empleado", consultorio: "Consultorio 1" });
  const beto = await nuevoMedico({ phone: "70000002", nombre: "Dr. Beto", clinicaId: clinicaA._id, rol: "medico", vinculo: "alquila", consultorio: "Consultorio 2", tipoEspecialidad: "odontologia" });
  const carla = await nuevoMedico({ phone: "70000003", nombre: "Carla (admin)", clinicaId: clinicaA._id, rol: "admin" });
  const diego = await nuevoMedico({ phone: "70000004", nombre: "Dr. Diego", clinicaId: clinicaA._id, rol: "director", vinculo: "empleado", consultorio: "Consultorio 3" });
  const elena = await nuevoMedico({ phone: "70000005", nombre: "Dra. Elena", clinicaId: clinicaB._id, rol: "admin" });
  const solo = await nuevoMedico({ phone: "70000009", nombre: "Dr. Solo" }); // sin clínica

  const tk = {
    ana: generarToken(ana.phone, "medico", 36e5, { clinicaId: String(clinicaA._id) }),
    beto: generarToken(beto.phone, "medico", 36e5, { clinicaId: String(clinicaA._id) }),
    carla: generarToken(carla.phone, "admin", 36e5, { admin: true, clinicaId: String(clinicaA._id) }),
    diego: generarToken(diego.phone, "medico", 36e5, { admin: true, clinicaId: String(clinicaA._id) }),
    elena: generarToken(elena.phone, "admin", 36e5, { admin: true, clinicaId: String(clinicaB._id) }),
    solo: generarToken(solo.phone, "medico", 36e5),
  };

  // ─── PACIENTES, CONSULTAS, CITAS Y PLATA ────────────────────────────────
  const pacAna = await Paciente.create({ medicoPhone: ana.phone, nombre: "María Fernández", fechaNacimiento: new Date("1985-04-12"), telefono: "591700111" });
  const pacAna2 = await Paciente.create({ medicoPhone: ana.phone, nombre: "Pedro Rojas" });
  const pacBeto = await Paciente.create({ medicoPhone: beto.phone, nombre: "María Fernández", fechaNacimiento: new Date("1985-04-12"), telefono: "591700111" });
  const pacDiego = await Paciente.create({ medicoPhone: diego.phone, nombre: "Luis Torres" });
  const pacElena = await Paciente.create({ medicoPhone: elena.phone, nombre: "Ajeno a la clínica A" });

  const ahora = new Date();
  const esteMes = new Date(ahora.getFullYear(), ahora.getMonth(), 2, 10, 0, 0);
  const consultasPorMedico = { [ana.phone]: 3, [beto.phone]: 2, [diego.phone]: 1 };
  for (const [phone, n] of Object.entries(consultasPorMedico)) {
    const pid = phone === ana.phone ? pacAna._id : phone === beto.phone ? pacBeto._id : pacDiego._id;
    for (let i = 0; i < n; i++) {
      await ConsultaMedica.create({ medicoPhone: phone, pacienteId: pid, createdAt: esteMes });
    }
  }
  // Una consulta vieja: no tiene que contar en "este mes".
  await ConsultaMedica.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, createdAt: new Date(ahora.getFullYear() - 1, 0, 5) });

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const aLas = (h, m = 0) => { const d = new Date(hoy); d.setHours(h, m, 0, 0); return d; };
  await Cita.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, pacienteNombre: "María Fernández", pacienteTelefono: "591700111", fecha: aLas(9), motivo: "dolor en el pecho desde ayer" });
  await Cita.create({ medicoPhone: ana.phone, pacienteId: pacAna2._id, pacienteNombre: "Pedro Rojas", fecha: aLas(11), estado: "completada" });
  await Cita.create({ medicoPhone: beto.phone, pacienteId: pacBeto._id, pacienteNombre: "María Fernández", fecha: aLas(10), motivo: "control de conducto" });
  await Cita.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, pacienteNombre: "Cancelada", fecha: aLas(16), estado: "cancelada" });

  await TratamientoPlan.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, nombre: "Tratamiento A", precio: 1000, pagos: [{ monto: 400 }] });
  await TratamientoPlan.create({ medicoPhone: ana.phone, pacienteId: pacAna2._id, nombre: "Tratamiento B", precio: 500, pagos: [] });
  // Del que alquila: NO tiene que aparecer en la facturación de la clínica.
  await TratamientoPlan.create({ medicoPhone: beto.phone, pacienteId: pacBeto._id, nombre: "Conducto", precio: 9999, pagos: [{ monto: 9999 }] });

  // ─── LA APP, DE VERDAD ──────────────────────────────────────────────────
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "admin"))(app);
  require(path.join(RAIZ, "routes", "personas"))(app);
  require(path.join(RAIZ, "routes", "pacientes"))(app);

  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;

  // El limitador es de 60 pedidos por minuto POR MÉDICO y guarda el conteo
  // en memoria del proceso. Esta prueba hace bastante menos que eso, pero si
  // algún día crece, un 429 se vería como un fallo raro y sin explicación:
  // mejor contarlo y decirlo.
  const pedidosPorToken = {};
  const GET = async (ruta, token) => contar(token, await pedir(puerto, "GET", ruta, token));
  const POST = async (ruta, token, cuerpo) => contar(token, await pedir(puerto, "POST", ruta, token, cuerpo));
  const PATCH = async (ruta, token, cuerpo) => contar(token, await pedir(puerto, "PATCH", ruta, token, cuerpo));
  function contar(token, respuesta) {
    pedidosPorToken[token] = (pedidosPorToken[token] || 0) + 1;
    if (respuesta.estado === 429) {
      console.error(`❌ 429: la prueba se pasó del rate limit (${pedidosPorToken[token]} pedidos con el mismo token).`);
      console.error("   No es un bug del producto: hay que partir la prueba o usar más médicos.");
      process.exit(1);
    }
    return respuesta;
  }

  // ── 1. Los números del panel salen de la base ──────────────────────────
  console.log("── 1. El resumen cuenta lo que hay ──");
  const resumen = await GET("/admin/resumen", tk.carla);
  verificar("el administrativo entra al resumen", resumen.estado === 200);
  const porPhone = Object.fromEntries((resumen.cuerpo?.medicos || []).map(m => [m.phone, m]));
  // El administrativo (rol "admin") NO es médico (db/models.js): no atiende, no
  // tiene consultorio ni pacientes. Antes la lista lo incluía y el panel
  // contaba un consultorio de más. El director (Diego) sí atiende, y entra.
  verificar("están los 3 médicos de la clínica A (Ana, Beto y el director Diego)",
    (resumen.cuerpo?.medicos || []).length === 3 && Boolean(porPhone[ana.phone] && porPhone[beto.phone] && porPhone[diego.phone]));
  verificar("la administrativa (Carla) no figura como médica de su propia clínica", !porPhone[carla.phone]);
  verificar("no está la médica de la otra clínica", !porPhone[elena.phone]);
  verificar("las consultas del mes de Ana son 3 (la del año pasado no cuenta)", porPhone[ana.phone]?.consultasMes === 3);
  verificar("las de Beto son 2", porPhone[beto.phone]?.consultasMes === 2);
  verificar("Ana tiene 2 pacientes", porPhone[ana.phone]?.pacientes === 2);
  verificar("las citas de hoy de Ana son 1 (la cancelada no cuenta)", porPhone[ana.phone]?.citasHoy === 1);
  verificar("el total de consultas del mes es 6", resumen.cuerpo?.totales?.consultasMes === 6);

  // ── 2. Aislamiento entre clínicas ──────────────────────────────────────
  console.log("\n── 2. Una clínica no ve a la otra ──");
  const resumenB = await GET("/admin/resumen", tk.elena);
  const phonesB = (resumenB.cuerpo?.medicos || []).map(m => m.phone);
  const phonesDeLaA = [ana, beto, carla, diego].map(m => m.phone);
  verificar("la clínica B no ve a nadie de la A (y su administradora no cuenta como médica)",
    !phonesB.some(p => phonesDeLaA.includes(p)) && phonesB.length === 0);
  verificar("y sus totales no arrastran nada de la A", resumenB.cuerpo?.totales?.consultasMes === 0);

  // ── 3. La plata del que alquila no es de la clínica ────────────────────
  console.log("\n── 3. Facturación: el inquilino no aparece ──");
  const fin = await GET("/admin/finanzas", tk.carla);
  const finPhones = (fin.cuerpo?.porMedico || []).map(m => m.phone);
  verificar("Beto (alquila) NO está en la facturación", !finPhones.includes(beto.phone));
  verificar("Ana (empleada) sí está", finPhones.includes(ana.phone));
  verificar("se avisa que 1 inquilino quedó afuera", fin.cuerpo?.inquilinosExcluidos === 1);
  verificar("lo facturado son 1500, no 11499", fin.cuerpo?.totales?.facturado === 1500);
  verificar("lo cobrado son 400", fin.cuerpo?.totales?.cobrado === 400);
  verificar("el saldo son 1100", fin.cuerpo?.totales?.pendiente === 1100);

  // ── 4. La agenda del día ───────────────────────────────────────────────
  console.log("\n── 4. La agenda unificada, contra datos reales ──");
  const ag = await GET("/admin/agenda", tk.carla);
  const salas = Object.fromEntries((ag.cuerpo?.salas || []).map(s => [s.phone, s]));
  verificar("hay 3 citas hoy (la cancelada no)", ag.cuerpo?.total === 3);
  verificar("de la sala de Ana salen los nombres", salas[ana.phone]?.citas.map(c => c.paciente).includes("María Fernández"));
  verificar("de la sala de Beto (alquila) NO sale ninguno", (salas[beto.phone]?.citas || []).every(c => c.paciente === null));
  verificar("pero su hora sí figura ocupada", (salas[beto.phone]?.citas || []).length === 1);
  verificar("se avisa que 1 sala va sin nombres", ag.cuerpo?.salasSinNombre === 1);
  verificar("la cita ya atendida viene marcada", salas[ana.phone]?.citas.some(c => c.estado === "completada"));

  // Lo más importante de todo: que el motivo no esté en NINGÚN lado de la
  // respuesta. Se busca en el JSON crudo, no campo por campo — así también
  // se ve si viajó escondido dentro de algo.
  verificar("el motivo de consulta no aparece en la respuesta", !ag.texto.includes("dolor en el pecho"));
  verificar("tampoco el del inquilino", !ag.texto.includes("control de conducto"));
  verificar("ni el teléfono del paciente", !ag.texto.includes("591700111"));

  const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
  const fechaManana = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, "0")}-${String(manana.getDate()).padStart(2, "0")}`;
  const agManana = await GET(`/admin/agenda?fecha=${fechaManana}`, tk.carla);
  verificar("mañana no hay citas y no rompe", agManana.estado === 200 && agManana.cuerpo?.total === 0);
  const agBasura = await GET("/admin/agenda?fecha=;drop", tk.carla);
  verificar("una fecha inventada cae en hoy, no en un rango raro", agBasura.cuerpo?.fecha === ag.cuerpo?.fecha);

  // ── 5. Las dos puertas, sobre la app real ──────────────────────────────
  console.log("\n── 5. Cada uno entra donde le toca ──");
  verificar("el administrativo NO abre las fichas", (await GET("/medico/pacientes", tk.carla)).estado === 403);
  verificar("el médico NO abre el panel", (await GET("/admin/resumen", tk.ana)).estado === 403);
  verificar("el director abre las dos", (await GET("/admin/resumen", tk.diego)).estado === 200
    && (await GET("/medico/pacientes", tk.diego)).estado === 200);
  verificar("sin token, nada", (await GET("/admin/resumen", null)).estado === 401);

  // ── 6. La persona compartida ───────────────────────────────────────────
  console.log("\n── 6. Una persona, dos consultorios ──");
  const alta = await POST(`/medico/pacientes/${pacAna._id}/persona`, tk.ana, { documento: "1234567" });
  verificar("Ana estrena la persona desde su ficha", alta.estado === 200 && alta.cuerpo?.persona?._id);
  const personaId = alta.cuerpo.persona._id;

  const busca = await GET("/medico/personas/buscar?q=maria", tk.beto);
  verificar("Beto la encuentra buscando por nombre, sin tildes", busca.cuerpo?.personas?.some(p => p._id === personaId));
  verificar("la búsqueda no dice quién la atiende", !JSON.stringify(busca.cuerpo).includes(ana.phone));

  const vincula = await POST(`/medico/pacientes/${pacBeto._id}/persona`, tk.beto, { personaId });
  verificar("Beto vincula su propia ficha a la misma persona", vincula.estado === 200);

  const alergias = await PATCH(`/medico/personas/${personaId}/alergias`, tk.ana, { alergias: ["penicilina", "  látex  ", ""] });
  verificar("Ana carga las alergias", alergias.estado === 200);
  const vistaBeto = await GET(`/medico/pacientes/${pacBeto._id}/persona`, tk.beto);
  verificar("Beto las ve en SU ficha, sin haberlas cargado", (vistaBeto.cuerpo?.persona?.alergias || []).join(",") === "penicilina,látex");
  verificar("y ve que la atienden en 2 consultorios", vistaBeto.cuerpo?.fichasEnLaClinica === 2);
  // Ésta es la que encontró la fuga: alergiasActualizadasPor viajaba con el
  // teléfono de Ana adentro del documento entero, así que abrir la ficha le
  // decía a Beto quién más atiende a esa persona.
  verificar("  ...sin decirle en cuáles", !vistaBeto.texto.includes(ana.phone));
  verificar("  ...ni quién cargó las alergias", vistaBeto.cuerpo?.persona?.alergiasActualizadasPor === undefined);
  verificar("  ...solo que no fue él", vistaBeto.cuerpo?.persona?.alergiasActualizadasPorMi === false);
  const vistaAna = await GET(`/medico/pacientes/${pacAna._id}/persona`, tk.ana);
  verificar("a Ana sí le dice que las cargó ella", vistaAna.cuerpo?.persona?.alergiasActualizadasPorMi === true);

  const ajeno = await PATCH(`/medico/personas/${personaId}/alergias`, tk.diego, { alergias: ["nada"] });
  verificar("un médico que NO la atiende no puede tocarle las alergias", ajeno.estado === 403);
  const soloBusca = await GET("/medico/personas/buscar?q=maria", tk.solo);
  verificar("un médico sin clínica no busca nada", soloBusca.cuerpo?.enClinica === false);

  // ── 7. Cosas que solo se ven contra Mongo ──────────────────────────────
  console.log("\n── 7. Lo que solo prueba una base de verdad ──");
  let choco = false;
  try {
    await Cita.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, pacienteNombre: "Doble reserva", fecha: aLas(9) });
  } catch (e) {
    choco = e.code === 11000;
  }
  verificar("el índice único impide reservar dos veces el mismo horario", choco);
  // Y que el índice sea PARCIAL: una cancelada en ese horario tiene que
  // poder existir, si no cancelar y volver a reservar sería imposible.
  let canceladaOk = true;
  try {
    await Cita.create({ medicoPhone: ana.phone, pacienteId: pacAna._id, pacienteNombre: "Cancelada previa", fecha: aLas(9), estado: "cancelada" });
  } catch { canceladaOk = false; }
  verificar("  ...pero una cancelada en ese horario sí puede existir", canceladaOk);

  const ocup = await GET("/admin/ocupacion?dias=7", tk.carla);
  const salaAna = (ocup.cuerpo?.salas || []).find(s => s.phone === ana.phone);
  const diaHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  verificar("la ocupación de hoy de Ana es 1 confirmada", salaAna?.porDia?.[diaHoy] === 1);

  // ── 8. Alta y baja de médicos ──────────────────────────────────────────
  console.log("\n── 8. Sumar y sacar médicos ──");
  const suma = await POST(`/admin/medicos/${solo.phone}/vincular`, tk.carla, { vinculo: "alquila", consultorio: "Consultorio 4" });
  verificar("se suma a la clínica un médico que ya tenía cuenta", suma.estado === 200);
  const traido = await Medico.findOne({ phone: solo.phone }).lean();
  verificar("  ...y le queda el vínculo y el consultorio", traido.vinculo === "alquila" && traido.consultorio === "Consultorio 4");
  // Editar es pedir la misma ruta de nuevo con otros datos — es lo que hace
  // el botón "Editar" de cada fila del panel, y por eso no hay ruta aparte.
  await POST(`/admin/medicos/${ana.phone}/vincular`, tk.carla, { vinculo: "alquila", consultorio: "Consultorio 1 bis" });
  const anaEditada = await Medico.findOne({ phone: ana.phone }).lean();
  verificar("volver a vincular corrige el consultorio y el vínculo",
    anaEditada.consultorio === "Consultorio 1 bis" && anaEditada.vinculo === "alquila");
  verificar("  ...sin tocarle un paciente", await Paciente.countDocuments({ medicoPhone: ana.phone }) === 2);
  // Y se deja como estaba, que abajo se sigue usando la clínica.
  await POST(`/admin/medicos/${ana.phone}/vincular`, tk.carla, { vinculo: "empleado", consultorio: "Consultorio 1" });

  const robo = await POST(`/admin/medicos/${solo.phone}/vincular`, tk.elena, { vinculo: "empleado" });
  verificar("otra clínica NO puede llevárselo", robo.estado === 409);
  const bajaAdmin = await POST(`/admin/medicos/${diego.phone}/desvincular`, tk.carla, {});
  verificar("no se puede desvincular a quien administra", bajaAdmin.estado === 409);
  const anaSigue = await GET("/medico/personas/buscar?q=maria", tk.ana);
  verificar("cambiarle el consultorio o el vínculo no le corta la sesión", anaSigue.estado === 200);
  // La sesión con la que entró después de sumarse a la clínica.
  await new Promise(r => setTimeout(r, 5));
  const soloEnLaClinica = generarToken(solo.phone, "medico", 36e5, { clinicaId: String(clinicaA._id) });
  verificar("con la sesión de cuando estaba en la clínica, entra", (await GET("/medico/personas/buscar?q=maria", soloEnLaClinica)).estado === 200);
  await new Promise(r => setTimeout(r, 5));
  const bajaOk = await POST(`/admin/medicos/${solo.phone}/desvincular`, tk.carla, {});
  verificar("sí se puede desvincular a un médico común", bajaOk.estado === 200);
  // Su sesión llevaba la clínica en el token (segunda revisión de QA del 9
  // de octubre de 2026, R02): se corta, y al volver a entrar ya no la tiene.
  verificar("  ...y esa sesión, que llevaba la clínica, se corta (401)", (await GET("/medico/personas/buscar?q=maria", soloEnLaClinica)).estado === 401);
  verificar("  ...mientras que una nueva, sin la clínica, entra",
    (await GET("/medico/personas/buscar?q=maria", generarToken(solo.phone, "medico", 36e5))).estado === 200);
  const pacientesDelSacado = await Paciente.countDocuments({ medicoPhone: solo.phone });
  verificar("  ...y no se le tocó una sola ficha", pacientesDelSacado === (await Paciente.countDocuments({ medicoPhone: solo.phone })));

  // ── 9. Los médicos que YA EXISTEN el día del despliegue ────────────────
  //
  // Ésta es la prueba del despliegue, no de la clínica. Hoy, en producción,
  // ni un solo médico tiene los campos nuevos: idioma, rol, vinculo y
  // clinicaId no existen en sus documentos. Se agregaron al esquema con
  // valores por defecto, pero un default de Mongoose se aplica al ESCRIBIR,
  // no cambia lo que ya está guardado — y .lean() ni siquiera lo aplica al
  // leer.
  //
  // Así que se inserta un médico con el driver crudo, sin pasar por el
  // esquema: exactamente como están los documentos de producción ahora.
  console.log("\n── 9. Un médico de antes del despliegue ──");
  await mongoose.connection.collection("medicos").insertOne({
    phone: "70000099",
    nombre: "Dr. Antiguo",
    especialidad: "Traumatología",
    tipoEspecialidad: "medicina_general",
    passwordHash: hash,
    activo: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    // Sin idioma, sin rol, sin vinculo, sin clinicaId. Como los de verdad.
  });

  require(path.join(RAIZ, "routes", "medicoAuth"))(app);
  const login = await pedir(puerto, "POST", "/medico/login", null, { phone: "70000099", password: "Prueba123." });
  verificar("un médico de antes puede iniciar sesión", login.estado === 200 && Boolean(login.cuerpo?.token));
  verificar("  ...y le toca español, no undefined", login.cuerpo?.idioma === "es");
  verificar("  ...y rol de médico", login.cuerpo?.rol === "medico");
  verificar("  ...y ninguna clínica", login.cuerpo?.clinica === null);

  const tokenAntiguo = login.cuerpo?.token;
  const susPacientes = await pedir(puerto, "GET", "/medico/pacientes", tokenAntiguo);
  verificar("sus rutas de siempre siguen abiertas", susPacientes.estado === 200);
  const suBusqueda = await pedir(puerto, "GET", "/medico/personas/buscar?q=maria", tokenAntiguo);
  verificar("y lo nuevo no le explota: simplemente no está en ninguna clínica", suBusqueda.cuerpo?.enClinica === false);
  verificar("  ...ni ve personas de nadie", (suBusqueda.cuerpo?.personas || []).length === 0);

  // Y que el panel lo tome bien si mañana lo suman a la clínica sin que él
  // haya tocado nada de su cuenta.
  await POST(`/admin/medicos/70000099/vincular`, tk.carla, { vinculo: "empleado", consultorio: "Consultorio 5" });
  const conElAntiguo = await GET("/admin/resumen", tk.carla);
  const antiguoEnPanel = (conElAntiguo.cuerpo?.medicos || []).find(m => m.phone === "70000099");
  verificar("sumado a la clínica, aparece en el panel sin romper nada", Boolean(antiguoEnPanel));
  verificar("  ...con sus contadores en cero, no en undefined",
    antiguoEnPanel?.consultasMes === 0 && antiguoEnPanel?.pacientes === 0 && antiguoEnPanel?.citasHoy === 0);

  // ─── LIMPIEZA ───────────────────────────────────────────────────────────
  await new Promise((r) => servidor.close(r));
  // registrar() escribe la auditoría en segundo plano y no se espera (a
  // propósito: auditar no puede demorar una respuesta). Si cerramos la
  // conexión en el acto, esas escrituras sueltan un ERROR en la salida que
  // parece un problema del producto y no lo es.
  await new Promise((r) => setTimeout(r, 500));
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
