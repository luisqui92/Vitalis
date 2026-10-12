// Symphomed Neurodesarrollo — La ficha compartida del equipo tratante.
//
// ═══ POR QUÉ ESTA PRUEBA ES DE LAS QUE MÁS IMPORTAN ═══════════════════════
//
// Todo el resto de Symphomed se apoya en una regla de una línea: la ficha es
// del profesional, `medicoPhone` y se acabó. Acá se abre la ÚNICA excepción
// de todo el producto, y una excepción a un permiso es exactamente donde se
// filtra una historia clínica.
//
// Un permiso roto no falla: anda. La pantalla se ve igual, nadie ve un error
// y los datos de un chico quedan a la vista de quien no corresponde. Por eso
// esto se prueba contra el servidor de verdad, con cuatro cuentas, y no
// leyendo el código.
//
// Lo que se comprueba, en orden de gravedad:
//
//   1. Que un profesional de OTRO centro no vea nada.
//   2. Que un colega del MISMO centro que NO está en el equipo no vea nada.
//   3. Que ser director no alcance.
//   4. Que estar en el equipo de un chico no dé acceso a los demás chicos.
//   5. Que el equipo no se arme sin autorización de la familia.
//   6. Que quien sí está pueda LEER y ESCRIBIR (compartir a medias no sirve).
//   7. Que sacar a alguien le corte el acceso de verdad.
//   8. Que cada entrada quede auditada.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

console.log("── 1. La regla vive en UN solo lugar ──");
// Si cada ruta resolviera de quién es la ficha por su cuenta, alcanzaría con
// que una se olvide para que el permiso deje de existir en esa pantalla —y
// no fallaría nada visible, que es la peor forma de romper un permiso.
for (const archivo of ["neurodesarrollo", "instrumentos", "informeFamilia"]) {
  const codigo = fs.readFileSync(path.join(RAIZ, "routes", `${archivo}.js`), "utf8")
    .replace(/^\s*\/\/.*$/gm, "");
  verificar(`[${archivo}] ninguna ruta busca el paciente con medicoPhone a mano`,
    !/obtenerOFallar\(Paciente,\s*\{\s*_id:\s*req\.params\.pacienteId,\s*medicoPhone/.test(codigo));
  verificar(`[${archivo}] usa el resolvedor del equipo`,
    /fichaNeuroOFallar\(req/.test(codigo));
}

(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("equipo_neuro");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "equipoNeuro"))(app);
  require(path.join(RAIZ, "routes", "neurodesarrollo"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Paciente, PersonaClinica, Clinica, AuditLog, ObjetivoNeuro } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  // Un centro con tres profesionales de neuro y un director que no atiende a
  // este chico; y otro centro aparte, para el caso más grave.
  const centro = await Clinica.create({ nombre: "Centro Aprender" });
  const otroCentro = await Clinica.create({ nombre: "Otro centro" });
  const clave = await hashPassword("Prueba1234!");
  const cuenta = async (phone, nombre, clinicaId, tipo = "neurodesarrollo") =>
    Medico.create({ phone, nombre, passwordHash: clave, activo: true, tipoEspecialidad: tipo, clinicaId });

  await cuenta("70000001", "Lic. Arce (psicopedagogía)", centro._id);
  await cuenta("70000002", "Lic. Rojas (fonoaudiología)", centro._id);
  await cuenta("70000003", "Lic. Paz (no atiende a Leo)", centro._id);
  await cuenta("70000004", "Dr. Director", centro._id);
  await cuenta("70000009", "Lic. Ajena (otro centro)", otroCentro._id);
  const tk = Object.fromEntries(["70000001", "70000002", "70000003", "70000004", "70000009"]
    .map(p => [p, generarToken(p, "medico", 3600 * 1000)]));

  // Leo: una persona del centro, con la ficha de Arce asociada. Y Sofía, otra
  // chica de Arce, para comprobar que el equipo no da acceso a TODO.
  const leo = await PersonaClinica.create({ clinicaId: centro._id, nombre: "Leonardo Aguilar" });
  const fichaLeo = await Paciente.create({ nombre: "Leonardo Aguilar", medicoPhone: "70000001", codigo: "P-0001", personaId: leo._id });
  const sofia = await PersonaClinica.create({ clinicaId: centro._id, nombre: "Sofía Vargas" });
  const fichaSofia = await Paciente.create({ nombre: "Sofía Vargas", medicoPhone: "70000001", codigo: "P-0002", personaId: sofia._id });

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, { metodo = "GET", token, cuerpo } = {}) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const cab = { "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}` };
    if (token) cab.Authorization = `Bearer ${token}`;
    if (datos) { cab["Content-Type"] = "application/json"; cab["Content-Length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo, headers: cab },
      r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j }); }); });
    req.on("error", () => res({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });

  console.log("\n── 2. Sin autorización de la familia no se arma ──");
  // Es el motivo entero de que esto pueda existir. Si se pudiera saltear,
  // "el centro comparte fichas" sería una decisión del centro sobre datos de
  // un chico que no son suyos.
  const sinAutorizar = await pedir(`/medico/pacientes/${fichaLeo._id}/equipo`,
    { metodo: "POST", token: tk["70000001"], cuerpo: { autorizacion: {} } });
  verificar("armar el equipo sin decir quién autorizó da 400", sinAutorizar.estado === 400);
  verificar("  ...y el mensaje dice que es decisión de la familia",
    /decisión de su familia/.test(sinAutorizar.cuerpo?.error || ""));
  const futura = await pedir(`/medico/pacientes/${fichaLeo._id}/equipo`, { metodo: "POST", token: tk["70000001"],
    cuerpo: { autorizacion: { porQuien: "Marcela Aguilar", fecha: new Date(Date.now() + 90 * 86400000) } } });
  verificar("una autorización fechada en el futuro se rechaza", futura.estado === 400);

  const creado = await pedir(`/medico/pacientes/${fichaLeo._id}/equipo`, { metodo: "POST", token: tk["70000001"],
    cuerpo: { rol: "Psicopedagogía", autorizacion: { porQuien: "Marcela Aguilar", vinculo: "madre", fecha: new Date() } } });
  verificar("con la autorización puesta, el equipo se arma", creado.estado === 201);
  const equipoId = creado.cuerpo?.equipo?._id;
  verificar("  ...y queda escrito quién autorizó y qué es del chico",
    creado.cuerpo?.equipo?.autorizacion?.porQuien === "Marcela Aguilar" &&
    creado.cuerpo?.equipo?.autorizacion?.vinculo === "madre");

  console.log("\n── 3. Antes de sumarla, la colega NO ve nada ──");
  const antes = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000002"] });
  verificar("una colega del centro que no está en el equipo recibe 404", antes.estado === 404);
  verificar("  ...y es 404, no 403: un 403 confirmaría que la ficha existe",
    antes.estado === 404 && !/permiso/i.test(antes.cuerpo?.error || ""));

  console.log("\n── 4. Ser director no alcanza ──");
  // Es la regla que el resto de Symphomed ya tenía y que esta excepción NO
  // podía aflojar: el acceso es por estar en el equipo de ESE chico.
  const director = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000004"] });
  verificar("el director del centro tampoco ve la ficha", director.estado === 404);

  console.log("\n── 5. Un profesional de otro centro, nunca ──");
  const ajena = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000009"] });
  verificar("alguien de otro centro recibe 404", ajena.estado === 404);
  const ajenaSuma = await pedir(`/medico/equipos/${equipoId}/miembros`,
    { metodo: "POST", token: tk["70000009"], cuerpo: { telefono: "70000009" } });
  verificar("  ...y no puede sumarse sola al equipo", ajenaSuma.estado === 404);

  console.log("\n── 6. Ya en el equipo: lee Y escribe ──");
  // Compartir para leer y no para escribir es la mitad inútil: la
  // fonoaudióloga vería el objetivo y no podría cargar lo que trabajó.
  const suma = await pedir(`/medico/equipos/${equipoId}/miembros`,
    { metodo: "POST", token: tk["70000001"], cuerpo: { telefono: "70000002", rol: "Fonoaudiología" } });
  verificar("se puede sumar a una colega del mismo centro y rama", suma.estado === 200);

  const ve = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000002"] });
  verificar("ahora sí ve la ficha, entrando por la ficha titular", ve.estado === 200);

  const creaObjetivo = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro/objetivos`,
    { metodo: "POST", token: tk["70000002"], cuerpo: { titulo: "Pedir agua señalando", area: "comunicacion" } });
  verificar("puede crear un objetivo en la ficha compartida", creaObjetivo.estado === 200 || creaObjetivo.estado === 201);

  // Y el objetivo tiene que quedar en la ficha TITULAR, no en una suya: si
  // quedara en la de cada uno, seguirían siendo fichas separadas con otro
  // nombre.
  const obj = await ObjetivoNeuro.findOne({ titulo: "Pedir agua señalando" }).lean();
  verificar("  ...y el objetivo queda en la ficha titular, no en una copia",
    obj && String(obj.pacienteId) === String(fichaLeo._id) && obj.medicoPhone === "70000001");

  const progreso = await pedir(`/medico/neuro/objetivos/${obj._id}/progreso`,
    { metodo: "POST", token: tk["70000002"], cuerpo: { logros: 8, intentos: 10, ayuda: "gestual" } });
  verificar("puede cargar progreso sobre un objetivo que no creó ella", progreso.estado === 200 || progreso.estado === 201);
  const ajenoProgreso = await pedir(`/medico/neuro/objetivos/${obj._id}/progreso`,
    { metodo: "POST", token: tk["70000003"], cuerpo: { logros: 1, intentos: 1 } });
  verificar("  ...y quien no está en el equipo, no", ajenoProgreso.estado === 404);

  console.log("\n── 6b. Lo que la colega ya tenía por su cuenta se avisa ──");
  // Si venía atendiendo al chico sola, tiene su perfil y sus objetivos en SU
  // ficha. Desde que entra al equipo trabaja sobre la titular, y eso deja de
  // verse. No se borra, pero desde su silla es lo mismo hasta que alguien se
  // lo explica — así que hay que explicárselo en el momento, no después.
  const suya = await Paciente.create({ nombre: "Leonardo Aguilar", medicoPhone: "70000003", codigo: "P-0003", personaId: leo._id });
  await ObjetivoNeuro.create({ pacienteId: suya._id, medicoPhone: "70000003", titulo: "Lo que ya venía trabajando" });
  const suma3 = await pedir(`/medico/equipos/${equipoId}/miembros`,
    { metodo: "POST", token: tk["70000001"], cuerpo: { telefono: "70000003", rol: "Terapia ocupacional" } });
  verificar("al sumarla se avisa que ya tenía su propia ficha del chico",
    suma3.cuerpo?.traeFichaPropia?.objetivos === 1);
  // Y no se toca: fusionar dos perfiles automáticamente es decidir cuál gana,
  // y esa decisión no la puede tomar el sistema.
  verificar("  ...y lo suyo NO se borra ni se mezcla solo",
    await ObjetivoNeuro.exists({ pacienteId: suya._id, titulo: "Lo que ya venía trabajando" }));
  await pedir(`/medico/equipos/${equipoId}/miembros/70000003`, { metodo: "DELETE", token: tk["70000001"] });

  console.log("\n── 7. El equipo es por CHICO, no por centro ──");
  // Estar en el equipo de Leo no puede abrir la ficha de Sofía. Si esto
  // fallara, sumar a alguien a un equipo le daría el centro entero.
  const otraChica = await pedir(`/medico/pacientes/${fichaSofia._id}/neuro`, { token: tk["70000002"] });
  verificar("estar en el equipo de Leo no da acceso a la ficha de Sofía", otraChica.estado === 404);

  console.log("\n── 8. Sacar a alguien corta el acceso de verdad ──");
  const saca = await pedir(`/medico/equipos/${equipoId}/miembros/70000002`, { metodo: "DELETE", token: tk["70000001"] });
  verificar("se la puede sacar del equipo", saca.estado === 200);
  const despues = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000002"] });
  verificar("y deja de ver la ficha inmediatamente", despues.estado === 404);
  const despuesEscribe = await pedir(`/medico/neuro/objetivos/${obj._id}/progreso`,
    { metodo: "POST", token: tk["70000002"], cuerpo: { logros: 1, intentos: 1 } });
  verificar("  ...y tampoco puede escribir", despuesEscribe.estado === 404);
  // Lo que cargó NO se borra: es parte de la historia del chico, no de su
  // cuenta.
  const sigue = await ObjetivoNeuro.findById(obj._id).lean();
  verificar("pero lo que cargó queda en la ficha", sigue && sigue.progreso.length >= 1);

  console.log("\n── 9. Al titular no se lo puede sacar ──");
  // La ficha es suya: sacarlo dejaría un equipo trabajando sobre la ficha de
  // alguien que no lo integra.
  const sacaTitular = await pedir(`/medico/equipos/${equipoId}/miembros/70000001`, { metodo: "DELETE", token: tk["70000001"] });
  verificar("sacar a quien tiene la ficha se rechaza con una explicación",
    sacaTitular.estado === 409 && /cerrá el equipo/i.test(sacaTitular.cuerpo?.error || ""));

  console.log("\n── 10. Cada entrada queda auditada ──");
  // El sentido de que la familia autorice es que después se pueda ver quién
  // entró. Una autorización sin rastro de uso no es una autorización.
  const registros = await AuditLog.find({ accion: /equipo_neuro|ficha_equipo/ }).lean();
  verificar("se registró que se creó el equipo",
    registros.some(r => r.accion === "crear_equipo_neuro"));
  verificar("  ...y con quién autorizó",
    registros.some(r => /Marcela Aguilar/.test(r.detalle || "")));
  verificar("se registró cada vez que la colega abrió la ficha ajena",
    registros.some(r => r.medicoPhone === "70000002" && /ficha_equipo/.test(r.accion)));
  verificar("  ...y NO se registra al titular abriendo la suya (sería cada pantalla)",
    !registros.some(r => r.medicoPhone === "70000001" && r.accion === "ficha_equipo"));
  verificar("se registró a quién se sumó y a quién se sacó",
    registros.some(r => r.accion === "sumar_al_equipo_neuro") &&
    registros.some(r => r.accion === "sacar_del_equipo_neuro"));

  console.log("\n── 11. Cerrar el equipo ──");
  const cierra = await pedir(`/medico/equipos/${equipoId}`, { metodo: "DELETE", token: tk["70000001"] });
  verificar("la familia retira la autorización y el equipo se cierra", cierra.estado === 200);
  const { EquipoNeuro } = require(path.join(RAIZ, "db", "models"));
  const cerrado = await EquipoNeuro.findById(equipoId).lean();
  verificar("  ...pero NO se borra: queda el registro de que autorizó",
    cerrado && cerrado.activo === false && cerrado.autorizacion.porQuien === "Marcela Aguilar");
  const titularSigue = await pedir(`/medico/pacientes/${fichaLeo._id}/neuro`, { token: tk["70000001"] });
  verificar("y su propia ficha le sigue funcionando al titular", titularSigue.estado === 200);

  console.log("\n── 12. Irse del centro o de la rama corta los DOS caminos ──");
  // La colega tiene su propia ficha del chico, enlazada a la misma persona.
  // Pedir ESA ficha la llevaba a la titular mirando solo si estaba en el
  // equipo: desvinculada del centro, seguía entrando (revisión integral del
  // 11 de octubre de 2026, S01). Se prueba por los dos caminos, y también el
  // equipo y los objetos que se editan por su id.
  const mateo = await PersonaClinica.create({ clinicaId: centro._id, nombre: "Mateo Quispe" });
  const fichaMateo = await Paciente.create({ nombre: "Mateo Quispe", medicoPhone: "70000001", codigo: "P-0010", personaId: mateo._id });
  const fichaMateoRojas = await Paciente.create({ nombre: "Mateo Quispe", medicoPhone: "70000002", codigo: "P-0011", personaId: mateo._id });
  const eqMateo = await pedir(`/medico/pacientes/${fichaMateo._id}/equipo`, { metodo: "POST", token: tk["70000001"],
    cuerpo: { rol: "Psicopedagogía", autorizacion: { porQuien: "Ana Quispe", vinculo: "madre", fecha: new Date() } } });
  const equipoMateo = eqMateo.cuerpo?.equipo?._id;
  await pedir(`/medico/equipos/${equipoMateo}/miembros`, { metodo: "POST", token: tk["70000001"], cuerpo: { telefono: "70000002", rol: "Fonoaudiología" } });
  await pedir(`/medico/pacientes/${fichaMateoRojas._id}/neuro/objetivos`,
    { metodo: "POST", token: tk["70000002"], cuerpo: { titulo: "Nombrar colores", area: "comunicacion" } });
  const objMateo = await ObjetivoNeuro.findOne({ titulo: "Nombrar colores" }).lean();
  verificar("en el equipo, entrando por SU ficha escribe en la titular",
    objMateo && String(objMateo.pacienteId) === String(fichaMateo._id));

  const caminos = async () => {
    const t = tk["70000002"];
    const estados = {
      suFicha: (await pedir(`/medico/pacientes/${fichaMateoRojas._id}/neuro`, { token: t })).estado,
      titular: (await pedir(`/medico/pacientes/${fichaMateo._id}/neuro`, { token: t })).estado,
      equipo: (await pedir(`/medico/pacientes/${fichaMateoRojas._id}/equipo`, { token: t })).estado,
      objetivo: (await pedir(`/medico/neuro/objetivos/${objMateo._id}/progreso`, { metodo: "POST", token: t, cuerpo: { logros: 1, intentos: 2 } })).estado,
    };
    return { estados, todos404: Object.values(estados).every(e => e === 404), ninguno404: Object.values(estados).every(e => e >= 200 && e < 300) };
  };
  let c = await caminos();
  verificar(`antes: entra por los dos caminos, ve el equipo y escribe (${JSON.stringify(c.estados)})`, c.ninguno404);

  await Medico.updateOne({ phone: "70000002" }, { $set: { clinicaId: null } });
  c = await caminos();
  verificar(`desvinculada del centro: 404 en todo, también por SU ficha (${JSON.stringify(c.estados)})`, c.todos404);
  const sumaDeAfuera = await pedir(`/medico/equipos/${equipoMateo}/miembros`,
    { metodo: "POST", token: tk["70000002"], cuerpo: { telefono: "70000003" } });
  verificar("  ...no puede sumar a nadie al equipo", sumaDeAfuera.estado === 404);
  const sacaDeAfuera = await pedir(`/medico/equipos/${equipoMateo}/miembros/70000001`, { metodo: "DELETE", token: tk["70000002"] });
  const cierraDeAfuera = await pedir(`/medico/equipos/${equipoMateo}`, { metodo: "DELETE", token: tk["70000002"] });
  verificar("  ...ni sacar gente ni cerrar el equipo", sacaDeAfuera.estado === 404 && cierraDeAfuera.estado === 404);
  const compartidos = await pedir("/medico/equipos/compartidos", { token: tk["70000002"] });
  verificar("  ...y el chico no le aparece entre los compartidos", compartidos.estado === 200 && compartidos.cuerpo?.pacientes?.length === 0);

  await Medico.updateOne({ phone: "70000002" }, { $set: { clinicaId: centro._id } });
  c = await caminos();
  verificar(`vuelve al centro: entra de nuevo, la regla mira la cuenta de hoy (${JSON.stringify(c.estados)})`, c.ninguno404);

  await Medico.updateOne({ phone: "70000002" }, { $set: { tipoEspecialidad: "psicologia" } });
  c = await caminos();
  verificar(`deja la rama de neuro: 404 en todo (${JSON.stringify(c.estados)})`, c.todos404);
  await Medico.updateOne({ phone: "70000002" }, { $set: { tipoEspecialidad: "neurodesarrollo" } });

  await pedir(`/medico/equipos/${equipoMateo}/miembros/70000002`, { metodo: "DELETE", token: tk["70000001"] });
  c = await caminos();
  verificar(`la sacan del equipo: 404 en todo (${JSON.stringify(c.estados)})`, c.todos404);
  const titularMateo = await pedir(`/medico/pacientes/${fichaMateo._id}/neuro`, { token: tk["70000001"] });
  verificar("el titular sigue con su ficha", titularMateo.estado === 200);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
