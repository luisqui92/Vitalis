// Vitalis — Qué código Pix estamos mandando, exactamente.
//
// Cuando el banco dice "erro ao processar o pagamento" no dice POR QUÉ, y
// desde acá hay tres sospechosos que se ven iguales:
//
//   1. la cuenta de BRLA no acepta ese monto (mínimo de depósito),
//   2. el txid que inventamos no existe del lado de BRLA,
//   3. el código está mal armado.
//
// El (3) ya está descartado por probar_pix.js, que reproduce carácter por
// carácter un QR que un banco aceptó. Este script imprime las variantes para
// separar el (1) del (2) pagando un real, una vez por variante.
//
//   node scripts/probar_pix_real.js            → R$ 1,00
//   node scripts/probar_pix_real.js 250        → R$ 2,50
const path = require("path");
const { armarCodigo, montoDesdeCentavos } = require(path.join(__dirname, "..", "services", "pix"));

const CUENTA = {
  chave: process.env.PIX_CHAVE || "ff439919-4119-405d-838a-6c3e3efd8b55",
  nombre: process.env.PIX_TITULAR || "BRLA DIGITAL LTDA",
  ciudad: process.env.PIX_CIUDAD || "Sao Paulo",
};
const centavos = Number(process.argv[2] || 100);

// El mismo txid que arma routes/recargas.js hoy.
const txidVitalis = `V${Date.now().toString(36)}9999`.toUpperCase();

const variantes = [
  ["A — como lo manda Vitalis hoy", { ...CUENTA, montoCentavos: centavos, txid: txidVitalis }],
  ["B — sin txid propio (estático puro)", { ...CUENTA, montoCentavos: centavos, txid: "" }],
  ["C — con el txid original de BRLA", { ...CUENTA, montoCentavos: centavos, txid: "308a4c8a84284aacbd25430ae" }],
  ["D — sin monto (lo escribe el pagador)", { ...CUENTA, montoCentavos: 0, txid: "" }],
];

console.log(`\nClave Pix: ${CUENTA.chave}`);
console.log(`Monto:     R$ ${montoDesdeCentavos(centavos) || "(libre)"}\n`);

for (const [nombre, args] of variantes) {
  console.log("─".repeat(72));
  console.log(nombre);
  console.log(armarCodigo(args));
  console.log("");
}

console.log("─".repeat(72));
console.log(`
Probá en el banco con "Pix Copia e Cola", una variante por vez:

  · Antes que nada, mandá R$ 1,00 a la clave SUELTA, sin QR
    (Pix → transferir → chave aleatória → pegar la clave → escribir 1,00).
    Si eso también falla, el problema es la cuenta de BRLA y no hay nada
    que arreglar en el código.

  · Si el pago suelto entra y A falla pero B entra → el txid es el problema.
  · Si A y B fallan y D entra → el problema es el monto fijo.
  · Si todas fallan y el pago suelto entra → escribime el detalle.
`);
