// Symphomed — La persona compartida, en pantalla.
//
// Dos cosas viven acá:
//
//   1. El aviso de alergias arriba del Kardex. Va ARRIBA de las pestañas y
//      no adentro de una: una alergia que hay que buscar en una pestaña es
//      una alergia que no protege a nadie. El odontólogo que va a recetar
//      tiene que verla sin haberla buscado.
//
//   2. Reconocer a una persona al dar de alta un paciente. Lo confirma el
//      médico, siempre — ver el comentario de routes/personas.js sobre por
//      qué nada se vincula solo.
//
// Un médico que trabaja solo no ve nada de esto: el servidor le contesta
// que no está en ninguna clínica y todo el bloque queda invisible.

// La persona elegida en el alta, mientras el formulario está abierto.
let personaElegidaAlta = null;

// ═══ POR QUÉ SON DOS CAJAS Y NO UNA ════════════════════════════════════════
//
// Hasta acá esto era un solo bloque arriba del Kardex, y arrastraba consigo
// el formulario de alergias, el de vincular persona y el botón de
// desvincular. El resultado, medido en un celular: entre el nombre del
// paciente y la primera pestaña clínica había cientos de píxeles de cosas
// que el médico no está mirando. Abría la ficha y tenía que scrollear para
// llegar a lo que vino a ver.
//
// Ahora se parte en dos por CRITERIO CLÍNICO, no por acomodar la pantalla:
//
//   ALERTA  — la alergia. Va arriba de las pestañas, siempre, sin que nadie
//             la busque. Es el único dato de acá que puede cambiar una
//             receta, y una alergia que hay que ir a buscar no protege a
//             nadie.
//   ACCIÓN  — editar esas alergias, vincular la persona, desvincularla. Son
//             trámites: importantes, no urgentes, y pasan una vez por
//             paciente en vez de una vez por consulta.
//
// La regla para el que venga a agregar algo acá: si no cambia lo que el
// médico va a hacer en los próximos cinco minutos, va abajo.
function bloquePersonaHtml() {
  return `<div id="personaAlertaBox"></div>`;
}

// Lo administrativo, que vive abajo del contenido clínico (ver pacientes.js).
function bloquePersonaAccionesHtml() {
  return `<div id="personaBox"></div>`;
}

function normalizarAlergiasPantalla(lista) {
  const unicas = new Map();
  for (const valor of Array.isArray(lista) ? lista : []) {
    const alergia = String(valor || "").trim();
    if (alergia) unicas.set(alergia.toLocaleLowerCase(), alergia);
  }
  return [...unicas.values()];
}

// Un solo componente de alerta para fichas locales y personas compartidas.
// Así una corrección de seguridad no queda aplicada en un caso y olvidada
// en el otro.
function pintarAlertaAlergias(lista) {
  const alerta = document.getElementById("personaAlertaBox");
  if (!alerta) return;
  const alergias = normalizarAlergiasPantalla(lista);
  alerta.innerHTML = alergias.length ? `
    <div class="persona-alergias" role="alert">
      <div class="persona-alergias-titulo">⚠️ ${t("persona.alergias")}</div>
      <div class="persona-alergias-lista">${alergias.map(a => `<span>${esc(a)}</span>`).join("")}</div>
    </div>` : "";
}

function campoAlergiasHtml(alergias, ayuda) {
  return `
    <label for="personaAlergias">${t("persona.alergiasCampo")}</label>
    <input id="personaAlergias" type="text" value="${esc(normalizarAlergiasPantalla(alergias).join(", "))}" placeholder="${t("persona.alergiasPlaceholder")}">
    <div class="hint" style="margin:6px 0 0">${t(ayuda)}</div>
    <div id="personaErr"></div>
    <button class="secondary" id="btnGuardarAlergias">${t("persona.guardarAlergias")}</button>`;
}

async function cargarBloquePersona(paciente) {
  const caja = document.getElementById("personaBox");
  if (!caja) return;
  // Se pinta primero la copia local: incluso si falla la red que consulta la
  // persona compartida, una alergia ya conocida no desaparece de la ficha.
  pintarAlertaAlergias(paciente.alergias || []);
  let datos;
  try {
    // Reciente: se repinta en cada pestaña del Kardex (ver apiReciente, estado.js).
    datos = await apiReciente(`/medico/pacientes/${paciente._id}/persona`);
  } catch {
    // Que falle esto no puede romper el Kardex: es información de más, no
    // la ficha. Si no carga, la pantalla sigue siendo la de siempre.
    return;
  }
  if (!caja.isConnected) return;

  if (!datos.persona) return pintarSinPersona(caja, paciente);
  pintarConPersona(caja, paciente, datos.persona, datos.fichasEnLaClinica || 1);
}

function pintarConPersona(caja, paciente, persona, fichas) {
  const alergias = normalizarAlergiasPantalla([
    ...(persona.alergias || []),
    ...(paciente.alergias || []),
  ]);

  // La alerta va a su propia caja, arriba de las pestañas. role="alert" para
  // que un lector de pantalla la anuncie al aparecer en vez de esperar a que
  // alguien navegue hasta ella.
  pintarAlertaAlergias(alergias);

  caja.innerHTML = `
    <div class="card card-secundaria">
      <div class="seccion-titulo" style="margin-top:0">${t("persona.titulo")}</div>
      <div class="hint" style="margin:0 0 10px">
        ${fichas > 1 ? t("persona.enVariosConsultorios", { n: fichas }) : t("persona.soloAca")}
      </div>
      ${campoAlergiasHtml(alergias, "persona.alergiasAyuda")}
      ${persona.alergiasActualizadasEn ? `
        <div class="hint" style="margin:4px 0 0">${t(
          // De quién fueron se dice solo como "vos" o "otro consultorio": el
          // servidor no manda el teléfono del colega a propósito, porque eso
          // sería decir quién más atiende a esta persona.
          persona.alergiasActualizadasPorMi ? "persona.alergiasActualizadasVos" : "persona.alergiasActualizadasOtro",
          { fecha: new Date(persona.alergiasActualizadasEn).toLocaleDateString(localeActual()) }
        )}</div>` : ""}
      <button class="link" id="btnDesvincularPersona" style="width:auto;color:var(--danger)">${t("persona.desvincular")}</button>
    </div>`;

  document.getElementById("btnGuardarAlergias").onclick = async () => {
    const btn = document.getElementById("btnGuardarAlergias");
    const errBox = document.getElementById("personaErr");
    errBox.innerHTML = "";
    btn.disabled = true;
    const lista = document.getElementById("personaAlergias").value
      .split(",").map(x => x.trim()).filter(Boolean);
    try {
      await api(`/medico/personas/${persona._id}/alergias`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alergias: lista }),
      });
      paciente.alergias = lista;
      cargarBloquePersona(paciente);
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("persona.errGuardar"))}</div>`;
    }
  };

  document.getElementById("btnDesvincularPersona").onclick = async () => {
    if (!confirm(t("persona.confirmarDesvincular"))) return;
    await api(`/medico/pacientes/${paciente._id}/persona`, { method: "DELETE" });
    cargarBloquePersona(paciente);
  };
}

// Todavía no está vinculada. Se ofrece buscarla, no se busca sola: que el
// sistema proponga "¿será este?" apenas se abre una ficha invita a decir
// que sí sin mirar.
function pintarSinPersona(caja, paciente) {
  const alergias = normalizarAlergiasPantalla(paciente.alergias || []);
  pintarAlertaAlergias(alergias);

  caja.innerHTML = `
    <div class="card card-secundaria">
      ${campoAlergiasHtml(alergias, "persona.alergiasFichaAyuda")}
      <div class="hint" style="margin:0 0 10px">${t("persona.sinVincular")}</div>
      <div id="personaCandidatos"></div>
      <button class="link" id="btnBuscarPersona" style="width:auto">${t("persona.buscar")}</button>
    </div>`;

  document.getElementById("btnGuardarAlergias").onclick = async () => {
    const btn = document.getElementById("btnGuardarAlergias");
    const errBox = document.getElementById("personaErr");
    const lista = document.getElementById("personaAlergias").value
      .split(",").map(x => x.trim()).filter(Boolean);
    errBox.innerHTML = "";
    btn.disabled = true;
    try {
      await api(`/medico/pacientes/${paciente._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alergias: lista }),
      });
      paciente.alergias = lista;
      pintarSinPersona(caja, paciente);
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("persona.errGuardar"))}</div>`;
    }
  };

  document.getElementById("btnBuscarPersona").onclick = async () => {
    const destino = document.getElementById("personaCandidatos");
    destino.innerHTML = `<div class="hint">${t("persona.buscando")}</div>`;
    let datos;
    try {
      datos = await api(`/medico/personas/buscar?q=${encodeURIComponent(paciente.nombre)}`);
    } catch (e) {
      destino.innerHTML = `<div class="error">${esc(e.error || t("persona.errBuscar"))}</div>`;
      return;
    }
    // Un médico solo: no hay clínica, no hay nada que compartir.
    if (!datos.enClinica) { destino.innerHTML = `<div class="hint">${t("persona.sinClinica")}</div>`; return; }

    destino.innerHTML = `
      ${datos.personas.length === 0
        ? `<div class="hint">${t("persona.sinCandidatos")}</div>`
        : `<div class="hint" style="margin-bottom:6px">${t("persona.candidatos")}</div>
           ${datos.personas.map(p => candidatoHtml(p)).join("")}`}
      <button class="secondary" id="btnCrearPersona" style="margin-top:10px">${t("persona.crearNueva")}</button>`;

    destino.querySelectorAll("[data-persona]").forEach(el => {
      el.onclick = () => vincularPersona(paciente, el.dataset.persona);
    });
    document.getElementById("btnCrearPersona").onclick = () => vincularPersona(paciente, null);
  };
}

// Lo que se muestra de un candidato es lo que sirve para reconocerlo —
// nombre, nacimiento, documento— y nada de lo que le pasa. Ver la búsqueda
// en routes/personas.js.
function candidatoHtml(p) {
  const edad = edadDesde(p.fechaNacimiento);
  const datos = [
    edad != null ? t("pacientes.anos", { n: edad }) : null,
    p.fechaNacimiento ? fechaCorta(p.fechaNacimiento) : null,
    p.documento || null,
    p.telefono || null,
  ].filter(Boolean).join(" · ");
  return `
    <button type="button" class="item" data-persona="${p._id}">
      <span class="top"><span class="nombre">${esc(p.nombre)}</span></span>
      ${datos ? `<span class="paciente-info">${esc(datos)}</span>` : ""}
      ${(p.alergias || []).length ? `<span class="paciente-info">⚠️ ${esc(p.alergias.join(", "))}</span>` : ""}
    </button>`;
}

async function vincularPersona(paciente, personaId) {
  // Confirmar de verdad: unir dos fichas de personas distintas fusiona dos
  // historias clínicas, y no hay botón para deshacerlo del lado de los datos.
  if (personaId && !confirm(t("persona.confirmarVincular"))) return;
  const errBox = document.getElementById("personaErr");
  if (errBox) errBox.innerHTML = "";
  try {
    await api(`/medico/pacientes/${paciente._id}/persona`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(personaId ? { personaId } : {}),
    });
    cargarBloquePersona(paciente);
  } catch (e) {
    if (errBox) errBox.innerHTML = `<div class="error">${esc(e.error || t("persona.errVincular"))}</div>`;
  }
}

// ─── EN EL ALTA DE UN PACIENTE ────────────────────────────────────────────
// Mientras el médico escribe el nombre, se mira si esa persona ya viene a la
// clínica. Es el momento en que sirve: después de crear la ficha, el dato
// duplicado ya existe.
function engancharBuscadorPersonaEnAlta() {
  const campoNombre = document.getElementById("pNombre");
  const caja = document.getElementById("personaAltaBox");
  if (!campoNombre || !caja) return;
  personaElegidaAlta = null;

  let temporizador = null;
  campoNombre.oninput = () => {
    clearTimeout(temporizador);
    personaElegidaAlta = null;
    caja.innerHTML = "";
    const q = campoNombre.value.trim();
    if (q.length < 3) return;
    // Se espera a que termine de escribir: sin esto se dispara una consulta
    // por letra.
    temporizador = setTimeout(async () => {
      let datos;
      try { datos = await api(`/medico/personas/buscar?q=${encodeURIComponent(q)}`); } catch { return; }
      if (!datos.enClinica || datos.personas.length === 0) { caja.innerHTML = ""; return; }
      caja.innerHTML = `
        <div class="hint" style="margin:8px 0 6px">${t("persona.yaViene")}</div>
        ${datos.personas.map(p => candidatoHtml(p)).join("")}`;
      caja.querySelectorAll("[data-persona]").forEach(el => {
        el.onclick = () => {
          personaElegidaAlta = el.dataset.persona;
          caja.innerHTML = `<div class="hint" style="margin:8px 0 0;color:var(--success)">✅ ${t("persona.elegida")}</div>`;
        };
      });
    }, 400);
  };
}

// Se llama después de crear la ficha, con la persona que el médico eligió
// mientras escribía. Si no eligió ninguna, no pasa nada: la ficha queda sin
// vincular y se puede vincular después desde el Kardex.
async function vincularPersonaElegidaEnAlta(pacienteId) {
  if (!personaElegidaAlta) return;
  try {
    await api(`/medico/pacientes/${pacienteId}/persona`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: personaElegidaAlta }),
    });
  } catch { /* la ficha ya está creada; vincular puede esperar al Kardex */ }
  personaElegidaAlta = null;
}
