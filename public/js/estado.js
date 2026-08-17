// Vitalis — estado compartido, helpers de formato, y el wrapper de fetch.
// Se carga primero: el resto de los módulos usan estas funciones/variables.
const API = ""; // mismo dominio que la API — todo este server ES Vitalis
let TOKEN = localStorage.getItem("salud_token") || null;
let MEDICO_NOMBRE = localStorage.getItem("salud_nombre") || "";
let MEDICO_TIPO_ESPECIALIDAD = localStorage.getItem("salud_tipo_especialidad") || "medicina_general";
const app = document.getElementById("app");
const headerSub = document.getElementById("headerSub");
const btnLogout = document.getElementById("btnLogout");

// Odontología, estética, oftalmología y veterinaria tienen su propia
// identidad visual (temas oscuros "Vitalis Dental" / "Vitalis Face" /
// "Vitalis Visión" / "Vitalis Veterinaria") — medicina general sigue con
// el look claro de siempre.
function aplicarTemaSegunEspecialidad() {
  const esDental = MEDICO_TIPO_ESPECIALIDAD === "odontologia";
  const esEstetica = MEDICO_TIPO_ESPECIALIDAD === "estetica";
  const esOftalmologia = MEDICO_TIPO_ESPECIALIDAD === "oftalmologia";
  const esVeterinaria = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  document.body.classList.toggle("tema-dental", esDental);
  document.body.classList.toggle("tema-estetica", esEstetica);
  document.body.classList.toggle("tema-oftalmologia", esOftalmologia);
  document.body.classList.toggle("tema-veterinaria", esVeterinaria);
  const marcaH1 = document.querySelector(".brand h1");
  if (marcaH1) marcaH1.textContent = esDental ? "Vitalis Dental" : esEstetica ? "Vitalis Face" : esOftalmologia ? "Vitalis Visión" : esVeterinaria ? "Vitalis Veterinaria" : "Vitalis";
}

// /veterinaria es la "landing" de Vitalis Veterinaria: mismo frontend, pero
// antes incluso de loguearse ya se ve con la marca/tema propios (nadie que
// entra por ahí debería ver "Vitalis" a secas). Solo aplica ANTES de
// loguearse — si ya hay sesión, manda la especialidad real de la cuenta
// (aplicarTemaSegunEspecialidad ya la aplicó), no la ruta por la que entró.
const ES_LANDING_VETERINARIA = location.pathname.replace(/\/+$/, "") === "/veterinaria";
function aplicarLandingVeterinariaSiCorresponde() {
  if (!ES_LANDING_VETERINARIA || TOKEN) return;
  document.body.classList.add("tema-veterinaria");
  document.title = "Vitalis Veterinaria · Kardex inteligente";
  const marcaH1 = document.querySelector(".brand h1");
  if (marcaH1) marcaH1.textContent = "Vitalis Veterinaria";
  if (headerSub) headerSub.textContent = "Kardex inteligente para tu clínica veterinaria";
}

// La transcripción y la nota clínica de consultas largas corren en segundo
// plano en el servidor; mientras no terminan, la pantalla se refresca sola.
let pollTimeout = null;
function detenerPolling() { if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; } }

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function edadDesde(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nac = new Date(fechaNacimiento);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/);
  return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase();
}

function fmt(s){ const m=String(Math.floor(s/60)).padStart(2,"0"); const r=String(s%60).padStart(2,"0"); return m+":"+r; }

// Ícono + etiqueta corta de cada pestaña del Kardex (ver pintarKardex en
// pacientes.js) — en un grid fijo de 4 columnas, así que el texto tiene que
// entrar corto sin cortarse. Medicina general y odontología necesitan
// fichas distintas (a un odontólogo no le sirven Vacunas/Evolución, y a
// cambio necesita el Odontograma), así que hay dos sets separados.
const TABS_KARDEX_MEDICINA_GENERAL = {
  paciente: { icono: "👤", label: "Paciente" },
  consultas: { icono: "🎙️", label: "Consultas" },
  medicamentos: { icono: "💊", label: "Medicación" },
  antecedentes: { icono: "📋", label: "Antecedentes" },
  vacunas: { icono: "💉", label: "Vacunas" },
  evolucion: { icono: "📈", label: "Evolución" },
  estudios: { icono: "🧪", label: "Estudios" },
  recetas: { icono: "📄", label: "Recetas" },
};
const TABS_KARDEX_ODONTOLOGIA = {
  paciente: { icono: "👤", label: "Paciente" },
  consultas: { icono: "🎙️", label: "Consultas" },
  odontograma: { icono: "🦷", label: "Odontograma" },
  plan: { icono: "💰", label: "Presupuesto" },
  medicamentos: { icono: "💊", label: "Medicación" },
  antecedentes: { icono: "📋", label: "Antecedentes" },
  estudios: { icono: "🧪", label: "Estudios" },
  recetas: { icono: "📄", label: "Recetas" },
};
// Vitalis Face (estética/plástica/dermatología): sin odontograma ni
// vacunas/evolución — en cambio, Estudios se usa para las fotos clínicas
// con ángulo guiado, y "plan" (mismo backend que el presupuesto dental)
// pasa a llamarse Procedimientos.
const TABS_KARDEX_ESTETICA = {
  paciente: { icono: "👤", label: "Paciente" },
  consultas: { icono: "🎙️", label: "Consultas" },
  plan: { icono: "💉", label: "Procedimientos" },
  estudios: { icono: "📷", label: "Fotos" },
  medicamentos: { icono: "💊", label: "Medicación" },
  antecedentes: { icono: "📋", label: "Antecedentes" },
  recetas: { icono: "📄", label: "Recetas" },
};
// Vitalis Visión (oftalmología): "ojos" es el mapa ocular por estructura,
// "evolucion" acá se usa para presión intraocular/agudeza visual (con
// alerta si la tendencia sube), y "plan" (mismo backend de Odonto/Face)
// pasa a llamarse Procedimientos (cirugía de catarata, láser, etc.).
const TABS_KARDEX_OFTALMOLOGIA = {
  paciente: { icono: "👤", label: "Paciente" },
  consultas: { icono: "🎙️", label: "Consultas" },
  ojos: { icono: "👁️", label: "Ojos" },
  plan: { icono: "🏥", label: "Procedimientos" },
  evolucion: { icono: "📈", label: "Evolución" },
  estudios: { icono: "🧪", label: "Estudios" },
  medicamentos: { icono: "💊", label: "Medicación" },
  antecedentes: { icono: "📋", label: "Antecedentes" },
  recetas: { icono: "📄", label: "Recetas" },
};
// Vitalis Veterinaria: mismas fichas que medicina general (consultas,
// medicación, antecedentes, vacunas, evolución de peso, estudios, recetas)
// — el paciente es un animal en vez de una persona, pero la estructura del
// Kardex es la misma; lo que cambia son los campos de "Paciente" (especie,
// raza, dueño) y el tema visual.
const TABS_KARDEX_VETERINARIA = {
  paciente: { icono: "🐾", label: "Paciente" },
  consultas: { icono: "🎙️", label: "Consultas" },
  medicamentos: { icono: "💊", label: "Medicación" },
  antecedentes: { icono: "📋", label: "Antecedentes" },
  vacunas: { icono: "💉", label: "Vacunas" },
  evolucion: { icono: "📈", label: "Peso" },
  estudios: { icono: "🧪", label: "Estudios" },
  recetas: { icono: "📄", label: "Recetas" },
};
function tabsKardexPara(tipoEspecialidad) {
  if (tipoEspecialidad === "odontologia") return TABS_KARDEX_ODONTOLOGIA;
  if (tipoEspecialidad === "estetica") return TABS_KARDEX_ESTETICA;
  if (tipoEspecialidad === "oftalmologia") return TABS_KARDEX_OFTALMOLOGIA;
  if (tipoEspecialidad === "veterinaria") return TABS_KARDEX_VETERINARIA;
  return TABS_KARDEX_MEDICINA_GENERAL;
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(API + path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw { status: res.status, error: (data && data.error) || "Error de conexión" };
  return data;
}

function logout() {
  TOKEN = null; MEDICO_NOMBRE = ""; MEDICO_TIPO_ESPECIALIDAD = "medicina_general";
  localStorage.removeItem("salud_token");
  localStorage.removeItem("salud_nombre");
  localStorage.removeItem("salud_tipo_especialidad");
  aplicarTemaSegunEspecialidad();
  btnLogout.style.display = "none";
  headerSub.textContent = "Kardex inteligente";
  renderLogin();
}
