// Regresión: los valores de <input type="date"> representan días civiles.
// En Bolivia, `new Date("2026-09-16")` cae el 15 por la noche; esta prueba
// corre en esa zona para que el error vuelva a fallar si alguien lo reintroduce.
process.env.TZ = "America/La_Paz";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..", "..");
const codigo = fs.readFileSync(path.join(raiz, "public", "js", "i18n.js"), "utf8");
const sandbox = {
  console,
  Date,
  Intl,
  localStorage: { getItem: () => "es", setItem: () => {} },
  document: { documentElement: { lang: "es" } },
};
vm.createContext(sandbox);
vm.runInContext(`${codigo}\nthis.__fechas = { fechaCorta, fechaCalendarioLocal };`, sandbox);

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { fechaCorta, fechaCalendarioLocal } = sandbox.__fechas;
verificar("YYYY-MM-DD conserva el día 16 en Bolivia", /^16\D/.test(fechaCorta("2026-09-16")));
verificar("los registros históricos a medianoche UTC también conservan el día 16",
  /^16\D/.test(fechaCorta("2026-09-16T00:00:00.000Z")));
verificar("el valor para un input date sale de componentes locales",
  fechaCalendarioLocal(new Date(2026, 8, 16, 23, 30)) === "2026-09-16");
verificar("una fecha vacía no se imprime como Invalid Date", fechaCorta(null) === "—");

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
