// ═══════════════════════════════════════════════════════════════════════════
// Symphomed Pediatría — Curvas de crecimiento
// ═══════════════════════════════════════════════════════════════════════════
// Un pediatra sin curvas no tiene ficha. Lo que importa no es el peso de hoy
// sino por qué carril viene el chico: uno que siempre estuvo en el percentil
// 15 y sigue ahí está sano; uno que venía por el 50 y se cayó al 15 tiene un
// problema, aunque los dos pesen lo mismo hoy.
//
// Los datos son los patrones oficiales de la OMS (ver crecimientoDatos.js).
// Acá está solo el cálculo y el dibujo — a propósito separados, para que
// nadie toque los números por acomodar un gráfico.
//
// Postura, igual que en el resto de Symphomed: esto calcula y muestra. No
// diagnostica, no dice "desnutrido". Marca cuándo un valor cae fuera de lo
// esperado y el pediatra decide qué significa.

// ─── QUÉ SE PUEDE GRAFICAR ────────────────────────────────────────────────
// "hastaMes" es hasta dónde publica la OMS, ni un mes más. Pasado eso no
// inventamos: se dice que no aplica.
const INDICADORES_CRECIMIENTO = {
  peso:              { label: "Peso para la edad",   corto: "Peso",      unidad: "kg", hastaMes: 120, medicion: "peso" },
  talla:             { label: "Talla para la edad",  corto: "Talla",     unidad: "cm", hastaMes: 228, medicion: "talla" },
  perimetroCefalico: { label: "Perímetro cefálico",  corto: "P. cefálico", unidad: "cm", hastaMes: 60,  medicion: "perimetroCefalico" },
  imc:               { label: "IMC para la edad",    corto: "IMC",       unidad: "",   hastaMes: 228, medicion: "imc" },
};

// Las curvas que se dibujan de fondo. La OMS usa desviaciones estándar
// (no percentiles) para el material clínico de 0 a 5 años, porque en los
// extremos el percentil deja de distinguir: el 0,1 y el 0,4 se ven iguales
// y uno es una urgencia. Se muestran las dos cosas: la banda es por z, la
// etiqueta dice el percentil, que es lo que la madre entiende.
const BANDAS_Z = [-3, -2, -1, 0, 1, 2, 3];

const DIAS_POR_MES = 30.4375;

// ─── EDAD ─────────────────────────────────────────────────────────────────
// En pediatría la edad no son años. Un recién nacido se mide en días, un
// lactante en semanas, y hasta los dos años en meses — decir "1 año" de un
// bebé de 13 meses pierde justo la información que importa.
// Nadie cuenta la edad de un chico en horas: se compara día calendario
// contra día calendario. Sin normalizar, el mismo control se leía como
// "11 meses" en el historial (guardado a medianoche) y "12 meses" en el
// encabezado (calculado a media tarde).
function aMedianoche(fecha) {
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function edadEnMeses(fechaNacimiento, hasta) {
  const nace = aMedianoche(fechaNacimiento);
  const corte = aMedianoche(hasta || Date.now());
  if (nace == null || corte == null) return null;
  const dias = (corte - nace) / 86400000;
  if (!Number.isFinite(dias) || dias < 0) return null;
  return dias / DIAS_POR_MES;
}

// Edad corregida: a un prematuro se le descuenta lo que le faltó para llegar
// a término (40 semanas). Sin esto, un bebé de 32 semanas se lee como un
// retraso de crecimiento que no existe. Se corrige hasta los 24 meses de
// edad cronológica, que es la práctica habitual — después la diferencia deja
// de ser significativa y seguir corrigiendo distorsiona al revés.
function edadCorregidaEnMeses(paciente, hasta) {
  const cronologica = edadEnMeses(paciente?.fechaNacimiento, hasta);
  if (cronologica == null) return null;
  // Ojo con el vacío: Number(null) y Number("") dan 0, no NaN. Sin este
  // chequeo, un paciente SIN semanas de gestación cargadas se leía como
  // "nació de 0 semanas" y se le descontaban 9 meses de edad — o sea, a
  // todos los chicos a término se les calculaba el percentil contra la
  // edad equivocada, en silencio.
  const bruto = paciente?.semanasGestacionAlNacer;
  const semanas = bruto === null || bruto === undefined || bruto === "" ? NaN : Number(bruto);
  if (!Number.isFinite(semanas) || semanas < 20 || semanas >= 40 || cronologica > 24) {
    return { meses: cronologica, corregida: false, cronologica };
  }
  const mesesDescontados = ((40 - semanas) * 7) / DIAS_POR_MES;
  return { meses: Math.max(0, cronologica - mesesDescontados), corregida: true, cronologica };
}

// La edad que se MUESTRA se cuenta por calendario, no dividiendo días por
// 30,4375: un chico nacido hace exactamente un año tiene 12 meses, no 11,99.
// El cálculo del percentil sigue usando la conversión por días, que es la
// que usa la OMS — son dos cosas distintas a propósito.
function mesesCalendario(fechaNacimiento, hasta) {
  const n = new Date(fechaNacimiento), h = new Date(hasta || Date.now());
  if (Number.isNaN(n.getTime()) || Number.isNaN(h.getTime())) return null;
  let m = (h.getFullYear() - n.getFullYear()) * 12 + (h.getMonth() - n.getMonth());
  if (h.getDate() < n.getDate()) m--; // todavía no cumplió el mes
  return Math.max(0, m);
}

function textoMeses(m) {
  return `${m} ${m === 1 ? "mes" : "meses"}`;
}

// "3 meses", "1 a 4 m", "12 días" — como lo escribe un pediatra.
function edadPediatricaTexto(fechaNacimiento, hasta) {
  const meses = edadEnMeses(fechaNacimiento, hasta);
  if (meses == null) return "";
  const dias = Math.round(meses * DIAS_POR_MES);
  if (dias < 31) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const m = mesesCalendario(fechaNacimiento, hasta);
  if (m < 24) return textoMeses(m);
  const anios = Math.floor(m / 12);
  const resto = m % 12;
  return resto ? `${anios} a ${resto} m` : `${anios} ${anios === 1 ? "año" : "años"}`;
}

// ─── EL CÁLCULO ───────────────────────────────────────────────────────────
// "M" y "F" son los dos conjuntos que publica la OMS. El campo sexo del
// paciente es texto libre histórico, así que se normaliza acá.
function sexoOms(paciente) {
  const s = String(paciente?.sexo || "").trim().toLowerCase();
  if (s.startsWith("m") && !s.startsWith("mu")) return "M"; // Masculino / Macho
  if (s.startsWith("f") || s.startsWith("mu")) return "F";  // Femenino / Mujer
  return null; // "Otro" o sin especificar: no hay patrón que aplicar
}

// L, M y S en una edad cualquiera, interpolando entre los dos meses que la
// rodean — la OMS publica un valor por mes y el crecimiento entre medio es
// suave, así que la recta es una aproximación más que suficiente.
function lmsEn(indicador, sexo, meses) {
  const tabla = LMS_OMS[indicador]?.[sexo];
  if (!tabla) return null;
  const maximo = tabla.m.length - 1;
  if (meses < 0 || meses > maximo) return null;
  const i = Math.floor(meses);
  if (i >= maximo) return { L: tabla.l[maximo], M: tabla.m[maximo], S: tabla.s[maximo] };
  const f = meses - i;
  const mezclar = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
  return { L: mezclar(tabla.l), M: mezclar(tabla.m), S: mezclar(tabla.s) };
}

// Fórmula LMS de la OMS. La rama L===0 no es un caso raro: la talla usa
// L=1 y el IMC L negativo, pero si alguna tabla trae L=0 la fórmula general
// se indefine y hay que usar el logaritmo.
function zDesdeValor(valor, { L, M, S }) {
  if (!(M > 0) || !(S > 0) || !(valor > 0)) return null;
  return L === 0 ? Math.log(valor / M) / S : (Math.pow(valor / M, L) - 1) / (L * S);
}

function valorDesdeZ(z, { L, M, S }) {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

// Percentil a partir del z (función de distribución normal acumulada).
// Aproximación de Abramowitz y Stegun 26.2.17: error menor a 7,5e-8, o sea
// invisible a cualquier escala clínica.
function percentilDesdeZ(z) {
  const signo = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 100 * 0.5 * (1 + signo * y);
}

// El resultado que consume toda la pantalla. Devuelve null cuando no se
// puede calcular, y el motivo, para poder decirlo en vez de mostrar un
// número inventado.
function evaluarCrecimiento(paciente, indicador, valor, fechaMedicion) {
  const cfg = INDICADORES_CRECIMIENTO[indicador];
  if (!cfg) return { ok: false, motivo: "indicador desconocido" };
  const sexo = sexoOms(paciente);
  if (!sexo) return { ok: false, motivo: "falta_sexo" };
  if (!paciente?.fechaNacimiento) return { ok: false, motivo: "falta_fecha_nacimiento" };

  const edad = edadCorregidaEnMeses(paciente, fechaMedicion);
  if (!edad) return { ok: false, motivo: "falta_fecha_nacimiento" };
  if (edad.meses > cfg.hastaMes) return { ok: false, motivo: "fuera_de_rango", hastaMes: cfg.hastaMes };

  const lms = lmsEn(indicador, sexo, edad.meses);
  if (!lms) return { ok: false, motivo: "fuera_de_rango", hastaMes: cfg.hastaMes };

  const z = zDesdeValor(Number(valor), lms);
  if (z == null || !Number.isFinite(z)) return { ok: false, motivo: "valor_invalido" };

  return {
    ok: true,
    z,
    percentil: percentilDesdeZ(z),
    mesesEdad: edad.meses,
    edadCorregida: edad.corregida,
    mediana: lms.M,
  };
}

// Cómo se dice un percentil sin asustar ni tranquilizar de más. Nunca dice
// un diagnóstico: "por debajo de lo esperado" es una observación, "desnutrido"
// es un diagnóstico y ese lo pone el pediatra.
function lecturaZ(z, indicador) {
  const abs = Math.abs(z);
  if (abs <= 1) return { texto: "Dentro de lo esperado", color: "var(--success)" };
  if (abs <= 2) return { texto: "En el límite de lo esperado", color: "var(--text-muted)" };
  if (abs <= 3) {
    // "Talla baja" es el término que usa el pediatra y el que va a buscar;
    // para el resto de los indicadores no hay una palabra equivalente que no
    // sea ya un diagnóstico, así que se describe y nada más.
    const abajo = indicador === "talla" ? "Talla baja para la edad" : "Por debajo de lo esperado";
    return { texto: z < 0 ? abajo : "Por encima de lo esperado", color: "var(--warning)" };
  }
  return {
    texto: z < 0 ? "Muy por debajo de lo esperado" : "Muy por encima de lo esperado",
    color: "var(--danger)",
  };
}

// 75,7391 cm no es una talla, es el número crudo de una tabla. Cada
// indicador se muestra con los decimales que de verdad se miden.
const DECIMALES = { peso: 2, talla: 1, perimetroCefalico: 1, imc: 1 };
function valorTexto(valor, indicador) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  return n.toFixed(DECIMALES[indicador] ?? 1).replace(".", ",");
}

function percentilTexto(p) {
  if (p < 0.1) return "< P0,1";
  if (p > 99.9) return "> P99,9";
  if (p < 1 || p > 99) return "P" + p.toFixed(1).replace(".", ",");
  return "P" + Math.round(p);
}

// ═══ EL GRÁFICO ═══════════════════════════════════════════════════════════
// La diferencia con el gráfico de evolución de siempre es que el eje X acá
// es la EDAD (no "la enésima medición"), porque el carril por el que viene
// el chico solo tiene sentido contra la edad. Dos controles separados por un
// año no pueden dibujarse a la misma distancia que dos separados por una
// semana.

let crecimientoIndicadorActivo = "peso";

// Ventana de edad que se muestra: la de las mediciones, más un respiro, y
// nunca más allá de donde llega la tabla de la OMS.
function ventanaEdad(mediciones, paciente, hastaMes) {
  const edades = mediciones
    .map(m => edadCorregidaEnMeses(paciente, m.fecha)?.meses)
    .filter(v => v != null && v <= hastaMes);
  const actual = edadCorregidaEnMeses(paciente)?.meses ?? 0;
  const maxDato = Math.max(actual, ...(edades.length ? edades : [0]));
  // Se muestra siempre un poco más allá de la edad actual, para que haya
  // lugar donde ver hacia dónde va el próximo control.
  const fin = Math.min(hastaMes, Math.max(6, maxDato + Math.max(3, maxDato * 0.2)));
  // De arranque el eje empieza en el nacimiento: la curva de un chico solo
  // se lee entera. Recién cuando ya es grande (y el tramo de bebé se
  // aplastaría contra el borde) se empieza más adelante.
  const ini = fin <= 66 ? 0 : Math.max(0, Math.min(...(edades.length ? edades : [maxDato])) - 12);
  return { ini, fin: Math.max(fin, ini + 6) };
}

function dibujarCurvaCrecimiento(canvas, paciente, mediciones, indicador) {
  const cfg = INDICADORES_CRECIMIENTO[indicador];
  const sexo = sexoOms(paciente);
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (!sexo) return [];

  const padIzq = 34, padDer = 12, padArr = 12, padAba = 24;
  const { ini, fin } = ventanaEdad(mediciones, paciente, cfg.hastaMes);

  // Se recorren las bandas primero para saber qué rango de valores entra en
  // el gráfico — la escala la manda la curva de la OMS, no los datos del
  // chico: si un valor queda fuera de la banda, eso es exactamente lo que
  // el pediatra tiene que ver.
  const PASOS = 60;
  const edadEn = i => ini + ((fin - ini) * i) / PASOS;
  const bandas = BANDAS_Z.map(z => {
    const pts = [];
    for (let i = 0; i <= PASOS; i++) {
      const m = edadEn(i);
      const lms = lmsEn(indicador, sexo, m);
      if (lms) pts.push({ m, v: valorDesdeZ(z, lms) });
    }
    return { z, pts };
  });

  const valoresBanda = bandas.flatMap(b => b.pts.map(p => p.v));
  const puntosChico = mediciones
    .map(md => {
      const e = edadCorregidaEnMeses(paciente, md.fecha);
      return e && e.meses <= cfg.hastaMes ? { m: e.meses, v: Number(md.valor), medicion: md } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.m - b.m);

  const todos = valoresBanda.concat(puntosChico.map(p => p.v));
  if (!todos.length) return [];
  let vMin = Math.min(...todos), vMax = Math.max(...todos);
  const respiro = (vMax - vMin) * 0.06 || 1;
  vMin -= respiro; vMax += respiro;

  const X = m => padIzq + ((m - ini) / (fin - ini)) * (w - padIzq - padDer);
  const Y = v => h - padAba - ((v - vMin) / (vMax - vMin)) * (h - padArr - padAba);

  const estilos = document.body ? getComputedStyle(document.body) : null;
  const color = (nombre, fallback) => (estilos?.getPropertyValue(nombre) || "").trim() || fallback;
  const cBorde = color("--border", "#dbe6ea");
  const cTexto = color("--text-muted", "#7b8a90");
  const cPrimario = color("--primary", "#0e7490");

  // Relleno suave entre -2 y +2 DE: es "la zona normal" de un vistazo, que
  // es lo único que la madre va a mirar.
  const b2neg = bandas.find(b => b.z === -2), b2pos = bandas.find(b => b.z === 2);
  if (b2neg && b2pos && b2neg.pts.length) {
    ctx.beginPath();
    b2neg.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.m), Y(p.v)) : ctx.moveTo(X(p.m), Y(p.v))));
    for (let i = b2pos.pts.length - 1; i >= 0; i--) ctx.lineTo(X(b2pos.pts[i].m), Y(b2pos.pts[i].v));
    ctx.closePath();
    ctx.fillStyle = "rgba(" + color("--primary-rgb", "14,116,144") + ",0.07)";
    ctx.fill();
  }

  // Las bandas. La mediana (z=0) va más marcada porque es la referencia que
  // el pediatra busca primero.
  bandas.forEach(({ z, pts }) => {
    if (!pts.length) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.m), Y(p.v)) : ctx.moveTo(X(p.m), Y(p.v))));
    ctx.strokeStyle = z === 0 ? cTexto : cBorde;
    ctx.lineWidth = z === 0 ? 1.4 : 1;
    ctx.setLineDash(Math.abs(z) === 3 ? [3, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Etiqueta del percentil al final de cada banda
    const ult = pts[pts.length - 1];
    ctx.fillStyle = cTexto;
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(percentilTexto(percentilDesdeZ(z)), w - padDer, Y(ult.v) - 2);
  });

  // Ejes
  ctx.strokeStyle = cBorde;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padIzq, padArr); ctx.lineTo(padIzq, h - padAba); ctx.lineTo(w - padDer, h - padAba);
  ctx.stroke();

  ctx.fillStyle = cTexto;
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let k = 0; k <= 4; k++) {
    const v = vMin + ((vMax - vMin) * k) / 4;
    ctx.fillText(v.toFixed(v < 30 ? 1 : 0), padIzq - 4, Y(v) + 3);
  }
  // El eje de edad se rotula en meses cuando el chico es chico y en años
  // cuando ya no — decir "84 meses" de un chico de 7 años no lo lee nadie.
  ctx.textAlign = "center";
  const enAnios = fin > 36;
  for (let k = 0; k <= 4; k++) {
    const m = ini + ((fin - ini) * k) / 4;
    ctx.fillText(enAnios ? (m / 12).toFixed(1).replace(".", ",") + "a" : Math.round(m) + "m", X(m), h - padAba + 12);
  }

  // La curva del chico, encima de todo
  if (puntosChico.length) {
    ctx.strokeStyle = cPrimario;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    puntosChico.forEach((p, i) => (i ? ctx.lineTo(X(p.m), Y(p.v)) : ctx.moveTo(X(p.m), Y(p.v))));
    ctx.stroke();
    ctx.fillStyle = cPrimario;
    puntosChico.forEach(p => {
      ctx.beginPath();
      ctx.arc(X(p.m), Y(p.v), 3.4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  return puntosChico.map(p => ({ ...p, px: X(p.m), py: Y(p.v) }));
}

// ═══ LA PESTAÑA ═══════════════════════════════════════════════════════════
function faltaParaCrecer(paciente) {
  const falta = [];
  if (!paciente?.fechaNacimiento) falta.push("la fecha de nacimiento");
  if (!sexoOms(paciente)) falta.push("el sexo");
  return falta;
}

function tabCrecimientoHtml(paciente, mediciones) {
  const falta = faltaParaCrecer(paciente);
  if (falta.length) {
    return `
      <div class="card">
        <div class="seccion-titulo" style="margin-top:0">📈 Curvas de crecimiento</div>
        <div class="hint" style="margin-bottom:12px">
          Para calcular percentiles hace falta ${falta.join(" y ")} — sin eso no hay
          patrón de la OMS que aplicar, y un percentil inventado no le sirve a nadie.
        </div>
        <button class="secondary" id="btnCompletarPaciente">Completar los datos del paciente</button>
      </div>`;
  }

  const edad = edadCorregidaEnMeses(paciente);
  const disponibles = Object.entries(INDICADORES_CRECIMIENTO).filter(([, c]) => edad.meses <= c.hastaMes);
  if (!disponibles.some(([k]) => k === crecimientoIndicadorActivo)) {
    crecimientoIndicadorActivo = disponibles[0]?.[0] || "talla";
  }

  return `
    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">📈 Curvas de crecimiento · OMS</div>
      <div class="hint" style="margin-bottom:10px">
        ${esc(paciente.nombre)} · ${esc(edadPediatricaTexto(paciente.fechaNacimiento))}
        ${edad.corregida ? ` · <b>edad corregida ${Math.round(edad.meses)} m</b> (prematuro de ${paciente.semanasGestacionAlNacer} semanas)` : ""}
      </div>
      <div class="chip-row" id="crecChips">
        ${disponibles.map(([k, c]) => `
          <button type="button" class="chip${k === crecimientoIndicadorActivo ? " activo" : ""}" data-indicador="${k}">${esc(c.corto)}</button>`).join("")}
      </div>
      <div id="crecEstado" style="margin-top:12px"></div>
      <canvas id="crecCanvas" style="width:100%;height:260px;margin-top:10px"></canvas>
      <div id="crecLeyenda" class="hint" style="text-align:center;margin-top:4px"></div>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Nuevo control</div>
      <div class="hint" style="margin-bottom:10px">Cargá lo que midas — el IMC se calcula solo con el peso y la talla.</div>
      <label>Fecha</label>
      <input id="crecFecha" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <label>Peso (kg)</label>
      <input id="crecPeso" type="number" step="0.01" inputmode="decimal" placeholder="Ej: 12.4">
      <label>Talla (cm)</label>
      <input id="crecTalla" type="number" step="0.1" inputmode="decimal" placeholder="Ej: 84.5">
      ${edad.meses <= INDICADORES_CRECIMIENTO.perimetroCefalico.hastaMes ? `
      <label>Perímetro cefálico (cm)</label>
      <input id="crecPeri" type="number" step="0.1" inputmode="decimal" placeholder="Ej: 46.2">` : ""}
      <div id="crecErr"></div>
      <button class="secondary" id="btnGuardarControl">Guardar control</button>
    </div>

    <div class="card">
      <div class="seccion-titulo" style="margin-top:0">Historial</div>
      <div id="crecHistorial"></div>
    </div>`;
}

function medicionesDe(mediciones, indicador) {
  return (mediciones || [])
    .filter(m => m.tipo === INDICADORES_CRECIMIENTO[indicador].medicion)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function pintarEstadoCrecimiento(paciente, mediciones) {
  const cfg = INDICADORES_CRECIMIENTO[crecimientoIndicadorActivo];
  const serie = medicionesDe(mediciones, crecimientoIndicadorActivo);
  const caja = document.getElementById("crecEstado");
  if (!caja) return;

  if (!serie.length) {
    caja.innerHTML = `<div class="hint">Todavía no hay ${esc(cfg.corto.toLowerCase())} cargado. Las bandas de la OMS ya están dibujadas: cargá un control y la curva del chico aparece encima.</div>`;
    return;
  }

  const ultima = serie[serie.length - 1];
  const ev = evaluarCrecimiento(paciente, crecimientoIndicadorActivo, ultima.valor, ultima.fecha);
  if (!ev.ok) {
    const motivos = {
      fuera_de_rango: `La OMS publica ${cfg.label.toLowerCase()} hasta los ${Math.round(cfg.hastaMes / 12)} años. Después de esa edad no se calcula percentil.`,
      falta_sexo: "Falta el sexo del paciente.",
      falta_fecha_nacimiento: "Falta la fecha de nacimiento.",
      valor_invalido: "El último valor cargado no es válido.",
    };
    caja.innerHTML = `<div class="hint">${esc(motivos[ev.motivo] || "No se puede calcular el percentil.")}</div>`;
    return;
  }

  const lect = lecturaZ(ev.z, crecimientoIndicadorActivo);
  // La tendencia es lo que de verdad mira un pediatra: no el percentil de
  // hoy, sino si se está moviendo de carril entre un control y el anterior.
  let tendencia = "";
  if (serie.length > 1) {
    const previa = serie[serie.length - 2];
    const evPrev = evaluarCrecimiento(paciente, crecimientoIndicadorActivo, previa.valor, previa.fecha);
    if (evPrev.ok) {
      const dz = ev.z - evPrev.z;
      const flecha = dz > 0.05 ? "▲" : dz < -0.05 ? "▼" : "=";
      // Medio z de caída entre controles es el umbral clásico para mirar con
      // atención: no es un diagnóstico, es un "revisá esto".
      const ojo = dz <= -0.67;
      tendencia = `<div class="hint" style="margin-top:6px${ojo ? ";color:var(--warning)" : ""}">
        ${flecha} ${dz >= 0 ? "+" : ""}${dz.toFixed(2).replace(".", ",")} DE desde el control anterior
        (${esc(percentilTexto(evPrev.percentil))} → ${esc(percentilTexto(ev.percentil))})
        ${ojo ? "<br>Se movió de carril hacia abajo — vale la pena mirarlo." : ""}
      </div>`;
    }
  }

  caja.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <div style="font-size:26px;font-weight:700">${esc(valorTexto(ultima.valor, crecimientoIndicadorActivo))}<span style="font-size:14px;font-weight:400"> ${esc(cfg.unidad)}</span></div>
      <div style="font-size:18px;font-weight:600;color:${lect.color}">${esc(percentilTexto(ev.percentil))}</div>
      <div class="hint" style="margin:0">z = ${ev.z >= 0 ? "+" : ""}${ev.z.toFixed(2).replace(".", ",")}</div>
    </div>
    <div style="color:${lect.color};font-weight:600;margin-top:2px">${esc(lect.texto)}</div>
    <div class="hint" style="margin-top:2px">
      Mediana esperada a esta edad: ${esc(valorTexto(ev.mediana, crecimientoIndicadorActivo))} ${esc(cfg.unidad)} ·
      medido el ${new Date(ultima.fecha).toLocaleDateString("es-BO")}
    </div>
    ${tendencia}`;
}

function pintarHistorialCrecimiento(paciente, mediciones) {
  const caja = document.getElementById("crecHistorial");
  if (!caja) return;
  const cfg = INDICADORES_CRECIMIENTO[crecimientoIndicadorActivo];
  const serie = medicionesDe(mediciones, crecimientoIndicadorActivo).slice().reverse();
  if (!serie.length) { caja.innerHTML = `<div class="hint">Sin controles cargados.</div>`; return; }
  caja.innerHTML = serie.map(m => {
    const ev = evaluarCrecimiento(paciente, crecimientoIndicadorActivo, m.valor, m.fecha);
    const edad = edadCorregidaEnMeses(paciente, m.fecha);
    return `
      <div class="item" style="cursor:default">
        <div class="top">
          <div class="nombre">${esc(valorTexto(m.valor, crecimientoIndicadorActivo))} ${esc(cfg.unidad)}${ev.ok ? ` · ${esc(percentilTexto(ev.percentil))}` : ""}</div>
          <button class="link" data-borrar-medicion="${m._id}" style="margin:0;width:auto;color:var(--danger)">✕</button>
        </div>
        <div class="fecha">${new Date(m.fecha).toLocaleDateString("es-BO")} · ${edad ? (edad.corregida ? textoMeses(Math.round(edad.meses)) : edadPediatricaTexto(paciente.fechaNacimiento, m.fecha)) : ""}${edad?.corregida ? " (corregida)" : ""}</div>
      </div>`;
  }).join("");
}

function repintarCrecimiento(paciente, mediciones) {
  pintarEstadoCrecimiento(paciente, mediciones);
  pintarHistorialCrecimiento(paciente, mediciones);
  const canvas = document.getElementById("crecCanvas");
  if (canvas) {
    dibujarCurvaCrecimiento(canvas, paciente, medicionesDe(mediciones, crecimientoIndicadorActivo), crecimientoIndicadorActivo);
    const ley = document.getElementById("crecLeyenda");
    if (ley) ley.textContent = `Bandas: patrones OMS por desviación estándar · eje horizontal = edad${edadCorregidaEnMeses(paciente)?.corregida ? " corregida" : ""}`;
  }
  document.querySelectorAll("[data-borrar-medicion]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("¿Borrar este control?")) return;
      try {
        await api(`/medico/mediciones/${btn.dataset.borrarMedicion}`, { method: "DELETE" });
        renderPacienteDetalle(paciente._id, "crecimiento");
      } catch (e) { alert(e.error || "No se pudo borrar"); }
    };
  });
}

function wireTabCrecimiento(paciente, mediciones) {
  const completar = document.getElementById("btnCompletarPaciente");
  if (completar) { completar.onclick = () => renderPacienteDetalle(paciente._id, "paciente"); return; }

  document.querySelectorAll("#crecChips [data-indicador]").forEach(btn => {
    btn.onclick = () => {
      crecimientoIndicadorActivo = btn.dataset.indicador;
      document.querySelectorAll("#crecChips [data-indicador]").forEach(b => b.classList.toggle("activo", b === btn));
      repintarCrecimiento(paciente, mediciones);
    };
  });

  repintarCrecimiento(paciente, mediciones);

  document.getElementById("btnGuardarControl").onclick = async () => {
    const err = document.getElementById("crecErr");
    const fecha = document.getElementById("crecFecha").value;
    const leer = (id) => {
      const el = document.getElementById(id);
      if (!el || !el.value.trim()) return null;
      const n = Number(el.value);
      return Number.isFinite(n) && n > 0 ? n : NaN;
    };
    const peso = leer("crecPeso"), talla = leer("crecTalla"), peri = leer("crecPeri");

    if (!fecha) { err.innerHTML = `<div class="error">Falta la fecha del control.</div>`; return; }
    if ([peso, talla, peri].some(v => Number.isNaN(v))) { err.innerHTML = `<div class="error">Algún valor no es un número válido.</div>`; return; }
    if (peso == null && talla == null && peri == null) { err.innerHTML = `<div class="error">Cargá al menos una medida.</div>`; return; }

    const aGuardar = [];
    if (peso != null) aGuardar.push({ tipo: "peso", valor: peso });
    if (talla != null) aGuardar.push({ tipo: "talla", valor: talla });
    if (peri != null) aGuardar.push({ tipo: "perimetroCefalico", valor: peri });
    // El IMC se calcula, no se pide: pedirlo es una cuenta más que hacer a
    // mano y una más donde equivocarse.
    if (peso != null && talla != null) {
      const imc = peso / Math.pow(talla / 100, 2);
      aGuardar.push({ tipo: "imc", valor: Math.round(imc * 100) / 100 });
    }

    const btn = document.getElementById("btnGuardarControl");
    btn.disabled = true;
    err.innerHTML = "";
    try {
      for (const m of aGuardar) {
        await api(`/medico/pacientes/${paciente._id}/mediciones`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...m, fecha }),
        });
      }
      renderPacienteDetalle(paciente._id, "crecimiento");
    } catch (e) {
      btn.disabled = false;
      err.innerHTML = `<div class="error">${esc(e.error || "No se pudo guardar el control")}</div>`;
    }
  };
}
