// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — La sala de video vista por el paciente
// ═══════════════════════════════════════════════════════════════════════════
// Lo que se abre al tocar el enlace que le mandó su médico. Sin cuenta, sin
// contraseña, sin instalar nada.
//
// ═══ EL CONSENTIMIENTO SE LEE ANTES DE ENTRAR, NO DESPUÉS ══════════════════
//
// El texto está a la vista, completo, y el botón dice lo que hace. No hay
// una casilla premarcada, ni un "acepto los términos" con un enlace que
// nadie abre: lo que se está autorizando es que graben una conversación
// sobre su salud, y eso se lee entero o no vale.
//
// De todos modos, si alguien se saltea esta pantalla no consigue nada: el
// servidor no emite el token de la sala sin el consentimiento guardado (ver
// routes/teleconsulta.js). Esto es la parte honesta, no la parte segura.

const RUTA_TELE = location.pathname.match(/^\/teleconsulta\/([A-Za-z0-9_-]{20,})$/);

function esPaginaTeleconsulta() {
  return Boolean(RUTA_TELE);
}

// Igual que el informe público: el armazón del médico se BORRA, no se
// esconde. Escondido sigue en el documento, y el "ver código fuente" de
// cualquiera le muestra al paciente los botones de una app que no es suya.
function limpiarArmazonDelMedico() {
  ["headerMobile", "escritorioShell"].forEach(id => document.getElementById(id)?.remove());
  document.querySelectorAll(".footer").forEach(f => f.remove());
}

function tarjetaTele(contenido) {
  return `<div class="card" style="max-width:520px;margin:24px auto">${contenido}</div>`;
}

async function renderTeleconsulta() {
  const token = RUTA_TELE[1];
  document.title = "Tu consulta · Vitalis";
  limpiarArmazonDelMedico();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Abriendo tu consulta...</div>`;

  let datos;
  try {
    const r = await fetch(`/teleconsulta-publica/${encodeURIComponent(token)}`);
    datos = await r.json();
    if (!r.ok) throw new Error(datos?.error || "");
  } catch {
    app.innerHTML = tarjetaTele(`<div class="error">No pudimos abrir tu consulta. Revisá tu conexión y volvé a intentar.</div>`);
    return;
  }

  // Los tres finales posibles, cada uno con su explicación. "Este enlace no
  // sirve" deja al paciente sin saber si equivocó el link, si llegó tarde o
  // si el médico lo canceló.
  const cerradas = {
    vencida: "Este enlace ya venció. Pedile uno nuevo a tu profesional.",
    terminada: "Esta consulta ya terminó.",
    cancelada: "Esta consulta fue cancelada. Escribile a tu profesional.",
  };
  if (cerradas[datos.estado]) {
    app.innerHTML = tarjetaTele(`<div class="hint" style="font-size:15px">${esc(cerradas[datos.estado])}</div>`);
    return;
  }

  if (!datos.consentimientoAceptado) return pantallaConsentimiento(token, datos);
  return pantallaSala(token, datos);
}

function pantallaConsentimiento(token, datos) {
  app.innerHTML = tarjetaTele(`
    <div class="seccion-titulo" style="margin-top:0">Consulta por video</div>
    <div class="hint" style="margin:0 0 14px">
      ${datos.pacienteNombre ? `Hola, ${esc(datos.pacienteNombre)}. ` : ""}Antes de entrar, leé esto.
    </div>

    <div class="saldo-aviso" style="font-size:14px;line-height:1.5">${esc(datos.textoConsentimiento)}</div>

    <div id="teleErr"></div>
    <button class="primary" id="btnAcepto" style="margin-top:14px">Acepto y entro a la consulta</button>
    <div class="hint" style="margin:10px 0 0">
      Si no querés que se grabe, cerrá esta página y avisale a tu profesional.
      Podés tener la consulta igual, de otra forma.
    </div>`);

  document.getElementById("btnAcepto").onclick = async () => {
    const btn = document.getElementById("btnAcepto");
    const err = document.getElementById("teleErr");
    err.innerHTML = "";
    btn.disabled = true;
    try {
      const r = await fetch(`/teleconsulta-publica/${encodeURIComponent(token)}/consentimiento`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acepto: true }),
      });
      if (!r.ok) throw new Error();
      pantallaSala(token, datos);
    } catch {
      btn.disabled = false;
      err.innerHTML = `<div class="error">No pudimos registrar tu respuesta. Probá de nuevo.</div>`;
    }
  };
}

async function pantallaSala(token, datos) {
  app.innerHTML = tarjetaTele(`<div class="loading"><div class="spinner"></div>Conectando...</div>`);

  let sala;
  try {
    const r = await fetch(`/teleconsulta-publica/${encodeURIComponent(token)}/entrar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    sala = await r.json();
    if (!r.ok) throw new Error(sala?.error || "");
  } catch (e) {
    app.innerHTML = tarjetaTele(`
      <div class="error">${esc(e.message || "No pudimos conectarte a la consulta.")}</div>
      <button class="secondary" id="btnReintentar" style="margin-top:12px">Reintentar</button>`);
    document.getElementById("btnReintentar").onclick = () => pantallaSala(token, datos);
    return;
  }

  montarSala(sala, false);
}

// Los dos <video> y el cartel de estado. La misma pantalla la usan el
// paciente y el médico; lo único que cambia es qué dice arriba.
function montarSala(sala, esMedico) {
  app.innerHTML = `
    <div style="max-width:900px;margin:0 auto">
      <div id="teleEstado" class="hint" style="margin:12px 0"></div>
      <div style="position:relative;border-radius:12px;overflow:hidden;background:#000">
        <video id="teleRemoto" playsinline autoplay style="width:100%;display:block;min-height:240px"></video>
        <video id="teleLocal" playsinline autoplay muted
          style="position:absolute;right:10px;bottom:10px;width:28%;max-width:160px;border-radius:8px;border:2px solid rgba(255,255,255,.7)"></video>
      </div>
      <button class="secondary" id="teleColgar" style="margin-top:12px">${t("tele.colgar")}</button>
    </div>`;

  const pintarEstado = (texto, malo) => {
    const caja = document.getElementById("teleEstado");
    if (caja) {
      caja.textContent = texto;
      caja.style.color = malo ? "var(--danger)" : "";
    }
  };

  document.getElementById("teleColgar").onclick = () => {
    rtcColgar();
    app.innerHTML = tarjetaTele(`<div class="hint" style="font-size:15px">${t("tele.terminada")}</div>`);
  };

  rtcIniciar(sala, { idLocal: "teleLocal", idRemoto: "teleRemoto", alEstado: pintarEstado });
}
