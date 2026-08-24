// Vitalis — Dashboard (lista de pacientes) y el Kardex de cada paciente
// (pestañas: Paciente, Consultas, Medicación, Antecedentes, Vacunas).

function pacienteItemHtml(p) {
  const esVet = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  const info = esVet
    ? [p.especie, p.raza].filter(Boolean).join(" · ")
    : (() => {
        // En pediatría "2 años" de un bebé de 26 meses tira justo el dato
        // que importa; se muestra en días/meses hasta que deja de importar.
        const edad = MEDICO_TIPO_ESPECIALIDAD === "pediatria"
          ? edadPediatricaTexto(p.fechaNacimiento)
          : (edadDesde(p.fechaNacimiento) != null ? edadDesde(p.fechaNacimiento) + " años" : "");
        return `${edad}${edad && p.sexo ? " · " : ""}${p.sexo || ""}`;
      })();
  return `
    <div class="item item-paciente" data-id="${p._id}" data-nombre="${esc(p.nombre.toLowerCase())}">
      <div class="avatar avatar-xs">${esc(iniciales(p.nombre))}</div>
      <div>
        <div class="nombre">${esc(p.nombre)}</div>
        <div class="paciente-info">${esc(info)}</div>
      </div>
    </div>`;
}

// ─── DASHBOARD = LISTA DE PACIENTES ─────────────────────────────────────
async function renderDashboard() {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  headerSub.textContent = "Hola, " + (MEDICO_NOMBRE || "");
  btnLogout.style.display = "inline-block";
  btnAsistente.style.display = "inline-flex";
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando tus pacientes...</div>`;
  try {
    // Las tres en paralelo: la bandeja es una consulta más y el panel es lo
    // primero que ve el médico al entrar. En serie, cada una le suma su
    // demora a la pantalla de arranque.
    const [dataPacientes, dataRecordatorios, dataBandeja] = await Promise.all([
      api("/medico/pacientes"),
      api("/medico/recordatorios"),
      // Si la bandeja falla, el panel tiene que abrirse igual.
      api("/medico/dicom/bandeja").catch(() => ({ entrantes: [] })),
    ]);
    // Si mientras esto viajaba el médico ya abrió otra pantalla, este pintado
    // llega tarde y le taparía lo que está haciendo.
    if (!seriePantallaVigente(serie)) return;
    const items = dataPacientes.pacientes || [];
    const pendientes = (dataRecordatorios.recordatorios || []).length;

    // Estudios que llegaron de la caja y todavía no tienen dueño. La fila
    // solo aparece si hay alguno: para un médico sin caja DICOM, esto no
    // existe y no le ocupa pantalla. Y si el técnico pone el código del
    // paciente en el equipo, tampoco aparece nunca — el estudio se archiva
    // solo. Que esté vacía es el caso bueno.
    const sinAsignar = (dataBandeja.entrantes || []).length;

    app.innerHTML = `
      ${sinAsignar ? `
        <div class="card no-imprimir" style="border-color:var(--warning);cursor:pointer" id="avisoBandeja">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <div>
              <div style="font-weight:600">📥 ${sinAsignar} estudio${sinAsignar > 1 ? "s" : ""} sin asignar</div>
              <div class="hint" style="margin:2px 0 0">Llegaron de la caja y falta decir de quién son.</div>
            </div>
            <span style="color:var(--primary);font-weight:600">Ver →</span>
          </div>
        </div>` : ""}
      <div class="tabs" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
        <button class="tab" id="btnNuevoPaciente"><span class="tab-icono">${ICONOS.mas}</span>Nuevo<br>paciente</button>
        <button class="tab" id="btnAgenda"><span class="tab-icono">${ICONOS.calendario}</span>Agenda</button>
        <button class="tab" id="btnRecordatorios"><span class="tab-icono">${ICONOS.campana}${pendientes ? `<b class="tab-globo">${pendientes}</b>` : ""}</span>Recordatorios</button>
        <button class="tab" id="btnVincular"><span class="tab-icono">${ICONOS.mic}</span>Vincular<br>celular</button>
        <button class="tab" id="btnSeguridad"><span class="tab-icono">${ICONOS.escudo}</span>Seguridad</button>
      </div>
      ${items.length === 0 ? `<div class="empty">Todavía no registraste ningún paciente.</div>` : `
        <input id="buscarPaciente" type="text" placeholder="🔍 Buscar paciente..." style="margin:16px 0 12px">
        <div id="listaPacientes">
          ${items.map(p => pacienteItemHtml(p)).join("")}
        </div>
        <div class="empty" id="buscarVacio" style="display:none">Ningún paciente coincide con la búsqueda.</div>
      `}
    `;
    const avisoBandeja = document.getElementById("avisoBandeja");
    if (avisoBandeja) avisoBandeja.onclick = () => renderBandejaDicom();
    document.getElementById("btnNuevoPaciente").onclick = renderNuevoPaciente;
    document.getElementById("btnAgenda").onclick = renderAgenda;
    document.getElementById("btnRecordatorios").onclick = renderRecordatorios;
    document.getElementById("btnVincular").onclick = renderVincular;
    document.getElementById("btnSeguridad").onclick = renderSeguridad;
    document.querySelectorAll(".item[data-id]").forEach(el => {
      el.onclick = () => renderPacienteDetalle(el.dataset.id);
    });
    const buscarInput = document.getElementById("buscarPaciente");
    if (buscarInput) {
      buscarInput.oninput = () => {
        const q = buscarInput.value.trim().toLowerCase();
        let visibles = 0;
        document.querySelectorAll("#listaPacientes .item").forEach(el => {
          const coincide = el.dataset.nombre.includes(q);
          el.style.display = coincide ? "" : "none";
          if (coincide) visibles++;
        });
        document.getElementById("buscarVacio").style.display = visibles === 0 ? "block" : "none";
      };
    }
  } catch (e) {
    if (e.status === 401) return logout();
    if (!seriePantallaVigente(serie)) return;
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando pacientes")}</div>`;
  }
}

// ─── NUEVO PACIENTE ──────────────────────────────────────────────────────
function renderNuevoPaciente() {
  detenerPolling();
  const esVet = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  const esPed = MEDICO_TIPO_ESPECIALIDAD === "pediatria";
  app.innerHTML = `
    <button class="back" id="btnBack">← Volver</button>
    <div class="card">
      <label>${esVet ? "Nombre de la mascota" : "Nombre completo"}</label>
      <input id="pNombre" type="text" placeholder="${esVet ? "Ej: Firulais" : "Ej: Juan Pérez"}">
      ${esVet ? `
      <label>Especie</label>
      <input id="pEspecie" type="text" placeholder="Ej: Perro, Gato...">
      <label>Raza (opcional)</label>
      <input id="pRaza" type="text" placeholder="Ej: Labrador">` : ""}
      <label>Fecha de nacimiento${esPed ? "" : " (opcional)"}</label>
      <input id="pFecha" type="date">
      ${esPed ? `<div class="hint" style="margin:-4px 0 8px">Sin fecha de nacimiento y sexo no se pueden calcular los percentiles de crecimiento.</div>` : ""}
      <label>Sexo${esPed ? "" : " (opcional)"}</label>
      <select id="pSexo">
        <option value="">— Sin especificar —</option>
        ${esVet ? `
        <option value="Hembra">Hembra</option>
        <option value="Macho">Macho</option>` : `
        <option value="Femenino">Femenino</option>
        <option value="Masculino">Masculino</option>
        <option value="Otro">Otro</option>`}
      </select>
      ${esVet ? `
      <label>Nombre del dueño (opcional)</label>
      <input id="pDuenoNombre" type="text" placeholder="Ej: María Pérez">` : ""}
      ${esPed ? `
      <label>Semanas de gestación al nacer (opcional)</label>
      <input id="pSemanasGesta" type="number" min="20" max="44" step="1" inputmode="numeric" placeholder="Ej: 32 — dejalo vacío si nació a término">
      <div class="hint" style="margin:-4px 0 8px">Si nació prematuro, Vitalis usa la edad corregida en las curvas hasta los 2 años.</div>
      <label>Madre, padre o tutor (opcional)</label>
      <input id="pTutorNombre" type="text" placeholder="Ej: María Pérez">
      <label>Parentesco (opcional)</label>
      <input id="pTutorParentesco" type="text" placeholder="Ej: Madre">` : ""}
      <label>Teléfono${esVet ? " del dueño" : esPed ? " del tutor" : ""} (opcional)</label>
      <input id="pTelefono" type="tel" placeholder="591XXXXXXXX">
      <label>Notas (opcional)</label>
      <input id="pNotas" type="text" placeholder="Alergias, observaciones generales...">
      <div id="pErr"></div>
      <button class="primary" id="pBtn">Guardar paciente</button>
    </div>`;
  document.getElementById("btnBack").onclick = renderDashboard;
  document.getElementById("pBtn").onclick = async () => {
    const nombre = document.getElementById("pNombre").value.trim();
    const fechaNacimiento = document.getElementById("pFecha").value || null;
    const sexo = document.getElementById("pSexo").value;
    const telefono = document.getElementById("pTelefono").value.trim();
    const notas = document.getElementById("pNotas").value.trim();
    const especie = esVet ? document.getElementById("pEspecie").value.trim() : "";
    const raza = esVet ? document.getElementById("pRaza").value.trim() : "";
    const duenoNombre = esVet ? document.getElementById("pDuenoNombre").value.trim() : "";
    const tutorNombre = esPed ? document.getElementById("pTutorNombre").value.trim() : "";
    const tutorParentesco = esPed ? document.getElementById("pTutorParentesco").value.trim() : "";
    const semanasGestacionAlNacer = esPed ? (document.getElementById("pSemanasGesta").value.trim() || null) : null;
    const errBox = document.getElementById("pErr");
    errBox.innerHTML = "";
    if (!nombre) { errBox.innerHTML = `<div class="error">${esVet ? "El nombre de la mascota es obligatorio" : "El nombre es obligatorio"}</div>`; return; }
    try {
      const data = await api("/medico/pacientes", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ nombre, fechaNacimiento, sexo, telefono, notas, especie, raza, duenoNombre, tutorNombre, tutorParentesco, semanasGestacionAlNacer }),
      });
      renderPacienteDetalle(data.paciente._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar el paciente")}</div>`;
    }
  };
}

// ─── DETALLE DE PACIENTE (Kardex con pestañas) ──────────────────────────
// Trae los datos UNA vez; cambiar de pestaña es instantáneo (sin red),
// para no estar yendo y viniendo cada vez que querés ver otra cosa.
async function renderPacienteDetalle(pacienteId, tabInicial) {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  try {
    const data = await api("/medico/pacientes/" + pacienteId);
    // Si el médico ya se fue a otra pantalla mientras esto viajaba, este
    // pintado llega tarde y le taparía lo que está haciendo.
    if (!seriePantallaVigente(serie)) return;
    const tabPorDefecto = MEDICO_TIPO_ESPECIALIDAD === "odontologia" ? "odontograma" : MEDICO_TIPO_ESPECIALIDAD === "oftalmologia" ? "ojos" : MEDICO_TIPO_ESPECIALIDAD === "ginecologia" ? "embarazo" : "consultas";
    pintarKardex(data.paciente, data.consultas || [], data.medicamentos || [], data.vacunas || [], data.mediciones || [], data.estudios || [], data.recetas || [], tabInicial || tabPorDefecto);
  } catch (e) {
    if (e.status === 401) return logout();
    if (!seriePantallaVigente(serie)) return;
    app.innerHTML = `<div class="error">${esc(e.error || "Error cargando el paciente")}</div>`;
  }
}

function pintarKardex(p, consultas, medicamentos, vacunas, mediciones, estudios, recetas, tabActiva) {
  detenerPolling();
  const edad = edadDesde(p.fechaNacimiento);
  const estadoTxt = { procesando: "⏳ Transcribiendo", completado: "✅ Listo", error: "⚠️ Error" };

  const consultasCompletas = consultas.filter(c => c.estado === "completado");
  const ultima = consultas[0]; // ya viene ordenado por fecha descendente
  const ultimaConDx = consultasCompletas.find(c => c.notaClinica && (c.notaClinica.diagnostico || c.notaClinica.motivoConsulta));

  let briefHtml = "";
  if (p.briefClinicoEstado === "generando") {
    briefHtml = `<div class="card"><div class="hint">🧠 Generando brief clínico...</div></div>`;
  } else if (p.briefClinicoEstado === "error") {
    briefHtml = `<div class="card"><div class="error">⚠️ No se pudo generar el brief clínico automático.</div></div>`;
  } else if (p.briefClinicoEstado === "completado" && p.briefClinico) {
    const b = p.briefClinico;
    briefHtml = `
      <div class="card brief-card">
        <div class="nota-titulo">🧠 Brief Clínico Inteligente</div>
        ${b.estadoActual ? `<div class="nota-campo"><b>Estado actual:</b> ${esc(b.estadoActual)}</div>` : ""}
        ${b.cambiosDesdeUltimaConsulta ? `<div class="nota-campo"><b>Cambios desde la última consulta:</b> ${esc(b.cambiosDesdeUltimaConsulta)}</div>` : ""}
        ${(b.medicamentosActivos||[]).length ? `<div class="nota-campo"><b>Medicamentos activos:</b> ${esc(b.medicamentosActivos.join(", "))}</div>` : ""}
        ${(b.examenesPendientes||[]).length ? `<div class="nota-campo"><b>Exámenes pendientes:</b> ${esc(b.examenesPendientes.join(", "))}</div>` : ""}
        ${(b.alertas||[]).length ? `<div class="nota-campo brief-alerta"><b>⚠️ Alertas:</b> ${esc(b.alertas.join(", "))}</div>` : ""}
        ${(b.factoresRiesgo||[]).length ? `<div class="nota-campo"><b>Factores de riesgo:</b> ${esc(b.factoresRiesgo.join(", "))}</div>` : ""}
        ${(b.preguntasSugeridas||[]).length ? `<div class="nota-campo"><b>Preguntas sugeridas:</b> ${esc(b.preguntasSugeridas.join(" · "))}</div>` : ""}
        ${(b.diagnosticosDiferenciales||[]).length ? `<div class="nota-campo"><b>Diferenciales a considerar:</b> ${esc(b.diagnosticosDiferenciales.join(", "))}</div>` : ""}
        <div class="hint" style="margin-top:8px">Generado por IA como apoyo — no reemplaza el criterio profesional.</div>
      </div>`;
  } else {
    briefHtml = `<div class="card"><div class="hint">🧠 El brief clínico va a aparecer acá después de la primera consulta con nota clínica generada.</div></div>`;
  }

  const tabPaciente = `
    <div class="card ficha-card">
      <div class="ficha-header">
        <div class="avatar avatar-sm">${esc(iniciales(p.nombre))}</div>
        <div>
          <div class="nombre" style="font-size:16px;font-weight:700">${esc(p.nombre)}</div>
          <div class="paciente-info">${edad != null ? edad + " años" : "Edad no registrada"}${p.sexo ? " · " + esc(p.sexo) : ""}</div>
        </div>
      </div>
      <div class="ficha-datos">
        ${MEDICO_TIPO_ESPECIALIDAD === "veterinaria" ? `
        <div class="dato-row">🐾 ${[p.especie, p.raza].filter(Boolean).map(esc).join(" · ") || "Especie no registrada"}</div>
        <div class="dato-row">🧑 ${p.duenoNombre ? esc(p.duenoNombre) : "Dueño no registrado"}</div>
        <div class="dato-row">📞 ${p.telefono ? esc(p.telefono) : "No registrado"}</div>
        <div class="dato-row" style="border-bottom:none">📝 ${p.notas ? esc(p.notas) : "Sin notas registradas"}</div>` : `
        <div class="dato-row">📞 ${p.telefono ? esc(p.telefono) : "No registrado"}</div>
        <div class="dato-row">🎂 ${p.fechaNacimiento ? new Date(p.fechaNacimiento).toLocaleDateString("es-BO") : "No registrada"}</div>
        <div class="dato-row" style="border-bottom:none">📝 ${p.notas ? esc(p.notas) : "Sin notas registradas"}</div>`}
      </div>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="stat-num">${consultas.length}</div><div class="stat-lbl">Consultas</div></div>
      <div class="stat"><div class="stat-num">${ultima ? new Date(ultima.createdAt).toLocaleDateString("es-BO", {day:"2-digit", month:"short"}) : "—"}</div><div class="stat-lbl">Última visita</div></div>
    </div>

    ${briefHtml}
    ${tabMemoriaHtml(p._id)}

    ${ultimaConDx ? `
    <div class="card card-secundaria">
      <div class="seccion-titulo" style="margin-top:0">Último diagnóstico registrado</div>
      <div class="fecha" style="margin-bottom:6px">${new Date(ultimaConDx.createdAt).toLocaleDateString("es-BO")}</div>
      ${ultimaConDx.notaClinica.motivoConsulta ? `<div class="nota-campo"><b>Motivo:</b> ${esc(ultimaConDx.notaClinica.motivoConsulta)}</div>` : ""}
      ${ultimaConDx.notaClinica.diagnostico ? `<div class="nota-campo"><b>Diagnóstico:</b> ${esc(ultimaConDx.notaClinica.diagnostico)}</div>` : ""}
    </div>` : ""}`;

  const tabConsultas = `
    <button class="secondary" id="btnNuevaConsulta">🎙️ Nueva consulta</button>
    ${consultas.length === 0 ? `<div class="empty">Todavía no hay consultas registradas.</div>` : ""}
    ${consultas.map(c => `
      <div class="item" data-id="${c._id}">
        <div class="top">
          <div class="fecha">${new Date(c.createdAt).toLocaleString("es-BO")}</div>
          <span class="badge badge-${c.estado}">${estadoTxt[c.estado] || c.estado}</span>
        </div>
        ${c.notaClinica && c.notaClinica.motivoConsulta ? `<div class="preview">${esc(c.notaClinica.motivoConsulta)}</div>` : ""}
        ${c.notaClinica && c.notaClinica.diagnostico ? `<div class="preview"><b>Dx:</b> ${esc(c.notaClinica.diagnostico)}</div>` : ""}
      </div>`).join("")}`;

  const medActivos = medicamentos.filter(m => !m.fechaFin);
  const medPasados = medicamentos.filter(m => m.fechaFin);
  function medItemHtml(m) {
    return `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${esc(m.nombre)}</div>
          ${!m.fechaFin ? `<span class="badge badge-completado">Activo</span>` : `<span class="badge" style="background:var(--border);color:var(--text-muted)">Finalizado</span>`}
        </div>
        <div class="paciente-info">${[m.dosis, m.frecuencia].filter(Boolean).map(esc).join(" · ")}</div>
        ${m.notas ? `<div class="paciente-info">📝 ${esc(m.notas)}</div>` : ""}
        <div style="display:flex;gap:8px;margin-top:8px">
          ${!m.fechaFin ? `<button class="link" data-dar-baja="${m._id}" style="margin:0;flex:1">Dar de baja</button>` : ""}
          <button class="link" data-borrar-med="${m._id}" style="margin:0;flex:1;color:var(--danger)">Eliminar</button>
        </div>
      </div>`;
  }
  const tabMedicamentos = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Agregar medicamento</div>
      <input id="medNombre" type="text" placeholder="Nombre (ej: Losartán)">
      <input id="medDosis" type="text" placeholder="Dosis (ej: 50mg)" style="margin-top:8px">
      <input id="medFrecuencia" type="text" placeholder="Frecuencia (ej: 1 vez al día)" style="margin-top:8px">
      <button class="secondary" id="btnAgregarMed">➕ Agregar</button>
    </div>
    ${medActivos.length ? `<div class="seccion-titulo">Activos</div>${medActivos.map(medItemHtml).join("")}` : ""}
    ${medPasados.length ? `<div class="seccion-titulo">Pasados</div>${medPasados.map(medItemHtml).join("")}` : ""}
    ${medicamentos.length === 0 ? `<div class="empty">Todavía no hay medicamentos registrados.</div>` : ""}`;

  const tabAntecedentes = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Antecedentes personales</div>
      ${(p.antecedentesPersonales||[]).map((a,i) => `
        <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center">
          <span>${esc(a)}</span>
          <button class="link" data-borrar-antp="${i}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>`).join("")}
      ${(p.antecedentesPersonales||[]).length === 0 ? `<div class="hint">Sin antecedentes personales cargados.</div>` : ""}
      <input id="antpNuevo" type="text" placeholder="Ej: Hipertensión desde 2019" style="margin-top:10px">
      <button class="secondary" id="btnAgregarAntP">➕ Agregar</button>
    </div>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Antecedentes familiares</div>
      ${(p.antecedentesFamiliares||[]).map((a,i) => `
        <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center">
          <span><b>${esc(a.parentesco)}:</b> ${esc(a.condicion)}</span>
          <button class="link" data-borrar-antf="${i}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>`).join("")}
      ${(p.antecedentesFamiliares||[]).length === 0 ? `<div class="hint">Sin antecedentes familiares cargados.</div>` : ""}
      <input id="antfParentesco" type="text" placeholder="Parentesco (ej: Madre)" style="margin-top:10px">
      <input id="antfCondicion" type="text" placeholder="Condición (ej: Diabetes tipo 2)" style="margin-top:8px">
      <button class="secondary" id="btnAgregarAntF">➕ Agregar</button>
    </div>`;

  const tabVacunas = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Agregar vacuna</div>
      <input id="vacNombre" type="text" placeholder="Nombre (ej: Influenza)">
      <input id="vacDosis" type="text" placeholder="Dosis (ej: 1ra dosis, Refuerzo)" style="margin-top:8px">
      <label>Fecha</label>
      <input id="vacFecha" type="date">
      <button class="secondary" id="btnAgregarVac">➕ Agregar</button>
    </div>
    ${vacunas.length === 0 ? `<div class="empty">Todavía no hay vacunas registradas.</div>` : ""}
    ${vacunas.map(v => `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${esc(v.nombre)}${v.dosis ? " — " + esc(v.dosis) : ""}</div>
          <button class="link" data-borrar-vac="${v._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${new Date(v.fecha).toLocaleDateString("es-BO")}</div>
      </div>`).join("")}`;

  const tabsKardex = tabsKardexPara(MEDICO_TIPO_ESPECIALIDAD);
  const tabs = { paciente: tabPaciente, consultas: tabConsultas, odontograma: `<div id="odontogramaBox"></div>`, ojos: `<div id="examenOcularBox"></div>`, mapaGineco: `<div id="mapaGinecoBox"></div>`, mapaCorporal: `<div id="mapaCorporalBox"></div>`, perfilNeuro: `<div id="perfilNeuroBox"></div>`, objetivos: `<div id="objetivosNeuroBox"></div>`, salud: `<div id="vigilanciaBox"></div>`, instrumentos: `<div id="instrumentosBox"></div>`, informes: `<div id="informesBox"></div>`, plan: `<div id="planBox"></div>`, embarazo: `<div id="embarazoBox"></div>`, medicamentos: tabMedicamentos, antecedentes: tabAntecedentes, vacunas: tabVacunas, evolucion: tabEvolucionHtml(mediciones), crecimiento: tabCrecimientoHtml(p, mediciones), estudios: tabEstudiosHtml(estudios), recetas: tabRecetasHtml(recetas) };

  app.innerHTML = `
    <button class="back" id="btnBack">← Pacientes</button>
    <div class="nombre" style="font-size:18px;font-weight:700;margin-bottom:10px">${esc(p.nombre)}</div>
    <div class="tabs">
      ${Object.entries(tabsKardex).map(([key, t]) => `
        <button class="tab ${tabActiva === key ? "activo" : ""}" data-tab="${key}">
          <span class="tab-icono">${t.icono}</span>${t.label}
        </button>`).join("")}
    </div>
    <div id="tabContent">${tabs[tabActiva] || tabConsultas}</div>
  `;

  document.getElementById("btnBack").onclick = renderDashboard;
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => pintarKardex(p, consultas, medicamentos, vacunas, mediciones, estudios, recetas, btn.dataset.tab);
  });

  if (tabActiva === "odontograma") {
    renderTabOdontograma(p._id);
  }

  if (tabActiva === "ojos") {
    renderTabExamenOcular(p._id);
  }

  if (tabActiva === "mapaGineco") {
    renderTabMapaGineco(p._id);
  }

  if (tabActiva === "mapaCorporal") {
    renderTabMapaCorporal(p._id);
  }

  if (tabActiva === "plan") {
    renderTabPlanTratamiento(p._id);
  }

  if (tabActiva === "embarazo") {
    renderTabEmbarazo(p._id);
  }

  if (tabActiva === "crecimiento") {
    wireTabCrecimiento(p, mediciones);
  }

  if (tabActiva === "perfilNeuro") {
    renderTabPerfilNeuro(p._id);
  }

  if (tabActiva === "objetivos") {
    renderTabObjetivosNeuro(p._id);
  }

  if (tabActiva === "salud") {
    renderTabVigilancia(p._id);
  }

  if (tabActiva === "instrumentos") {
    renderTabInstrumentos(p._id);
  }

  if (tabActiva === "informes") {
    renderTabInformes(p._id);
  }

  if (tabActiva === "consultas") {
    document.getElementById("btnNuevaConsulta").onclick = () => renderNuevaConsulta(p._id, p.nombre);
    document.querySelectorAll(".item").forEach(el => {
      el.onclick = () => renderDetalle(el.dataset.id);
    });
  }

  if (tabActiva === "medicamentos") {
    document.getElementById("btnAgregarMed").onclick = async () => {
      const nombre = document.getElementById("medNombre").value.trim();
      if (!nombre) return;
      try {
        await api("/medico/pacientes/" + p._id + "/medicamentos", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({
            nombre,
            dosis: document.getElementById("medDosis").value.trim(),
            frecuencia: document.getElementById("medFrecuencia").value.trim(),
          }),
        });
        renderPacienteDetalle(p._id, "medicamentos");
      } catch (e) { /* se queda en la pantalla, el médico puede reintentar */ }
    };
    document.querySelectorAll("[data-dar-baja]").forEach(btn => {
      btn.onclick = async () => {
        await api("/medico/medicamentos/" + btn.dataset.darBaja, {
          method: "PATCH", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ fechaFin: new Date().toISOString() }),
        });
        renderPacienteDetalle(p._id, "medicamentos");
      };
    });
    document.querySelectorAll("[data-borrar-med]").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("¿Eliminar este medicamento?")) return;
        await api("/medico/medicamentos/" + btn.dataset.borrarMed, { method: "DELETE" });
        renderPacienteDetalle(p._id, "medicamentos");
      };
    });
  }

  if (tabActiva === "antecedentes") {
    // Cada botón de acá arma su "nuevos" a partir del mismo array p.* que
    // quedó fijo desde que se pintó esta pestaña — si se dispara un segundo
    // click (agregar u otro borrar) antes de que el primero termine y
    // vuelva a pintar, ambos parten del mismo array viejo, y el que guarda
    // último pisa al otro (una baja "vuelve" sin que el médico se entere).
    // Se bloquean TODOS los botones de antecedentes apenas se dispara
    // cualquiera de ellos — se destraban solos al repintar la pestaña.
    const botonesAntecedentes = () => document.querySelectorAll(
      "#btnAgregarAntP, [data-borrar-antp], #btnAgregarAntF, [data-borrar-antf]"
    );
    function bloquearBotonesAntecedentes() {
      botonesAntecedentes().forEach(b => b.disabled = true);
    }

    document.getElementById("btnAgregarAntP").onclick = async () => {
      const texto = document.getElementById("antpNuevo").value.trim();
      if (!texto) return;
      bloquearBotonesAntecedentes();
      const nuevos = [...(p.antecedentesPersonales||[]), texto];
      await api("/medico/pacientes/" + p._id, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ antecedentesPersonales: nuevos }) });
      renderPacienteDetalle(p._id, "antecedentes");
    };
    document.querySelectorAll("[data-borrar-antp]").forEach(btn => {
      btn.onclick = async () => {
        bloquearBotonesAntecedentes();
        const idx = Number(btn.dataset.borrarAntp);
        const nuevos = (p.antecedentesPersonales||[]).filter((_,i) => i !== idx);
        await api("/medico/pacientes/" + p._id, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ antecedentesPersonales: nuevos }) });
        renderPacienteDetalle(p._id, "antecedentes");
      };
    });
    document.getElementById("btnAgregarAntF").onclick = async () => {
      const parentesco = document.getElementById("antfParentesco").value.trim();
      const condicion = document.getElementById("antfCondicion").value.trim();
      if (!parentesco && !condicion) return;
      bloquearBotonesAntecedentes();
      const nuevos = [...(p.antecedentesFamiliares||[]), { parentesco, condicion }];
      await api("/medico/pacientes/" + p._id, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ antecedentesFamiliares: nuevos }) });
      renderPacienteDetalle(p._id, "antecedentes");
    };
    document.querySelectorAll("[data-borrar-antf]").forEach(btn => {
      btn.onclick = async () => {
        bloquearBotonesAntecedentes();
        const idx = Number(btn.dataset.borrarAntf);
        const nuevos = (p.antecedentesFamiliares||[]).filter((_,i) => i !== idx);
        await api("/medico/pacientes/" + p._id, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ antecedentesFamiliares: nuevos }) });
        renderPacienteDetalle(p._id, "antecedentes");
      };
    });
  }

  if (tabActiva === "vacunas") {
    document.getElementById("btnAgregarVac").onclick = async () => {
      const nombre = document.getElementById("vacNombre").value.trim();
      const fecha = document.getElementById("vacFecha").value;
      if (!nombre || !fecha) return;
      try {
        await api("/medico/pacientes/" + p._id + "/vacunas", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ nombre, dosis: document.getElementById("vacDosis").value.trim(), fecha }),
        });
        renderPacienteDetalle(p._id, "vacunas");
      } catch (e) { /* se queda en la pantalla, el médico puede reintentar */ }
    };
    document.querySelectorAll("[data-borrar-vac]").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("¿Eliminar esta vacuna?")) return;
        await api("/medico/vacunas/" + btn.dataset.borrarVac, { method: "DELETE" });
        renderPacienteDetalle(p._id, "vacunas");
      };
    });
  }

  if (tabActiva === "paciente") {
    wireTabMemoria(p);
  }

  if (tabActiva === "evolucion") {
    wireTabEvolucion(p, mediciones);
  }

  if (tabActiva === "estudios") {
    wireTabEstudios(p, estudios);
  }

  if (tabActiva === "recetas") {
    wireTabRecetas(p, recetas);
  }

  if (tabActiva === "paciente" && p.briefClinicoEstado === "generando") {
    pollTimeout = setTimeout(async () => {
      try {
        const data = await api("/medico/pacientes/" + p._id);
        pintarKardex(data.paciente, data.consultas || [], data.medicamentos || [], data.vacunas || [], data.mediciones || [], data.estudios || [], data.recetas || [], "paciente");
      } catch (e) {
        if (e.status === 401) return logout();
      }
    }, 6000);
  }
}
