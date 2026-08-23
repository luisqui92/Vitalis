// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — Copias de seguridad
// ═══════════════════════════════════════════════════════════════════════════
// Una copia que nunca se restauró no es una copia: es una carpeta con
// archivos que uno espera que sirvan. Por eso este módulo, después de armar
// cada respaldo, LO RESTAURA de verdad en una base aparte y cuenta los
// documentos. Si no coincide, el respaldo se marca como fallido y el médico
// lo ve en pantalla. Enterarse el día que se cae el disco es tarde.
//
// El volcado lo hace Vitalis solo, sin mongodump: esa herramienta no está
// instalada en el servidor y depender de algo que no está es la mejor forma
// de que el respaldo funcione en la máquina de uno y no en la del cliente.
// Se usa EJSON, que es el formato del propio driver de Mongo y conserva los
// tipos (ObjectId, fechas, binarios) sin pérdida.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { promisify } = require("util");
const { execFile } = require("child_process");
const mongoose = require("mongoose");
const { EJSON } = require("bson");
const { CONFIG, log } = require("../config");

const ejecutar = promisify(execFile);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DIR_BACKUPS = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const DIR_UPLOADS = path.join(__dirname, "..", "uploads");

// Cuántas copias se guardan. Diarias para lo reciente (que es lo que uno
// necesita el 95% de las veces) y una por semana para atrás, que es lo que
// salva cuando el daño se descubre tarde — un borrado por error puede pasar
// desapercibido varios días.
const DIAS_DIARIOS = Number(process.env.BACKUP_DIAS) || 7;
const SEMANAS = Number(process.env.BACKUP_SEMANAS) || 8;

// Cada cuánto corre solo. Por defecto una vez al día.
//
// El tope de una semana no es una preferencia: setInterval de Node guarda la
// espera en 32 bits, así que cualquier valor mayor a ~24 días DESBORDA y el
// temporizador pasa a dispararse cada milisegundo. Un "respaldo mensual" mal
// puesto tumbaría el servidor haciendo respaldos sin parar, en silencio.
const HORAS_INTERVALO = Math.min(168, Math.max(1, Number(process.env.BACKUP_HORAS) || 24));

// A partir de cuántas horas sin respaldo Vitalis lo muestra como problema.
const HORAS_ALERTA = 48;

// ─── CIFRADO ──────────────────────────────────────────────────────────────
// AES-256-GCM: además de cifrar, detecta si el archivo se corrompió o si
// alguien lo tocó — un respaldo alterado sin que nadie se entere sería peor
// que no tenerlo.
//
// Sin BACKUP_CLAVE la copia se guarda sin cifrar. Es deliberado: en el
// propio servidor los datos ya están en claro dentro de Mongo, así que una
// copia local sin cifrar no expone nada nuevo, y tener respaldo sin cifrar
// es infinitamente mejor que no tener respaldo. Lo que SÍ se bloquea es
// mandar una copia sin cifrar fuera del servidor (ver subirAfuera).
const CLAVE = process.env.BACKUP_CLAVE || "";
const MAGIA = Buffer.from("VITALISBK1");

function derivarClave(sal) {
  return crypto.scryptSync(CLAVE, sal, 32);
}

function cifrar(datos) {
  if (!CLAVE) return { buffer: datos, cifrado: false };
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivarClave(sal), iv);
  const cuerpo = Buffer.concat([cipher.update(datos), cipher.final()]);
  // MAGIA + sal + iv + tag + cuerpo — todo en un solo archivo, para no
  // depender de metadatos externos que se pueden perder.
  return { buffer: Buffer.concat([MAGIA, sal, iv, cipher.getAuthTag(), cuerpo]), cifrado: true };
}

function descifrar(buffer) {
  if (!buffer.subarray(0, MAGIA.length).equals(MAGIA)) return buffer; // no estaba cifrado
  if (!CLAVE) throw new Error("El respaldo está cifrado y no hay BACKUP_CLAVE configurada");
  let o = MAGIA.length;
  const sal = buffer.subarray(o, o += 16);
  const iv = buffer.subarray(o, o += 12);
  const tag = buffer.subarray(o, o += 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivarClave(sal), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buffer.subarray(o)), decipher.final()]);
  } catch {
    // El error que tira OpenSSL acá es "Unsupported state or unable to
    // authenticate data", que no le dice nada a nadie — y menos a quien
    // esté leyéndolo a las dos de la mañana con el servidor caído.
    throw new Error(
      "No se pudo abrir el respaldo: la BACKUP_CLAVE no es la correcta, o el archivo está dañado.\n" +
      "  Tiene que ser exactamente la misma clave con la que se hizo el respaldo.\n" +
      "  Si la perdiste, ese respaldo no se puede recuperar — no hay forma de saltear esto."
    );
  }
}

// ─── VOLCADO DE LA BASE ───────────────────────────────────────────────────
async function volcarBaseDeDatos() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("No hay conexión a MongoDB");

  const colecciones = (await db.listCollections().toArray())
    .filter(c => c.type !== "view" && !c.name.startsWith("system."))
    .map(c => c.name)
    .sort();

  const contenido = {};
  const conteos = {};
  for (const nombre of colecciones) {
    const docs = await db.collection(nombre).find({}).toArray();
    conteos[nombre] = docs.length;
    // relaxed:false = EJSON estricto, que distingue enteros de decimales y
    // conserva ObjectId y fechas. En modo relajado se pierden tipos y al
    // restaurar quedan documentos parecidos pero no iguales.
    contenido[nombre] = EJSON.stringify(docs, { relaxed: false });
  }
  return { colecciones, conteos, contenido };
}

// ─── ARCHIVOS DE ESTUDIOS ─────────────────────────────────────────────────
// Las radiografías y los laboratorios viven en disco, no en la base. Un
// respaldo que solo tenga Mongo deja la ficha del paciente apuntando a
// archivos que ya no existen.
async function archivarUploads(destinoTar) {
  if (!fs.existsSync(DIR_UPLOADS)) return { archivos: 0, bytes: 0 };
  let archivos = 0, bytes = 0;
  (function recorrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else { archivos++; bytes += fs.statSync(p).size; }
    }
  })(DIR_UPLOADS);

  if (archivos === 0) return { archivos: 0, bytes: 0 };
  // tar está en cualquier Linux; se usa con rutas relativas para que el
  // respaldo se pueda restaurar en un servidor con otra estructura de
  // carpetas sin tener que editar nada.
  await ejecutar("tar", ["-czf", destinoTar, "-C", path.dirname(DIR_UPLOADS), path.basename(DIR_UPLOADS)], { maxBuffer: 64 * 1024 * 1024 });
  return { archivos, bytes };
}

// ─── HACER UN RESPALDO ────────────────────────────────────────────────────
function nombreDeAhora() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function hacerBackup({ verificar = true } = {}) {
  // Si Mongo está caído o reconectando, no hay nada que respaldar. Sin este
  // chequeo el respaldo automático deja un [ERROR] en el log cada vez que la
  // base tose, y un log lleno de errores rojos que no significan nada es la
  // forma más rápida de que nadie mire el log cuando importe.
  if (mongoose.connection.readyState !== 1) {
    log.warn("[BACKUP] se saltea este respaldo: MongoDB no está conectado ahora mismo");
    return { salteado: true, motivo: "sin_conexion" };
  }

  const arrancó = Date.now();
  await fsp.mkdir(DIR_BACKUPS, { recursive: true });
  const marca = nombreDeAhora();
  const base = path.join(DIR_BACKUPS, `vitalis-${marca}`);

  log.info("[BACKUP] arrancando respaldo", marca);

  // 1. La base
  const volcado = await volcarBaseDeDatos();
  const paquete = {
    version: 1,
    fecha: new Date().toISOString(),
    baseDatos: mongoose.connection.name,
    conteos: volcado.conteos,
    colecciones: volcado.contenido,
  };
  const comprimido = await gzip(Buffer.from(JSON.stringify(paquete), "utf8"));
  const { buffer: datosFinales, cifrado } = cifrar(comprimido);
  const rutaBase = base + ".vitalisbk";
  await fsp.writeFile(rutaBase, datosFinales);

  // 2. Los archivos
  const rutaTar = base + "-archivos.tar.gz";
  const uploads = await archivarUploads(rutaTar);
  let rutaArchivos = null;
  if (uploads.archivos > 0) {
    // El tar también se cifra, con el mismo criterio que la base.
    if (cifrado) {
      const crudo = await fsp.readFile(rutaTar);
      await fsp.writeFile(rutaTar, cifrar(crudo).buffer);
    }
    rutaArchivos = rutaTar;
  }

  const manifiesto = {
    fecha: paquete.fecha,
    marca,
    cifrado,
    baseDatos: paquete.baseDatos,
    conteos: volcado.conteos,
    documentos: Object.values(volcado.conteos).reduce((a, b) => a + b, 0),
    archivoBase: path.basename(rutaBase),
    bytesBase: (await fsp.stat(rutaBase)).size,
    archivoArchivos: rutaArchivos ? path.basename(rutaArchivos) : null,
    archivos: uploads.archivos,
    bytesArchivos: rutaArchivos ? (await fsp.stat(rutaArchivos)).size : 0,
    verificado: null,
    segundos: 0,
  };

  // 3. La verificación: se restaura de verdad y se cuenta.
  if (verificar) {
    try {
      const r = await verificarBackup(rutaBase);
      manifiesto.verificado = r.ok;
      manifiesto.verificacion = r;
      if (!r.ok) log.error("[BACKUP] ⚠️ el respaldo NO pasó la verificación:", r.motivo);
    } catch (e) {
      manifiesto.verificado = false;
      manifiesto.verificacion = { ok: false, motivo: e.message };
      log.error("[BACKUP] ⚠️ no se pudo verificar el respaldo:", e.message);
    }
  }

  manifiesto.segundos = Math.round((Date.now() - arrancó) / 1000);
  await fsp.writeFile(base + ".json", JSON.stringify(manifiesto, null, 2));

  log.info(`[BACKUP] listo: ${manifiesto.documentos} documentos, ${manifiesto.archivos} archivos, ${manifiesto.segundos}s, ${cifrado ? "cifrado" : "SIN CIFRAR"}, verificado=${manifiesto.verificado}`);

  await aplicarRetencion();
  if (manifiesto.verificado !== false) await subirAfuera(manifiesto, [rutaBase, rutaArchivos].filter(Boolean));

  return manifiesto;
}

// ─── VERIFICACIÓN REAL ────────────────────────────────────────────────────
// Se descifra, se descomprime y se INSERTA en una base aparte, y recién
// entonces se cuenta lo que quedó adentro. Cualquier cosa que rompa el
// archivo —un cifrado mal hecho, un gzip cortado, un tipo que no sobrevive
// la ida y vuelta— aparece acá y no el día de la emergencia.
async function verificarBackup(rutaBase) {
  const crudo = await fsp.readFile(rutaBase);
  const paquete = JSON.parse((await gunzip(descifrar(crudo))).toString("utf8"));

  const nombreScratch = `${paquete.baseDatos}__verificacion`;
  const cliente = mongoose.connection.getClient();
  const scratch = cliente.db(nombreScratch);
  await scratch.dropDatabase(); // por si quedó de una corrida anterior

  const diferencias = [];
  try {
    for (const [nombre, texto] of Object.entries(paquete.colecciones)) {
      const docs = EJSON.parse(texto, { relaxed: false });
      if (docs.length) await scratch.collection(nombre).insertMany(docs, { ordered: false });
      const cuantos = await scratch.collection(nombre).countDocuments();
      if (cuantos !== paquete.conteos[nombre]) {
        diferencias.push(`${nombre}: se esperaban ${paquete.conteos[nombre]} y se restauraron ${cuantos}`);
      }
    }

    // Además de contar, se comprueba que los tipos hayan sobrevivido: se
    // toma un documento de cada colección y se verifica que su _id siga
    // siendo un ObjectId y no una cadena de texto. Un respaldo que
    // convierte los _id en texto restaura sin errores y deja la base rota.
    for (const nombre of Object.keys(paquete.colecciones)) {
      if (!paquete.conteos[nombre]) continue;
      const uno = await scratch.collection(nombre).findOne({});
      if (uno && typeof uno._id === "string") diferencias.push(`${nombre}: los _id se restauraron como texto`);
    }
  } finally {
    await scratch.dropDatabase().catch(() => {});
  }

  return diferencias.length
    ? { ok: false, motivo: diferencias.join(" · "), documentos: paquete.conteos }
    : { ok: true, documentos: Object.values(paquete.conteos).reduce((a, b) => a + b, 0), colecciones: Object.keys(paquete.conteos).length };
}

// ─── RETENCIÓN ────────────────────────────────────────────────────────────
// Se conservan todas las de los últimos días y una por semana hacia atrás.
// El respaldo más viejo nunca se borra automáticamente: si algo salió mal
// hace mucho, esa es la última red.
async function aplicarRetencion() {
  const manifiestos = (await listarBackups()).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  if (manifiestos.length <= 1) return;

  const ahora = Date.now();
  const conservar = new Set();
  const semanasVistas = new Set();

  manifiestos.forEach((m, i) => {
    const edadDias = (ahora - new Date(m.fecha).getTime()) / 86400000;
    if (i === 0) conservar.add(m.marca);                       // la última, siempre
    if (i === manifiestos.length - 1) conservar.add(m.marca);  // la más vieja, siempre
    if (edadDias <= DIAS_DIARIOS) { conservar.add(m.marca); return; }
    const semana = Math.floor(edadDias / 7);
    if (semana <= SEMANAS && !semanasVistas.has(semana)) {
      semanasVistas.add(semana);
      conservar.add(m.marca);
    }
  });

  for (const m of manifiestos) {
    if (conservar.has(m.marca)) continue;
    for (const f of [m.archivoBase, m.archivoArchivos, `vitalis-${m.marca}.json`]) {
      if (f) await fsp.unlink(path.join(DIR_BACKUPS, f)).catch(() => {});
    }
    log.info("[BACKUP] borrado por retención:", m.marca);
  }
}

// ─── COPIA FUERA DEL SERVIDOR ─────────────────────────────────────────────
// Un respaldo en el mismo disco que la base NO es un respaldo: protege de un
// borrado por error, no de que el disco se muera. La subida se delega a un
// comando configurable (rclone, aws, scp...) para no atarse a un proveedor
// ni meter un SDK adentro de Vitalis.
//
// BACKUP_COMANDO_SUBIDA="rclone copy {archivo} b2:vitalis-respaldos/"
async function subirAfuera(manifiesto, rutas) {
  const plantilla = process.env.BACKUP_COMANDO_SUBIDA;
  if (!plantilla) return;

  // Mandar afuera datos clínicos sin cifrar es exactamente lo que no hay que
  // hacer, así que esto se frena aunque esté configurado.
  if (!manifiesto.cifrado) {
    log.error("[BACKUP] no se sube afuera: el respaldo no está cifrado (falta BACKUP_CLAVE)");
    return;
  }

  for (const ruta of rutas) {
    try {
      const partes = plantilla.split(/\s+/).filter(Boolean).map(p => p.replace("{archivo}", ruta));
      await ejecutar(partes[0], partes.slice(1), { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      log.info("[BACKUP] subido afuera:", path.basename(ruta));
    } catch (e) {
      log.error("[BACKUP] falló la subida afuera de", path.basename(ruta), "—", e.message);
    }
  }
}

// ─── ESTADO ───────────────────────────────────────────────────────────────
async function listarBackups() {
  if (!fs.existsSync(DIR_BACKUPS)) return [];
  const nombres = (await fsp.readdir(DIR_BACKUPS)).filter(n => n.endsWith(".json"));
  const salida = [];
  for (const n of nombres) {
    try {
      salida.push(JSON.parse(await fsp.readFile(path.join(DIR_BACKUPS, n), "utf8")));
    } catch { /* manifiesto corrupto: se ignora, no debe tumbar la lista */ }
  }
  return salida;
}

async function estado() {
  const backups = (await listarBackups()).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ultimo = backups[0] || null;
  const horas = ultimo ? (Date.now() - new Date(ultimo.fecha).getTime()) / 3600000 : null;

  return {
    configurado: true,
    cifrado: Boolean(CLAVE),
    afuera: Boolean(process.env.BACKUP_COMANDO_SUBIDA),
    cuantos: backups.length,
    ultimo: ultimo && {
      fecha: ultimo.fecha,
      documentos: ultimo.documentos,
      archivos: ultimo.archivos,
      bytes: ultimo.bytesBase + ultimo.bytesArchivos,
      verificado: ultimo.verificado,
      segundos: ultimo.segundos,
      cifrado: ultimo.cifrado,
    },
    horasDesdeUltimo: horas == null ? null : Math.round(horas * 10) / 10,
    // Esto es lo que pinta la pantalla en rojo. Se decide acá y no en el
    // navegador para que la respuesta sea la misma desde donde se mire.
    problema: !ultimo ? "nunca_se_hizo"
      : ultimo.verificado === false ? "ultimo_fallo"
      : horas > HORAS_ALERTA ? "desactualizado"
      : null,
    espacioLibre: null,
  };
}

// ─── PROGRAMACIÓN ─────────────────────────────────────────────────────────
let temporizador = null;

function programar() {
  if (temporizador) return;
  const ms = HORAS_INTERVALO * 3600000;

  // El primero sale a los 2 minutos de arrancar y no en el acto: si el
  // servidor está reiniciando en loop por un error, no queremos que además
  // pelee por hacer respaldos.
  setTimeout(() => {
    hacerBackup().catch(e => log.error("[BACKUP] falló el respaldo automático:", e.message));
  }, 2 * 60 * 1000);

  temporizador = setInterval(() => {
    hacerBackup().catch(e => log.error("[BACKUP] falló el respaldo automático:", e.message));
  }, ms);
  // Que el respaldo pendiente no impida que el proceso termine si alguien
  // apaga Vitalis a propósito.
  if (temporizador.unref) temporizador.unref();

  log.info(`[BACKUP] programado cada ${HORAS_INTERVALO} h · destino ${DIR_BACKUPS} · ${CLAVE ? "cifrado" : "SIN CIFRAR (falta BACKUP_CLAVE)"}`);
}

module.exports = {
  hacerBackup, verificarBackup, listarBackups, estado, programar,
  cifrar, descifrar, DIR_BACKUPS,
};
