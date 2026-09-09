// Symphomed — Permisos del panel de clínica.
//
// Esta prueba no verifica que el panel funcione: verifica que NO haga de
// más. Un administrativo tiene acceso a la agenda y a los números de siete
// consultorios; si además pudiera abrir una consulta, sería una filtración
// del historial de todos los pacientes de la clínica, por diseño.
//
// Las tres afirmaciones que sostienen todo:
//   1. Un token de administrativo NO abre ninguna ruta clínica.
//   2. Un token de médico NO abre las rutas /admin.
//   3. Un administrador solo ve la clínica de SU token — el clinicaId no se
//      acepta del cliente en ningún lado.
//
// Corre sin base de datos: prueba la capa de permisos, que es donde vive la
// garantía. El aislamiento por datos lo dan los filtros medicoPhone que ya
// estaban y no se tocaron.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const { generarToken, requireAuth, requireAdmin } = require(path.join(RAIZ, "services", "auth"));

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Simula el paso por un middleware de Express y devuelve qué pasó.
function pasarPor(middleware, token) {
  const req = { headers: token ? { authorization: "Bearer " + token } : {}, query: {} };
  let estado = null, cuerpo = null, siguio = false;
  const res = {
    status(c) { estado = c; return this; },
    json(o) { cuerpo = o; return this; },
  };
  middleware(req, res, () => { siguio = true; });
  return { siguio, estado, cuerpo, req };
}

const requireMedico = requireAuth(["medico"]);

// ── Los tres tipos de cuenta, como los emite routes/medicoAuth.js ─────────
const tokenMedico = generarToken("70000001", "medico", 3600e3, { clinicaId: "clinica-1" });
const tokenAdmin = generarToken("70000002", "admin", 3600e3, { admin: true, clinicaId: "clinica-1" });
const tokenDirector = generarToken("70000003", "medico", 3600e3, { admin: true, clinicaId: "clinica-1" });
const tokenAdminSinClinica = generarToken("70000004", "admin", 3600e3, { admin: true });
const tokenOtraClinica = generarToken("70000005", "admin", 3600e3, { admin: true, clinicaId: "clinica-2" });

console.log("── 1. El administrativo NO entra a lo clínico ──");
const a1 = pasarPor(requireMedico, tokenAdmin);
verificar("un administrativo es rechazado por las rutas de médico", !a1.siguio && a1.estado === 403);
verificar("  ...y el motivo es permiso, no sesión vencida", a1.cuerpo?.error?.includes("permiso"));

console.log("\n── 2. El médico NO entra al panel de clínica ──");
const m1 = pasarPor(requireAdmin, tokenMedico);
verificar("un médico común es rechazado por /admin", !m1.siguio && m1.estado === 403);

console.log("\n── 3. El director pasa por las dos puertas ──");
verificar("el director entra a las rutas de médico", pasarPor(requireMedico, tokenDirector).siguio);
verificar("el director entra al panel de clínica", pasarPor(requireAdmin, tokenDirector).siguio);

console.log("\n── 4. Sin clínica no se administra nada ──");
const s1 = pasarPor(requireAdmin, tokenAdminSinClinica);
verificar("un admin sin clínica es rechazado", !s1.siguio && s1.estado === 403);
verificar("  ...diciéndole que no está asociado a ninguna", s1.cuerpo?.error?.includes("clínica"));

console.log("\n── 5. La clínica sale del token, nunca del cliente ──");
const ok = pasarPor(requireAdmin, tokenAdmin);
verificar("requireAdmin deja req.clinicaId listo para filtrar", ok.req.clinicaId === "clinica-1");
const otra = pasarPor(requireAdmin, tokenOtraClinica);
verificar("otro admin trae SU clínica, no la primera", otra.req.clinicaId === "clinica-2");

// Que ninguna ruta lea el clinicaId del pedido: si lo hiciera, un admin
// podría pedir los números de otra clínica cambiando el query a mano.
const fs = require("fs");
const codigoAdmin = fs.readFileSync(path.join(RAIZ, "routes", "admin.js"), "utf8");
const leeDelCliente = /req\.(query|body|params)\s*[.?[]\s*["']?clinicaId/.test(codigoAdmin);
verificar("routes/admin.js nunca lee clinicaId del pedido", !leeDelCliente);

console.log("\n── 6. El panel cuenta, no lee ──");
// La garantía estructural: ninguna consulta a una colección clínica puede
// devolver contenido. Si alguna vez hace falta un .find(), que sea a
// propósito y con una razón escrita, no por descuido.
// Cita NO está en la lista a propósito: una cita es una reserva —quién
// viene y cuándo—, no una nota clínica. La agenda del día la lee con find(),
// y lo que hace segura esa lectura es el select, que se prueba abajo en 8.
const COLECCIONES_CLINICAS = ["ConsultaMedica", "Paciente", "Receta", "Estudio", "Informe", "Odontograma", "ExamenOcular"];
const finds = [...codigoAdmin.matchAll(/\b([A-Z][A-Za-z]+)\.(find|findOne)\s*\(/g)]
  .filter(m => COLECCIONES_CLINICAS.includes(m[1]));
verificar(
  finds.length === 0
    ? "ninguna colección clínica se lee con find/findOne"
    : `SE LEE contenido clínico: ${finds.map(m => m[1] + "." + m[2]).join(", ")}`,
  finds.length === 0
);

const usaAgregacion = /\.aggregate\(/.test(codigoAdmin) && /\$group/.test(codigoAdmin);
verificar("los números salen de agregaciones ($group), que no devuelven contenido", usaAgregacion);

// El médico que alquila factura por su cuenta: el panel no puede mostrar su
// plata. Se verifica que la consulta de finanzas filtre por vinculo.
const filtraInquilinos = /vinculo\s*===\s*"empleado"/.test(codigoAdmin);
verificar("finanzas excluye a los que alquilan el consultorio", filtraInquilinos);

console.log("\n── 7. La cuota es de cada médico, no del router de la clínica ──");
// Los siete consultorios salen a internet con una sola IP. Con la cuota por
// IP se la repartían entre todos y el tercero que abría un Kardex al mismo
// tiempo se comía un 429 sin haber hecho nada. Y no se veía en las pruebas,
// porque cada médico probando desde su casa nunca compartía la IP con nadie.
const { limitMedico } = require(path.join(RAIZ, "services", "ratelimit"));

const IP_CLINICA = "200.10.20.30";
function pedir(token, ip) {
  const req = {
    headers: { "x-forwarded-for": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    query: {}, socket: {},
  };
  let siguio = false;
  const res = { setHeader() {}, status() { return this; }, json() { return this; } };
  limitMedico(req, res, () => { siguio = true; });
  return siguio;
}

// Tres médicos de la misma clínica, 40 pedidos cada uno, misma IP. Por IP
// eso eran 120 pedidos contra un tope de 30.
const tokensClinica = ["70000010", "70000011", "70000012"].map(u => generarToken(u, "medico", 3600e3));
let rebotados = 0;
for (let i = 0; i < 40; i++) for (const tk of tokensClinica) if (!pedir(tk, IP_CLINICA)) rebotados++;
verificar(
  rebotados === 0
    ? "tres médicos detrás de la misma IP no se pisan la cuota"
    : `se pisan la cuota: ${rebotados} pedidos rebotados desde la IP de la clínica`,
  rebotados === 0
);

// Pero el tope sigue existiendo: uno solo que se pase, se frena.
const tokenGoloso = generarToken("70000013", "medico", 3600e3);
let frenados = 0;
for (let i = 0; i < 65; i++) if (!pedir(tokenGoloso, "9.9.9.9")) frenados++;
verificar("un médico solo que se pasa del tope sí se frena", frenados > 0);

// La firma se verifica antes de usar el usuario como clave. Si no, mandar
// pedidos con un token armado a mano a nombre de otro médico le vaciaba la
// cuota, y del lado del médico bloqueado era indiagnosticable.
const tokenVictima = generarToken("70000014", "medico", 3600e3);
const tokenFalsificado = tokenVictima.split(".")[0] + "." + "0".repeat(32);
for (let i = 0; i < 70; i++) pedir(tokenFalsificado, "6.6.6.6");
verificar("un token falsificado no gasta la cuota del médico que dice ser", pedir(tokenVictima, "1.2.3.4"));

console.log("\n── 8. La agenda del día: qué sale y qué no ──");
// La agenda es lo único del panel que muestra el nombre de un paciente, y
// solo de los médicos empleados. Se prueba la función de verdad, no el
// código con una expresión regular: si mañana alguien agrega un campo a la
// respuesta, esto lo ve.
const { citaParaElPanel } = require(path.join(RAIZ, "routes", "admin"));

const citaCruda = {
  medicoPhone: "70000001",
  fecha: new Date("2026-08-26T15:30:00Z"),
  duracionMinutos: 45,
  estado: "confirmada",
  pacienteNombre: "María Fernández",
  pacienteTelefono: "59170000000",
  motivo: "dolor en el pecho desde ayer",
};

const deEmpleado = citaParaElPanel(citaCruda, "empleado");
const deInquilino = citaParaElPanel(citaCruda, "alquila");

verificar("del médico empleado sale el nombre del paciente", deEmpleado.paciente === "María Fernández");
verificar("del que alquila el consultorio NO sale el nombre", deInquilino.paciente === null);
verificar("  ...y sí sale la hora, para que la sala figure ocupada", Boolean(deInquilino.fecha && deInquilino.duracionMinutos));

// El motivo lo escribe el paciente al reservar y suele ser clínico. No sale
// para nadie, ni siquiera del médico empleado.
const campos = new Set([...Object.keys(deEmpleado), ...Object.keys(deInquilino)]);
const prohibidos = ["motivo", "pacienteTelefono", "telefono", "pacienteId", "googleEventId"];
const filtrados = prohibidos.filter(c => campos.has(c));
verificar(
  filtrados.length === 0
    ? "el motivo y el teléfono no viajan para ningún vínculo"
    : `VIAJAN campos que no deberían: ${filtrados.join(", ")}`,
  filtrados.length === 0
);

// Un vínculo desconocido —una cuenta vieja, un valor que alguien escribió a
// mano en la base— no puede caer del lado permisivo.
verificar("un vínculo desconocido oculta el nombre, no lo muestra", citaParaElPanel(citaCruda, "otra_cosa").paciente === null);
verificar("un vínculo vacío también", citaParaElPanel(citaCruda, undefined).paciente === null);

// Y que la consulta a la base no traiga de más: el select está cerrado a
// mano justamente para que agregar un campo al modelo no lo cuele solo.
const selectAgenda = codigoAdmin.match(/\.select\("([^"]*pacienteNombre[^"]*)"\)/);
verificar("la agenda pide a la base solo los campos que muestra",
  Boolean(selectAgenda) && !/motivo|Telefono/.test(selectAgenda[1]));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
