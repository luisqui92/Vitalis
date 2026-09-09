// Symphomed — Que la venta aparezca en el momento justo, y no antes.
//
// La caja de planes es donde se decide si un médico paga o se va. Y el error
// más caro no es que falte: es que aparezca demasiado pronto.
//
// Un médico que abrió Symphomed hace diez minutos, con cuatro consultas
// gratis por delante, no tiene que ver un cartel de precios. Todavía no sabe
// si esto le sirve — venderle ahí es pedirle una decisión que no puede tomar,
// y la respuesta natural a esa pregunta es "no".
//
// Por eso se prueba estado por estado: no que la caja funcione, sino CUÁNDO
// se muestra.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Un navegador de mentira con lo mínimo que saldo.js toca.
function pintar(estado, moneda = "BRL") {
  const cajas = {};
  const nodo = (id) => {
    if (!cajas[id]) {
      cajas[id] = {
        id, innerHTML: "", style: {}, dataset: {}, textContent: "",
        onclick: null, isConnected: true,
        querySelectorAll: () => [],
      };
    }
    return cajas[id];
  };
  const ctx = {
    console, MEDICO_MONEDA: moneda,
    document: {
      getElementById: (id) => (id === "planesBox" || id === "planPago" || id === "planesDetalle" || id === "btnVerPlanes" ? nodo(id) : nodo(id)),
    },
    esc: (x) => String(x == null ? "" : x),
    api: async () => ({}),
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: () => {},
  };
  // t() devuelve la clave, así se puede comprobar QUÉ mensaje se eligió sin
  // depender de cómo esté redactado hoy.
  ctx.t = (clave) => clave;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "saldo.js"), "utf8"), ctx);
  vm.runInContext("PLANES_ABIERTO = false;", ctx);
  ctx.pintarPlanes(estado);
  return cajas.planesBox ? cajas.planesBox.innerHTML : "";
}

const PRECIOS = {
  mensual: 40000, anual: 440000,
  mensualTexto: "R$ 400.00", anualTexto: "R$ 4400.00", mesesGratis: 1,
};
const base = { precioConsultaCentavos: 1000, bajo: false, enNegativo: false };
const sinPlan = { activa: false, precios: PRECIOS };

console.log("── 1. Recién empezando: NO se le vende nada ──");
// Cuatro consultas por delante. Que trabaje tranquilo.
const reciente = pintar({
  ...base, suscripcion: sinPlan,
  gratis: { total: 4, restantes: 4, enCortesia: true, porAcabarse: false },
});
verificar("con 4 gratis la caja ni aparece", reciente.trim() === "");

const dosGratis = pintar({
  ...base, suscripcion: sinPlan,
  gratis: { total: 4, restantes: 3, enCortesia: true, porAcabarse: false },
});
verificar("con 3 tampoco", dosGratis.trim() === "");

console.log("\n── 2. Cuando quedan pocas, aparece pero no molesta ──");
const quedan2 = pintar({
  ...base, suscripcion: sinPlan,
  gratis: { total: 4, restantes: 2, enCortesia: true, porAcabarse: true },
});
verificar("con 2 restantes ya se ofrece", quedan2.includes("plan.verPlanes"));
// Aparece cerrada: es un botón, no un cartel que le tapa la pantalla.
verificar("  ...pero cerrada, sin interrumpir", /id="planesDetalle" style="display:none"/.test(quedan2));

console.log("\n── 3. Sin gratis y sin saldo: se abre sola ──");
// Acá ya no puede trabajar. Esconder la respuesta detrás de un clic sería
// hacerle buscar cómo pagarnos.
const agotado = pintar({
  ...base, bajo: true, suscripcion: sinPlan,
  gratis: { total: 4, restantes: 0, enCortesia: false, porAcabarse: false },
});
verificar("se muestra abierta", /id="planesDetalle" style="display:"/.test(agotado));
verificar("  ...con el plan mensual", agotado.includes('data-plan="mensual"'));
verificar("  ...y el anual", agotado.includes('data-plan="anual"'));

console.log("\n── 4. El prepago NO se esconde ──");
// Para un médico que atiende poco, el prepago es la opción correcta. Ofrecer
// solo el plan sería empujarlo a pagar de más — y a que lo descubra después.
verificar("se ofrece también pagar por consulta", agotado.includes("plan.oPrepago"));

console.log("\n── 5. Con plan vigente no se le vende de nuevo ──");
const conPlan = pintar({
  ...base,
  suscripcion: { activa: true, plan: "mensual", diasRestantes: 25, porVencer: false, precios: PRECIOS },
  gratis: { total: 4, restantes: 4, enCortesia: true, porAcabarse: false },
});
verificar("la caja no aparece", conPlan.trim() === "");

console.log("\n── 6. Por vencer: se ofrece renovar, no contratar ──");
const porVencer = pintar({
  ...base,
  suscripcion: { activa: true, plan: "mensual", diasRestantes: 5, porVencer: true, precios: PRECIOS },
  gratis: { total: 4, restantes: 4, enCortesia: true, porAcabarse: false },
});
verificar("aparece", porVencer.includes("plan.renovar"));
verificar("  ...y NO le vuelve a ofrecer el prepago", !porVencer.includes("plan.oPrepago"));

console.log("\n── 7. Los precios salen del servidor, no del navegador ──");
// Si la pantalla supiera los precios, cambiarlos obligaría a desplegar el
// frontend y habría dos verdades hasta que alguien recargue.
const front = fs.readFileSync(path.join(RAIZ, "public", "js", "saldo.js"), "utf8");
verificar("no hay ningún 400 ni 4400 escritos a mano",
  !/\b(400|4400)\b/.test(front.replace(/\/\/.*$/gm, "")));
verificar("  ...se leen de suscripcion.precios", front.includes("plan.precios") || front.includes("(s.suscripcion || {}).precios"));

console.log("\n── 8. Cuántas consultas equivale el plan se calcula, no se escribe ──");
// "Conviene desde 40 consultas" tiene que salir de dividir el precio del plan
// por el de la consulta. Escrito a mano, el día que cambie un precio queda
// un número que miente.
verificar("se divide precio del plan por precio de consulta",
  /precios\.mensual\s*\/\s*s\.precioConsultaCentavos/.test(front));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
