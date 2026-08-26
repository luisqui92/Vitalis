// Vitalis — estado compartido, helpers de formato, y el wrapper de fetch.
// Se carga primero: el resto de los módulos usan estas funciones/variables.
const API = ""; // mismo dominio que la API — todo este server ES Vitalis
let TOKEN = localStorage.getItem("salud_token") || null;
let MEDICO_NOMBRE = localStorage.getItem("salud_nombre") || "";
let MEDICO_TIPO_ESPECIALIDAD = localStorage.getItem("salud_tipo_especialidad") || "medicina_general";
// En escritorio ancho (ver escritorio.js) esto se reapunta al contenedor
// del panel de escritorio — así ninguna pantalla existente (renderDashboard,
// renderAgenda, etc.) necesita saber si está en celular o en escritorio,
// todas simplemente escriben en `app`.
let app = document.getElementById("app");
const headerSub = document.getElementById("headerSub");
const btnLogout = document.getElementById("btnLogout");
const btnAsistente = document.getElementById("btnAsistente");

// Odontología, estética, oftalmología y veterinaria tienen su propia
// identidad visual (temas oscuros "Vitalis Dental" / "Vitalis Face" /
// "Vitalis Visión" / "Vitalis Veterinaria") — medicina general sigue con
// el look claro de siempre.
function aplicarTemaSegunEspecialidad() {
  const esDental = MEDICO_TIPO_ESPECIALIDAD === "odontologia";
  const esEstetica = MEDICO_TIPO_ESPECIALIDAD === "estetica";
  const esOftalmologia = MEDICO_TIPO_ESPECIALIDAD === "oftalmologia";
  const esVeterinaria = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  const esGinecologia = MEDICO_TIPO_ESPECIALIDAD === "ginecologia";
  const esPediatria = MEDICO_TIPO_ESPECIALIDAD === "pediatria";
  const esNeuro = MEDICO_TIPO_ESPECIALIDAD === "neurodesarrollo";
  document.body.classList.toggle("tema-dental", esDental);
  document.body.classList.toggle("tema-estetica", esEstetica);
  document.body.classList.toggle("tema-oftalmologia", esOftalmologia);
  document.body.classList.toggle("tema-veterinaria", esVeterinaria);
  document.body.classList.toggle("tema-ginecologia", esGinecologia);
  document.body.classList.toggle("tema-pediatria", esPediatria);
  document.body.classList.toggle("tema-neuro", esNeuro);
  const marcaH1 = document.querySelector(".brand h1");
  if (marcaH1) marcaH1.textContent = t(esDental ? "marca.dental" : esEstetica ? "marca.estetica" : esOftalmologia ? "marca.oftalmologia" : esVeterinaria ? "marca.veterinaria" : esGinecologia ? "marca.ginecologia" : esPediatria ? "marca.pediatria" : esNeuro ? "marca.neuro" : "marca.base");
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
  document.title = t("marca.tituloVet");
  const marcaH1 = document.querySelector(".brand h1");
  if (marcaH1) marcaH1.textContent = t("marca.veterinaria");
  if (headerSub) headerSub.textContent = t("marca.subtituloVet");
}

// La transcripción y la nota clínica de consultas largas corren en segundo
// plano en el servidor; mientras no terminan, la pantalla se refresca sola.
let pollTimeout = null;
function detenerPolling() { if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; } }

// ─── NÚMERO DE PANTALLA ───────────────────────────────────────────────────
// Cada pantalla pide sus datos al servidor y recién después pinta. Si en ese
// rato el médico se fue a otra (abrió un informe, por ejemplo), el pintado
// viejo llega tarde y le tapa lo que está haciendo — y eso pasa solo, porque
// el aviso de tiempo real dispara repintados que nadie pidió.
// Cada pantalla toma un número al entrar y no pinta si mientras tanto salió
// otro: llegó tarde, ya no es la pantalla que el médico está mirando.
let SERIE_PANTALLA = 0;
function nuevaSeriePantalla() { return ++SERIE_PANTALLA; }
function seriePantallaVigente(n) { return n === SERIE_PANTALLA; }

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

// Set propio de íconos de línea (SVG inline, trazo = currentColor) para las
// pestañas del Kardex — antes eran emoji, que quedan fuera de lugar al lado
// de una tipografía cuidada (cada plataforma los dibuja distinto, y no hay
// forma de afinarles el trazo/color). currentColor hace que cada uno tome
// solo el color de texto de la pestaña (mudo si está inactiva, blanco si
// está activa) sin tener que tocar nada más.
function svgIcono(pathInner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${pathInner}</svg>`;
}
const ICONOS = {
  persona: svgIcono(`<circle cx="12" cy="8.2" r="3.4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>`),
  pata: svgIcono(`<circle cx="7" cy="8.3" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="17" cy="8.3" r="1.7"/><path d="M12 11c-3.3 0-6 2.4-6 5.2 0 2 1.7 3.2 3.5 2.4.8-.3 1.6-.5 2.5-.5s1.7.2 2.5.5c1.8.8 3.5-.4 3.5-2.4 0-2.8-2.7-5.2-6-5.2z"/>`),
  mic: svgIcono(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M9 21h6"/>`),
  diente: svgIcono(`<path d="M12 4c-1.7 0-2.9 1.1-4 1.1-1.3 0-2-1-2 .9 0 2.4.6 4.1 1.1 6.3.5 1.9.7 4.6 1.9 4.6 1.1 0 1-2.7 1.5-4 .3-.8.8-1.2 1.5-1.2s1.2.4 1.5 1.2c.5 1.3.4 4 1.5 4 1.2 0 1.4-2.7 1.9-4.6.5-2.2 1.1-3.9 1.1-6.3 0-1.9-.7-.9-2-.9-1.1 0-2.3-1.1-4-1.1z"/>`),
  clipboard: svgIcono(`<rect x="5" y="4.2" width="14" height="16.8" rx="2"/><path d="M9 3.2h6a1 1 0 0 1 1 1V6H8V4.2a1 1 0 0 1 1-1z"/><path d="M8.5 11h7M8.5 14.3h7M8.5 17.6h4"/>`),
  pastilla: svgIcono(`<rect x="3" y="9" width="18" height="6" rx="3"/><line x1="12" y1="9" x2="12" y2="15"/>`),
  documento: svgIcono(`<path d="M7 3h7l4 4v13.2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9 12.3h6M9 15.6h6M9 9h2"/>`),
  jeringa: svgIcono(`<path d="M12 2.2v3"/><rect x="9" y="5.2" width="6" height="9.5" rx="1"/><path d="M10.5 14.7v5.3a1.5 1.5 0 0 0 3 0v-5.3"/>`),
  tendencia: svgIcono(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15.5 6h5.5v5.5"/>`),
  frasco: svgIcono(`<path d="M9.2 3h5.6M9.8 3v6.3L5.4 18a1.9 1.9 0 0 0 1.7 2.7h9.8a1.9 1.9 0 0 0 1.7-2.7l-4.4-8.7V3"/><path d="M8 15.5h8"/>`),
  camara: svgIcono(`<path d="M4 8.3h3.2l1.4-2h6.8l1.4 2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.3a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.3" r="3.4"/>`),
  ojo: svgIcono(`<path d="M2 12s3.6-6.6 10-6.6 10 6.6 10 6.6-3.6 6.6-10 6.6S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>`),
  mas: svgIcono(`<path d="M12 5v14M5 12h14"/>`),
  calendario: svgIcono(`<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/>`),
  escudo: svgIcono(`<path d="M12 3l7 3v6c0 4.8-3 8.3-7 9.5-4-1.2-7-4.7-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/>`),
  embarazo: svgIcono(`<circle cx="12" cy="6.3" r="2.6"/><path d="M8 21v-6.5C6.3 13 5.5 10.8 6.3 8.7 7 6.8 8.9 5.6 11 5.6h1c3 0 5.2 2.8 4.6 5.7-.4 2.1-2 3.8-4.1 4.3V21"/>`),
  corazon: svgIcono(`<path d="M12 20.2s-7.8-4.8-7.8-10.4c0-2.7 2.1-4.8 4.7-4.8 1.6 0 3 .8 3.1 2 .1-1.2 1.5-2 3.1-2 2.6 0 4.7 2.1 4.7 4.8 0 5.6-7.8 10.4-7.8 10.4z"/>`),
  campana: svgIcono(`<path d="M12 3.2a5.6 5.6 0 0 0-5.6 5.6c0 4.2-1.7 5.5-1.7 5.5h14.6s-1.7-1.3-1.7-5.5A5.6 5.6 0 0 0 12 3.2z"/><path d="M10.3 17.5a2 2 0 0 0 3.4 0"/>`),
  // Útero esquemático (cuerpo + trompas + ovarios): el mapa ginecológico.
  utero: svgIcono(`<path d="M8.5 8.4c-1 2.7-.4 6.6 3.5 7.6 3.9-1 4.5-4.9 3.5-7.6-1.3.8-5.7.8-7 0z"/><path d="M8.5 8.4C7.2 6.6 5.6 6.3 4.4 7.4"/><path d="M15.5 8.4c1.3-1.8 2.9-2.1 4.1-1"/><circle cx="3.4" cy="8.6" r="1.5"/><circle cx="20.6" cy="8.6" r="1.5"/><path d="M10.6 16v3.6h2.8V16"/>`),
};

// Ícono + etiqueta corta de cada pestaña del Kardex (ver pintarKardex en
// pacientes.js) — en un grid fijo de 4 columnas, así que el texto tiene que
// entrar corto sin cortarse. Medicina general y odontología necesitan
// fichas distintas (a un odontólogo no le sirven Vacunas/Evolución, y a
// cambio necesita el Odontograma), así que hay dos sets separados.
const TABS_KARDEX_MEDICINA_GENERAL = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  vacunas: { icono: ICONOS.jeringa, claveLabel: "tab.vacunas" },
  evolucion: { icono: ICONOS.tendencia, claveLabel: "tab.evolucion" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
const TABS_KARDEX_ODONTOLOGIA = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  odontograma: { icono: ICONOS.diente, claveLabel: "tab.odontograma" },
  plan: { icono: ICONOS.clipboard, claveLabel: "tab.presupuesto" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Face (estética/plástica/dermatología): sin odontograma ni
// vacunas/evolución — en cambio, Estudios se usa para las fotos clínicas
// con ángulo guiado, y "plan" (mismo backend que el presupuesto dental)
// pasa a llamarse Procedimientos.
const TABS_KARDEX_ESTETICA = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  plan: { icono: ICONOS.clipboard, claveLabel: "tab.procedimientos" },
  estudios: { icono: ICONOS.camara, claveLabel: "tab.fotos" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Visión (oftalmología): "ojos" es el mapa ocular por estructura,
// "evolucion" acá se usa para presión intraocular/agudeza visual (con
// alerta si la tendencia sube), y "plan" (mismo backend de Odonto/Face)
// pasa a llamarse Procedimientos (cirugía de catarata, láser, etc.).
const TABS_KARDEX_OFTALMOLOGIA = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  ojos: { icono: ICONOS.ojo, claveLabel: "tab.ojos" },
  plan: { icono: ICONOS.clipboard, claveLabel: "tab.procedimientos" },
  evolucion: { icono: ICONOS.tendencia, claveLabel: "tab.evolucion" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Veterinaria: mismas fichas que medicina general (consultas,
// medicación, antecedentes, vacunas, evolución de peso, estudios, recetas)
// — el paciente es un animal en vez de una persona, pero la estructura del
// Kardex es la misma; lo que cambia son los campos de "Paciente" (especie,
// raza, dueño) y el tema visual.
const TABS_KARDEX_VETERINARIA = {
  paciente: { icono: ICONOS.pata, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  mapaCorporal: { icono: ICONOS.pata, claveLabel: "tab.lesiones" },
  vacunas: { icono: ICONOS.jeringa, claveLabel: "tab.vacunas" },
  evolucion: { icono: ICONOS.tendencia, claveLabel: "tab.peso" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Obstetricia (ginecología y obstetricia): "embarazo" es la FUM/FPP
// y semanas de gestación del embarazo activo (o para abrir uno nuevo);
// "evolucion" acá se usa para peso materno, altura uterina y frecuencia
// cardíaca fetal control a control, y "estudios" para las ecografías
// obstétricas (mismo backend de Estudios de siempre).
const TABS_KARDEX_GINECOLOGIA = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  embarazo: { icono: ICONOS.embarazo, claveLabel: "tab.embarazo" },
  mapaGineco: { icono: ICONOS.utero, claveLabel: "tab.mapa" },
  evolucion: { icono: ICONOS.corazon, claveLabel: "tab.controles" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.ecografias" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Pediatría: "crecimiento" son las curvas de la OMS (peso, talla,
// perímetro cefálico e IMC para la edad) y es la pestaña que define la rama
// — un pediatra la abre antes que ninguna otra. "evolucion" queda para los
// signos vitales de siempre (temperatura, saturación), que en un chico con
// fiebre siguen haciendo falta.
const TABS_KARDEX_PEDIATRIA = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.consultas" },
  crecimiento: { icono: ICONOS.tendencia, claveLabel: "tab.crecimiento" },
  vacunas: { icono: ICONOS.jeringa, claveLabel: "tab.vacunas" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  evolucion: { icono: ICONOS.corazon, claveLabel: "tab.signos" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Vitalis Neurodesarrollo (autismo, síndrome de Down y otras condiciones):
// "perfilNeuro" es quién es la persona, qué apoyos necesita y su mapa
// sensorial; "objetivos" son las metas medibles con su progreso; "salud" es
// el calendario de controles que hay que ir a buscar. No hay pestaña de
// diagnóstico a propósito — ver el comentario en db/models.js.
const TABS_KARDEX_NEURO = {
  paciente: { icono: ICONOS.persona, claveLabel: "tab.paciente" },
  perfilNeuro: { icono: ICONOS.persona, claveLabel: "tab.perfil" },
  consultas: { icono: ICONOS.mic, claveLabel: "tab.sesiones" },
  objetivos: { icono: ICONOS.tendencia, claveLabel: "tab.objetivos" },
  // ADOS-2, ADI-R, Vineland... Vitalis registra el resultado, nunca el
  // instrumento: son propiedad de sus editoriales y requieren entrenamiento.
  instrumentos: { icono: ICONOS.clipboard, claveLabel: "tab.instrumentos" },
  salud: { icono: ICONOS.jeringa, claveLabel: "tab.salud" },
  crecimiento: { icono: ICONOS.tendencia, claveLabel: "tab.crecimiento" },
  medicamentos: { icono: ICONOS.pastilla, claveLabel: "tab.medicamentos" },
  antecedentes: { icono: ICONOS.clipboard, claveLabel: "tab.antecedentes" },
  estudios: { icono: ICONOS.frasco, claveLabel: "tab.estudios" },
  recetas: { icono: ICONOS.documento, claveLabel: "tab.recetas" },
  informes: { icono: ICONOS.documento, claveLabel: "tab.informes" },
};
// Los mapas de arriba guardan la CLAVE del texto, no el texto. La traducción
// se resuelve acá, en cada llamada, y no al cargar el archivo: estado.js se
// carga antes del login, cuando todavía no se sabe en qué idioma trabaja el
// médico. Si las etiquetas se resolvieran arriba, quedarían congeladas en el
// idioma que hubiera al abrir la página y no cambiarían al iniciar sesión.
function tabsKardexPara(tipoEspecialidad) {
  const mapa =
    tipoEspecialidad === "neurodesarrollo" ? TABS_KARDEX_NEURO :
    tipoEspecialidad === "pediatria" ? TABS_KARDEX_PEDIATRIA :
    tipoEspecialidad === "odontologia" ? TABS_KARDEX_ODONTOLOGIA :
    tipoEspecialidad === "estetica" ? TABS_KARDEX_ESTETICA :
    tipoEspecialidad === "oftalmologia" ? TABS_KARDEX_OFTALMOLOGIA :
    tipoEspecialidad === "veterinaria" ? TABS_KARDEX_VETERINARIA :
    tipoEspecialidad === "ginecologia" ? TABS_KARDEX_GINECOLOGIA :
    TABS_KARDEX_MEDICINA_GENERAL;
  const salida = {};
  for (const clave of Object.keys(mapa)) {
    salida[clave] = { icono: mapa[clave].icono, label: t(mapa[clave].claveLabel) };
  }
  return salida;
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
  // Al salir, la pantalla de login vuelve al español: el idioma era de la
  // cuenta que se acaba de cerrar, no de este navegador.
  fijarIdioma("es");
  aplicarTemaSegunEspecialidad();
  if (typeof desactivarEscritorio === "function") desactivarEscritorio();
  if (typeof desconectarTiempoReal === "function") desconectarTiempoReal();
  btnLogout.style.display = "none";
  btnAsistente.style.display = "none";
  if (typeof cerrarAsistente === "function") cerrarAsistente();
  headerSub.textContent = t("marca.subtitulo");
  renderLogin();
}
