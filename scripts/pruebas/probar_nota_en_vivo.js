// Symphomed — La nota en vivo (services/notaEnVivo.js).
//
// La nota se escribe con el texto de la vista previa y la transcripción
// completa la verifica después. Lo que se prueba, con AssemblyAI y la IA de
// mentira para decidir en qué orden termina cada cosa:
//   · la comparación de medicamentos (dosis, faltantes, nombres parecidos);
//   · el borrador mientras se graba, sin guardar nada, y reusado al subir;
//   · que la nota sale del texto en vivo SIN esperar la transcripción, y que
//     no se puede confirmar hasta que la verificación termina;
//   · que una diferencia se MUESTRA y la nota no se cambia sola;
//   · los caminos raros: la transcripción termina primero, la IA falla, la
//     transcripción falla, las dos llegan a la vez;
//   · que sin texto en vivo todo sigue como antes.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await condicion()) return true; await esperar(40); }
  return false;
}

function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve, reject) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    let datos = cuerpo;
    if (cuerpo && !Buffer.isBuffer(cuerpo)) { datos = JSON.stringify(cuerpo); headers["content-type"] = "application/json"; }
    else if (cuerpo) headers["content-type"] = "audio/ogg";
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(texto); } catch {} resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", reject);
    if (datos) req.write(datos);
    req.end();
  });
}

const { compararMedicamentos } = require(path.join(RAIZ, "services", "notaEnVivo"));
const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));

// ─── La IA de mentira ─────────────────────────────────────────────────────
// Contesta según una palabra marcadora del texto. Cuenta cuántas veces la
// llamaron: es lo que dice si un borrador se reusó o se pidió de nuevo.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
let llamadasIA = 0;
const NOTA = (meds) => ({ motivoConsulta: "Dolor de garganta", diagnostico: "Faringitis", plan: "Reposo", medicamentosRecetados: meds });
axios.post = async (url, cuerpo) => {
  const texto = JSON.stringify(cuerpo.messages);
  // Solo las notas: el resumen clínico y el hilo, que corren después, usan
  // la misma IA pero no reciben la transcripción.
  if (texto.includes("tengo fiebre")) llamadasIA++;
  if (texto.includes("FALLA_IA")) throw new Error("la IA no contestó");
  let nota;
  // El caso real: se dijo paracetamol y la IA puso ibuprofeno. Las dos veces
  // (en vivo y con el audio completo), para probar que no alcanza con que dos
  // notas de IA coincidan.
  if (texto.includes("IBU_INVENTADO")) nota = NOTA([{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 horas" }, { nombre: "Ibuprofeno", dosis: "400 mg", frecuencia: "cada 8 horas" }]);
  else if (texto.includes("DOSIS_AUDIO")) nota = NOTA([{ nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "cada 8 horas" }]);
  else nota = NOTA([{ nombre: "Amoxicilina", dosis: "50 mg", frecuencia: "cada 8 horas" }]);
  return { data: { choices: [{ message: { content: JSON.stringify(nota) } }] } };
};

// ─── AssemblyAI de mentira: cada transcripción termina cuando la prueba dice
let pendientes = [];
assemblyai.transcribirConsultaMedica = () => new Promise((resolve, reject) => pendientes.push({ resolve, reject }));
assemblyai.crearTokenStreaming = async () => "token-de-prueba";
async function terminarTranscripcion(texto, { falla = false } = {}) {
  await hasta(() => pendientes.length > 0);
  const p = pendientes.shift();
  if (falla) p.reject(new Error("AssemblyAI falló"));
  else p.resolve({ transcripcionCompleta: texto, segmentos: [{ hablante: "A", texto }], duracionSegundos: 600 });
}

const TEXTO_VIVO = "Buenos días doctor me duele la garganta hace tres días y tengo fiebre le voy a dar amoxicilina cincuenta cada ocho horas";
const TEXTO_AUDIO = "DOSIS_AUDIO Buenos días doctor me duele la garganta hace tres días y tengo fiebre le voy a dar amoxicilina quinientos cada ocho horas";

(async () => {
  console.log("── 1. Comparar los medicamentos de dos notas ──");
  const m = (nombre, dosis = "", frecuencia = "") => ({ nombre, dosis, frecuencia });
  const cmp = (a, b) => compararMedicamentos({ medicamentosRecetados: a }, { medicamentosRecetados: b });
  verificar("iguales → sin diferencias", cmp([m("Amoxicilina", "500 mg", "cada 8 horas")], [m("amoxicilina", "500mg", "c/8 horas")]).length === 0);
  const dosis = cmp([m("Amoxicilina", "50 mg", "cada 8 horas")], [m("Amoxicilina", "500 mg", "cada 8 horas")]);
  verificar("50 mg en la nota, 500 mg en el audio → «dosis», con lo que dice el audio",
    dosis.length === 1 && dosis[0].tipo === "dosis" && dosis[0].indice === 0 && dosis[0].medicamento.dosis === "500 mg");
  verificar("cada 8 o cada 12 horas también es una diferencia", cmp([m("Ibuprofeno", "400 mg", "cada 8 horas")], [m("Ibuprofeno", "400 mg", "cada 12 horas")])[0]?.tipo === "dosis");
  verificar("el audio menciona uno que la nota no tiene → «falta»", cmp([], [m("Paracetamol", "1 g")])[0]?.tipo === "falta");
  verificar("la nota tiene uno que el audio no menciona → «noMencionado»", cmp([m("Ibuprofeno")], [])[0]?.tipo === "noMencionado");
  verificar("el mismo medicamento escuchado distinto («amoxilina») no es otro", cmp([m("Amoxilina", "500 mg")], [m("Amoxicilina", "500 mg")]).length === 0);
  verificar("la sal no lo hace otro (Losartán potásico / Losartán)", cmp([m("Losartán potásico", "50 mg")], [m("Losartan", "50 mg")]).length === 0);
  verificar("sin dosis en un lado no hay nada que comparar: no se marca", cmp([m("Omeprazol")], [m("Omeprazol", "20 mg")]).length === 0);
  verificar("dos distintos con la misma raíz corta no se confunden (Metformina / Metoprolol)",
    cmp([m("Metformina", "850 mg")], [m("Metoprolol", "50 mg")]).length === 2);

  let MongoMemoryServer;
  for (const mod of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(mod)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "nota_en_vivo_prueba";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Paciente, ConsultaMedica, MovimientoSaldo } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const MED = "70040001";
  await Medico.create({ phone: MED, nombre: "Dra. En Vivo", passwordHash: await hashPassword("Prueba123."), tipoEspecialidad: "medicina_general" });
  await Medico.create({ phone: "70040002", nombre: "Dr. Ajeno", passwordHash: await hashPassword("Prueba123.") });
  const tk = generarToken(MED, "medico", 36e5);
  const tkAjeno = generarToken("70040002", "medico", 36e5);
  const paciente = await Paciente.create({ medicoPhone: MED, nombre: "Paciente en vivo" });

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;
  const leer = (id) => ConsultaMedica.findById(id).lean();
  const subir = async () => (await pedir(puerto, "POST", `/medico/consultas?pacienteId=${paciente._id}`, tk, Buffer.from("audio"))).cuerpo.consulta._id;

  console.log("\n── 2. El borrador, mientras se graba ──");
  let r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", tk, { pacienteId: String(paciente._id), texto: "hola doctor" });
  verificar("con dos palabras todavía no hay nota (y no se le pregunta a la IA)", r.estado === 200 && r.cuerpo.nota === null && llamadasIA === 0);
  r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", tk, { pacienteId: String(paciente._id), texto: TEXTO_VIVO });
  verificar("con la consulta empezada → vuelve la nota", r.estado === 200 && r.cuerpo.nota?.diagnostico === "Faringitis" && llamadasIA === 1);
  verificar("  ...y no se guardó nada: todavía no hay consulta", (await ConsultaMedica.countDocuments({})) === 0);
  r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", tk, { pacienteId: String(paciente._id), texto: TEXTO_VIVO });
  verificar("el mismo texto otra vez → se reusa, sin otra llamada a la IA", r.cuerpo.nota?.diagnostico === "Faringitis" && llamadasIA === 1);
  r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", tkAjeno, { pacienteId: String(paciente._id), texto: TEXTO_VIVO });
  verificar("el paciente de otro médico → 404", r.estado === 404);
  r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", null, { pacienteId: String(paciente._id), texto: TEXTO_VIVO });
  verificar("sin sesión → 401", r.estado === 401);

  console.log("\n── 3. Al terminar: la nota sale del texto en vivo, sin esperar a AssemblyAI ──");
  const id1 = await subir();
  r = await pedir(puerto, "POST", `/medico/consultas/${id1}/texto-en-vivo`, tk, { texto: TEXTO_VIVO });
  verificar("mandar el texto en vivo → 202, se usa", r.estado === 202 && r.cuerpo.usada === true);
  await hasta(async () => (await leer(id1)).notaClinicaEstado === "completado");
  let c = await leer(id1);
  verificar("la nota está, y la transcripción completa TODAVÍA no terminó", c.notaClinicaEstado === "completado" && c.estado === "procesando" && c.notaFuente === "vivo");
  verificar("  ...reusó el borrador de la pantalla de grabar (ninguna llamada nueva a la IA)", llamadasIA === 1);
  verificar("  ...y queda pendiente de verificar", c.verificacion?.estado === "pendiente");
  r = await pedir(puerto, "GET", `/medico/consultas/${id1}`, tk);
  verificar("el detalle trae la nota, de dónde salió y el estado de la verificación",
    r.cuerpo.consulta.notaClinica?.diagnostico === "Faringitis" && r.cuerpo.consulta.notaFuente === "vivo" && r.cuerpo.consulta.verificacion?.estado === "pendiente");
  const confirmar = (id) => pedir(puerto, "POST", `/medico/consultas/${id}/confirmar`, tk, { nota: { motivoConsulta: "Dolor", medicamentosRecetados: [] }, aplicar: {} });
  r = await confirmar(id1);
  verificar("confirmar antes de verificar → 409 (la receta no sale de un texto sin comparar)", r.estado === 409 && /verificando/.test(r.cuerpo?.error || ""));

  console.log("\n── 4. La transcripción completa la verifica ──");
  const movAntes = await MovimientoSaldo.countDocuments({ medicoPhone: MED });
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => ["ok", "diferencias", "error"].includes((await leer(id1)).verificacion?.estado));
  c = await leer(id1);
  verificar("el audio dice 500 mg y la nota 50 mg → diferencia de dosis", c.verificacion.estado === "diferencias"
    && c.verificacion.diferencias[0]?.tipo === "dosis" && c.verificacion.diferencias[0].medicamento.dosis === "500 mg");
  verificar("  ...y la nota NO se cambió sola: sigue diciendo 50 mg", c.notaClinica.medicamentosRecetados[0].dosis === "50 mg");
  verificar("la transcripción completa quedó guardada, con quién habló", c.estado === "completado" && c.segmentos.length === 1 && /quinientos/.test(c.transcripcionCompleta));
  verificar("la nota no se escribió dos veces: una llamada para verificar y nada más", llamadasIA === 2);
  verificar("se cobró la consulta, igual que siempre", (await MovimientoSaldo.countDocuments({ medicoPhone: MED })) === movAntes + 1);
  verificar("quedaron los tiempos de cada paso (sin datos clínicos)", c.tiempos?.transcripcionMs >= 0 && c.tiempos?.notaVivoMs >= 0 && c.tiempos?.verificacionMs >= 0);
  r = await confirmar(id1);
  verificar("ya verificada, se puede confirmar", r.estado === 200);

  console.log("\n── 5. Si coinciden, queda verificada ──");
  const id2 = await subir();
  await pedir(puerto, "POST", `/medico/consultas/${id2}/texto-en-vivo`, tk, { texto: TEXTO_AUDIO + " todo dicho" });
  await hasta(async () => (await leer(id2)).notaClinicaEstado === "completado");
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => ["ok", "diferencias", "error"].includes((await leer(id2)).verificacion?.estado));
  c = await leer(id2);
  verificar("misma dosis en los dos → «ok», sin diferencias", c.verificacion.estado === "ok" && !(c.verificacion.diferencias || []).length);

  console.log("\n── 6. La transcripción completa termina ANTES que la nota en vivo ──");
  const id3 = await subir();
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => (await leer(id3)).notaClinicaEstado === "completado");
  r = await pedir(puerto, "POST", `/medico/consultas/${id3}/texto-en-vivo`, tk, { texto: TEXTO_VIVO });
  c = await leer(id3);
  verificar("el texto en vivo llega tarde → no se usa, la nota es la del audio", r.cuerpo.usada === false && c.notaFuente === "audio"
    && c.notaClinica.medicamentosRecetados[0].dosis === "500 mg" && !c.verificacion?.estado);

  console.log("\n── 7. La IA falla con el texto en vivo ──");
  const id4 = await subir();
  await pedir(puerto, "POST", `/medico/consultas/${id4}/texto-en-vivo`, tk, { texto: "FALLA_IA " + TEXTO_VIVO });
  await hasta(async () => (await leer(id4)).notaClinicaEstado === "error");
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => (await leer(id4)).notaClinicaEstado === "completado");
  c = await leer(id4);
  verificar("la nota la escribe la transcripción completa, como antes: el médico no se queda sin nota",
    c.notaClinicaEstado === "completado" && c.notaFuente === "audio" && c.notaClinica.medicamentosRecetados[0].dosis === "500 mg");

  console.log("\n── 8. La transcripción completa falla ──");
  const id5 = await subir();
  await pedir(puerto, "POST", `/medico/consultas/${id5}/texto-en-vivo`, tk, { texto: TEXTO_VIVO + " otra vez" });
  await hasta(async () => (await leer(id5)).notaClinicaEstado === "completado");
  await terminarTranscripcion("", { falla: true });
  await hasta(async () => (await leer(id5)).verificacion?.estado === "error");
  c = await leer(id5);
  verificar("la nota en vivo queda, y dice que no se pudo verificar", c.estado === "error" && c.notaClinica?.diagnostico === "Faringitis" && c.verificacion.estado === "error");
  r = await confirmar(id5);
  verificar("  ...y se puede confirmar (el médico ya vio el aviso)", r.estado === 200);

  console.log("\n── 9. Sin texto en vivo, todo como antes ──");
  const llamadasAntes = llamadasIA;
  const id6 = await subir();
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => (await leer(id6)).notaClinicaEstado === "completado");
  c = await leer(id6);
  verificar("la nota sale de la transcripción completa, sin verificación aparte", c.notaFuente === "audio" && !c.verificacion?.estado && llamadasIA === llamadasAntes + 1);
  r = await confirmar(id6);
  verificar("  ...y se confirma como siempre", r.estado === 200);

  console.log("\n── 10. Lo que no se acepta ──");
  r = await pedir(puerto, "POST", `/medico/consultas/${id6}/texto-en-vivo`, tkAjeno, { texto: TEXTO_VIVO });
  verificar("la consulta de otro médico → 404", r.estado === 404);
  const id7 = await subir();
  r = await pedir(puerto, "POST", `/medico/consultas/${id7}/texto-en-vivo`, tk, { texto: "muy corto" });
  verificar("un texto en vivo de dos palabras no reclama la nota", r.cuerpo.usada === false && !(await leer(id7)).notaFuente);
  await terminarTranscripcion(TEXTO_AUDIO);
  await hasta(async () => (await leer(id7)).notaClinicaEstado === "completado");

  console.log("\n── 11. Las dos a la vez: una sola escribe la nota ──");
  const id8 = await subir();
  const antes8 = llamadasIA;
  await Promise.all([
    pedir(puerto, "POST", `/medico/consultas/${id8}/texto-en-vivo`, tk, { texto: TEXTO_VIVO + " simultáneo" }),
    terminarTranscripcion(TEXTO_AUDIO),
  ]);
  await hasta(async () => { const x = await leer(id8); return x.notaClinicaEstado === "completado" && (x.notaFuente === "audio" || ["ok", "diferencias", "error"].includes(x.verificacion?.estado)); });
  await esperar(300);
  c = await leer(id8);
  verificar(`una nota, de una sola fuente (${c.notaFuente}), y como mucho dos llamadas a la IA (nota + verificación): ${llamadasIA - antes8}`,
    c.notaClinicaEstado === "completado" && ["vivo", "audio"].includes(c.notaFuente) && llamadasIA - antes8 <= 2);

  console.log("\n── 12. «Volver a generar» la deja como nota del audio ──");
  await ConsultaMedica.updateOne({ _id: id5 }, { $set: { confirmadaEn: null, estado: "completado", transcripcionCompleta: TEXTO_AUDIO, notaClinicaEstado: "error" } });
  r = await pedir(puerto, "POST", `/medico/consultas/${id5}/nota/regenerar`, tk);
  await hasta(async () => (await leer(id5)).notaClinicaEstado === "completado");
  c = await leer(id5);
  verificar("regenerada desde la transcripción completa: ya no es «en vivo» ni espera verificación", r.estado === 202 && c.notaFuente === "audio" && !c.verificacion?.estado);

  console.log("\n── 13. Un medicamento que nadie nombró (se dijo paracetamol, la IA puso ibuprofeno) ──");
  const { nombradoEnTexto } = require(path.join(RAIZ, "services", "notaEnVivo"));
  const DICHO = "IBU_INVENTADO tengo fiebre le doy amoxicilina quinientos cada ocho horas y paracetamol quinientos si hay fiebre";
  verificar("«Ibuprofeno» no está en lo que se dijo", !nombradoEnTexto("Ibuprofeno", DICHO));
  verificar("«Paracetamol» y «Amoxicilina» sí", nombradoEnTexto("Paracetamol", DICHO) && nombradoEnTexto("Amoxicilina", DICHO));
  verificar("un nombre escuchado un poco distinto («amoxisilina») cuenta como dicho", nombradoEnTexto("Amoxicilina", "le doy amoxisilina"));
  verificar("la sal no hace falta decirla («Losartán potásico» / «losartan»)", nombradoEnTexto("Losartán potásico", "toma losartan de cincuenta"));
  verificar("lo que el médico ya enseñó a corregir cuenta como dicho",
    nombradoEnTexto("Espironolactona", "le doy inibidor de ate", [{ dijo: "Inibidor de ATE", correcto: "Espironolactona" }]));
  verificar("«ácido» solo no hace pasar a «Ácido fólico»", !nombradoEnTexto("Ácido fólico", "tiene el acido urico alto"));
  r = await pedir(puerto, "POST", "/medico/consultas/nota-en-vivo", tk, { pacienteId: String(paciente._id), texto: DICHO });
  verificar("el borrador en vivo marca el ibuprofeno (fila 1) mientras se graba", JSON.stringify(r.cuerpo.noNombrados) === "[1]");
  const { promptSistema } = require(path.join(RAIZ, "services", "notaClinica"));
  verificar("el prompt dice: solo los medicamentos que se nombran, sin completar", /si el médico dijo paracetamol, es paracetamol/.test(promptSistema("es")) && /si el médico dijo paracetamol/.test(promptSistema("pt")));

  const id9 = await subir();
  await pedir(puerto, "POST", `/medico/consultas/${id9}/texto-en-vivo`, tk, { texto: DICHO });
  await hasta(async () => (await leer(id9)).notaClinicaEstado === "completado");
  r = await pedir(puerto, "GET", `/medico/consultas/${id9}`, tk);
  const vm = r.cuerpo.consulta.verificacionMedicamentos || [];
  verificar("en la consulta, antes de verificar: el ibuprofeno avisa «no aparece en lo que se dijo»", vm[1]?.noNombrado === true && !vm[0]?.noNombrado);
  await terminarTranscripcion(DICHO);
  await hasta(async () => ["ok", "diferencias", "error"].includes((await leer(id9)).verificacion?.estado));
  c = await leer(id9);
  verificar("las dos notas de IA coinciden en el ibuprofeno, y la verificación IGUAL lo marca",
    c.verificacion.estado === "diferencias" && c.verificacion.diferencias.some(d => d.tipo === "noMencionado" && d.indice === 1));
  verificar("  ...y no se borró solo: el médico decide", c.notaClinica.medicamentosRecetados.length === 2);
  const id10 = await subir();
  await terminarTranscripcion(DICHO);
  await hasta(async () => (await leer(id10)).notaClinicaEstado === "completado");
  r = await pedir(puerto, "GET", `/medico/consultas/${id10}`, tk);
  verificar("también en una nota hecha del audio, sin nota en vivo", r.cuerpo.consulta.verificacionMedicamentos?.[1]?.noNombrado === true);

  servidor.close();
  await esperar(300);
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
