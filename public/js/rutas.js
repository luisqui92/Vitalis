// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Rutas: que la barra de direcciones diga dónde está uno
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══ QUÉ SE ROMPÍA ═════════════════════════════════════════════════════════
//
// La app era una sola dirección, /app, para todas las pantallas. Eso rompía
// tres cosas que la gente hace sin pensar:
//
//   · Recargar. Un médico con la ficha abierta apretaba F5 —porque algo se
//     veía raro, porque se cortó el internet— y volvía a la lista de
//     pacientes. Tenía que buscarlo de nuevo.
//   · El botón "atrás". En un celular es el botón físico que más se usa.
//     Acá se salía de Symphomed directamente.
//   · Compartir. No había forma de mandarle a un colega "mirá esta ficha".
//
// ═══ CÓMO FUNCIONA ═════════════════════════════════════════════════════════
//
// No se reescribió ninguna pantalla. Se ENVUELVEN las funciones que ya
// existen —el mismo truco que usa escritorio.js— para que además de pintar,
// anoten en la barra de direcciones dónde quedó el médico. Y al revés:
// cuando el navegador cambia la dirección (atrás, adelante, recargar), se
// llama a la función que corresponde.
//
// Ninguna pantalla sabe que esto existe, igual que ninguna sabe que existe
// el escritorio.

// ─── EL MAPA ──────────────────────────────────────────────────────────────
//
// Solo las pantallas a las que tiene sentido volver. Un formulario a medio
// llenar (nueva consulta, nuevo paciente) NO va acá: restaurarlo de una
// recarga dibujaría el formulario vacío como si fuera el que se estaba
// llenando, que es peor que devolver al panel.
const RUTAS = [
  { ruta: "inicio",        fn: "renderInicioEscritorio" },
  { ruta: "agenda",        fn: "renderAgenda" },
  { ruta: "voz",           fn: "renderVozEscritorio" },
  { ruta: "indicaciones",  fn: "renderIndicacionesEscritorio" },
  { ruta: "estudios",      fn: "renderEstudiosEscritorio" },
  { ruta: "reportes",      fn: "renderReportesEscritorio" },
  { ruta: "finanzas",      fn: "renderFinanzasEscritorio" },
  { ruta: "recordatorios", fn: "renderRecordatorios" },
  { ruta: "configuracion", fn: "renderSeguridad" },
  { ruta: "clinica",       fn: "renderClinica" },
  { ruta: "pagos",         fn: "renderPagos" },
  { ruta: "vincular",      fn: "renderVincular" },
  { ruta: "equipos",       fn: "renderEquiposRayos" },
  { ruta: "ganaderia",     fn: "renderGanaderia" },
  { ruta: "estudiar",      fn: "renderEstudiar" },
  { ruta: "paciente-virtual", fn: "renderPacienteVirtual" },
  { ruta: "simulacros",    fn: "renderSimulacros" },
];

const BASE = "/app";

// Marca de que estamos restaurando desde la barra de direcciones. Sin esto,
// la función envuelta volvería a escribir la dirección que acaba de leer y
// se apilarían entradas fantasma en el historial.
let restaurando = false;

// ─── ESCRIBIR LA DIRECCIÓN ────────────────────────────────────────────────
//
// push agrega una entrada al historial (el "atrás" vuelve acá) y replace
// pisa la actual.
//
// LAS PESTAÑAS DEL KARDEX USAN replace, A PROPÓSITO. Un médico que mira seis
// pestañas de un paciente y aprieta "atrás" quiere volver a la LISTA, no
// caminar hacia atrás por las seis pestañas de a una. Pero la dirección sí
// tiene que quedar actualizada, para que recargar lo devuelva a la pestaña
// que estaba mirando.
function irA(camino, { reemplazar = false } = {}) {
  if (restaurando) return;
  const destino = BASE + (camino ? "/" + camino : "");
  if (location.pathname === destino) return;
  try {
    if (reemplazar) history.replaceState({ camino }, "", destino);
    else history.pushState({ camino }, "", destino);
  } catch {
    // Si el navegador no deja (algún modo restringido), la app sigue
    // andando igual: lo único que se pierde es la dirección.
  }
}

// ─── LEER LA DIRECCIÓN Y ABRIR LO QUE DIGA ────────────────────────────────
//
// Devuelve true si supo qué hacer. Si devuelve false, quien llama decide —
// normalmente, ir a la pantalla de siempre.
function abrirDesdeLaDireccion() {
  if (!location.pathname.startsWith(BASE)) return false;
  const partes = location.pathname.slice(BASE.length).split("/").filter(Boolean);
  if (!partes.length) return false;

  restaurando = true;
  try {
    // /app/paciente/<id>[/<pestaña>]
    if (partes[0] === "paciente" && partes[1]) {
      // Se valida la forma del id antes de pedirlo. Un id inventado en la
      // barra de direcciones no puede llegar a mostrar nada de otro médico
      // —el servidor filtra por dueño— pero sí ahorra un pedido y un error
      // feo en pantalla.
      if (!/^[a-f0-9]{24}$/i.test(partes[1])) return false;
      if (typeof renderPacienteDetalle !== "function") return false;
      renderPacienteDetalle(partes[1], partes[2] || undefined);
      return true;
    }

    // /app/consulta/<id>
    if (partes[0] === "consulta" && /^[a-f0-9]{24}$/i.test(partes[1] || "")) {
      if (typeof renderDetalle !== "function") return false;
      renderDetalle(partes[1]);
      return true;
    }

    if (partes[0] === "pacientes") {
      if (typeof renderDashboard !== "function") return false;
      renderDashboard();
      return true;
    }

    const encontrada = RUTAS.find(r => r.ruta === partes[0]);
    if (encontrada && typeof window[encontrada.fn] === "function") {
      window[encontrada.fn]();
      return true;
    }
    return false;
  } finally {
    // En el mismo turno: las pantallas son asíncronas, pero lo que hay que
    // evitar es que la llamada SINCRÓNICA de arriba vuelva a escribir la
    // dirección. Lo que pase después ya es navegación de verdad.
    restaurando = false;
  }
}

// ─── ENVOLVER LAS PANTALLAS ───────────────────────────────────────────────
//
// Mismo patrón que envolverParaEscritorio(): se reemplaza la función global
// por una que hace lo suyo y además anota la dirección.
function enrutar(nombreFn, caminoDe, opciones) {
  const original = window[nombreFn];
  if (typeof original !== "function") return;
  window[nombreFn] = function (...args) {
    // Salir de una grabación en curso (o grabada y sin subir) pregunta
    // antes: ver confirmarSalidaDeGrabacion en audio.js.
    if (typeof confirmarSalidaDeGrabacion === "function" && !confirmarSalidaDeGrabacion()) return;
    irA(caminoDe(...args), opciones);
    return original.apply(this, args);
  };
}

enrutar("renderDashboard", () => "pacientes");
enrutar("renderPacienteDetalle", (id, tab) => `paciente/${id}${tab ? "/" + tab : ""}`);
enrutar("renderDetalle", (id) => `consulta/${id}`);
for (const r of RUTAS) enrutar(r.fn, () => r.ruta);

// El cambio de pestaña adentro del Kardex: pisa la dirección en vez de
// apilarla (ver el comentario de irA).
//
// pintarKardex recibe el paciente entero como primer argumento, así que de
// ahí sale el id sin tener que guardarlo en ninguna variable suelta.
if (typeof pintarKardex === "function") {
  const original = pintarKardex;
  pintarKardex = function (p, ...resto) {
    const tab = resto[resto.length - 1];
    if (p && p._id) irA(`paciente/${p._id}${tab ? "/" + tab : ""}`, { reemplazar: true });
    return original.call(this, p, ...resto);
  };
}

// ─── ATRÁS Y ADELANTE ─────────────────────────────────────────────────────
window.addEventListener("popstate", () => {
  // Sin sesión no hay a dónde volver: la pantalla es el login y punto.
  if (typeof TOKEN === "undefined" || !TOKEN) return;
  // El «atrás» del celular con una grabación en curso: se pregunta, y si se
  // arrepiente se queda donde estaba (y la dirección vuelve a la de antes).
  if (typeof hayGrabacionEnCurso === "function" && hayGrabacionEnCurso()) {
    const volverA = direccionDeLaGrabacion();
    if (!confirmarSalidaDeGrabacion()) {
      try { history.pushState(null, "", volverA); } catch { /* sin historial */ }
      return;
    }
  }
  if (!abrirDesdeLaDireccion() && typeof volverAlPanel === "function") {
    restaurando = true;
    try { volverAlPanel(); } finally { restaurando = false; }
  }
});

// ─── AL SALIR, LIMPIAR LA DIRECCIÓN ───────────────────────────────────────
//
// Cerrar sesión con /app/paciente/<id> puesto deja el identificador de un
// paciente en la barra de direcciones y en el historial del navegador,
// delante de quien se siente después en esa computadora. El id solo no
// muestra nada sin sesión, pero no tiene por qué quedar ahí.
if (typeof logout === "function") {
  const salir = logout;
  logout = function (...args) {
    if (typeof confirmarSalidaDeGrabacion === "function" && !confirmarSalidaDeGrabacion()) return;
    try { history.replaceState(null, "", BASE); } catch {}
    return salir.apply(this, args);
  };
}
