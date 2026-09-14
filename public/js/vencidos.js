// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — El panel de lo que se pasó
// ═══════════════════════════════════════════════════════════════════════════
// Lo primero que ve el profesional al entrar, y lo único de toda la pantalla
// que le habla de pacientes que NO tiene adelante. El cálculo y el porqué
// están en services/vencidos.js.
//
// Cuatro decisiones de esta pantalla:
//
// · SI NO HAY NADA, NO HAY TARJETA. No se dibuja un cartel verde diciendo
//   "todo al día". Un panel que siempre ocupa lugar se vuelve parte del
//   fondo, y el día que tenga algo urgente tampoco se va a mirar.
//
// · CADA LÍNEA ES UN ATAJO. Se toca y abre la ficha en la pestaña que
//   corresponde — la de vacunas si es una vacuna, la de salud si es un
//   control. Un aviso que obliga a buscar el paciente a mano no se atiende.
//
// · NO HAY BOTÓN DE "DESCARTAR". Lo vencido se resuelve atendiéndolo, no
//   tapándolo. El día que se pueda silenciar, la lista queda vacía y el
//   problema sigue.
//
// · SI ALGO NO SE PUDO CALCULAR, SE DICE. "No tenés nada vencido" cuando en
//   realidad una consulta falló es la peor mentira que puede decir este
//   panel: el médico confía y no revisa.
const GRAVEDAD = {
  perdida:   { color: "var(--danger)",  texto: "Se pasó" },
  vencida:   { color: "var(--warning)", texto: "Vencida" },
  atrasado:  { color: "var(--warning)", texto: "Atrasado" },
  parado:    { color: "var(--text-muted)", texto: "Parado" },
};

async function renderVencidos() {
  const caja = document.getElementById("vencidosBox");
  if (!caja) return;
  let d;
  try {
    d = await api("/medico/vencidos");
  } catch (_) {
    // En silencio: este panel es un agregado. Romperle la pantalla de
    // arranque al médico porque no se pudo calcular un aviso sería cambiar
    // una molestia por un problema.
    return;
  }
  if (!caja.isConnected) return;   // ya se fue a otra pantalla
  pintarVencidos(caja, d);
}

function pintarVencidos(caja, d) {
  if (!d.total) {
    // Ni siquiera una tarjeta vacía. Lo único que se dice es que el cálculo
    // quedó incompleto, y solo si pasó.
    caja.innerHTML = d.parcial
      ? `<div class="hint" style="margin-bottom:12px">No se pudo revisar todo. Puede haber algo vencido que no aparece acá.</div>`
      : "";
    return;
  }

  caja.innerHTML = `
    <div class="card venc-card">
      <div class="venc-cabecera">
        <div class="seccion-titulo" style="margin:0">Lo que se pasó</div>
        <span class="venc-total">${d.total}</span>
      </div>
      <div class="hint" style="margin:6px 0 4px">
        Symphomed revisó las fichas por vos. Tocá cualquiera para abrirla.
      </div>
      ${d.parcial ? `<div class="hint" style="color:var(--warning)">Faltó revisar una parte: puede haber más.</div>` : ""}

      ${d.grupos.map(g => `
        <div class="venc-grupo">
          <div class="venc-grupo-titulo">${esc(g.titulo)} <span>${g.items.length}</span></div>
          ${g.items.map(i => {
            const gr = GRAVEDAD[i.gravedad] || GRAVEDAD.atrasado;
            return `
            <div class="venc-item" data-paciente="${i.pacienteId}" data-tab="${esc(i.tab)}"
                 style="border-left-color:${gr.color}">
              <div class="venc-item-fila">
                <span class="venc-que">${esc(i.que)}</span>
                <span class="venc-hace">${esc(i.hace)}</span>
              </div>
              <div class="venc-quien">${esc(i.paciente)}${i.detalle ? ` · ${esc(i.detalle)}` : ""}</div>
            </div>`;
          }).join("")}
        </div>`).join("")}
    </div>`;

  caja.querySelectorAll(".venc-item").forEach(el => {
    el.onclick = () => renderPacienteDetalle(el.dataset.paciente, el.dataset.tab);
  });
}
