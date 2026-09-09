// Symphomed — Qué clave Pix está cargada AHORA en producción.
//
// Cuando un banco contesta "conta de destino não foi encontrada", el que
// falló fue DICT: el directorio de claves del Banco Central no pudo resolver
// la clave. Eso ocurre antes de mirar el monto, el txid o el formato, así que
// solo deja dos causas:
//
//   A. la clave cargada en Symphomed NO es la que hay que cobrar — un dígito
//      de menos, un espacio pegado, alguien la pisó desde el panel;
//   B. la clave es la correcta pero ya no existe del lado del proveedor.
//
// Este script imprime lo que Symphomed está usando de verdad, para poder
// compararlo con la clave que sí funcionó. No se puede consultar DICT desde
// acá —hace falta ser participante del SPI—, así que la (B) se confirma
// pegando la clave suelta en un banco: si no aparece el titular, está muerta.
//
//   node scripts/ver_pix_configurado.js
require("dotenv").config();
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const mongoose = require("mongoose");
const { datosDePago } = require(path.join(RAIZ, "services", "datosPago"));
const { armarCodigo } = require(path.join(RAIZ, "services", "pix"));

// La clave del QR que un banco brasileño aceptó, para comparar contra ella.
const LA_QUE_FUNCIONO = "ff439919-4119-405d-838a-6c3e3efd8b55";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const datos = await datosDePago("br");
  await mongoose.disconnect();

  const clave = String(datos?.cuenta || "");
  console.log("\n── Lo que Symphomed está cobrando hoy en Brasil ──\n");
  console.log(`  clave Pix : ${clave ? `«${clave}»` : "(VACÍA — la pantalla de recarga ni siquiera abre)"}`);
  console.log(`  titular   : «${datos?.titular || ""}»`);
  console.log(`  ciudad    : «${datos?.ciudad || ""}»`);
  console.log(`  largo     : ${clave.length} caracteres`);

  // Las comillas de arriba están para que se vea un espacio pegado al final,
  // que es invisible en el panel y rompe la resolución igual que un typo.
  if (/^\s|\s$/.test(clave)) console.log("\n  ⚠️  La clave tiene espacios al principio o al final.");
  if (clave && clave !== clave.trim()) console.log("  ⚠️  Sobran espacios: DICT no la va a encontrar.");

  console.log("\n── Contra la clave que sí funcionó ──\n");
  if (!clave) {
    console.log("  No hay nada cargado, así que no hay nada que comparar.");
  } else if (clave === LA_QUE_FUNCIONO) {
    console.log("  ✅ Son idénticas.");
    console.log("\n  Entonces la clave cargada es la correcta y el problema es (B):");
    console.log("  la clave ya no existe del lado del proveedor. Confirmalo pegándola");
    console.log("  suelta en un banco — si no aparece «BRLA DIGITAL LTDA» antes de");
    console.log("  pedirte el monto, está dada de baja y hay que pedir una nueva.");
  } else {
    console.log(`  ❌ NO coinciden.`);
    console.log(`     cargada  : ${clave}`);
    console.log(`     funcionó : ${LA_QUE_FUNCIONO}`);
    console.log("\n  Es la causa (A): se está cobrando a una clave distinta de la que");
    console.log("  funcionaba. Corregila en el panel del operador y volvé a probar.");
  }

  if (clave) {
    console.log("\n── El código que se genera con eso, por R$ 1,00 ──\n");
    try {
      console.log("  " + armarCodigo({
        chave: clave, nombre: datos?.titular, ciudad: datos?.ciudad,
        montoCentavos: 100, txid: "",
      }));
    } catch (e) {
      console.log("  No se pudo armar: " + e.message);
    }
  }
  console.log("");
})().catch((e) => { console.error(e); process.exit(1); });
