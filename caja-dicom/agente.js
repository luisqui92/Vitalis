#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Caja Symphomed — el puente entre Orthanc y Symphomed
// ═══════════════════════════════════════════════════════════════════════════
// Corre en la caja de la clínica, al lado de Orthanc. Orthanc recibe los
// estudios de los equipos por C-STORE y los guarda en el disco local; este
// programa mira lo que va llegando y le manda a Symphomed dos cosas:
//
//   · la metadata (unos cientos de bytes)
//   · una vista previa en PNG
//
// El .dcm original de 16 bits NO se manda. Se queda acá, que es todo el
// punto: subir una tomografía entera por el enlace de una clínica es hacer
// esperar a todo el mundo, y el médico la necesita ahora, no en veinte
// minutos.
//
// Sin dependencias a propósito: solo lo que trae Node. En una máquina que
// tiene que andar sola dos años en un consultorio, cada paquete de npm es
// algo más que se puede romper en una actualización.
//
// Uso:
//   node agente.js                 (lee config.json de al lado, queda corriendo)
//   node agente.js --una-vuelta    (revisa una vez y sale)
//   VITALIS_URL=... TOKEN=... node agente.js
//
// Se apaga con Ctrl+C y al volver sigue donde iba: lo que ya subió está
// anotado en subidos.json y no se vuelve a mandar.
//
// El modo de una vuelta es para quien prefiere programarlo con el
// Programador de tareas de Windows en vez de dejarlo corriendo como
// servicio — y es lo que usan las pruebas.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────
const DIR = __dirname;
const cfg = (() => {
  const archivo = path.join(DIR, "config.json");
  let base = {};
  if (fs.existsSync(archivo)) {
    try { base = JSON.parse(fs.readFileSync(archivo, "utf8")); }
    catch (e) { salirCon(`config.json no es JSON válido: ${e.message}`); }
  }
  return {
    // VITALIS_URL y vitalisUrl conservan el nombre viejo a propósito: viven en
    // los config.json de los agentes YA instalados en las clínicas. Renombrarlos
    // deja de leer la configuración sin dar ningún error, y el equipo se queda
    // mudo hasta que alguien note que falta un estudio.
    vitalisUrl: process.env.VITALIS_URL || base.vitalisUrl || "",
    token: process.env.TOKEN || base.token || "",
    orthanc: process.env.ORTHANC_URL || base.orthanc || "http://127.0.0.1:8042",
    orthancUsuario: process.env.ORTHANC_USER || base.orthancUsuario || "",
    orthancClave: process.env.ORTHANC_PASS || base.orthancClave || "",
    segundos: Number(process.env.SEGUNDOS || base.segundos) || 10,
    // Por encima de este ancho la vista previa se pide achicada. Una
    // panorámica de 3000 px no aporta nada extra en pantalla y multiplica
    // por diez lo que sube. La escala se manda junto con la imagen para que
    // las mediciones sigan dando milímetros correctos.
    anchoMaxPreview: Number(process.env.ANCHO_MAX || base.anchoMaxPreview) || 1600,
  };
})();

function salirCon(msg) {
  console.error("\n  ✖ " + msg + "\n");
  process.exit(1);
}
if (!cfg.vitalisUrl) salirCon("Falta la dirección de Symphomed (vitalisUrl en config.json o VITALIS_URL).");
if (!cfg.token) salirCon("Falta el token del equipo (token en config.json o TOKEN). Se saca de Symphomed → Equipos de rayos.");

const ARCHIVO_SUBIDOS = path.join(DIR, "subidos.json");
const UNA_VUELTA = process.argv.includes("--una-vuelta") || process.env.UNA_VUELTA === "1";
const ahora = () => new Date().toLocaleTimeString("es-BO", { hour12: false });
const log = (...a) => console.log(`[${ahora()}]`, ...a);

// ─── LO QUE YA SE SUBIÓ ───────────────────────────────────────────────────
// Se guarda el SOPInstanceUID, no el id interno de Orthanc: el UID es el
// identificador de la imagen en el mundo, así que sigue sirviendo aunque
// algún día haya que reinstalar Orthanc y volver a cargar el archivo.
let subidos = new Set();
function cargarSubidos() {
  if (!fs.existsSync(ARCHIVO_SUBIDOS)) return;
  try { subidos = new Set(JSON.parse(fs.readFileSync(ARCHIVO_SUBIDOS, "utf8"))); }
  catch { log("⚠ subidos.json ilegible, se arranca de cero (puede haber reenvíos; Symphomed los descarta igual)"); }
}
let guardadoPendiente = null;
function anotarSubido(uid) {
  subidos.add(uid);
  // Se escribe agrupado: con una tomografía de 400 cortes, grabar el archivo
  // 400 veces por segundo castiga al disco sin necesidad.
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    fs.writeFile(ARCHIVO_SUBIDOS, JSON.stringify([...subidos]), (e) => {
      if (e) log("⚠ no se pudo guardar subidos.json:", e.message);
    });
  }, 1500);
}

// ─── HTTP ─────────────────────────────────────────────────────────────────
function pedir(url, { metodo = "GET", cabeceras = {}, cuerpo = null, binario = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: metodo, headers: cabeceras, timeout: 120000 }, (res) => {
      const trozos = [];
      res.on("data", (t) => trozos.push(t));
      res.on("end", () => {
        const buf = Buffer.concat(trozos);
        resolve({ estado: res.statusCode, cuerpo: binario ? buf : buf.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("tiempo de espera agotado")); });
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

const authOrthanc = cfg.orthancUsuario
  ? { Authorization: "Basic " + Buffer.from(`${cfg.orthancUsuario}:${cfg.orthancClave}`).toString("base64") }
  : {};

async function orthancJson(ruta) {
  const r = await pedir(cfg.orthanc + ruta, { cabeceras: authOrthanc });
  if (r.estado !== 200) throw new Error(`Orthanc ${ruta} respondió ${r.estado}`);
  return JSON.parse(r.cuerpo);
}
async function orthancBinario(ruta) {
  const r = await pedir(cfg.orthanc + ruta, { cabeceras: authOrthanc, binario: true });
  if (r.estado !== 200) throw new Error(`Orthanc ${ruta} respondió ${r.estado}`);
  return r.cuerpo;
}

// ─── LECTURA DE LOS TAGS ──────────────────────────────────────────────────
// De todo lo que trae un DICOM, esto es lo que Symphomed necesita. El resto se
// queda en el archivo, que es donde tiene que estar.
function primerNumero(v) {
  if (v == null) return null;
  // PixelSpacing viene como "0.0195\\0.0195" — barra invertida, no coma.
  const n = Number(String(v).split("\\")[0].trim());
  return Number.isFinite(n) ? n : null;
}
function segundoNumero(v) {
  if (v == null) return null;
  const partes = String(v).split("\\");
  const n = Number((partes[1] ?? partes[0]).trim());
  return Number.isFinite(n) ? n : null;
}

// PixelSpacing (0028,0030) es [entre filas, entre columnas] = [Y, X].
// ImagerPixelSpacing (0018,1164) es lo mismo pero medido EN EL DETECTOR, que
// es lo único que hay en radiografía proyeccional — y es importante saber de
// cuál de los dos salió: el del detector mide la sombra, no el hueso.
function escalaDe(tags) {
  if (tags.PixelSpacing) {
    return { x: segundoNumero(tags.PixelSpacing), y: primerNumero(tags.PixelSpacing), fuente: "PixelSpacing" };
  }
  if (tags.ImagerPixelSpacing) {
    return { x: segundoNumero(tags.ImagerPixelSpacing), y: primerNumero(tags.ImagerPixelSpacing), fuente: "ImagerPixelSpacing" };
  }
  // Ecografía: la escala no está en PixelSpacing sino en las regiones
  // calibradas, y cada región de la pantalla tiene la suya. No se inventa
  // nada — el estudio entra sin escala y el visor muestra píxeles.
  return { x: null, y: null, fuente: "" };
}

function fechaDicom(f, h) {
  if (!/^\d{8}$/.test(String(f || ""))) return null;
  const s = String(f);
  const hh = /^\d{6}/.test(String(h || "")) ? String(h) : "000000";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${hh.slice(0, 2)}:${hh.slice(2, 4)}:${hh.slice(4, 6)}`;
}

// El nombre en DICOM va como "APELLIDO^NOMBRE^^^" — se deja legible sin
// perder nada de lo que el técnico tipeó.
function nombreLegible(v) {
  return String(v || "").split("^").filter(Boolean).join(" ").trim();
}

function altoAncho(png) {
  // Cabecera IHDR de un PNG: ancho y alto son los bytes 16..24.
  if (png.length > 24 && png.readUInt32BE(0) === 0x89504e47) {
    return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
  }
  return { ancho: null, alto: null };
}

// ─── SUBIR UNA INSTANCIA ──────────────────────────────────────────────────
async function subirInstancia(idOrthanc) {
  const tags = await orthancJson(`/instances/${idOrthanc}/simplified-tags`);
  const uid = String(tags.SOPInstanceUID || "").trim();
  if (!uid) { log("⚠ una instancia sin SOPInstanceUID — se saltea"); return "sin_uid"; }
  if (subidos.has(uid)) return "ya";

  const columnas = Number(tags.Columns) || null;
  const filas = Number(tags.Rows) || null;

  // /rendered y NO /preview: son casi lo mismo, pero /preview IGNORA el
  // ancho que se le pide y devuelve la imagen entera. Con una panorámica de
  // 3000 px eso son casi 3 MB por estudio subidos al pedo — justo lo que la
  // caja existe para evitar. /rendered sí achica.
  let ruta = `/instances/${idOrthanc}/rendered`;
  if (columnas && columnas > cfg.anchoMaxPreview) ruta += `?width=${cfg.anchoMaxPreview}`;
  const previa = await orthancBinario(ruta);

  const dim = altoAncho(previa);
  // La escala se calcula con lo que REALMENTE salió, no con lo que se pidió:
  // si Orthanc ignoró el parámetro, el número tiene que seguir siendo cierto.
  const escalaPreview = dim.ancho && columnas ? dim.ancho / columnas : 1;

  const esc = escalaDe(tags);
  const meta = {
    sopInstanceUID: uid,
    seriesInstanceUID: tags.SeriesInstanceUID || "",
    studyInstanceUID: tags.StudyInstanceUID || "",
    modalidad: tags.Modality || "",
    filas, columnas,
    escalaPreview,
    bitsAlmacenados: Number(tags.BitsStored) || null,
    ventanaCentro: primerNumero(tags.WindowCenter),
    ventanaAncho: primerNumero(tags.WindowWidth),
    fabricante: tags.Manufacturer || "",
    modelo: tags.ManufacturerModelName || "",
    pacienteNombre: nombreLegible(tags.PatientName),
    pacienteId: (tags.PatientID || "").trim(),
    descripcionEstudio: tags.StudyDescription || "",
    descripcionSerie: tags.SeriesDescription || "",
    fechaEstudio: fechaDicom(tags.StudyDate, tags.StudyTime),
    espaciadoX: esc.x, espaciadoY: esc.y, fuenteEspaciado: esc.fuente,
  };

  const r = await pedir(cfg.vitalisUrl.replace(/\/+$/, "") + "/equipo/dicom/estudio", {
    metodo: "POST",
    cabeceras: {
      "Content-Type": "image/png",
      "Content-Length": previa.length,
      "X-Equipo-Token": cfg.token,
      "X-Dicom-Meta": Buffer.from(JSON.stringify(meta), "utf8").toString("base64"),
    },
    cuerpo: previa,
  });

  if (r.estado === 201 || r.estado === 200) {
    const d = JSON.parse(r.cuerpo);
    anotarSubido(uid);
    if (d.duplicado) return "duplicado";
    const dónde = d.destino === "paciente" ? `→ ${d.paciente} (por ${d.via})` : "→ bandeja";
    log(`✔ ${meta.modalidad} ${meta.columnas}×${meta.filas} ${dónde}${d.milimetros ? " · con escala" : " · sin escala"}`);
    return d.destino;
  }
  if (r.estado === 401) salirCon("Symphomed rechazó el token del equipo. Revisá el token en config.json.");
  // Cualquier otra cosa: no se anota como subida, se reintenta en la próxima
  // vuelta. Perder un estudio en silencio no es una opción.
  log(`⚠ Symphomed respondió ${r.estado} — se reintenta: ${String(r.cuerpo).slice(0, 160)}`);
  return "error";
}

// ─── VUELTA PRINCIPAL ─────────────────────────────────────────────────────
let corriendo = false;
async function revisar() {
  if (corriendo) return; // una tomografía grande puede tardar más que el intervalo
  corriendo = true;
  try {
    const instancias = await orthancJson("/instances");
    const nuevas = [];
    for (const id of instancias) {
      // Se consultan los tags igual (es barato y local) porque el id interno
      // de Orthanc no dice nada del UID.
      nuevas.push(id);
    }
    let subidas = 0, errores = 0;
    for (const id of nuevas) {
      try {
        const r = await subirInstancia(id);
        if (r === "paciente" || r === "bandeja") subidas++;
        else if (r === "error") errores++;
      } catch (e) {
        errores++;
        log("⚠ falló una instancia:", e.message);
      }
    }
    if (subidas || errores) log(`resumen: ${subidas} subidas, ${errores} con error`);
  } catch (e) {
    log("⚠ no se pudo hablar con Orthanc:", e.message);
  } finally {
    corriendo = false;
  }
}

async function arrancar() {
  cargarSubidos();
  console.log("\n  ┌──────────────────────────────────────────┐");
  console.log("  │  Caja Symphomed · puente DICOM             │");
  console.log("  └──────────────────────────────────────────┘\n");
  log("Orthanc:", cfg.orthanc);
  log("Symphomed:", cfg.vitalisUrl);
  log("Revisando cada", cfg.segundos, "segundos · ya subidos:", subidos.size);

  try {
    const sys = await orthancJson("/system");
    log(`Orthanc ${sys.Version} · AE Title ${sys.DicomAet} · puerto DICOM ${sys.DicomPort}`);
    log(`Los equipos tienen que apuntar a: AE ${sys.DicomAet} · puerto ${sys.DicomPort}`);
  } catch (e) {
    salirCon(`No se pudo hablar con Orthanc en ${cfg.orthanc}: ${e.message}\n    ¿Está corriendo? ¿La dirección es correcta?`);
  }

  console.log("");
  await revisar();
  if (UNA_VUELTA) {
    // Se espera a que termine de escribirse subidos.json antes de salir: si
    // el proceso se va con el guardado en el aire, la próxima vuelta reenvía
    // todo (Symphomed lo descarta igual, pero es tráfico y ruido al pedo).
    if (guardadoPendiente) { clearTimeout(guardadoPendiente); guardadoPendiente = null; }
    fs.writeFileSync(ARCHIVO_SUBIDOS, JSON.stringify([...subidos]));
    log("una vuelta hecha — saliendo");
    process.exit(0);
  }
  setInterval(revisar, Math.max(3, cfg.segundos) * 1000);
}

process.on("SIGINT", () => { log("cerrando — lo subido queda anotado"); process.exit(0); });
arrancar();
