// Symphomed — Los medicamentos de la nota: vocabulario del médico y revisión
// contra la lista oficial.
//
// Caso real: en una consulta en portugués el transcriptor escribió
// «inibidor de ATE». Un nombre de fármaco mal escrito que el médico confirma
// sin mirar queda en el Kardex.
//
// Lo que se prueba:
//   · la revisión (services/medicamentosOficiales.js): lo bien escrito no se
//     marca —en español Y en portugués, que escriben distinto el mismo
//     fármaco—; lo mal escrito sugiere el correcto; lo que se parece a OTRO
//     fármaco no se sugiere (cotrimoxazol ≠ clotrimazol, Rivotril ≠ pivopril);
//   · el vocabulario (services/vocabularioMedico.js + keytermsPara): lo que el
//     médico receta va primero, sin repetidos, nunca más de 100;
//   · las rutas: la consulta trae el aviso por medicamento, NUNCA se cambia el
//     nombre sola, y la transcripción recibe el vocabulario del médico.
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

const { verificarMedicamento: revisar, nombreBase } = require(path.join(RAIZ, "services", "medicamentosOficiales"));
const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));

function pedir(puerto, metodo, ruta, token, cuerpo, tipo = "application/json") {
  return new Promise((resolve, reject) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    if (cuerpo) headers["content-type"] = tipo;
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(texto); } catch {} resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

(async () => {
  console.log("── 1. Lo bien escrito no se marca ──");
  // Los que más se recetan, como los escribe un médico boliviano y uno
  // brasileño. Cualquier aviso acá es ruido que enseña a ignorar los avisos.
  const ES = ["paracetamol", "Metamizol", "Losartán 50 mg", "valsartán", "Sildenafil", "ketoconazol", "tamsulosina",
    "deflazacort", "Cotrimoxazol", "simvastatina", "bromhexina", "hioscina", "Amoxicilina con ácido clavulánico",
    "vitamina B12", "Insulina NPH", "complejo B", "sales de rehidratación oral", "ondansetrón", "ácido acetilsalicílico"];
  const PT = ["Dipirona", "Losartana potássica", "valsartana", "sildenafila", "cetoconazol", "tansulosina", "deflazacorte",
    "sinvastatina", "bromexina", "escopolamina", "Sulfametoxazol + trimetoprima", "complexo B", "Cloridrato de sertralina",
    "Acetato de ciproterona", "colecalciferol", "Omeprazol 20 mg em jejum"];
  const malES = ES.filter(n => revisar(n, { idioma: "es" }).estado !== "ok");
  const malPT = PT.filter(n => revisar(n, { idioma: "pt" }).estado !== "ok");
  verificar(`${ES.length} nombres en español, ninguno marcado${malES.length ? " — marcados: " + malES.join(", ") : ""}`, !malES.length);
  verificar(`${PT.length} nombres en portugués, ninguno marcado${malPT.length ? " — marcados: " + malPT.join(", ") : ""}`, !malPT.length);
  verificar("el español en una cuenta en portugués tampoco se marca (valsartán)", revisar("valsartán", { idioma: "pt" }).estado === "ok");
  verificar("la dosis y la sal no son parte del nombre", nombreBase("Losartana potássica 50 mg") === "losartana");

  console.log("\n── 2. Lo mal escrito sugiere el correcto ──");
  const sug = (n, idioma, propios) => revisar(n, { idioma, propios }).sugerencia;
  verificar("Espironolactna → espironolactona", sug("Espironolactna", "es") === "espironolactona");
  verificar("Amoxcilina → amoxicilina", sug("Amoxcilina", "pt") === "amoxicilina");
  verificar("Zolpiden → zolpidem", sug("Zolpiden", "es") === "zolpidem");
  verificar("Omeprasol → omeprazol", sug("Omeprasol", "es") === "omeprazol");
  verificar("Sertralna → sertralina (sin «cloridrato de», que es la sal)", sug("Sertralna", "pt") === "sertralina");
  verificar("glicazida → gliclazida", sug("glicazida", "es") === "gliclazida");
  verificar("cortada al final: Espironolac + su historial → «Espironolactona» (sin la dosis de aquella vez)",
    sug("Espironolac", "pt", ["Espironolactona 100 mg"]) === "Espironolactona");
  const r = revisar("Espironolactna", { idioma: "es" });
  verificar("el resultado es «parecido» con lo que se dijo, para mostrarlo", r.estado === "parecido" && r.dijo === "espironolactna");

  console.log("\n── 3. Nunca sugerir OTRO fármaco ──");
  verificar("cotrimoxazol NO sugiere clotrimazol (uno es antibiótico, el otro antimicótico)", revisar("cotrimoxazol", { idioma: "es" }).estado === "ok");
  verificar("Rivotril (marca de clonazepam) NO sugiere «pivopril»: queda para verificar", revisar("Rivotril", { idioma: "pt" }).estado === "desconocido");
  verificar("simvastatina NO sugiere «imipenem + cilastatina»", revisar("simvastatina", { idioma: "es" }).estado === "ok");
  verificar("de una combinación nunca se sugiere la combinación entera", !/\+/.test(sug("Cilastatna", "pt") || ""));
  verificar("una marca comercial → «desconocido», sin sugerencia", revisar("Novalgina", { idioma: "pt" }).sugerencia === null);
  verificar("«inibidor de ATE» (el caso real) → se marca", revisar("inibidor de ATE", { idioma: "pt" }).estado !== "ok");
  verificar("lo que el médico ya recetó y confirmó cuenta como conocido (su marca)", revisar("Rivotril", { idioma: "pt", propios: ["Rivotril 2 mg"] }).estado === "ok");

  console.log("\n── 4. El vocabulario para transcribir ──");
  const { keytermsPara, MAX_KEYTERMS, KEYTERMS_FARMACOS } = assemblyai;
  const base = keytermsPara("medicina_general", "pt");
  verificar("sin historial: incluye los fármacos más recetados", base.includes("espironolactona") && base.includes("dipirona"));
  const propios = ["Rivotril", "Glifage XR", "Losartana", ...Array.from({ length: 40 }, (_, i) => `Marca${i}`)];
  const conPropios = keytermsPara("odontologia", "pt", propios);
  verificar("lo del médico va PRIMERO", conPropios[0] === "Rivotril" && conPropios[1] === "Glifage XR");
  verificar("como mucho 25 del médico (no se come la especialidad)", conPropios.filter(x => /^Marca\d/.test(x)).length === 22);
  verificar("la especialidad sigue entera", conPropios.includes("odontograma") && conPropios.includes("prótese"));
  verificar("el vocabulario general sigue (la posología)", conPropios.includes("de 8 em 8 horas"));
  verificar(`nunca más de ${MAX_KEYTERMS}`, conPropios.length <= MAX_KEYTERMS && keytermsPara("odontologia", "es", propios).length <= MAX_KEYTERMS);
  verificar("«Losartana» del médico y «losartana» de la lista no se repiten",
    conPropios.filter(x => x.toLowerCase() === "losartana").length === 1);
  verificar("un término de más de 6 palabras no se manda (AssemblyAI lo rechaza)",
    !keytermsPara("", "es", ["uno dos tres cuatro cinco seis siete"]).includes("uno dos tres cuatro cinco seis siete"));
  // Un término mal escrito en la lista le enseñaría al transcriptor el error.
  for (const idioma of ["es", "pt"]) {
    const mal = KEYTERMS_FARMACOS[idioma].filter(n => revisar(n, { idioma }).estado !== "ok");
    verificar(`los ${KEYTERMS_FARMACOS[idioma].length} fármacos de la lista ${idioma} están en la lista oficial${mal.length ? " — no: " + mal.join(", ") : ""}`, !mal.length);
  }

  console.log("\n── 5. Las rutas ──");
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "medicamentos_prueba";
  // config/ ya se cargó arriba (lo trae assemblyai) con la URI sin poner.
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Paciente, ConsultaMedica, Medicamento } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Promise.all([ConsultaMedica.syncIndexes(), Medicamento.syncIndexes()]);

  // La transcripción de mentira: guarda con qué vocabulario la llamaron.
  let llamadaTranscripcion = null;
  assemblyai.transcribirConsultaMedica = async (buf, esp, idioma, opciones) => {
    llamadaTranscripcion = { esp, idioma, opciones };
    return { transcripcionCompleta: "", segmentos: [], duracionSegundos: 60 };
  };
  assemblyai.crearTokenStreaming = async () => "token-de-prueba";

  const hash = await hashPassword("Prueba123.");
  const MED = "5511900000009";
  await Medico.create({ phone: MED, nombre: "Dra. Brasil", passwordHash: hash, idioma: "pt", moneda: "BRL", tipoEspecialidad: "medicina_general" });
  await Medico.create({ phone: "70000009", nombre: "Dr. Ajeno", passwordHash: hash });
  const tk = generarToken(MED, "medico", 36e5);
  const tkB = generarToken("70000009", "medico", 36e5);
  const paciente = await Paciente.create({ medicoPhone: MED, nombre: "Paciente de prueba" });
  const otroPaciente = await Paciente.create({ medicoPhone: MED, nombre: "Otro paciente" });

  // Su historial: Rivotril 3 veces en Kardex, Glifage en una nota confirmada.
  for (const p of [paciente, otroPaciente, paciente]) {
    await Medicamento.create({ pacienteId: p._id, medicoPhone: MED, nombre: "Rivotril 2 mg" });
  }
  await ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "completado",
    confirmadaEn: new Date(), notaClinicaEstado: "completado", notaClinica: { medicamentosRecetados: [{ nombre: "Glifage XR 500 mg" }] } });
  // Una nota SIN confirmar no enseña nada (puede traer justo el error).
  await ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, pacienteNombre: paciente.nombre, estado: "completado",
    notaClinicaEstado: "completado", notaClinica: { medicamentosRecetados: [{ nombre: "Inibidor de ATE" }] } });
  // Un medicamento de OTRO médico no es vocabulario de éste.
  await Medicamento.create({ pacienteId: paciente._id, medicoPhone: "70000009", nombre: "Ajenoxetina" });

  const NOTA = { motivoConsulta: "Controle", medicamentosRecetados: [
    { nombre: "Losartana potássica", dosis: "50 mg" },
    { nombre: "Espironolactna", dosis: "25 mg" },
    { nombre: "Novalgina" },
    { nombre: "Rivotril", dosis: "2 mg" },
  ] };
  const aRevisar = await ConsultaMedica.create({ medicoPhone: MED, pacienteId: paciente._id, pacienteNombre: paciente.nombre,
    estado: "completado", notaClinicaEstado: "completado", notaClinica: NOTA });

  const { medicamentosDelMedico } = require(path.join(RAIZ, "services", "vocabularioMedico"));
  const vocab = await medicamentosDelMedico(MED);
  verificar("el vocabulario del médico: lo más recetado primero, sin la dosis", vocab[0] === "Rivotril" && vocab.includes("Glifage XR"));
  verificar("  ...sin lo de notas SIN confirmar", !vocab.some(v => /inibidor/i.test(v)));
  verificar("  ...sin lo de otro médico", !vocab.includes("Ajenoxetina"));

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  const puerto = servidor.address().port;

  const det = await pedir(puerto, "GET", `/medico/consultas/${aRevisar._id}`, tk);
  const v = det.cuerpo?.consulta?.verificacionMedicamentos || [];
  verificar("la consulta trae una revisión por medicamento, en el mismo orden", v.length === 4);
  verificar("  Losartana potássica → ok", v[0]?.estado === "ok");
  verificar("  Espironolactna → «¿quisiste decir espironolactona?»", v[1]?.estado === "parecido" && v[1]?.sugerencia === "espironolactona");
  verificar("  Novalgina (marca) → para verificar", v[2]?.estado === "desconocido");
  verificar("  Rivotril → ok, porque ESTE médico ya lo receta", v[3]?.estado === "ok");
  const guardada = await ConsultaMedica.findById(aRevisar._id).lean();
  verificar("el nombre guardado NO se cambió solo", guardada.notaClinica.medicamentosRecetados[1].nombre === "Espironolactna");
  verificar("la nota que se muestra tampoco", det.cuerpo.consulta.notaClinica.medicamentosRecetados[1].nombre === "Espironolactna");

  const confirmadaId = (await ConsultaMedica.findOne({ medicoPhone: MED, confirmadaEn: { $ne: null } }))._id;
  const detConf = await pedir(puerto, "GET", `/medico/consultas/${confirmadaId}`, tk);
  verificar("una consulta ya confirmada no trae avisos (lo que quedó lo decidió el médico)", !detConf.cuerpo.consulta.verificacionMedicamentos);

  const vivo = await pedir(puerto, "GET", `/medico/medicamentos/verificar?nombre=${encodeURIComponent("Amoxcilina 500 mg")}`, tk);
  verificar("revisar un nombre mientras lo edita → sugerencia", vivo.estado === 200 && vivo.cuerpo.sugerencia === "amoxicilina");
  verificar("  ...sin sesión → 401", (await pedir(puerto, "GET", "/medico/medicamentos/verificar?nombre=x", null)).estado === 401);
  verificar("  ...un vacío no rompe", (await pedir(puerto, "GET", "/medico/medicamentos/verificar?nombre=", tk)).estado === 200);
  const deOtro = await pedir(puerto, "GET", `/medico/medicamentos/verificar?nombre=Rivotril`, tkB);
  verificar("  ...el historial de un médico no le sirve a otro", deOtro.cuerpo.estado !== "ok");

  const tok = await pedir(puerto, "GET", "/medico/transcripcion-token", tk);
  verificar("la vista previa en vivo recibe el vocabulario del médico primero", tok.cuerpo?.keyterms?.[0] === "Rivotril");

  const sub = await pedir(puerto, "POST", `/medico/consultas?pacienteId=${paciente._id}`, tk, Buffer.from("audio"), "audio/ogg");
  for (let i = 0; i < 50 && !llamadaTranscripcion; i++) await new Promise((r) => setTimeout(r, 50));
  verificar("subir una consulta → 202", sub.estado === 202);
  verificar("la transcripción final recibe el mismo vocabulario del médico",
    llamadaTranscripcion?.opciones?.delMedico?.[0] === "Rivotril" && llamadaTranscripcion.idioma === "pt");

  servidor.close();
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
