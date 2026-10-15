// Symphomed — Estudiar enfermería: simulacros, paciente virtual y tutor.
//
// Las cuentas de estudiantes de enfermería practican con lo mismo que las de
// medicina, pensado para enfermería (modulos/estudiantes/carreras.js). Lo que
// se prueba:
//   1. Simulacros: el docente es de enfermería, sin taxonomías con licencia;
//      las preguntas de cálculo se rehacen con aritmética de verdad
//      (calculos.js) y se tira la que no da, la que no trae con qué
//      rehacerla y la que tiene el resultado en dos opciones; la otra IA las
//      contesta como licenciado en enfermería. Medicina no cambia.
//   2. Paciente virtual: el caso trae el diagnóstico médico (que el paciente
//      sabe) y el de enfermería prioritario (que no); se valora, se piden
//      escalas, y la evaluación mira también las intervenciones.
//   3. El tutor: «te falta valorar» mientras graba, y el razonamiento con
//      diagnósticos de enfermería, que queda anotado y pasa a sus tarjetas.
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
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
}

// ─── La IA de mentira ──────────────────────────────────────────────────────
const CASO = {
  paciente: { nombre: "Rosa Choque", edad: 72, sexo: "Femenino", ocupacion: "jubilada" },
  quienHabla: "el paciente", lugar: "internacion", diagnosticoMedico: "Neumonía adquirida en la comunidad",
  motivo: "Me cuesta respirar, señorita, y estoy muy cansada.",
  personalidad: "cansada y colaboradora",
  historia: ["Tose con flema amarilla desde hace 4 días", "Se cansa al ir al baño", "Come poco y toma poca agua", "Duerme sentada porque acostada le falta el aire"],
  antecedentes: { personales: ["Hipertensión"], familiares: [], medicamentos: ["Enalapril"], alergias: [], habitos: [], ginecoObstetricos: [] },
  negativos: ["dolor de pecho", "caídas previas"],
  signosVitales: { PA: "130/80 mmHg", FC: "104 lpm", FR: "26 rpm", T: "38,4 °C", SatO2: "89 %" },
  examenFisico: [{ region: "Respiración", hallazgo: "Tiraje intercostal, crepitantes en base derecha" }],
  estudios: [{ nombre: "Escala de Braden", resultado: "15 puntos" }],
  diagnostico: "Deterioro del intercambio gaseoso",
  diferenciales: [{ diagnostico: "Intolerancia a la actividad", porQueNo: "Es secundaria a la hipoxemia" }, { diagnostico: "Riesgo de caídas", porQueNo: "Sin caídas previas; no es lo que amenaza la vida" }],
  preguntasClave: ["¿Le falta el aire?", "¿Desde cuándo tose?", "¿Cómo duerme?", "¿Cuánto toma de agua?", "¿Se cansa al moverse?", "¿Tiene dolor?"],
  banderasRojas: ["Saturación menor a 90 %", "Confusión"],
  estudiosPertinentes: ["Oximetría", "Escala de Braden"],
  intervencionesClave: ["Posición semisentada", "Oxigenoterapia según indicación", "Control de saturación y frecuencia respiratoria"],
  perla: "Con saturación baja, lo primero es la oxigenación: el resto espera.",
};
const pedidos = [];
const claves = new Map();
let numero = 0;
// Un lote de enfermería con de todo: una buena, una de cálculo bien hecha, una
// de cálculo con la cuenta mal, una de cálculo sin datos, una con el
// resultado en dos opciones y una que la otra IA marca dudosa.
function loteEnfermeria(temas) {
  const pregunta = (enunciado, opciones, correcta, calculo = null) => {
    numero++;
    const e = `(${numero}) ${enunciado}`;
    claves.set(e, correcta);
    return { tema: temas[0], enunciado: e, opciones, correcta, explicacion: "Porque sí.", porOpcion: opciones.map(() => "x"), calculo };
  };
  return [
    pregunta("Un paciente posoperado refiere dolor 8/10. ¿Qué hacés primero?", ["Valorar el dolor y avisar", "Darle de comer", "Bañarlo", "Esperar", "Cambiar la cama"], 0),
    pregunta("Se indican 1000 mL de solución fisiológica en 8 horas con un equipo de 20 gotas por mL. ¿A cuántas gotas por minuto?",
      ["21 gotas/min", "42 gotas/min", "63 gotas/min", "84 gotas/min", "125 gotas/min"], 1, { tipo: "goteo", datos: { volumenMl: 1000, minutos: 480, factor: 20 } }),
    pregunta("Se indican 500 mL en 4 horas con un equipo de 20 gotas por mL. ¿A cuántas gotas por minuto?",
      ["21 gotas/min", "30 gotas/min", "42 gotas/min", "50 gotas/min", "60 gotas/min"], 1, { tipo: "goteo", datos: { volumenMl: 500, minutos: 240, factor: 20 } }),
    pregunta("Se indican 250 mg de una presentación de 500 mg en 5 mL. ¿Cuántos mL cargás?", ["1 mL", "2,5 mL", "5 mL", "10 mL", "0,5 mL"], 1),
    pregunta("Se indican 15 mg/kg para un niño de 20 kg, en una sola toma. ¿Qué dosis?", ["150 mg", "300 mg", "300 mg en total", "450 mg", "30 mg"], 1,
      { tipo: "dosisPorPeso", datos: { dosisPorKg: 15, pesoKg: 20, tomas: 1 } }),
    pregunta("[dudosa] ¿Qué escala valora el riesgo de lesiones por presión?", ["Braden", "Glasgow", "EVA", "Apgar", "Morse"], 0),
  ];
}
const axios = require(path.join(RAIZ, "node_modules", "axios"));
axios.post = async (_url, cuerpo) => {
  const sistema = cuerpo.messages[0].content;
  const ultimo = cuerpo.messages.at(-1).content;
  const json = (obj) => ({ data: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const texto = (t) => ({ data: { choices: [{ message: { content: t } }] } });
  const anotar = (tipo) => pedidos.push({ tipo, sistema, ultimo });
  if (/docente de enfermería que escribe preguntas/.test(sistema)) {
    anotar("preguntasEnf");
    const temas = (sistema.match(/estos temas: (.+?)\.\n/) || [])[1].split("; ");
    return json({ preguntas: loteEnfermeria(temas) });
  }
  if (/licenciado en enfermería que rinde un examen/.test(sistema)) {
    anotar("verificarEnf");
    const enunciados = [...ultimo.matchAll(/^PREGUNTA \d+: (.+)$/gm)].map(m => m[1]);
    return json({ respuestas: enunciados.map(e => ({ opcion: claves.get(e), dudosa: /\[dudosa\]/.test(e) })) });
  }
  if (/valoración de enfermería con un paciente simulado/.test(sistema) && /Armá UN caso nuevo/.test(sistema)) { anotar("casoEnf"); return json(CASO); }
  if (/licenciado en enfermería\. Te paso un caso completo/.test(sistema)) {
    anotar("resolverEnf");
    const opciones = [...ultimo.matchAll(/^(\d+)\. (.+)$/gm)].map(m => m[2]);
    return json({ opcion: opciones.indexOf(CASO.diagnostico) });
  }
  if (/práctica de valoración de enfermería para estudiantes de enfermería/.test(sistema)) { anotar("pacienteEnf"); return texto("Me falta el aire, señorita."); }
  if (/el estudiante valora al paciente/.test(sistema)) { anotar("valoracionEnf"); return json({ hallazgo: "Tiraje intercostal; saturación 89 %." }); }
  if (/aplica una escala de valoración/.test(sistema)) { anotar("escalaEnf"); return json({ resultado: "Braden 15 puntos." }); }
  if (/docente de enfermería que evalúa la práctica/.test(sistema)) {
    anotar("evaluarEnf");
    return json({
      preguntasClave: CASO.preguntasClave.map((_, i) => ({ hecha: i < 3 })), banderasRojas: [{ explorada: true }, { explorada: false }],
      estudios: { pertinentes: ["Oximetría"], faltaron: [], innecesarios: [] },
      diagnostico: { acerto: true, comentario: "Priorizaste la oxigenación." },
      diferenciales: { considero: ["Intolerancia a la actividad"], faltaron: [] },
      intervenciones: { adecuadas: ["Posición semisentada"], faltaron: ["Control de saturación"], inadecuadas: ["Caminar por el pasillo"] },
      comunicacion: { bien: ["Te presentaste"], mejorar: [] }, comentario: "Bien.",
    });
  }
  if (/tutor de enfermería que acompaña/.test(sistema)) {
    anotar("faltaEnf");
    return json({ preguntas: [{ pregunta: "¿Cuánta agua toma por día?", porQue: "deshidratación" }], banderasRojas: ["Saturación baja"] });
  }
  if (/TODAVÍA NO se hicieron/.test(sistema)) { anotar("faltaMed"); return json({ preguntas: [{ pregunta: "¿Tiene fiebre?", porQue: "x" }], banderasRojas: [] }); }
  if (/enseñarle a razonar/.test(sistema)) {
    anotar(/tutor de enfermería/.test(sistema) ? "razonamientoEnf" : "razonamientoMed");
    return json({
      diferenciales: [
        { diagnostico: "Deterioro del intercambio gaseoso", aFavor: ["saturación 89 %", "tiraje"], enContra: [], estudio: "Posición semisentada y oxígeno según indicación" },
        { diagnostico: "Riesgo de déficit de volumen de líquidos", aFavor: ["toma poca agua", "fiebre"], enContra: ["no se valoró la diuresis"], estudio: "Balance hídrico" },
      ],
      banderasRojas: ["Saturación menor a 90 %"], faltoPreguntar: ["¿Cuánto orina?"],
      comparacion: { acertoPrincipal: true, comentario: "Bien priorizado.", noConsideraste: [] }, perla: "La oxigenación va primero.",
    });
  }
  // La nota (enfermería o medicina): lo mínimo.
  if (/NOTA DE ENFERMERÍA/.test(sistema)) return json({ motivoConsulta: "Dificultad para respirar", intervenciones: ["Posición semisentada"] });
  return json({ motivoConsulta: "Tos", diagnostico: "Neumonía", medicamentosRecetados: [] });
};
const ultimoDe = (tipo) => pedidos.filter(p => p.tipo === tipo).at(-1);

const TEXTO = "Buenas tardes señora soy la estudiante de enfermería, ¿cómo se siente? Me cuesta respirar y estoy cansada, tosiendo desde hace cuatro días con flema";

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "enfermeria_estudio";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = { ...require(path.join(RAIZ, "db", "models")), ...require(path.join(RAIZ, "modulos", "estudiantes", "modelos")) };
  const S = require(path.join(RAIZ, "modulos", "estudiantes", "simulacros"));
  const PV = require(path.join(RAIZ, "modulos", "estudiantes", "pacienteVirtual"));
  const TUTOR = require(path.join(RAIZ, "modulos", "estudiantes", "tutor"));
  const ESTUDIO = require(path.join(RAIZ, "modulos", "estudiantes", "estudio"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  console.log("── 1. Simulacros de enfermería ──");
  const pEnf = S.promptPreguntas("es", "enf_fundamentos", ["signos vitales", "cálculo de goteo y de mL por hora"]);
  const pMed = S.promptPreguntas("es", "clinica", ["cardiología"]);
  verificar("el que escribe las de enfermería es un docente de enfermería, para la licenciatura", /docente de enfermería/.test(pEnf) && /licenciatura en enfermería/.test(pEnf) && /fundamentos de enfermería/.test(pEnf));
  verificar("  ...sin taxonomías con licencia y sin dosis de memoria", /NANDA-I, NIC, NOC/.test(pEnf) && /Nada de dosis de memoria/.test(pEnf));
  verificar("  ...con cálculos solo si todos los datos están en el enunciado, y con qué rehacerlos", /SOLO si TODOS los datos están en el enunciado/.test(pEnf) && /"tipo":"goteo"/.test(pEnf));
  verificar("medicina sigue con su docente de residencia", /examen de ingreso a la residencia médica/.test(pMed) && !/enfermería/.test(pMed));
  verificar("las 7 áreas de enfermería tienen nombre y temas", ["enf_fundamentos", "enf_adulto", "enf_materno", "enf_pediatria", "enf_comunitaria", "enf_urgencias", "enf_salud_mental"]
    .every(a => S.NOMBRE_AREA[a] && S.TEMAS[a]?.length >= 5));
  const goteo = { enunciado: "1000 mL en 8 h con equipo de 20 gotas por mL: ¿gotas por minuto?", opciones: ["21 gotas/min", "42 gotas/min", "63 gotas/min", "84 gotas/min", "125 gotas/min"], correcta: 1 };
  const datosGoteo = { calculo: { tipo: "goteo", datos: { volumenMl: 1000, minutos: 480, factor: 20 } } };
  verificar("una de cálculo bien hecha pasa", S.calculoComprobado(goteo, datosGoteo));
  verificar("  ...con la correcta marcada en otra, no", !S.calculoComprobado({ ...goteo, correcta: 2 }, datosGoteo));
  verificar("  ...con el resultado en dos opciones, no", !S.calculoComprobado({ ...goteo, opciones: ["42 gotas/min", "42 gotas/min aprox.", "63", "84", "125"], correcta: 0 }, datosGoteo));
  verificar("  ...sin los datos para rehacerla, no", !S.calculoComprobado(goteo, {}));
  verificar("  ...con un equipo que no existe (25 gotas/mL), no", !S.calculoComprobado(goteo, { calculo: { tipo: "goteo", datos: { volumenMl: 1000, minutos: 480, factor: 25 } } }));
  verificar("una que no es de cálculo no necesita datos («cálculo renal» tampoco es una cuenta)",
    S.calculoComprobado({ enunciado: "Paciente con cálculo renal y cólico: ¿qué cuidado es prioritario?", opciones: ["a", "b", "c", "d", "e"], correcta: 0 }, {}));
  const nuevas = await S.generarPreguntas("es", "enf_fundamentos", 5);
  const guardadas = await M.PreguntaSimulacro.find({ area: "enf_fundamentos" }).lean();
  verificar(`de un lote de 6 quedan las 2 buenas: la de cuidado y la de cálculo bien hecha (${nuevas})`,
    nuevas === 2 && guardadas.length === 2 && guardadas.some(p => /dolor 8\/10/.test(p.enunciado)) && guardadas.some(p => /1000 mL/.test(p.enunciado)));
  verificar("  ...la de la cuenta mal, la de sin datos, la de dos resultados y la dudosa, afuera",
    !guardadas.some(p => /500 mL en 4 horas|250 mg|15 mg\/kg|\[dudosa\]/.test(p.enunciado)));
  const alVerificador = ultimoDe("verificarEnf");
  verificar("las contestó a ciegas un licenciado en enfermería, sin la respuesta", alVerificador && !/"correcta"/.test(alVerificador.ultimo) && /hacé la cuenta/.test(alVerificador.sistema));
  verificar("  ...y la de cálculo con la cuenta mal ni le llegó", alVerificador && !/500 mL en 4 horas/.test(alVerificador.ultimo));

  console.log("\n── 2. El paciente virtual de enfermería ──");
  const pCaso = PV.promptCaso("es", "enf_hospitalizacion", "intermedio", []);
  verificar("el caso lo arma un docente de enfermería: valorar y encontrar el problema de cuidado prioritario",
    /valoración de enfermería con un paciente simulado/.test(pCaso) && /diagnóstico médico conocido/.test(pCaso) && /"intervencionesClave"/.test(pCaso) && /NANDA-I/.test(pCaso));
  verificar("  ...y el de medicina no cambia", /^Sos un docente de medicina/.test(PV.promptCaso("es", "clinica", "intermedio", [])));
  const caso = await PV.generarCaso("es", "enf_hospitalizacion", "intermedio");
  verificar("el caso se guarda con el diagnóstico médico, la internación y las intervenciones clave",
    caso.guion.diagnosticoMedico === CASO.diagnosticoMedico && caso.guion.lugar === "internacion" && caso.guion.intervencionesClave.length === 3);
  const resolver = ultimoDe("resolverEnf");
  verificar("  ...cerró: lo resolvió a ciegas un licenciado en enfermería, con el diagnóstico médico a la vista",
    resolver && /Diagnóstico médico: Neumonía/.test(resolver.ultimo) && !/Posición semisentada/.test(resolver.ultimo));
  const sim = { _id: new mongoose.Types.ObjectId(), area: "enf_hospitalizacion", idioma: "es", guion: caso.guion, mensajes: [], hallazgos: [], estado: "en_curso" };
  await PV.responderComoPaciente(sim, "¿Qué le dijo el médico que tiene?");
  const alPaciente = ultimoDe("pacienteEnf");
  verificar("el paciente sabe su diagnóstico médico", alPaciente && /Neumonía adquirida en la comunidad/.test(alPaciente.sistema));
  verificar("  ...pero NO el de enfermería ni las intervenciones", alPaciente && !alPaciente.sistema.includes(CASO.diagnostico) && !/semisentada/.test(alPaciente.sistema));
  await PV.pedirHallazgo(sim, "examen", "Respiración");
  await PV.pedirHallazgo(sim, "estudio", "Escala de Braden");
  verificar("valorar y pedir una escala van a la práctica de enfermería", Boolean(ultimoDe("valoracionEnf")) && Boolean(ultimoDe("escalaEnf")));
  verificar("la pantalla sabe el diagnóstico médico desde el principio, no el de enfermería",
    PV.vista({ ...sim, estado: "en_curso" }).diagnosticoMedico === CASO.diagnosticoMedico && !("guion" in PV.vista({ ...sim, estado: "en_curso" })));
  const evaluacion = await PV.evaluar({ ...sim, respuesta: { principal: "Deterioro del intercambio gaseoso", diferenciales: ["Intolerancia a la actividad"], plan: "Semisentada, oxígeno" } });
  const alEvaluador = ultimoDe("evaluarEnf");
  verificar("la evaluación es de enfermería: su diagnóstico prioritario y sus intervenciones",
    alEvaluador && /SU DIAGNÓSTICO DE ENFERMERÍA PRIORITARIO: Deterioro/.test(alEvaluador.ultimo) && /SUS INTERVENCIONES: Semisentada/.test(alEvaluador.ultimo));
  verificar("  ...y mira las intervenciones: las adecuadas, las que faltaron y las que no corresponden",
    evaluacion.intervenciones?.adecuadas?.[0] === "Posición semisentada" && evaluacion.intervenciones.faltaron.length === 1 && evaluacion.intervenciones.inadecuadas.length === 1);
  verificar("una evaluación de medicina sigue sin intervenciones", !("intervenciones" in PV.sanearEvaluacion({ comentario: "x" }, { preguntasClave: [], banderasRojas: [] })));

  console.log("\n── 3. El tutor de enfermería ──");
  const hasta = new Date(Date.now() + 180 * 86400000);
  const ENF = "59170099001", MEDEST = "59170099002";
  await M.Medico.create({ phone: ENF, nombre: "Ana Enfermera", passwordHash: "x", activo: true, idioma: "es", tipoEspecialidad: "enfermeria",
    estudiante: { nivel: "estudiante", hasta, horasMes: 6, carrera: "enfermeria" } });
  await M.Medico.create({ phone: MEDEST, nombre: "Beto Interno", passwordHash: "x", activo: true, idioma: "es", tipoEspecialidad: "medicina_general",
    estudiante: { nivel: "interno", hasta, horasMes: 12 } });
  const tkEnf = generarToken(ENF, "medico", 36e5, { estudiante: true });
  const tkMedEst = generarToken(MEDEST, "medico", 36e5, { estudiante: true });
  const pacEnf = await M.Paciente.create({ medicoPhone: ENF, nombre: "Rosa Choque", sexo: "Femenino" });
  const pacMed = await M.Paciente.create({ medicoPhone: MEDEST, nombre: "Juan Pérez", sexo: "Masculino" });
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "modulos", "estudiantes")).montar(app);
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, tk, cuerpo) => pedir(servidor.address().port, m, ruta, tk, cuerpo);

  let r = await P("POST", "/medico/consultas/nota-en-vivo", tkEnf, { pacienteId: String(pacEnf._id), texto: TEXTO });
  verificar(`mientras graba, a la estudiante de enfermería le dice qué falta VALORAR (${r.estado})`,
    r.estado === 200 && r.cuerpo?.extras?.tutor?.carrera === "enfermeria" && /agua/.test(r.cuerpo.extras.tutor.preguntas?.[0]?.pregunta || ""));
  verificar("  ...con el tutor de enfermería, que no da diagnósticos", /falta VALORAR/.test(ultimoDe("faltaEnf")?.sistema || "") && /NO DES DIAGNÓSTICOS/.test(ultimoDe("faltaEnf")?.sistema || ""));
  r = await P("POST", "/medico/consultas/nota-en-vivo", tkMedEst, { pacienteId: String(pacMed._id), texto: TEXTO + " y fiebre" });
  verificar("al de medicina, lo que falta preguntar, como siempre", r.cuerpo?.extras?.tutor?.carrera === "medicina" && Boolean(ultimoDe("faltaMed")));

  const consulta = (medicoPhone, pacienteId, nota) => M.ConsultaMedica.create({ medicoPhone, pacienteId, estado: "completado", deEstudiante: true,
    notaClinicaEstado: "completado", notaClinica: nota, transcripcionCompleta: TEXTO });
  const cEnf = await consulta(ENF, pacEnf._id, { formato: "enfermeria", motivoConsulta: "Dificultad para respirar" });
  r = await P("POST", `/medico/consultas/${cEnf._id}/razonamiento`, tkEnf, { principal: "Deterioro del intercambio gaseoso", diferenciales: "Riesgo de caídas" });
  const pr = ultimoDe("razonamientoEnf");
  verificar(`el razonamiento de enfermería: con diagnósticos de enfermería por prioridad (${r.estado})`,
    r.estado === 200 && r.cuerpo?.razonamiento?.carrera === "enfermeria" && /Diagnóstico de enfermería prioritario: Deterioro/.test(pr?.ultimo || ""));
  verificar("  ...el tutor de enfermería: PES con palabras, sin NANDA-I, la intervención clave de cada uno",
    /tutor de enfermería/.test(pr?.sistema || "") && /NANDA-I, NIC, NOC/.test(pr?.sistema || "") && /intervención de enfermería clave/.test(pr?.sistema || ""));
  const rz = await M.RazonamientoDiagnostico.findOne({ consultaId: cEnf._id }).lean();
  verificar("queda anotado que es de enfermería", rz?.carrera === "enfermeria");
  const tarjetas = await M.TarjetaEstudio.find({ consultaId: cEnf._id }).lean();
  verificar(`sus tarjetas son de enfermería (${tarjetas.map(t => t.tipo).join(", ")})`,
    tarjetas.length >= 3 && tarjetas.every(t => t.carrera === "enfermeria") && tarjetas.find(t => t.tipo === "dx")?.respuesta?.[0] === "Deterioro del intercambio gaseoso");
  verificar("  ...y la pantalla lo sabe", tarjetas.every(t => ESTUDIO.paraMostrar(t).carrera === "enfermeria"));
  r = await P("GET", `/medico/consultas/${cEnf._id}`, tkEnf);
  verificar("al abrir la consulta, el razonamiento dice su carrera", r.cuerpo?.consulta?.extras?.razonamiento?.carrera === "enfermeria");
  const cMed = await consulta(MEDEST, pacMed._id, { motivoConsulta: "Tos", diagnostico: "Neumonía" });
  r = await P("POST", `/medico/consultas/${cMed._id}/razonamiento`, tkMedEst, { principal: "Neumonía", diferenciales: "Bronquitis" });
  const rzMed = await M.RazonamientoDiagnostico.findOne({ consultaId: cMed._id }).lean();
  const tarjetasMed = await M.TarjetaEstudio.find({ consultaId: cMed._id }).lean();
  verificar("el de medicina sigue igual: su tutor, sin carrera guardada y sus tarjetas de medicina",
    r.cuerpo?.razonamiento?.carrera === "medicina" && Boolean(ultimoDe("razonamientoMed")) && !rzMed.carrera && tarjetasMed.every(t => !t.carrera));
  verificar("tarjetasDeCaso: sin carrera en el razonamiento, sin carrera en las tarjetas (las de antes no cambian)",
    ESTUDIO.tarjetasDeCaso({ notaClinica: { motivoConsulta: "Tos" }, razonamiento: { en: new Date(), resultado: rzMed.resultado } }, null).every(t => !("carrera" in t)));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : "\n✅ Enfermería estudia con lo suyo, y medicina sigue igual");
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
