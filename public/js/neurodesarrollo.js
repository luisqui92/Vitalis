// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Neurodesarrollo — perfil, mapa sensorial, objetivos y vigilancia
// ═══════════════════════════════════════════════════════════════════════════
// Tres pantallas dentro del Kardex:
//   · Perfil    — quién es, qué apoyos necesita, qué le gusta, y el mapa
//                 sensorial (el equivalente al odontograma de esta rama).
//   · Objetivos — metas medibles con su curva de progreso.
//   · Salud     — el calendario de controles que hay que ir a buscar.
//
// Una decisión de lenguaje que atraviesa todo el módulo: acá no se dice
// "sufre", "padece" ni "niño Down". Se dice "persona con síndrome de Down"
// y "niño autista" o "con autismo". Esta comunidad es muy sensible a las
// palabras y con razón — si el producto usa las equivocadas, la familia se
// baja en la primera pantalla por más bueno que sea todo lo demás.

const CONDICIONES_LABEL = {
  tea: "Autismo (TEA)",
  sindrome_down: "Síndrome de Down",
  tdah: "TDAH",
  discapacidad_intelectual: "Discapacidad intelectual",
  trastorno_lenguaje: "Trastorno del lenguaje",
  otra: "Otra",
};

const COMUNICACION_LABEL = {
  verbal_fluida: "Verbal fluida",
  frases: "Frases",
  palabras_sueltas: "Palabras sueltas",
  no_verbal: "No verbal",
  aumentativa: "Comunicación aumentativa",
  mixta: "Mixta",
};

// Los ocho sentidos del perfil sensorial. Los tres últimos no son los que
// se enseñan en la escuela pero son los que más explican la conducta:
// el vestibular (equilibrio y movimiento), el propioceptivo (dónde está el
// cuerpo) y el interoceptivo (hambre, sed, ganas de ir al baño, ansiedad).
const MODALIDADES_LABEL = {
  auditivo: { nombre: "Auditivo", icono: "👂", ejemplo: "ruidos fuertes, secadores de mano, multitudes" },
  tactil: { nombre: "Táctil", icono: "✋", ejemplo: "etiquetas de la ropa, texturas, que lo toquen" },
  visual: { nombre: "Visual", icono: "👁️", ejemplo: "luces fluorescentes, ambientes muy cargados" },
  vestibular: { nombre: "Vestibular", icono: "🌀", ejemplo: "hamacas, giros, subir escaleras" },
  propioceptivo: { nombre: "Propioceptivo", icono: "💪", ejemplo: "apretar, empujar, abrazos fuertes" },
  oral: { nombre: "Oral / gusto", icono: "👅", ejemplo: "texturas de comida, selectividad alimentaria" },
  olfativo: { nombre: "Olfativo", icono: "👃", ejemplo: "perfumes, comida, productos de limpieza" },
  interoceptivo: { nombre: "Interoceptivo", icono: "🫀", ejemplo: "avisar hambre, sed, ganas de baño, dolor" },
};

const RESPUESTAS_LABEL = {
  sin_datos: { texto: "Sin explorar", color: "var(--text-muted)", corto: "—" },
  tipico: { texto: "Respuesta típica", color: "var(--success)", corto: "Típico" },
  hiper: { texto: "Hiperreactivo — le resulta demasiado", color: "var(--danger)", corto: "Hiper" },
  hipo: { texto: "Hiporreactivo — le llega poco", color: "var(--primary)", corto: "Hipo" },
  busca: { texto: "Buscador — lo necesita y lo procura", color: "var(--warning)", corto: "Busca" },
  mixto: { texto: "Mixto según el contexto", color: "var(--accent)", corto: "Mixto" },
};

const AREAS_LABEL = {
  comunicacion: "Comunicación", social: "Social", autonomia: "Autonomía", motor: "Motor",
  cognitivo: "Cognitivo", conducta: "Conducta", sensorial: "Sensorial",
  academico: "Académico", familiar: "Familiar",
};

const AYUDAS_LABEL = {
  independiente: "Sin ayuda", verbal: "Ayuda verbal", gestual: "Ayuda gestual",
  fisica_parcial: "Ayuda física parcial", fisica_total: "Ayuda física total",
};

// El nivel de apoyo del DSM-5, dicho en palabras. El número solo no le
// significa nada a una familia.
const NIVELES_APOYO = {
  1: { titulo: "Nivel 1", texto: "Necesita apoyo" },
  2: { titulo: "Nivel 2", texto: "Necesita apoyo sustancial" },
  3: { titulo: "Nivel 3", texto: "Necesita apoyo muy sustancial" },
};

// ═══ PESTAÑA PERFIL ═══════════════════════════════════════════════════════
async function renderTabPerfilNeuro(pacienteId) {
  const caja = document.getElementById("perfilNeuroBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando perfil...</div>`;
  let data;
  try {
    data = await api(`/medico/pacientes/${pacienteId}/neuro`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudo cargar el perfil")}</div>`;
    return;
  }
  pintarPerfilNeuro(pacienteId, data.perfil, caja);
}

function pintarPerfilNeuro(pacienteId, perfil, caja) {
  const sensorial = MODALIDADES_SENSORIALES_ORDEN.map(m =>
    perfil.perfilSensorial.find(x => x.modalidad === m) || { modalidad: m, respuesta: "sin_datos", historial: [] });

  const explorados = sensorial.filter(m => m.respuesta !== "sin_datos").length;

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Perfil</div>
      <label>Condición</label>
      <div class="chip-row" id="neuroCondiciones">
        ${Object.entries(CONDICIONES_LABEL).map(([k, l]) => `
          <button type="button" class="chip${perfil.condiciones.includes(k) ? " activo" : ""}" data-cond="${k}">${esc(l)}</button>`).join("")}
      </div>
      <input id="neuroDetalle" type="text" placeholder="Detalle (opcional)" value="${esc(perfil.detalleCondicion || "")}" style="margin-top:8px">

      <div class="seccion-titulo">Niveles de apoyo (DSM-5)</div>
      <div class="hint" style="margin-bottom:10px">
        Son dos ejes independientes: alguien puede necesitar mucho apoyo en uno y poco en el otro.
        Por eso no hay un nivel único.
      </div>
      ${["apoyoComunicacionSocial", "apoyoConductasRestringidas"].map(campo => `
        <label>${campo === "apoyoComunicacionSocial" ? "Comunicación social" : "Conductas restringidas y repetitivas"}</label>
        <div class="chip-row" data-eje="${campo}">
          ${[1, 2, 3].map(n => `
            <button type="button" class="chip${perfil[campo] === n ? " activo" : ""}" data-nivel="${n}"
              title="${esc(NIVELES_APOYO[n].texto)}">${NIVELES_APOYO[n].titulo}</button>`).join("")}
          <button type="button" class="chip${perfil[campo] == null ? " activo" : ""}" data-nivel="">Sin definir</button>
        </div>`).join("")}

      <div class="seccion-titulo">Comunicación</div>
      <select id="neuroComunicacion">
        <option value="">— Sin especificar —</option>
        ${Object.entries(COMUNICACION_LABEL).map(([k, l]) => `
          <option value="${k}"${perfil.comunicacion === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      <input id="neuroAumentativa" type="text" placeholder="Sistema que usa (PECS, tablero, app...)" value="${esc(perfil.sistemaAumentativo || "")}" style="margin-top:8px">

      <div class="seccion-titulo">Fortalezas e intereses</div>
      <div class="hint" style="margin-bottom:8px">
        Va primero y no al final a propósito: es lo que la familia nunca ve escrito
        en un informe, y es donde se apoya todo el trabajo del equipo.
      </div>
      <input id="neuroFortalezas" type="text" placeholder="Separadas por coma: memoria visual, música..." value="${esc((perfil.fortalezas || []).join(", "))}">
      <input id="neuroIntereses" type="text" placeholder="Intereses: trenes, dinosaurios, mapas..." value="${esc((perfil.intereses || []).join(", "))}" style="margin-top:8px">

      <div id="neuroErr"></div>
      <button class="secondary" id="btnGuardarPerfilNeuro">Guardar perfil</button>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">🌈 Perfil sensorial</div>
      <div class="hint" style="margin-bottom:12px">
        Explorados ${explorados} de ${sensorial.length}. Tocá un sentido para cargar cómo responde,
        qué lo desregula y qué lo calma — es la información que más sirve en casa y en la escuela.
      </div>
      <div id="mapaSensorial">
        ${sensorial.map(m => {
          const r = RESPUESTAS_LABEL[m.respuesta] || RESPUESTAS_LABEL.sin_datos;
          return `
          <div class="item" data-modalidad="${m.modalidad}" style="border-left:4px solid ${r.color}">
            <div class="top">
              <div class="nombre">${MODALIDADES_LABEL[m.modalidad].icono} ${esc(MODALIDADES_LABEL[m.modalidad].nombre)}</div>
              <span style="color:${r.color};font-weight:600;font-size:13px">${esc(r.corto)}</span>
            </div>
            ${m.desencadenantes?.length ? `<div class="paciente-info">⚡ ${esc(m.desencadenantes.join(" · "))}</div>` : ""}
            ${m.estrategias?.length ? `<div class="paciente-info">🛟 ${esc(m.estrategias.join(" · "))}</div>` : ""}
            ${m.respuesta === "sin_datos" ? `<div class="fecha">Ej: ${esc(MODALIDADES_LABEL[m.modalidad].ejemplo)}</div>` : ""}
          </div>`;
        }).join("")}
      </div>
      <div id="detalleSensorial"></div>
    </div>`;

  // ─── Condiciones (varias a la vez: es común tener TEA y TDAH) ───────────
  caja.querySelectorAll("#neuroCondiciones [data-cond]").forEach(btn => {
    btn.onclick = () => btn.classList.toggle("activo");
  });

  caja.querySelectorAll("[data-eje]").forEach(fila => {
    fila.querySelectorAll("[data-nivel]").forEach(btn => {
      btn.onclick = () => fila.querySelectorAll("[data-nivel]").forEach(b => b.classList.toggle("activo", b === btn));
    });
  });

  caja.querySelector("#btnGuardarPerfilNeuro").onclick = async () => {
    const btn = caja.querySelector("#btnGuardarPerfilNeuro");
    btn.disabled = true;
    const nivelDe = (campo) => {
      const activo = caja.querySelector(`[data-eje="${campo}"] .chip.activo`);
      const v = activo?.dataset.nivel;
      return v ? Number(v) : null;
    };
    const lista = (id) => caja.querySelector(id).value.split(",").map(s => s.trim()).filter(Boolean);
    try {
      await api(`/medico/pacientes/${pacienteId}/neuro`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condiciones: [...caja.querySelectorAll("#neuroCondiciones .chip.activo")].map(b => b.dataset.cond),
          detalleCondicion: caja.querySelector("#neuroDetalle").value.trim(),
          apoyoComunicacionSocial: nivelDe("apoyoComunicacionSocial"),
          apoyoConductasRestringidas: nivelDe("apoyoConductasRestringidas"),
          comunicacion: caja.querySelector("#neuroComunicacion").value || null,
          sistemaAumentativo: caja.querySelector("#neuroAumentativa").value.trim(),
          fortalezas: lista("#neuroFortalezas"),
          intereses: lista("#neuroIntereses"),
        }),
      });
      renderTabPerfilNeuro(pacienteId);
    } catch (e) {
      btn.disabled = false;
      const err = caja.querySelector("#neuroErr");
      if (err) err.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };

  caja.querySelectorAll("[data-modalidad]").forEach(el => {
    el.onclick = () => abrirDetalleSensorial(pacienteId, perfil, el.dataset.modalidad, caja);
  });
}

const MODALIDADES_SENSORIALES_ORDEN = ["auditivo", "tactil", "visual", "vestibular", "propioceptivo", "oral", "olfativo", "interoceptivo"];

function abrirDetalleSensorial(pacienteId, perfil, modalidad, caja) {
  const item = perfil.perfilSensorial.find(m => m.modalidad === modalidad) || { respuesta: "sin_datos", historial: [] };
  const info = MODALIDADES_LABEL[modalidad];
  const detalle = caja.querySelector("#detalleSensorial");

  detalle.innerHTML = `
    <div class="card" style="border-color:var(--primary);margin-top:12px">
      <div class="seccion-titulo" style="margin-top:0">${info.icono} ${esc(info.nombre)}</div>
      <div class="hint" style="margin-bottom:10px">Ejemplos: ${esc(info.ejemplo)}</div>

      <label>¿Cómo responde?</label>
      <div class="chip-row" id="sensRespuesta">
        ${Object.entries(RESPUESTAS_LABEL).filter(([k]) => k !== "sin_datos").map(([k, l]) => `
          <button type="button" class="chip${item.respuesta === k ? " activo" : ""}" data-resp="${k}" title="${esc(l.texto)}">${esc(l.corto)}</button>`).join("")}
      </div>

      <label style="margin-top:10px">Qué lo desregula</label>
      <input id="sensDesencadenantes" type="text" placeholder="Separado por coma" value="${esc((item.desencadenantes || []).join(", "))}">
      <label>Qué lo calma o le ayuda</label>
      <input id="sensEstrategias" type="text" placeholder="Separado por coma" value="${esc((item.estrategias || []).join(", "))}">
      <label>Observación de hoy</label>
      <input id="sensNotas" type="text" placeholder="Opcional">

      <div id="sensErr"></div>
      <button class="secondary" id="btnGuardarSensorial">Guardar</button>

      ${item.historial?.length ? `
        <div class="seccion-titulo">Evolución</div>
        ${item.historial.slice().reverse().slice(0, 8).map(h => `
          <div class="item" style="cursor:default">
            <div class="top"><div class="nombre">${esc(RESPUESTAS_LABEL[h.respuesta]?.corto || h.respuesta)}</div></div>
            <div class="fecha">${new Date(h.fecha).toLocaleDateString("es-BO")}${h.fuente === "voz" ? " · 🎙️ desde la consulta" : ""}</div>
            ${h.notas ? `<div class="paciente-info">${esc(h.notas)}</div>` : ""}
          </div>`).join("")}` : ""}
    </div>`;
  detalle.scrollIntoView({ behavior: "smooth", block: "nearest" });

  detalle.querySelectorAll("[data-resp]").forEach(btn => {
    btn.onclick = () => detalle.querySelectorAll("[data-resp]").forEach(b => b.classList.toggle("activo", b === btn));
  });

  detalle.querySelector("#btnGuardarSensorial").onclick = async () => {
    const elegido = detalle.querySelector("#sensRespuesta .chip.activo");
    if (!elegido) {
      detalle.querySelector("#sensErr").innerHTML = `<div class="error">Elegí cómo responde.</div>`;
      return;
    }
    const btn = detalle.querySelector("#btnGuardarSensorial");
    btn.disabled = true;
    const lista = (id) => detalle.querySelector(id).value.split(",").map(s => s.trim()).filter(Boolean);
    try {
      await api(`/medico/pacientes/${pacienteId}/neuro/sensorial`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modalidad,
          respuesta: elegido.dataset.resp,
          desencadenantes: lista("#sensDesencadenantes"),
          estrategias: lista("#sensEstrategias"),
          notas: detalle.querySelector("#sensNotas").value.trim(),
        }),
      });
      renderTabPerfilNeuro(pacienteId);
    } catch (e) {
      btn.disabled = false;
      detalle.querySelector("#sensErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}

// ═══ PESTAÑA OBJETIVOS ════════════════════════════════════════════════════
// "Pedir agua señalando, sin ayuda física, 8 de 10 veces". Esto es lo que
// se pelea con la escuela y con el seguro, y hoy vive en cuadernos.
//
// Se guardan logros e intentos por separado y no un porcentaje, porque 50%
// puede ser 1 de 2 o 15 de 30, y no significan lo mismo.
async function renderTabObjetivosNeuro(pacienteId) {
  const caja = document.getElementById("objetivosNeuroBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando objetivos...</div>`;
  let data;
  try {
    data = await api(`/medico/pacientes/${pacienteId}/neuro/objetivos`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudieron cargar los objetivos")}</div>`;
    return;
  }
  pintarObjetivosNeuro(pacienteId, data.objetivos || [], caja);
}

function porcentaje(p) {
  return p.intentos > 0 ? Math.round((p.logros / p.intentos) * 100) : 0;
}

function pintarObjetivosNeuro(pacienteId, objetivos, caja) {
  const activos = objetivos.filter(o => o.estado === "activo");
  const cerrados = objetivos.filter(o => o.estado !== "activo");

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nuevo objetivo</div>
      <div class="hint" style="margin-bottom:10px">
        Escribilo observable y contable. "Que se comunique mejor" no se puede medir;
        "pedir agua señalando, sin ayuda física" sí.
      </div>
      <input id="objTitulo" type="text" placeholder="Ej: Pedir agua señalando la jarra">
      <label>Área</label>
      <select id="objArea">
        ${Object.entries(AREAS_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}
      </select>
      <label>Criterio de logro</label>
      <input id="objCriterio" type="text" placeholder="Ej: 8 de 10 oportunidades, sin ayuda física, en 3 sesiones seguidas">
      <div id="objErr"></div>
      <button class="secondary" id="btnCrearObjetivo">➕ Agregar objetivo</button>
    </div>

    ${activos.length === 0 ? `<div class="empty">Todavía no hay objetivos activos.</div>` : ""}
    ${activos.map(o => tarjetaObjetivo(o)).join("")}

    ${cerrados.length ? `
      <div class="seccion-titulo">Cerrados</div>
      ${cerrados.map(o => tarjetaObjetivo(o)).join("")}` : ""}`;

  caja.querySelector("#btnCrearObjetivo").onclick = async () => {
    const titulo = caja.querySelector("#objTitulo").value.trim();
    if (!titulo) {
      caja.querySelector("#objErr").innerHTML = `<div class="error">Ponele un título al objetivo.</div>`;
      return;
    }
    const btn = caja.querySelector("#btnCrearObjetivo");
    btn.disabled = true;
    try {
      await api(`/medico/pacientes/${pacienteId}/neuro/objetivos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          area: caja.querySelector("#objArea").value,
          criterio: caja.querySelector("#objCriterio").value.trim(),
        }),
      });
      renderTabObjetivosNeuro(pacienteId);
    } catch (e) {
      btn.disabled = false;
      caja.querySelector("#objErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo crear")}</div>`;
    }
  };

  caja.querySelectorAll("[data-obj-progreso]").forEach(btn => {
    btn.onclick = (ev) => { ev.stopPropagation(); abrirProgresoObjetivo(pacienteId, objetivos.find(o => o._id === btn.dataset.objProgreso), caja); };
  });
  caja.querySelectorAll("[data-obj-estado]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      await api(`/medico/neuro/objetivos/${btn.dataset.objEstado}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: btn.dataset.nuevoEstado }),
      });
      renderTabObjetivosNeuro(pacienteId);
    };
  });
  caja.querySelectorAll("[data-obj-borrar]").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("¿Borrar el objetivo y todo su progreso?")) return;
      await api(`/medico/neuro/objetivos/${btn.dataset.objBorrar}`, { method: "DELETE" });
      renderTabObjetivosNeuro(pacienteId);
    };
  });
}

function tarjetaObjetivo(o) {
  const prog = (o.progreso || []).slice().sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const ultimo = prog[prog.length - 1];
  const primero = prog[0];

  // La tendencia entre el primer y el último registro es lo que se muestra a
  // la familia y lo que se manda a la escuela.
  let resumen = `<div class="hint">Todavía sin registros de trabajo.</div>`;
  if (ultimo) {
    const pct = porcentaje(ultimo);
    const pctIni = porcentaje(primero);
    const delta = pct - pctIni;
    resumen = `
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:6px">
        <div style="font-size:24px;font-weight:700">${pct}%</div>
        <div class="hint" style="margin:0">${ultimo.logros} de ${ultimo.intentos} · ${esc(AYUDAS_LABEL[ultimo.ayuda] || ultimo.ayuda)}</div>
        ${prog.length > 1 ? `<div class="hint" style="margin:0;color:${delta > 0 ? "var(--success)" : delta < 0 ? "var(--warning)" : "var(--text-muted)"}">
          ${delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "= "}${delta}% desde el inicio (${pctIni}% → ${pct}%)</div>` : ""}
      </div>
      ${barraProgresoObjetivo(prog)}
      <div class="fecha">${prog.length} ${prog.length === 1 ? "registro" : "registros"} · último el ${new Date(ultimo.fecha).toLocaleDateString("es-BO")}</div>`;
  }

  return `
    <div class="item" style="cursor:default">
      <div class="top">
        <div class="nombre">${esc(o.titulo)}</div>
        <button class="link" data-obj-borrar="${o._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
      </div>
      <div class="fecha">${esc(AREAS_LABEL[o.area] || o.area)}${o.estado !== "activo" ? " · " + (o.estado === "logrado" ? "✅ Logrado" : "⏸ Suspendido") : ""}</div>
      ${o.criterio ? `<div class="paciente-info">🎯 ${esc(o.criterio)}</div>` : ""}
      ${resumen}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${o.estado === "activo" ? `
          <button class="item-action" data-obj-progreso="${o._id}" style="margin:0">➕ Registrar sesión</button>
          <button class="item-action" data-obj-estado="${o._id}" data-nuevo-estado="logrado" style="margin:0">✅ Logrado</button>
        ` : `
          <button class="item-action" data-obj-estado="${o._id}" data-nuevo-estado="activo" style="margin:0">↩ Reactivar</button>
        `}
      </div>
    </div>`;
}

// Una barra por registro, en orden. Sin librerías y sin canvas: para diez
// sesiones esto se lee mejor que un gráfico, y funciona igual en un celular
// angosto.
//
// La ALTURA es el porcentaje de logro y el COLOR es cuánta ayuda necesitó,
// del más pálido (ayuda física total) al más intenso (solo). Son dos cosas
// distintas y las dos importan: un chico puede pasar de 8 de 10 con ayuda
// física a 8 de 10 solo, y eso es un avance enorme que un gráfico de
// porcentaje mostraría como una línea plana.
const INTENSIDAD_AYUDA = {
  fisica_total: 0.18, fisica_parcial: 0.35, gestual: 0.55, verbal: 0.75, independiente: 1,
};

function barraProgresoObjetivo(prog) {
  const ultimos = prog.slice(-12);
  return `
    <div style="display:flex;align-items:flex-end;gap:3px;height:58px;margin:10px 0 4px">
      ${ultimos.map(p => {
        const pct = porcentaje(p);
        const intensidad = INTENSIDAD_AYUDA[p.ayuda] ?? 0.5;
        return `<div title="${pct}% — ${p.logros}/${p.intentos} — ${esc(AYUDAS_LABEL[p.ayuda] || "")}"
          style="flex:1;min-width:6px;height:${Math.max(8, pct)}%;border-radius:3px 3px 0 0;
          background:rgba(var(--primary-rgb),${intensidad})"></div>`;
      }).join("")}
    </div>
    <div class="hint" style="margin:0;font-size:11px">
      Alto = cuánto le sale. Color más fuerte = menos ayuda necesitó.
      Bajar la ayuda importa tanto como subir el porcentaje.
    </div>`;
}

function abrirProgresoObjetivo(pacienteId, objetivo, caja) {
  if (!objetivo) return;
  const html = `
    <div class="card" style="border-color:var(--primary)">
      <div class="seccion-titulo" style="margin-top:0">Registrar sesión</div>
      <div class="hint" style="margin-bottom:10px">${esc(objetivo.titulo)}</div>
      <label>Fecha</label>
      <input id="progFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <label>Cuántas veces se intentó</label>
      <input id="progIntentos" type="number" min="1" inputmode="numeric" placeholder="Ej: 10">
      <label>Cuántas veces salió</label>
      <input id="progLogros" type="number" min="0" inputmode="numeric" placeholder="Ej: 6">
      <label>Nivel de ayuda que necesitó</label>
      <select id="progAyuda">
        ${Object.entries(AYUDAS_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}
      </select>
      <label>Observaciones</label>
      <input id="progNotas" type="text" placeholder="Opcional">
      <div id="progErr"></div>
      <button class="secondary" id="btnGuardarProgreso">Guardar</button>
      <button class="link" id="btnCancelarProgreso" style="width:auto">Cancelar</button>
    </div>`;

  const contenedor = document.createElement("div");
  contenedor.innerHTML = html;
  caja.prepend(contenedor);
  contenedor.scrollIntoView({ behavior: "smooth", block: "nearest" });

  contenedor.querySelector("#btnCancelarProgreso").onclick = () => contenedor.remove();
  contenedor.querySelector("#btnGuardarProgreso").onclick = async () => {
    const err = contenedor.querySelector("#progErr");
    const intentos = Number(contenedor.querySelector("#progIntentos").value);
    const logros = Number(contenedor.querySelector("#progLogros").value);
    if (!Number.isFinite(intentos) || intentos <= 0) { err.innerHTML = `<div class="error">Poné cuántas veces se intentó.</div>`; return; }
    if (!Number.isFinite(logros) || logros < 0) { err.innerHTML = `<div class="error">Poné cuántas veces salió.</div>`; return; }
    if (logros > intentos) { err.innerHTML = `<div class="error">No puede haber más logros que intentos.</div>`; return; }

    const btn = contenedor.querySelector("#btnGuardarProgreso");
    btn.disabled = true;
    try {
      await api(`/medico/neuro/objetivos/${objetivo._id}/progreso`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: contenedor.querySelector("#progFecha").value,
          intentos, logros,
          ayuda: contenedor.querySelector("#progAyuda").value,
          notas: contenedor.querySelector("#progNotas").value.trim(),
        }),
      });
      renderTabObjetivosNeuro(pacienteId);
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar")}</div>`;
    }
  };
}

// ═══ PESTAÑA SALUD (vigilancia) ═══════════════════════════════════════════
// El síndrome de Down trae condiciones asociadas que NO aparecen solas: hay
// que ir a buscarlas. Si nadie lleva el calendario, se pasan años. Esta
// pantalla dice qué corresponde ahora, qué está hecho y qué está atrasado —
// el mismo patrón que la pestaña de Vacunas.
const ESTADOS_VIGILANCIA = {
  atrasado: { texto: "Atrasado", color: "var(--danger)", orden: 0, icono: "🔴" },
  pendiente: { texto: "Toca ahora", color: "var(--warning)", orden: 1, icono: "🟡" },
  al_dia: { texto: "Al día", color: "var(--success)", orden: 2, icono: "🟢" },
  futuro: { texto: "Más adelante", color: "var(--text-muted)", orden: 3, icono: "⚪" },
  no_aplica: { texto: "Ya no aplica", color: "var(--text-muted)", orden: 4, icono: "⚪" },
  sin_edad: { texto: "Falta la fecha de nacimiento", color: "var(--text-muted)", orden: 5, icono: "⚪" },
};

function edadTextoMeses(meses) {
  if (meses == null) return "";
  if (meses === 0) return "al nacer";
  if (meses < 24) return `${meses} m`;
  const a = Math.floor(meses / 12);
  const r = meses % 12;
  return r ? `${a} a ${r} m` : `${a} ${a === 1 ? "año" : "años"}`;
}

async function renderTabVigilancia(pacienteId) {
  const caja = document.getElementById("vigilanciaBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando controles...</div>`;
  let data;
  try {
    data = await api(`/medico/pacientes/${pacienteId}/neuro/vigilancia`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudieron cargar los controles")}</div>`;
    return;
  }
  pintarVigilancia(pacienteId, data, caja);
}

function pintarVigilancia(pacienteId, data, caja) {
  const items = (data.items || []).slice().sort((a, b) => {
    const ea = ESTADOS_VIGILANCIA[a.estado]?.orden ?? 9;
    const eb = ESTADOS_VIGILANCIA[b.estado]?.orden ?? 9;
    return ea - eb || (a.desdeMeses - b.desdeMeses);
  });
  const atrasados = items.filter(i => i.estado === "atrasado").length;
  const ahora = items.filter(i => i.estado === "pendiente").length;

  caja.innerHTML = `
    ${data.edadMeses == null ? `
      <div class="card"><div class="hint">
        Sin la fecha de nacimiento del paciente no se puede saber qué control corresponde a cada edad.
        Cargala en la pestaña Paciente.
      </div></div>` : ""}

    ${items.length ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">Estado</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          <div><div style="font-size:24px;font-weight:700;color:${atrasados ? "var(--danger)" : "var(--text)"}">${atrasados}</div><span class="muted hint">atrasados</span></div>
          <div><div style="font-size:24px;font-weight:700;color:${ahora ? "var(--warning)" : "var(--text)"}">${ahora}</div><span class="muted hint">tocan ahora</span></div>
          <div><div style="font-size:24px;font-weight:700">${items.length}</div><span class="muted hint">en seguimiento</span></div>
        </div>
      </div>` : ""}

    ${items.length === 0 ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">Cargar un calendario de controles</div>
        <div class="hint" style="margin-bottom:12px">
          Es un punto de partida basado en guías publicadas, <b>no un protocolo</b>. Después
          podés editar, borrar o agregar lo que corresponda: el criterio que manda es el tuyo.
        </div>
        ${(data.plantillas || []).map(p => `
          <button class="secondary" data-plantilla="${p.id}" style="margin-bottom:8px">
            ➕ ${esc(p.nombre)} (${p.cuantos} controles)
          </button>`).join("")}
      </div>` : items.map(i => tarjetaVigilancia(i)).join("")}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Agregar un control propio</div>
      <input id="vigNombre" type="text" placeholder="Ej: Control cardiológico">
      <input id="vigCategoria" type="text" placeholder="Área (ej: Cardiología)" style="margin-top:8px">
      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div><label>Desde (meses)</label><input id="vigDesde" type="number" min="0" value="0"></div>
        <div><label>Cada (meses)</label><input id="vigCada" type="number" min="1" placeholder="vacío = una vez"></div>
      </div>
      <div id="vigErr"></div>
      <button class="secondary" id="btnAgregarVigilancia">➕ Agregar</button>
      ${items.length ? `<button class="link" id="btnOtraPlantilla" style="width:auto">Cargar otro calendario</button>` : ""}
    </div>`;

  caja.querySelectorAll("[data-plantilla]").forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api(`/medico/pacientes/${pacienteId}/neuro/vigilancia/plantilla`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plantilla: btn.dataset.plantilla }),
        });
        if (r.agregados === 0) alert("Esos controles ya estaban cargados.");
        renderTabVigilancia(pacienteId);
      } catch (e) { btn.disabled = false; alert(e.error || "No se pudo cargar"); }
    };
  });

  const otra = caja.querySelector("#btnOtraPlantilla");
  if (otra) otra.onclick = () => {
    const cual = (data.plantillas || []).map(p => `${p.id} = ${p.nombre}`).join("\n");
    const elegida = prompt("¿Qué calendario querés cargar?\n\n" + cual, (data.plantillas[0] || {}).id || "");
    if (!elegida) return;
    api(`/medico/pacientes/${pacienteId}/neuro/vigilancia/plantilla`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantilla: elegida.trim() }),
    }).then(() => renderTabVigilancia(pacienteId)).catch(e => alert(e.error || "No se pudo"));
  };

  caja.querySelector("#btnAgregarVigilancia").onclick = async () => {
    const nombre = caja.querySelector("#vigNombre").value.trim();
    if (!nombre) { caja.querySelector("#vigErr").innerHTML = `<div class="error">Ponele un nombre.</div>`; return; }
    try {
      await api(`/medico/pacientes/${pacienteId}/neuro/vigilancia`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          categoria: caja.querySelector("#vigCategoria").value.trim(),
          desdeMeses: caja.querySelector("#vigDesde").value,
          cadaMeses: caja.querySelector("#vigCada").value,
        }),
      });
      renderTabVigilancia(pacienteId);
    } catch (e) { caja.querySelector("#vigErr").innerHTML = `<div class="error">${esc(e.error || "No se pudo agregar")}</div>`; }
  };

  caja.querySelectorAll("[data-vig-hecho]").forEach(btn => {
    btn.onclick = async () => {
      const resultado = prompt("Resultado (opcional):", "");
      if (resultado === null) return;
      try {
        await api(`/medico/neuro/vigilancia/${btn.dataset.vigHecho}/realizado`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultado }),
        });
        renderTabVigilancia(pacienteId);
      } catch (e) { alert(e.error || "No se pudo registrar"); }
    };
  });

  caja.querySelectorAll("[data-vig-borrar]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Sacar este control del seguimiento?")) return;
      await api(`/medico/neuro/vigilancia/${btn.dataset.vigBorrar}`, { method: "DELETE" });
      renderTabVigilancia(pacienteId);
    };
  });
}

function tarjetaVigilancia(i) {
  const e = ESTADOS_VIGILANCIA[i.estado] || ESTADOS_VIGILANCIA.futuro;
  const cuando = i.cadaMeses
    ? `desde ${edadTextoMeses(i.desdeMeses)}, cada ${i.cadaMeses} ${i.cadaMeses === 1 ? "mes" : "meses"}`
    : `${edadTextoMeses(i.desdeMeses)}${i.hastaMeses != null ? ` a ${edadTextoMeses(i.hastaMeses)}` : ""}, una vez`;
  return `
    <div class="item" style="cursor:default;border-left:4px solid ${e.color}">
      <div class="top">
        <div class="nombre">${e.icono} ${esc(i.nombre)}</div>
        <button class="link" data-vig-borrar="${i._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
      </div>
      <div class="fecha">${esc(e.texto)}${i.categoria ? " · " + esc(i.categoria) : ""} · ${esc(cuando)}</div>
      ${i.nota ? `<div class="paciente-info">${esc(i.nota)}</div>` : ""}
      ${i.ultimo ? `<div class="paciente-info">✅ Último: ${new Date(i.ultimo.fecha).toLocaleDateString("es-BO")}${i.ultimo.resultado ? " — " + esc(i.ultimo.resultado) : ""}</div>` : ""}
      ${["pendiente", "atrasado", "al_dia"].includes(i.estado)
        ? `<button class="item-action" data-vig-hecho="${i._id}" style="margin-top:10px">✅ Registrar que se hizo</button>` : ""}
    </div>`;
}

// ═══ EL INFORME DE AVANCE PARA LA FAMILIA ══════════════════════════════════
//
// Del otro lado de esta pantalla hay una madre. El porqué completo está en
// services/informeFamilia.js; acá importa lo que decide la interfaz:
//
// · EL BORRADOR SE ARMA SOLO. Si el profesional tuviera que escribirlo de
//   cero, esta función no existiría en la práctica: nadie tiene media hora
//   por familia por mes. Sale de lo que el equipo ya cargó sesión por sesión.
//
// · PERO NO SE MANDA SOLO. El botón de enviar está lejos del de armar, y en
//   el medio está el borrador entero para leer. Nada sobre un chico sale a
//   su familia sin que una persona lo haya leído — y lo que se lee acá es
//   exactamente lo que la familia va a ver, no un resumen de lo que se va a
//   mandar.
//
// · ENVIADO ES ENVIADO. Después no se edita ni se borra. La madre ya lo leyó.
async function renderTabInformesFamilia(pacienteId) {
  const caja = document.getElementById("informesFamiliaBox");
  if (!caja) return;
  caja.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando informes...</div>`;
  let data;
  try {
    data = await api(`/medico/pacientes/${pacienteId}/informes-familia`);
  } catch (e) {
    caja.innerHTML = `<div class="error">${esc(e.error || "No se pudieron cargar los informes")}</div>`;
    return;
  }
  pintarInformesFamilia(pacienteId, data, caja);
}

function fechaCortaIF(f) {
  return new Date(f).toLocaleDateString("es-BO", { day: "numeric", month: "short" });
}

function pintarInformesFamilia(pacienteId, data, caja) {
  const informes = data.informes || [];
  const dias = data.periodoDias || 60;

  caja.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nuevo informe para la familia</div>
      <div class="hint" style="margin-bottom:12px">
        Se arma con lo que ya está cargado en los objetivos y en el perfil:
        las fortalezas, en qué avanzó y qué ayuda necesita ahora. Después lo
        leés, escribís tu párrafo y recién ahí se manda.
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label>Desde</label>
          <input id="ifDesde" type="date" value="${new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)}">
        </div>
        <div style="flex:1">
          <label>Hasta</label>
          <input id="ifHasta" type="date" value="${new Date().toISOString().slice(0, 10)}">
        </div>
      </div>
      <button class="secondary" id="btnIFNuevo">Armar el borrador</button>
    </div>

    ${informes.length === 0 ? `<div class="empty">Todavía no se le mandó ningún informe a esta familia.</div>` : ""}
    ${informes.map(i => tarjetaInformeFamilia(i)).join("")}`;

  document.getElementById("btnIFNuevo").onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const r = await api(`/medico/pacientes/${pacienteId}/informes-familia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          desde: document.getElementById("ifDesde").value,
          hasta: document.getElementById("ifHasta").value,
        }),
      });
      abrirBorradorFamilia(pacienteId, r.informe);
    } catch (e) {
      btn.disabled = false;
      alert(e.error || "No se pudo armar el informe");
    }
  };

  caja.querySelectorAll("[data-if-abrir]").forEach(el => {
    el.onclick = async () => {
      const r = await api(`/medico/informes-familia/${el.dataset.ifAbrir}`);
      abrirBorradorFamilia(pacienteId, r.informe, r.enlace);
    };
  });
}

function tarjetaInformeFamilia(i) {
  const enviado = i.estado === "enviado";
  // Si la familia no lo abrió, eso se dice. No es curiosidad: un informe que
  // nunca se abrió es la señal de que hay que llamar por teléfono, que es
  // justo lo que esto sirve para detectar.
  const visto = enviado
    ? (i.vistas ? `👀 Lo abrieron ${i.vistas === 1 ? "una vez" : `${i.vistas} veces`}` : "⏳ Todavía no lo abrieron")
    : "📝 Borrador — no se mandó";
  return `
    <div class="item" data-if-abrir="${i._id}">
      <div class="top">
        <div class="nombre">${fechaCortaIF(i.desde)} — ${fechaCortaIF(i.hasta)}</div>
        <div class="fecha">${enviado ? new Date(i.enviadoEn).toLocaleDateString("es-BO") : ""}</div>
      </div>
      <div class="paciente-info">${visto}${i.avances?.length ? ` · ${i.avances.length} ${i.avances.length === 1 ? "avance" : "avances"}` : ""}</div>
    </div>`;
}

// La pantalla del borrador. Lo que se ve acá es lo que va a ver la familia,
// con los mismos textos — no una previsualización aproximada. Un botón de
// "enviar" debajo de un resumen distinto de lo que sale es una trampa.
function abrirBorradorFamilia(pacienteId, inf, enlace) {
  const enviado = inf.estado === "enviado";
  const caja = document.getElementById("informesFamiliaBox");
  if (!caja) return;

  const linea = (a) => {
    const partes = [];
    if (a.area) partes.push(a.area);
    if (a.bajoLaAyuda && a.ayudaAntes) partes.push(`antes ${a.ayudaAntes} → ahora ${a.ayudaAhora}`);
    else if (a.ayudaAhora) partes.push(a.ayudaAhora);
    if (a.veces) partes.push(`${a.veces} veces`);
    if (a.sesiones) partes.push(`${a.sesiones} ${a.sesiones === 1 ? "encuentro" : "encuentros"}`);
    return partes.join(" · ");
  };

  caja.innerHTML = `
    <button class="back" id="ifVolver">← Volver a los informes</button>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">
        ${enviado ? "Informe enviado" : "Borrador"} · ${fechaCortaIF(inf.desde)} — ${fechaCortaIF(inf.hasta)}
      </div>
      ${enviado ? `
        <div class="exito">Se envió el ${new Date(inf.enviadoEn).toLocaleDateString("es-BO")}. Ya no se puede cambiar.</div>
        ${enlace ? `<div class="hint" style="margin-top:10px;word-break:break-all">${esc(enlace)}</div>` : ""}
      ` : `
        <div class="hint">
          Esto es exactamente lo que va a ver la familia. Revisalo antes de mandarlo.
        </div>`}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Lo que hace bien</div>
      ${inf.fortalezas?.length
        ? `<div class="paciente-info">${inf.fortalezas.map(esc).join(" · ")}</div>`
        : `<div class="hint">Vacío. Es lo primero que lee la familia y lo único que ninguna
             escuela le manda escrito: cargalo en la pestaña Perfil antes de enviar.</div>`}
      ${inf.intereses?.length ? `<div class="paciente-info" style="margin-top:8px">Le gusta: ${inf.intereses.map(esc).join(" · ")}</div>` : ""}
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">En qué avanzó</div>
      ${(inf.avances || []).length ? inf.avances.map(a => `
        <div class="dato-row" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div style="font-weight:600">${esc(a.titulo)}${a.logrado ? " ✅" : ""}</div>
            <div class="hint" style="margin:2px 0 0">${esc(linea(a))}</div>
          </div>
          ${enviado ? "" : `<button class="link" data-if-quitar="${esc(a.titulo)}" style="margin:0;width:auto;color:var(--danger)">✕</button>`}
        </div>`).join("") : `<div class="hint">Sin avances registrados en este período.</div>`}
    </div>

    ${(inf.enCasa || []).length ? `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">Lo que pueden hacer en casa</div>
        <div class="paciente-info">${inf.enCasa.map(esc).join(" · ")}</div>
        <div class="hint">Sale de las estrategias del perfil sensorial. Es lo más útil que se
          puede compartir y hoy queda encerrado en la ficha.</div>
      </div>` : ""}

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Unas palabras del equipo</div>
      ${enviado
        ? `<div class="paciente-info" style="white-space:pre-wrap">${esc(inf.nota || "—")}</div>`
        : `<div class="hint" style="margin-bottom:8px">
             Es lo que la madre va a leer dos veces. El resto es el andamio.
           </div>
           <textarea id="ifNota" rows="5" placeholder="Ej: Este bimestre Leo se soltó mucho con los compañeros nuevos...">${esc(inf.nota || "")}</textarea>
           <input id="ifCentro" type="text" placeholder="Centro o consultorio (opcional)" value="${esc(inf.centro || "")}" style="margin-top:8px">
           <input id="ifProfesional" type="text" placeholder="Quién firma" value="${esc(inf.profesional || "")}" style="margin-top:8px">
           <button class="secondary" id="ifGuardar">Guardar el borrador</button>`}
    </div>

    ${enviado ? "" : `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">Mandarlo por WhatsApp</div>
        <div class="hint" style="margin-bottom:10px">
          Le llega un enlace, sin contraseña y sin instalar nada. El mensaje no
          nombra ninguna condición: la vista previa de WhatsApp se ve en la
          pantalla bloqueada de un teléfono que a veces es compartido.
        </div>
        <input id="ifTelefono" type="tel" placeholder="Teléfono (vacío = el de la ficha)">
        <button class="primary" id="ifEnviar">Enviar a la familia</button>
        <button class="link" id="ifBorrar" style="color:var(--danger)">Borrar este borrador</button>
      </div>`}`;

  document.getElementById("ifVolver").onclick = () => renderTabInformesFamilia(pacienteId);
  if (enviado) return;

  const guardar = async () => api(`/medico/informes-familia/${inf._id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nota: document.getElementById("ifNota").value,
      centro: document.getElementById("ifCentro").value,
      profesional: document.getElementById("ifProfesional").value,
    }),
  });

  document.getElementById("ifGuardar").onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const r = await guardar();
      abrirBorradorFamilia(pacienteId, r.informe);
    } catch (e) { btn.disabled = false; alert(e.error || "No se pudo guardar"); }
  };

  caja.querySelectorAll("[data-if-quitar]").forEach(el => {
    el.onclick = async () => {
      const dejar = (inf.avances || []).filter(a => a.titulo !== el.dataset.ifQuitar);
      const r = await api(`/medico/informes-familia/${inf._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avances: dejar }),
      });
      abrirBorradorFamilia(pacienteId, r.informe);
    };
  });

  document.getElementById("ifEnviar").onclick = async (ev) => {
    // La confirmación nombra que no se puede deshacer, porque de verdad no se
    // puede: una vez que el mensaje salió, está en el teléfono de la familia.
    if (!confirm("Se le manda ahora a la familia y después no se puede cambiar. ¿Va?")) return;
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      // Se guarda primero: si no, el párrafo recién escrito y todavía sin
      // guardar no viaja, y el informe sale sin lo único que lo hace personal.
      await guardar();
      const r = await api(`/medico/informes-familia/${inf._id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: document.getElementById("ifTelefono").value }),
      });
      abrirBorradorFamilia(pacienteId, r.informe, r.enlace);
    } catch (e) { btn.disabled = false; alert(e.error || "No se pudo enviar"); }
  };

  document.getElementById("ifBorrar").onclick = async () => {
    if (!confirm("¿Borrar este borrador?")) return;
    try {
      await api(`/medico/informes-familia/${inf._id}`, { method: "DELETE" });
      renderTabInformesFamilia(pacienteId);
    } catch (e) { alert(e.error || "No se pudo borrar"); }
  };
}
