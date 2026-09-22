// Symphomed — Recordatorios de medicación al paciente, de punta a punta.
//
// Tres capas, tres formas de probarlas:
//   1. detectarIntervaloDias(): función pura, casos sueltos.
//   2. recalcularRecordatorio(): también pura, pero importa que CONSERVE
//      ultimoEnviado/vecesEnviado cuando el intervalo no cambió — eso solo
//      se ve construyendo el "antes" y el "después" a mano.
//   3. procesarRecordatoriosVencidos(): la parte que de verdad puede fallar
//      en silencio — un médico entero de casos donde el trabajo en segundo
//      plano tiene que mandar, no mandar, o apagarse solo. Servidor real
//      con mongodb-memory-server, como el resto de las pruebas de flujo.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { detectarIntervaloDias, recalcularRecordatorio } = require(path.join(RAIZ, "services", "recordatorioMedicamento"));

// ═══ 1. DETECCIÓN ═══════════════════════════════════════════════════════
console.log("── 1. detectarIntervaloDias() ──");
const casos = [
  ["cada 3 días", 3], ["cada 3 dias", 3], ["Cada 3 Días", 3],
  ["a cada 3 dias", 3],            // portugués
  ["cada 1 día", 1], ["cada 10 días", 10], ["cada 30 días", 30],
  ["diario", 1], ["diariamente", 1], ["todos los días", 1], ["todo dia", 1],
  ["una vez al día", 1], ["1 vez al día", 1],
  ["diariamente por la mañana", 1],            // portugués: "diariamente"
  ["una vez por semana", 7], ["semanal", 7], ["semanalmente", 7],
];
for (const [texto, esperado] of casos) {
  verificar(`«${texto}» → cada ${esperado} día(s)`, detectarIntervaloDias(texto) === esperado);
}

console.log("\n── Lo que NO se detecta, a propósito ──");
const noDetectados = [
  "cada 8 horas",                  // horas, no días — ver el porqué en el servicio
  "cada 12 horas",
  "",
  "   ",
  "según necesidad",
  "cada 45 días",                  // más de un mes: probablemente no es un intervalo real
  "cada 0 días",
];
for (const texto of noDetectados) {
  verificar(`«${texto || "(vacío)"}» no arma ningún recordatorio`, detectarIntervaloDias(texto) === null);
}

// ═══ 2. RECALCULAR ═══════════════════════════════════════════════════════
console.log("\n── 2. recalcularRecordatorio() ──");

const m1 = { recordatorio: undefined };
recalcularRecordatorio(m1, "cada 3 días", true);
verificar("con teléfono y frecuencia detectable, se activa", m1.recordatorio.activo === true);
verificar("  ...con el intervalo correcto", m1.recordatorio.intervaloDias === 3);
verificar("  ...y guarda de qué frase salió, para que el médico entienda por qué", m1.recordatorio.detectadoDe === "cada 3 días");

const m2 = { recordatorio: undefined };
recalcularRecordatorio(m2, "cada 3 días", false);
verificar("la MISMA frecuencia, sin teléfono del paciente, NO se activa", m2.recordatorio.activo === false);
verificar("  ...y no guarda intervalo ni frase, para no sugerir que hay algo andando", m2.recordatorio.intervaloDias === null && m2.recordatorio.detectadoDe === "");

const m3 = { recordatorio: undefined };
recalcularRecordatorio(m3, "según necesidad", true);
verificar("con teléfono pero frecuencia ambigua, NO se activa", m3.recordatorio.activo === false);

console.log("\n── El conteo no se reinicia si el intervalo no cambió ──");
const yaEnviado = { recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: new Date("2026-01-01"), vecesEnviado: 5 } };
recalcularRecordatorio(yaEnviado, "cada 3 días, con el almuerzo", true);  // el médico agregó una aclaración, mismo intervalo
verificar("mismo intervalo (3 días): ultimoEnviado se conserva", yaEnviado.recordatorio.ultimoEnviado?.getTime() === new Date("2026-01-01").getTime());
verificar("  ...y vecesEnviado también", yaEnviado.recordatorio.vecesEnviado === 5);

const cambioIntervalo = { recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: new Date("2026-01-01"), vecesEnviado: 5 } };
recalcularRecordatorio(cambioIntervalo, "cada 5 días", true);  // el médico cambió la pauta de verdad
verificar("intervalo distinto (5 días): el conteo se reinicia", cambioIntervalo.recordatorio.ultimoEnviado === null && cambioIntervalo.recordatorio.vecesEnviado === 0);
verificar("  ...con el intervalo nuevo", cambioIntervalo.recordatorio.intervaloDias === 5);

// ═══ 3. EL TRABAJO EN SEGUNDO PLANO, DE PUNTA A PUNTA ═══════════════════
(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("recordatoriomedicamento");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { Medico, Paciente, Medicamento } = require(path.join(RAIZ, "db", "models"));
  const { procesarRecordatoriosVencidos } = require(path.join(RAIZ, "services", "recordatorioMedicamento"));
  await mongoose.connection.dropDatabase();

  const medico = await Medico.create({ phone: "70000001", nombre: "Dra. Alejandra Quiroga", passwordHash: "x", activo: true, idioma: "es" });
  const pacienteConTelefono = await Paciente.create({ medicoPhone: "70000001", nombre: "Juan Pérez", telefono: "71234567" });
  const pacienteSinTelefono = await Paciente.create({ medicoPhone: "70000001", nombre: "Sin Teléfono", telefono: "" });

  const hace4dias = new Date(Date.now() - 4 * 86400000);
  const hace1dia = new Date(Date.now() - 1 * 86400000);
  const ayer = new Date(Date.now() - 86400000);

  // A: vencido de verdad (arrancó hace 4 días, cada 3 días, nunca se mandó nada) — TIENE que mandar.
  const medA = await Medicamento.create({
    pacienteId: pacienteConTelefono._id, medicoPhone: "70000001", nombre: "Amoxicilina", dosis: "500mg",
    frecuencia: "cada 3 días", fechaInicio: hace4dias,
    recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: null, vecesEnviado: 0 },
  });
  // B: todavía no toca (el último se mandó ayer, y el intervalo es cada 3 días) — NO tiene que mandar.
  const medB = await Medicamento.create({
    pacienteId: pacienteConTelefono._id, medicoPhone: "70000001", nombre: "Ibuprofeno", dosis: "400mg",
    frecuencia: "cada 3 días", fechaInicio: hace4dias,
    recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: hace1dia, vecesEnviado: 2 },
  });
  // C: recordatorio apagado (el médico lo desactivó, o nunca se detectó nada) — no se toca ni se cuenta.
  const medC = await Medicamento.create({
    pacienteId: pacienteConTelefono._id, medicoPhone: "70000001", nombre: "Vitamina D", dosis: "",
    frecuencia: "una vez al mes", fechaInicio: hace4dias,
    recordatorio: { activo: false, intervaloDias: null, detectadoDe: "", ultimoEnviado: null, vecesEnviado: 0 },
  });
  // D: el tratamiento ya terminó (fechaFin ayer) — vencido por fecha, pero NO tiene que mandar nada de un tratamiento ya cerrado.
  const medD = await Medicamento.create({
    pacienteId: pacienteConTelefono._id, medicoPhone: "70000001", nombre: "Antibiótico Terminado", dosis: "",
    frecuencia: "cada 3 días", fechaInicio: hace4dias, fechaFin: ayer,
    recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: null, vecesEnviado: 0 },
  });
  // E: el paciente se quedó sin teléfono cargado después de activado el recordatorio — tiene que apagarse solo, no reintentar para siempre.
  const medE = await Medicamento.create({
    pacienteId: pacienteSinTelefono._id, medicoPhone: "70000001", nombre: "Losartán", dosis: "",
    frecuencia: "cada 3 días", fechaInicio: hace4dias,
    recordatorio: { activo: true, intervaloDias: 3, detectadoDe: "cada 3 días", ultimoEnviado: null, vecesEnviado: 0 },
  });

  console.log("\n── 3. procesarRecordatoriosVencidos() ──");
  const resultado = await procesarRecordatoriosVencidos();
  verificar("reporta 1 enviado (solo A estaba de verdad vencido)", resultado.enviados === 1);
  verificar("  ...y 0 fallidos", resultado.fallidos === 0);

  const A = await Medicamento.findById(medA._id).lean();
  verificar("A: vencido de verdad → se marcó como enviado ahora", A.recordatorio.ultimoEnviado != null);
  verificar("  ...y el contador subió a 1", A.recordatorio.vecesEnviado === 1);

  const B = await Medicamento.findById(medB._id).lean();
  verificar("B: todavía no vence → ultimoEnviado NO cambió", B.recordatorio.ultimoEnviado.getTime() === hace1dia.getTime());
  verificar("  ...y el contador sigue en 2", B.recordatorio.vecesEnviado === 2);

  const C = await Medicamento.findById(medC._id).lean();
  verificar("C: apagado → nadie lo tocó", C.recordatorio.ultimoEnviado === null && C.recordatorio.vecesEnviado === 0);

  const D = await Medicamento.findById(medD._id).lean();
  verificar("D: tratamiento ya terminado (fechaFin pasada) → no se mandó nada",
    D.recordatorio.ultimoEnviado === null && D.recordatorio.vecesEnviado === 0);

  const E = await Medicamento.findById(medE._id).lean();
  verificar("E: sin teléfono del paciente → se apaga solo en vez de reintentar para siempre",
    E.recordatorio.activo === false && E.recordatorio.ultimoEnviado === null);

  console.log("\n── Correr de nuevo enseguida no manda otra vez lo que ya se mandó ──");
  const resultado2 = await procesarRecordatoriosVencidos();
  verificar("segunda pasada inmediata: 0 enviados (A ya no está vencido)", resultado2.enviados === 0);

  // ═══ 4. LA RUTA HTTP: que crear/editar un medicamento de verdad dispare
  // recalcularRecordatorio() — lo de arriba prueba la función sola, esto
  // prueba que routes/medicamentos.js la esté llamando de verdad. ══════════
  console.log("\n── 4. La ruta HTTP arma el recordatorio solo, al cargar el medicamento ──");
  const http = require("http");
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "medicamentos"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  const tk = generarToken("70000001", "medico", 3600000);
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const pedir = (ruta, metodo, cuerpo) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        Authorization: `Bearer ${tk}`,
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => res({ estado: r.statusCode, cuerpo: JSON.parse(t) })); });
    if (datos) req.write(datos);
    req.end();
  });

  const conFono = await pedir(`/medico/pacientes/${pacienteConTelefono._id}/medicamentos`, "POST",
    { nombre: "Losartán", dosis: "50mg", frecuencia: "cada 3 días" });
  verificar("crear con paciente CON teléfono y frecuencia detectable: 201", conFono.estado === 201);
  verificar("  ...y el recordatorio arranca activo solo, sin que nadie lo haya pedido aparte",
    conFono.cuerpo.medicamento.recordatorio.activo === true && conFono.cuerpo.medicamento.recordatorio.intervaloDias === 3);

  const sinFono = await pedir(`/medico/pacientes/${pacienteSinTelefono._id}/medicamentos`, "POST",
    { nombre: "Losartán", dosis: "50mg", frecuencia: "cada 3 días" });
  verificar("misma frecuencia, paciente SIN teléfono: no se activa nada", sinFono.cuerpo.medicamento.recordatorio.activo === false);

  const idNuevo = conFono.cuerpo.medicamento._id;
  const apagado = await pedir(`/medico/medicamentos/${idNuevo}`, "PATCH", { recordatorioActivo: false });
  verificar("el médico lo apaga a mano (la detección se pudo haber equivocado)", apagado.cuerpo.medicamento.recordatorio.activo === false);
  verificar("  ...pero el intervalo detectado se conserva (no hace falta reescribir la frecuencia)",
    apagado.cuerpo.medicamento.recordatorio.intervaloDias === 3);

  const cambioFrecuencia = await pedir(`/medico/medicamentos/${idNuevo}`, "PATCH", { frecuencia: "según necesidad" });
  verificar("si después el médico cambia la frecuencia a algo ambiguo, se desactiva solo",
    cambioFrecuencia.cuerpo.medicamento.recordatorio.activo === false && cambioFrecuencia.cuerpo.medicamento.recordatorio.intervaloDias === null);

  servidor.close();

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
