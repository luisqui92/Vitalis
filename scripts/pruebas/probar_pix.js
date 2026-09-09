// Symphomed — Que el código Pix que generamos sea un código Pix de verdad.
//
// ═══ POR QUÉ ESTA PRUEBA ES DISTINTA A LAS DEMÁS ═══════════════════════════
//
// Acá no se puede "probar en el navegador y ver si anda". Un código Pix mal
// armado no da error: da un código que el banco del médico rechaza, o peor,
// uno que cobra un monto distinto al que se pidió. Del otro lado hay alguien
// pagando plata.
//
// Por eso la prueba central no compara contra la especificación —que se puede
// leer mal— sino contra UN CÓDIGO QUE YA FUNCIONÓ: el QR de Brasil que un
// banco real aceptó, decodificado de public/pago-qr-br.jpg. Si el generador
// lo reproduce carácter por carácter, CRC incluido, entonces entiende el
// formato. Si algún día alguien "mejora" el generador y esto falla, no hay
// discusión sobre quién tiene razón.
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const { armarCodigo, crc16, montoDesdeCentavos, txidLimpio, limpiar } = require(path.join(RAIZ, "services", "pix"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// El QR real de Brasil, tal cual estaba en public/pago-qr-br.jpg.
const REAL = "00020126580014br.gov.bcb.pix0136ff439919-4119-405d-838a-6c3e3efd8b555204000053039865406100.005802BR5917BRLA DIGITAL LTDA6009Sao Paulo62290525308a4c8a84284aacbd25430ae63043B8E";
const CUENTA = {
  chave: "ff439919-4119-405d-838a-6c3e3efd8b55",
  nombre: "BRLA DIGITAL LTDA",
  ciudad: "Sao Paulo",
};

console.log("── 1. Reproduce un código que un banco ya aceptó ──");
const reproducido = armarCodigo({ ...CUENTA, montoCentavos: 10000, txid: "308a4c8a84284aacbd25430ae" });
verificar("idéntico, carácter por carácter", reproducido === REAL);
if (reproducido !== REAL) {
  const i = [...REAL].findIndex((c, k) => c !== reproducido[k]);
  console.log(`   difiere en la posición ${i}`);
  console.log(`   real: ${REAL.slice(Math.max(0, i - 40), i + 40)}`);
  console.log(`   mío : ${reproducido.slice(Math.max(0, i - 40), i + 40)}`);
}

console.log("\n── 2. El monto cambia, y cambia SOLO el monto ──");
// Esto es todo el punto del cambio: antes había un código con R$ 100 grabado
// adentro y cualquier otro monto obligaba a pedirle uno nuevo al proveedor.
const c350 = armarCodigo({ ...CUENTA, montoCentavos: 35000, txid: "308a4c8a84284aacbd25430ae" });
verificar("R$ 350,00 queda escrito en el campo 54", c350.includes("5406350.00"));
verificar("  ...y la clave Pix sigue siendo la misma", c350.includes(CUENTA.chave));
verificar("  ...y el CRC se recalculó (no quedó el viejo)", !c350.endsWith("3B8E"));

console.log("\n── 3. Los centavos no se pierden ──");
// La plata viaja en centavos en todo Symphomed. Un redondeo acá es un médico
// que paga de menos y un saldo que no cuadra.
for (const [centavos, esperado] of [[1, "0.01"], [99, "0.99"], [100, "1.00"], [12345, "123.45"], [500000, "5000.00"]]) {
  verificar(`${centavos} centavos → R$ ${esperado}`, montoDesdeCentavos(centavos) === esperado);
}
verificar("cero no escribe monto (queda a criterio del pagador)", montoDesdeCentavos(0) === "");

console.log("\n── 4. El largo declarado tiene que ser el largo real ──");
// Cada campo dice cuánto mide en dos dígitos. Si el número no coincide con
// el contenido, el banco lee corrido y el código es basura — sin avisar.
function camposBienFormados(codigo) {
  let i = 0;
  while (i < codigo.length) {
    if (i + 4 > codigo.length) return false;
    const largo = Number(codigo.slice(i + 2, i + 4));
    if (!Number.isInteger(largo)) return false;
    if (i + 4 + largo > codigo.length) return false;
    i += 4 + largo;
  }
  return i === codigo.length;
}
verificar("el código real está bien formado", camposBienFormados(REAL));
verificar("el nuestro también", camposBienFormados(c350));
verificar("y uno con nombre largo también",
  camposBienFormados(armarCodigo({ ...CUENTA, nombre: "CLINICA SANTA MARIA DE LOS ANGELES SA", montoCentavos: 5000 })));

console.log("\n── 5. Acentos y ñ no entran ──");
// Hay bancos que muestran basura y otros que rechazan el código. Se limpia
// del lado nuestro para que no dependa de cómo alguien cargó el titular.
const conAcentos = armarCodigo({ chave: CUENTA.chave, nombre: "JOÃO NUÑEZ SAÚDE", ciudad: "SÃO PAULO", montoCentavos: 5000 });
verificar("el nombre sale sin acentos", conAcentos.includes("JOAO NUNEZ SAUDE"));
verificar("  ...y la ciudad también", conAcentos.includes("SAO PAULO"));
verificar("  ...y el código sigue bien formado", camposBienFormados(conAcentos));

console.log("\n── 6. Los límites del estándar se respetan ──");
verificar("el nombre se corta en 25", limpiar("A".repeat(80), 25).length === 25);
verificar("la ciudad se corta en 15", limpiar("B".repeat(80), 15).length === 15);
verificar("el txid se corta en 25", txidLimpio("C".repeat(90)).length === 25);
verificar("un txid vacío se vuelve ***", txidLimpio("") === "***");
verificar("  ...y uno con guiones queda solo con letras y números", txidLimpio("V-ABC_123") === "VABC123");

console.log("\n── 7. Sin clave Pix no se inventa un código ──");
// Un código armado sobre una clave vacía es un código que cobra a nadie.
let reventó = false;
try { armarCodigo({ ...CUENTA, chave: "", montoCentavos: 5000 }); } catch { reventó = true; }
verificar("tira error en vez de devolver algo roto", reventó);

console.log("\n── 8. El CRC es el que manda el estándar ──");
// Valor de control conocido de CRC16/CCITT-FALSE.
verificar('crc16("123456789") = 29B1', crc16("123456789") === "29B1");

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
