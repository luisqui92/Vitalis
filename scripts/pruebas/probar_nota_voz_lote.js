// Symphomed Ganadería — dictado de campo: de la transcripción a eventos
// reales del lote.
//
// Tres capas, tres formas de probarlas:
//   1. sanearEventosLote(): función pura — qué se descarta y qué se limpia
//      de lo que devuelve el modelo.
//   2. crearEventosDesdeSugerencias(): la parte que de verdad puede perder
//      plata o mentir sobre seguridad alimentaria si falla en silencio —
//      mortalidades que se descuentan mal, un tratamiento sin producto que
//      igual se guarda. Servidor real con mongodb-memory-server.
//   3. La ruta HTTP completa, con transcribirNotaDeVoz y generarEventosLote
//      reemplazados por versiones de mentira (no hay credenciales reales de
//      IA en esta prueba) — para comprobar que el estado 202→completado y
//      la creación de eventos de verdad están bien enchufados.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "de-prueba";

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ═══ 1. sanearEventosLote() ══════════════════════════════════════════════
console.log("── 1. sanearEventosLote() ──");
const { sanearEventosLote } = require(path.join(RAIZ, "services", "notaVozLote"));

verificar("sin 'eventos' en la respuesta, da un array vacío (no revienta)",
  Array.isArray(sanearEventosLote({})) && sanearEventosLote({}).length === 0);
verificar("un 'eventos' que no es array también da vacío", sanearEventosLote({ eventos: "no soy un array" }).length === 0);

const conTipoInvalido = sanearEventosLote({ eventos: [{ tipo: "brujeria", producto: "x" }, { tipo: "mortalidad", cantidadMuertes: 5 }] });
verificar("un tipo que no es de los cuatro válidos se descarta entero", conTipoInvalido.length === 1);
verificar("  ...y el válido sigue", conTipoInvalido[0].tipo === "mortalidad");

const numerosSucios = sanearEventosLote({ eventos: [
  { tipo: "mortalidad", cantidadMuertes: "20 aprox" },
  { tipo: "tratamiento", producto: "Enrofloxacina", diasRetiroCarne: "" },
  { tipo: "pesaje", tamanoMuestra: null, pesoPromedioKg: "1.8" },
]});
verificar("«20 aprox» no es un número → null, no NaN", numerosSucios[0].cantidadMuertes === null);
verificar("diasRetiroCarne vacío → null, no cadena vacía", numerosSucios[1].diasRetiroCarne === null);
verificar("tamanoMuestra null se conserva null (no se inventa un 0)", numerosSucios[2].tamanoMuestra === null);
verificar("«1.8» como texto se convierte en número real", numerosSucios[2].pesoPromedioKg === 1.8);

const textosNulos = sanearEventosLote({ eventos: [{ tipo: "tratamiento", producto: "X", causaPresunta: null, notas: undefined }] });
verificar("un texto ausente se guarda como cadena vacía, nunca como «null» escrito",
  textosNulos[0].causaPresunta === "" && textosNulos[0].notas === "");

const varios = sanearEventosLote({ eventos: [
  { tipo: "mortalidad", cantidadMuertes: 30, causaPresunta: "estrés calórico" },
  { tipo: "tratamiento", producto: "Enrofloxacina", diasRetiroCarne: 10 },
]});
verificar("un solo audio puede describir varios eventos distintos", varios.length === 2);

// ═══ 2. crearEventosDesdeSugerencias(), contra una base real ═══════════════
(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("notavozlote");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const { LoteGanado, EventoLote, Medico, NotaVozLote, MovimientoSaldo } = require(path.join(RAIZ, "db", "models"));
  const saldos = require(path.join(RAIZ, "services", "saldo"));
  const { crearEventosDesdeSugerencias } = require(path.join(RAIZ, "services", "notaVozLote"));
  await mongoose.connection.dropDatabase();

  console.log("\n── 2. crearEventosDesdeSugerencias() ──");

  const lote = await LoteGanado.create({
    medicoPhone: "70000001", especie: "avicola", nombre: "Galpón de prueba", codigo: "L-0001",
    cantidadInicial: 1000, cantidadActual: 1000, fechaIngreso: new Date("2026-01-01"),
  });

  const creados1 = await crearEventosDesdeSugerencias(lote, [
    { tipo: "mortalidad", cantidadMuertes: 20, causaPresunta: "estrés calórico" },
    { tipo: "mortalidad", cantidadMuertes: 15, causaPresunta: "" },
    { tipo: "tratamiento", producto: "Enrofloxacina", dosis: "10mg/kg", diasRetiroCarne: 10, diasRetiroLeche: null, cantidadAplicada: null },
  ], { registradoPor: "Dr. Prueba" });

  verificar("se crean los 3 eventos válidos", creados1.length === 3);
  const loteRecargado1 = await LoteGanado.findById(lote._id);
  verificar("dos mortalidades de la MISMA nota se restan una después de la otra (1000-20-15=965)",
    loteRecargado1.cantidadActual === 965);
  const tratamiento1 = creados1.find(e => e.tipo === "tratamiento");
  verificar("cantidadAplicada, sin dato de la IA, toma el valor YA descontado por las mortalidades de la misma nota (965, no 1000)",
    tratamiento1.cantidadAplicada === 965);
  verificar("registradoPor viaja a los tres eventos",
    creados1.every(e => e.registradoPor === "Dr. Prueba"));

  console.log("\n── 3. Lo que no cierra, se descarta en silencio (no se pierde toda la nota) ──");
  const creados2 = await crearEventosDesdeSugerencias(loteRecargado1, [
    { tipo: "mortalidad", cantidadMuertes: 99999 }, // más que los vivos: se descarta
    { tipo: "tratamiento", producto: "" }, // sin producto: se descarta
    { tipo: "pesaje", tamanoMuestra: 0, pesoPromedioKg: 1.5 }, // muestra inválida: se descarta
    { tipo: "pesaje", tamanoMuestra: 20, pesoPromedioKg: 1.5 }, // este sí es válido
  ]);
  verificar("de 4 sugerencias, solo 1 era válida y se creó", creados2.length === 1);
  verificar("  ...y es el pesaje bueno", creados2[0].tipo === "pesaje");
  const loteRecargado2 = await LoteGanado.findById(lote._id);
  verificar("la mortalidad inválida NO tocó cantidadActual", loteRecargado2.cantidadActual === 965);

  console.log("\n── 4. Un array vacío de eventos no rompe nada ──");
  const creados3 = await crearEventosDesdeSugerencias(loteRecargado2, []);
  verificar("cero eventos, cero creados, sin error", creados3.length === 0);

  // ═══ 5. LA RUTA HTTP COMPLETA, con la IA reemplazada por versiones de
  // mentira (no hay credenciales reales acá) ═══════════════════════════════
  console.log("\n── 5. La ruta HTTP: 202 → segundo plano → completado ──");

  // Reemplazo ANTES de requerir la ruta, para que la desestructuración de
  // routes/lotesGanado.js (`const { transcribirNotaDeVoz } = require(...)`)
  // agarre estas versiones y no pegue contra AssemblyAI/OpenAI de verdad.
  const assemblyai = require(path.join(RAIZ, "services", "assemblyai"));
  assemblyai.transcribirNotaDeVoz = async () => ({
    texto: "Se murieron treinta pollos por estrés calórico, y le apliqué enrofloxacina a todo el lote, diez días de retiro para faena.",
    duracionSegundos: 18,
  });
  const notaVozLote = require(path.join(RAIZ, "services", "notaVozLote"));
  const generarEventosLoteOriginal = notaVozLote.generarEventosLote;
  notaVozLote.generarEventosLote = async () => ({
    eventos: [
      { tipo: "mortalidad", cantidadMuertes: 30, causaPresunta: "estrés calórico" },
      { tipo: "tratamiento", producto: "Enrofloxacina", diasRetiroCarne: 10 },
    ],
  });

  const http = require("http");
  const express = require("express");
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  const hash = await hashPassword("Prueba123.");
  // consultasGratisUsadas ya agotadas: sin esto, el cobro de la primera
  // nota de voz saldría gratis (cortesía) y la prueba de abajo no vería
  // ningún descuento real — mismo cuidado que probar_saldo.js.
  await Medico.create({
    phone: "70000002", nombre: "Dra. Campo", passwordHash: hash,
    tipoEspecialidad: "veterinaria", idioma: "es", consultasGratisUsadas: 99,
  });
  await saldos.cargar({ medicoPhone: "70000002", montoCentavos: 20000, referencia: "QR campo", acreditadoPor: "luis" });
  const token = generarToken("70000002", "medico", 36e5);

  const loteHttp = await LoteGanado.create({
    medicoPhone: "70000002", especie: "bovino", nombre: "Rodeo HTTP", codigo: "L-0002",
    cantidadInicial: 200, cantidadActual: 200, fechaIngreso: new Date("2026-01-01"),
  });
  const loteCerrado = await LoteGanado.create({
    medicoPhone: "70000002", especie: "bovino", nombre: "Rodeo cerrado", codigo: "L-0003",
    cantidadInicial: 50, cantidadActual: 50, fechaIngreso: new Date("2026-01-01"), estado: "cerrado",
  });

  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "lotesGanado"))(app);
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;

  function pedir(metodo, ruta, headers, cuerpo) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
        let texto = "";
        res.on("data", c => texto += c);
        res.on("end", () => {
          let json = null; try { json = JSON.parse(texto); } catch {}
          resolve({ estado: res.statusCode, cuerpo: json });
        });
      });
      req.on("error", reject);
      if (cuerpo) req.write(cuerpo);
      req.end();
    });
  }

  const rBad = await pedir("POST", `/medico/lotes/${loteHttp._id}/notas-voz`, { authorization: "Bearer " + token, "content-type": "audio/webm", "content-length": 0 });
  verificar("sin audio (cuerpo vacío) → 400", rBad.estado === 400);

  const rCerrado = await pedir("POST", `/medico/lotes/${loteCerrado._id}/notas-voz`,
    { authorization: "Bearer " + token, "content-type": "audio/webm", "content-length": 4 }, Buffer.from("FAKE"));
  verificar("un lote cerrado rechaza la nota de voz → 400", rCerrado.estado === 400);

  const audioFalso = Buffer.from("esto-no-es-audio-de-verdad-pero-alcanza-para-la-prueba");
  const rSube = await pedir("POST", `/medico/lotes/${loteHttp._id}/notas-voz`,
    { authorization: "Bearer " + token, "content-type": "audio/webm", "content-length": audioFalso.length }, audioFalso);
  verificar("subir el audio responde 202 con la nota en «procesando»",
    rSube.estado === 202 && rSube.cuerpo?.nota?.estado === "procesando");

  const notaId = rSube.cuerpo.nota._id;
  let notaFinal = null;
  for (let i = 0; i < 40; i++) {
    const r = await pedir("GET", `/medico/notas-voz/${notaId}`, { authorization: "Bearer " + token });
    if (r.cuerpo?.nota?.estado !== "procesando") { notaFinal = r.cuerpo; break; }
    await new Promise(r2 => setTimeout(r2, 100));
  }
  verificar("la nota termina en «completado» (no se queda en procesando ni pasa a error)",
    notaFinal?.nota?.estado === "completado");
  verificar("  ...con la transcripción guardada", /estrés calórico/.test(notaFinal?.nota?.transcripcionCompleta || ""));
  verificar("  ...y los DOS eventos reales creados (mortalidad + tratamiento)",
    notaFinal?.eventosCreados?.length === 2);

  const loteHttpFinal = await LoteGanado.findById(loteHttp._id).lean();
  verificar("la mortalidad dictada por voz sí descontó cantidadActual (200-30=170)",
    loteHttpFinal.cantidadActual === 170);

  console.log("\n── 6. El dictado de campo consume saldo, igual que una consulta humana ──");
  const movDictado = await MovimientoSaldo.findOne({ consultaId: notaId, tipo: "consumo" }).lean();
  verificar("se generó un movimiento de consumo ligado a esta nota de voz", Boolean(movDictado));
  verificar("  ...con el concepto correcto (no dice «Consulta transcrita» de un lote de pollos)",
    movDictado?.concepto === "Dictado de campo transcrito");
  verificar("  ...y descontó plata de verdad (no 0, no gratis)", movDictado?.montoCentavos < 0);
  const saldoCampoFinal = await saldos.estadoDe("70000002");
  verificar("el saldo del médico bajó ese mismo monto",
    saldoCampoFinal.saldoCentavos === 20000 + movDictado.montoCentavos);

  console.log("\n── 7. Con el saldo bloqueado, no se acepta una nota de voz nueva ──");
  await Medico.create({
    phone: "70000003", nombre: "Dra. Sin Saldo", passwordHash: hash,
    tipoEspecialidad: "veterinaria", idioma: "es", consultasGratisUsadas: 99,
  });
  const tokenSinSaldo = generarToken("70000003", "medico", 36e5);
  const loteSinSaldo = await LoteGanado.create({
    medicoPhone: "70000003", especie: "bovino", nombre: "Rodeo sin saldo", codigo: "L-0004",
    cantidadInicial: 10, cantidadActual: 10, fechaIngreso: new Date("2026-01-01"),
  });
  // Directo al límite negativo, sin pasar por diez consultas de mentira.
  const { LIMITE_NEGATIVO } = saldos;
  await Medico.updateOne({ phone: "70000003" }, { $set: { saldoCentavos: LIMITE_NEGATIVO - 100 } });
  const rBloqueado = await pedir("POST", `/medico/lotes/${loteSinSaldo._id}/notas-voz`,
    { authorization: "Bearer " + tokenSinSaldo, "content-type": "audio/webm", "content-length": audioFalso.length }, audioFalso);
  verificar("saldo bloqueado → 402, no 202", rBloqueado.estado === 402);
  const notasDeEseLote = await NotaVozLote.countDocuments({ loteId: loteSinSaldo._id });
  verificar("  ...y ni siquiera se creó una nota de voz «procesando» que nadie iba a poder pagar",
    notasDeEseLote === 0);

  notaVozLote.generarEventosLote = generarEventosLoteOriginal;
  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
