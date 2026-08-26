// Vitalis — "Preguntale a Vitalis": el asistente que explica cómo usar el
// sistema. Se abre desde el "?" del encabezado, así está a mano desde
// cualquier pantalla sin ocupar un lugar en la fila de accesos.
//
// La conversación vive solo en memoria: es para resolver una duda en el
// momento, no un historial que haya que guardar.

let asistenteConversacion = [];
let asistenteAbierto = false;

// Se resuelven en cada llamada y no en una constante: este archivo se carga
// antes del login, cuando todavía no se sabe el idioma del médico.
function sugerenciasAsistente() {
  return [1, 2, 3, 4, 5].map(n => t("asistente.sug." + n));
}

function abrirAsistente() {
  if (asistenteAbierto) return cerrarAsistente();
  asistenteAbierto = true;

  const panel = document.createElement("div");
  panel.id = "asistentePanel";
  panel.className = "asistente-panel no-imprimir";
  panel.innerHTML = `
    <div class="asistente-cabecera">
      <div>
        <div class="asistente-titulo">${t("asistente.titulo")}</div>
        <div class="asistente-sub">${t("asistente.sub")}</div>
      </div>
      <button class="asistente-cerrar" id="btnCerrarAsistente" aria-label="${t("asistente.cerrar")}">✕</button>
    </div>
    <div class="asistente-mensajes" id="asistenteMensajes"></div>
    <div class="asistente-pie">
      <input id="asistenteInput" type="text" placeholder="${t("asistente.placeholder")}" autocomplete="off">
      <button class="primary" id="btnEnviarAsistente">${t("asistente.enviar")}</button>
    </div>`;
  document.body.appendChild(panel);

  document.getElementById("btnCerrarAsistente").onclick = cerrarAsistente;
  document.getElementById("btnEnviarAsistente").onclick = enviarPreguntaAsistente;
  document.getElementById("asistenteInput").onkeydown = (e) => {
    if (e.key === "Enter") enviarPreguntaAsistente();
  };

  pintarMensajesAsistente();
  document.getElementById("asistenteInput").focus();
}

function cerrarAsistente() {
  asistenteAbierto = false;
  document.getElementById("asistentePanel")?.remove();
}

function pintarMensajesAsistente() {
  const caja = document.getElementById("asistenteMensajes");
  if (!caja) return;

  if (asistenteConversacion.length === 0) {
    caja.innerHTML = `
      <div class="asistente-vacio">
        <div style="font-size:30px">💬</div>
        <div style="margin:8px 0 14px">${t("asistente.vacio")}</div>
        ${sugerenciasAsistente().map(s => `<button class="asistente-sugerencia" data-sugerencia="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>`;
    caja.querySelectorAll("[data-sugerencia]").forEach(b => {
      b.onclick = () => {
        document.getElementById("asistenteInput").value = b.dataset.sugerencia;
        enviarPreguntaAsistente();
      };
    });
    return;
  }

  caja.innerHTML = asistenteConversacion.map(m => `
    <div class="asistente-msg ${m.rol === "usuario" ? "asistente-msg-yo" : "asistente-msg-ia"}">
      ${m.pensando ? `<span class="asistente-puntos"><i></i><i></i><i></i></span>` : esc(m.texto).replace(/\n/g, "<br>")}
    </div>`).join("");
  caja.scrollTop = caja.scrollHeight;
}

async function enviarPreguntaAsistente() {
  const input = document.getElementById("asistenteInput");
  const pregunta = input.value.trim();
  if (!pregunta) return;

  input.value = "";
  asistenteConversacion.push({ rol: "usuario", texto: pregunta });
  asistenteConversacion.push({ rol: "ia", texto: "", pensando: true });
  pintarMensajesAsistente();

  try {
    // Se manda el ida y vuelta anterior (sin el "pensando") para poder
    // repreguntar sobre lo que se acaba de responder.
    const historial = asistenteConversacion
      .filter(m => !m.pensando && m.texto)
      .slice(0, -1)
      .map(m => ({ rol: m.rol, texto: m.texto }));

    const data = await api("/medico/asistente", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta, historial }),
    });
    asistenteConversacion[asistenteConversacion.length - 1] = { rol: "ia", texto: data.respuesta };
  } catch (e) {
    asistenteConversacion[asistenteConversacion.length - 1] = {
      rol: "ia",
      texto: e.error || t("asistente.errResponder"),
    };
  }
  pintarMensajesAsistente();
}
