// Symphomed — Un informe firmado dice siempre lo que decía el día que se
// firmó: el membrete (centro, profesional, matrícula, logo, firma) y los
// datos del paciente quedan congelados al firmar.
//
// Antes, la vista pública, la verificación y la impresión leían el membrete
// y el paciente de HOY: cambiar la matrícula o el logo cambiaba todos los
// informes ya entregados (informe de QA del 9 de octubre de 2026). Lo que se
// prueba:
//   1. Firmar congela el membrete y el paciente; cambiarlos después no cambia
//      el informe firmado (enlace del paciente, verificación, impresión,
//      WhatsApp), y sí el borrador.
//   2. Una copia del membrete por versión, no una por informe.
//   3. Dos «firmar» a la vez: uno solo firma, con un solo enlace.
//   4. Los firmados antes de este cambio se congelan al arrancar, con lo que
//      mostraban hasta ese momento.
//   5. Las imágenes también: los ajustes del visor, las mediciones y la
//      calibración quedan como al firmar, y una imagen de un firmado no se
//      borra (informe de QA del 16 de octubre de 2026, A11). Los firmados
//      con el membrete ya congelado reciben sus imágenes al arrancar.
//   6. Un cambio del borrador que se cruza con la firma no cambia lo firmado.
//   7. Un informe que corrige a otro apunta a uno de ese mismo paciente.
const path = require("path");
const fs = require("fs");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

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

// WhatsApp de mentira: se guarda lo que se iba a mandar.
const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
const enviados = [];
meta.enviarTextoOPlantilla = async (destino, texto) => { enviados.push({ destino, texto }); return { ok: true }; };

const LOGO_VIEJO = "data:image/png;base64," + Buffer.from("logo-viejo").toString("base64");
const LOGO_NUEVO = "data:image/png;base64," + Buffer.from("logo-nuevo").toString("base64");
const FIRMA = "data:image/png;base64," + Buffer.from("firma").toString("base64");

(async () => {
  let MongoMemoryServer;
  try { ({ MongoMemoryServer } = require(path.join(RAIZ, "node_modules", "mongodb-memory-server"))); } catch { /* sin base */ }
  if (!MongoMemoryServer) { console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅."); process.exit(0); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "informe_congelado";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  for (const modelo of [M.MembreteEmitido, M.Informe, M.Membrete]) await modelo.syncIndexes();

  const MED = "70096001";
  await M.Medico.create({ phone: MED, nombre: "Dra. Imagen", passwordHash: "x", activo: true });
  const tk = generarToken(MED, "medico", 36e5);
  const pac = await M.Paciente.create({ medicoPhone: MED, nombre: "Ana Pérez", telefono: "59170000096", sexo: "F", fechaNacimiento: new Date("1990-05-10") });

  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const rutas = require(path.join(RAIZ, "routes", "informes"));
  rutas(app);
  require(path.join(RAIZ, "routes", "estudios"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const P = (m, ruta, t, cuerpo) => pedir(servidor.address().port, m, ruta, t, cuerpo);

  const MEMBRETE_DE_FIRMA = { nombreCentro: "Centro de Imagen Sur", profesionalNombre: "Dra. Imagen", profesionalTitulo: "Médica radióloga",
    profesionalRegistro: "MAT-1111", logo: LOGO_VIEJO, firma: FIRMA };
  await P("PATCH", "/medico/membrete", tk, MEMBRETE_DE_FIRMA);
  const nuevoInforme = async (conclusion = "Sin hallazgos patológicos.") => {
    const id = (await P("POST", `/medico/pacientes/${pac._id}/informes`, tk, { titulo: "Radiografía de tórax" })).cuerpo.informe._id;
    await P("PATCH", `/medico/informes/${id}`, tk, { conclusion });
    return id;
  };

  console.log("── 1. Firmar congela el membrete y el paciente ──");
  const id1 = await nuevoInforme();
  let r = await P("POST", `/medico/informes/${id1}/firmar`, tk);
  const token1 = r.cuerpo?.enlace?.split("/informe/")[1];
  verificar("firmar → 200, con su enlace", r.estado === 200 && !!token1);
  // Después de firmar, cambia todo: el membrete y el paciente.
  await P("PATCH", "/medico/membrete", tk, { nombreCentro: "Centro Nuevo", profesionalNombre: "Dr. Otro", profesionalRegistro: "MAT-9999", logo: LOGO_NUEVO });
  await M.Paciente.updateOne({ _id: pac._id }, { $set: { nombre: "Ana Pérez de Gómez", codigo: "P-9999", fechaNacimiento: new Date("1980-01-01") } });
  r = await P("GET", `/informe-publico/${token1}`);
  const pub = r.cuerpo;
  verificar("el enlace del paciente: el membrete del día que se firmó (centro, profesional, matrícula, logo, firma)",
    r.estado === 200 && pub.membrete.nombreCentro === "Centro de Imagen Sur" && pub.membrete.profesionalNombre === "Dra. Imagen"
    && pub.membrete.profesionalRegistro === "MAT-1111" && pub.membrete.logo === LOGO_VIEJO && pub.membrete.firma === FIRMA);
  verificar("  ...y el paciente como estaba: nombre, código y edad de ese día",
    pub.paciente.nombre === "Ana Pérez" && pub.paciente.codigo !== "P-9999" && pub.paciente.edad === 36);
  verificar("  ...lo que sale al paciente no trae nada de más (ni teléfono, ni la huella de la versión)",
    !("telefono" in pub.paciente) && !("huella" in pub.membrete) && !("medicoPhone" in pub.membrete));
  r = await P("GET", `/informe-publico/${token1}/verificar`);
  verificar("verificar el informe: el profesional y el centro que lo firmaron", r.cuerpo.valido === true && r.cuerpo.profesional === "Dra. Imagen" && r.cuerpo.centro === "Centro de Imagen Sur");
  r = await P("GET", `/medico/informes/${id1}/completo`, tk);
  verificar("imprimirlo de nuevo desde el consultorio: igual que el día que se firmó",
    r.cuerpo.membrete.profesionalRegistro === "MAT-1111" && r.cuerpo.membrete.logo === LOGO_VIEJO && r.cuerpo.paciente.nombre === "Ana Pérez" && r.cuerpo.paciente.edad === 36);
  verificar("  ...con el teléfono de hoy (es para mandarlo, no va impreso)", r.cuerpo.paciente.telefono === "59170000096");
  r = await P("POST", `/medico/informes/${id1}/enviar`, tk, {});
  verificar("mandarlo por WhatsApp: firma el centro que lo emitió", r.estado === 200 && /Centro de Imagen Sur/.test(enviados.at(-1)?.texto) && !/Centro Nuevo/.test(enviados.at(-1)?.texto));
  const borrador = await nuevoInforme();
  r = await P("GET", `/medico/informes/${borrador}/completo`, tk);
  verificar("un borrador, en cambio, se ve con el membrete y el paciente de hoy",
    r.cuerpo.membrete.nombreCentro === "Centro Nuevo" && r.cuerpo.membrete.logo === LOGO_NUEVO && r.cuerpo.paciente.nombre === "Ana Pérez de Gómez");

  console.log("\n── 2. Una copia del membrete por versión ──");
  const id2 = await nuevoInforme();
  const id3 = await nuevoInforme();
  await P("POST", `/medico/informes/${id2}/firmar`, tk);
  await P("POST", `/medico/informes/${id3}/firmar`, tk);
  const [i1, i2, i3] = await Promise.all([id1, id2, id3].map(id => M.Informe.findById(id).lean()));
  verificar("dos informes firmados con el mismo membrete → la misma copia", String(i2.membreteEmitido) === String(i3.membreteEmitido));
  verificar("  ...y el de antes del cambio, otra", String(i1.membreteEmitido) !== String(i2.membreteEmitido) && (await M.MembreteEmitido.countDocuments({ medicoPhone: MED })) === 2);

  console.log("\n── 3. Dos «firmar» a la vez ──");
  const id4 = await nuevoInforme();
  const dos = await Promise.all([1, 2].map(() => P("POST", `/medico/informes/${id4}/firmar`, tk)));
  const i4 = await M.Informe.findById(id4).lean();
  verificar("uno firma y el otro → 409; queda un solo enlace, el que se le dio al que firmó",
    dos.map(x => x.estado).sort().join() === "200,409" && dos.find(x => x.estado === 200).cuerpo.enlace.endsWith(i4.tokenPublico));
  r = await P("PATCH", `/medico/informes/${id4}`, tk, { conclusion: "otra cosa" });
  verificar("un firmado no se edita (como antes)", r.estado === 409);

  console.log("\n── 4. Los firmados antes de este cambio ──");
  // Firmado con el código anterior: sin copia del membrete ni del paciente.
  const viejo = await M.Informe.create({ pacienteId: pac._id, medicoPhone: MED, codigo: "INF-VIEJO", conclusion: "Normal", estado: "firmado",
    firmadoEn: new Date("2026-01-15"), tokenPublico: "token-de-un-informe-viejo-0001", tokenExpira: new Date(Date.now() + 86400000) });
  r = await P("GET", "/informe-publico/token-de-un-informe-viejo-0001");
  verificar("antes de congelarlo, se ve con lo de hoy (como hasta ahora)", r.cuerpo.membrete.nombreCentro === "Centro Nuevo");
  const n = await rutas.congelarInformesFirmados();
  await P("PATCH", "/medico/membrete", tk, { nombreCentro: "Centro Tercero", profesionalRegistro: "MAT-3333" });
  r = await P("GET", "/informe-publico/token-de-un-informe-viejo-0001");
  verificar(`al arrancar se congela (${n}), con lo que mostraba hasta ese momento; después ya no cambia`,
    n === 1 && r.cuerpo.membrete.nombreCentro === "Centro Nuevo" && r.cuerpo.membrete.profesionalRegistro === "MAT-9999" && r.cuerpo.paciente.nombre === "Ana Pérez de Gómez");
  verificar("  ...sin crear otra copia del mismo membrete", String((await M.Informe.findById(viejo._id).lean()).membreteEmitido) === String(i2.membreteEmitido));
  verificar("arrancar otra vez no congela nada más", (await rutas.congelarInformesFirmados()) === 0);
  const arranque = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("  ...y el servidor lo hace al arrancar (index.js)", /require\("\.\/routes\/informes"\)\.congelarInformesFirmados\(\)/.test(arranque));

  console.log("\n── 5. Las imágenes del firmado ──");
  const { DIR_ESTUDIOS, guardarArchivoEstudio } = require(path.join(RAIZ, "services", "archivosEstudio"));
  const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5a40000000049454e44ae426082", "hex");
  const nuevaImagen = (nombre) => M.Estudio.create({ pacienteId: pac._id, medicoPhone: MED, tipo: "radiografia", nombre,
    archivoNombre: guardarArchivoEstudio(PNG, "image/png"), archivoMime: "image/png", archivoTamano: PNG.length, fecha: new Date("2026-10-01"),
    ajustesVisor: { brillo: 110, contraste: 140 },
    mediciones: [{ tipo: "distancia", puntos: [{ x: 1, y: 1 }, { x: 11, y: 1 }], valor: 4.2, unidad: "mm" }],
    calibracion: { mmPorPixel: 0.42, origen: "manual" } });
  const placa = await nuevaImagen("Tórax PA");
  const suelta = await nuevaImagen("Tórax lateral");
  const id5 = await nuevoInforme();
  await P("PATCH", `/medico/informes/${id5}`, tk, { estudiosIncluidos: [placa._id] });
  r = await P("POST", `/medico/informes/${id5}/firmar`, tk);
  const token5 = r.cuerpo?.enlace?.split("/informe/")[1];
  // Después de firmar, el médico vuelve a la placa para otra consulta: le
  // sube el contraste, la invierte, borra la medición y la recalibra.
  r = await P("PATCH", `/medico/estudios/${placa._id}/visor`, tk,
    { ajustesVisor: { brillo: 100, contraste: 300, invertido: true }, mediciones: [], calibracion: { mmPorPixel: 0.9 } });
  verificar("la placa se puede seguir ajustando después de firmar (es para otras consultas)", r.estado === 200);
  r = await P("GET", `/informe-publico/${token5}`);
  const enEnlace = r.cuerpo?.estudios?.[0];
  verificar("el enlace del paciente: la imagen como estaba al firmar (contraste 140, sin invertir)",
    r.estado === 200 && r.cuerpo.estudios.length === 1 && enEnlace._id === String(placa._id)
    && enEnlace.ajustesVisor.contraste === 140 && !enEnlace.ajustesVisor.invertido);
  r = await P("GET", `/medico/informes/${id5}/completo`, tk);
  const enHoja = r.cuerpo?.estudios?.[0];
  verificar("imprimirlo de nuevo: los ajustes, las mediciones y la calibración de ese día",
    enHoja?._id === String(placa._id) && enHoja.ajustesVisor.contraste === 140 && enHoja.mediciones.length === 1
    && enHoja.mediciones[0].valor === 4.2 && enHoja.calibracion.mmPorPixel === 0.42);
  const bor5 = await nuevoInforme();
  await P("PATCH", `/medico/informes/${bor5}`, tk, { estudiosIncluidos: [placa._id, suelta._id] });
  r = await P("GET", `/medico/informes/${bor5}/completo`, tk);
  const hoy = r.cuerpo?.estudios?.find(e => e._id === String(placa._id));
  verificar("un borrador con la misma placa la muestra como está hoy", hoy?.ajustesVisor?.contraste === 300 && hoy.ajustesVisor.invertido === true);
  r = await P("DELETE", `/medico/estudios/${placa._id}`, tk);
  const codigo5 = (await M.Informe.findById(id5).lean()).codigo;
  verificar(`borrar una imagen de un informe firmado → 409, y dice cuál (${r.cuerpo?.error})`, r.estado === 409 && r.cuerpo.error.includes(codigo5));
  r = await P("GET", `/informe-publico/${token5}/imagen/${placa._id}`);
  verificar("  ...la imagen sigue en el disco y cargando en el enlace del paciente",
    r.estado === 200 && (await M.Estudio.exists({ _id: placa._id })) && fs.existsSync(path.join(DIR_ESTUDIOS, placa.archivoNombre)));
  r = await P("DELETE", `/medico/estudios/${suelta._id}`, tk);
  verificar("una que va solo en un borrador, sí se borra", r.estado === 200 && !(await M.Estudio.exists({ _id: suelta._id })));

  // Firmado con el código de antes de esto: con el membrete y el paciente
  // congelados, sin las imágenes.
  await M.Informe.create({ pacienteId: pac._id, medicoPhone: MED, codigo: "INF-SINIMG", conclusion: "Normal", estado: "firmado",
    firmadoEn: new Date("2026-10-10"), tokenPublico: "token-firmado-sin-imagenes-0001", tokenExpira: new Date(Date.now() + 86400000),
    membreteEmitido: i2.membreteEmitido, pacienteEmitido: i2.pacienteEmitido, estudiosIncluidos: [placa._id] });
  r = await P("GET", "/informe-publico/token-firmado-sin-imagenes-0001");
  verificar("un firmado de antes, sin las imágenes congeladas: se ve con las de hoy (como hasta ahora)", r.cuerpo?.estudios?.[0]?.ajustesVisor?.contraste === 300);
  const n5 = await rutas.congelarInformesFirmados();
  await P("PATCH", `/medico/estudios/${placa._id}/visor`, tk, { ajustesVisor: { contraste: 50 } });
  r = await P("GET", "/informe-publico/token-firmado-sin-imagenes-0001");
  verificar(`al arrancar se le congelan (${n5}), con las que mostraba; después ya no cambian`,
    n5 === 1 && r.cuerpo?.estudios?.[0]?.ajustesVisor?.contraste === 300 && r.cuerpo.estudios[0]._id === String(placa._id));
  verificar("  ...y arrancar otra vez no congela nada más", (await rutas.congelarInformesFirmados()) === 0);

  console.log("\n── 6. Un cambio del borrador que se cruza con la firma ──");
  // El PATCH lee el informe, busca las imágenes que le mandaron y recién ahí
  // guarda. Se lo frena en esa búsqueda y se firma en el medio: es tocar una
  // miniatura mientras el «firmar» está en vuelo, o firmar en otra pestaña.
  const findOriginal = M.Estudio.find;
  let freno = null;
  M.Estudio.find = function (filtro, ...resto) {
    const q = findOriginal.call(this, filtro, ...resto);
    if (freno && filtro?.pacienteId) {
      const f = freno; freno = null;
      const exec = q.exec.bind(q);
      q.exec = async (...a) => { f.llego(); await f.soltar; return exec(...a); };
    }
    return q;
  };
  const cruce = async (cuerpo) => {
    const id = await nuevoInforme("Conclusión que se firmó.");
    await P("PATCH", `/medico/informes/${id}`, tk, { estudiosIncluidos: [placa._id] });
    let llego, soltar;
    freno = { llego: null, soltar: new Promise(r => { soltar = r; }) };
    const enElMedio = new Promise(r => { llego = r; });
    freno.llego = llego;
    const patch = P("PATCH", `/medico/informes/${id}`, tk, { conclusion: "Otra conclusión.", hallazgos: "Otros hallazgos.", ...cuerpo });
    await enElMedio;
    const firma = await P("POST", `/medico/informes/${id}/firmar`, tk);
    soltar();
    return { id, firma, patch: await patch, guardado: await M.Informe.findById(id).lean() };
  };
  const otraPlaca = await nuevaImagen("Tórax oblicua");
  let c = await cruce({ estudiosIncluidos: [placa._id, otraPlaca._id] });
  verificar(`cambiando también las imágenes: firma (${c.firma.estado}) y el cambio que llega tarde → 409 (${c.patch.estado})`,
    c.firma.estado === 200 && c.patch.estado === 409);
  verificar("  ...el firmado sigue con su conclusión, sus hallazgos y su lista de imágenes",
    c.guardado.estado === "firmado" && c.guardado.conclusion === "Conclusión que se firmó." && !c.guardado.hallazgos
    && c.guardado.estudiosIncluidos.map(String).join() === String(placa._id) && c.guardado.estudiosEmitidos.length === 1);
  r = await P("GET", `/informe-publico/${c.firma.cuerpo.enlace.split("/informe/")[1]}`);
  verificar("  ...y es lo que ve el paciente", r.cuerpo?.informe?.conclusion === "Conclusión que se firmó." && r.cuerpo.estudios.length === 1);
  c = await cruce({ estudiosIncluidos: [placa._id] });
  verificar(`solo el texto (la misma lista): también 409 (${c.patch.estado}), y lo firmado no cambia`,
    c.firma.estado === 200 && c.patch.estado === 409 && c.guardado.conclusion === "Conclusión que se firmó.");
  M.Estudio.find = findOriginal;
  const bor6 = await nuevoInforme();
  r = await P("PATCH", `/medico/informes/${bor6}`, tk, { conclusion: "Un borrador se sigue editando.", estudiosIncluidos: [placa._id] });
  verificar("un borrador, sin nadie firmando, se sigue editando", r.estado === 200 && r.cuerpo.informe.conclusion === "Un borrador se sigue editando.");

  for (const e of [placa, otraPlaca]) fs.rmSync(path.join(DIR_ESTUDIOS, e.archivoNombre), { force: true });

  console.log("\n── 7. Una corrección apunta a un informe del mismo paciente ──");
  // Un firmado no se edita: se hace otro que lo corrige. Ese «corrige a»
  // se guardaba sin mirar (informe de QA del 16 de octubre de 2026, M13).
  r = await P("POST", `/medico/pacientes/${pac._id}/informes`, tk, { titulo: "Corrección", corrigeA: id1 });
  verificar("corregir un informe de este paciente → 201, apuntando a él", r.estado === 201 && r.cuerpo.informe.corrigeA === id1);
  const otroPac = await M.Paciente.create({ medicoPhone: MED, nombre: "Otro paciente" });
  const deOtro = (await P("POST", `/medico/pacientes/${otroPac._id}/informes`, tk, {})).cuerpo.informe._id;
  const cuantos = await M.Informe.countDocuments({ medicoPhone: MED });
  for (const [que, valor] of [["un id mal formado", "no-es-un-id"], ["uno que no existe", "6500000000000000000000aa"],
    ["uno de otro paciente", deOtro], ["algo que no es un id", { $ne: null }]]) {
    r = await P("POST", `/medico/pacientes/${pac._id}/informes`, tk, { titulo: "Corrección", corrigeA: valor });
    verificar(`  ${que} → 404 (${r.estado})`, r.estado === 404);
  }
  verificar("  ...y ninguno de esos creó un informe", (await M.Informe.countDocuments({ medicoPhone: MED })) === cuantos);

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
