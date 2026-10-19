// Symphomed — El resumen compartido, de punta a punta.
//
// ═══ POR QUÉ ESTA PRUEBA ADEMÁS DE probar_resumen_compartido.js ═══════════
//
// Aquella lee el código: comprueba que la regla esté escrita y que el armador
// no deje pasar lo que no tiene que pasar. Esta LEVANTA EL SERVIDOR y hace el
// recorrido completo, que es donde viven los errores que ninguna lectura
// encuentra:
//
//   · una ruta que no valida el dueño y contesta 200 al médico equivocado;
//   · un enlace revocado que sigue abriendo porque el orden de los `if`
//     quedó al revés;
//   · un importar que crea dos fichas del mismo paciente porque alguien
//     tocó el botón dos veces;
//   · una llave vieja que sigue viva después de emitir una nueva.
//
// Los cuatro devuelven 200 y no tiran ningún error. Solo se ven pidiéndolos.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.APP_URL = "https://app.symphomed.test";

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
  process.env.MONGODB_URI = mongod.getUri("resumen");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "resumenCompartido"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Paciente, PersonaClinica, Clinica, ConsultaMedica, Medicamento,
          ResumenCompartido, LlavePaciente } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  // Los índices se crean al vuelo; el único parcial que importa acá es el de
  // LlavePaciente, y sin esperarlo la prueba de «una sola llave viva» pasaría
  // por casualidad.
  await LlavePaciente.init();

  const clave = await hashPassword("Prueba1234!");
  const clinica = await Clinica.create({ nombre: "Centro Norte", activa: true });
  await Medico.create({ phone: "70000001", nombre: "Dra. Quiroga", passwordHash: clave, activo: true });
  await Medico.create({ phone: "70000002", nombre: "Dr. Vargas", passwordHash: clave, activo: true });

  const persona = await PersonaClinica.create({
    clinicaId: clinica._id, nombre: "Carla Mendoza", documento: "4821993",
    alergias: ["Penicilina"], alergiasActualizadasEn: new Date(),
  });
  const paciente = await Paciente.create({
    medicoPhone: "70000001", nombre: "Carla Mendoza", personaId: persona._id,
    fechaNacimiento: new Date("1984-03-02"), sexo: "F", telefono: "59170011122",
    antecedentesPersonales: ["Hipertensión desde 2019"],
  });
  // Del otro médico, para las pruebas de aislamiento.
  const ajeno = await Paciente.create({ medicoPhone: "70000002", nombre: "Paciente Ajeno" });

  await ConsultaMedica.create({
    medicoPhone: "70000001", pacienteId: paciente._id, estado: "completado",
    confirmadaEn: new Date(), transcripcionCompleta: "ZZCRUDOZZ",
    notaClinica: { motivoConsulta: "Control de presión", diagnostico: "HTA esencial",
                   plan: "Continuar enalapril", diagnosticosDiferenciales: ["ZZDIFZZ"] },
  });
  // Sin confirmar: es un borrador que escribió la IA y el médico no revisó.
  await ConsultaMedica.create({
    medicoPhone: "70000001", pacienteId: paciente._id, estado: "completado",
    notaClinica: { motivoConsulta: "ZZSINCONFIRMARZZ", diagnostico: "ZZSINCONFIRMARZZ" },
  });
  await Medicamento.create({ pacienteId: paciente._id, medicoPhone: "70000001",
    nombre: "Enalapril", dosis: "10 mg", frecuencia: "cada 12 h" });

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

  const tk1 = generarToken("70000001", "medico", 3600000);
  const tk2 = generarToken("70000002", "medico", 3600000);

  // ═══ 1. EL MÉDICO COMPARTE ═══════════════════════════════════════════════
  console.log("── 1. El médico prepara y comparte ──");

  const previa = await pedir(`/medico/pacientes/${paciente._id}/resumenes/previa`, tk1, "POST", { alcance: "resumen" });
  verificar("la previa se arma sin crear nada", previa.estado === 200 && Boolean(previa.cuerpo.contenido));
  verificar("  ...y no dejó ningún resumen en la base", await ResumenCompartido.countDocuments() === 0);
  verificar("  ...trae la firma, que es a quién llamar",
    Boolean(previa.cuerpo.firma) && previa.cuerpo.firma.firmaNombre === "Dra. Quiroga");

  const creado = await pedir(`/medico/pacientes/${paciente._id}/resumenes`, tk1, "POST", { alcance: "resumen" });
  verificar("compartir devuelve un enlace", creado.estado === 200 && /\/r\/[A-Za-z0-9_-]{20,}$/.test(creado.cuerpo.enlace || ""));
  verificar("  ...con el dominio público configurado, no el del servidor",
    String(creado.cuerpo.enlace).startsWith("https://app.symphomed.test/r/"));
  const token = String(creado.cuerpo.enlace).split("/r/")[1];

  // Lo que sale por la previa tiene que ser lo mismo que quedó guardado. Si
  // no, el médico aprueba una cosa y se manda otra.
  const guardado = await ResumenCompartido.findOne({ token }).lean();
  verificar("lo guardado es idéntico a lo que el médico aprobó en la previa",
    JSON.stringify(guardado.contenido) === JSON.stringify(previa.cuerpo.contenido));

  // ═══ 2. EL COLEGA ABRE ═══════════════════════════════════════════════════
  console.log("\n── 2. El colega abre el enlace, sin cuenta ──");

  const abierto = await pedir(`/r/${token}/datos`, null);
  verificar("abre sin ninguna credencial", abierto.estado === 200);
  const crudo = JSON.stringify(abierto.cuerpo);
  verificar("  ...y no viajó la transcripción", !crudo.includes("ZZCRUDOZZ"));
  verificar("  ...ni los diferenciales", !crudo.includes("ZZDIFZZ"));
  verificar("  ...ni la consulta que el médico no confirmó", !crudo.includes("ZZSINCONFIRMARZZ"));
  verificar("  ...pero sí las alergias", crudo.includes("Penicilina"));
  verificar("  ...y la consulta que sí confirmó", crudo.includes("Control de presión"));
  // Quien recibe no tiene por qué saber de qué consultorio salió más allá de
  // la firma, ni qué otros médicos lo abrieron.
  verificar("no se filtran los identificadores internos",
    !crudo.includes(String(paciente._id)) && !crudo.includes("importadoPor") && !crudo.includes("70000001"));

  const contador = await ResumenCompartido.findOne({ token }).lean();
  verificar("se cuenta la apertura, para que el médico sepa si lo leyeron", contador.vistas === 1);

  // ═══ 3. NADIE VE LO QUE NO ES SUYO ═══════════════════════════════════════
  console.log("\n── 3. Nadie llega a lo del otro ──");

  const otroPide = await pedir(`/medico/pacientes/${paciente._id}/resumenes`, tk2);
  verificar("otro médico no puede listar los resúmenes de un paciente ajeno", otroPide.estado === 404);
  const otroComparte = await pedir(`/medico/pacientes/${paciente._id}/resumenes`, tk2, "POST", { alcance: "completo" });
  verificar("  ...ni compartir su historia", otroComparte.estado === 404);
  const otroRevoca = await pedir(`/medico/resumenes/${guardado._id}/revocar`, tk2, "POST", {});
  verificar("  ...ni revocar un enlace que no generó", otroRevoca.estado === 404);
  const sinSesion = await pedir(`/medico/pacientes/${paciente._id}/resumenes`, null);
  verificar("y sin sesión no se entra a nada del médico", sinSesion.estado === 401 || sinSesion.estado === 403);

  // ═══ 4. LA LLAVE DEL PACIENTE ════════════════════════════════════════════
  console.log("\n── 4. La llave, y lo que el paciente hace con ella ──");

  // El envío por WhatsApp va a fallar (no hay credenciales de Meta en la
  // prueba) y eso es justamente lo que hay que comprobar: la llave NO se
  // pierde por eso, se le devuelve el enlace al médico para que lo mande él.
  const emitida = await pedir(`/medico/pacientes/${paciente._id}/llave`, tk1, "POST", {});
  verificar("emitir la llave devuelve el enlace aunque WhatsApp falle",
    emitida.estado === 200 && /\/mi\/[A-Za-z0-9_-]{20,}$/.test(emitida.cuerpo.enlace || ""));
  const llave = String(emitida.cuerpo.enlace).split("/mi/")[1];

  const mios = await pedir(`/mi/${llave}/datos`, null);
  verificar("el paciente abre lo suyo sin cuenta", mios.estado === 200);
  // Lo suyo lo ve entero: elegir qué compartir es otra cosa que mirar.
  verificar("  ...y lo ve completo, no el resumen corto",
    Boolean(mios.cuerpo.contenido.mediciones) === false && Boolean(mios.cuerpo.contenido.antecedentes));
  const miosCrudo = JSON.stringify(mios.cuerpo);
  verificar("  ...pero tampoco a él le llega la transcripción", !miosCrudo.includes("ZZCRUDOZZ"));
  verificar("  ...ni los diferenciales", !miosCrudo.includes("ZZDIFZZ"));

  const suyo = await pedir(`/mi/${llave}/compartir`, null, "POST", { alcance: "resumen" });
  verificar("el paciente genera su propio enlace, sin pedir permiso", suyo.estado === 200 && Boolean(suyo.cuerpo.enlace));
  const tokenSuyo = String(suyo.cuerpo.enlace).split("/r/")[1];
  const abiertoSuyo = await pedir(`/r/${tokenSuyo}/datos`, null);
  verificar("  ...y ese enlace abre igual que el del médico", abiertoSuyo.estado === 200);
  verificar("  ...diciendo que lo compartió el propio paciente", abiertoSuyo.cuerpo.resumen.generadoPor === "paciente");

  // Emitir una llave nueva tiene que matar la anterior: es lo que hace que
  // «se la mandé al número equivocado» tenga arreglo.
  const emitida2 = await pedir(`/medico/pacientes/${paciente._id}/llave`, tk1, "POST", {});
  const llave2 = String(emitida2.cuerpo.enlace).split("/mi/")[1];
  verificar("emitir una llave nueva da una distinta", llave2 !== llave);
  const conLaVieja = await pedir(`/mi/${llave}/datos`, null);
  verificar("  ...y la vieja deja de abrir", conLaVieja.estado === 404);
  verificar("  ...y la nueva sí", (await pedir(`/mi/${llave2}/datos`, null)).estado === 200);
  verificar("  ...quedando una sola viva", await LlavePaciente.countDocuments({ pacienteId: paciente._id, revocadaEn: null }) === 1);

  // ═══ 5. REVOCAR CORTA DE VERDAD ══════════════════════════════════════════
  console.log("\n── 5. Cortar un enlace lo corta ──");

  const revocado = await pedir(`/medico/resumenes/${guardado._id}/revocar`, tk1, "POST", {});
  verificar("el médico corta el enlace que generó", revocado.estado === 200);
  const trasRevocar = await pedir(`/r/${token}/datos`, null);
  verificar("  ...y deja de abrir al instante", trasRevocar.estado === 410);
  verificar("  ...diciendo por qué, no un 404 seco",
    /dio de baja/.test(String(trasRevocar.cuerpo && trasRevocar.cuerpo.error)));
  verificar("  ...pero el registro no se borró", await ResumenCompartido.countDocuments({ token }) === 1);

  // El paciente corta lo suyo por su propia puerta.
  const cortadoPorEl = await pedir(`/mi/${llave2}/compartidos/${suyo.cuerpo.resumen.id}/revocar`, null, "POST", {});
  verificar("el paciente corta los enlaces que él generó", cortadoPorEl.estado === 200);
  verificar("  ...y ese también deja de abrir", (await pedir(`/r/${tokenSuyo}/datos`, null)).estado === 410);

  // Lo que generó el médico NO lo revoca el paciente por esa puerta, y al
  // revés tampoco: cada uno corta lo suyo. Si no, hay una discusión sobre
  // quién le sacó el acceso a quién.
  const cruzado = await pedir(`/mi/${llave2}/compartidos/${guardado._id}/revocar`, null, "POST", {});
  verificar("cada uno corta lo suyo: el paciente no toca lo del médico", cruzado.estado === 404);

  // Un enlace vencido se comporta igual que uno revocado.
  const vencido = await ResumenCompartido.create({
    pacienteId: paciente._id, medicoPhone: "70000001", generadoPor: "medico",
    alcance: "resumen", secciones: ["identidad"], contenido: { identidad: { nombre: "X" } },
    token: "v".repeat(30), tokenExpira: new Date(Date.now() - 86400000),
  });
  const abrirVencido = await pedir(`/r/${vencido.token}/datos`, null);
  verificar("un enlace vencido tampoco abre", abrirVencido.estado === 410);

  // ═══ 6. IMPORTAR A MI KARDEX ═════════════════════════════════════════════
  console.log("\n── 6. El colega se la trae a su kardex ──");

  const vivo = await pedir(`/medico/pacientes/${paciente._id}/resumenes`, tk1, "POST", { alcance: "resumen" });
  const tokenVivo = String(vivo.cuerpo.enlace).split("/r/")[1];

  const importado = await pedir(`/r/${tokenVivo}/importar`, tk2, "POST", {});
  verificar("otro médico lo importa a su propio kardex", importado.estado === 200 && Boolean(importado.cuerpo.pacienteId));
  const nueva = await Paciente.findById(importado.cuerpo.pacienteId).lean();
  verificar("  ...y la ficha queda en SU consultorio, no en el de origen", nueva.medicoPhone === "70000002");
  verificar("  ...con el nombre y la fecha de nacimiento", nueva.nombre === "Carla Mendoza" && Boolean(nueva.fechaNacimiento));
  // Sin código, la Caja DICOM no le puede archivar los estudios solos
  // (auditoría del comité de QA, octubre de 2026, M11).
  verificar("  ...y con su código de paciente, como un alta normal", /^P-\d{4}$/.test(nueva.codigo || ""));
  verificar("  ...y las alergias, que es el dato que hace falta antes de recetar",
    nueva.antecedentesPersonales.some(a => /Penicilina/.test(a)));
  // Las consultas de otro consultorio no son las de este: copiadas adentro
  // quedan indistinguibles de las propias, con su firma encima.
  verificar("pero NO se copian las consultas del otro médico",
    await ConsultaMedica.countDocuments({ medicoPhone: "70000002" }) === 0);
  verificar("  ...queda el enlace al resumen en las notas, que es el contexto",
    /\/r\//.test(nueva.notas || ""));

  // Tocar el botón dos veces va a pasar. No puede dejar dos fichas.
  const otraVez = await pedir(`/r/${tokenVivo}/importar`, tk2, "POST", {});
  verificar("importar dos veces no crea una ficha duplicada",
    otraVez.estado === 200 && otraVez.cuerpo.yaExistia === true &&
    String(otraVez.cuerpo.pacienteId) === String(importado.cuerpo.pacienteId));
  verificar("  ...y sigue habiendo una sola",
    await Paciente.countDocuments({ medicoPhone: "70000002", nombre: "Carla Mendoza" }) === 1);

  // Su propio resumen no se importa: le crearía un duplicado del paciente
  // que ya tiene abierto.
  const aSiMismo = await pedir(`/r/${tokenVivo}/importar`, tk1, "POST", {});
  verificar("un médico no importa su propio resumen", aSiMismo.estado === 409);

  // Y sin sesión no se importa nada: eso sí necesita cuenta.
  const sinCuenta = await pedir(`/r/${tokenVivo}/importar`, null, "POST", {});
  verificar("importar sí pide cuenta (leer no, importar sí)",
    sinCuenta.estado === 401 || sinCuenta.estado === 403);

  const traido = await ResumenCompartido.findOne({ token: tokenVivo }).lean();
  verificar("queda registrado quién lo importó, que es la única medida de si esto sirve",
    traido.importadoPor.length === 1 && traido.importadoPor[0] === "70000002");

  // El interés del que NO tiene cuenta: la mitad de arriba del embudo.
  await pedir(`/r/${tokenVivo}/interes`, null, "POST", {});
  verificar("y se cuenta el interés de quien todavía no tiene cuenta",
    (await ResumenCompartido.findOne({ token: tokenVivo }).lean()).interesProfesional === 1);

  // ═══ 7. ENLACES QUE NO EXISTEN ═══════════════════════════════════════════
  console.log("\n── 7. Enlaces inventados ──");
  verificar("un token corto no abre nada", (await pedir("/r/abc/datos", null)).estado === 404);
  verificar("uno largo pero inventado tampoco", (await pedir(`/r/${"z".repeat(32)}/datos`, null)).estado === 404);
  verificar("una llave inventada tampoco", (await pedir(`/mi/${"z".repeat(32)}/datos`, null)).estado === 404);
  verificar("y el paciente ajeno sigue siendo ajeno",
    (await pedir(`/medico/pacientes/${ajeno._id}/resumenes`, tk1)).estado === 404);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
