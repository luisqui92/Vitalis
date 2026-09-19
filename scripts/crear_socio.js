// Symphomed — Da de alta un socio y le carga su primer lote de cupos.
//
// ═══ POR QUÉ EXISTE ESTE SCRIPT ════════════════════════════════════════════
//
// El modelo de socios está construido y probado entero —las rutas, el panel
// de /socio, las cuentas de cupos— pero no hay pantalla en el panel del
// operador para dar de alta al primero. O sea: funciona y no se puede usar.
//
// Esto es el puente hasta que esa pantalla exista. No es una versión "de
// prueba" del alta: usa exactamente los mismos modelos y las mismas reglas
// que la ruta POST /medico/operador/socios, para que lo que se cree acá sea
// indistinguible de lo que cree esa pantalla el día que esté.
//
// ═══ POR QUÉ NO ES UNA RUTA MÁS ════════════════════════════════════════════
//
// Porque dar de alta un socio es entregarle la capacidad de crear cuentas de
// médico. Correrlo desde el servidor —con acceso a la base— es un candado
// real: no alcanza con robar una sesión. El día que haya pantalla, ese candado
// lo pone requireOperador con segundo factor.
//
// Uso:
//   node scripts/crear_socio.js <telefono> "Nombre del socio" [cupos] [password]
//
// Ejemplos:
//   node scripts/crear_socio.js 70200001 "Distribuidora Andina" 10
//   node scripts/crear_socio.js 5511987650001 "Parceiro Brasil" 20 --brl
//
// Es idempotente en lo que importa: si el socio ya existe NO le pisa la
// contraseña ni le duplica lotes con la misma referencia.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Socio, LoteCupos } = require("../db/models");
const { hashPassword } = require("../services/auth");
const { cuposDe } = require("../services/socios");

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--brl");
  const esBrasil = process.argv.includes("--brl");
  const phone = String(args[0] || "").trim();
  const nombre = String(args[1] || "").trim();
  const cupos = Number(args[2] || 0);
  const passwordDada = String(args[3] || "").trim();
  // Diez caracteres es el mínimo que exige la ruta del operador. Se genera
  // una del mismo largo para que el camino cómodo no sea el más débil.
  const password = passwordDada || crypto.randomBytes(9).toString("base64url");

  if (!phone || !nombre) {
    console.error('Uso: node scripts/crear_socio.js <telefono> "Nombre del socio" [cupos] [password] [--brl]');
    process.exit(1);
  }
  if (passwordDada && passwordDada.length < 10) {
    console.error("❌ La contraseña de un socio tiene que tener al menos 10 caracteres.");
    console.error("   Es la misma regla que la ruta del operador; no la aflojo acá.");
    process.exit(1);
  }
  if (cupos && (!Number.isInteger(cupos) || cupos < 1)) {
    console.error("❌ Los cupos tienen que ser un número entero de 1 para arriba.");
    process.exit(1);
  }

  await mongoose.connect(CONFIG.MONGODB_URI);

  const moneda = esBrasil ? "BRL" : "BOB";
  const simbolo = esBrasil ? "R$" : "Bs";

  let socio = await Socio.findOne({ phone });
  if (!socio) {
    socio = await Socio.create({
      nombre, phone,
      passwordHash: await hashPassword(password),
      moneda, pais: esBrasil ? "BR" : "BO",
      activo: true,
    });
    console.log(VERDE(`\n✅ Socio creado: ${nombre} — +${phone} (${moneda})`));
    console.log(`   Contraseña${passwordDada ? "" : " generada"}: ${VERDE(password)}`);
    console.log(GRIS("   Anotala ahora: no se puede volver a ver, solo cambiar."));
  } else {
    console.log(`\nℹ️  El socio +${phone} ya existía (contraseña sin cambios).`);
  }

  // ─── El primer lote ─────────────────────────────────────────────────────
  //
  // Sin cupos, el socio entra al panel y no puede dar de alta a nadie: la
  // pantalla le dice que no tiene disponibles. Es el comportamiento correcto
  // y la primera vez se ve como si estuviera roto, así que se ofrece cargarle
  // uno de entrada.
  //
  // La referencia dice de dónde salió. Un lote sin referencia es plata que
  // nadie puede rastrear después — por eso la ruta del operador la exige, y
  // acá se pone una que se distingue sola.
  if (cupos > 0) {
    const referencia = `alta inicial ${new Date().toISOString().slice(0, 10)}`;
    const yaEsta = await LoteCupos.findOne({ socioId: socio._id, referencia });
    if (yaEsta) {
      console.log(`\nℹ️  Ya tenía un lote con la referencia «${referencia}». No se duplica.`);
    } else {
      await LoteCupos.create({
        socioId: socio._id, cantidad: cupos,
        precioUnitarioCentavos: socio.precioMayoristaCentavos || 0,
        moneda, referencia, registradoPor: "script",
        nota: "Cargado con scripts/crear_socio.js",
      });
      console.log(`✅ Lote cargado: ${cupos} cupos`);
    }
  }

  const c = await cuposDe(socio._id);
  console.log(`\n── Cómo queda ──`);
  console.log(`   Comprados   : ${c.comprados}`);
  console.log(`   Usados      : ${c.usados} ${GRIS(`(${c.porClinicas} centros + ${c.porProfesionales} profesionales sueltos)`)}`);
  console.log(`   Disponibles : ${VERDE(String(c.disponibles))}`);
  if (c.invertidoCentavos) {
    console.log(`   Invertido   : ${simbolo} ${(c.invertidoCentavos / 100).toFixed(2)}`);
  } else {
    console.log(GRIS(`   Invertido   : ${simbolo} 0 — el precio mayorista de este socio está en cero.`));
    console.log(GRIS("                 Se congela POR LOTE, así que ponerlo ahora no cambia este."));
  }

  const base = (CONFIG.APP_URL || "https://app.symphomed.com").replace(/\/+$/, "");
  console.log(`\n── Para entrar ──\n`);
  console.log(`   ${base}/socio`);
  console.log(`   Teléfono: ${phone}`);
  console.log(GRIS("\n   El panel del socio todavía NO está traducido: un socio en Brasil\n" +
                   "   lo va a ver en castellano. Es deuda conocida, anotada en\n" +
                   "   public/js/socioPanel.js.\n"));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("\n❌ " + (e.stack || e.message) + "\n");
  process.exit(1);
});
