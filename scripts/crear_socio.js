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
//   node scripts/crear_socio.js <telefono> "Nombre del socio" [cupos] [--brl]
//   node scripts/crear_socio.js <telefono> --clave "NuevaContraseña"
//
// Ejemplos:
//   node scripts/crear_socio.js 70200001 "Distribuidora Andina" 10
//   node scripts/crear_socio.js 5511987650001 "Parceiro Brasil" 20 --brl
//   node scripts/crear_socio.js 70200001 --clave "SuClaveNueva99"
//
// ═══ POR QUÉ LA CONTRASEÑA SE CAMBIA CON UNA BANDERA Y NO SOLA ═════════════
//
// Correr esto de nuevo sobre un socio que existe NO le toca la contraseña.
// Tiene que ser así: el uso normal de volver a correrlo es cargarle más
// cupos, y si de paso le cambiara la clave, el socio quedaría afuera sin que
// nadie lo hubiera decidido — y se enteraría un lunes, intentando entrar.
//
// Pero tampoco puede no haber forma de cambiarla. La contraseña se guarda
// hasheada: si se pierde, no se recupera, se reemplaza. Sin esta bandera un
// socio que olvida su clave queda afuera para siempre, y hoy no existe
// ninguna otra puerta —la ruta PATCH del operador no toca la contraseña—.
//
// Entonces: nunca por accidente, siempre a pedido, y queda en auditoría.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { CONFIG } = require("../config");
const { Socio, LoteCupos } = require("../db/models");
const { hashPassword } = require("../services/auth");
const { cuposDe } = require("../services/socios");
const { registrar } = require("../services/auditoria");

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

async function main() {
  const argv = process.argv.slice(2);
  const esBrasil = argv.includes("--brl");
  // --clave viene con su valor pegado detrás; se sacan los dos del resto para
  // que las posiciones de nombre y cupos no se corran según si está o no.
  //
  // Cuando --clave NO está, iClave da -1, y "i !== iClave + 1" se vuelve
  // "i !== 0" — filtra el primer argumento (el teléfono) en el camino que
  // más se usa. Por eso la comprobación de iClave > -1 va primero: sin ella,
  // el bug pasa las pruebas manuales de "sí tiene --clave" y revienta
  // silenciosamente en el caso normal.
  const iClave = argv.indexOf("--clave");
  const claveNueva = iClave > -1 ? String(argv[iClave + 1] || "").trim() : "";
  const args = argv.filter((a, i) => a !== "--brl" && (iClave === -1 || (i !== iClave && i !== iClave + 1)));

  const phone = String(args[0] || "").trim();
  const nombre = String(args[1] || "").trim();
  const cupos = Number(args[2] || 0);
  // Diez caracteres es el mínimo que exige la ruta del operador. Se genera
  // una del mismo largo para que el camino cómodo no sea el más débil.
  const password = claveNueva || crypto.randomBytes(9).toString("base64url");

  if (!phone || (!nombre && !claveNueva)) {
    console.error('Uso: node scripts/crear_socio.js <telefono> "Nombre del socio" [cupos] [--brl]');
    console.error('     node scripts/crear_socio.js <telefono> --clave "NuevaContraseña"');
    process.exit(1);
  }
  if (iClave > -1 && !claveNueva) {
    console.error("❌ --clave necesita la contraseña nueva al lado.");
    process.exit(1);
  }
  if (claveNueva && claveNueva.length < 10) {
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
    if (!nombre) {
      console.error(`❌ No existe ningún socio con +${phone}, así que no hay contraseña que cambiar.`);
      console.error('   Para crearlo: node scripts/crear_socio.js ' + phone + ' "Nombre del socio" [cupos]');
      await mongoose.disconnect();
      process.exit(1);
    }
    socio = await Socio.create({
      nombre, phone,
      passwordHash: await hashPassword(password),
      moneda, pais: esBrasil ? "BR" : "BO",
      activo: true,
    });
    console.log(VERDE(`\n✅ Socio creado: ${nombre} — +${phone} (${moneda})`));
    console.log(`   Contraseña${claveNueva ? "" : " generada"}: ${VERDE(password)}`);
    console.log(GRIS("   Anotala ahora: se guarda hasheada y no se puede volver a ver."));
    console.log(GRIS(`   Si se pierde: node scripts/crear_socio.js ${phone} --clave "OtraContraseña"`));
  } else if (claveNueva) {
    // Se pide explícitamente con --clave, así que se hace y queda anotado.
    // Cambiarle la contraseña a alguien es sacarlo de su cuenta hasta que se
    // entere de la nueva: tiene que poder reconstruirse quién y cuándo.
    socio.passwordHash = await hashPassword(claveNueva);
    await socio.save();
    registrar({
      medicoPhone: "script", accion: "cambiar_clave_socio",
      recurso: `Socio:${socio._id}`, detalle: `${socio.nombre} (+${phone})`,
    });
    console.log(VERDE(`\n✅ Contraseña cambiada: ${socio.nombre} — +${phone}`));
    console.log(`   Contraseña nueva: ${VERDE(claveNueva)}`);
    console.log(GRIS("   La anterior dejó de servir en este momento. Avisale."));
  } else {
    console.log(`\nℹ️  El socio +${phone} ya existía (contraseña sin cambios).`);
    console.log(GRIS(`   Para cambiársela: node scripts/crear_socio.js ${phone} --clave "OtraContraseña"`));
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
