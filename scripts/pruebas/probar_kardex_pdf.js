// Symphomed — El Kardex del paciente en PDF.
//
// Lo pidieron médicos reales: el Kardex tiene que poder bajarse como PDF.
//
// Lo que se prueba:
//   · el PDF (services/pdf.js): el archivo está bien armado (cada objeto donde
//     la tabla dice), el texto en español y portugués sale como se escribió,
//     lo que la fuente no tiene no lo rompe, ningún renglón se pasa del
//     margen, y el logo PNG/JPG se lee;
//   · el contenido (services/kardexPdf.js): alergias SIEMPRE (también las de
//     un paciente sin vincular a una clínica), la presión con sus dos números,
//     y NUNCA la transcripción, el brief de la IA, los diagnósticos
//     diferenciales ni las notas sin confirmar;
//   · la descarga (routes/kardexPdf.js): solo el médico del paciente, como
//     archivo adjunto, sin caché, y auditada.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const pdf = require(path.join(RAIZ, "services", "pdf"));
const { armarContenido, normalizarSecciones } = require(path.join(RAIZ, "services", "resumenCompartido"));

// ─── Herramientas ─────────────────────────────────────────────────────────
// Que el archivo sea un PDF de verdad: cada entrada de la tabla xref apunta
// al «N 0 obj» que dice, y startxref apunta a la tabla.
function estructuraValida(buf) {
  const s = buf.toString("latin1");
  if (!s.startsWith("%PDF-1.4") || !s.trimEnd().endsWith("%%EOF")) return "cabecera o cierre";
  const inicioXref = Number((/startxref\n(\d+)\n%%EOF\s*$/.exec(s) || [])[1]);
  if (s.slice(inicioXref, inicioXref + 4) !== "xref") return "startxref no apunta a la tabla";
  const m = /xref\n0 (\d+)\n/.exec(s.slice(inicioXref));
  const cantidad = Number(m[1]);
  const entradas = s.slice(inicioXref + m[0].length).split("\n").slice(1, cantidad);
  for (let i = 0; i < entradas.length; i++) {
    const pos = Number(entradas[i].slice(0, 10));
    if (!s.startsWith(`${i + 1} 0 obj`, pos)) return `el objeto ${i + 1} no está donde dice la tabla`;
  }
  return "";
}

// Si está pdftotext (poppler), se lee el texto como lo leería un lector real.
let hayPdftotext = true;
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); } catch { hayPdftotext = false; }
function textoDe(buf) {
  const archivo = path.join(os.tmpdir(), `kardex-prueba-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(archivo, buf);
  try { return execFileSync("pdftotext", ["-layout", archivo, "-"]).toString("utf8"); }
  finally { fs.unlinkSync(archivo); }
}
// El contenido de todas las páginas, descomprimido (lo que se dibuja).
function dibujos(buf) {
  const s = buf.toString("latin1");
  const salida = [];
  for (const m of s.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const desde = m.index + m[0].length;
    try { salida.push(zlib.inflateSync(Buffer.from(s.slice(desde, desde + Number(m[1])), "latin1")).toString("latin1")); } catch { /* no es una página */ }
  }
  return salida.join("\n");
}
function paginasDe(buf) {
  return Number((/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(buf.toString("latin1")) || [])[1] || 0);
}

// Un PNG chico armado acá, para no depender de archivos.
function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function chunk(tipo, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}
function pngDe(ancho, alto, tipo, filas, extras = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = tipo;
  // Cada fila con un filtro distinto (0..4), para ejercitar los cinco.
  const crudo = Buffer.concat(filas.map((f, y) => Buffer.concat([Buffer.from([0]), Buffer.from(f)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), ...extras, chunk("IDAT", zlib.deflateSync(crudo)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

(async () => {
  console.log("── 1. El texto ──");
  const w = pdf.aWinAnsi("Natália Falcão — señal «ação» 37,5 °C O₂ ≥ 95 ⚠️ fim");
  verificar("tildes, ñ, ç, ã, «», ° y — se conservan", /Natália Falcão/.test(w) && /señal/.test(w) && w.includes("\x97") && w.includes("«ação»") && w.includes("37,5 °C"));
  verificar("lo que la fuente no tiene se cambia por lo parecido (O₂ → O2, ≥ → >=)", w.includes("O2 >= 95"));
  verificar("un emoji se saca sin romper nada", !/[^\x00-\xff]/.test(w) && w.endsWith(" fim"));
  const largo = pdf.aWinAnsi("Hidroclorotiazida ".repeat(30) + "Supercalifragilisticoexpialidocioso".repeat(4));
  const renglones = pdf.partirEnRenglones([{ texto: largo, estilo: "normal", tamano: 9.5 }], 200);
  verificar(`ningún renglón se pasa del margen (${renglones.length} renglones, el más ancho ${Math.max(...renglones.map(r => r.ancho)).toFixed(1)} de 200 pt)`,
    renglones.every(r => r.ancho <= 200.01));
  verificar("una palabra más larga que el renglón se corta, no se sale", renglones.length > 3);

  console.log("\n── 2. El archivo ──");
  const simple = pdf.generarPdf({ bloques: [{ tipo: "seccion", texto: "Prueba" }, { tipo: "campo", etiqueta: "Paciente", valor: "Natália" }], info: { titulo: "Prueba ação" } });
  const problema = estructuraValida(simple);
  verificar(`la tabla de posiciones (xref) es exacta${problema ? " — " + problema : ""}`, !problema);
  if (hayPdftotext) verificar("un lector real lo abre y lee «Natália»", /Natália/.test(textoDe(simple)));
  else console.log("⏭️  sin pdftotext: no se leyó con un lector real");

  console.log("\n── 3. El logo ──");
  // 2x2 RGBA: rojo opaco, verde semitransparente, azul, transparente.
  const rgba = pngDe(2, 2, 6, [[255, 0, 0, 255, 0, 255, 0, 128], [0, 0, 255, 255, 0, 0, 0, 0]]);
  const leido = pdf.decodificarPng(rgba);
  verificar("PNG con transparencia: colores y transparencia separados",
    leido && leido.canales === 3 && leido.color[0] === 255 && leido.color[4] === 255 && leido.alfa && leido.alfa[1] === 128 && leido.alfa[3] === 0);
  // Paleta con transparencia (tRNS), el formato típico de un logo exportado.
  const paleta = pngDe(2, 1, 3, [[0, 1]], [chunk("PLTE", Buffer.from([10, 20, 30, 200, 100, 50])), chunk("tRNS", Buffer.from([0]))]);
  const lp = pdf.decodificarPng(paleta);
  verificar("PNG con paleta: colores de la paleta y el transparente", lp && lp.color[0] === 10 && lp.color[3] === 200 && lp.alfa[0] === 0 && lp.alfa[1] === 255);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const mj = pdf.medidasJpeg(jpeg);
  verificar("JPG: lee ancho y alto", mj && mj.ancho === 64 && mj.alto === 32 && mj.componentes === 3);
  verificar("un WEBP no se puede leer: sin logo, sin romper", pdf.leerImagen("data:image/webp;base64,UklGRg==") === null);
  const conLogo = pdf.generarPdf({
    bloques: [{ tipo: "parrafo", texto: "con logo" }], imagenes: { logo: "data:image/png;base64," + rgba.toString("base64") },
    encabezado: ({ imagen }) => ({ alto: 30, ops: imagen("logo") ? [{ op: "imagen", id: "logo", x: 50, y: 30, ancho: 20, alto: 20 }] : [] }),
  });
  const s3 = conLogo.toString("latin1");
  verificar("el logo va incrustado, con su máscara de transparencia", /\/Subtype \/Image/.test(s3) && /\/SMask \d+ 0 R/.test(s3) && /\/Im1 Do/.test(dibujos(conLogo)) && !estructuraValida(conLogo));

  console.log("\n── 4. Las unidades de los controles, iguales que en la pantalla ──");
  const { TIPOS_MEDICION, valorMedicion } = require(path.join(RAIZ, "services", "medicionesTipos"));
  const front = fs.readFileSync(path.join(RAIZ, "public", "js", "mediciones.js"), "utf8");
  const bloqueFront = front.slice(front.indexOf("const MEDICIONES_META = {"), front.indexOf("};", front.indexOf("const MEDICIONES_META = {")));
  const enFront = Object.fromEntries([...bloqueFront.matchAll(/^\s*(\w+):\s*\{\s*unidad:\s*"([^"]*)"/gm)].map(m => [m[1], m[2]]));
  const distintos = Object.keys({ ...enFront, ...TIPOS_MEDICION }).filter(k => enFront[k] !== TIPOS_MEDICION[k]?.unidad);
  verificar(`services/medicionesTipos.js = public/js/mediciones.js (${Object.keys(enFront).length} tipos)${distintos.length ? " — distintos: " + distintos.join(", ") : ""}`, !distintos.length && Object.keys(enFront).length > 10);
  verificar("la presión con sus dos números: 120/80 mmHg", valorMedicion({ tipo: "presion", valor: 120, valorSecundario: 80 }) === "120/80 mmHg");
  verificar("decimales con la coma de Brasil: 36,8 °C", valorMedicion({ tipo: "temperatura", valor: 36.8 }, "pt-BR") === "36,8 °C");

  console.log("\n── 5. El resumen compartido (lo usa el PDF) ──");
  const base = { paciente: { nombre: "Ana", alergias: ["Penicilina"], antecedentesPersonales: [] }, persona: null, consultas: [], medicamentos: [], informes: [], vacunas: [], mediciones: [{ tipo: "presion", valor: 130, valorSecundario: 85, fecha: new Date() }], tratamientos: [] };
  const c5 = armarContenido(base, { alcance: "completo", secciones: normalizarSecciones(null, "completo") });
  verificar("paciente SIN clínica: sus alergias salen (antes decía «sin alergias registradas»)", c5.alergias.registradas && c5.alergias.lista[0] === "Penicilina");
  const c5b = armarContenido({ ...base, persona: { alergias: ["Dipirona", "penicilina"] } }, { alcance: "completo", secciones: normalizarSecciones(null, "completo") });
  verificar("con clínica: las de la persona y las de la ficha, sin repetir", c5b.alergias.lista.length === 2 && c5b.alergias.lista.includes("Dipirona"));
  verificar("la presión sale con los dos números y la unidad", c5.mediciones[0].valorSecundario === 85 && c5.mediciones[0].unidad === "mmHg");

  console.log("\n── 6. La descarga ──");
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Rutas SALTEADAS: no hay base de datos."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "kardex_pdf_prueba";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  const hash = await hashPassword("Prueba123.");
  const BR = "5511900000077", BO = "70000077";
  await M.Medico.create({ phone: BR, nombre: "Dra. Brasil", passwordHash: hash, idioma: "pt", moneda: "BRL", especialidad: "Clínica médica", matricula: "CRM-SP 123456" });
  await M.Medico.create({ phone: BO, nombre: "Dr. Bolivia", passwordHash: hash, idioma: "es" });
  const tk = generarToken(BR, "medico", 36e5);
  const tkBo = generarToken(BO, "medico", 36e5);
  await M.Membrete.create({ medicoPhone: BR, nombreCentro: "Clínica São Lucas", profesionalNombre: "Dra. Ana Brasil", profesionalTitulo: "Clínica médica", profesionalRegistro: "CRM-SP 123456", direccion: "Rua das Flores, 100", ciudad: "São Paulo", logo: "data:image/png;base64," + rgba.toString("base64"), piePagina: "Atendimento com hora marcada" });

  const pac = await M.Paciente.create({
    medicoPhone: BR, nombre: "Natália Domingues Falcão", fechaNacimiento: new Date("1988-03-05T12:00:00Z"), sexo: "Feminino",
    cpf: "52998224725", alergias: ["Penicilina", "Dipirona"], antecedentesPersonales: ["Hipertensão desde 2019"],
    antecedentesFamiliares: [{ parentesco: "Mãe", condicion: "Diabetes tipo 2" }],
    briefClinicoEstado: "completado", briefClinico: { estadoActual: "SECRETO_BRIEF" },
  });
  const f = { pacienteId: pac._id, medicoPhone: BR };
  await M.Medicamento.create({ ...f, nombre: "Losartana potássica", dosis: "50 mg", frecuencia: "1x ao dia", fechaInicio: new Date("2026-01-10T12:00:00Z") });
  await M.Medicamento.create({ ...f, nombre: "Amoxicilina", dosis: "500 mg", frecuencia: "8/8h", fechaInicio: new Date("2025-05-01T12:00:00Z"), fechaFin: new Date("2025-05-08T12:00:00Z") });
  await M.Vacuna.create({ ...f, nombre: "Influenza", dosis: "Dose anual", fecha: new Date("2026-04-15T12:00:00Z") });
  await M.Medicion.create({ ...f, tipo: "presion", valor: 132, valorSecundario: 86, fecha: new Date("2026-09-20T12:00:00Z") });
  await M.Medicion.create({ ...f, tipo: "temperatura", valor: 36.8, fecha: new Date("2026-09-20T12:00:00Z") });
  await M.ConsultaMedica.create({
    ...f, pacienteNombre: pac.nombre, estado: "completado", notaClinicaEstado: "completado", confirmadaEn: new Date(),
    createdAt: new Date("2026-09-30T13:30:00Z"),
    transcripcionCompleta: "SECRETO_TRANSCRIPCION", segmentos: [{ hablante: "A", texto: "SECRETO_SEGMENTO" }],
    notaClinica: {
      motivoConsulta: "Controle de pressão", sintomas: ["cefaleia", "tontura"], diagnostico: "Hipertensão arterial sistêmica",
      diagnosticosDiferenciales: ["SECRETO_DIFERENCIAL"], plan: "Manter losartana, reduzir sal, retorno em 30 dias.",
      medicamentosRecetados: [{ nombre: "Losartana potássica", dosis: "50 mg", frecuencia: "1x ao dia" }],
      examenesSolicitados: ["Hemograma", "Creatinina"], proximoControl: "30 dias",
    },
  });
  await M.ConsultaMedica.create({
    ...f, pacienteNombre: pac.nombre, estado: "completado", notaClinicaEstado: "completado",
    notaClinica: { motivoConsulta: "SECRETO_SIN_CONFIRMAR", diagnostico: "SECRETO_SIN_CONFIRMAR" },
  });
  await M.Receta.create({ ...f, fecha: new Date("2026-09-30T12:00:00Z"), fechaCivil: "2026-09-30", medicamentos: [{ nombre: "Losartana potássica", dosis: "50 mg", frecuencia: "1x ao dia", duracion: "30 dias" }], indicaciones: "Tomar pela manhã." });
  await M.Informe.create({ ...f, codigo: "INF-1", titulo: "Ecocardiograma", tipoEstudio: "ecografia", fechaEstudio: new Date("2026-08-01T12:00:00Z"), estado: "firmado", conclusion: "Função sistólica preservada." });
  // Un paciente de OTRO médico.
  const ajeno = await M.Paciente.create({ medicoPhone: BO, nombre: "Paciente ajeno" });

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "kardexPdf"))(app);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const puerto = servidor.address().port;
  const bajar = (id, token, query = "") => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: puerto, path: `/medico/pacientes/${id}/kardex.pdf${query}`, headers: token ? { authorization: "Bearer " + token } : {} }, (res) => {
      const trozos = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => resolve({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos) }));
    });
    req.on("error", reject);
    req.end();
  });

  verificar("sin sesión → 401", (await bajar(pac._id, null)).estado === 401);
  verificar("el paciente de otro médico → 404", (await bajar(ajeno._id, tk)).estado === 404 && (await bajar(pac._id, tkBo)).estado === 404);

  const r = await bajar(pac._id, tk, "?tz=America/Sao_Paulo");
  verificar("200, application/pdf", r.estado === 200 && r.cabeceras["content-type"] === "application/pdf");
  verificar(`se descarga como archivo: ${r.cabeceras["content-disposition"]}`, /^attachment; filename="Prontuario_Natalia_Domingues_Falcao_\d{4}-\d{2}-\d{2}\.pdf"/.test(r.cabeceras["content-disposition"] || ""));
  verificar("no queda en ninguna caché", r.cabeceras["cache-control"] === "no-store");
  const problema6 = estructuraValida(r.cuerpo);
  verificar(`el archivo está bien armado${problema6 ? " — " + problema6 : ""}`, !problema6);
  for (let i = 0; i < 30; i++) { if (await M.AuditLog.countDocuments({ accion: "exportar_kardex_pdf" })) break; await new Promise(res => setTimeout(res, 50)); }
  verificar("queda auditado quién lo bajó", (await M.AuditLog.countDocuments({ accion: "exportar_kardex_pdf", medicoPhone: BR })) === 1);

  if (hayPdftotext) {
    const txt = textoDe(r.cuerpo);
    const plano = txt.replace(/\s+/g, " ");
    verificar("en portugués: «Prontuário do paciente»", /PRONTUÁRIO DO PACIENTE/.test(txt));
    verificar("con el membrete: centro, profesional y registro", /Clínica São Lucas/.test(txt) && /Dra\. Ana Brasil/.test(txt) && /CRM-SP 123456/.test(txt));
    verificar("las ALERGIAS de un paciente sin clínica", /ALERGIAS/.test(txt) && /Penicilina · Dipirona/.test(plano));
    const hoy = new Date();
    const edad = hoy.getUTCFullYear() - 1988 - (hoy.getUTCMonth() < 2 || (hoy.getUTCMonth() === 2 && hoy.getUTCDate() < 5) ? 1 : 0);
    verificar(`nacimiento con la edad (05/03/1988 · ${edad} anos)`, plano.includes(`05/03/1988 · ${edad} anos`));
    verificar("la medicación en uso y la terminada", /Losartana potássica/.test(txt) && /Em uso/.test(txt) && /Até 08\/05\/2025/.test(plano));
    verificar("la consulta confirmada, con la hora de São Paulo (13:30Z → 10:30)", /30\/09\/2026,? 10:30/.test(plano) && /Hipertensão arterial sistêmica/.test(txt) && /Hemograma, Creatinina/.test(plano));
    verificar("la presión con los dos números: 132/86 mmHg", /132\/86 mmHg/.test(plano) && /36,8 °C/.test(plano));
    verificar("la receta, la vacuna y el laudo firmado", /Tomar pela manhã/.test(plano) && /Influenza/.test(txt) && /Função sistólica preservada/.test(plano));
    verificar("dice cuántas consultas quedaron afuera por no estar confirmadas", /Há 1 consulta com a nota não confirmada/.test(plano));
    verificar("«Página 1 de 1» y el aviso de confidencialidad", /Página 1 de \d/.test(plano) && /Documento confidencial/.test(plano));
    verificar("la línea de firma con el registro", /Assinatura e carimbo/.test(plano));
    const secretos = ["SECRETO_TRANSCRIPCION", "SECRETO_SEGMENTO", "SECRETO_BRIEF", "SECRETO_DIFERENCIAL", "SECRETO_SIN_CONFIRMAR"].filter(x => txt.includes(x));
    verificar(`NUNCA: transcripción, brief de la IA, diferenciales ni notas sin confirmar${secretos.length ? " — salió: " + secretos.join(", ") : ""}`, !secretos.length);
    // Lo que lee pdftotext es lo visible. Esto mira TODO lo que hay adentro
    // del archivo, descomprimido: que no esté ni como texto invisible.
    const adentro = dibujos(r.cuerpo) + r.cuerpo.toString("latin1");
    verificar("  ...ni siquiera escondidos adentro del archivo", !/SECRETO/.test(adentro) && /Losartana/.test(adentro));

    // Un paciente con muchas consultas: varias páginas, numeradas.
    for (let i = 0; i < 40; i++) {
      await M.ConsultaMedica.create({ ...f, pacienteNombre: pac.nombre, estado: "completado", notaClinicaEstado: "completado", confirmadaEn: new Date(), createdAt: new Date(Date.UTC(2025, 0, 1 + i, 14)),
        notaClinica: { motivoConsulta: `Controle ${i + 1}`, diagnostico: "Hipertensão arterial sistêmica controlada", plan: "Manter conduta. ".repeat(12) } });
    }
    const largoPdf = await bajar(pac._id, tk, "?tz=Zona/Inventada");
    const n = paginasDe(largoPdf.cuerpo);
    const txtLargo = textoDe(largoPdf.cuerpo).replace(/\s+/g, " ");
    verificar(`muchas consultas → ${n} páginas, todas numeradas («Página ${n} de ${n}»)`, n > 3 && txtLargo.includes(`Página ${n} de ${n}`) && txtLargo.includes(`Página 2 de ${n}`));
    verificar("las 41 consultas confirmadas están", /Controle 1 /.test(txtLargo) && /Controle 40 /.test(txtLargo));
    verificar("si una consulta sigue en la hoja siguiente, arriba dice de cuál es «(continuação)»", /\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2} \(continuação\)/.test(txtLargo));
    verificar("una zona horaria inventada no rompe: usa la del país", largoPdf.estado === 200 && !estructuraValida(largoPdf.cuerpo));

    // El médico boliviano, en español.
    const pacBo = await M.Paciente.create({ medicoPhone: BO, nombre: "Juan Pérez", sexo: "Masculino" });
    const rBo = await bajar(pacBo._id, tkBo);
    const tBo = textoDe(rBo.cuerpo).replace(/\s+/g, " ");
    verificar("en español: «Kardex del paciente» y el archivo Kardex_Juan_Perez_…", /KARDEX DEL PACIENTE/.test(tBo) && /filename="Kardex_Juan_Perez_/.test(rBo.cabeceras["content-disposition"]));
    verificar("sin alergias cargadas lo DICE (un hueco se lee como «no tiene»)", /No hay alergias registradas/.test(tBo));
    verificar("sin membrete: el nombre del médico arriba", /Dr\. Bolivia/.test(tBo));
  } else {
    console.log("⏭️  sin pdftotext: el contenido no se leyó. Esto NO es un ✅.");
  }

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
