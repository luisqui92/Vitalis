// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Elegir la contraseña nueva (/restablecer/<token>)
// ═══════════════════════════════════════════════════════════════════════════
//
// Quien llega acá tocó un enlace de WhatsApp que un admin le mandó después de
// aprobar su pedido. Dos campos, un botón, y listo — no hay nada más que
// mostrar, y cuanto menos haya entre el enlace y "ya podés entrar", mejor.
"use strict";

const RUTA = location.pathname.match(/^\/restablecer\/([A-Za-z0-9_-]{20,})$/);
const app = document.getElementById("app");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(ruta, opciones = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opciones.headers);
  const res = await fetch(ruta, { ...opciones, headers });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw datos.error ? datos : { error: "No se pudo." };
  return datos;
}

function pintarError(mensaje) {
  app.innerHTML = `
    <div class="error">
      <h1>${esc(mensaje)}</h1>
      <p>Volvé a pedirlo desde la pantalla de entrar.</p>
    </div>`;
}

function pintarForm(d) {
  const destino = d.tipo === "socio" ? "/socio" : "/app";
  app.innerHTML = `
    <div class="panel">
      <h2>Hola, ${esc(d.nombre || "")}</h2>
      <p class="ayuda">Elegí tu contraseña nueva. Tiene que tener al menos ${esc(d.minimo)} caracteres.</p>
      <label for="rcPass">Contraseña nueva</label>
      <input id="rcPass" type="password" autocomplete="new-password" minlength="${esc(d.minimo)}">
      <label for="rcPass2" style="margin-top:10px;display:block">Repetila</label>
      <input id="rcPass2" type="password" autocomplete="new-password" minlength="${esc(d.minimo)}">
      <div id="rcErr" style="margin-top:8px"></div>
      <button class="btn primario" id="rcGuardar" style="margin-top:14px">Guardar y entrar</button>
    </div>`;

  const ir = () => { location.href = destino; };

  document.getElementById("rcGuardar").onclick = async () => {
    const p1 = document.getElementById("rcPass").value;
    const p2 = document.getElementById("rcPass2").value;
    const err = document.getElementById("rcErr");
    err.innerHTML = "";

    if (p1.length < d.minimo) {
      err.innerHTML = `<p style="color:var(--alerta-tinta)">Tiene que tener al menos ${esc(d.minimo)} caracteres.</p>`;
      return;
    }
    if (p1 !== p2) {
      err.innerHTML = `<p style="color:var(--alerta-tinta)">Las dos contraseñas no coinciden.</p>`;
      return;
    }

    const b = document.getElementById("rcGuardar");
    b.disabled = true;
    b.textContent = "Guardando…";
    try {
      await api(`/restablecer-clave/${RUTA[1]}`, { method: "POST", body: JSON.stringify({ password: p1 }) });
      app.innerHTML = `
        <div class="panel">
          <h2>Listo</h2>
          <p class="ayuda">Tu contraseña ya está cambiada. Podés entrar con la nueva.</p>
          <button class="btn primario" id="rcIr" style="margin-top:8px">Ir a entrar</button>
        </div>`;
      document.getElementById("rcIr").onclick = ir;
    } catch (e) {
      b.disabled = false;
      b.textContent = "Guardar y entrar";
      err.innerHTML = `<p style="color:var(--alerta-tinta)">${esc(e.error || "No se pudo guardar.")}</p>`;
    }
  };
}

async function renderRestablecer() {
  if (!RUTA) return pintarError("Este enlace no es válido.");
  document.title = "Elegir contraseña nueva";
  try {
    const d = await api(`/restablecer-clave/${RUTA[1]}`);
    pintarForm(d);
  } catch (e) {
    pintarError(e.error || "No pudimos abrir este enlace.");
  }
}

renderRestablecer();
