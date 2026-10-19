// Symphomed — El audio de una consulta no se pierde si el servidor se
// reinicia mientras se transcribe (services/audioPendiente.js y
// retomarConsultas en routes/consultaMedica.js).
//
// El teléfono borra su copia apenas recibe el 202. Antes, desde ahí el audio
// vivía solo en la memoria del proceso: un despliegue a mitad de una
// transcripción perdía la consulta (informe de QA del 9 de octubre de 2026).
// Lo que se prueba:
//   1. Subir: el audio queda en disco antes del 202, y se borra cuando la
//      transcripción termina, bien o mal. Si no se puede guardar → 503, y el
//      teléfono conserva el suyo.
//   2. Al arrancar (en el mismo proceso, con AssemblyAI de mentira): lo que
//      quedó a medias se retoma —la transcripción y la nota—, lo que no tiene
//      audio queda en error con el motivo, lo viejo no avisa, un audio que se
//      corta siempre no se reintenta para siempre, lo sobrante se borra y lo
//      que llegó después del arranque no se toca. Una nota en vivo que se
//      estaba verificando se verifica de nuevo, en vez de quedar sin poder
//      confirmarse (A6).
//   3. De verdad: el servidor entero, matado a mitad de una transcripción y
//      vuelto a levantar.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const DIR_AUDIO = fs.mkdtempSync(path.join(os.tmpdir(), "audio-pendiente-"));
process.env.DIR_AUDIO_PENDIENTE = DIR_AUDIO;
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const PUERTO = 3975;

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(50); }
  return false;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    if (cuerpo) { headers["content-type"] = "audio/ogg"; headers["content-length"] = cuerpo.length; }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}
const archivo = (id) => path.join(DIR_AUDIO, `${id}.audio`);
const hayAudio = (id) => fs.existsSync(archivo(id));
// Que nada cuelgue la prueba: lo que no llega a tiempo cuenta como que no llegó.
const aTiempo = (promesa, ms = 20000) => Promise.race([promesa, esperar(ms).then(() => null)]);

// ─── Lo de afuera, de mentira ──────────────────────────────────────────────
// AssemblyAI: cada transcripción espera a que la prueba diga cómo termina, y
// anota qué audio recibió.
const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));
const transcripciones = [];
assemblyai.transcribirConsultaMedica = (buf) => new Promise((resolve, reject) => transcripciones.push({ audio: buf.toString(), resolve, reject }));
// La transcripción número «vez» de ese audio, cuando llegue (o null).
async function transcripcionDe(audio, vez = 1, ms = 8000) {
  await hasta(() => transcripciones.filter(t => t.audio === audio).length >= vez, ms);
  return transcripciones.filter(t => t.audio === audio)[vez - 1] || null;
}
const terminar = (t, texto) => t.resolve({ transcripcionCompleta: texto, segmentos: [{ hablante: "A", texto }], duracionSegundos: 300 });
// La IA de la nota.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const alaIA = [];
axios.post = async (_url, cuerpo) => {
  alaIA.push(JSON.stringify(cuerpo.messages));
  const nota = { motivoConsulta: "Control", diagnostico: "Sano", plan: "Seguir igual", medicamentosRecetados: [] };
  return { data: { choices: [{ message: { content: JSON.stringify(nota) } }] } };
};
// Los avisos al teléfono del médico.
const push = require(path.join(RAIZ, "services", "push"));
const avisos = [];
push.notificarMedico = async (medicoPhone, aviso) => { avisos.push({ medicoPhone, ...aviso }); };

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "audio_reinicio";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const audioPendiente = require(path.join(RAIZ, "services", "audioPendiente"));
  await mongoose.connection.dropDatabase();
  await M.MovimientoSaldo.syncIndexes();

  const MED = "70097001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Reinicio", passwordHash: "x", activo: true, tipoEspecialidad: "medicina_general" });
  const tk = generarToken(MED, "medico", 36e5);
  const paciente = await M.Paciente.create({ medicoPhone: MED, nombre: "Paciente del reinicio" });

  const express = require("express");
  const app = express();
  const rutas = require(path.join(RAIZ, "routes", "consultaMedica"));
  rutas(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const subir = (audio) => pedir(puerto, "POST", `/medico/consultas?pacienteId=${paciente._id}`, tk, Buffer.from(audio));
  const leer = (id) => M.ConsultaMedica.findById(id).lean();

  console.log("── 1. Subir: el audio, en disco antes de contestar ──");
  let r = await subir("AUDIO-UNO");
  const id1 = r.cuerpo?.consulta?._id;
  verificar("subir → 202, y el audio ya está en disco, entero, con el id de la consulta",
    r.estado === 202 && hayAudio(id1) && fs.readFileSync(archivo(id1)).toString() === "AUDIO-UNO");
  verificar("  ...solo lo puede leer el servidor (no queda a la vista de otros usuarios de la máquina)", hayAudio(id1) && (fs.statSync(archivo(id1)).mode & 0o077) === 0);
  const t1 = await transcripcionDe("AUDIO-UNO");
  if (t1) terminar(t1, "Texto de la consulta uno");
  await hasta(async () => (await leer(id1)).notaClinicaEstado === "completado");
  let c = await leer(id1);
  verificar("al terminar de transcribir: consulta completa, con su nota, y el audio se borra",
    c.estado === "completado" && c.notaClinicaEstado === "completado" && !hayAudio(id1));
  r = await subir("AUDIO-DOS");
  const id2 = r.cuerpo.consulta._id;
  // AssemblyAI recibió el audio y no pudo con él: eso no tiene arreglo.
  (await transcripcionDe("AUDIO-DOS"))?.reject(Object.assign(new Error("Audio file could not be decoded"), { definitiva: true }));
  await hasta(async () => (await leer(id2)).estado === "error");
  verificar("si el audio mismo no sirve: en error con el motivo, se le avisa al médico, el audio se borra y no se reintenta",
    /could not be decoded/.test((await leer(id2)).error || "") && avisos.some(a => /No se pudo transcribir/.test(a.titulo)) && !hayAudio(id2)
    && !(await transcripcionDe("AUDIO-DOS", 2, 600)));
  const guardar = audioPendiente.guardar;
  audioPendiente.guardar = async () => { throw new Error("no hay lugar en el disco"); };
  const antes = await M.ConsultaMedica.countDocuments();
  r = await subir("AUDIO-SIN-LUGAR");
  audioPendiente.guardar = guardar;
  verificar("si el audio no se puede guardar → 503 («la grabación sigue en el teléfono»), y no queda una consulta sin audio",
    r.estado === 503 && /teléfono/.test(r.cuerpo?.error || "") && (await M.ConsultaMedica.countDocuments()) === antes && !(await transcripcionDe("AUDIO-SIN-LUGAR", 1, 500)));

  console.log("\n── 1b. Una falla pasajera no pierde la consulta (revisión integral, S04) ──");
  Object.assign(rutas.AJUSTES_AUDIO, { ESPERAS_MS: [150, 150], GUARDAR_ESPERAS_MS: [50, 50], RETENER_MS: 60000 });
  const pasajera = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

  // Se corta la red con AssemblyAI una vez, y después anda.
  r = await subir("AUDIO-RED");
  const idRed = r.cuerpo.consulta._id;
  (await transcripcionDe("AUDIO-RED"))?.reject(pasajera());
  await hasta(async () => (await leer(idRed)).intentosTranscripcion === 1);
  c = await leer(idRed);
  verificar("un corte de red → sigue «procesando», con el audio en disco y el intento contado",
    c.estado === "procesando" && hayAudio(idRed) && c.intentosTranscripcion === 1);
  const otraVez = await transcripcionDe("AUDIO-RED", 2);
  verificar("  ...al rato se reintenta sola, con el audio del disco", !!otraVez);
  if (otraVez) terminar(otraVez, "Texto después del corte");
  await hasta(async () => (await leer(idRed)).estado === "completado");
  verificar("  ...termina completa, y recién ahí se borra el audio", (await leer(idRed)).estado === "completado" && !hayAudio(idRed));

  // La transcripción salió, pero la base no contestó justo al guardarla.
  const updateOneOriginal = M.ConsultaMedica.updateOne;
  let fallasDeLaBase = 1;
  M.ConsultaMedica.updateOne = function (filtro, cambio, ...resto) {
    if (fallasDeLaBase > 0 && cambio?.$set?.estado === "completado") { fallasDeLaBase--; return Promise.reject(new Error("la base no contestó")); }
    return updateOneOriginal.call(this, filtro, cambio, ...resto);
  };
  r = await subir("AUDIO-BASE");
  const idBase = r.cuerpo.consulta._id;
  const tBase = await transcripcionDe("AUDIO-BASE");
  if (tBase) terminar(tBase, "Texto que costó guardar");
  await hasta(async () => (await leer(idBase)).estado === "completado");
  M.ConsultaMedica.updateOne = updateOneOriginal;
  c = await leer(idBase);
  verificar("la base falla al guardar una transcripción ya hecha → se insiste y se guarda, sin pagarla dos veces",
    c.transcripcionCompleta === "Texto que costó guardar" && !hayAudio(idBase) && transcripciones.filter(t => t.audio === "AUDIO-BASE").length === 1);

  // Falla una y otra vez: queda en error, con el audio guardado para reintentar a mano.
  r = await subir("AUDIO-SIEMPRE-FALLA");
  const idTerca = r.cuerpo.consulta._id;
  for (let vez = 1; vez <= 3; vez++) (await transcripcionDe("AUDIO-SIEMPRE-FALLA", vez))?.reject(pasajera());
  await hasta(async () => (await leer(idTerca)).estado === "error");
  c = await leer(idTerca);
  verificar("tres fallas pasajeras seguidas → error «después de varios intentos», y el audio queda guardado unos días",
    /varios intentos/.test(c.error || "") && hayAudio(idTerca) && new Date(c.audioRetenidoHasta) > new Date());
  verificar("  ...y no se reintenta sola una cuarta vez", !(await transcripcionDe("AUDIO-SIEMPRE-FALLA", 4, 600)));
  const reintentar = (id) => pedir(puerto, "POST", `/medico/consultas/${id}/transcripcion/reintentar`, tk);
  const dos = await Promise.all([reintentar(idTerca), reintentar(idTerca)]);
  verificar("«Volver a transcribir» → 202; tocado dos veces a la vez, el segundo → 409", dos.map(x => x.estado).sort().join() === "202,409");
  const aMano = await transcripcionDe("AUDIO-SIEMPRE-FALLA", 4);
  verificar("  ...se transcribe una vez más, una sola, con el audio guardado", !!aMano && !(await transcripcionDe("AUDIO-SIEMPRE-FALLA", 5, 300)));
  if (aMano) terminar(aMano, "Texto que salió a mano");
  await hasta(async () => (await leer(idTerca)).estado === "completado");
  c = await leer(idTerca);
  verificar("  ...queda completa, el audio se borra y ya no figura guardado",
    c.transcripcionCompleta === "Texto que salió a mano" && !hayAudio(idTerca) && !c.audioRetenidoHasta);
  verificar("reintentar una consulta que no tiene audio guardado → 409", (await reintentar(idTerca)).estado === 409);

  // Los guardados vencen: se borran solos.
  const vencida = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "error", audioRetenidoHasta: new Date(Date.now() - 1000) });
  await audioPendiente.guardar(vencida._id, Buffer.from("AUDIO-VENCIDO"));
  const vigente = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "error", audioRetenidoHasta: new Date(Date.now() + 86400000) });
  await audioPendiente.guardar(vigente._id, Buffer.from("AUDIO-VIGENTE"));
  // La limpieza pasa cada 12 horas: hasta entonces el archivo sigue ahí.
  verificar("con la retención vencida → 409, aunque el audio siga en el disco hasta la limpieza",
    (await reintentar(vencida._id)).estado === 409 && (await leer(vencida._id)).estado === "error");
  const limpiados = await rutas.limpiarAudiosRetenidos();
  verificar("la limpieza borra el audio guardado que venció, y deja el que sigue vigente",
    limpiados === 1 && !hayAudio(vencida._id) && !(await leer(vencida._id)).audioRetenidoHasta && hayAudio(vigente._id));
  Object.assign(rutas.AJUSTES_AUDIO, { ESPERAS_MS: [], GUARDAR_ESPERAS_MS: [], RETENER_MS: 60000 });

  console.log("\n── 2. Al arrancar, lo que quedó a medias ──");
  // A. Una subida a mitad de transcribir cuando «se cayó» el proceso: su
  // transcripción no termina nunca (el proceso viejo ya no existe).
  r = await subir("AUDIO-CORTADO");
  const idCortada = r.cuerpo.consulta._id;
  await transcripcionDe("AUDIO-CORTADO");
  // B. Una de antes de este cambio: «procesando», sin audio en disco.
  const sinAudio = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "procesando" });
  const vieja = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "procesando" });
  await M.ConsultaMedica.collection.updateOne({ _id: vieja._id }, { $set: { createdAt: new Date(Date.now() - 3 * 86400000) } });
  // C. Un audio que ya cortó el servidor dos veces.
  const terca = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "procesando", reintentosAudio: 2 });
  await audioPendiente.guardar(terca._id, Buffer.from("AUDIO-QUE-TIRA-EL-SERVIDOR"));
  // D. Notas que se estaban escribiendo: de la transcripción, del texto en
  // vivo, y una de hace días.
  const notaAudio = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "completado", notaFuente: "audio",
    transcripcionCompleta: "NOTA_CORTADA_AUDIO el paciente viene a control", notaClinicaEstado: "pendiente" });
  const notaVivo = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "completado", notaFuente: "vivo",
    transcripcionEnVivo: "NOTA_CORTADA_VIVO el paciente viene a control", transcripcionCompleta: "el paciente viene a control",
    notaClinicaEstado: "pendiente", verificacion: { estado: "pendiente" } });
  const notaVieja = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "completado", notaFuente: "audio",
    transcripcionCompleta: "NOTA_VIEJA", notaClinicaEstado: "pendiente" });
  await M.ConsultaMedica.collection.updateOne({ _id: notaVieja._id }, { $set: { createdAt: new Date(Date.now() - 3 * 86400000) } });
  // G. Notas en vivo que esperaban la verificación con la transcripción
  // completa: una a mitad de verificar, otra que se cortó justo antes de
  // empezar (y que después no puede guardar el resultado), y una de hace días.
  const enVivo = (marca, estado) => M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "completado", notaFuente: "vivo",
    transcripcionEnVivo: "el paciente viene a control", transcripcionCompleta: `${marca} el paciente viene a control`,
    notaClinicaEstado: "completado", notaClinica: { motivoConsulta: "Control", diagnostico: "Sano" }, verificacion: { estado } });
  const verificando = await enVivo("VERIF_CORTADA", "verificando");
  const sinVerificar = await enVivo("VERIF_SIN_EMPEZAR", "pendiente");
  const verificandoVieja = await enVivo("VERIF_VIEJA", "verificando");
  await M.ConsultaMedica.collection.updateOne({ _id: verificandoVieja._id }, { $set: { createdAt: new Date(Date.now() - 3 * 86400000) } });
  // E. Sobras: un audio sin consulta en curso, y uno a medio escribir. El de
  // una consulta que falló y se guarda para reintentar a mano no es sobra.
  const retenida = await M.ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, estado: "error", audioRetenidoHasta: new Date(Date.now() + 86400000) });
  await audioPendiente.guardar(retenida._id, Buffer.from("AUDIO-RETENIDO"));
  const huerfano = new mongoose.Types.ObjectId();
  await audioPendiente.guardar(huerfano, Buffer.from("SOBRA"));
  fs.writeFileSync(archivo(new mongoose.Types.ObjectId()) + ".parcial", "MEDIO");
  await esperar(20);
  const arranque = new Date();
  await esperar(20);
  // F. Lo que llega después del arranque es del proceso nuevo.
  r = await subir("AUDIO-NUEVO");
  const idNueva = r.cuerpo.consulta._id;
  const nueva = await transcripcionDe("AUDIO-NUEVO");
  const avisosAntes = avisos.length;
  const iaAntes = alaIA.length;

  // El resultado de la verificación de «sinVerificar» no se puede guardar.
  const updateOneDeLaBase = M.ConsultaMedica.updateOne;
  M.ConsultaMedica.updateOne = function (filtro, cambio, ...resto) {
    if (String(filtro?._id) === String(sinVerificar._id) && cambio?.$set?.["tiempos.verificacionMs"] !== undefined) {
      return Promise.reject(new Error("la base no contestó"));
    }
    return updateOneDeLaBase.call(this, filtro, cambio, ...resto);
  };
  const retomado = rutas.retomarConsultas(arranque);
  const retomada = await transcripcionDe("AUDIO-CORTADO", 2);
  verificar("A. la consulta cortada se vuelve a transcribir, con el audio guardado en disco", !!retomada);
  if (retomada) terminar(retomada, "Texto de la consulta retomada");
  const resumen = (await aTiempo(retomado)) || {};
  M.ConsultaMedica.updateOne = updateOneDeLaBase;
  c = await leer(idCortada);
  verificar("  ...queda completa, con su nota, el audio borrado y un solo cobro",
    c.estado === "completado" && c.transcripcionCompleta === "Texto de la consulta retomada" && c.notaClinicaEstado === "completado"
    && !hayAudio(idCortada) && (await M.MovimientoSaldo.countDocuments({ consultaId: idCortada })) === 1);
  verificar(`  ...el resumen dice qué retomó (${JSON.stringify(resumen)})`,
    resumen.transcripciones === 1 && resumen.sinAudio === 2 && resumen.notas === 2 && resumen.verificaciones === 2 && resumen.sobras === 1);
  c = await leer(sinAudio._id);
  verificar("B. una «procesando» sin audio → en error, con el motivo, en vez de «procesando» para siempre",
    c.estado === "error" && /reinició/.test(c.error) && avisos.slice(avisosAntes).some(a => a.url.includes(String(sinAudio._id))));
  verificar("  ...la de hace días también, pero sin avisarle al médico", (await leer(vieja._id)).estado === "error" && !avisos.some(a => a.url.includes(String(vieja._id))));
  c = await leer(terca._id);
  verificar("C. un audio que ya cortó el servidor dos veces no se intenta otra vez: error, y el audio se borra",
    c.estado === "error" && /varias veces/.test(c.error) && !hayAudio(terca._id) && !transcripciones.some(t => t.audio === "AUDIO-QUE-TIRA-EL-SERVIDOR"));
  c = await leer(notaAudio._id);
  verificar("D. la nota que se estaba escribiendo se escribe de nuevo, de la transcripción",
    c.notaClinicaEstado === "completado" && c.notaClinica?.diagnostico === "Sano" && alaIA.slice(iaAntes).some(x => x.includes("NOTA_CORTADA_AUDIO")));
  c = await leer(notaVivo._id);
  verificar("  ...la del texto en vivo, del texto en vivo, y después se verifica con la transcripción",
    c.notaClinicaEstado === "completado" && alaIA.slice(iaAntes).some(x => x.includes("NOTA_CORTADA_VIVO")) && ["ok", "diferencias"].includes(c.verificacion?.estado));
  c = await leer(notaVieja._id);
  verificar("  ...la de hace días no se escribe sola: queda en error, para volver a generarla",
    c.notaClinicaEstado === "error" && /Volvé a generarla/.test(c.notaClinicaError) && !alaIA.some(x => x.includes("NOTA_VIEJA")));
  c = await leer(verificando._id);
  verificar(`G. la nota en vivo que se estaba verificando se verifica de nuevo (${c.verificacion?.estado})`,
    ["ok", "diferencias"].includes(c.verificacion?.estado) && alaIA.slice(iaAntes).some(x => x.includes("VERIF_CORTADA")));
  c = await leer(sinVerificar._id);
  verificar(`  ...la que se cortó justo antes también, y si el resultado no se puede guardar queda en error, no «verificando» (${c.verificacion?.estado})`,
    c.verificacion?.estado === "error" && alaIA.slice(iaAntes).some(x => x.includes("VERIF_SIN_EMPEZAR")));
  c = await leer(verificandoVieja._id);
  verificar(`  ...la de hace días no se verifica sola: queda en error, y se confirma con ese aviso (${c.verificacion?.estado})`,
    c.verificacion?.estado === "error" && !alaIA.some(x => x.includes("VERIF_VIEJA")));
  verificar("  ...y ya se pueden confirmar (antes, 409 «se está verificando» para siempre)",
    (await pedir(puerto, "POST", `/medico/consultas/${verificando._id}/confirmar`, tk)).estado === 200
    && (await pedir(puerto, "POST", `/medico/consultas/${verificandoVieja._id}/confirmar`, tk)).estado === 200);
  verificar("E. el audio sobrante y el que quedó a medio escribir se borran", !hayAudio(huerfano) && !fs.readdirSync(DIR_AUDIO).some(n => n.endsWith(".parcial")));
  verificar("  ...pero el que se guarda para reintentar a mano, no", hayAudio(retenida._id));
  c = await leer(idNueva);
  verificar("F. lo que llegó después del arranque no se toca: sigue transcribiéndose, con su audio, una sola vez",
    c.estado === "procesando" && hayAudio(idNueva) && transcripciones.filter(t => t.audio === "AUDIO-NUEVO").length === 1);
  if (nueva) terminar(nueva, "Texto de la nueva");
  await hasta(async () => (await leer(idNueva)).notaClinicaEstado === "completado");
  verificar("  ...y termina como cualquiera", (await leer(idNueva)).estado === "completado" && !hayAudio(idNueva));
  r = (await aTiempo(rutas.retomarConsultas(new Date()))) || {};
  verificar("arrancar otra vez sin nada pendiente no hace nada", r.transcripciones === 0 && r.sinAudio === 0 && r.notas === 0 && r.verificaciones === 0 && r.sobras === 0);

  console.log("\n── El pase para la vista previa en vivo (segunda revisión de QA, E06) ──");
  // Cada pase abre una conexión con AssemblyAI, que se cobra mientras está
  // abierta (services/vistaPrevia.js); la pantalla pide uno por grabación.
  const permisos = [];
  for (let i = 0; i < 21; i++) permisos.push((await pedir(puerto, "GET", "/medico/transcripcion-token", tk)).estado);
  verificar("20 pases en diez minutos, sí; el 21 → 429 (la grabación sigue, sin vista previa)",
    permisos.slice(0, 20).every(x => x === 200) && permisos[20] === 429);
  await M.Medico.create({ phone: "70097002", nombre: "Dr. Otro", passwordHash: "x", activo: true });
  verificar("  ...y es por cuenta: otro médico sigue pidiendo el suyo",
    (await pedir(puerto, "GET", "/medico/transcripcion-token", generarToken("70097002", "medico", 36e5))).estado === 200);
  servidor.close();

  console.log("\n── 3. De verdad: el servidor, matado a mitad de una transcripción ──");
  // El servidor entero (index.js), con AssemblyAI y la IA de mentira desde
  // un archivo que se carga antes: colgada la primera vez, bien la segunda.
  const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stub-transcripcion-")), "transcripcion_falsa.js");
  fs.writeFileSync(stub, `
const path = require("path");
const assemblyai = require(path.join(${JSON.stringify(RAIZ)}, "services", "assemblyai"));
assemblyai.transcribirConsultaMedica = (buf) => process.env.MODO_TRANSCRIPCION === "colgada"
  ? new Promise(() => {})
  : Promise.resolve({ transcripcionCompleta: "Retomada de " + buf.toString(), segmentos: [], duracionSegundos: 60 });
const axios = require(path.join(${JSON.stringify(RAIZ)}, "node_modules", "axios"));
axios.post = async () => ({ data: { choices: [{ message: { content: JSON.stringify({ motivoConsulta: "Control", diagnostico: "Sano", medicamentosRecetados: [] }) } }] } });
`);
  const levantar = (modo) => {
    const env = { ...process.env, MONGODB_URI: uri, PORT: String(PUERTO), MODO_TRANSCRIPCION: modo, DIR_AUDIO_PENDIENTE: DIR_AUDIO };
    return spawn(process.execPath, ["-r", stub, path.join(RAIZ, "index.js")], { cwd: RAIZ, env, stdio: "ignore" });
  };
  const arriba = () => hasta(async () => (await pedir(PUERTO, "GET", "/health")).estado === 200, 40000);
  const matar = async (proceso) => {
    if (proceso.exitCode !== null || proceso.signalCode !== null) return;
    const salio = new Promise((res) => proceso.once("exit", res));
    proceso.kill("SIGKILL");
    await aTiempo(salio, 10000);
  };
  let srv = levantar("colgada");
  verificar("el servidor arranca", await arriba());
  r = await pedir(PUERTO, "POST", `/medico/consultas?pacienteId=${paciente._id}`, tk, Buffer.from("AUDIO-DEL-DESPLIEGUE"));
  const idReal = r.cuerpo?.consulta?._id;
  verificar("sube la consulta → 202, con el audio en disco", r.estado === 202 && hayAudio(idReal));
  await matar(srv);
  verificar("  ...se mata el servidor a mitad de la transcripción: la consulta queda «procesando»", (await leer(idReal))?.estado === "procesando");
  srv = levantar("bien");
  await arriba();
  const listo = await hasta(async () => (await leer(idReal)).notaClinicaEstado === "completado", 30000);
  c = await leer(idReal);
  verificar("al volver a levantarlo, la retoma sola: transcripta con el mismo audio, con su nota, y el audio borrado",
    listo && c?.estado === "completado" && c.transcripcionCompleta === "Retomada de AUDIO-DEL-DESPLIEGUE" && !hayAudio(idReal));
  await matar(srv);

  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(DIR_AUDIO, { recursive: true, force: true });
  fs.rmSync(path.dirname(stub), { recursive: true, force: true });
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
