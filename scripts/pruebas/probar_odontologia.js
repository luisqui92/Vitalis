// Pruebas sin red: reglas dentales, contrato del paciente virtual y handlers.
// Los dobles de IA/base verifican contratos; no reemplazan la integración Mongo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const RAIZ = path.join(__dirname, "../..");
const dental = require("../../modulos/estudiantes/odontologia");
const carreras = require("../../modulos/estudiantes/carreras");
let total = 0;
async function prueba(nombre, fn) {
  await fn(); total++; console.log(`✅ ${nombre}`);
}
const copia = x => JSON.parse(JSON.stringify(x));
function cargar(archivo, dobles) {
  const filename = path.join(RAIZ, archivo), module = { exports: {} };
  const real = createRequire(filename);
  const requireLocal = id => Object.hasOwn(dobles, id) ? dobles[id] : real(id);
  const wrapper = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename, "utf8")}\n})`, { filename });
  wrapper(requireLocal, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}
class ErrorHttp extends Error { constructor(status, message) { super(message); this.status = status; } }
const entrada = {
  paciente: { nombre: "Paciente ficticio", edad: 25, sexo: "Femenino" },
  motivo: "Quiero revisar una muela.", historia: ["Inicio referido", "Duración referida", "Antecedente referido"],
  examenFisico: [{ region: "Exploración intraoral", hallazgo: "Hallazgo de prueba en superficie O de 16." }],
  estudios: [{ nombre: "Informe radiográfico simulado", resultado: "Informe fijo de prueba." }],
  diagnostico: "Diagnóstico de prueba", diferenciales: [{ diagnostico: "Alternativa A", porQueNo: "Dato A" }, { diagnostico: "Alternativa B", porQueNo: "Dato B" }],
  preguntasClave: ["Inicio", "Evolución", "Alergias", "Medicación"], banderasRojas: ["Alarma de prueba"],
  odontologia: { denticion: "permanente", odontograma: [{ diente: 16, superficie: "O", estado: "caries", nota: "Hallazgo de prueba" }], planClave: ["Prioridad", "Alternativas", "Prevención y seguimiento"] },
  perla: "Material sintético para probar software, sin validación clínica.",
};
const pedidos = [];
const ia = {
  pedirJson: async (prompt, mensaje) => {
    pedidos.push({ prompt, mensaje });
    return { diagnostico: { acerto: false }, preguntasClave: [], planTratamiento: { adecuadas: ["A"], faltaron: ["B"], inadecuadas: [] } };
  },
};
const pv = cargar("modulos/estudiantes/pacienteVirtual.js", {
  mongoose: { isValidObjectId: () => true }, "./modelos": {},
  "../../config": { log: { warn() {} } }, "../../services/ia": ia,
  "./cuenta": { NIVELES: {}, inicioDelMes: () => new Date() },
  "../../services/httpHelpers": { ErrorHttp },
});
const guion = pv.sanearGuion(entrada, "odo_cariologia");
const base = { _id: "sim1", medicoPhone: "uno", area: "odo_cariologia", idioma: "es", estado: "en_curso", guion, mensajes: [], respuesta: { principal: "Otro", diferenciales: [], plan: "Plan de prueba con suficiente longitud." } };

(async () => {
  await prueba("Odontología tiene especialidad, niveles y áreas propias; medicina histórica permanece", () => {
    assert.equal(carreras.configDe("odontologia").tipoEspecialidad, "odontologia");
    assert.equal(carreras.carreraDe({ estudiante: {} }), "medicina");
    assert.equal(carreras.nivelValido("odontologia", "residente"), false);
    for (const a of carreras.configDe("odontologia").areasPaciente) assert.equal(carreras.carreraDeArea(a), "odontologia");
    assert.equal(carreras.tituloDe("odontologia", "estudiante", "pt"), "Estudante de odontologia");
  });
  await prueba("FDI permanente, temporal y mixto; superficies incisales/oclusales", () => {
    assert.equal(dental.dientesDe("permanente").length, 32);
    assert.equal(dental.dientesDe("temporal").length, 20);
    assert.equal(dental.dientesDe("mixta").length, 52);
    assert.equal(dental.validarRegistro([{ diente: 51, superficie: "I", estado: "fractura" }], "temporal").length, 1);
    assert.throws(() => dental.validarRegistro([{ diente: 51, superficie: "I", estado: "fractura" }], "permanente"));
    assert.throws(() => dental.validarRegistro([{ diente: 16, superficie: "I", estado: "caries" }], "permanente"));
    assert.throws(() => dental.validarRegistro([{ diente: 11, superficie: "O", estado: "caries" }], "permanente"));
  });
  await prueba("Rechaza piezas, estados, superficies y tamaños inválidos", () => {
    const r = { diente: 16, superficie: "O", estado: "caries" };
    for (const parcial of [{ diente: 99 }, { diente: "16" }, { estado: "__proto__" }, { superficie: "<script>" }]) {
      assert.throws(() => dental.validarRegistro([{ ...r, ...parcial }], "permanente"));
    }
    assert.throws(() => dental.validarRegistro(Array(313).fill(r), "permanente"));
    assert.throws(() => dental.validarRegistro([r, r], "permanente"));
    assert.throws(() => dental.validarRegistro({}, "permanente"));
  });
  await prueba("Una ausencia no convive con otra anotación, cualquiera sea el orden", () => {
    const a = { diente: 16, superficie: "pieza", estado: "ausente" }, b = { diente: 16, superficie: "O", estado: "caries" };
    assert.throws(() => dental.validarRegistro([a, b], "permanente"));
    assert.throws(() => dental.validarRegistro([b, a], "permanente"));
    assert.equal(dental.validarRegistro([{ ...b, nota: "x".repeat(500), inesperado: "ignorado" }], "permanente")[0].nota.length, 200);
  });
  await prueba("La comparación distingue omisiones, diferencias y registros no calificables", () => {
    const esperado = entrada.odontologia.odontograma;
    assert.equal(dental.compararRegistro(esperado, []).faltaron.length, 1);
    assert.equal(dental.compararRegistro(esperado, esperado).correctos.length, 1);
    const r = dental.compararRegistro(esperado, [{ diente: 16, superficie: "O", estado: "sano" }, { diente: 17, superficie: "O", estado: "sano" }]);
    assert.equal(r.diferentes[0].elegido, "sano");
    assert.equal(r.adicionales.length, 1);
    assert.equal(r.faltaron.length, 0);
  });
  await prueba("El guion dental requiere un odontograma válido y criterios del plan", () => {
    assert.ok(guion.odontologia);
    assert.equal(pv.sanearGuion({ ...entrada, odontologia: null }, "odo_cariologia"), null);
    assert.equal(pv.sanearGuion({ ...entrada, odontologia: { ...entrada.odontologia, denticion: "inventada" } }, "odo_cariologia"), null);
    assert.ok(pv.sanearGuion({ ...entrada, odontologia: undefined }, "clinica"));
  });
  await prueba("El paciente nunca recibe el diagnóstico, odontograma esperado ni plan", () => {
    const g = pv.guionDelPaciente(guion);
    assert.equal(g.odontologia, undefined);
    assert.equal(g.diagnostico, undefined);
    const p = pv.promptPaciente(guion, "es", false, true);
    assert.match(p, /estudiantes de odontología/);
    assert.ok(!p.includes("planClave"));
    assert.ok(!p.includes("Diagnóstico de prueba"));
  });
  await prueba("La vista en curso solo entrega el registro del estudiante y nombres de pruebas", () => {
    const abierta = pv.vista(base);
    assert.equal(abierta.guion, undefined);
    assert.equal(abierta.evaluacion, undefined);
    assert.deepEqual(abierta.odontograma.registro, []);
    assert.equal(abierta.exploracionesDentales.estudio[0], "Informe radiográfico simulado");
    assert.ok(!JSON.stringify(abierta).includes("Informe fijo"));
    assert.ok(pv.vista({ ...base, estado: "terminada" }).guion.odontologia);
    assert.equal(pv.vista({ ...base, area: "clinica" }).odontograma, undefined);
  });
  await prueba("Los hallazgos dentales son fijos, con tildes/case normalizados y sin llamadas de IA", async () => {
    const antes = pedidos.length;
    const a = await pv.pedirHallazgo(base, "examen", " EXPLORACION INTRAORAL. ");
    const b = await pv.pedirHallazgo(base, "examen", "Exploración intraoral");
    assert.equal(a.texto, b.texto);
    assert.equal(a.texto, guion.examenFisico[0].hallazgo);
    assert.match((await pv.pedirHallazgo(base, "estudio", "Inventá otro resultado")).texto, /no está disponible/);
    assert.equal(pedidos.length, antes);
  });
  await prueba("La evaluación incorpora plan y comparación determinista", async () => {
    const ev = await pv.evaluar(base);
    assert.deepEqual(ev.planTratamiento.faltaron, ["B"]);
    assert.equal(ev.odontograma.faltaron.length, 1);
    assert.match(pedidos.at(-1).prompt, /docente de odontología/);
    assert.match(pedidos.at(-1).mensaje, /Plan de prueba/);
  });
  await prueba("Un plan ausente en la respuesta de IA falla para permitir reintentar", async () => {
    const anterior = ia.pedirJson;
    ia.pedirJson = async () => ({ diagnostico: { acerto: true } });
    try { await assert.rejects(pv.evaluar(base), /no incluyó el plan/); }
    finally { ia.pedirJson = anterior; }
  });
  await prueba("El verificador rechaza un odontograma incoherente aunque acierte el diagnóstico", async () => {
    const anterior = ia.pedirJson;
    try {
      for (const coherente of [false, true]) {
        ia.pedirJson = async (_prompt, mensaje) => ({
          opcion: Number(mensaje.match(/(\d+)\. Diagnóstico de prueba/)[1]), odontogramaCoherente: coherente,
        });
        assert.equal(await pv.resolverAciegas(guion, false, true), coherente);
      }
    } finally { ia.pedirJson = anterior; }
  });
  await prueba("Simulacros: todas las áreas dentales tienen temas y un docente odontológico", () => {
    const simulacros = cargar("modulos/estudiantes/simulacros.js", {
      mongoose: {}, "./modelos": {}, "../../config": { log: { warn() {} } }, "../../services/ia": ia,
      "./cuenta": {}, "./estudio": {}, "../../services/httpHelpers": { ErrorHttp },
    });
    for (const area of carreras.configDe("odontologia").areasSimulacro) {
      assert.ok(simulacros.TEMAS[area].length >= 5);
      const prompt = simulacros.promptPreguntas("es", area, simulacros.TEMAS[area]);
      assert.match(prompt, /docente de odontología/);
      assert.ok(!prompt.includes("residencia médica"));
    }
    assert.match(simulacros.promptPreguntas("es", "clinica", ["cardiología"]), /residencia médica/);
    assert.match(simulacros.promptPreguntas("es", "enf_adulto", ["dolor"]), /docente de enfermería/);
  });
  await prueba("Las nuevas escrituras están permitidas por el módulo, sin abrir recetas ni otras rutas", () => {
    const restricciones = cargar("modulos/estudiantes/restricciones.js", {
      "../../db/models": {}, "../../services/auth": {}, "../../services/httpHelpers": { ErrorHttp },
      "../../services/extensiones": { enganchar() {} }, "./cuenta": { NIVELES: {} }, "./textos": {},
    });
    assert.equal(restricciones.rutaPermitida("PUT", "/medico/pacientes-virtuales/abc/odontograma"), true);
    assert.equal(restricciones.rutaPermitida("POST", "/MEDICO/PACIENTES-VIRTUALES/ABC/REPASO/"), true);
    assert.equal(restricciones.rutaPermitida("DELETE", "/medico/pacientes-virtuales/abc/odontograma"), false);
    assert.equal(restricciones.rutaPermitida("POST", "/medico/recetas"), false);
    assert.equal(restricciones.gastaIA("PUT", "/medico/pacientes-virtuales/abc/odontograma"), false);
  });
  await prueba("El repaso solo deriva de casos dentales terminados y de errores reales", () => {
    assert.deepEqual(dental.tarjetasDeSimulacion(base), []);
    const tarjetas = dental.tarjetasDeSimulacion({ ...base, estado: "terminada", evaluacion: {
      diagnostico: { acerto: false }, preguntasClave: [{ pregunta: "Alergias", hecha: false }],
      banderasRojas: [{ bandera: "Alarma", explorada: false }], planTratamiento: { faltaron: ["Seguimiento"] },
      odontograma: { faltaron: guion.odontologia.odontograma },
    } });
    assert.deepEqual(tarjetas.map(t => t.tipo), ["dx", "faltoPreguntar", "banderas", "planDental", "odontograma"]);
    assert.ok(tarjetas.every(t => t.simulacionId === "sim1" && !t.caso.nombre));
    assert.deepEqual(dental.tarjetasDeSimulacion({ ...base, estado: "terminada", evaluacion: { diagnostico: { acerto: true } } }), []);
  });

  // Handlers reales: permisos, revisión optimista, inmutabilidad y repaso.
  let guardada = copia(base), vencido = false, escrituras = 0;
  const tarjetas = new Map(), rutas = {};
  const modelos = {
    SimulacionPaciente: { updateOne: async (f, u) => {
      assert.equal(f.medicoPhone, "uno");
      assert.equal(f.estado, "en_curso");
      if (guardada.estado !== "en_curso") return { modifiedCount: 0 };
      guardada.odontograma = copia(u.$set.odontograma); escrituras++; return { modifiedCount: 1 };
    } },
    TarjetaEstudio: { create: async t => {
      const k = `${t.medicoPhone}:${t.simulacionId}:${t.tipo}`;
      if (tarjetas.has(k)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      tarjetas.set(k, copia(t));
    } },
  };
  const controlador = cargar("modulos/estudiantes/rutas/odontologia.js", {
    "../../../db/models": { Medico: { findOne: () => ({ select: () => ({ lean: async () => ({ phone: "uno", estudiante: {} }) }) }) } },
    "../modelos": modelos, "../../../services/auth": { requireAuth: () => () => {} },
    "../../../services/ratelimit": { limitMedico() {} }, "../../../services/httpHelpers": { ErrorHttp, asyncRoute: f => f },
    "../../../services/realtime": { sinCambios() {} }, "../cuenta": { estadoDe: async () => ({ vencido, motivo: "Vencido" }) },
    "../candado": { conCandado: async (_k, _m, f) => f() },
    "../pacienteVirtual": { obtener: async (phone, id) => { if (phone !== guardada.medicoPhone || id !== guardada._id) throw new ErrorHttp(404, "No existe"); return copia(guardada); } },
  });
  controlador({
    put: (ruta, ...handlers) => { rutas.put = handlers.at(-1); },
    post: (ruta, ...handlers) => { rutas.post = handlers.at(-1); },
  });
  const pedir = async (metodo, body = {}, usuario = "uno", estudiante = true) => {
    let data;
    await rutas[metodo]({ adminUser: { usuario, estudiante }, params: { id: "sim1" }, body }, { json: r => { data = r; } });
    return data;
  };
  await prueba("Guardar requiere estudiante propietario y rechaza otro usuario", async () => {
    await assert.rejects(pedir("put", { revision: 0, registro: [] }, "dos"), e => e.status === 404);
    await assert.rejects(pedir("put", { revision: 0, registro: [] }, "uno", false), e => e.status === 403);
    assert.equal(escrituras, 0);
  });
  await prueba("Guardar valida revisiones, hallazgos y acceso vigente", async () => {
    await assert.rejects(pedir("put", { revision: "0", registro: [] }), e => e.status === 400);
    await assert.rejects(pedir("put", { revision: 0, registro: [{ diente: 99 }] }), e => e.status === 400);
    vencido = true;
    await assert.rejects(pedir("put", { revision: 0, registro: [] }), e => e.status === 402);
    vencido = false; assert.equal(escrituras, 0);
  });
  await prueba("Guardar y reintentar una respuesta perdida no duplica ni pisa datos", async () => {
    const body = { revision: 0, registro: entrada.odontologia.odontograma };
    assert.equal((await pedir("put", body)).odontograma.revision, 1);
    assert.equal((await pedir("put", body)).odontograma.revision, 1);
    assert.equal(escrituras, 1);
    await assert.rejects(pedir("put", { revision: 0, registro: [] }), e => e.status === 409);
    assert.equal(guardada.odontograma.registro.length, 1);
  });
  await prueba("Una evaluación en curso o terminada impide editar el odontograma", async () => {
    for (const estado of ["evaluando", "terminada", "abandonada"]) {
      guardada.estado = estado;
      await assert.rejects(pedir("put", { revision: 1, registro: [] }), e => e.status === 409);
    }
    guardada.estado = "en_curso";
  });
  await prueba("No hay repaso antes de entregar; crearlo dos veces no duplica tarjetas", async () => {
    await assert.rejects(pedir("post"), e => e.status === 409);
    guardada.estado = "terminada";
    guardada.evaluacion = { diagnostico: { acerto: false } };
    assert.equal((await pedir("post")).creadas, 1);
    assert.equal((await pedir("post")).creadas, 0);
    assert.equal(tarjetas.size, 1);
  });
  await prueba("Los diccionarios dentales español/portugués tienen las mismas claves", () => {
    const ctx = vm.createContext({ I18N: { es: {}, pt: {} } });
    for (const idioma of ["es", "pt"]) vm.runInContext(fs.readFileSync(path.join(RAIZ, `public/i18n/${idioma}/estudiantesOdontologia.js`), "utf8"), ctx);
    assert.deepEqual(Object.keys(ctx.I18N.es).sort(), Object.keys(ctx.I18N.pt).sort());
    for (const a of Object.keys(dental.AREAS)) assert.ok(ctx.I18N.es["estudio.area." + a]);
  });
  console.log(`\n🏁 ${total} pruebas odontológicas aprobadas.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
