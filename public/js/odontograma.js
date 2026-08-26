// Vitalis Odonto — Odontograma: arcada dibujada en SVG (2D, no 3D — ver
// conversación) con panel de detalle tipo timeline por pieza. (Dentición
// temporal queda para una próxima vuelta.)

// Dos familias de estado: lo que la pieza TIENE hoy, y lo que está
// INDICADO pero todavía no se hizo. Las indicadas van con el mismo tono
// que su tratamiento, en versión clara y con el borde punteado, para que
// se distinga de un vistazo lo planificado de lo hecho.
// El color, el ícono y el borde NO cambian con el idioma: un rojo es un
// rojo. Lo único que cambia es el nombre, y por eso sale de
// estadosPiezaInfo() al llamar — este archivo se carga antes del login.
const ESTADOS_PIEZA_ESTILO = {
  sano:                 { icono: "✅", color: "#ffffff", texto: "#0f2733", borde: "#c7d3da" },
  caries:                { icono: "🦠", color: "#b91c1c", texto: "#fff" },
  fractura:              { icono: "💥", color: "#7c2d12", texto: "#fff" },
  obturado:              { icono: "🩹", color: "#2563eb", texto: "#fff" },
  corona:                { icono: "👑", color: "#ca8a04", texto: "#fff" },
  endodoncia:            { icono: "💉", color: "#7c3aed", texto: "#fff" },
  implante:              { icono: "🔩", color: "#15803d", texto: "#fff" },
  sellante:              { icono: "🛡️", color: "#06b6d4", texto: "#fff" },
  ausente:               { icono: "❌", color: "#5b7480", texto: "#fff" },

  obturacion_indicada:   { icono: "🩹", color: "#93c5fd", texto: "#0b2559", borde: "#2563eb", punteado: true },
  corona_indicada:       { icono: "👑", color: "#fcd34d", texto: "#3d2900", borde: "#ca8a04", punteado: true },
  endodoncia_indicada:   { icono: "💉", color: "#c4b5fd", texto: "#2a1065", borde: "#7c3aed", punteado: true },
  implante_indicado:     { icono: "🔩", color: "#86efac", texto: "#052e16", borde: "#15803d", punteado: true },
  extraccion_indicada:   { icono: "⚠️", color: "#fdba74", texto: "#431407", borde: "#b45309", punteado: true },
};
function estadosPiezaInfo() {
  const salida = {};
  for (const k of Object.keys(ESTADOS_PIEZA_ESTILO)) salida[k] = { ...ESTADOS_PIEZA_ESTILO[k], label: t("pieza." + k) };
  return salida;
}

const FILA_SUPERIOR = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const FILA_INFERIOR = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

// Distribuye N piezas a lo largo de medio óvalo — t de 180° a 0° (pasando
// por 90°) da un valle ∪ (arco superior: los incisivos al centro, abajo,
// cerca de la arcada inferior); invertido=true (t de 180° a 360°, pasando
// por 270°) da un domo ∩ (arco inferior, mismo criterio pero al revés).
// Las piezas se reparten a distancia PAREJA sobre el arco, no a ángulos
// iguales. En una elipse tan achatada como esta (rx muy mayor que ry), pasos
// de ángulo iguales avanzan muy poco cerca de los extremos: los molares del
// fondo terminaban a 9px uno de otro, encimados (la ficha mide 24px), y los
// incisivos del centro separados 36px. Recorrer el arco por longitud deja
// todas las piezas a la misma distancia, como en una arcada real.
function posicionesArco(n, cx, cy, rx, ry, invertido) {
  const tIni = Math.PI;
  const tFin = invertido ? 2 * Math.PI : 0;
  const punto = (t) => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });

  // Se camina el arco en pasos chicos guardando cuánto se lleva recorrido.
  const PASOS = 2000;
  const acumulado = [0];
  let anterior = punto(tIni);
  for (let i = 1; i <= PASOS; i++) {
    const p = punto(tIni + (tFin - tIni) * (i / PASOS));
    acumulado.push(acumulado[i - 1] + Math.hypot(p.x - anterior.x, p.y - anterior.y));
    anterior = p;
  }
  const largoTotal = acumulado[PASOS];

  const pos = [];
  let paso = 0;
  for (let i = 0; i < n; i++) {
    const objetivo = (largoTotal * i) / (n - 1);
    while (paso < PASOS && acumulado[paso + 1] < objetivo) paso++;
    // Interpolación dentro del tramo, para no quedar pegado a la grilla.
    const tramo = acumulado[paso + 1] - acumulado[paso];
    const frac = tramo > 0 ? (objetivo - acumulado[paso]) / tramo : 0;
    pos.push(punto(tIni + (tFin - tIni) * ((paso + frac) / PASOS)));
  }
  return pos;
}

let vista3DActual = null; // { destruir, actualizarPiezas } — instancia WebGL viva, si hay una
let vistaOdontograma = "2d";

function destruirVista3DSiExiste() {
  if (vista3DActual) { vista3DActual.destruir(); vista3DActual = null; }
}

async function renderTabOdontograma(pacienteId) {
  destruirVista3DSiExiste();
  const box = document.getElementById("odontogramaBox");
  if (!box) return;
  box.innerHTML = `<div class="loading"><div class="spinner"></div>${t("odo.cargando")}</div>`;
  try {
    const data = await api(`/medico/pacientes/${pacienteId}/odontograma`);
    pintarOdontograma(pacienteId, data.odontograma);
  } catch (e) {
    if (e.status === 401) return logout();
    box.innerHTML = `<div class="error">${esc(e.error || t("odo.errCargar"))}</div>`;
  }
}

function piezaSvgHtml(pieza, pos) {
  // Solo se usan color/borde/texto acá, así que alcanza el estilo: no hace
  // falta resolver el nombre traducido para dibujar el diente.
  const info = ESTADOS_PIEZA_ESTILO[pieza.estado] || ESTADOS_PIEZA_ESTILO.sano;
  // Lo más grande que entra en el arco sin que dos piezas se toquen.
  const w = 26, h = 30;
  return `
    <g class="pieza-dental" data-numero="${pieza.numero}" transform="translate(${pos.x - w/2},${pos.y - h/2})" style="cursor:pointer">
      <rect width="${w}" height="${h}" rx="7" fill="${info.color}" stroke="${info.borde || info.color}" stroke-width="${info.punteado ? 2 : 1.5}"${info.punteado ? ' stroke-dasharray="4 2.5"' : ""}></rect>
      <text x="${w/2}" y="${h/2 + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${info.texto}">${pieza.numero}</text>
    </g>`;
}

function pintarOdontograma(pacienteId, odontograma) {
  const box = document.getElementById("odontogramaBox");
  if (!box) return;
  const porNumero = {};
  odontograma.piezas.forEach(p => { porNumero[p.numero] = p; });

  // El arco viejo (175x40) era muy chico para 16 piezas: quedaban a 9px una
  // de otra en los extremos y se encimaban. Ojo que ahí lo que aprieta no es
  // el ancho de la ficha sino el alto — cerca de los molares las piezas se
  // apilan casi en vertical.
  // El SVG escala al contenedor, así que agrandar el arco en unidades
  // internas no cambia cómo se ve: solo deja aire entre las fichas.
  const W = 600, H = 400;
  const posSup = posicionesArco(16, W/2, 60, 250, 100, false);
  const posInf = posicionesArco(16, W/2, 340, 250, 100, true);

  const svgPiezas = [
    ...FILA_SUPERIOR.map((n, i) => piezaSvgHtml(porNumero[n], posSup[i])),
    ...FILA_INFERIOR.map((n, i) => piezaSvgHtml(porNumero[n], posInf[i])),
  ].join("");

  box.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="seccion-titulo" style="margin-top:0;text-align:left">${t("odo.titulo")}</div>
      <div class="tabs" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
        <button class="tab ${vistaOdontograma === "2d" ? "activo" : ""}" id="btnVista2D">${t("odo.vista2d")}</button>
        <button class="tab ${vistaOdontograma === "3d" ? "activo" : ""}" id="btnVista3D">${t("odo.vista3d")}</button>
      </div>
      <div id="odontograma2dBox" style="display:${vistaOdontograma === "2d" ? "block" : "none"}">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:560px;height:auto;display:block;margin:0 auto">${svgPiezas}</svg>
      </div>
      <div id="odontograma3dBox" style="display:${vistaOdontograma === "3d" ? "block" : "none"};min-height:220px"></div>
      <div class="odonto-leyenda">
        ${Object.entries(estadosPiezaInfo()).map(([k, v]) => `
          <span class="odonto-leyenda-item"><i style="background:${v.color};border:${v.punteado ? "1.5px dashed" : "1px solid"} ${v.borde || v.color}"></i>${esc(v.label)}</span>`).join("")}
      </div>
    </div>
    <div id="piezaDetalleBox"></div>`;

  document.querySelectorAll(".pieza-dental").forEach(g => {
    g.onclick = () => pintarDetallePieza(pacienteId, porNumero[Number(g.dataset.numero)]);
  });

  document.getElementById("btnVista2D").onclick = () => {
    vistaOdontograma = "2d";
    destruirVista3DSiExiste();
    pintarOdontograma(pacienteId, odontograma);
  };
  document.getElementById("btnVista3D").onclick = () => {
    vistaOdontograma = "3d";
    pintarOdontograma(pacienteId, odontograma);
    montarVista3D(pacienteId, porNumero);
  };

  if (vistaOdontograma === "3d") montarVista3D(pacienteId, porNumero);
}

async function montarVista3D(pacienteId, porNumero) {
  const contenedor = document.getElementById("odontograma3dBox");
  if (!contenedor) return;
  contenedor.innerHTML = `<div class="loading"><div class="spinner"></div>${t("odo.cargando3d")}</div>`;
  try {
    const { montarOdontograma3D } = await import("/js/odontograma3d.js");
    contenedor.innerHTML = "";
    const coloresPorEstado = Object.fromEntries(Object.entries(ESTADOS_PIEZA_ESTILO).map(([k, v]) => [k, v.color]));
    vista3DActual = montarOdontograma3D(contenedor, porNumero, coloresPorEstado, (numero) => {
      pintarDetallePieza(pacienteId, porNumero[numero]);
    });
  } catch (e) {
    contenedor.innerHTML = `<div class="error">${t("odo.err3d")}</div>`;
  }
}

function pintarDetallePieza(pacienteId, pieza) {
  const box = document.getElementById("piezaDetalleBox");
  box.innerHTML = `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">${t("odo.pieza", { numero: pieza.numero })}</div>
      <label>${t("odo.estado")}</label>
      <select id="piezaEstado">
        ${Object.entries(estadosPiezaInfo()).map(([k, v]) => `<option value="${k}" ${k === pieza.estado ? "selected" : ""}>${v.icono} ${esc(v.label)}</option>`).join("")}
      </select>
      <label>${t("odo.notas")}</label>
      <textarea id="piezaNotas" rows="2" placeholder="${t("odo.notasPlaceholder")}">${esc(pieza.notas || "")}</textarea>
      <div id="piezaErr"></div>
      <button class="primary" id="btnGuardarPieza">${t("odo.guardar")}</button>

      ${pieza.historial?.length ? `
        <div class="seccion-titulo" style="margin-top:18px">${t("odo.historial")}</div>
        <div class="odonto-timeline">
          ${[...pieza.historial].reverse().map(h => {
            const estados = estadosPiezaInfo();
            const info = estados[h.estado] || estados.sano;
            return `
              <div class="odonto-timeline-item">
                <div class="odonto-timeline-icono" style="background:${info.color}">${info.icono}</div>
                <div class="odonto-timeline-contenido">
                  <div class="odonto-timeline-fecha">${new Date(h.fecha).toLocaleDateString(localeActual())}</div>
                  <div class="odonto-timeline-titulo">${esc(info.label)}</div>
                  ${h.notas ? `<div class="odonto-timeline-notas">${esc(h.notas)}</div>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>
      ` : ""}
    </div>`;

  document.getElementById("btnGuardarPieza").onclick = async () => {
    const errBox = document.getElementById("piezaErr");
    errBox.innerHTML = "";
    const estado = document.getElementById("piezaEstado").value;
    const notas = document.getElementById("piezaNotas").value.trim();
    const btn = document.getElementById("btnGuardarPieza");
    // Sin este guard, un doble clic (o dos pestañas en la misma pieza)
    // manda dos PATCH casi juntos que leen el mismo historial y empujan
    // cada uno su entrada por separado — el que guarda último pisa al otro
    // (o Mongo tira un error de versión) y se pierde una nota del historial.
    btn.disabled = true;
    try {
      await api(`/medico/pacientes/${pacienteId}/odontograma/${pieza.numero}`, {
        method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ estado, notas }),
      });
      renderTabOdontograma(pacienteId);
    } catch (e) {
      btn.disabled = false;
      errBox.innerHTML = `<div class="error">${esc(e.error || t("odo.errGuardar"))}</div>`;
    }
  };
}
