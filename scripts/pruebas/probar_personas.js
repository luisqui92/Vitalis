// Symphomed — Persona compartida entre consultorios.
//
// Dos garantías, y las dos son de seguridad del paciente:
//
//   1. El sistema NO une dos fichas por llamarse igual. Fusionar a dos
//      personas distintas hace que una herede las alergias y los
//      antecedentes de la otra, y eso no tiene vuelta atrás.
//
//   2. Compartir la identidad NO comparte la historia clínica. Buscar a una
//      persona no puede decir qué le pasa ni quién la atiende: si dijera
//      "la ve el Dr. X en oncología", buscar un paciente sería una forma de
//      averiguar quién trata a quién.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// ── 1. La regla que decide si dos fichas son la misma persona ─────────────
const fuenteScript = fs.readFileSync(path.join(RAIZ, "scripts", "proponer_personas.js"), "utf8");
const cuerpo = fuenteScript.slice(fuenteScript.indexOf("function normalizar"), fuenteScript.indexOf("async function main"));
const mod = { exports: {} };
new Function("module", "exports", cuerpo + "\nmodule.exports = { normalizar, soloDigitos, mismaPersona };")(mod, mod.exports);
const { mismaPersona } = mod.exports;

console.log("── 1. Unir dos fichas exige más que el nombre ──");
const casos = [
  ["mismo nombre + misma fecha de nacimiento", { nombre: "María Fernández", fechaNacimiento: "1985-04-12" }, { nombre: "maria fernandez", fechaNacimiento: "1985-04-12" }, true],
  ["mismo nombre + mismo teléfono", { nombre: "Juan Pérez", telefono: "591 71234567" }, { nombre: "juan perez", telefono: "59171234567" }, true],
  ["SOLO el nombre — dos Juan Pérez existen", { nombre: "Juan Pérez" }, { nombre: "Juan Pérez" }, false],
  ["mismo nombre, fechas distintas", { nombre: "Ana Rojas", fechaNacimiento: "1990-01-01" }, { nombre: "Ana Rojas", fechaNacimiento: "1975-06-30" }, false],
  ["nombres parecidos pero distintos", { nombre: "Ana Rojas", fechaNacimiento: "1990-01-01" }, { nombre: "Ana Rojas Vaca", fechaNacimiento: "1990-01-01" }, false],
  ["teléfono demasiado corto para identificar", { nombre: "Luis Vaca", telefono: "12345" }, { nombre: "Luis Vaca", telefono: "12345" }, false],
];
for (const [descripcion, a, b, esperado] of casos) {
  const r = mismaPersona(a, b);
  verificar(`${descripcion}${r ? " → " + r : ""}`, Boolean(r) === esperado);
}

// ── 2. El script propone; no fusiona solo ────────────────────────────────
console.log("\n── 2. Nada se fusiona sin que alguien lo pida ──");
verificar("vincular exige --aplicar explícito", /process\.argv\.includes\("--aplicar"\)/.test(fuenteScript));
verificar("sin --aplicar el script no escribe nada", (() => {
  const antesDeAplicar = fuenteScript.slice(0, fuenteScript.indexOf("if (!aplicar)"));
  return !/\.create\(|\.updateOne\(|\.save\(/.test(antesDeAplicar);
})());
verificar("los pares con solo el nombre quedan afuera incluso con --aplicar",
  /dudosos/.test(fuenteScript) && !/seguros.*dudosos.*aplicar/s.test(fuenteScript.slice(fuenteScript.indexOf("if (!aplicar)"))));

// ── 3. Las rutas no filtran lo que no deben ──────────────────────────────
console.log("\n── 3. Compartir identidad no comparte historia clínica ──");
const rutas = fs.readFileSync(path.join(RAIZ, "routes", "personas.js"), "utf8");

// La búsqueda devuelve identidad y alergias. Si además dijera quién la
// atiende, buscar un paciente sería averiguar a qué especialista consulta.
const selectBusqueda = rutas.match(/\.select\("([^"]*)"\)\s*\n?\s*\.limit\(400\)/);
verificar("la búsqueda selecciona campos explícitos, no el documento entero", Boolean(selectBusqueda));
if (selectBusqueda) {
  const campos = selectBusqueda[1].split(/\s+/);
  const permitidos = ["nombre", "fechaNacimiento", "sexo", "telefono", "documento", "alergias"];
  const demas = campos.filter(c => c && !permitidos.includes(c));
  verificar(`la búsqueda solo devuelve identidad y alergias${demas.length ? " — sobra: " + demas.join(", ") : ""}`, demas.length === 0);
}

const COLECCIONES_CLINICAS = ["ConsultaMedica", "Receta", "Estudio", "Informe", "Odontograma", "ExamenOcular", "TratamientoPlan"];
const leeClinico = COLECCIONES_CLINICAS.filter(c => new RegExp(`\\b${c}\\b`).test(rutas));
verificar(`ninguna ruta de personas toca una colección clínica${leeClinico.length ? " — toca: " + leeClinico.join(", ") : ""}`, leeClinico.length === 0);

// Cuántos consultorios la atienden: el número sí, quiénes no.
verificar("solo se cuenta en cuántos consultorios la atienden, no quiénes",
  /countDocuments\(\{ personaId/.test(rutas) && !/distinct\("medicoPhone"|select\("medicoPhone/.test(rutas));

// ── 4. La clínica sale de la cuenta, nunca del pedido ────────────────────
console.log("\n── 4. Nadie busca en la clínica de otro ──");
verificar("la clínica se resuelve desde la cuenta del médico", /async function clinicaDelMedico/.test(rutas));
verificar("ninguna ruta lee clinicaId del pedido", !/req\.(query|body|params)\s*[.?[]\s*["']?clinicaId/.test(rutas));

// ── 5. Editar alergias exige atender a esa persona ───────────────────────
console.log("\n── 5. Las alergias las edita quien la atiende ──");
verificar("no alcanza con estar en la clínica: hay que tener una ficha suya",
  /Paciente\.exists\(\{ medicoPhone, personaId/.test(rutas));
verificar("queda registrado quién las tocó y cuándo",
  /alergiasActualizadasPor/.test(rutas) && /alergiasActualizadasEn/.test(rutas));

// ── 6. Un médico solo no se entera de nada de esto ───────────────────────
console.log("\n── 6. Un médico sin clínica sigue igual que siempre ──");
verificar("buscar sin clínica devuelve vacío, no un error", /enClinica: false, personas: \[\]/.test(rutas));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
