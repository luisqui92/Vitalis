// Symphomed — La agenda de cada médico, en SU hora.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Toda la agenda estaba construida sobre un desfase FIJO de −4 horas, la hora
// de Bolivia. Para un consultorio boliviano daba bien; para uno brasileño
// daba mal todo, y de la peor manera: no era un problema de cómo se mostraba,
// era que el dato GUARDADO estaba corrido.
//
//   · El turno que el médico tipeaba a mano se guardaba una hora más tarde.
//   · Los horarios libres se calculaban en hora boliviana, así que alguien
//     que atiende de 9 a 18 recibía turnos de 10 a 19.
//   · El WhatsApp y el asistente de voz le decían al paciente una hora que
//     no era la de su turno.
//
// Un turno corrido una hora no tira ningún error: es un paciente que llega
// tarde, o un médico que lo esperó. Por eso se prueba con conversiones de ida
// y vuelta y no leyendo el código.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const z = require(path.join(RAIZ, "services", "zonaHoraria"));

// ═══ 1. LA CONVERSIÓN ═══════════════════════════════════════════════════════
console.log("── 1. Hora de pared ↔ instante ──");

// 16/9/2026 14:30. Bolivia está en UTC−4 todo el año; Brasil, en esa fecha,
// en UTC−3.
const enBolivia = z.instanteEnZona("America/La_Paz", 2026, 8, 16, 14, 30);
const enBrasil = z.instanteEnZona("America/Sao_Paulo", 2026, 8, 16, 14, 30);

verificar("las 14:30 de La Paz son las 18:30 UTC",
  enBolivia.toISOString() === "2026-09-16T18:30:00.000Z");
verificar("las 14:30 de São Paulo son las 17:30 UTC",
  enBrasil.toISOString() === "2026-09-16T17:30:00.000Z");
verificar("y NO son el mismo instante (era el bug: se trataban igual)",
  enBolivia.getTime() !== enBrasil.getTime());

// ═══ 2. EL BUG, DEMOSTRADO ══════════════════════════════════════════════════
console.log("\n── 2. El turno del médico brasileño ──");
// Con el código viejo, un médico de São Paulo que cargaba las 14:30 obtenía
// el instante de las 14:30 BOLIVIANAS. Visto desde su propia pantalla, eso
// son las 15:30: su turno quedaba una hora más tarde.
verificar("con la zona fija, su turno de 14:30 se mostraba a las 15:30",
  z.horaEnZona("America/Sao_Paulo", enBolivia) === "15:30");
verificar("con la zona de su cuenta, se muestra a las 14:30",
  z.horaEnZona("America/Sao_Paulo", enBrasil) === "14:30");
// Y el mismo instante visto desde Bolivia da una hora menos, que es correcto.
verificar("el mismo instante visto desde Bolivia da 13:30, como corresponde",
  z.horaEnZona("America/La_Paz", enBrasil) === "13:30");

// ═══ 3. IDA Y VUELTA ════════════════════════════════════════════════════════
console.log("\n── 3. Ida y vuelta, todo el año y en las dos zonas ──");
// Se recorre el año entero: si hubiera un cambio de horario de verano, una
// hora de esas volvería distinta.
let mal = 0, probadas = 0;
for (const tz of ["America/La_Paz", "America/Sao_Paulo"]) {
  for (let mes = 0; mes < 12; mes++) {
    for (const hora of [0, 3, 9, 12, 14, 18, 23]) {
      probadas++;
      const inst = z.instanteEnZona(tz, 2026, mes, 15, hora, 45);
      const vuelta = z.horaEnZona(tz, inst);
      if (vuelta !== `${String(hora).padStart(2, "0")}:45`) {
        mal++;
        if (mal <= 3) console.log(`   ✗ ${tz} ${mes + 1}/2026 ${hora}:45 → ${vuelta}`);
      }
    }
  }
}
verificar(`las ${probadas} horas del año vuelven exactas en las dos zonas`, mal === 0);

// ═══ 4. "HOY" CERCA DE MEDIANOCHE ═══════════════════════════════════════════
console.log("\n── 4. Qué día es «hoy» ──");
// 17/9/2026 01:30 UTC. En Bolivia (−4) todavía es el 16; en Brasil (−3)
// también. A las 02:30 UTC, en Brasil ya es el 16 a las 23:30.
const casiMedianoche = new Date("2026-09-17T01:30:00Z");
const hoyBo = z.hoyEnZona("America/La_Paz", casiMedianoche);
const hoyBr = z.hoyEnZona("America/Sao_Paulo", casiMedianoche);
verificar("a las 01:30 UTC, en Bolivia todavía es el 16", hoyBo.dia === 16);
verificar("y en Brasil ya son las 22:30 del 16", hoyBr.dia === 16);
verificar("el día se calcula en la zona de la cuenta, no en la del servidor",
  z.fechaStrEnZona("America/La_Paz", casiMedianoche) === "2026-09-16");

// ═══ 5. EL FORMULARIO DEL MÉDICO ════════════════════════════════════════════
console.log("\n── 5. Lo que el médico tipea ──");
// El <input type="datetime-local"> manda "2026-09-16T14:30" sin zona: es
// hora de pared de quien lo tipeó.
const tipeado = "2026-09-16T14:30";
verificar("lo que tipea un médico boliviano se guarda en SU hora",
  z.localAInstante("America/La_Paz", tipeado).toISOString() === "2026-09-16T18:30:00.000Z");
verificar("y lo que tipea uno brasileño, en la suya",
  z.localAInstante("America/Sao_Paulo", tipeado).toISOString() === "2026-09-16T17:30:00.000Z");
verificar("una fecha inválida no explota, devuelve fecha inválida",
  isNaN(z.localAInstante("America/La_Paz", "cualquier cosa").getTime()));

// ═══ 6. QUE NO QUEDE LA ZONA ESCRITA A MANO ═════════════════════════════════
console.log("\n── 6. Ya no hay zonas escritas a mano ──");
const fs = require("fs");
const sinComentarios = (s) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const conZonaFija = [];
for (const dir of ["services", "routes"]) {
  for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
    if (!f.endsWith(".js") || f === "zonaHoraria.js") continue;
    const txt = sinComentarios(fs.readFileSync(path.join(RAIZ, dir, f), "utf8"));
    if (/timeZone:\s*"America\//.test(txt)) conZonaFija.push(`${dir}/${f}`);
  }
}
verificar("ninguna ruta ni servicio fuerza una zona", conZonaFija.length === 0);
if (conZonaFija.length) console.log("   quedan en:", conZonaFija.join(", "));

// Y que el campo exista en el modelo, con la de siempre por omisión: las
// cuentas que ya existen no pueden cambiar de comportamiento.
const { Medico } = require(path.join(RAIZ, "db", "models"));
verificar("el médico tiene su zona horaria guardada",
  !!Medico.schema.path("zonaHoraria"));
verificar("y por omisión es la de siempre, así que nada cambia para las cuentas actuales",
  Medico.schema.path("zonaHoraria").options.default === "America/La_Paz");

// Una zona inventada no puede tumbar la agenda.
verificar("una zona inválida cae a la de siempre en vez de explotar",
  z.zonaValida("Marte/Olympus") === "America/La_Paz");

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
