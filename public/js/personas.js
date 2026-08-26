// Vitalis — La persona compartida, en pantalla.
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

// ─── AVISO DE ALERGIAS (arriba del Kardex) ────────────────────────────────
function bloquePersonaHtml() {
  return `<div id="personaBox"></div>`;
}

async function cargarBloquePersona(paciente) {
  const caja = document.getElementById("personaBox");
  if (!caja) return;
  let datos;
  try {
    datos = await api(`/medico/pacientes/${paciente._id}/persona`);
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
  const alergias = persona.alergias || [];
  caja.innerHTML = `
    ${alergias.length ? `
      <div class="persona-alergias">
        <div class="persona-alergias-titulo">⚠️ ${t("persona.alergias")}</div>
        <div class="persona-alergias-lista">${alergias.map(a => `<span>${esc(a)}</span>`).join("")}</div>
      </div>` : ""}
    <div class="card card-secundaria">
      <div class="seccion-titulo" style="margin-top:0">${t("persona.titulo")}</div>
      <div class="hint" style="margin:0 0 10px">
        ${fichas > 1 ? t("persona.enVariosConsultorios", { n: fichas }) : t("persona.soloAca")}
      </div>
      <label>${t("persona.alergiasCampo")}</label>
      <input id="personaAlergias" type="text" value="${esc(alergias.join(", "))}" placeholder="${t("persona.alergiasPlaceholder")}">
      <div class="hint" style="margin:6px 0 0">${t("persona.alergiasAyuda")}</div>
      ${persona.alergiasActualizadasEn ? `
        <div class="hint" style="margin:4px 0 0">${t("persona.alergiasActualizadas", {
          fecha: new Date(persona.alergiasActualizadasEn).toLocaleDateString(localeActual()),
        })}</div>` : ""}
      <div id="personaErr"></div>
      <button class="secondary" id="btnGuardarAlergias">${t("persona.guardarAlergias")}</button>
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
  caja.innerHTML = `
    <div class="card card-secundaria">
      <div class="hint" style="margin:0 0 10px">${t("persona.sinVincular")}</div>
      <div id="personaCandidatos"></div>
      <div id="personaErr"></div>
      <button class="link" id="btnBuscarPersona" style="width:auto">${t("persona.buscar")}</button>
    </div>`;

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
    p.fechaNacimiento ? new Date(p.fechaNacimiento).toLocaleDateString(localeActual()) : null,
    p.documento || null,
    p.telefono || null,
  ].filter(Boolean).join(" · ");
  return `
    <div class="item" data-persona="${p._id}">
      <div class="top"><div class="nombre">${esc(p.nombre)}</div></div>
      ${datos ? `<div class="paciente-info">${esc(datos)}</div>` : ""}
      ${(p.alergias || []).length ? `<div class="paciente-info">⚠️ ${esc(p.alergias.join(", "))}</div>` : ""}
    </div>`;
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
