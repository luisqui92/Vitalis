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
//
// El servidor de producción corre en UTC, y es ahí donde se nota: de 20:00 a
// 24:00 en Bolivia el servidor ya está en el día siguiente. Se fija acá para
// que la prueba dé lo mismo en cualquier máquina.
process.env.TZ = "UTC";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.OPENAI_KEY = process.env.OPENAI_KEY || "sk-de-prueba";

const path = require("path");
const http = require("http");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
function pedir(puerto, metodo, ruta, token, cuerpo) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: "Bearer " + token } : {};
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    if (datos) { headers["content-type"] = "application/json"; headers["content-length"] = Buffer.byteLength(datos); }
    const req = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* no era JSON */ } resolve({ estado: res.statusCode, cuerpo: j }); });
    });
    req.on("error", () => resolve({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });
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

// ═══ EL RELOJ DEL SERVIDOR ══════════════════════════════════════════════════
// Para probar "a las 21:30 de Bolivia" sin esperar a que lo sea: el reloj
// arranca en el instante pedido y sigue andando, así la base y los timers no
// notan nada raro.
const DateReal = Date;
function relojEn(iso) {
  const corrimiento = DateReal.parse(iso) - DateReal.now();
  global.Date = class extends DateReal {
    constructor(...a) { if (a.length) super(...a); else super(DateReal.now() + corrimiento); }
    static now() { return DateReal.now() + corrimiento; }
  };
}
function relojReal() { global.Date = DateReal; }

// La IA de mentira: guarda lo que se le manda y contesta lo que se le pida.
const axios = require(path.join(RAIZ, "node_modules", "axios"));
const pedidosIA = [];
let respuestaIA = {};
axios.post = async (_url, cuerpo) => {
  pedidosIA.push(cuerpo);
  return { data: { choices: [{ message: { content: JSON.stringify(respuestaIA) } }] } };
};
const NC = require(path.join(RAIZ, "services", "notaClinica"));
const hoyQueRecibe = () => (pedidosIA.at(-1)?.messages?.[1]?.content.match(/Hoy es [^.]+\./) || [""])[0];

(async () => {
  // ═══ 7. QUÉ DÍA ES HOY PARA LA IA ═════════════════════════════════════════
  console.log("\n── 7. El «hoy» que recibe la IA de la nota ──");
  // La IA resuelve "nos vemos el sábado" contando desde lo que le decimos que
  // es hoy. Con el día de la semana del servidor y la fecha de Bolivia, a las
  // 21:30 del jueves le llegaba "viernes 2026-10-15".
  respuestaIA = { motivoConsulta: "Control" };
  relojEn("2026-10-16T01:30:00Z"); // jueves 15, 21:30 en Bolivia
  try {
    await NC.generarNotaClinica("Control de rutina.", { zona: "America/La_Paz" }, "es");
    verificar(`a las 21:30 del jueves en Bolivia la IA recibe «jueves 2026-10-15» (${hoyQueRecibe()})`,
      hoyQueRecibe() === "Hoy es jueves 2026-10-15.");
    await NC.generarNotaClinica("Control de rutina.", {}, "es");
    verificar("una cuenta sin zona usa la de siempre", hoyQueRecibe() === "Hoy es jueves 2026-10-15.");
  } finally { relojReal(); }
  // A las 00:30 de São Paulo ya es viernes; en Bolivia, todavía jueves. Con la
  // fecha de Bolivia fija, la cuenta brasileña recibía la de ayer.
  relojEn("2026-10-16T03:30:00Z");
  try {
    await NC.generarNotaClinica("Controle de rotina.", { zona: "America/Sao_Paulo" }, "pt");
    verificar(`a las 00:30 de São Paulo la IA recibe el viernes 16, no la fecha de Bolivia (${hoyQueRecibe()})`,
      hoyQueRecibe() === "Hoy es sexta-feira 2026-10-16.");
    await NC.generarNotaClinica("Control de rutina.", { zona: "America/La_Paz" }, "es");
    verificar("y en Bolivia, a la misma hora (23:30), sigue siendo jueves 15", hoyQueRecibe() === "Hoy es jueves 2026-10-15.");
    // Una nota que se escribe días después cuenta desde el día de la consulta.
    await NC.generarNotaClinica("Control de rutina.", { zona: "America/La_Paz", fechaReferencia: new DateReal("2026-10-12T15:00:00Z") }, "es");
    verificar(`con la fecha de la consulta, el «hoy» es el de la consulta (${hoyQueRecibe()})`,
      hoyQueRecibe() === "Hoy es lunes 2026-10-12.");
  } finally { relojReal(); }

  // ═══ DE ACÁ EN ADELANTE, CON LA BASE ════════════════════════════════════════
  let MongoMemoryServer;
  for (const m of ["mongodb-memory-server", path.join(RAIZ, "node_modules", "mongodb-memory-server")]) {
    try { ({ MongoMemoryServer } = require(m)); break; } catch { /* seguimos */ }
  }
  if (!MongoMemoryServer) {
    console.log("\n⏭️  Rutas SALTEADAS: no hay base de prueba. Esto NO es un ✅.");
    process.exit(fallos === 0 ? 0 : 1);
  }
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + "zona_horaria";
  require(path.join(RAIZ, "config")).CONFIG.MONGODB_URI = process.env.MONGODB_URI;
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const M = require(path.join(RAIZ, "db", "models"));
  const { generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  // El WhatsApp al paciente, de mentira: se guarda lo que se le escribió.
  const meta = require(path.join(RAIZ, "services", "metaWhatsapp"));
  const enviados = [];
  meta.enviarTextoOPlantilla = async (telefono, texto) => { enviados.push({ telefono, texto }); return { ok: true }; };
  require(path.join(RAIZ, "services", "briefClinico")).regenerarBriefClinico = async () => {};

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "consultaMedica"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const servidor = http.createServer(app);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;

  // Dos consultorios iguales salvo la zona.
  const BO = "70088001", BR = "70088002";
  await M.Medico.create({ phone: BO, nombre: "Dra. La Paz", passwordHash: "x", activo: true, zonaHoraria: "America/La_Paz" });
  await M.Medico.create({ phone: BR, nombre: "Dra. São Paulo", passwordHash: "x", activo: true, zonaHoraria: "America/Sao_Paulo", idioma: "pt" });
  // Largos: el reloj de la prueba se corre unos días para atrás y para
  // adelante, y un token de una hora vencería en el camino.
  const UN_ANIO = 365 * 864e5;
  const tk = { [BO]: generarToken(BO, "medico", UN_ANIO), [BR]: generarToken(BR, "medico", UN_ANIO) };
  const pacientes = {
    [BO]: await M.Paciente.create({ medicoPhone: BO, nombre: "Juana Pérez", telefono: "59170088011" }),
    [BR]: await M.Paciente.create({ medicoPhone: BR, nombre: "Maria Souza", telefono: "5511970088012" }),
  };
  // Una consulta como la deja la transcripción, con la fecha de creación que
  // se pida: es la que manda en el «hoy» de una nota que se vuelve a generar.
  const consultaDe = async (med, notaClinica, creada, extra = {}) => {
    const c = await M.ConsultaMedica.create({
      medicoPhone: med, pacienteId: pacientes[med]._id, estado: "completado",
      transcripcionCompleta: "El médico le dice al paciente que vuelva a control.",
      notaClinicaEstado: "completado", notaClinica, ...extra,
    });
    if (creada) await M.ConsultaMedica.collection.updateOne({ _id: c._id }, { $set: { createdAt: new DateReal(creada) } });
    return M.ConsultaMedica.findById(c._id);
  };
  const esperarNota = async (id) => {
    for (let i = 0; i < 100; i++) {
      const c = await M.ConsultaMedica.findById(id).lean();
      if (c.notaClinicaEstado !== "pendiente") return c;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    return null;
  };

  // ═══ 8. LA NOTA QUE SE VUELVE A GENERAR ═════════════════════════════════════
  console.log("\n── 8. «Volver a generar la nota», días después ──");
  // La consulta fue el jueves 15 a las 21:00 en São Paulo (00:00Z del 16); la
  // nota se vuelve a generar el lunes 19. "El sábado" es el 17, no el 24.
  respuestaIA = { motivoConsulta: "Controle" };
  const regenerada = await consultaDe(BR, {}, "2026-10-16T00:00:00Z", { notaClinicaEstado: "error" });
  relojEn("2026-10-19T14:00:00Z");
  let r;
  try {
    r = await pedir(puerto, "POST", `/medico/consultas/${regenerada._id}/nota/regenerar`, tk[BR]);
    await esperarNota(regenerada._id);
  } finally { relojReal(); }
  verificar(`se vuelve a generar (${r.estado})`, r.estado === 202);
  verificar(`la IA recibe el día de la consulta, en la zona de la cuenta: jueves 15 (${hoyQueRecibe()})`,
    hoyQueRecibe() === "Hoy es quinta-feira 2026-10-15.");

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { relojReal(); console.error("💥", e); process.exit(1); });
