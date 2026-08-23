// ═══════════════════════════════════════════════════════════════════════════
// Vitalis — Informes con membrete
// ═══════════════════════════════════════════════════════════════════════════
// Tres pantallas:
//   · Lista de informes del paciente
//   · Editor: datos del paciente ya puestos, selección de imágenes, y el
//     texto del informe. El visor de imágenes se abre encima, con sus
//     herramientas de medición, sin perder lo escrito.
//   · Hoja membretada: lo que se imprime, se guarda como PDF y ve el
//     paciente.
//
// Una decisión que atraviesa todo: un informe FIRMADO no se edita más. Ya
// salió del consultorio y puede estar en manos de otro médico; corregirlo
// por atrás sería reescribir un documento que alguien ya leyó.

let informeActual = null;

function estadoInformeHtml(i) {
  return i.estado === "firmado"
    ? `<span style="color:var(--success);font-weight:600">✅ Firmado</span>`
    : `<span style="color:var(--warning);font-weight:600">✏️ Borrador</span>`;
}

// ─── LISTA ────────────────────────────────────────────────────────────────
async function renderTabInformes(pacienteId) {
  const caja = document.getElementById("informesBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando informes...</div>`;
  let data;
  try {
    data = await api(`/medico/pacientes/${pacienteId}/informes`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudieron cargar")}</div>`;
    return;
  }
  const informes = data.informes || [];

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nuevo informe</div>
      <input id="infTitulo" type="text" placeholder="Ej: Radiografía periapical — molar 36">
      <label>Fecha del estudio</label>
      <input id="infFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <div id="infErr"></div>
      <button class="secondary" id="btnNuevoInforme">➕ Crear informe</button>
      <button class="link" id="btnMembrete" style="width:auto">Configurar membrete y firma</button>
    </div>

    ${informes.length === 0 ? `<div class="empty">Todavía no hay informes de este paciente.</div>` : ""}
    ${informes.map(i => `
      <div class="item" data-abrir-informe="${i._id}">
        <div class="top">
          <div class="nombre">${esc(i.codigo)} — ${esc(i.titulo || i.tipoEstudio || "Sin título")}</div>
          ${i.estado === "borrador" ? `<button class="link" data-borrar-informe="${i._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>` : ""}
        </div>
        <div class="fecha">${new Date(i.fechaEstudio).toLocaleDateString("es-BO")} · ${estadoInformeHtml(i)}</div>
        ${i.conclusion ? `<div class="paciente-info">${esc(i.conclusion.slice(0, 110))}${i.conclusion.length > 110 ? "…" : ""}</div>` : ""}
        ${i.compartidoEn ? `<div class="paciente-info">📤 Enviado al paciente${i.vistoEn ? ` · 👁️ lo abrió el ${new Date(i.vistoEn).toLocaleDateString("es-BO")}` : " · todavía no lo abrió"}</div>` : ""}
      </div>`).join("")}`;

  caja.querySelector("#btnMembrete").onclick = () => renderMembrete(pacienteId);

  caja.querySelector("#btnNuevoInforme").onclick = async () => {
    const btn = caja.querySelector("#btnNuevoInforme");
    btn.disabled = true;
    try {
      const r = await api(`/medico/pacientes/${pacienteId}/informes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: caja.querySelector("#infTitulo").value.trim(),
          fechaEstudio: caja.querySelector("#infFecha").value,
        }),
      });
      renderEditorInforme(pacienteId, r.informe._id);
    } catch (e) {
      btn.disabled = false;
      caja.querySelector("#infErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo crear")}</div>`;
    }
  };

  caja.querySelectorAll("[data-abrir-informe]").forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.closest("[data-borrar-informe]")) return;
      renderEditorInforme(pacienteId, el.dataset.abrirInforme);
    };
  });
  caja.querySelectorAll("[data-borrar-informe]").forEach(b => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("¿Borrar este borrador?")) return;
      try {
        await api(`/medico/informes/${b.dataset.borrarInforme}`, { method: "DELETE" });
        renderTabInformes(pacienteId);
      } catch (e) { alert(e.error || "No se pudo borrar"); }
    };
  });
}

// ─── EDITOR ───────────────────────────────────────────────────────────────
async function renderEditorInforme(pacienteId, informeId) {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Abriendo informe...</div>`;
  let datos, ficha;
  try {
    [datos, ficha] = await Promise.all([
      api(`/medico/informes/${informeId}/completo`),
      api(`/medico/pacientes/${pacienteId}`),
    ]);
  } catch (e) {
    if (seriePantallaVigente(serie)) app.innerHTML = `<div class="error">${esc(e.error || "No se pudo abrir")}</div>`;
    return;
  }
  if (!seriePantallaVigente(serie)) return;

  informeActual = { pacienteId, informeId, datos, estudios: ficha.estudios || [] };
  pintarEditorInforme();
}

function pintarEditorInforme() {
  const { pacienteId, informeId, datos } = informeActual;
  const i = datos.informe;
  const p = datos.paciente || {};
  const firmado = i.estado === "firmado";
  // Solo imágenes: un PDF de laboratorio no se puede incrustar en la hoja.
  const imagenes = informeActual.estudios.filter(e => String(e.archivoMime || "").startsWith("image/"));
  const incluidos = new Set((i.estudiosIncluidos || []).map(String));

  app.innerHTML = `
    <button class="back" id="btnBack">← Informes</button>

    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">${esc(i.codigo)} · ${estadoInformeHtml(i)}</div>
      <div class="hint">
        <b>${esc(p.nombre || "")}</b>${p.codigo ? ` · ${esc(p.codigo)}` : ""}${p.edad != null ? ` · ${p.edad} años` : ""}${p.sexo ? ` · ${esc(p.sexo)}` : ""}
        <br>Médico tratante: ${esc(datos.membrete.profesionalNombre || MEDICO_NOMBRE || "")}
      </div>
      ${firmado ? `
        <div class="hint" style="color:var(--success);margin-top:8px">
          Firmado el ${new Date(i.firmadoEn).toLocaleString("es-BO")}. Un informe firmado no se edita:
          si tiene un error, se hace uno nuevo que lo corrija.
        </div>` : ""}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Imágenes del informe</div>
      ${imagenes.length === 0 ? `<div class="hint">Este paciente no tiene imágenes cargadas todavía. Subilas desde la pestaña Estudios.</div>` : `
        <div class="hint" style="margin-bottom:10px">
          Elegí cuáles van en el informe. Las que no elijas quedan en la ficha del paciente
          igual — no se borran, solo no salen impresas.
        </div>
        <div id="infImagenes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px">
          ${imagenes.map(e => `
            <div data-imagen="${e._id}" style="position:relative;cursor:pointer;border:2px solid ${incluidos.has(String(e._id)) ? "var(--primary)" : "transparent"};border-radius:8px;overflow:hidden;background:var(--bg)">
              <img data-mini="${e._id}" alt="${esc(e.nombre)}" style="width:100%;height:78px;object-fit:cover;display:block;opacity:${incluidos.has(String(e._id)) ? 1 : 0.45}">
              <div style="position:absolute;top:3px;right:3px;font-size:15px">${incluidos.has(String(e._id)) ? "✅" : "⬜"}</div>
              <div style="font-size:10px;padding:3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.nombre)}</div>
              <button class="link" data-ver-imagen="${e._id}" style="width:100%;margin:0;padding:3px;font-size:11px">🔍 Abrir y medir</button>
            </div>`).join("")}
        </div>`}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Informe</div>
      <label>Título</label>
      <input id="edTitulo" type="text" value="${esc(i.titulo || "")}"${firmado ? " disabled" : ""}>
      <label>Técnica</label>
      <textarea id="edTecnica" rows="2" placeholder="Ej: Radiografía periapical, técnica de paralelismo."${firmado ? " disabled" : ""}>${esc(i.tecnica || "")}</textarea>
      <label>Hallazgos</label>
      <textarea id="edHallazgos" rows="6" placeholder="Lo que se observa."${firmado ? " disabled" : ""}>${esc(i.hallazgos || "")}</textarea>
      <label>Conclusión</label>
      <textarea id="edConclusion" rows="3" placeholder="El diagnóstico. Es lo único obligatorio para firmar."${firmado ? " disabled" : ""}>${esc(i.conclusion || "")}</textarea>
      <label>Recomendaciones</label>
      <textarea id="edRecomendaciones" rows="2"${firmado ? " disabled" : ""}>${esc(i.recomendaciones || "")}</textarea>
      <div id="edErr"></div>
      ${firmado ? "" : `
        <button class="secondary" id="btnGuardarInforme">Guardar borrador</button>
        <button class="primary" id="btnFirmar">🔒 Firmar informe</button>`}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Entregar</div>
      ${firmado ? `
        <button class="secondary" id="btnVerHoja">📄 Ver hoja membretada e imprimir</button>
        <button class="secondary" id="btnEnviarWA">📲 Enviar al paciente por WhatsApp</button>
        <button class="link" id="btnCopiarEnlace" style="width:auto">Copiar el enlace</button>
        <div id="edEnvioErr"></div>
      ` : `<div class="hint">Firmá el informe para poder imprimirlo o enviarlo.</div>
           <button class="secondary" id="btnVerHoja">👁️ Ver cómo va a quedar</button>`}
    </div>`;

  document.getElementById("btnBack").onclick = () => renderPacienteDetalle(pacienteId, "informes");

  // Las miniaturas se traen con Authorization por header, así que no se
  // pueden poner como src directo: van como blob local.
  imagenes.forEach(async (e) => {
    const el = document.querySelector(`[data-mini="${e._id}"]`);
    if (!el) return;
    try {
      const blob = await traerBlobEstudio(e._id);
      if (blob && el.isConnected) el.src = URL.createObjectURL(blob);
    } catch { /* si una miniatura no carga, el resto sigue andando */ }
  });

  document.querySelectorAll("[data-imagen]").forEach(el => {
    el.onclick = async (ev) => {
      if (ev.target.closest("[data-ver-imagen]")) return;
      if (firmado) return;
      const id = el.dataset.imagen;
      const lista = new Set((informeActual.datos.informe.estudiosIncluidos || []).map(String));
      lista.has(id) ? lista.delete(id) : lista.add(id);
      informeActual.datos.informe.estudiosIncluidos = [...lista];
      await guardarInforme({ silencioso: true });
      pintarEditorInforme();
    };
  });

  document.querySelectorAll("[data-ver-imagen]").forEach(b => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const e = informeActual.estudios.find(x => String(x._id) === b.dataset.verImagen);
      // El visor se abre ENCIMA del editor: lo escrito no se pierde, que es
      // justo lo que uno necesita mientras dicta el diagnóstico mirando la
      // placa.
      if (e) abrirVisorImagen(e._id, e);
    };
  });

  if (!firmado) {
    document.getElementById("btnGuardarInforme").onclick = () => guardarInforme({});
    document.getElementById("btnFirmar").onclick = firmarInforme;
  }
  const verHoja = document.getElementById("btnVerHoja");
  if (verHoja) verHoja.onclick = async () => { await guardarInforme({ silencioso: true, siFirmadoIgnorar: true }); abrirHojaInforme(informeId); };

  const enviar = document.getElementById("btnEnviarWA");
  if (enviar) enviar.onclick = enviarInformeWhatsApp;
  const copiar = document.getElementById("btnCopiarEnlace");
  if (copiar) copiar.onclick = async () => {
    try { await navigator.clipboard.writeText(informeActual.datos.enlace); copiar.textContent = "✅ Copiado"; }
    catch { prompt("Copiá el enlace:", informeActual.datos.enlace); }
  };
}

async function guardarInforme({ silencioso = false, siFirmadoIgnorar = false } = {}) {
  const { informeId, datos } = informeActual;
  if (datos.informe.estado === "firmado") { if (siFirmadoIgnorar) return; }

  const val = (id) => document.getElementById(id)?.value ?? "";
  const cuerpo = {
    titulo: val("edTitulo"), tecnica: val("edTecnica"), hallazgos: val("edHallazgos"),
    conclusion: val("edConclusion"), recomendaciones: val("edRecomendaciones"),
    estudiosIncluidos: datos.informe.estudiosIncluidos || [],
  };
  try {
    const r = await api(`/medico/informes/${informeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    informeActual.datos.informe = r.informe;
    if (!silencioso) {
      const btn = document.getElementById("btnGuardarInforme");
      if (btn) { btn.textContent = "✅ Guardado"; setTimeout(() => { if (btn.isConnected) btn.textContent = "Guardar borrador"; }, 2000); }
    }
  } catch (e) {
    const caja = document.getElementById("edErr");
    if (caja) caja.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    throw e;
  }
}

async function firmarInforme() {
  if (!document.getElementById("edConclusion").value.trim()) {
    document.getElementById("edErr").innerHTML = `<div class="error">Escribí la conclusión antes de firmar.</div>`;
    return;
  }
  if (!confirm("Al firmar, el informe queda cerrado y no se puede editar más.\n\n¿Confirmás que está listo?")) return;

  const btn = document.getElementById("btnFirmar");
  btn.disabled = true;
  try {
    await guardarInforme({ silencioso: true });
    const r = await api(`/medico/informes/${informeActual.informeId}/firmar`, { method: "POST" });
    informeActual.datos.informe = r.informe;
    informeActual.datos.enlace = r.enlace;
    pintarEditorInforme();
  } catch (e) {
    btn.disabled = false;
    document.getElementById("edErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo firmar")}</div>`;
  }
}

async function enviarInformeWhatsApp() {
  const p = informeActual.datos.paciente || {};
  if (!confirm(`¿Enviar el informe a ${p.nombre || "el paciente"}?\n\nRecibe un enlace, no el informe adentro del mensaje.`)) return;
  const btn = document.getElementById("btnEnviarWA");
  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    await api(`/medico/informes/${informeActual.informeId}/enviar`, { method: "POST" });
    btn.textContent = "✅ Enviado";
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "📲 Enviar al paciente por WhatsApp";
    document.getElementById("edEnvioErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo enviar")}</div>`;
  }
}

// ═══ LA HOJA MEMBRETADA ═══════════════════════════════════════════════════
// Se abre como una capa a pantalla completa, no como pestaña nueva: las
// imágenes viajan con Authorization por header y en una pestaña aparte no
// se podrían mostrar. Y al imprimir, `.no-imprimir` deja fuera todo lo que
// no es la hoja (ver estilos.css).

function hojaInformeHtml(d, urlsImagenes) {
  const i = d.informe, p = d.paciente || {}, m = d.membrete || {};
  const fecha = (f) => f ? new Date(f).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

  const bloque = (titulo, texto) => texto && texto.trim()
    ? `<div class="inf-bloque"><h3>${esc(titulo)}</h3><p>${esc(texto).replace(/\n/g, "<br>")}</p></div>` : "";

  return `
    <div class="inf-hoja">
      <header class="inf-cabecera">
        ${m.logo ? `<img src="${m.logo}" alt="" class="inf-logo">` : ""}
        <div class="inf-centro">
          <div class="inf-nombre-centro">${esc(m.nombreCentro || "")}</div>
          <div class="inf-datos-centro">
            ${[m.direccion, m.ciudad].filter(Boolean).map(esc).join(" · ")}
            ${m.telefono ? `<br>Tel. ${esc(m.telefono)}` : ""}
          </div>
        </div>
      </header>

      <div class="inf-titulo">${esc(i.titulo || i.tipoEstudio || "Informe")}</div>

      <table class="inf-datos">
        <tr>
          <td><b>Paciente</b><br>${esc(p.nombre || "")}</td>
          <td><b>Código</b><br>${esc(p.codigo || "—")}</td>
        </tr>
        <tr>
          <td><b>Edad</b><br>${p.edad != null ? p.edad + " años" : "—"}${p.sexo ? " · " + esc(p.sexo) : ""}</td>
          <td><b>Fecha del estudio</b><br>${fecha(i.fechaEstudio)}</td>
        </tr>
        <tr>
          <td><b>Médico tratante</b><br>${esc(m.profesionalNombre || "")}</td>
          <td><b>Informe N.º</b><br>${esc(i.codigo)}</td>
        </tr>
      </table>

      ${bloque("Técnica", i.tecnica)}
      ${bloque("Hallazgos", i.hallazgos)}
      ${bloque("Conclusión", i.conclusion)}
      ${bloque("Recomendaciones", i.recomendaciones)}

      ${urlsImagenes.length ? `
        <div class="inf-bloque">
          <h3>Imágenes</h3>
          <div class="inf-imagenes">
            ${urlsImagenes.map(u => `
              <figure>
                <img src="${u.url}" alt="${esc(u.nombre)}" style="${filtroDeAjustes(u.ajustes)}">
                <figcaption>${esc(u.nombre)}</figcaption>
              </figure>`).join("")}
          </div>
        </div>` : ""}

      <div class="inf-firma">
        ${m.firma ? `<img src="${m.firma}" alt="">` : `<div style="height:46px"></div>`}
        <div class="inf-linea"></div>
        <div class="inf-profesional">
          ${esc(m.profesionalNombre || "")}<br>
          ${esc(m.profesionalTitulo || "")}${m.profesionalRegistro ? `<br>Reg. ${esc(m.profesionalRegistro)}` : ""}
        </div>
        ${i.firmadoEn ? `<div class="inf-pie-firma">Firmado el ${new Date(i.firmadoEn).toLocaleString("es-BO")}</div>` : ""}
      </div>

      <footer class="inf-pie">
        ${esc(m.piePagina || "")}
        ${d.enlace ? `<div class="inf-verificacion">
          Informe ${esc(i.codigo)} · verificable en ${esc((d.enlace || "").replace(/^https?:\/\//, ""))}
        </div>` : ""}
      </footer>
    </div>`;
}

// Las imágenes salen impresas como el médico las dejó en el visor: si
// ajustó el contraste para ver una fractura, eso es parte de lo que está
// informando. El archivo original sigue intacto.
function filtroDeAjustes(a) {
  if (!a) return "";
  const partes = [];
  if (a.brillo && a.brillo !== 100) partes.push(`brightness(${a.brillo}%)`);
  if (a.contraste && a.contraste !== 100) partes.push(`contrast(${a.contraste}%)`);
  if (a.invertido) partes.push("invert(1)");
  const giro = [];
  if (a.rotacion) giro.push(`rotate(${a.rotacion}deg)`);
  if (a.espejo) giro.push("scaleX(-1)");
  return `${partes.length ? `filter:${partes.join(" ")};` : ""}${giro.length ? `transform:${giro.join(" ")};` : ""}`;
}

async function abrirHojaInforme(informeId) {
  const capa = document.createElement("div");
  capa.id = "hojaInforme";
  capa.style.cssText = "position:fixed;inset:0;z-index:9500;background:#3a3a42;overflow:auto";
  capa.innerHTML = `<div class="loading" style="margin:60px auto;color:#eee"><div class="spinner"></div>Armando el informe...</div>`;
  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";

  let d;
  try {
    d = await api(`/medico/informes/${informeId}/completo`);
  } catch (e) {
    capa.innerHTML = `<div style="color:#eee;text-align:center;margin-top:60px">${esc(e.error || "No se pudo abrir")}<br><br><button class="secondary" onclick="cerrarHojaInforme()">Cerrar</button></div>`;
    return;
  }

  // Las imágenes se bajan como blob (van con Authorization) y recién ahí se
  // pueden poner en la hoja.
  const urls = [];
  for (const e of d.estudios) {
    try {
      const blob = await traerBlobEstudio(e._id);
      if (blob) urls.push({ url: URL.createObjectURL(blob), nombre: e.nombre, ajustes: e.ajustesVisor });
    } catch { /* una imagen que falla no puede tumbar el informe entero */ }
  }

  capa.innerHTML = `
    <div class="inf-barra no-imprimir">
      <button class="visor-btn" id="hojaCerrar">✕ Cerrar</button>
      <button class="visor-btn" id="hojaImprimir" style="background:var(--primary);color:#fff">🖨️ Imprimir / Guardar PDF</button>
    </div>
    ${hojaInformeHtml(d, urls)}`;

  document.getElementById("hojaCerrar").onclick = cerrarHojaInforme;
  document.getElementById("hojaImprimir").onclick = () => window.print();
}

function cerrarHojaInforme() {
  const c = document.getElementById("hojaInforme");
  if (c) {
    c.querySelectorAll("img[src^='blob:']").forEach(img => URL.revokeObjectURL(img.src));
    c.remove();
  }
  document.body.style.overflow = "";
}

// ═══ MEMBRETE ═════════════════════════════════════════════════════════════
async function renderMembrete(volverAPaciente) {
  detenerPolling();
  const serie = nuevaSeriePantalla();
  app.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  let m;
  try {
    m = (await api("/medico/membrete")).membrete;
  } catch (e) {
    if (seriePantallaVigente(serie)) app.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar")}</div>`;
    return;
  }
  if (!seriePantallaVigente(serie)) return;

  const campo = (id, etiqueta, valor, ph = "") =>
    `<label>${etiqueta}</label><input id="${id}" type="text" value="${esc(valor || "")}" placeholder="${esc(ph)}">`;

  app.innerHTML = `
    <button class="back" id="btnBack">← Volver</button>
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Membrete del centro</div>
      <div class="hint" style="margin-bottom:10px">Esto es lo que aparece arriba de cada informe impreso.</div>
      ${campo("mbCentro", "Nombre del centro", m.nombreCentro, "Ej: Centro de Imagenología Aranjuez")}
      ${campo("mbDireccion", "Dirección", m.direccion)}
      ${campo("mbCiudad", "Ciudad", m.ciudad)}
      ${campo("mbTelefono", "Teléfono", m.telefono)}
      <label>Logo</label>
      <div id="mbLogoPreview">${m.logo ? `<img src="${m.logo}" style="max-height:60px;background:#fff;padding:4px;border-radius:6px">` : `<div class="hint">Sin logo</div>`}</div>
      <label class="file-label" for="mbLogoArchivo" style="margin-top:6px">📎 Elegir logo</label>
      <input type="file" id="mbLogoArchivo" accept="image/png,image/jpeg,image/webp" style="display:none">
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Quién firma</div>
      ${campo("mbProfNombre", "Nombre del profesional", m.profesionalNombre)}
      ${campo("mbProfTitulo", "Título", m.profesionalTitulo, "Ej: Médico radiólogo")}
      ${campo("mbProfRegistro", "Matrícula / registro", m.profesionalRegistro)}
      <label>Firma</label>
      <div id="mbFirmaPreview">${m.firma ? `<img src="${m.firma}" style="max-height:60px;background:#fff;padding:4px;border-radius:6px">` : `<div class="hint">Sin firma cargada</div>`}</div>
      <label class="file-label" for="mbFirmaArchivo" style="margin-top:6px">📎 Elegir firma</label>
      <input type="file" id="mbFirmaArchivo" accept="image/png,image/jpeg,image/webp" style="display:none">
      <div class="hint" style="margin-top:6px">
        Firmá en una hoja blanca, sacale una foto y recortala. Sale mejor si el fondo es claro.
      </div>
      ${campo("mbPie", "Texto del pie de página", m.piePagina, "Ej: Este informe es un complemento del examen clínico.")}
      <div id="mbErr"></div>
      <button class="secondary" id="btnGuardarMembrete">Guardar</button>
    </div>`;

  document.getElementById("btnBack").onclick = () =>
    volverAPaciente ? renderPacienteDetalle(volverAPaciente, "informes") : renderDashboard();

  // Las imágenes se achican en el navegador ANTES de subirlas: una foto de
  // celular son 4 MB y no hace falta más de unos cientos de píxeles para un
  // logo. Además evita que el servidor la rechace por tamaño.
  for (const [inputId, previewId, campoNombre, altoMax] of
       [["mbLogoArchivo", "mbLogoPreview", "logo", 200], ["mbFirmaArchivo", "mbFirmaPreview", "firma", 160]]) {
    document.getElementById(inputId).onchange = async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const dataUri = await achicarImagen(file, altoMax);
        document.getElementById(previewId).innerHTML = `<img src="${dataUri}" style="max-height:60px;background:#fff;padding:4px;border-radius:6px">`;
        document.getElementById(previewId).dataset.valor = dataUri;
      } catch {
        document.getElementById("mbErr").innerHTML = `<div class="error">No se pudo leer esa imagen.</div>`;
      }
    };
  }

  document.getElementById("btnGuardarMembrete").onclick = async () => {
    const btn = document.getElementById("btnGuardarMembrete");
    btn.disabled = true;
    const v = (id) => document.getElementById(id).value.trim();
    const cuerpo = {
      nombreCentro: v("mbCentro"), direccion: v("mbDireccion"), ciudad: v("mbCiudad"),
      telefono: v("mbTelefono"), profesionalNombre: v("mbProfNombre"),
      profesionalTitulo: v("mbProfTitulo"), profesionalRegistro: v("mbProfRegistro"),
      piePagina: v("mbPie"),
    };
    const logo = document.getElementById("mbLogoPreview").dataset.valor;
    const firma = document.getElementById("mbFirmaPreview").dataset.valor;
    if (logo) cuerpo.logo = logo;
    if (firma) cuerpo.firma = firma;

    try {
      await api("/medico/membrete", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      btn.textContent = "✅ Guardado";
      setTimeout(() => { if (btn.isConnected) { btn.textContent = "Guardar"; btn.disabled = false; } }, 1800);
    } catch (e) {
      btn.disabled = false;
      document.getElementById("mbErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}

function achicarImagen(file, altoMax) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = reject;
    lector.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const escala = Math.min(1, altoMax / img.naturalHeight);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * escala);
        c.height = Math.round(img.naturalHeight * escala);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        // PNG y no JPEG: un logo o una firma con fondo transparente quedan
        // con un recuadro blanco si se pasan a JPEG.
        resolve(c.toDataURL("image/png"));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}
