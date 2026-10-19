// Symphomed — Un respaldo por vez aunque sean dos procesos, sin restos
// cuando falla, y con un uploads/ de más de 2 GiB.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Tres cosas del respaldo que no se ven hasta el día que pasan:
//
//   · scripts/respaldar_ahora.js corre en OTRO proceso, con el servidor
//     vivo, justo antes de desplegar. El candado del respaldo era una
//     variable del módulo, así que cada proceso tenía el suyo: si el
//     automático arrancaba en ese momento, los dos usaban la misma base de
//     verificación, uno se la borraba al otro y los dos respaldos quedaban
//     marcados como fallidos.
//   · Un respaldo que fallaba a la mitad dejaba sus archivos sin manifiesto
//     (el tar de los estudios, todavía EN CLARO) y nadie los borraba nunca.
//   · El tar se leía entero en memoria para cifrarlo, y readFile no pasa de
//     2 GiB: con uploads/ más grande que eso, el respaldo fallaba siempre.
//
// Se prueba con procesos de verdad contra una base descartable, sobre una
// copia de services/: el respaldo archiva el uploads/ que tiene al lado, y
// el de este repositorio no se toca.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
process.env.OPERADORES_SALDO = "70000001";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const CLAVE = "clave-de-prueba-".repeat(4);
const MAGIA = "VITALISBK1";
const CABECERA = MAGIA.length + 16 + 12 + 16;
const TAR_GRANDE = 2200000000; // más que los 2 GiB (2147483648) de readFile

// ─── La copia ─────────────────────────────────────────────────────────────
const COPIA = fs.mkdtempSync(path.join(os.tmpdir(), "symphomed-respaldo-"));
for (const d of ["config", "db", "services"]) fs.cpSync(path.join(RAIZ, d), path.join(COPIA, d), { recursive: true });
fs.mkdirSync(path.join(COPIA, "scripts"));
for (const f of ["respaldar_ahora.js", "restaurar.js"]) fs.copyFileSync(path.join(RAIZ, "scripts", f), path.join(COPIA, "scripts", f));
fs.symlinkSync(path.join(RAIZ, "node_modules"), path.join(COPIA, "node_modules"));
fs.mkdirSync(path.join(COPIA, "uploads", "estudios"), { recursive: true });
fs.writeFileSync(path.join(COPIA, "uploads", "estudios", "rx-torax.txt"), "radiografía de prueba\n");
fs.writeFileSync(path.join(COPIA, "uploads", "estudios", "laboratorio.txt"), "hemograma de prueba\n");

// Dos tar de mentira, que se ponen primeros en el PATH del respaldo. Reciben
// lo mismo que el de verdad: -czf <destino> -C <carpeta> uploads.
function tarFalso(nombre, cuerpo) {
  const dir = path.join(COPIA, nombre);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "tar"), "#!/bin/sh\n" + cuerpo + "\n", { mode: 0o755 });
  return dir;
}
// Disperso: no ocupa disco hasta que se cifra.
const CON_TAR_GRANDE = tarFalso("tar-grande", `truncate -s ${TAR_GRANDE} "$2"`);
// Escribe un pedazo y se corta, como un disco que se llena a la mitad.
const CON_TAR_CORTADO = tarFalso("tar-cortado", `printf 'pedazo de tar en claro' > "$2"\necho "tar: se cortó a la mitad" >&2\nexit 2`);

// ─── Procesos ─────────────────────────────────────────────────────────────
// Un proceso que hace un respaldo, como el automático del servidor. Con
// señal, espera a que se le diga «ya» para que dos arranquen juntos.
const HIJO = `
  const mongoose = require("mongoose");
  const backup = require(${JSON.stringify(path.join(COPIA, "services", "backup.js"))});
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    if (process.env.CANDADO_DE_OTRA_VIDA) {
      // Como el servidor que reinició y le tocó el mismo número de proceso.
      require("fs").writeFileSync(process.env.CANDADO_DE_OTRA_VIDA, JSON.stringify({ pid: process.pid, host: require("os").hostname(), desde: new Date().toISOString(), id: "otra-vida" }));
    }
    if (process.env.ESPERAR_SENAL) {
      process.stdout.write("LISTO\\n");
      await new Promise((r) => process.stdin.once("data", r));
    }
    let r;
    try { r = await backup.hacerBackup({ verificar: true }); } catch (e) { r = { error: e.message }; }
    process.stdout.write("RSS " + process.resourceUsage().maxRSS + "\\n");
    process.stdout.write("RESULTADO " + JSON.stringify(r) + "\\n");
    await mongoose.disconnect();
  })().catch((e) => { process.stdout.write("RESULTADO " + JSON.stringify({ error: e.message }) + "\\n"); process.exit(1); });
`;

function respaldoEnOtroProceso(entorno, conSenal = false) {
  const h = spawn(process.execPath, ["-e", HIJO], { cwd: COPIA, env: { ...entorno, ESPERAR_SENAL: conSenal ? "1" : "" } });
  if (!conSenal) h.stdin.end();
  let salida = "";
  let avisarListo;
  const listo = new Promise((r) => { avisarListo = r; });
  h.stdout.on("data", (d) => { salida += d; if (salida.includes("LISTO\n")) avisarListo(); });
  h.stderr.on("data", (d) => { salida += d; });
  const corte = setTimeout(() => h.kill("SIGKILL"), 5 * 60 * 1000);
  const fin = new Promise((resolve) => {
    h.on("exit", (codigo) => {
      clearTimeout(corte);
      const linea = salida.split("\n").find((l) => l.startsWith("RESULTADO "));
      const rss = Number((salida.match(/^RSS (\d+)$/m) || [])[1]) || null;
      resolve({ codigo, r: linea ? JSON.parse(linea.slice(10)) : null, rssKB: rss, salida });
    });
  });
  // end y no write: con la entrada abierta, el proceso no termina nunca.
  return { pid: h.pid, listo, ya: () => h.stdin.end("ya\n"), fin };
}

function correrScript(nombre, args, entorno) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(COPIA, "scripts", nombre), ...args], { cwd: COPIA, env: entorno });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    h.stdin.end();
    const corte = setTimeout(() => h.kill("SIGKILL"), 5 * 60 * 1000);
    h.on("exit", (codigo) => { clearTimeout(corte); resolve({ codigo, salida }); });
  });
}

function pedir(puerto, metodo, ruta, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { authorization: "Bearer " + token } }, (res) => {
      let texto = "";
      res.on("data", (c) => { texto += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(texto); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: json }); });
    });
    req.on("error", reject);
    req.end();
  });
}

const respaldosDe = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith("vitalis-"));

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) {
    console.log("⏭️  SALTEADA: no hay base de prueba. Esto NO es un ✅: el respaldo quedó sin probar.");
    fs.rmSync(COPIA, { recursive: true, force: true });
    process.exit(0);
  }

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "respaldo_prueba";
  const mongoose = require(path.join(RAIZ, "node_modules", "mongoose"));
  let dormido = null;
  try {
    await mongoose.connect(uri);
    const fecha = new Date("2026-09-16T14:30:00Z");
    await mongoose.connection.db.collection("citas").insertMany(Array.from({ length: 50 }, (_, i) => ({ n: i, fecha })));
    await mongoose.connection.db.collection("pacientes").insertMany(Array.from({ length: 20 }, (_, i) => ({ nombre: `Paciente ${i}` })));

    const base = {
      ...process.env,
      MONGODB_URI: uri,
      BACKUP_CLAVE: CLAVE,
      BACKUP_COMANDO_SUBIDA: "",
      BACKUP_COMANDO_VERIFICAR: "",
      BACKUP_EXIGIR_SEGURO: "",
    };

    // ═══ 1. DOS PROCESOS A LA VEZ ═══════════════════════════════════════════
    console.log("── 1. El automático y respaldar_ahora.js al mismo tiempo ──");
    // La subida tarda un segundo: así el primero sigue a la mitad cuando el
    // segundo arranca, siempre, y no depende de qué tan rápida sea la máquina.
    const dirA = path.join(COPIA, "bk-a-la-vez");
    const entornoA = { ...base, BACKUP_DIR: dirA, BACKUP_COMANDO_SUBIDA: 'sh -c "sleep 1" {archivo}', BACKUP_COMANDO_VERIFICAR: "true {archivo}" };
    const p1 = respaldoEnOtroProceso(entornoA, true);
    const p2 = respaldoEnOtroProceso(entornoA, true);
    await Promise.all([p1.listo, p2.listo]);
    p1.ya(); p2.ya();
    const resultados = (await Promise.all([p1.fin, p2.fin])).map((x) => x.r);
    const hechos = resultados.filter((r) => r && !r.salteado && !r.error);
    const salteados = resultados.filter((r) => r?.motivo === "en_curso_otro_proceso");
    verificar("de dos respaldos lanzados juntos en dos procesos, se hace uno solo", hechos.length === 1 && salteados.length === 1);
    if (hechos.length !== 1) console.log("   →", JSON.stringify(resultados.map((r) => r && { salteado: r.salteado, verificado: r.verificado, error: r.error, motivo: r.verificacion?.motivo })));
    const mA = hechos[0];
    verificar("  ...y ese quedó verificado restaurándolo", mA?.verificado === true);
    verificar("  ...y con la copia externa verificada", mA?.externo?.verificado === true);
    verificar("  ...el otro dice qué proceso lo tiene", [p1.pid, p2.pid].includes(salteados[0]?.otro?.pid));
    verificar("  ...hay un solo juego en la carpeta", fs.readdirSync(dirA).filter((n) => n.endsWith(".json")).length === 1);
    verificar("  ...y el candado se soltó", !fs.existsSync(path.join(dirA, ".respaldo.lock")));

    // ═══ 2. EL CANDADO DE OTRO ══════════════════════════════════════════════
    console.log("\n── 2. respaldar_ahora.js con el candado de otro proceso ──");
    const dirB = path.join(COPIA, "bk-ocupado");
    fs.mkdirSync(dirB);
    const candadoB = path.join(dirB, ".respaldo.lock");
    const entornoB = { ...base, BACKUP_DIR: dirB };
    dormido = spawn("sleep", ["120"]);
    const ajeno = { pid: dormido.pid, host: os.hostname(), desde: new Date().toISOString(), id: "del-otro" };
    fs.writeFileSync(candadoB, JSON.stringify(ajeno));
    let s = await correrScript("respaldar_ahora.js", [], entornoB);
    verificar("con otro respaldo en curso, no hace nada y sale con error", s.codigo === 1 && /ya hay un respaldo en curso/.test(s.salida));
    verificar("  ...y dice qué proceso lo tiene", s.salida.includes(`proceso ${dormido.pid}`));
    verificar("  ...no escribió ningún archivo", respaldosDe(dirB).length === 0);
    verificar("  ...y el candado del otro sigue ahí, sin tocar", fs.readFileSync(candadoB, "utf8") === JSON.stringify(ajeno));

    // El proceso que lo tenía murió (un pm2 restart a la mitad).
    const murio = new Promise((r) => dormido.once("exit", r));
    dormido.kill();
    await murio;
    const pidMuerto = dormido.pid;
    dormido = null;
    s = await correrScript("respaldar_ahora.js", [], entornoB);
    verificar("si el que lo tenía ya no existe, el candado vence y el respaldo se hace", s.codigo === 0 && /verificado restaurándolo: SÍ/.test(s.salida));
    verificar("  ...y no queda candado", !fs.existsSync(candadoB));

    // Un proceso vivo, pero de hace demasiado: después de reiniciar la
    // máquina ese número puede ser de cualquier otro programa.
    fs.writeFileSync(candadoB, JSON.stringify({ ...ajeno, pid: process.pid, desde: "2000-01-01T00:00:00.000Z" }));
    s = await correrScript("respaldar_ahora.js", [], entornoB);
    verificar("un candado de hace más de 12 horas vence aunque el número de proceso exista", s.codigo === 0 && !fs.existsSync(candadoB));

    // Roto: el proceso murió justo después de crearlo.
    fs.writeFileSync(candadoB, "");
    fs.utimesSync(candadoB, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
    s = await correrScript("respaldar_ahora.js", [], entornoB);
    verificar("un candado vacío y viejo vence", s.codigo === 0 && !fs.existsSync(candadoB));

    // En un contenedor el servidor puede volver a arrancar con el mismo
    // número de proceso: su candado de antes parece de alguien vivo.
    const pv = await respaldoEnOtroProceso({ ...entornoB, CANDADO_DE_OTRA_VIDA: candadoB }).fin;
    verificar("un candado con el número de este mismo proceso es de antes de reiniciar: vence", pv.r?.verificado === true && !fs.existsSync(candadoB));

    // ═══ 3. RESTAURAR LO QUE SE HIZO ════════════════════════════════════════
    console.log("\n── 3. Lo que se respaldó se puede restaurar ──");
    if (mA?.archivoArchivos) {
      const tarA = path.join(dirA, mA.archivoArchivos);
      verificar("el tar de los estudios quedó cifrado", fs.readFileSync(tarA).subarray(0, MAGIA.length).toString() === MAGIA);
      const r = await correrScript("restaurar.js", [tarA, "--extraer-archivos"], base);
      const descifrado = tarA.replace(/\.tar\.gz$/, "-descifrado.tar.gz");
      verificar("restaurar.js --extraer-archivos lo descifra", r.codigo === 0 && fs.existsSync(descifrado));
      if (fs.existsSync(descifrado)) {
        const lista = execFileSync("tar", ["-tzf", descifrado], { encoding: "utf8" });
        verificar("  ...y tar lo abre, con los dos estudios", lista.includes("uploads/estudios/rx-torax.txt") && lista.includes("uploads/estudios/laboratorio.txt"));
        verificar("  ...con el contenido intacto", execFileSync("tar", ["-xzOf", descifrado, "uploads/estudios/rx-torax.txt"], { encoding: "utf8" }) === "radiografía de prueba\n");
      }
      const rev = await correrScript("restaurar.js", [path.join(dirA, mA.archivoBase), "--revisar"], base);
      verificar("restaurar.js --revisar sigue abriendo la base del respaldo", rev.codigo === 0 && /50\s+citas/.test(rev.salida) && /20\s+pacientes/.test(rev.salida));
    } else {
      verificar("hay un respaldo del punto 1 para restaurar", false);
    }

    // ═══ 4. UPLOADS DE MÁS DE 2 GiB ═════════════════════════════════════════
    console.log("\n── 4. Un tar de 2,2 GB ──");
    const dirC = path.join(COPIA, "bk-grande");
    const pc = await respaldoEnOtroProceso({ ...base, BACKUP_DIR: dirC, PATH: CON_TAR_GRANDE + path.delimiter + process.env.PATH }).fin;
    const mC = pc.r;
    verificar("se respalda igual (antes: ERR_FS_FILE_TOO_LARGE, y ningún respaldo)", mC && !mC.error && mC.verificado === true);
    if (mC?.error) console.log("   →", mC.error);
    if (mC?.archivoArchivos) {
      const tarC = path.join(dirC, mC.archivoArchivos);
      verificar("  ...del tamaño justo: cabecera + cuerpo", fs.statSync(tarC).size === TAR_GRANDE + CABECERA && mC.bytesArchivos === TAR_GRANDE + CABECERA);
      // Se descifra acá mismo, de a pedazos y sin escribirlo: que la
      // etiqueta de GCM que se escribió al final sea la correcta.
      const fd = fs.openSync(tarC, "r");
      const cab = Buffer.alloc(CABECERA);
      fs.readSync(fd, cab, 0, CABECERA, 0);
      fs.closeSync(fd);
      let o = MAGIA.length;
      const sal = cab.subarray(o, o += 16), iv = cab.subarray(o, o += 12), tag = cab.subarray(o, o += 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(CLAVE, sal, 32), iv);
      decipher.setAuthTag(tag);
      let bytes = 0, todoCero = true;
      for await (const pedazo of fs.createReadStream(tarC, { start: CABECERA }).pipe(decipher)) {
        bytes += pedazo.length;
        if (todoCero && pedazo.some((b) => b !== 0)) todoCero = false;
      }
      verificar("  ...y se descifra entero, con su etiqueta de GCM en su lugar", bytes === TAR_GRANDE && todoCero);
      verificar("  ...sin cargarlo en memoria (pico del proceso por debajo de 700 MB)", pc.rssKB && pc.rssKB < 700 * 1024);
      console.log(`   pico de memoria del respaldo: ${Math.round(pc.rssKB / 1024)} MB`);
      verificar("  ...y sin temporales", !fs.readdirSync(dirC).some((n) => n.endsWith(".tmp")));
    }
    fs.rmSync(dirC, { recursive: true, force: true });

    // ═══ 5. UNO QUE FALLA A LA MITAD ════════════════════════════════════════
    console.log("\n── 5. Lo que queda de un respaldo que no terminó ──");
    const dirE = path.join(COPIA, "bk-falla");
    fs.mkdirSync(dirE);
    // Un respaldo anterior al que le mataron el proceso a la mitad: dejó su
    // candado, con su marca, y sus archivos sin manifiesto.
    fs.writeFileSync(path.join(dirE, ".respaldo.lock"), JSON.stringify({ pid: pidMuerto, host: os.hostname(), desde: "2001-01-01T00:00:00.000Z", marca: "2001-01-01T00-00-00", id: "muerto" }));
    const restos = [
      "vitalis-2001-01-01T00-00-00.vitalisbk",
      "vitalis-2001-01-01T00-00-00-archivos.tar.gz",     // el tar todavía en claro
      "vitalis-2001-01-01T00-00-00-archivos.tar.gz.tmp", // y su cifrado a medias
      "vitalis-2001-01-01T00-00-00.json.tmp",
    ];
    for (const n of restos) fs.writeFileSync(path.join(dirE, n), "resto");
    const completo = ["vitalis-2001-01-02T00-00-00.vitalisbk", "vitalis-2001-01-02T00-00-00.json"];
    fs.writeFileSync(path.join(dirE, completo[0]), "respaldo bueno");
    fs.writeFileSync(path.join(dirE, completo[1]), JSON.stringify({ version: 2, fecha: "2001-01-02T00:00:00.000Z", marca: "2001-01-02T00-00-00", archivoBase: completo[0], archivoArchivos: null }));
    // Uno traído a mano de la copia externa para restaurarlo, sin su
    // manifiesto. No es un resto: nadie sabe que haya fallado.
    const traido = "vitalis-2001-01-04T00-00-00.vitalisbk";
    fs.writeFileSync(path.join(dirE, traido), "respaldo traído de afuera");
    fs.writeFileSync(path.join(dirE, "LEAME.txt"), "notas del administrador");
    const pe = await respaldoEnOtroProceso({ ...base, BACKUP_DIR: dirE, PATH: CON_TAR_CORTADO + path.delimiter + process.env.PATH }).fin;
    verificar("si el tar se corta, el respaldo falla y lo dice", Boolean(pe.r?.error) && /se cortó a la mitad/.test(pe.r.error));
    const quedan = fs.readdirSync(dirE);
    verificar("  ...y no deja nada suyo: ni la base ni el tar en claro", respaldosDe(dirE).every((n) => /^vitalis-2001-01-0[124]T/.test(n)));
    verificar("  ...se borró lo que dejó el respaldo al que le mataron el proceso", restos.every((n) => !quedan.includes(n)));
    verificar("  ...el respaldo completo de antes sigue entero", completo.every((n) => quedan.includes(n)));
    verificar("  ...el que alguien trajo a mano para restaurar, también", quedan.includes(traido));
    verificar("  ...lo que no es un respaldo no se toca", quedan.includes("LEAME.txt"));
    verificar("  ...y el candado se soltó", !quedan.includes(".respaldo.lock"));

    // ═══ 6. EL BOTÓN DEL PANEL ══════════════════════════════════════════════
    console.log("\n── 6. El botón de Panel → Seguridad ──");
    // db/models se conecta solo al cargarse: que sea a la misma base.
    process.env.MONGODB_URI = uri;
    const { Medico } = require(path.join(RAIZ, "db", "models"));
    const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
    await Medico.create({ phone: "70000001", nombre: "Operador", passwordHash: await hashPassword("Prueba123."), dosFA: { activo: true, secreto: "SECRETO", secretoPendiente: "" } });
    const backupReal = require(path.join(RAIZ, "services", "backup"));
    const express = require("express");
    const app = express();
    require(path.join(RAIZ, "routes", "backup"))(app);
    const servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
    const token = generarToken("70000001", "medico", 36e5);
    const original = backupReal.hacerBackup;
    try {
      backupReal.hacerBackup = async () => ({ salteado: true, motivo: "en_curso_otro_proceso", otro: { pid: 4321 } });
      const ocupado = await pedir(servidor.address().port, "POST", "/medico/backups", token);
      verificar("con un respaldo en curso en otro proceso contesta 409, no «la base no está disponible»", ocupado.estado === 409 && /Ya se está haciendo una copia/.test(ocupado.cuerpo?.error || ""));
      backupReal.hacerBackup = async () => ({ salteado: true, motivo: "sin_conexion" });
      const sinBase = await pedir(servidor.address().port, "POST", "/medico/backups", token);
      verificar("sin conexión a la base sigue siendo 503", sinBase.estado === 503);
    } finally {
      backupReal.hacerBackup = original;
      servidor.close();
    }
  } finally {
    if (dormido) dormido.kill();
    await mongoose.disconnect().catch(() => {});
    await mongod.stop().catch(() => {});
    fs.rmSync(COPIA, { recursive: true, force: true });
  }

  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
