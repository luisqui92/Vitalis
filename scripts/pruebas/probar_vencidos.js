// Symphomed — El panel de lo que se pasó.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Este panel tiene una propiedad incómoda: cuando se rompe, se ve BIEN.
// Una consulta que devuelve vacío y una consulta que falló se dibujan igual
// —no hay tarjeta— y el médico lee eso como "no tengo nada vencido". Si eso
// pasa con una antirrábica de hace ocho meses, Symphomed no le falló en
// silencio: le mintió.
//
// Entonces lo que más se prueba acá no es que encuentre lo vencido, sino:
//
//   1. Que lo vencido aparezca (obvio, y va primero).
//   2. Que lo que TODAVÍA NO venció no aparezca — un panel con ruido se
//      deja de mirar, y ahí se pierde lo que sí importaba.
//   3. Que si un grupo falla, se DIGA, en vez de mostrar una lista corta
//      como si estuviera completa.
//   4. Que un médico no vea nunca lo de otro.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const dias = (n) => new Date(Date.now() - n * 86400000);

(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vencidos");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "vencidos"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Paciente, Recordatorio, Vacuna, VigilanciaSalud, TratamientoPlan } =
    require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  const vencidos = require(path.join(RAIZ, "services", "vencidos"));
  await mongoose.connection.dropDatabase();

  const clave = await hashPassword("Prueba1234!");
  await Medico.create({ phone: "70000001", nombre: "Dra. Vet", passwordHash: clave, activo: true, tipoEspecialidad: "veterinaria" });
  await Medico.create({ phone: "70000002", nombre: "Dr. Otro", passwordHash: clave, activo: true });
  const tk = generarToken("70000001", "medico", 3600 * 1000);
  const tkOtro = generarToken("70000002", "medico", 3600 * 1000);

  // ─── Un perro adulto con la antirrábica vencida ───────────────────────
  const firulais = await Paciente.create({
    nombre: "Firulais", medicoPhone: "70000001", codigo: "P-0001",
    especie: "Perro", fechaNacimiento: dias(4 * 365),
  });
  await Vacuna.create({ pacienteId: firulais._id, medicoPhone: "70000001",
    nombre: "Antirrábica", dosis: "anual", fecha: dias(500) });

  // ─── Un perro con TODO al día: no tiene que aparecer ──────────────────
  const rocky = await Paciente.create({
    nombre: "Rocky", medicoPhone: "70000001", codigo: "P-0002",
    especie: "Perro", fechaNacimiento: dias(3 * 365),
  });
  for (const n of ["Polivalente 1ra dosis", "Polivalente 2da dosis", "Polivalente 3ra dosis",
                   "Polivalente 4ta dosis", "Polivalente refuerzo anual", "Antirrábica",
                   "Desparasitación interna"]) {
    await Vacuna.create({ pacienteId: rocky._id, medicoPhone: "70000001", nombre: n, fecha: dias(30) });
  }

  // ─── Un recordatorio vencido y otro que todavía no ────────────────────
  await Recordatorio.create({ pacienteId: firulais._id, pacienteNombre: "Firulais", medicoPhone: "70000001",
    tipo: "control", titulo: "Control post quirúrgico", fecha: dias(20) });
  await Recordatorio.create({ pacienteId: rocky._id, pacienteNombre: "Rocky", medicoPhone: "70000001",
    tipo: "control", titulo: "Control del año que viene", fecha: new Date(Date.now() + 90 * 86400000) });
  await Recordatorio.create({ pacienteId: rocky._id, pacienteNombre: "Rocky", medicoPhone: "70000001",
    tipo: "control", titulo: "Ya lo hice", fecha: dias(40), completado: true });

  // ─── Un tratamiento aprobado y parado, y otro reciente ────────────────
  const parado = await TratamientoPlan.create({ pacienteId: firulais._id, medicoPhone: "70000001",
    nombre: "Limpieza dental bajo anestesia", precio: 700, estado: "pendiente" });
  await TratamientoPlan.updateOne({ _id: parado._id }, { $set: { updatedAt: dias(120) } }, { timestamps: false });
  await TratamientoPlan.create({ pacienteId: rocky._id, medicoPhone: "70000001",
    nombre: "Recién presupuestado", precio: 300, estado: "pendiente" });

  // ─── Lo de OTRO médico, que no tiene que verse nunca ──────────────────
  const ajeno = await Paciente.create({ nombre: "Perro Ajeno", medicoPhone: "70000002", codigo: "P-0001" });
  await Recordatorio.create({ pacienteId: ajeno._id, pacienteNombre: "Perro Ajeno", medicoPhone: "70000002",
    tipo: "control", titulo: "SECRETO DE OTRO CONSULTORIO", fecha: dias(90) });

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, token) => new Promise(res => {
    const req = http.request({ host: "127.0.0.1", port: servidor.address().port, path: ruta, method: "GET",
      headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}` } },
      r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j, texto: t }); }); });
    req.on("error", () => res({ estado: 0 }));
    req.end();
  });

  const r = await pedir("/medico/vencidos", tk);
  const grupo = (c) => (r.cuerpo?.grupos || []).find(g => g.clave === c);
  const textos = (c) => (grupo(c)?.items || []).map(i => `${i.paciente}: ${i.que}`);

  console.log("── 1. Lo que se pasó, aparece ──");
  verificar("la ruta responde", r.estado === 200);
  verificar("la antirrábica vencida de Firulais está",
    textos("vacunas").some(t => /Firulais.*Antirr/i.test(t)));
  verificar("el recordatorio vencido está",
    textos("recordatorios").some(t => /Control post quirúrgico/.test(t)));
  verificar("el tratamiento aprobado y parado está",
    textos("tratamientos").some(t => /Limpieza dental/.test(t)));
  verificar("y cada ítem dice hace cuánto, en palabras",
    (grupo("recordatorios")?.items || []).every(i => /hace \d+ (días|mes|meses|años)/.test(i.hace)));
  verificar("cada ítem sabe a qué pestaña abrir",
    (r.cuerpo?.grupos || []).flatMap(g => g.items).every(i => i.tab && i.pacienteId));

  console.log("\n── 2. Lo que NO se pasó, no aparece ──");
  // Es la mitad que se rompe sin que nadie se entere: un panel con ruido se
  // deja de mirar, y ahí adentro se pierde lo que sí importaba.
  const todo = JSON.stringify(r.cuerpo);
  verificar("un perro con el esquema completo no figura", !/Rocky.*Antirr|Antirr.*Rocky/.test(todo));
  verificar("un recordatorio futuro no figura", !/año que viene/.test(todo));
  verificar("un recordatorio ya completado tampoco", !/Ya lo hice/.test(todo));
  verificar("un presupuesto reciente no figura como parado", !/Recién presupuestado/.test(todo));
  // Las "según riesgo" dependen de dónde vive el animal, y el sistema no lo
  // sabe. Reclamarle una leptospirosis a un perro de departamento es el tipo
  // de aviso que hace que el panel se ignore entero.
  verificar("no se reclaman vacunas que dependen del riesgo (lepto, tos de perreras)",
    !/Leptospirosis|perreras/i.test(todo));

  console.log("\n── 2b. El «hace cuánto» es el ATRASO, no la antigüedad ──");
  // Salió de mirar el panel con datos reales: un control anual hecho hace 13
  // meses figuraba como "hace 13 meses" en una columna que se lee como
  // atraso — cuando lleva UN mes de atraso. El error infla todo, y a la
  // tercera vez que el panel exagera el médico deja de creerle.
  const chico = await Paciente.create({ nombre: "Emilia", medicoPhone: "70000001", codigo: "P-0003",
    fechaNacimiento: dias(6 * 365) });
  await VigilanciaSalud.create({ pacienteId: chico._id, medicoPhone: "70000001",
    nombre: "Perfil tiroideo (TSH)", desdeMeses: 0, hastaMeses: null, cadaMeses: 12,
    realizados: [{ fecha: dias(395) }] });   // anual, hecho hace 13 meses → 1 mes de atraso
  const conAtraso = await vencidos.vigilanciaAtrasada("70000001");
  const tsh = conAtraso.find(i => /tiroideo/.test(i.que));
  verificar("un control anual hecho hace 13 meses lleva ~1 mes de atraso, no 13",
    tsh && tsh.dias > 20 && tsh.dias < 45);
  verificar("  ...y el detalle sigue diciendo cuándo fue el último",
    tsh && /El último fue el/.test(tsh.detalle));

  // Y el que nunca se hizo: el atraso corre desde que se cerró la ventana,
  // no desde que nació el chico.
  await VigilanciaSalud.create({ pacienteId: chico._id, medicoPhone: "70000001",
    nombre: "Estudio de sueño", desdeMeses: 36, hastaMeses: 60, cadaMeses: null, realizados: [] });
  const sueno = (await vencidos.vigilanciaAtrasada("70000001")).find(i => /sueño/.test(i.que));
  verificar("un estudio que se perdió a los 5 años, en un chico de 6, lleva ~1 año",
    sueno && sueno.dias > 300 && sueno.dias < 430);
  verificar("  ...y no los 6 años que tiene el chico", !(sueno && sueno.dias > 1800));
  // Limpieza, para no ensuciar los grupos de las secciones que siguen.
  await VigilanciaSalud.deleteMany({ pacienteId: chico._id });
  await Paciente.deleteOne({ _id: chico._id });

  console.log("\n── 3. Un médico no ve lo de otro ──");
  verificar("nada del otro consultorio se filtró", !/SECRETO DE OTRO CONSULTORIO/.test(r.texto));
  const otro = await pedir("/medico/vencidos", tkOtro);
  verificar("y el otro sí ve lo suyo", /SECRETO DE OTRO CONSULTORIO/.test(otro.texto));
  verificar("  ...y no ve lo del primero", !/Firulais/.test(otro.texto));

  console.log("\n── 4. Si un grupo falla, se DICE ──");
  // Acá está el corazón de la prueba. Una consulta que devuelve vacío y una
  // que explotó se ven iguales en pantalla, y el médico lee las dos como
  // "no tengo nada vencido". Si eso pasa con una vacuna vencida, Symphomed
  // no falló en silencio: mintió.
  const original = mongoose.models.Vacuna.find;
  mongoose.models.Vacuna.find = () => { throw new Error("base caída"); };
  const roto = await vencidos.loQueSePaso("70000001");
  mongoose.models.Vacuna.find = original;

  verificar("con un grupo caído, el resto del panel sigue saliendo", roto.total > 0);
  verificar("  ...el grupo que falló no aparece vacío y mentiroso",
    !(roto.grupos || []).some(g => g.clave === "vacunas"));
  verificar("  ...y se marca que el panel está incompleto", roto.parcial === true);

  const sano = await vencidos.loQueSePaso("70000001");
  verificar("y cuando todo anda, NO se marca como incompleto", sano.parcial === false);

  console.log("\n── 5. Un consultorio vacío no dibuja nada ──");
  await Medico.create({ phone: "70000003", nombre: "Dra. Nueva", passwordHash: clave, activo: true });
  const nueva = await vencidos.loQueSePaso("70000003");
  verificar("sin nada vencido, total es 0 y no hay grupos",
    nueva.total === 0 && nueva.grupos.length === 0 && nueva.parcial === false);
  const pantalla = require("fs").readFileSync(path.join(RAIZ, "public", "js", "vencidos.js"), "utf8");
  verificar("y la pantalla no dibuja un cartel de «todo al día»",
    /if \(!d\.total\)/.test(pantalla) && !/todo al día|Todo al día/.test(pantalla.replace(/^\s*\/\/.*$/gm, "")));
  // Lo vencido se resuelve atendiéndolo, no tapándolo.
  verificar("no hay forma de descartar un aviso sin resolverlo",
    !/descartar|silenciar|ocultar aviso/i.test(pantalla.replace(/^\s*\/\/.*$/gm, "")));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
