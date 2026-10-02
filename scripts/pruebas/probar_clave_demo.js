// Symphomed — Todas las cuentas de prueba nacen con la misma clave.
//
// Antes cada seed elegía la suya: ocho al azar (que se mostraba una sola vez),
// uno con «Symphomed123» y otro con «demo12345». Con una demo por delante, una
// cuenta a la que nadie puede entrar. Esta prueba corre los once seeds DE
// VERDAD, sin pasarles clave, contra una base de prueba, y comprueba que se
// puede entrar a cada cuenta que dejan con la clave común.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { CLAVE_DEMO } = require(path.join(RAIZ, "scripts", "lib", "claveDemo"));

console.log("── 1. La regla, escrita ──");
verificar("la clave común es Symphomed1234", CLAVE_DEMO === "Symphomed1234");
const seeds = fs.readdirSync(path.join(RAIZ, "scripts")).filter(f => /^seed_.*_demo\.js$/.test(f)).sort();
verificar(`hay ${seeds.length} seeds de demostración`, seeds.length >= 11);
for (const f of seeds) {
  const codigo = fs.readFileSync(path.join(RAIZ, "scripts", f), "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  const problemas = [];
  if (!/require\("\.\/lib\/claveDemo"\)/.test(codigo)) problemas.push("no usa la clave común");
  if (/randomBytes\(9\)/.test(codigo)) problemas.push("genera una clave al azar");
  if (/\|\|\s*"(Symphomed123|demo12345)"/.test(codigo)) problemas.push("tiene otra clave escrita");
  verificar(`${f}${problemas.length ? " — " + problemas.join(", ") : ""}`, !problemas.length);
}

function correr(uri, archivo, args) {
  return new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(RAIZ, "scripts", archivo), ...args], { cwd: RAIZ, env: { ...process.env, MONGODB_URI: uri } });
    let salida = "";
    h.stdout.on("data", (d) => { salida += d; });
    h.stderr.on("data", (d) => { salida += d; });
    const corte = setTimeout(() => h.kill(), 120000);
    h.on("exit", (codigo) => { clearTimeout(corte); resolve({ codigo, salida: salida.replace(/\x1b\[[0-9;]*m/g, "") }); });
  });
}

(async () => {
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) { console.log("⏭️  Seeds SALTEADOS: no hay base de datos. Esto NO es un ✅."); process.exit(fallos === 0 ? 0 : 1); }
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + "clave_demo_prueba";
  process.env.MONGODB_URI = uri;
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = uri;
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  const M = require(path.join(RAIZ, "db", "models"));
  const { verificarPassword } = require(path.join(RAIZ, "services", "auth"));
  const entra = async (phone) => {
    const m = await M.Medico.findOne({ phone }).lean();
    return Boolean(m) && (await verificarPassword(CLAVE_DEMO, m.passwordHash)).ok === true;
  };

  console.log("\n── 2. Cada seed, corrido de verdad y sin pasarle clave ──");
  // [archivo, teléfono, cuentas que deja] — las que no son la principal también
  // tienen que entrar con la clave común (los colegas y los consultorios).
  const PLAN = [
    ["seed_clinica_demo.js", "79000000", ["79000000", "79000001", "79000002", "79000003", "79000004"]],
    ["seed_medicina_general_demo.js", "70011001", ["70011001"]],
    ["seed_odontologo_demo.js", "70011002", ["70011002"]],
    ["seed_oftalmologia_demo.js", "70011003", ["70011003"]],
    ["seed_ginecologia_demo.js", "70011004", ["70011004"]],
    ["seed_veterinaria_demo.js", "70011005", ["70011005"]],
    ["seed_estetica_demo.js", "70011006", ["70011006"]],
    ["seed_simulador_demo.js", "70011007", ["70011007"]],
    ["seed_fisioterapia_demo.js", "70011008", ["70011008", "70011008-01", "70011008-02"]],
    ["seed_neurodesarrollo_demo.js", "70011009", ["70011009", "70011009-01", "70011009-02", "70011009-03"]],
    ["seed_brasil_demo.js", "11987650001", ["11987650001", "5511987650001"]],
  ];
  for (const [archivo, phone, cuentas] of PLAN) {
    const r = await correr(uri, archivo, [phone]);
    let existentes = 0, entran = 0;
    for (const c of cuentas) { if (await M.Medico.findOne({ phone: c }).lean()) { existentes++; if (await entra(c)) entran++; } }
    const esperadas = archivo === "seed_brasil_demo.js" ? 1 : cuentas.length;   // Brasil guarda con o sin 55
    verificar(`${archivo}: terminó bien, dejó ${existentes} cuenta(s) y se entra a ${entran} con ${CLAVE_DEMO}`,
      r.codigo === 0 && existentes >= esperadas && entran === existentes);
    if (r.codigo !== 0) console.log(r.salida.split("\n").slice(-8).join("\n"));
  }

  console.log("\n── 3. Una clave pasada a mano sigue mandando ──");
  const r2 = await correr(uri, "seed_medicina_general_demo.js", ["70011099", "Dr. Otro", "OtraClave99"]);
  const otra = await M.Medico.findOne({ phone: "70011099" }).lean();
  verificar("con clave explícita se usa esa, no la común", r2.codigo === 0 && otra && (await verificarPassword("OtraClave99", otra.passwordHash)).ok === true && !(await verificarPassword(CLAVE_DEMO, otra.passwordHash)).ok);

  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
