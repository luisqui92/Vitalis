// Symphomed — Dashboard (lista de pacientes) y el Kardex de cada paciente
// (pestañas: Paciente, Consultas, Medicación, Antecedentes, Vacunas).

// Si la última pestaña se cambió con el teclado. Cambiar de pestaña repinta
// todo el Kardex, y al repintar se pierde el foco: sin esta bandera la
// primera flecha funciona y la segunda no, porque el foco quedó en el body.
let kardexFocoEnTabs = false;

// La barra de pestañas del celular — la pantalla que el médico ve primero y
// desde la que llega a todo lo demás.
//
// Está afuera de renderPacientes() para poder probarla: es donde vivieron
// dos errores que nadie vio porque esta pantalla no tenía ninguna prueba.
//
//   · La grilla tenía cinco columnas escritas a mano en el style. El día que
//     apareció la pestaña de Clínica —que solo ve quien administra— el sexto
//     botón se caía solo a una segunda fila.
//   · La pestaña decía "Seguridad". Adentro están el idioma, las
//     notificaciones y los respaldos, además del 2FA; nadie busca el idioma
//     bajo un escudo que dice Seguridad. Lo reportó alguien que no encontraba
//     cómo cambiar de idioma en el celular — y era el dueño del producto.
//     La vista de escritorio ya llamaba "Configuración" a esta misma
//     pantalla: el nombre engañoso era el del celular.
function pestanasPacientes(pendientes) {
  const pestanas = [
    `<button class="tab" id="btnNuevoPaciente"><span class="tab-icono">${ICONOS.mas}</span>${t("pacientes.tab.nuevo")}</button>`,
    // Una cuenta de estudiante no da turnos (public/js/estudiantes.js); en
    // ese lugar va «Estudiar», el repaso con sus casos (public/js/estudio.js).
    ...(typeof esCuentaEstudiante === "function" && esCuentaEstudiante()
      ? [`<button class="tab" id="btnEstudiar"><span class="tab-icono">${ICONOS.birrete}</span>${t("pacientes.tab.estudiar")}</button>`]
      : [`<button class="tab" id="btnAgenda"><span class="tab-icono">${ICONOS.calendario}</span>${t("pacientes.tab.agenda")}</button>`]),
    `<button class="tab" id="btnRecordatorios"><span class="tab-icono">${ICONOS.campana}${pendientes ? `<b class="tab-globo">${pendientes}</b>` : ""}</span>${t("pacientes.tab.recordatorios")}</button>`,
    `<button class="tab" id="btnVincular"><span class="tab-icono">${ICONOS.mic}</span>${t("pacientes.tab.vincular")}</button>`,
    `<button class="tab" id="btnConfiguracion"><span class="tab-icono">${ICONOS.escudo}</span>${t("pacientes.tab.configuracion")}</button>`,
  ];
  // El clipboard y no otro escudo: dos escudos idénticos uno al lado del
  // otro no distinguen nada.
  if (esAdministrador()) {
    pestanas.push(`<button class="tab" id="btnClinica"><span class="tab-icono">${ICONOS.clipboard}</span>${t("clin.nav.clinica")}</button>`);
  }
  // Los pagos son el trabajo diario de quien acredita, no un ajuste que se
  // toca una vez: tienen su pestaña y no viven adentro de Configuración.
  // El globo con los pendientes es lo mismo que hace la campana de
  // recordatorios — el número que hay que atender, visible sin entrar.
  if (ES_OPERADOR) {
    const esperando = (OPERADOR_ESTADO?.pendientes || 0) + (OPERADOR_ESTADO?.cuentasPendientes || 0)
      + (OPERADOR_ESTADO?.reseteosPendientes || 0);
    pestanas.push(`<button class="tab" id="btnPagos"><span class="tab-icono">${ICONOS.tendencia}${esperando ? `<b class="tab-globo">${esperando}</b>` : ""}</span>${t("op.nav.pagos")}</button>`);
  }
  // Symphomed Ganadería: solo para quien atiende veterinaria — ver el mismo
  // criterio en escritorio.js.
  if (MEDICO_TIPO_ESPECIALIDAD === "veterinaria") {
    pestanas.push(`<button class="tab" id="btnGanaderia"><span class="tab-icono">${ICONOS.pata}</span>${t("pacientes.tab.ganaderia")}</button>`);
  }
  return pestanas;
}

function tabsPacientesHtml(pendientes) {
  const pestanas = pestanasPacientes(pendientes);
  return `
    <div class="tabs tabs-inicio" style="--n:${pestanas.length};margin-bottom:16px">
      ${pestanas.join("")}
    </div>`;
}

function pacienteItemHtml(p) {
  const esVet = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  const info = esVet
    ? [p.especie, p.raza].filter(Boolean).join(" · ")
    : (() => {
        // En pediatría "2 años" de un bebé de 26 meses tira justo el dato
        // que importa; se muestra en días/meses hasta que deja de importar.
        const edad = MEDICO_TIPO_ESPECIALIDAD === "pediatria"
          ? edadPediatricaTexto(p.fechaNacimiento)
          : (edadDesde(p.fechaNacimiento) != null ? t("pacientes.anos", { n: edadDesde(p.fechaNacimiento) }) : "");
        return `${edad}${edad && p.sexo ? " · " : ""}${p.sexo || ""}`;
      })();
  // <button> y no <div>: se alcanza con Tab, se abre con Enter y con espacio,
  // y un lector de pantalla lo anuncia como algo que se puede activar. Con un
  // div más un onclick, un médico que navega con teclado —o cualquiera con un
  // mouse roto— simplemente no puede abrir una ficha.
  //
  // type="button" es obligatorio aunque no haya formulario a la vista: el
  // valor por omisión de un <button> es "submit", y el día que alguien meta
  // esta lista adentro de un form, cada clic recarga la página.
  return `
    <button type="button" class="item item-paciente" data-id="${p._id}" data-nombre="${esc(p.nombre.toLowerCase())}">
      <span class="avatar avatar-xs" aria-hidden="true">${esc(iniciales(p.nombre))}</span>
      <span>
        <span class="nombre">${esc(p.nombre)}</span>
        <span class="paciente-info">${esc(info)}</span>
      </span>
    </button>`;
}

// ─── DASHBOARD = LISTA DE PACIENTES ─────────────────────────────────────
async function renderDashboard() {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  headerSub.textContent = t("pacientes.saludo", { nombre: MEDICO_NOMBRE || "" });
  btnLogout.style.display = "inline-block";
  btnAsistente.style.display = "inline-flex";
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("pacientes.cargando")}</div>`;
  try {
    // Las tres en paralelo: la bandeja es una consulta más y el panel es lo
    // primero que ve el médico al entrar. En serie, cada una le suma su
    // demora a la pantalla de arranque.
    const [dataPacientes, dataRecordatorios, dataBandeja] = await Promise.all([
      api("/medico/pacientes"),
      api("/medico/recordatorios"),
      // Si la bandeja falla, el panel tiene que abrirse igual.
      api("/medico/dicom/bandeja").catch(() => ({ entrantes: [] })),
      // El saldo se trae acá para poder avisar ANTES de grabar. Si falla, el
      // panel se abre igual y simplemente no hay aviso.
      traerSaldo(),
      // Para el cartel de avisos de pago pendientes. Devuelve operador:false
      // enseguida si esta cuenta no acredita, que es el caso de casi todos.
      traerEstadoOperador(),
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

    // El encabezado ya dice «Hola, <nombre>»: repetirlo acá era el mismo texto
    // dos veces, una debajo de la otra. La tarjeta dice lo que el encabezado no:
    // la especialidad. (Si la especialidad no tiene etiqueta, vuelve al saludo.)
    const claveArea = "area." + (MEDICO_TIPO_ESPECIALIDAD || "medicina_general");
    const etiquetaArea = t(claveArea) === claveArea ? "" : t(claveArea);
    const tituloTarjeta = etiquetaArea || t("pacientes.saludo", { nombre: MEDICO_NOMBRE || "" });

    app.innerHTML = `
      ${typeof huecoAvisoEstudianteHtml === "function" ? huecoAvisoEstudianteHtml() : ""}
      <button type="button" class="card no-imprimir" id="avatarHomeBox"
        style="display:flex;align-items:center;gap:12px;text-align:left;cursor:pointer">
        <span class="avatar avatar-sm" id="avatarHomeImg" aria-hidden="true">${esc(iniciales(MEDICO_NOMBRE))}</span>
        <span>
          <span style="display:block;font-weight:600">${esc(tituloTarjeta)}</span>
          <span class="hint" style="display:block;margin-top:2px">${t("pacientes.verConfiguracion")} →</span>
        </span>
      </button>
      ${avisoOperadorHtml()}
      ${avisoSaldoHtml()}
      <div id="vencidosBox"></div>
      ${sinAsignar ? `
        <div class="card no-imprimir" style="border-color:var(--warning);cursor:pointer" id="avisoBandeja">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <div>
              <div style="font-weight:600">${t(sinAsignar > 1 ? "pacientes.bandeja.varios" : "pacientes.bandeja.uno", { n: sinAsignar })}</div>
              <div class="hint" style="margin:2px 0 0">${t("pacientes.bandeja.detalle")}</div>
            </div>
            <span style="color:var(--primary);font-weight:600">${t("pacientes.bandeja.ver")}</span>
          </div>
        </div>` : ""}
      ${tabsPacientesHtml(pendientes)}
      ${items.length === 0 ? `<div class="empty">${t("pacientes.vacio")}</div>` : `
        <input id="buscarPaciente" type="text" placeholder="${t("pacientes.buscar")}" style="margin:16px 0 12px">
        <div id="listaPacientes">
          ${items.map(p => pacienteItemHtml(p)).join("")}
        </div>
        <div class="empty" id="buscarVacio" style="display:none">${t("pacientes.buscarVacio")}</div>
      `}
    `;
    document.getElementById("avatarHomeBox").onclick = renderSeguridad;
    // Cuenta de estudiante: cuánto audio usó, cuándo vence y su racha de
    // estudio, arriba de todo.
    if (typeof pintarAvisoEstudiante === "function") pintarAvisoEstudiante();
    // Sin await, como los demás avisos del panel: si la foto tarda o no hay
    // ninguna subida, el panel se abre igual con las iniciales de siempre.
    pintarAvatarHome();
    engancharAvisoSaldo();
    engancharAvisoOperador();
    // Sin await: recorre las fichas para calcular qué se pasó, así que si
    // tarda o falla, el panel se abre igual y esto aparece cuando llega.
    // Mismo criterio que la bandeja DICOM.
    renderVencidos();
    const avisoBandeja = document.getElementById("avisoBandeja");
    if (avisoBandeja) avisoBandeja.onclick = () => renderBandejaDicom();
    document.getElementById("btnNuevoPaciente").onclick = renderNuevoPaciente;
    const btnAgenda = document.getElementById("btnAgenda");
    if (btnAgenda) btnAgenda.onclick = renderAgenda;
    const btnEstudiar = document.getElementById("btnEstudiar");
    if (btnEstudiar) btnEstudiar.onclick = () => renderEstudiar();
    document.getElementById("btnRecordatorios").onclick = renderRecordatorios;
    document.getElementById("btnVincular").onclick = renderVincular;
    document.getElementById("btnConfiguracion").onclick = renderSeguridad;
    // Solo existe para quien administra una clínica (ver clinica.js).
    const btnClinica = document.getElementById("btnClinica");
    if (btnClinica) btnClinica.onclick = renderClinica;
    const btnGanaderia = document.getElementById("btnGanaderia");
    if (btnGanaderia) btnGanaderia.onclick = renderGanaderia;
    const btnPagos = document.getElementById("btnPagos");
    if (btnPagos) btnPagos.onclick = renderPagos;
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
    if (typeof reportarError === "function") reportarError(e, "renderDashboard");
    app.innerHTML = `<div class="error">${esc(e.error || t("pacientes.error"))}</div>`;
  }
}

// Reemplaza las iniciales del saludo por la foto de perfil, si el médico
// subió una — ver traerBlobFotoPerfil en estado.js. Separada de
// renderDashboard() (y sin await ahí) para que el panel no espere a la foto
// para mostrar la lista de pacientes, que es lo que de verdad importa.
async function pintarAvatarHome() {
  const blob = await traerBlobFotoPerfil();
  if (!blob) return;
  const avatar = document.getElementById("avatarHomeImg");
  if (!avatar) return; // el médico ya navegó a otra pantalla
  avatar.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
  avatar.style.backgroundSize = "cover";
  avatar.style.backgroundPosition = "center";
  avatar.style.color = "transparent";
  avatar.textContent = "";
}

// ─── NUEVO PACIENTE ──────────────────────────────────────────────────────
function renderNuevoPaciente() {
  detenerPolling();
  const esVet = MEDICO_TIPO_ESPECIALIDAD === "veterinaria";
  const esPed = MEDICO_TIPO_ESPECIALIDAD === "pediatria";
  app.innerHTML = `
    <button class="back" id="btnBack">${t("pacientes.volver")}</button>
    <div class="card">
      <label>${esVet ? t("pacientes.nuevo.nombreMascota") : t("pacientes.nuevo.nombre")}</label>
      <input id="pNombre" type="text" placeholder="${esVet ? t("pacientes.nuevo.nombrePlaceholderVet") : t("pacientes.nuevo.nombrePlaceholder")}">
      <div id="personaAltaBox"></div>
      ${esVet ? `
      <label>${t("pacientes.nuevo.especie")}</label>
      <input id="pEspecie" type="text" placeholder="${t("pacientes.nuevo.especiePlaceholder")}">
      <label>${t("pacientes.nuevo.raza")}</label>
      <input id="pRaza" type="text" placeholder="${t("pacientes.nuevo.razaPlaceholder")}">` : ""}
      <label>${t("pacientes.nuevo.fechaNac")}${esPed ? "" : t("pacientes.nuevo.opcional")}</label>
      <input id="pFecha" type="date">
      ${esPed ? `<div class="hint" style="margin:-4px 0 8px">${t("pacientes.nuevo.avisoPercentiles")}</div>` : ""}
      <label>${t("pacientes.nuevo.sexo")}${esPed ? "" : t("pacientes.nuevo.opcional")}</label>
      <select id="pSexo">
        <option value="">${t("pacientes.nuevo.sinEspecificar")}</option>
        ${esVet ? `
        <option value="Hembra">${t("sexo.hembra")}</option>
        <option value="Macho">${t("sexo.macho")}</option>` : `
        <option value="Femenino">${t("sexo.femenino")}</option>
        <option value="Masculino">${t("sexo.masculino")}</option>
        <option value="Otro">${t("sexo.otro")}</option>`}
      </select>
      ${esVet ? `
      <label>${t("pacientes.nuevo.dueno")}</label>
      <input id="pDuenoNombre" type="text" placeholder="Ej: María Pérez">` : ""}
      ${esPed ? `
      <label>${t("pacientes.nuevo.semanasGesta")}</label>
      <input id="pSemanasGesta" type="number" min="20" max="44" step="1" inputmode="numeric" placeholder="${t("pacientes.nuevo.semanasGestaPlaceholder")}">
      <div class="hint" style="margin:-4px 0 8px">${t("pacientes.nuevo.avisoPrematuro")}</div>
      <label>${t("pacientes.nuevo.tutor")}</label>
      <input id="pTutorNombre" type="text" placeholder="Ej: María Pérez">
      <label>${t("pacientes.nuevo.parentesco")}</label>
      <input id="pTutorParentesco" type="text" placeholder="${t("pacientes.nuevo.parentescoPlaceholder")}">` : ""}
      <label>${t("pacientes.nuevo.telefono")}${esVet ? t("pacientes.nuevo.telefonoDueno") : esPed ? t("pacientes.nuevo.telefonoTutor") : ""}${t("pacientes.nuevo.opcional")}</label>
      <input id="pTelefono" type="tel" placeholder="${t("auth.telefonoPlaceholder")}">
      <label>${t("pacientes.nuevo.notas")}</label>
      <input id="pNotas" type="text" placeholder="${t("pacientes.nuevo.notasPlaceholder")}">
      <div id="pErr"></div>
      <button class="primary" id="pBtn">${t("pacientes.nuevo.guardar")}</button>
    </div>`;
  document.getElementById("btnBack").onclick = renderDashboard;
  // Mientras escribe el nombre, mira si esa persona ya viene a la clínica.
  // Es el momento en que sirve: después de crear la ficha, el duplicado ya
  // existe.
  engancharBuscadorPersonaEnAlta();
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
    if (!nombre) { errBox.innerHTML = `<div class="error">${esVet ? t("pacientes.nuevo.errNombreMascota") : t("pacientes.nuevo.errNombre")}</div>`; return; }
    try {
      const data = await api("/medico/pacientes", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ nombre, fechaNacimiento, sexo, telefono, notas, especie, raza, duenoNombre, tutorNombre, tutorParentesco, semanasGestacionAlNacer }),
      });
      // Si el médico reconoció a la persona mientras escribía, se asocia
      // ahora. Si falla, la ficha ya está creada y se puede asociar después
      // desde el Kardex — no se pierde nada.
      await vincularPersonaElegidaEnAlta(data.paciente._id);
      renderPacienteDetalle(data.paciente._id);
    } catch (e) {
      errBox.innerHTML = `<div class="error">${esc(e.error || t("pacientes.nuevo.errGuardar"))}</div>`;
    }
  };
}

// ─── DETALLE DE PACIENTE (Kardex con pestañas) ──────────────────────────
// Trae los datos UNA vez; cambiar de pestaña es instantáneo (sin red),
// para no estar yendo y viniendo cada vez que querés ver otra cosa.
async function renderPacienteDetalle(pacienteId, tabInicial) {
  detenerPolling();
  // Abrir un paciente trae todo fresco; las pestañas después reusan lo
  // reciente (apiReciente, estado.js).
  olvidarApiReciente(`/medico/pacientes/${pacienteId}/`);
  olvidarApiReciente("/medico/teleconsultas");
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>${t("kardex.cargando")}</div>`;
  try {
    const data = await api("/medico/pacientes/" + pacienteId);
    // Si el médico ya se fue a otra pantalla mientras esto viajaba, este
    // pintado llega tarde y le taparía lo que está haciendo.
    if (!seriePantallaVigente(serie)) return;
    const tabPorDefecto = MEDICO_TIPO_ESPECIALIDAD === "odontologia" ? "odontograma" : MEDICO_TIPO_ESPECIALIDAD === "oftalmologia" ? "ojos" : MEDICO_TIPO_ESPECIALIDAD === "ginecologia" ? "embarazo" : "consultas";
    const tabsDisponibles = tabsKardexPara(MEDICO_TIPO_ESPECIALIDAD);
    const tabSegura = tabInicial && tabsDisponibles[tabInicial] ? tabInicial : tabPorDefecto;
    pintarKardex(data.paciente, data.consultas || [], data.medicamentos || [], data.vacunas || [], data.mediciones || [], data.estudios || [], data.recetas || [], tabSegura);
  } catch (e) {
    if (e.status === 401) return logout();
    if (!seriePantallaVigente(serie)) return;
    if (typeof reportarError === "function") reportarError(e, "renderPacienteDetalle");
    app.innerHTML = `<div class="error">${esc(e.error || t("kardex.error"))}</div>`;
  }
}

function pintarKardex(p, consultas, medicamentos, vacunas, mediciones, estudios, recetas, tabActiva) {
  detenerPolling();
  const edad = edadDesde(p.fechaNacimiento);
  const estadoTxt = { procesando: t("kardex.estado.procesando"), completado: t("kardex.estado.completado"), error: t("kardex.estado.error") };

  const consultasCompletas = consultas.filter(c => c.estado === "completado");
  const ultima = consultas[0]; // ya viene ordenado por fecha descendente
  const ultimaConDx = consultasCompletas.find(c => c.notaClinica && (c.notaClinica.diagnostico || c.notaClinica.motivoConsulta));

  let briefHtml = "";
  if (p.briefClinicoEstado === "generando") {
    briefHtml = `<div class="card"><div class="hint">${t("kardex.brief.generando")}</div></div>`;
  } else if (p.briefClinicoEstado === "error") {
    briefHtml = `<div class="card"><div class="error">${t("kardex.brief.error")}</div></div>`;
  } else if (p.briefClinicoEstado === "completado" && p.briefClinico) {
    const b = p.briefClinico;
    briefHtml = `
      <div class="card brief-card">
        <div class="nota-titulo">${t("kardex.brief.titulo")}</div>
        ${b.estadoActual ? `<div class="nota-campo"><b>${t("kardex.brief.estadoActual")}</b> ${esc(b.estadoActual)}</div>` : ""}
        ${b.cambiosDesdeUltimaConsulta ? `<div class="nota-campo"><b>${t("kardex.brief.cambios")}</b> ${esc(b.cambiosDesdeUltimaConsulta)}</div>` : ""}
        ${(b.medicamentosActivos||[]).length ? `<div class="nota-campo"><b>${t("kardex.brief.medicamentos")}</b> ${esc(b.medicamentosActivos.join(", "))}</div>` : ""}
        ${(b.examenesPendientes||[]).length ? `<div class="nota-campo"><b>${t("kardex.brief.examenes")}</b> ${esc(b.examenesPendientes.join(", "))}</div>` : ""}
        ${(b.alertas||[]).length ? `<div class="nota-campo brief-alerta"><b>${t("kardex.brief.alertas")}</b> ${esc(b.alertas.join(", "))}</div>` : ""}
        ${(b.factoresRiesgo||[]).length ? `<div class="nota-campo"><b>${t("kardex.brief.riesgo")}</b> ${esc(b.factoresRiesgo.join(", "))}</div>` : ""}
        ${(b.preguntasSugeridas||[]).length ? `<div class="nota-campo"><b>${t("kardex.brief.preguntas")}</b> ${esc(b.preguntasSugeridas.join(" · "))}</div>` : ""}
        ${(b.diagnosticosDiferenciales||[]).length ? `<div class="nota-campo"><b>${t("kardex.brief.diferenciales")}</b> ${esc(b.diagnosticosDiferenciales.join(", "))}</div>` : ""}
        <div class="hint" style="margin-top:8px">${t("kardex.brief.aviso")}</div>
      </div>`;
  } else {
    briefHtml = `<div class="card"><div class="hint">${t("kardex.brief.vacio")}</div></div>`;
  }

  const tabPaciente = `
    <div class="card ficha-card">
      <div class="ficha-header">
        <div class="avatar avatar-sm">${esc(iniciales(p.nombre))}</div>
        <div>
          <div class="nombre" style="font-size:16px;font-weight:700">${esc(p.nombre)}</div>
          <div class="paciente-info">${edad != null ? t("pacientes.anos", { n: edad }) : t("kardex.edadNoRegistrada")}${p.sexo ? " · " + esc(p.sexo) : ""}</div>
        </div>
      </div>
      <div class="ficha-datos">
        ${MEDICO_TIPO_ESPECIALIDAD === "veterinaria" ? `
        <div class="dato-row">🐾 ${[p.especie, p.raza].filter(Boolean).map(esc).join(" · ") || t("kardex.especieNoRegistrada")}</div>
        <div class="dato-row">🧑 ${p.duenoNombre ? esc(p.duenoNombre) : t("kardex.duenoNoRegistrado")}</div>
        <div class="dato-row">📞 ${p.telefono ? esc(p.telefono) : t("kardex.noRegistrado")}</div>
        <div class="dato-row" style="border-bottom:none">📝 ${p.notas ? esc(p.notas) : t("kardex.sinNotas")}</div>` : `
        <div class="dato-row">📞 ${p.telefono ? esc(p.telefono) : t("kardex.noRegistrado")}</div>
        <div class="dato-row">🎂 ${p.fechaNacimiento ? fechaCorta(p.fechaNacimiento) : t("kardex.noRegistrada")}</div>
        ${MEDICO_MONEDA === "BRL" ? `<div class="dato-row" id="fichaCpf">🪪 ${p.cpf ? esc(p.cpf) : `<button class="link" id="btnCpf" style="width:auto;margin:0;padding:0">${t("memed.cpfFalta")}</button>`}</div>` : ""}
        <div class="dato-row" style="border-bottom:none">📝 ${p.notas ? esc(p.notas) : t("kardex.sinNotas")}</div>`}
      </div>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="stat-num">${consultas.length}</div><div class="stat-lbl">${t("kardex.stat.consultas")}</div></div>
      <div class="stat"><div class="stat-num">${ultima ? new Date(ultima.createdAt).toLocaleDateString(localeActual(), {day:"2-digit", month:"short"}) : "—"}</div><div class="stat-lbl">${t("kardex.stat.ultimaVisita")}</div></div>
    </div>

    ${briefHtml}
    ${tabMemoriaHtml(p._id)}

    ${ultimaConDx ? `
    <div class="card card-secundaria">
      <div class="seccion-titulo" style="margin-top:0">${t("kardex.ultimoDx")}</div>
      <div class="fecha" style="margin-bottom:6px">${new Date(ultimaConDx.createdAt).toLocaleDateString(localeActual())}</div>
      ${ultimaConDx.notaClinica.motivoConsulta ? `<div class="nota-campo"><b>${t("kardex.motivo")}</b> ${esc(ultimaConDx.notaClinica.motivoConsulta)}</div>` : ""}
      ${ultimaConDx.notaClinica.diagnostico ? `<div class="nota-campo"><b>${t("kardex.diagnostico")}</b> ${esc(ultimaConDx.notaClinica.diagnostico)}</div>` : ""}
    </div>` : ""}`;

  const tabConsultas = `
    <button class="secondary" id="btnNuevaConsulta">${t("kardex.nuevaConsulta")}</button>
    ${consultas.length === 0 ? `<div class="empty">${t("kardex.sinConsultas")}</div>` : ""}
    ${consultas.map(c => `
      <button type="button" class="item" data-id="${c._id}">
        <span class="top">
          <span class="fecha">${new Date(c.createdAt).toLocaleString(localeActual())}</span>
          <span class="badge badge-${c.estado}">${estadoTxt[c.estado] || c.estado}</span>
        </span>
        ${c.notaClinica && c.notaClinica.motivoConsulta ? `<span class="preview">${esc(c.notaClinica.motivoConsulta)}</span>` : ""}
        ${c.notaClinica && c.notaClinica.diagnostico ? `<span class="preview"><b>${t("kardex.dx")}</b> ${esc(c.notaClinica.diagnostico)}</span>` : ""}
      </button>`).join("")}`;

  const medActivos = medicamentos.filter(m => !m.fechaFin);
  const medPasados = medicamentos.filter(m => m.fechaFin);
  function medItemHtml(m) {
    return `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${esc(m.nombre)}</div>
          ${!m.fechaFin ? `<span class="badge badge-completado">${t("kardex.med.activo")}</span>` : `<span class="badge" style="background:var(--border);color:var(--text-muted)">${t("kardex.med.finalizado")}</span>`}
        </div>
        <div class="paciente-info">${[m.dosis, m.frecuencia].filter(Boolean).map(esc).join(" · ")}</div>
        ${m.notas ? `<div class="paciente-info">📝 ${esc(m.notas)}</div>` : ""}
        <div style="display:flex;gap:8px;margin-top:8px">
          ${!m.fechaFin ? `<button class="link" data-dar-baja="${m._id}" style="margin:0;flex:1">${t("kardex.med.darBaja")}</button>` : ""}
          <button class="link" data-borrar-med="${m._id}" style="margin:0;flex:1;color:var(--danger)">${t("kardex.med.eliminar")}</button>
        </div>
      </div>`;
  }
  const tabMedicamentos = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("kardex.med.titulo")}</div>
      <input id="medNombre" type="text" placeholder="${t("kardex.med.nombrePlaceholder")}">
      <input id="medDosis" type="text" placeholder="${t("kardex.med.dosisPlaceholder")}" style="margin-top:8px">
      <input id="medFrecuencia" type="text" placeholder="${t("kardex.med.frecPlaceholder")}" style="margin-top:8px">
      <button class="secondary" id="btnAgregarMed">${t("kardex.agregar")}</button>
    </div>
    ${medActivos.length ? `<div class="seccion-titulo">${t("kardex.med.activos")}</div>${medActivos.map(medItemHtml).join("")}` : ""}
    ${medPasados.length ? `<div class="seccion-titulo">${t("kardex.med.pasados")}</div>${medPasados.map(medItemHtml).join("")}` : ""}
    ${medicamentos.length === 0 ? `<div class="empty">${t("kardex.med.vacio")}</div>` : ""}`;

  const tabAntecedentes = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("kardex.ant.personales")}</div>
      ${(p.antecedentesPersonales||[]).map((a,i) => `
        <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center">
          <span>${esc(a)}</span>
          <button class="link" data-borrar-antp="${i}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>`).join("")}
      ${(p.antecedentesPersonales||[]).length === 0 ? `<div class="hint">${t("kardex.ant.sinPersonales")}</div>` : ""}
      <input id="antpNuevo" type="text" placeholder="${t("kardex.ant.personalPlaceholder")}" style="margin-top:10px">
      <button class="secondary" id="btnAgregarAntP">${t("kardex.agregar")}</button>
    </div>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("kardex.ant.familiares")}</div>
      ${(p.antecedentesFamiliares||[]).map((a,i) => `
        <div class="dato-row" style="display:flex;justify-content:space-between;align-items:center">
          <span><b>${esc(a.parentesco)}:</b> ${esc(a.condicion)}</span>
          <button class="link" data-borrar-antf="${i}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>`).join("")}
      ${(p.antecedentesFamiliares||[]).length === 0 ? `<div class="hint">${t("kardex.ant.sinFamiliares")}</div>` : ""}
      <input id="antfParentesco" type="text" placeholder="${t("kardex.ant.parentescoPlaceholder")}" style="margin-top:10px">
      <input id="antfCondicion" type="text" placeholder="${t("kardex.ant.condicionPlaceholder")}" style="margin-top:8px">
      <button class="secondary" id="btnAgregarAntF">${t("kardex.agregar")}</button>
    </div>`;

  const tabVacunas = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("kardex.vac.titulo")}</div>
      <input id="vacNombre" type="text" placeholder="${t("kardex.vac.nombrePlaceholder")}">
      <input id="vacDosis" type="text" placeholder="${t("kardex.vac.dosisPlaceholder")}" style="margin-top:8px">
      <label>${t("kardex.vac.fecha")}</label>
      <input id="vacFecha" type="date">
      <button class="secondary" id="btnAgregarVac">${t("kardex.agregar")}</button>
    </div>
    ${vacunas.length === 0 ? `<div class="empty">${t("kardex.vac.vacio")}</div>` : ""}
    ${vacunas.map(v => `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${esc(v.nombre)}${v.dosis ? " — " + esc(v.dosis) : ""}</div>
          <button class="link" data-borrar-vac="${v._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${fechaCorta(v.fecha)}</div>
      </div>`).join("")}`;

  const tabsKardex = tabsKardexPara(MEDICO_TIPO_ESPECIALIDAD);
  const tabs = { paciente: tabPaciente, consultas: tabConsultas, odontograma: `<div id="odontogramaBox"></div>`, ojos: `<div id="examenOcularBox"></div>`, mapaGineco: `<div id="mapaGinecoBox"></div>`, mapaCorporal: `<div id="mapaCorporalBox"></div>`, perfilNeuro: `<div id="perfilNeuroBox"></div>`, objetivos: MEDICO_TIPO_ESPECIALIDAD === "fisioterapia" ? `<div id="objetivosFisioBox"></div>` : `<div id="objetivosNeuroBox"></div>`, evaluacion: `<div id="fisioEvaluacionBox"></div>`, movilidad: `<div id="fisioMovilidadBox"></div>`, salud: `<div id="vigilanciaBox"></div>`, familia: `<div id="informesFamiliaBox"></div>`, instrumentos: `<div id="instrumentosBox"></div>`, informes: `<div id="informesBox"></div>`, plan: `<div id="planBox"></div>`, embarazo: `<div id="embarazoBox"></div>`, medicamentos: tabMedicamentos, antecedentes: tabAntecedentes, vacunas: tabVacunas, evolucion: tabEvolucionHtml(mediciones), crecimiento: tabCrecimientoHtml(p, mediciones), estudios: tabEstudiosHtml(estudios), recetas: tabRecetasHtml(recetas) };

  app.innerHTML = `
    <button class="back" id="btnBack">${t("kardex.volver")}</button>
    <div class="kardex-cabecera">
      <div class="nombre" style="font-size:18px;font-weight:700">${esc(p.nombre)}</div>
      <button class="secondary kardex-pdf" id="btnKardexPdf">${t("kardex.pdf.boton")}</button>
    </div>
    ${bloquePersonaHtml()}
    <div class="tabs" role="tablist" aria-label="${esc(t("kardex.seccionesAria"))}">
      ${Object.entries(tabsKardex).map(([key, et]) => `
        <button class="tab ${tabActiva === key ? "activo" : ""}" data-tab="${key}"
                role="tab" id="tab-${key}" aria-controls="tabContent"
                aria-selected="${tabActiva === key}" tabindex="${tabActiva === key ? "0" : "-1"}">
          <span class="tab-icono" aria-hidden="true">${et.icono}</span>${et.label}
        </button>`).join("")}
    </div>
    <div id="tabContent" role="tabpanel" aria-labelledby="tab-${tabActiva}" tabindex="0">${tabs[tabActiva] || tabConsultas}</div>

    ${typeof esCuentaEstudiante === "function" && esCuentaEstudiante() ? "" : `<details class="kardex-mas">
      <summary>${esc(t("kardex.masAcciones"))}</summary>
      <div class="kardex-mas-cuerpo">
        ${typeof bloquePersonaAccionesHtml === "function" ? bloquePersonaAccionesHtml() : ""}
        ${typeof teleMedCajaHtml === "function" ? teleMedCajaHtml() : ""}
        ${typeof compartirResumenCajaHtml === "function" ? compartirResumenCajaHtml() : ""}
      </div>
    </details>`}
  `;

  document.getElementById("btnBack").onclick = renderDashboard;
  // El Kardex en PDF lo arma el servidor (routes/kardexPdf.js), con la zona
  // horaria de este aparato para que la hora de cada consulta sea la que vio.
  document.getElementById("btnKardexPdf").onclick = (ev) => {
    let zona = "";
    try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* sin zona: la del país */ }
    descargarArchivo(`/medico/pacientes/${p._id}/kardex.pdf?tz=${encodeURIComponent(zona)}`, ev.currentTarget, {
      preparando: t("kardex.pdf.preparando"),
      error: t("kardex.pdf.error"),
      nombrePorDefecto: "kardex.pdf",
    });
  };
  // Aparte y sin await: si el proveedor de video tarda en contestar, la
  // ficha del paciente tiene que estar en pantalla igual.
  // Teleconsulta y resumen compartido le llegan al paciente: no en una cuenta
  // de estudiante (public/js/estudiantes.js).
  const estudiante = typeof esCuentaEstudiante === "function" && esCuentaEstudiante();
  if (!estudiante && typeof teleMedPintar === "function") teleMedPintar(p._id, p.telefono);
  // Mismo criterio: pide la lista de lo ya compartido, y si tarda o falla la
  // ficha se abre igual.
  if (!estudiante && typeof compartirResumenPintar === "function") compartirResumenPintar(p._id);
  if (typeof memedCablearCpf === "function") memedCablearCpf(p);
  // Sin await: si la consulta de la clínica tarda o falla, la ficha se abre
  // igual. El bloque aparece cuando llega.
  cargarBloquePersona(p);

  // ═══ LAS PESTAÑAS, CON TECLADO ═══════════════════════════════════════════
  //
  // Declarar role="tablist" obliga a que funcionen las flechas: un lector de
  // pantalla le anuncia al usuario "pestaña 3 de 12" y que se mueve con las
  // flechas, y si no se mueven queda peor que sin la semántica — prometido y
  // no cumplido.
  //
  // Es el patrón de tabindex rodante: solo la pestaña activa es alcanzable
  // con Tab, y adentro del grupo se navega con flechas. Así Tab no obliga a
  // pasar por las doce pestañas para llegar al contenido.
  const irATab = (clave, porTeclado) => {
    kardexFocoEnTabs = !!porTeclado;
    pintarKardex(p, consultas, medicamentos, vacunas, mediciones, estudios, recetas, clave);
  };

  const pestanas = [...document.querySelectorAll(".tab")];
  pestanas.forEach((btn, i) => {
    btn.onclick = () => irATab(btn.dataset.tab);
    btn.onkeydown = (e) => {
      const salto = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      let destino = null;
      if (salto) {
        // Da la vuelta en las dos puntas, que es lo que espera quien navega
        // así y lo que dice el patrón de ARIA.
        destino = pestanas[(i + salto + pestanas.length) % pestanas.length];
      } else if (e.key === "Home") destino = pestanas[0];
      else if (e.key === "End") destino = pestanas[pestanas.length - 1];
      if (!destino) return;
      e.preventDefault();
      irATab(destino.dataset.tab, true);
    };
  });

  // Al cambiar de pestaña con el teclado se repinta todo, y con eso se pierde
  // el foco. Se devuelve a la pestaña activa para que la siguiente flecha
  // siga funcionando; sin esto, la primera flecha anda y la segunda no.
  if (kardexFocoEnTabs) {
    document.getElementById(`tab-${tabActiva}`)?.focus();
    kardexFocoEnTabs = false;
  }

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

  // "objetivos" es la única pestaña que comparten dos especialidades con
  // pantallas distintas. Neuro y fisio miden lo mismo —sesión a sesión,
  // bajando la ayuda— pero contra modelos separados (ver db/models.js), así
  // que la que se dibuja depende de quién esté mirando.
  if (tabActiva === "objetivos") {
    if (MEDICO_TIPO_ESPECIALIDAD === "fisioterapia") renderTabObjetivosFisio(p._id);
    else renderTabObjetivosNeuro(p._id);
  }

  if (tabActiva === "evaluacion") {
    renderTabFisioEvaluacion(p._id);
  }

  if (tabActiva === "movilidad") {
    renderTabFisioMovilidad(p._id);
  }

  if (tabActiva === "salud") {
    renderTabVigilancia(p._id);
  }

  if (tabActiva === "familia") {
    renderTabInformesFamilia(p._id);
  }

  if (tabActiva === "instrumentos") {
    renderTabInstrumentos(p._id);
  }

  if (tabActiva === "informes") {
    renderTabInformes(p._id);
  }

  if (tabActiva === "consultas") {
    document.getElementById("btnNuevaConsulta").onclick = () => renderNuevaConsulta(p._id, p.nombre);
    document.querySelectorAll('#tabContent .item[data-id]').forEach(el => {
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
        if (!confirm(t("kardex.med.confirmarBorrar"))) return;
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
        if (!confirm(t("kardex.vac.confirmarBorrar"))) return;
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
