// Symphomed — Probar el cobro en Brasil antes de que un médico lo use.
//
// El intento anterior falló y costó días averiguar por qué: la clave Pix de
// Takenos no resolvía en DICT y el error del banco no lo decía. La lección es
// que un código Pix mal apuntado NO da error acá — da un error del otro lado,
// horas después, en el celular de otra persona.
//
// Por eso este script hace las cosas en el orden que las hace un banco:
//
//   1. mira qué clave está cargada de verdad en la base;
//   2. arma el código con ESOS datos, no con unos de ejemplo;
//   3. lo imprime y lo dibuja como QR en la terminal, para escanearlo.
//
// Lo que NO puede hacer es consultar DICT para saber si la clave existe: eso
// exige ser participante del SPI. Esa parte la resuelve una persona con un
// banco en la mano, y el script dice exactamente cómo.
//
//   node scripts/probar_cobro_brasil.js              → usa lo que hay cargado
//   node scripts/probar_cobro_brasil.js 250          → por R$ 2,50
//
// Para cargar la cuenta del socio, sin pasar por el panel:
//
//   node scripts/probar_cobro_brasil.js --guardar \
//     --clave "12345678000199" --titular "CLINICA EXEMPLO LTDA" --ciudad "Curitiba"
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const RAIZ = path.join(__dirname, "..");
const { datosDePago, guardarDatosDePago } = require(path.join(RAIZ, "services", "datosPago"));
const { armarCodigo, montoDesdeCentavos } = require(path.join(RAIZ, "services", "pix"));

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const AMBAR = (t) => `\x1b[33m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? String(process.argv[i + 1] || "") : null;
}

// Qué tipo de clave es. Sirve para una sola cosa, pero importante: una clave
// escrita con guiones o con "+" no resuelve, y a simple vista se ve bien.
function tipoDeClave(c) {
  const limpia = c.replace(/\D/g, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return "aleatoria (EVP)";
  if (c.includes("@")) return "correo electrónico";
  if (c.startsWith("+55") && limpia.length === 13) return "teléfono";
  if (limpia.length === 11 && c === limpia) return "CPF";
  if (limpia.length === 14 && c === limpia) return "CNPJ";
  if (limpia.length === 11 || limpia.length === 14) return ROJO("CPF/CNPJ CON SEPARADORES — tiene que ir solo con números");
  if (c.startsWith("55") && limpia.length === 13) return ROJO('teléfono SIN el "+" — tiene que ser +55…');
  return AMBAR("no reconocido — revisalo con el titular de la cuenta");
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  if (process.argv.includes("--guardar")) {
    const clave = arg("clave"), titular = arg("titular"), ciudad = arg("ciudad");
    if (!clave || !titular) {
      console.log(ROJO("\n  Hacen falta --clave y --titular.\n"));
      await mongoose.disconnect(); process.exit(1);
    }
    await guardarDatosDePago(
      { banco: "Pix", cuenta: clave, titular, ciudad: ciudad || "", documento: arg("documento") || "" },
      "script", "br"
    );
    console.log(VERDE("\n  Guardado.\n"));
  }

  const datos = await datosDePago("br");
  await mongoose.disconnect();

  console.log("\n── Lo que Symphomed va a cobrar en Brasil ──\n");
  if (!datos.cuenta) {
    console.log(ROJO("  No hay ninguna clave Pix cargada."));
    console.log("  La pantalla de recarga le dice al médico que todavía no hay dónde pagar.\n");
    console.log(GRIS("  node scripts/probar_cobro_brasil.js --guardar --clave <clave> --titular <nombre> --ciudad <ciudad>\n"));
    process.exit(1);
  }

  console.log(`  Clave    : «${datos.cuenta}»`);
  console.log(`  Tipo     : ${tipoDeClave(datos.cuenta)}`);
  console.log(`  Titular  : «${datos.titular || ROJO("VACÍO")}»`);
  console.log(`  Ciudad   : «${datos.ciudad || AMBAR("vacía — el código va a decir SAO PAULO")}»`);

  // Las comillas están para que se vea un espacio pegado, que es invisible en
  // el panel y hace que DICT no encuentre la clave.
  if (datos.cuenta !== datos.cuenta.trim()) {
    console.log("\n  " + ROJO("La clave tiene espacios al principio o al final. DICT no la va a encontrar."));
  }

  const centavos = Number(process.argv.find(a => /^\d+$/.test(a)) || 100);
  const codigo = armarCodigo({
    chave: datos.cuenta, nombre: datos.titular, ciudad: datos.ciudad,
    montoCentavos: centavos, txid: "",
  });

  console.log(`\n── El código, por R$ ${montoDesdeCentavos(centavos)} ──\n`);
  console.log("  " + codigo + "\n");

  try {
    const QRCode = require("qrcode");
    console.log(await QRCode.toString(codigo, { type: "terminal", small: true }));
  } catch {
    console.log(GRIS("  (no se pudo dibujar el QR acá; copiá el texto de arriba)\n"));
  }

  console.log("── Cómo probarlo, en este orden ──\n");
  console.log("  1. " + VERDE("Primero SIN el QR.") + " En cualquier banco brasileño:");
  console.log("     Pix → transferir → pegar la clave → escribir 1,00.");
  console.log(`     ${VERDE("Tiene que aparecer «" + (datos.titular || "el titular") + "» ANTES de pedir el monto.")}`);
  console.log("     Si dice que no encuentra la cuenta, la clave está mal o dada de baja,");
  console.log("     y ningún código armado sobre ella va a funcionar.\n");
  console.log("  2. Recién si eso funcionó, pegá el código de arriba en «Pix Copia e Cola».");
  console.log("     Tiene que mostrar el mismo titular y el monto ya puesto.\n");
  console.log("  3. Y al final, desde Symphomed: entrar como médico brasileño → Recargar,");
  console.log("     elegir el monto y pagar el QR que muestra la pantalla. Eso prueba el");
  console.log("     camino completo, que es el único que importa.\n");
  console.log(GRIS("  El paso 1 es el que más informa y cuesta un real. No te lo saltees.\n"));
})().catch((e) => { console.error(ROJO("\n  " + e.message + "\n")); process.exit(1); });
