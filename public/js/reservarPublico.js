// Symphomed — Página pública de reserva (sin login). El link viene del
// WhatsApp con un token que ya identifica al paciente, así que acá no hay
// que pedir teléfono ni contraseña: solo elegir día, hora, nombre y motivo.
const app = document.getElementById("app");
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function token() { return new URLSearchParams(location.search).get("token") || ""; }

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...(opts.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

function formatearDiaCorto(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  return { diaSemana: DIAS_SEMANA[d.getDay()], numero: d.getDate(), mes: MESES[d.getMonth()] };
}
function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false });
}

let ESTADO = { medicoNombre: "", dias: [], diaElegido: null, slotElegido: null };

async function iniciar() {
  if (!token()) {
    app.innerHTML = `<div class="error">Este link no es válido. Pedí uno nuevo por WhatsApp.</div>`;
    return;
  }
  try {
    const data = await api(`/reserva-publica/disponibilidad?token=${encodeURIComponent(token())}`);
    ESTADO.medicoNombre = data.medicoNombre;
    ESTADO.dias = data.dias || [];
    pintar();
  } catch (e) {
    app.innerHTML = `<div class="error">${esc(e.error || "Este link venció o no es válido. Pedí uno nuevo por WhatsApp.")}</div>`;
  }
}

function pintar() {
  if (ESTADO.dias.length === 0) {
    app.innerHTML = `<div class="card"><div class="empty">Por ahora no hay horarios disponibles cargados. Comunicate directo con el consultorio.</div></div>`;
    return;
  }

  app.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">👋 Dr(a). ${esc(ESTADO.medicoNombre)}</div>
      <button class="secondary" id="btnLlamarAhora">📞 Hablar con el asistente</button>
      <div class="hint">Elegí el día:</div>
      <div class="reserva-dias">
        ${ESTADO.dias.map((d, i) => {
          const f = formatearDiaCorto(d.fecha);
          const activo = ESTADO.diaElegido === i;
          return `
            <button class="reserva-dia-chip ${activo ? "activo" : ""}" data-idx="${i}">
              <span class="reserva-dia-semana">${f.diaSemana.slice(0, 3)}</span>
              <span class="reserva-dia-numero">${f.numero}</span>
              <span class="reserva-dia-mes">${f.mes}</span>
            </button>`;
        }).join("")}
      </div>
    </div>
    <div id="horasBox"></div>
    <div id="formBox"></div>
  `;

  document.querySelectorAll(".reserva-dia-chip").forEach(btn => {
    btn.onclick = () => {
      ESTADO.diaElegido = Number(btn.dataset.idx);
      ESTADO.slotElegido = null;
      pintar();
      pintarHoras();
    };
  });

  if (ESTADO.diaElegido != null) pintarHoras();
}

function pintarHoras() {
  const box = document.getElementById("horasBox");
  if (!box) return;
  const dia = ESTADO.dias[ESTADO.diaElegido];
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Horarios disponibles</div>
      <div class="reserva-horas">
        ${dia.slots.map((s, i) => `
          <button class="reserva-hora-chip ${ESTADO.slotElegido === i ? "activo" : ""}" data-idx="${i}">${formatearHora(s)}</button>
        `).join("")}
      </div>
    </div>`;
  document.querySelectorAll(".reserva-hora-chip").forEach(btn => {
    btn.onclick = () => {
      ESTADO.slotElegido = Number(btn.dataset.idx);
      pintarHoras();
      pintarForm();
    };
  });
  if (ESTADO.slotElegido != null) pintarForm();
}

function pintarForm() {
  const box = document.getElementById("formBox");
  if (!box) return;
  const dia = ESTADO.dias[ESTADO.diaElegido];
  const slot = dia.slots[ESTADO.slotElegido];
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Tus datos</div>
      <div class="hint" style="margin-bottom:10px">${DIAS_SEMANA[new Date(dia.fecha + "T00:00:00").getDay()]} ${formatearDiaCorto(dia.fecha).numero}/${new Date(dia.fecha).getMonth() + 1} a las ${formatearHora(slot)}</div>
      <label>Nombre completo</label>
      <input id="rNombre" type="text" placeholder="Tu nombre">
      <label>Motivo de la consulta (opcional)</label>
      <input id="rMotivo" type="text" placeholder="Ej: control, dolor, revisión...">
      <div id="rErr"></div>
      <button class="primary" id="btnConfirmar">Confirmar cita</button>
    </div>`;

  document.getElementById("btnConfirmar").onclick = async () => {
    const errBox = document.getElementById("rErr");
    errBox.innerHTML = "";
    const pacienteNombre = document.getElementById("rNombre").value.trim();
    const motivo = document.getElementById("rMotivo").value.trim();
    if (pacienteNombre.length < 2) { errBox.innerHTML = `<div class="error">Escribí tu nombre completo</div>`; return; }
    try {
      await api("/reserva-publica/confirmar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token(), fecha: slot, pacienteNombre, motivo }),
      });
      pintarConfirmacion(dia, slot);
    } catch (e) {
      if (e.status === 409) {
        errBox.innerHTML = `<div class="error">${esc(e.error)}</div>`;
        await iniciar(); // refresca disponibilidad, ese horario ya no debería aparecer
      } else {
        errBox.innerHTML = `<div class="error">${esc(e.error || "No se pudo confirmar la cita")}</div>`;
      }
    }
  };
}

function pintarConfirmacion(dia, slot) {
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div style="font-size:40px;margin-bottom:10px">✅</div>
      <div class="seccion-titulo" style="margin-top:0;text-align:center">¡Cita confirmada!</div>
      <div class="hint">${DIAS_SEMANA[new Date(dia.fecha + "T00:00:00").getDay()]} ${formatearDiaCorto(dia.fecha).numero}/${new Date(dia.fecha).getMonth() + 1} a las ${formatearHora(slot)}</div>
      <div class="hint" style="margin-top:10px">Te esperamos. Podés cerrar esta página — te mandamos la confirmación por WhatsApp.</div>
    </div>`;
}

iniciar();
