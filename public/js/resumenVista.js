// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Cómo se dibuja un resumen clínico
// ═══════════════════════════════════════════════════════════════════════════
//
// Lo usan las dos páginas públicas: /r/<token>, que abre el médico que lo
// recibe, y /mi/<llave>, donde el paciente ve lo suyo. Es un archivo aparte y
// no una función copiada en cada una porque si se separan, un día el paciente
// comparte algo que se ve distinto de lo que él miró — y ahí ya no hay forma
// de saber cuál de las dos versiones es la buena.
//
// ═══ ESTÁ ESCRITO PARA QUIEN LO VA A LEER, QUE NO SOMOS NOSOTROS ══════════
//
// El que abre /r es un médico que tiene al paciente sentado enfrente y dos
// minutos. No va a explorar: va a barrer la página buscando tres cosas
// —alergias, qué toma, qué le pasó— y si no las encuentra rápido cierra.
//
// Por eso el orden no es el del kardex. Va primero lo que cambia una
// decisión ahora mismo, y el historial después:
//
//   1. quién es
//   2. ALERGIAS, siempre, incluso cuando no hay ninguna
//   3. qué toma hoy
//   4. antecedentes
//   5. consultas, estudios, y el resto
//
// Y por eso todo está abierto: nada de acordeones. Un bloque plegado en un
// documento clínico es información que existe y que nadie va a abrir.
"use strict";

function rvEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// La fecha sigue al IDIOMA DE LA PÁGINA, no al del aparato.
//
// Con `undefined` el navegador usa su propio idioma, y eso da un documento
// mitad y mitad: los títulos en español y "Aug 14, 2026" en el medio, en la
// computadora de un consultorio que quedó configurada en inglés —que es la
// mitad de las computadoras de un consultorio—. En un papel clínico eso se
// lee como un error del sistema.
//
// Tomándolo del <html lang> queda consistente siempre, y el día que estas dos
// páginas se traduzcan al portugués las fechas se mudan solas.
function rvFecha(f) {
  if (!f) return "";
  const d = new Date(f);
  if (isNaN(d)) return "";
  const idioma = (document.documentElement.getAttribute("lang") || "es");
  return d.toLocaleDateString(idioma, { day: "2-digit", month: "short", year: "numeric" });
}

function rvEdad(nacimiento) {
  if (!nacimiento) return "";
  const n = new Date(nacimiento);
  if (isNaN(n)) return "";
  const hoy = new Date();
  let a = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) a--;
  if (a < 0) return "";
  // Abajo de dos años la edad en años no dice nada: "0 años" es un recién
  // nacido y también alguien de veintitrés meses.
  if (a < 2) {
    const meses = Math.max(0, (hoy.getFullYear() - n.getFullYear()) * 12 + m);
    return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  }
  return `${a} años`;
}

const rvSeccion = (titulo, cuerpo, clase) => cuerpo
  ? `<section class="rv-bloque ${clase || ""}"><h2>${rvEsc(titulo)}</h2>${cuerpo}</section>` : "";

const rvLista = (items) => items && items.length
  ? `<ul class="rv-lista">${items.map(x => `<li>${rvEsc(x)}</li>`).join("")}</ul>` : "";

// ═══ LAS ALERGIAS ══════════════════════════════════════════════════════════
//
// Es el único bloque que se dibuja SIEMPRE, incluso vacío, y el único con
// color. No es jerarquía visual por gusto: quien lee esto puede estar por
// recetar, y la diferencia entre "no es alérgica a nada" y "nadie le
// preguntó" cambia lo que hace.
//
// Un documento que simplemente no trae la sección se lee como la primera de
// las dos, que es la lectura peligrosa.
function rvAlergias(a) {
  if (!a) return "";
  if (a.registradas && a.lista.length) {
    return `
      <section class="rv-bloque rv-alerta">
        <h2>Alergias</h2>
        <ul class="rv-chips">${a.lista.map(x => `<li class="rv-chip-alerta">${rvEsc(x)}</li>`).join("")}</ul>
        ${a.actualizadasEn ? `<p class="rv-pie-dato">Registradas el ${rvEsc(rvFecha(a.actualizadasEn))}</p>` : ""}
      </section>`;
  }
  return `
    <section class="rv-bloque rv-sinDato">
      <h2>Alergias</h2>
      <p><b>No hay ninguna registrada.</b> Eso no quiere decir que no tenga:
      quiere decir que en esta ficha no está cargado. Conviene preguntar.</p>
    </section>`;
}

function rvIdentidad(i) {
  if (!i) return "";
  const edad = rvEdad(i.fechaNacimiento);
  const datos = [
    edad && `${edad}`,
    i.sexo && rvEsc(i.sexo),
    i.fechaNacimiento && `Nac. ${rvFecha(i.fechaNacimiento)}`,
    i.documento && `Doc. ${rvEsc(i.documento)}`,
  ].filter(Boolean);
  return `
    <header class="rv-cabecera">
      <h1>${rvEsc(i.nombre)}</h1>
      ${datos.length ? `<p class="rv-datos">${datos.join(" · ")}</p>` : ""}
    </header>`;
}

function rvMedicacion(m) {
  if (!m || !m.length) return "";
  const fila = (x) => `
    <li class="${x.activo ? "" : "rv-terminado"}">
      <b>${rvEsc(x.nombre)}</b>${x.dosis ? ` · ${rvEsc(x.dosis)}` : ""}${x.frecuencia ? ` · ${rvEsc(x.frecuencia)}` : ""}
      ${x.activo ? "" : `<span class="rv-etiqueta">terminado${x.hasta ? " " + rvFecha(x.hasta) : ""}</span>`}
    </li>`;
  const activos = m.filter(x => x.activo);
  const pasados = m.filter(x => !x.activo);
  // Lo que toma HOY arriba y separado de lo que ya terminó: mezclados, el que
  // lee tiene que ir leyendo etiqueta por etiqueta para saber qué está vigente.
  return `
    <ul class="rv-lista rv-medicacion">${activos.map(fila).join("")}</ul>
    ${pasados.length ? `<p class="rv-subtitulo">Ya terminada</p>
      <ul class="rv-lista rv-medicacion">${pasados.map(fila).join("")}</ul>` : ""}`;
}

function rvConsultas(cs, totales) {
  if (!cs || !cs.length) return "";
  const item = (c) => `
    <article class="rv-consulta">
      <p class="rv-fecha">${rvEsc(rvFecha(c.fecha))}</p>
      ${c.motivo ? `<h3>${rvEsc(c.motivo)}</h3>` : ""}
      ${c.diagnostico ? `<p class="rv-dx"><span>Diagnóstico</span> ${rvEsc(c.diagnostico)}</p>` : ""}
      ${c.sintomas && c.sintomas.length ? `<p class="rv-campo"><span>Síntomas</span> ${rvEsc(c.sintomas.join(", "))}</p>` : ""}
      ${c.plan ? `<p class="rv-campo"><span>Plan</span> ${rvEsc(c.plan)}</p>` : ""}
      ${c.recetado && c.recetado.length ? `<p class="rv-campo"><span>Recetado</span> ${
        rvEsc(c.recetado.map(r => [r.nombre, r.dosis, r.frecuencia].filter(Boolean).join(" ")).join(" · "))}</p>` : ""}
      ${c.examenes && c.examenes.length ? `<p class="rv-campo"><span>Pidió</span> ${rvEsc(c.examenes.join(", "))}</p>` : ""}
      ${c.proximoControl ? `<p class="rv-campo"><span>Control</span> ${rvEsc(c.proximoControl)}</p>` : ""}
    </article>`;
  // Cuántas quedaron afuera. Sin esta línea, un resumen de 5 de 40 consultas
  // se lee como la historia de un paciente que vino cinco veces, y quien lo
  // lee saca conclusiones sobre alguien que no es.
  const faltan = totales && totales > cs.length
    ? `<p class="rv-aviso-corte">Se comparten las ${cs.length} más recientes de ${totales}.
       Para la historia completa, pedísela a quien te mandó este enlace.</p>`
    : "";
  return cs.map(item).join("") + faltan;
}

// ═══ EL DOCUMENTO ══════════════════════════════════════════════════════════
//
// Devuelve HTML, no toca el DOM: así la misma función sirve para la página
// del colega, la del paciente y la previsualización del médico antes de
// compartir. Que la previsualización sea literalmente lo mismo que se manda
// no es una comodidad — es lo que hace que aprobar signifique algo.
function resumenVistaHtml(contenido, opciones) {
  const c = contenido || {};
  const o = opciones || {};
  const firma = o.firma || {};

  const cuerpo = [
    rvIdentidad(c.identidad),
    rvAlergias(c.alergias),
    rvSeccion("Medicación", rvMedicacion(c.medicacion)),
    rvSeccion("Antecedentes personales", rvLista(c.antecedentes)),
    rvSeccion("Antecedentes familiares", c.familiares && c.familiares.length
      ? rvLista(c.familiares.map(f => `${f.parentesco ? f.parentesco + ": " : ""}${f.condicion}`)) : ""),
    rvSeccion("Consultas", rvConsultas(c.consultas, c.consultasTotales)),
    rvSeccion("Estudios con informe", (c.informes || []).length
      ? (c.informes).map(e => `
        <article class="rv-consulta">
          <p class="rv-fecha">${rvEsc(rvFecha(e.fecha))}</p>
          <h3>${rvEsc(e.titulo || e.tipo)}</h3>
          ${e.conclusion ? `<p class="rv-dx"><span>Conclusión</span> ${rvEsc(e.conclusion)}</p>` : ""}
          ${e.recomendaciones ? `<p class="rv-campo"><span>Recomienda</span> ${rvEsc(e.recomendaciones)}</p>` : ""}
        </article>`).join("") : ""),
    rvSeccion("Vacunas", (c.vacunas || []).length
      ? rvLista(c.vacunas.map(v => `${v.nombre}${v.dosis ? " · " + v.dosis : ""} — ${rvFecha(v.fecha)}`)) : ""),
    rvSeccion("Controles", (c.mediciones || []).length
      ? rvLista(c.mediciones.map(m => `${m.tipo}: ${m.valor}${m.valorSecundario != null ? "/" + m.valorSecundario : ""}${m.unidad ? " " + m.unidad : ""} — ${rvFecha(m.fecha)}`)) : ""),
    rvSeccion("Plan de tratamiento", (c.tratamientos || []).length
      ? rvLista(c.tratamientos.map(x => `${x.nombre}${x.piezaFdi ? ` (pieza ${x.piezaFdi})` : ""} — ${x.estado}`)) : ""),
  ].join("");

  // La firma no es cortesía: es a quién llamar. Un resumen clínico sin un
  // nombre y un teléfono atrás es un papel anónimo sobre la salud de alguien,
  // y quien lo lee no tiene forma de preguntar nada.
  const pie = (firma.nombre || firma.centro) ? `
    <footer class="rv-pie">
      <p class="rv-firma">${rvEsc(firma.centro || firma.nombre)}</p>
      ${firma.centro && firma.nombre ? `<p>${rvEsc(firma.nombre)}</p>` : ""}
      ${firma.telefono ? `<p><a href="tel:${rvEsc(String(firma.telefono).replace(/[^\d+]/g, ""))}">${rvEsc(firma.telefono)}</a></p>` : ""}
      ${o.compartidoEn ? `<p class="rv-pie-dato">Compartido el ${rvEsc(rvFecha(o.compartidoEn))}${
        o.generadoPor === "paciente" ? ", por el propio paciente" : ""}</p>` : ""}
    </footer>` : "";

  return `<article class="rv-hoja">${cuerpo}${pie}</article>`;
}
