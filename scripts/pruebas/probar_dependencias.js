// Symphomed — Que no vuelva una librería con una vulnerabilidad ya cerrada.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// npm audit marcaba proxy-addr 2.0.7 como crítica (GHSA-jqcg-44mw-7w3h:
// se puede falsear la IP con una dirección IPv6 que envuelve una IPv4). La
// trae express y el arreglo es la 2.0.8. Hoy no se alcanza, porque
// index.js usa trust proxy 1 y con un número express no arma las subredes
// donde está el fallo; pero alcanza con cambiar esa línea a «loopback» un
// día para que sí.
//
// npm audit necesita internet y la lista de avisos cambia sola, así que no
// sirve como prueba. Lo que sí se puede probar sin red es que el
// package-lock.json no baje de las versiones con las que npm audit dio 0
// (el 1/10/2026 axios y qs; el 19/10/2026 proxy-addr). Un lock regenerado
// a mano, o copiado de otra rama, no puede volver a traer las viejas sin
// que esto avise.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const PISOS = {
  "proxy-addr": "2.0.8",
  axios: "1.20.0",
  qs: "6.16.0",
};

function comparar(a, b) {
  const x = a.split("-")[0].split(".").map(Number);
  const y = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

const lock = JSON.parse(fs.readFileSync(path.join(RAIZ, "package-lock.json"), "utf8"));
const paquetes = lock.packages || {};

console.log("── El lock no trae versiones con avisos ya cerrados ──");
for (const [nombre, piso] of Object.entries(PISOS)) {
  // Cada copia cuenta: una librería puede aparecer más de una vez si dos
  // dependencias piden versiones que no se pueden compartir.
  const copias = Object.entries(paquetes).filter(([ruta]) => ruta === `node_modules/${nombre}` || ruta.endsWith(`/node_modules/${nombre}`));
  verificar(`${nombre} está en el lock`, copias.length > 0);
  for (const [ruta, datos] of copias) {
    verificar(`  ${ruta} ${datos.version} (piso ${piso})`, comparar(datos.version, piso) >= 0);
  }
}

// Si alguien toca package.json y no regenera el lock, npm install en el
// servidor arma otro árbol distinto del que se probó acá.
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
const raizLock = paquetes[""] || {};
verificar("el lock corresponde a este package.json (mismas dependencias)",
  JSON.stringify(raizLock.dependencies || {}) === JSON.stringify(pkg.dependencies || {}) &&
  JSON.stringify(raizLock.devDependencies || {}) === JSON.stringify(pkg.devDependencies || {}));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
