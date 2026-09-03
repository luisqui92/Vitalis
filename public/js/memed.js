// Vitalis — Recetar por Memed (Brasil).
//
// En Brasil una receta necesita firma digital ICP-Brasil, y esa firma la
// emite el módulo de Memed. Así que acá no se dibuja un formulario de receta:
// se carga SU módulo, se le pasa el paciente, y el médico prescribe adentro.
//
// Lo que Vitalis hace después es escuchar el evento de "receta emitida" y
// guardar la referencia más una copia de los medicamentos — que son dato
// clínico y los necesitan el hilo clínico y el brief. El documento firmado
// vive en Memed, y Vitalis no finge que es suyo.
//
// Prefijo memed* porque acá todo top-level es global y el último que carga
// gana en silencio.
let MEMED_ESTADO = null;
let MEMED_CARGANDO = null;   // Promesa del <script>, para no cargarlo dos veces.
let MEMED_PACIENTE_ACTUAL = null;

// ¿Esta cuenta receta por Memed? Se pregunta una vez por sesión. La respuesta
// no cambia mientras el médico esté adentro.
async function memedEstado() {
  if (MEMED_ESTADO) return MEMED_ESTADO;
  try {
    MEMED_ESTADO = await api("/medico/memed/estado");
  } catch {
    // Si no se puede preguntar, no se ofrece: es preferible que el botón no
    // esté a que esté y falle con el paciente adelante.
    MEMED_ESTADO = { corresponde: false };
  }
  return MEMED_ESTADO;
}

// Carga el módulo de Memed una sola vez, con el token del médico.
//
// El token va en el atributo data-token del <script>, que es como Memed lo
// pide. No se guarda en ningún lado: cada vez que se abre se pide de nuevo,
// porque Memed dice explícitamente que no es fijo.
function memedCargarModulo(scriptUrl, token) {
  if (MEMED_CARGANDO) return MEMED_CARGANDO;
  MEMED_CARGANDO = new Promise((resolver, rechazar) => {
    const s = document.createElement("script");
    s.type = "text/javascript";
    s.src = scriptUrl;
    s.dataset.token = token;
    s.onload = () => resolver();
    s.onerror = () => {
      // Que se pueda reintentar: si quedara la promesa rechazada cacheada,
      // un corte de red de un segundo dejaría la receta rota hasta recargar.
      MEMED_CARGANDO = null;
      rechazar(new Error("No se pudo cargar el módulo de Memed"));
    };
    document.head.appendChild(s);
  });
  return MEMED_CARGANDO;
}

// Se engancha UNA vez, cuando el módulo arranca. Enganchar en cada apertura
// duplicaría el escuchador y guardaría la misma receta dos veces.
let MEMED_ENGANCHADO = false;
function memedEngancharEventos() {
  if (MEMED_ENGANCHADO) return;
  if (typeof MdSinapsePrescricao === "undefined") return;
  MEMED_ENGANCHADO = true;

  MdSinapsePrescricao.event.add("core:moduleInit", function (modulo) {
    if (modulo.name !== "plataforma.prescricao") return;

    MdHub.event.add("prescricaoImpressa", async function (datos) {
      // El paciente se toma de lo que Vitalis abrió, NO de lo que devuelve
      // el evento: es contenido de afuera, y dejar que decida en qué ficha
      // se guarda una receta sería dejar que escriba en la historia clínica
      // de quien quiera.
      const pacienteId = MEMED_PACIENTE_ACTUAL;
      if (!pacienteId) return;
      try {
        await api(`/medico/pacientes/${pacienteId}/memed/recetas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(datos),
        });
      } catch (e) {
        // La receta YA está emitida y firmada en Memed, y el paciente ya la
        // tiene. Lo que falló es la copia en el Kardex. Se dice, porque una
        // receta que el médico no ve después en la ficha lo va a hacer dudar
        // de si la emitió.
        alert(t("memed.errGuardar", { detalle: (e && e.error) || "" }));
      }
    });
  });
}

// Abre el módulo con el paciente cargado. Devuelve true si abrió.
async function memedAbrir(pacienteId) {
  let sesion;
  try {
    sesion = await api(`/medico/pacientes/${pacienteId}/memed/sesion`);
  } catch (e) {
    alert((e && e.error) || t("memed.errAbrir"));
    return false;
  }

  try {
    await memedCargarModulo(sesion.scriptUrl, sesion.token);
  } catch {
    alert(t("memed.errModulo"));
    return false;
  }

  memedEngancharEventos();
  MEMED_PACIENTE_ACTUAL = pacienteId;

  // El módulo puede tardar un instante en anunciarse. Se espera a que exista
  // en vez de asumirlo: llamarlo antes de tiempo falla sin mensaje.
  const listo = await memedEsperarHub();
  if (!listo) { alert(t("memed.errModulo")); return false; }

  try {
    await MdHub.command.send("plataforma.prescricao", "setPaciente", sesion.paciente);
    await MdHub.module.show("plataforma.prescricao");
    return true;
  } catch (e) {
    alert(t("memed.errAbrir"));
    return false;
  }
}

function memedEsperarHub(msMax = 8000) {
  return new Promise((resolver) => {
    const desde = Date.now();
    (function mirar() {
      if (typeof MdHub !== "undefined" && MdHub?.command?.send) return resolver(true);
      if (Date.now() - desde > msMax) return resolver(false);
      setTimeout(mirar, 120);
    })();
  });
}

// ─── LA CAJA EN LA PESTAÑA DE RECETAS ─────────────────────────────────────
//
// Si esta cuenta receta por Memed, esta caja REEMPLAZA al formulario de
// receta de Vitalis. No convive con él: una receta sin firma digital no vale
// en Brasil, y tener los dos botones es dejar puesta la trampa.
async function memedPintarCaja(pacienteId) {
  const caja = document.getElementById("memedBox");
  if (!caja) return;

  const e = await memedEstado();
  if (!e.corresponde) { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  // Desde acá, la receta de Vitalis no se ofrece más en esta pantalla.
  const vieja = document.getElementById("recetaNuevaBox");
  if (vieja) vieja.remove();

  if (e.faltaConfiguracion) {
    // No es algo que el médico pueda arreglar. Se lo dice sin mandarlo a
    // buscar en Configuración una casilla que no existe.
    caja.innerHTML = `
      <div class="card" style="border-color:var(--warning)">
        <div class="seccion-titulo" style="margin-top:0">${t("memed.titulo")}</div>
        <div class="saldo-aviso">${t("memed.sinConfigurar")}</div>
      </div>`;
    return;
  }

  if (e.faltaConsejo) {
    caja.innerHTML = `
      <div class="card" style="border-color:var(--warning)">
        <div class="seccion-titulo" style="margin-top:0">${t("memed.titulo")}</div>
        <div class="saldo-aviso">${t("memed.faltaConsejo")}</div>
        <button class="secondary" id="memedIrConfig">${t("memed.irAConfig")}</button>
      </div>`;
    const ir = document.getElementById("memedIrConfig");
    if (ir) ir.onclick = renderSeguridad;
    return;
  }

  caja.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${t("memed.titulo")}</div>
      <div class="hint" style="margin:0 0 12px">${t("memed.ayuda")}</div>
      <button class="primary" id="memedRecetar" style="margin-top:0">${t("memed.recetar")}</button>
    </div>`;

  document.getElementById("memedRecetar").onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = t("memed.abriendo");
    await memedAbrir(pacienteId);
    btn.disabled = false;
    btn.textContent = t("memed.recetar");
  };
}

// ─── EL CPF DEL PACIENTE ──────────────────────────────────────────────────
//
// Sin CPF no se puede recetar en Brasil: es como Memed identifica al
// paciente. Se pide desde la ficha, donde se descubre que falta, y no en un
// formulario aparte al que habría que acordarse de ir.
function memedCablearCpf(paciente) {
  const btn = document.getElementById("btnCpf");
  if (!btn) return;
  btn.onclick = async () => {
    const valor = prompt(t("memed.cpfPedir", { nombre: paciente.nombre }));
    if (valor === null) return;
    const limpio = String(valor).replace(/\D/g, "");
    // Se valida acá y no solo en Memed porque un CPF mal tipeado allá no
    // vuelve como "el CPF está mal": vuelve como un alta rechazada.
    if (!memedCpfValido(limpio)) { alert(t("memed.cpfInvalido")); return; }
    try {
      await api(`/medico/pacientes/${paciente._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: limpio }),
      });
      renderPacienteDetalle(paciente._id);
    } catch (e) {
      alert((e && e.error) || t("memed.cpfErr"));
    }
  };
}

// El CPF tiene dos dígitos verificadores calculados sobre los otros nueve.
// Comprobarlos atrapa el error real —un número tipeado mal— antes de que se
// convierta en una receta que no se puede emitir con el paciente adelante.
function memedCpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;   // 11111111111 y compañía pasan la cuenta
  for (const [hasta, pos] of [[9, 10], [10, 11]]) {
    let suma = 0;
    for (let i = 0; i < hasta; i++) suma += Number(cpf[i]) * (pos - i);
    let d = (suma * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(cpf[hasta])) return false;
  }
  return true;
}

// ─── EL CONSEJO PROFESIONAL, EN CONFIGURACIÓN ─────────────────────────────
async function memedPintarConsejo() {
  const caja = document.getElementById("memedConsejoBox");
  if (!caja) return;
  const e = await memedEstado();
  if (!e.corresponde) { caja.innerHTML = ""; return; }

  let datos;
  try { datos = await api("/medico/memed/consejo"); }
  catch { caja.innerHTML = ""; return; }
  if (!caja.isConnected) return;

  const c = datos.conselho || {};
  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("memed.consejo")}</div>
      <div class="hint" style="margin:0 0 12px">${t("memed.consejoAyuda")}</div>
      <label>${t("memed.consejoSigla")}</label>
      <select id="memSigla">${datos.siglas.map(s => `<option value="${s}" ${c.sigla === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <label>${t("memed.consejoUf")}</label>
      <select id="memUf">
        <option value="">—</option>
        ${datos.ufs.map(u => `<option value="${u}" ${c.uf === u ? "selected" : ""}>${u}</option>`).join("")}
      </select>
      <label>${t("memed.consejoNumero")}</label>
      <input id="memNumero" type="text" value="${esc(c.numero || "")}">
      <label>${t("memed.cpf")}</label>
      <input id="memCpf" type="text" inputmode="numeric" value="${esc(datos.cpf || "")}">
      <div id="memErr"></div>
      <button class="secondary" id="memGuardar">${t("memed.consejoGuardar")}</button>
    </div>`;

  document.getElementById("memGuardar").onclick = async () => {
    const errBox = document.getElementById("memErr");
    errBox.innerHTML = "";
    const cpf = document.getElementById("memCpf").value.replace(/\D/g, "");
    if (cpf && !memedCpfValido(cpf)) { errBox.innerHTML = `<div class="error">${t("memed.cpfInvalido")}</div>`; return; }
    try {
      await api("/medico/memed/consejo", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sigla: document.getElementById("memSigla").value,
          uf: document.getElementById("memUf").value,
          numero: document.getElementById("memNumero").value.trim(),
          cpf,
        }),
      });
      // El estado guardado decía "te falta el consejo": si no se limpia, el
      // médico lo carga y el cartel le sigue diciendo que falta.
      MEMED_ESTADO = null;
      errBox.innerHTML = `<div class="hint">${t("memed.consejoGuardado")}</div>`;
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc((e && e.error) || t("memed.consejoErr"))}</div>`;
    }
  };
}
