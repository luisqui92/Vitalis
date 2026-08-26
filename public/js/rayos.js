// ═══════════════════════════════════════════════════════════════════════════
// Vitalis Rayos — la radiografía entra sola a la ficha
// ═══════════════════════════════════════════════════════════════════════════
// Dos pantallas:
//   1. El bloque de captura dentro de la pestaña Estudios del paciente —
//      "Capturar radiografía", y la espera con cuenta regresiva.
//   2. La administración de equipos (dar de alta la PC del consultorio y
//      sacar su token), a la que se llega desde ese mismo bloque.
//
// Cuando la imagen llega, no hace falta hacer nada acá: el servidor avisa
// por el WebSocket de tiempo real y realtime.js repinta la ficha sola, con
// la radiografía ya adentro. Ver services/realtime.js → avisarCambio().

let temporizadorCaptura = null;

// El token recién generado se guarda acá mientras el médico esté en la
// pantalla de equipos. Sin esto se perdía para siempre: dar de alta un
// equipo es un POST, y todo POST dispara el aviso de tiempo real que
// repinta la pantalla — borrando el único momento en que el token es
// visible. Ver services/realtime.js → middlewareAvisarCambios.
let tokenRecienGenerado = null;

function detenerTemporizadorCaptura() {
  if (temporizadorCaptura) { clearInterval(temporizadorCaptura); temporizadorCaptura = null; }
}

function cuentaRegresiva(expiraEn) {
  const restante = Math.max(0, Math.floor((new Date(expiraEn).getTime() - Date.now()) / 1000));
  const min = String(Math.floor(restante / 60)).padStart(2, "0");
  const seg = String(restante % 60).padStart(2, "0");
  return { texto: `${min}:${seg}`, restante };
}

// ─── EL BLOQUE DENTRO DE LA PESTAÑA ESTUDIOS ──────────────────────────────
// Se pinta vacío y se completa después (necesita su propia consulta al
// servidor), para no demorar la carga de la ficha por algo que es secundario
// y que la mayoría de las especialidades ni usa.
function bloqueCapturaHtml() {
  return `<div id="rxBloque"></div>`;
}

async function pintarBloqueCaptura(p) {
  detenerTemporizadorCaptura();
  const caja = document.getElementById("rxBloque");
  if (!caja) return;

  let equipos = [], captura = null;
  try {
    const data = await api("/medico/rayos/estado");
    equipos = data.equipos || [];
    captura = data.captura || null;
  } catch {
    return; // sin equipo de rayos la ficha funciona igual: no molestamos con un error
  }

  // Todavía no conectó ningún equipo — una sola línea discreta, no una
  // tarjeta grande que le ocupe la pantalla a quien nunca va a usar esto.
  if (equipos.length === 0) {
    caja.innerHTML = `
      <div class="hint" style="margin:0 0 14px">
        ${t("rx.invitacion")}
        <a href="#" id="rxConectar" style="color:var(--primary)">${t("rx.invitacionLink")}</a>
      </div>`;
    caja.querySelector("#rxConectar").onclick = (e) => { e.preventDefault(); renderEquiposRayos(p); };
    return;
  }

  const conectado = equipos.some(e => e.conectado);
  const esperandoAOtro = captura && String(captura.pacienteId) !== String(p._id);

  if (captura && !esperandoAOtro) {
    pintarEsperaCaptura(p, captura, caja);
    return;
  }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${t("rx.equipo")}</div>
      ${esperandoAOtro ? `
        <div class="hint" style="color:var(--warning);margin-bottom:10px">
          ${t("rx.esperandoOtro", { otro: esc(captura.pacienteNombre), actual: esc(p.nombre) })}
        </div>` : ""}
      <div class="hint" style="margin-bottom:10px">
        ${conectado
          ? t("rx.conectado")
          : t("rx.desconectado")}
      </div>
      <button class="secondary" id="btnCapturarRx">${t("rx.capturar")}</button>
      <div class="hint" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
        <span>${equipos.map(e => `${conectado && e.conectado ? "🟢" : "⚪"} ${esc(e.nombre)}`).join(" · ")}</span>
        <a href="#" id="rxAdmin" style="color:var(--primary)">${t("rx.administrar")}</a>
      </div>
      <div id="rxErr"></div>
    </div>`;

  caja.querySelector("#rxAdmin").onclick = (e) => { e.preventDefault(); renderEquiposRayos(p); };
  caja.querySelector("#btnCapturarRx").onclick = async () => {
    const btn = caja.querySelector("#btnCapturarRx");
    btn.disabled = true;

    // El try envuelve SOLO la llamada al servidor. Si además envolviera al
    // pintado, cualquier error de dibujo se reportaría como "no se pudo
    // abrir la captura", que es mentira y manda a buscar el problema al
    // lado equivocado.
    let data;
    try {
      data = await api(`/medico/pacientes/${p._id}/captura`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "radiografia", nombre: t("rx.nombreCaptura") }),
      });
    } catch (e2) {
      btn.disabled = false;
      const err = caja.querySelector("#rxErr");
      if (err) err.innerHTML = `<div class="error">${esc(e2.error || t("rx.errCaptura"))}</div>`;
      return;
    }

    // Abrir la captura es un POST, y todo POST dispara el aviso de tiempo
    // real: puede que la ficha ya se haya repintado sola con la espera
    // puesta, y que este pedazo de pantalla ya no exista.
    if (caja.isConnected) pintarEsperaCaptura(p, data.captura, caja);
  };
}

// ─── LA ESPERA ────────────────────────────────────────────────────────────
function pintarEsperaCaptura(p, captura, caja) {
  detenerTemporizadorCaptura();
  caja.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${t("rx.esperando")}</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div class="spinner" style="margin:0"></div>
        <div>
          <div style="font-weight:600">${esc(p.nombre)}</div>
          <div class="hint" style="margin:0">${t("rx.tomaAhora")}</div>
        </div>
      </div>
      <div class="hint" style="margin-bottom:10px">
        ${t("rx.cierraEn")} <b id="rxReloj">--:--</b>
        <span id="rxRecibidas">${captura.recibidas ? t("rx.yaLlegaron", { n: captura.recibidas }) : ""}</span>
      </div>
      <button class="secondary" id="btnCancelarRx">${t("rx.cancelarEspera")}</button>
    </div>`;

  // Búsquedas dentro de "caja" y no en todo el documento: esta tarjeta
  // puede haber quedado fuera de la pantalla si el aviso de tiempo real
  // repintó la ficha en el medio, y un getElementById global devolvería
  // null (o peor, el nodo de otra copia de la pantalla).
  const relojEl = caja.querySelector("#rxReloj");
  function tic() {
    // Ya no está en pantalla: nadie la ve, y seguir contando sería un
    // temporizador colgado para siempre.
    if (!relojEl.isConnected) return detenerTemporizadorCaptura();
    const { texto, restante } = cuentaRegresiva(captura.expiraEn);
    relojEl.textContent = texto;
    // Se agotó el tiempo: volvemos al estado normal sin que el médico tenga
    // que hacer nada ni quedarse mirando un contador en cero.
    if (restante <= 0) { detenerTemporizadorCaptura(); pintarBloqueCaptura(p); }
  }
  tic();
  temporizadorCaptura = setInterval(tic, 1000);

  caja.querySelector("#btnCancelarRx").onclick = async () => {
    detenerTemporizadorCaptura();
    try { await api("/medico/rayos/captura", { method: "DELETE" }); } catch {}
    pintarBloqueCaptura(p);
  };
}

// ─── ADMINISTRACIÓN DE EQUIPOS ────────────────────────────────────────────
function mostrarErrorEquipos(mensaje) {
  const caja = document.getElementById("rxAdminErr");
  if (caja) caja.innerHTML = `<div class="error">${esc(mensaje)}</div>`;
}

// "preservarToken" solo lo manda el repintado automático de tiempo real
// (ver realtime.js): entrar a mano a la pantalla arranca siempre sin token
// a la vista, que es lo que corresponde para algo que se muestra una vez.
async function renderEquiposRayos(pacienteVuelta, { preservarToken = false } = {}) {
  detenerTemporizadorCaptura();
  if (!preservarToken) tokenRecienGenerado = null;
  if (typeof detenerPolling === "function") detenerPolling();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando equipos...</div>`;
  let equipos = [];
  try {
    equipos = (await api("/medico/rayos/estado")).equipos || [];
  } catch (e) {
    if (e.status === 401) return logout();
    app.innerHTML = `<div class="error">${esc(e.error || t("rx.errEquipos"))}</div>`;
    return;
  }
  pintarEquiposRayos(equipos, pacienteVuelta);
}

function pintarEquiposRayos(equipos, pacienteVuelta) {
  app.innerHTML = `
    <button class="back" id="rxBack">${t(pacienteVuelta ? "rx.volverFicha" : "rx.volverPanel")}</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("rx.equipo")}</div>
      <div class="hint" style="margin-bottom:12px">
        ${t("rx.explicacion")}
      </div>

      ${equipos.length === 0 ? `<div class="empty" style="margin-bottom:12px">${t("rx.sinEquipos")}</div>` : equipos.map(e => `
        <div class="item" style="cursor:default">
          <div class="top">
            <div class="nombre">${e.conectado ? "🟢" : "⚪"} ${esc(e.nombre)}</div>
            <button class="link" data-baja-equipo="${e._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
          </div>
          <div class="fecha">
            ${e.conectado ? t("rx.conectadaAhora") : (e.ultimoContacto ? t("rx.ultimaSenal", { fecha: new Date(e.ultimoContacto).toLocaleString(localeActual()) }) : t("rx.nuncaConecto"))}
          </div>
          <div class="paciente-info">
            ${e.subidas ? t(e.subidas === 1 ? "rx.unaImagen" : "rx.variasImagenes", { n: e.subidas }) : t("rx.sinImagenes")}
            ${e.ultimaSubida ? t("rx.ultimaEl", { fecha: new Date(e.ultimaSubida).toLocaleDateString(localeActual()) }) : ""}
          </div>
          <button class="item-action" data-token-equipo="${e._id}" style="margin-top:10px">${t("rx.tokenNuevo")}</button>
        </div>`).join("")}

      <label style="margin-top:14px">${t("rx.nombrePc")}</label>
      <input id="rxNombre" type="text" placeholder="${t("rx.nombrePcPlaceholder")}">
      <div id="rxAdminErr"></div>
      <button class="secondary" id="btnAltaEquipo">${t("rx.conectarPc")}</button>
    </div>

    <div id="rxToken"></div>`;

  // Si veníamos de generar uno, lo volvemos a poner: esta función se llama
  // de nuevo ante cada aviso de tiempo real.
  if (tokenRecienGenerado) mostrarTokenEquipo(tokenRecienGenerado, { desplazar: false });

  document.getElementById("rxBack").onclick = () => {
    tokenRecienGenerado = null; // al salir de la pantalla, el token deja de estar a la vista
    pacienteVuelta ? renderPacienteDetalle(pacienteVuelta._id, "estudios") : renderDashboard();
  };

  document.getElementById("btnAltaEquipo").onclick = async () => {
    const btn = document.getElementById("btnAltaEquipo");
    btn.disabled = true;
    try {
      const data = await api("/medico/rayos/equipos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: document.getElementById("rxNombre").value.trim() }),
      });
      await renderEquiposRayos(pacienteVuelta);
      mostrarTokenEquipo(data.token);
    } catch (e) {
      btn.disabled = false;
      mostrarErrorEquipos(e.error || t("rx.errCrear"));
    }
  };

  document.querySelectorAll("[data-token-equipo]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("rx.confirmarRegenerar"))) return;
      try {
        const data = await api(`/medico/rayos/equipos/${btn.dataset.tokenEquipo}/token`, { method: "POST" });
        mostrarTokenEquipo(data.token);
      } catch (e) {
        mostrarErrorEquipos(e.error || t("rx.errRegenerar"));
      }
    };
  });

  document.querySelectorAll("[data-baja-equipo]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(t("rx.confirmarBaja"))) return;
      try {
        await api(`/medico/rayos/equipos/${btn.dataset.bajaEquipo}`, { method: "DELETE" });
        renderEquiposRayos(pacienteVuelta);
      } catch (e) {
        mostrarErrorEquipos(e.error || t("rx.errBaja"));
      }
    };
  });
}

// El token se muestra UNA sola vez (el servidor guarda solo su hash, igual
// que con una contraseña) — por eso la pantalla insiste tanto en copiarlo.
function mostrarTokenEquipo(token, { desplazar = true } = {}) {
  tokenRecienGenerado = token;
  const caja = document.getElementById("rxToken");
  if (!caja) return;
  caja.innerHTML = `
    <div class="card" style="border-color:var(--warning)">
      <div class="seccion-titulo" style="margin-top:0">${t("rx.tokenTitulo")}</div>
      <div class="hint" style="color:var(--warning);margin-bottom:10px">
        ${t("rx.tokenAviso")}
      </div>
      <div id="rxTokenTexto" style="font-family:monospace;font-size:13px;word-break:break-all;background:var(--bg);padding:10px;border-radius:8px;user-select:all">${esc(token)}</div>
      <button class="secondary" id="btnCopiarToken" style="margin-top:10px">${t("rx.copiar")}</button>

      <div class="seccion-titulo">${t("rx.instalacion")}</div>
      <div class="hint" style="margin-bottom:10px">
        ${t("rx.instalacionAyuda")}
      </div>
      <label>${t("rx.carpeta")}</label>
      <input id="rxCarpeta" type="text" placeholder="${t("rx.carpetaPlaceholder")}" spellcheck="false">
      <div class="hint" style="margin:6px 0 0">
        ${t("rx.carpetaAyuda")}
      </div>
      <div id="rxCarpetaErr"></div>
      <button class="secondary" id="btnBajarConfig" style="margin-top:10px">${t("rx.bajarConfig")}</button>
      <a class="secondary" id="btnBajarAgente" href="/rayos/agente.js" download="agente.js"
         style="display:block;text-align:center;text-decoration:none;margin-top:8px">${t("rx.bajarAgente")}</a>
      <div class="hint" style="margin-top:10px">
        ${t("rx.pasosFinales")}
        <div style="font-family:monospace;font-size:13px;background:var(--bg);padding:8px;border-radius:8px;margin-top:6px;user-select:all">node agente.js</div>
        ${t("rx.pasoFinal2")}
      </div>
    </div>`;
  if (desplazar) caja.scrollIntoView({ behavior: "smooth", block: "start" });

  document.getElementById("btnCopiarToken").onclick = async () => {
    const btn = document.getElementById("btnCopiarToken");
    try {
      await navigator.clipboard.writeText(token);
      btn.textContent = t("rx.copiado");
    } catch {
      // Sin permiso de portapapeles (pasa en http:// y en algunos
      // navegadores viejos): al menos se lo dejamos seleccionado.
      const rango = document.createRange();
      rango.selectNodeContents(document.getElementById("rxTokenTexto"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rango);
      btn.textContent = t("rx.seleccionado");
    }
  };

  // El config.json se arma acá, en el navegador, y no en el servidor: el
  // token en claro no existe del lado de Vitalis (guardamos solo su hash),
  // así que este es el único lugar del mundo donde se lo puede meter en el
  // archivo. JSON.stringify escapa solo las barras de Windows, que es
  // justo lo que se escribe mal cuando se hace a mano.
  document.getElementById("btnBajarConfig").onclick = () => {
    const err = document.getElementById("rxCarpetaErr");
    const carpeta = document.getElementById("rxCarpeta").value.trim().replace(/["']/g, "");
    if (!carpeta) {
      err.innerHTML = `<div class="error">${t("rx.errCarpeta")}</div>`;
      return;
    }
    err.innerHTML = "";
    const config = {
      servidor: location.origin,
      token,
      carpeta,
      incluirSubcarpetas: true,
      segundosRevision: 3,
      minutosReintento: 20,
    };
    descargarTexto("config.json", JSON.stringify(config, null, 2));
  };
}

// Descarga un archivo generado en el navegador, sin pasar por el servidor.
function descargarTexto(nombre, contenido) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto el blob queda ocupando memoria hasta que se recargue la página.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
