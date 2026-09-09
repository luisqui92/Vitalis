// Symphomed — Memoria Clínica Conversacional: preguntale al Kardex en lenguaje
// natural sobre la historia de un paciente puntual. El chat es solo de esta
// sesión (no se persiste), por paciente.
const memoriaHistorialPorPaciente = {};

function tabMemoriaHtml(pacienteId) {
  const historial = memoriaHistorialPorPaciente[pacienteId] || [];
  return `
    <div class="card">
      <div class="nota-titulo">${t("memoria.titulo")}</div>
      <div id="memoriaChat">${pintarMemoriaChat(historial)}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
        <input id="memoriaInput" type="text" placeholder="${t("memoria.placeholder")}" style="flex:1;width:auto;margin-top:0">
        <button type="button" id="btnMicMemoria" class="mic-btn" title="${t("memoria.porVoz")}">🎙️</button>
      </div>
      <div id="memoriaErr"></div>
      <button class="secondary" id="btnPreguntar">${t("memoria.preguntar")}</button>
    </div>`;
}

function pintarMemoriaChat(historial) {
  return historial.map(h => `
    <div class="memoria-pregunta">🧑‍⚕️ ${esc(h.pregunta)}</div>
    <div class="memoria-respuesta">🤖 ${esc(h.respuesta)}</div>
  `).join("");
}

// Preguntar por voz con el reconocimiento de voz del navegador (Web Speech
// API) — mucho más simple que el pipeline de AssemblyAI usado para grabar
// consultas completas, y suficiente para una pregunta corta y puntual.
function crearReconocedorVozMemoria() {
  const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocedor) return null;
  const r = new Reconocedor();
  // El idioma del reconocimiento sale del diccionario: si quedara fijo en
  // español, un médico brasileño dictaría en portugués y el navegador se lo
  // transcribiría como si fuera castellano.
  r.lang = t("voz.lang");
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

let proximoIdMemoria = 1;

function wireTabMemoria(p) {
  const btn = document.getElementById("btnPreguntar");
  const input = document.getElementById("memoriaInput");
  const errBox = document.getElementById("memoriaErr");
  const chatBox = document.getElementById("memoriaChat");
  const btnMic = document.getElementById("btnMicMemoria");

  const repintar = () => {
    chatBox.innerHTML = pintarMemoriaChat(memoriaHistorialPorPaciente[p._id] || []);
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  const preguntar = async () => {
    const pregunta = input.value.trim();
    if (!pregunta) return;
    errBox.innerHTML = "";
    input.value = "";
    btn.disabled = true;
    btn.textContent = t("memoria.pensando");

    if (!memoriaHistorialPorPaciente[p._id]) memoriaHistorialPorPaciente[p._id] = [];
    const historial = memoriaHistorialPorPaciente[p._id];
    // Con el botón "Preguntar" y el mic (por voz) pudiendo disparar
    // preguntas casi juntas (el mic se reactiva con onend antes de que la
    // pregunta anterior termine), dos respuestas podían llegar mientras
    // ambas "…" estaban en el chat — antes se escribía/borraba siempre "la
    // última" del array, así que una respuesta podía terminar puesta en la
    // pregunta equivocada, o borrar la pregunta de otra por un error ajeno.
    // Con un id propio por pregunta, cada una encuentra su propio lugar sin
    // importar qué más se agregó o sacó mientras tanto.
    const id = proximoIdMemoria++;
    historial.push({ id, pregunta, respuesta: "…" });
    repintar();

    try {
      const data = await api("/medico/pacientes/" + p._id + "/preguntar", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ pregunta }),
      });
      const entrada = historial.find(h => h.id === id);
      if (entrada) entrada.respuesta = data.respuesta;
    } catch (e) {
      const idx = historial.findIndex(h => h.id === id);
      if (idx !== -1) historial.splice(idx, 1);
      errBox.innerHTML = `<div class="error">${esc(e.error || t("memoria.errResponder"))}</div>`;
    }
    btn.disabled = false;
    btn.textContent = t("memoria.preguntar");
    repintar();
  };

  btn.onclick = preguntar;
  input.onkeydown = (e) => { if (e.key === "Enter") preguntar(); };

  const reconocedor = crearReconocedorVozMemoria();
  if (!reconocedor) {
    btnMic.disabled = true;
    btnMic.title = t("memoria.sinVoz");
  } else {
    let escuchando = false;
    reconocedor.onstart = () => { escuchando = true; btnMic.classList.add("escuchando"); };
    reconocedor.onend = () => { escuchando = false; btnMic.classList.remove("escuchando"); };
    reconocedor.onerror = () => {
      errBox.innerHTML = `<div class="error">${t("memoria.errEscuchar")}</div>`;
    };
    reconocedor.onresult = (e) => {
      input.value = e.results[0][0].transcript;
      preguntar();
    };
    btnMic.onclick = () => {
      if (escuchando) { reconocedor.stop(); return; }
      errBox.innerHTML = "";
      try { reconocedor.start(); } catch (e) { /* ya estaba escuchando */ }
    };
  }
}
