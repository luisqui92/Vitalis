// Symphomed — Agenda: citas del médico (manuales + las que llegan solas por
// WhatsApp), y configuración del horario de atención / calendario de Google.

const ORIGEN_ICONO = { whatsapp: "💬", whatsapp_web: "💬", manual: "🖊️", voz: "📞" };
// Los días salen del diccionario por índice de getDay() (0 = domingo):
// en portugués cambian todos menos "Dom" y "Sáb".
function diaCorto(indice) { return t("dia.corto." + indice); }

async function renderAgenda() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("agenda.cargando")}</div>`;
  try {
    const [dataCitas, dataPacientes, dataWA] = await Promise.all([
      api("/medico/citas"),
      api("/medico/pacientes"),
      api("/medico/whatsapp/estado"),
    ]);
    pintarAgenda(dataCitas.citas || [], dataPacientes.pacientes || [], dataWA);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("agenda.error"))}</div>`;
  }
}

function whatsappCardHtml(wa) {
  if (!wa || !wa.configurado) {
    return `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">💬 ${t("agenda.wa.titulo")}</div>
        <div class="hint">${t("agenda.wa.sinConfigurar")}</div>
      </div>`;
  }
  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">💬 ${t("agenda.wa.titulo")}</div>
      <div class="hint" style="color:var(--success)">✅ ${t("agenda.wa.conectado")}</div>
    </div>`;
}

let diaAgendaElegido = null; // "YYYY-MM-DD" — se mantiene al refrescar (guardar/cancelar cita)

function fechaStrLocal(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function pintarAgenda(citas, pacientes, wa) {
  const pendientes = citas.filter(c => c.estado === "confirmada");

  // Los próximos 14 días (mismo rango que ya trae /medico/citas por
  // defecto), como chips — los que tienen citas se marcan con un puntito,
  // así se ve de un vistazo qué días están ocupados sin tener que entrar
  // uno por uno.
  const porDia = {};
  pendientes.forEach(c => {
    const f = fechaStrLocal(c.fecha);
    (porDia[f] = porDia[f] || []).push(c);
  });
  const dias = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    dias.push(fechaStrLocal(d));
  }
  if (diaAgendaElegido == null || !dias.includes(diaAgendaElegido)) {
    diaAgendaElegido = dias.find(f => porDia[f]?.length) || dias[0];
  }
  const citasDelDia = (porDia[diaAgendaElegido] || []).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  app.innerHTML = `
    <button class="back" id="btnBack">${t("agenda.volver")}</button>
    ${whatsappCardHtml(wa)}
    <button class="secondary" id="btnNuevaCita">➕ ${t("agenda.nuevaCita")}</button>
    <button class="link" id="btnConfigHorario">⚙️ ${t("agenda.configurarHorario")}</button>

    <div id="citaFormBox" style="display:none;margin-top:12px" class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("agenda.nuevaCita")}</div>
      <label>${t("agenda.form.pacienteRegistrado")}</label>
      <select id="citaPacienteId">
        <option value="">${t("agenda.form.pacienteSinRegistrar")}</option>
        ${pacientes.map(p => `<option value="${p._id}">${esc(p.nombre)}</option>`).join("")}
      </select>
      <label>${t("agenda.form.nombreLibre")}</label>
      <input id="citaNombre" type="text" placeholder="${t("agenda.form.nombrePlaceholder")}">
      <label>${t("agenda.form.telefono")}</label>
      <input id="citaTelefono" type="tel" placeholder="${t("agenda.form.telefonoPlaceholder")}">
      <label>${t("agenda.form.fechaHora")}</label>
      <input id="citaFecha" type="datetime-local">
      <label>${t("agenda.form.motivo")}</label>
      <input id="citaMotivo" type="text" placeholder="${t("agenda.form.motivoPlaceholder")}">
      <div id="citaErr"></div>
      <button class="secondary" id="btnGuardarCita">${t("agenda.form.guardar")}</button>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("agenda.calendario")}</div>
      <div class="reserva-dias">
        ${dias.map(f => {
          const fd = new Date(f + "T00:00:00Z");
          const activo = f === diaAgendaElegido;
          const cant = porDia[f]?.length || 0;
          return `
            <button class="reserva-dia-chip ${activo ? "activo" : ""}" data-dia="${f}">
              <span class="reserva-dia-semana">${diaCorto(fd.getUTCDay())}</span>
              <span class="reserva-dia-numero">${fd.getUTCDate()}</span>
              ${cant ? `<span class="reserva-dia-badge">${cant}</span>` : `<span class="reserva-dia-mes">&nbsp;</span>`}
            </button>`;
        }).join("")}
      </div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${new Date(diaAgendaElegido + "T00:00:00Z").toLocaleDateString(localeActual(), { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</div>
      ${citasDelDia.length === 0 ? `<div class="empty">${t("agenda.sinCitas")}</div>` : citasDelDia.map(c => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre">${ORIGEN_ICONO[c.origen] || ""} ${esc(c.pacienteNombre)}</div>
            <button class="link" data-cancelar-cita="${c._id}" style="margin:0;width:auto;color:var(--danger)">${t("agenda.cancelar")}</button>
          </div>
          <div class="fecha">${new Date(c.fecha).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", timeZone: "America/La_Paz" })}</div>
          ${c.motivo ? `<div class="paciente-info">${esc(c.motivo)}</div>` : ""}
          ${!c.pacienteId ? `
            <button class="link" data-abrir-crear-paciente="${c._id}" style="margin:6px 0 0">➕ ${t("agenda.ficha.crear")}</button>
            <div id="crearPacienteBox-${c._id}" style="display:none;margin-top:8px">
              <div class="hint" style="margin-bottom:6px">${t("agenda.ficha.aviso")}</div>
              <label>${t("agenda.ficha.nombre")}</label>
              <input class="cp-nombre" data-cp="${c._id}" type="text" value="${esc(c.pacienteNombre || "")}">
              <label>${t("agenda.ficha.telefono")}</label>
              <input class="cp-telefono" data-cp="${c._id}" type="tel" value="${esc(c.pacienteTelefono || "")}">
              <div class="cp-err" data-cp-err="${c._id}"></div>
              <button class="secondary" data-confirmar-crear-paciente="${c._id}">${t("agenda.ficha.boton")}</button>
            </div>` : ""}
        </div>`).join("")}
    </div>
  `;

  document.getElementById("btnBack").onclick = renderDashboard;
  document.getElementById("btnConfigHorario").onclick = renderConfigHorario;
  document.getElementById("btnNuevaCita").onclick = () => {
    const box = document.getElementById("citaFormBox");
    const abrir = box.style.display === "none";
    box.style.display = abrir ? "block" : "none";
    const campoFecha = document.getElementById("citaFecha");
    if (abrir && !campoFecha.value && diaAgendaElegido) campoFecha.value = `${diaAgendaElegido}T09:00`;
  };
  document.querySelectorAll(".reserva-dia-chip").forEach(btn => {
    btn.onclick = () => { diaAgendaElegido = btn.dataset.dia; pintarAgenda(citas, pacientes, wa); };
  });

  document.getElementById("btnGuardarCita").onclick = async () => {
    const errBox = document.getElementById("citaErr");
    errBox.innerHTML = "";
    const pacienteId = document.getElementById("citaPacienteId").value;
    const nombreManual = document.getElementById("citaNombre").value.trim();
    const fecha = document.getElementById("citaFecha").value;
    if (!fecha || (!pacienteId && !nombreManual)) {
      errBox.innerHTML = `<div class="error">${t("agenda.form.errFaltanDatos")}</div>`;
      return;
    }
    try {
      const data = await api("/medico/citas", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          pacienteId: pacienteId || undefined,
          pacienteNombre: nombreManual,
          pacienteTelefono: document.getElementById("citaTelefono").value.trim(),
          fecha,
          motivo: document.getElementById("citaMotivo").value.trim(),
        }),
      });
      if (data?.avisoCalendario) alert(data.avisoCalendario);
      renderAgenda();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("agenda.form.errGuardar"))}</div>`;
    }
  };

  document.querySelectorAll("[data-cancelar-cita]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("agenda.confirmarCancelar"))) return;
      const data = await api("/medico/citas/" + btn.dataset.cancelarCita, {
        method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ estado: "cancelada" }),
      });
      if (data?.avisoCalendario) alert(data.avisoCalendario);
      renderAgenda();
    };
  });

  document.querySelectorAll("[data-abrir-crear-paciente]").forEach(btn => {
    btn.onclick = () => {
      const box = document.getElementById("crearPacienteBox-" + btn.dataset.abrirCrearPaciente);
      box.style.display = box.style.display === "none" ? "block" : "none";
    };
  });
  document.querySelectorAll("[data-confirmar-crear-paciente]").forEach(btn => {
    btn.onclick = async () => {
      const citaId = btn.dataset.confirmarCrearPaciente;
      const errBox = document.querySelector(`[data-cp-err="${citaId}"]`);
      errBox.innerHTML = "";
      const nombre = document.querySelector(`.cp-nombre[data-cp="${citaId}"]`).value.trim();
      const telefono = document.querySelector(`.cp-telefono[data-cp="${citaId}"]`).value.trim();
      if (!nombre) { errBox.innerHTML = `<div class="error">${t("agenda.ficha.errFaltaNombre")}</div>`; return; }
      btn.disabled = true;
      btn.textContent = t("agenda.ficha.creando");
      try {
        const data = await api(`/medico/citas/${citaId}/crear-paciente`, {
          method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ nombre, telefono }),
        });
        renderPacienteDetalle(data.paciente._id, "consultas");
      } catch (e) {
        errBox.innerHTML = `<div class="error">${esc(e.error || t("agenda.ficha.errCrear"))}</div>`;
        btn.disabled = false;
        btn.textContent = t("agenda.ficha.boton");
      }
    };
  });

}

async function renderConfigHorario() {
  detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("horario.cargando")}</div>`;
  try {
    const data = await api("/medico/horario");
    pintarConfigHorario(data.horario);
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("horario.error"))}</div>`;
  }
}

function pintarConfigHorario(horario) {
  const dias = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo
  const porDia = {};
  (horario.horarioAtencion || []).forEach(h => { porDia[h.diaSemana] = h; });

  app.innerHTML = `
    <button class="back" id="btnBack">${t("horario.volver")}</button>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("horario.titulo")}</div>
      <div class="hint" style="margin-bottom:10px">${t("horario.ayuda")}</div>
      ${dias.map(d => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <label style="margin:0;display:flex;align-items:center;gap:6px;min-width:70px">
            <input type="checkbox" class="diaActivo" data-dia="${d}" ${porDia[d] ? "checked" : ""} style="width:auto">
            ${diaCorto(d)}
          </label>
          <input type="time" class="horaInicio" data-dia="${d}" value="${porDia[d]?.horaInicio || "08:00"}" style="flex:1">
          <input type="time" class="horaFin" data-dia="${d}" value="${porDia[d]?.horaFin || "17:00"}" style="flex:1">
        </div>`).join("")}

      <label>${t("horario.duracion")}</label>
      <input id="cfgDuracion" type="number" min="10" step="5" value="${horario.duracionConsultaMinutos || 30}">

      <label>${t("horario.googleCalendar")}</label>
      <input id="cfgCalendarId" type="text" placeholder="${t("horario.googleCalendarPlaceholder")}" value="${esc(horario.googleCalendarId || "")}">
      <div class="hint">${t("horario.googleCalendarAyuda")}</div>

      <label>${t("horario.infoConsultorio")}</label>
      <textarea id="cfgInfoConsultorio" rows="6" placeholder="${t("horario.infoConsultorioPlaceholder")}">${esc(horario.infoConsultorio || "")}</textarea>
      <div class="hint">${t("horario.infoConsultorioAyuda")}</div>

      <div id="cfgErr"></div>
      <button class="secondary" id="btnGuardarHorario">${t("horario.guardar")}</button>
    </div>`;

  document.getElementById("btnBack").onclick = renderAgenda;
  document.getElementById("btnGuardarHorario").onclick = async () => {
    const errBox = document.getElementById("cfgErr");
    errBox.innerHTML = "";
    const horarioAtencion = [];
    document.querySelectorAll(".diaActivo:checked").forEach(chk => {
      const dia = chk.dataset.dia;
      const horaInicio = document.querySelector(`.horaInicio[data-dia="${dia}"]`).value;
      const horaFin = document.querySelector(`.horaFin[data-dia="${dia}"]`).value;
      if (horaInicio && horaFin) horarioAtencion.push({ diaSemana: Number(dia), horaInicio, horaFin });
    });
    try {
      await api("/medico/horario", {
        method: "PATCH", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          horarioAtencion,
          duracionConsultaMinutos: document.getElementById("cfgDuracion").value,
          googleCalendarId: document.getElementById("cfgCalendarId").value.trim(),
          infoConsultorio: document.getElementById("cfgInfoConsultorio").value.trim(),
        }),
      });
      renderAgenda();
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("horario.errGuardar"))}</div>`;
    }
  };
}
