// Symphomed — Documentos PDF, sin dependencias.
//
// ═══ POR QUÉ A MANO ════════════════════════════════════════════════════════
//
// Por lo mismo que services/xlsx.js. Las librerías de PDF (pdfkit, jspdf,
// puppeteer) pesan megas, traen decenas de dependencias —puppeteer trae un
// navegador entero— y hacen mil cosas que acá no se usan. Lo que Symphomed
// necesita es escribir texto con títulos, listas y tablas, en español y
// portugués, partido en páginas, con el logo del consultorio arriba. Eso es
// este archivo.
//
// ═══ LO QUE ESTE ARCHIVO GARANTIZA ═════════════════════════════════════════
//
//   · EL TEXTO SALE COMO SE ESCRIBIÓ: tildes, ñ, ç, ã, õ, ü, «», °, —, €.
//     Se usa Helvetica, que todo lector de PDF trae adentro (no se incrusta
//     nada, el archivo pesa kilobytes), con la codificación WinAnsi. Lo que
//     esa fuente no tiene se cambia por lo más parecido («O₂» → «O2», «≥» →
//     «>=») o, si no hay nada parecido (un emoji), se saca. Nunca rompe el
//     archivo ni deja un cuadradito.
//   · NADA SE CORTA: los renglones se parten por palabra (con las medidas
//     reales de cada letra, services/pdfMetricas.js), las páginas por
//     renglón y las tablas por fila, repitiendo el encabezado de la tabla.
//     Un título nunca queda solo al pie de una hoja.
//   · «Página X de Y» en cada hoja.
//   · El logo del membrete, si es PNG o JPG. Un WEBP no se puede leer sin
//     librerías: el documento sale igual, con el nombre del consultorio.
//
// La forma de usarlo es declarativa: se arma una lista de bloques («sección»,
// «campo», «tabla»…) y generarPdf() los acomoda en páginas. Quien arma el
// documento (services/kardexPdf.js) no piensa en coordenadas.
const zlib = require("zlib");
const { HELVETICA, HELVETICA_NEGRITA } = require("./pdfMetricas");

// A4 en puntos (1/72 de pulgada).
const A4 = { ancho: 595.28, alto: 841.89 };

const FUENTES = {
  normal: { recurso: "F1", base: "Helvetica", anchos: HELVETICA },
  negrita: { recurso: "F2", base: "Helvetica-Bold", anchos: HELVETICA_NEGRITA },
  cursiva: { recurso: "F3", base: "Helvetica-Oblique", anchos: HELVETICA },
};

const COLORES = {
  texto: [0.10, 0.11, 0.12],
  tenue: [0.38, 0.40, 0.42],
  primario: [0.04, 0.37, 0.43], // verde azulado oscuro: se lee bien también en blanco y negro
  linea: [0.78, 0.80, 0.82],
  fondoTabla: [0.93, 0.95, 0.96],
  peligro: [0.70, 0.11, 0.11],
  fondoPeligro: [0.99, 0.94, 0.94],
  aviso: [0.55, 0.42, 0.05],
  fondoAviso: [0.99, 0.97, 0.90],
};

// ═══ TEXTO → WINANSI ═══════════════════════════════════════════════════════
//
// Los 32 lugares de 0x80 a 0x9F que WinAnsi usa distinto que Latin-1.
const ESPECIALES = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// Lo que no está en la fuente pero tiene un equivalente que se entiende.
const SUSTITUTOS = {
  "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "↑": "^", "↓": "v", "≈": "~", "≠": "!=",
  "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "—", "′": "'", "″": "\"",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  "✓": "", "✔": "", "✗": "x", "✘": "x",
};

function esWinAnsi(k) {
  return (k >= 0x20 && k <= 0x7e) || (k >= 0xa0 && k <= 0xff);
}

// Devuelve un string donde cada carácter es un byte WinAnsi (código < 256).
// Los saltos de línea se conservan: los usa partirEnRenglones.
function aWinAnsi(texto) {
  let out = "";
  for (const ch of String(texto == null ? "" : texto)) {
    const c = ch.codePointAt(0);
    if (c === 10) { out += "\n"; continue; }
    if (c === 9) { out += " "; continue; }
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) continue;     // controles
    if (c === 0xa0) { out += " "; continue; }               // espacio duro
    if (c === 0xad) continue;                                // guion opcional
    if (esWinAnsi(c)) { out += ch; continue; }
    if (ESPECIALES[c]) { out += String.fromCharCode(ESPECIALES[c]); continue; }
    if (SUSTITUTOS[ch] !== undefined) { out += aWinAnsi(SUSTITUTOS[ch]); continue; }
    // Lo más parecido: «ő» → «o», «₂» → «2», «ﬁ» → «fi».
    const parecido = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (parecido && parecido !== ch && [...parecido].every(x => esWinAnsi(x.codePointAt(0)))) {
      out += parecido;
    }
    // Un emoji, un ideograma: no hay forma de dibujarlo con esta fuente.
  }
  return out;
}

// Ancho en puntos de un texto YA convertido con aWinAnsi.
function anchoTexto(textoWin, estilo = "normal", tamano = 10) {
  const anchos = (FUENTES[estilo] || FUENTES.normal).anchos;
  let total = 0;
  for (let i = 0; i < textoWin.length; i++) total += anchos[textoWin.charCodeAt(i)] || 0;
  return (total * tamano) / 1000;
}

// ═══ PARTIR EN RENGLONES ═══════════════════════════════════════════════════
//
// partes: [{ texto (WinAnsi), estilo, tamano, color }] — un párrafo puede
// mezclar negrita y normal («Diagnóstico: hipertensión»).
// Devuelve [{ segmentos: [{ x, texto, estilo, tamano, color }], ancho }].
function partirEnRenglones(partes, anchoMax) {
  const renglones = [];
  let actual = { segmentos: [], ancho: 0 };
  const cerrar = () => { renglones.push(actual); actual = { segmentos: [], ancho: 0 }; };

  const agregar = (texto, p) => {
    const ultimo = actual.segmentos[actual.segmentos.length - 1];
    const w = anchoTexto(texto, p.estilo, p.tamano);
    if (ultimo && ultimo.estilo === p.estilo && ultimo.tamano === p.tamano && ultimo.color === p.color) {
      ultimo.texto += texto;
    } else {
      actual.segmentos.push({ x: actual.ancho, texto, estilo: p.estilo, tamano: p.tamano, color: p.color });
    }
    actual.ancho += w;
  };

  for (const p of partes) {
    let espacioPendiente = false;
    for (const pieza of p.texto.split(/(\n| +)/)) {
      if (!pieza) continue;
      if (pieza === "\n") { cerrar(); espacioPendiente = false; continue; }
      if (pieza[0] === " ") { espacioPendiente = true; continue; }
      const anchoEspacio = espacioPendiente && actual.segmentos.length ? anchoTexto(" ", p.estilo, p.tamano) : 0;
      const w = anchoTexto(pieza, p.estilo, p.tamano);
      if (actual.ancho + anchoEspacio + w <= anchoMax) {
        agregar((anchoEspacio ? " " : "") + pieza, p);
      } else if (!actual.segmentos.length && w > anchoMax) {
        // Una palabra más larga que el renglón (un código, una dirección):
        // se corta por letra en vez de salirse del margen.
        let resto = pieza;
        while (resto) {
          let n = resto.length;
          while (n > 1 && anchoTexto(resto.slice(0, n), p.estilo, p.tamano) > anchoMax - actual.ancho) n--;
          agregar(resto.slice(0, n), p);
          resto = resto.slice(n);
          if (resto) cerrar();
        }
      } else {
        if (actual.segmentos.length) cerrar();
        if (w > anchoMax) {
          let resto = pieza;
          while (resto) {
            let n = resto.length;
            while (n > 1 && anchoTexto(resto.slice(0, n), p.estilo, p.tamano) > anchoMax) n--;
            agregar(resto.slice(0, n), p);
            resto = resto.slice(n);
            if (resto) cerrar();
          }
        } else {
          agregar(pieza, p);
        }
      }
      espacioPendiente = false;
    }
    // Un espacio al final de una parte («Motivo: » + «dolor») se respeta.
    if (espacioPendiente && actual.segmentos.length) agregar(" ", p);
  }
  if (actual.segmentos.length || !renglones.length) cerrar();
  return renglones;
}

// ═══ IMÁGENES (el logo del membrete) ═══════════════════════════════════════

function medidasJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marca = buf[i + 1];
    const largo = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC): ahí están las medidas.
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7), componentes: buf[i + 9] };
    }
    i += 2 + largo;
  }
  return null;
}

// Lee un PNG y devuelve los píxeles separados en color y transparencia, que
// es como los quiere un PDF. Sin entrelazado; cualquier tipo de color.
function decodificarPng(buf) {
  const FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 33 || FIRMA.some((b, i) => buf[i] !== b)) return null;
  let i = 8, ancho = 0, alto = 0, bits = 0, tipo = 0, entrelazado = 0, paleta = null, trns = null;
  const idat = [];
  while (i + 8 <= buf.length) {
    const largo = buf.readUInt32BE(i);
    const nombre = buf.toString("latin1", i + 4, i + 8);
    const datos = buf.subarray(i + 8, i + 8 + largo);
    if (nombre === "IHDR") {
      ancho = datos.readUInt32BE(0); alto = datos.readUInt32BE(4);
      bits = datos[8]; tipo = datos[9]; entrelazado = datos[12];
    } else if (nombre === "PLTE") paleta = datos;
    else if (nombre === "tRNS") trns = datos;
    else if (nombre === "IDAT") idat.push(datos);
    else if (nombre === "IEND") break;
    i += 12 + largo;
  }
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipo];
  if (!ancho || !alto || !canales || entrelazado || ![1, 2, 4, 8, 16].includes(bits)) return null;
  if (tipo === 3 && !paleta) return null;
  if (ancho * alto > 4096 * 4096) return null;

  let crudo;
  try { crudo = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const bitsPixel = canales * bits;
  const bpp = Math.max(1, Math.ceil(bitsPixel / 8));
  const fila = Math.ceil((ancho * bitsPixel) / 8);
  if (crudo.length < alto * (fila + 1)) return null;

  // Deshacer los filtros de cada fila (None, Sub, Up, Average, Paeth).
  const px = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const ent = y * (fila + 1) + 1;
    const sal = y * fila;
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? px[sal + x - bpp] : 0;
      const b = y > 0 ? px[sal - fila + x] : 0;
      const c = x >= bpp && y > 0 ? px[sal - fila + x - bpp] : 0;
      let v = crudo[ent + x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[sal + x] = v & 0xff;
    }
  }

  // Leer la muestra n-ésima de una fila (cualquier profundidad) en 0..255.
  const maximo = (1 << Math.min(bits, 8)) - 1;
  const muestra = (y, n) => {
    if (bits === 8) return px[y * fila + n];
    if (bits === 16) return px[y * fila + n * 2]; // el byte alto alcanza
    const bit = n * bits;
    const byte = px[y * fila + (bit >> 3)];
    return (byte >> (8 - bits - (bit & 7))) & maximo;
  };
  const escalar = (v) => (bits >= 8 ? v : Math.round((v * 255) / maximo));

  const esGris = tipo === 0 || tipo === 4;
  const color = Buffer.alloc(ancho * alto * (esGris ? 1 : 3));
  const alfa = Buffer.alloc(ancho * alto, 255);
  let hayAlfa = tipo === 4 || tipo === 6;
  const trnsGris = trns && tipo === 0 && trns.length >= 2 ? trns.readUInt16BE(0) : null;
  const trnsRgb = trns && tipo === 2 && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  if (trnsGris !== null || trnsRgb || (tipo === 3 && trns)) hayAlfa = true;
  // tRNS guarda el valor en la profundidad del PNG; con 16 bits se compara el byte alto.
  const comoTrns = (v) => (bits === 16 ? v >> 8 : v);

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const k = y * ancho + x;
      if (tipo === 3) {
        const indice = muestra(y, x);
        color[k * 3] = paleta[indice * 3] || 0;
        color[k * 3 + 1] = paleta[indice * 3 + 1] || 0;
        color[k * 3 + 2] = paleta[indice * 3 + 2] || 0;
        if (trns && indice < trns.length) alfa[k] = trns[indice];
      } else if (tipo === 0) {
        const v = muestra(y, x);
        color[k] = escalar(v);
        if (trnsGris !== null && v === comoTrns(trnsGris)) alfa[k] = 0;
      } else if (tipo === 4) {
        color[k] = muestra(y, x * 2);
        alfa[k] = muestra(y, x * 2 + 1);
      } else if (tipo === 2) {
        const r = muestra(y, x * 3), g = muestra(y, x * 3 + 1), b = muestra(y, x * 3 + 2);
        color[k * 3] = r; color[k * 3 + 1] = g; color[k * 3 + 2] = b;
        if (trnsRgb && r === comoTrns(trnsRgb[0]) && g === comoTrns(trnsRgb[1]) && b === comoTrns(trnsRgb[2])) alfa[k] = 0;
      } else {
        color[k * 3] = muestra(y, x * 4);
        color[k * 3 + 1] = muestra(y, x * 4 + 1);
        color[k * 3 + 2] = muestra(y, x * 4 + 2);
        alfa[k] = muestra(y, x * 4 + 3);
      }
    }
  }
  return { ancho, alto, canales: esGris ? 1 : 3, color, alfa: hayAlfa ? alfa : null };
}

// data:image/png;base64,... → lo que hace falta para incrustarla, o null.
function leerImagen(dataUri) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUri || ""));
  if (!m) return null;
  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch { return null; }
  if (/jpe?g/i.test(m[1])) {
    const med = medidasJpeg(buf);
    // CMYK (4 componentes) sale con los colores invertidos en muchos
    // lectores: mejor sin logo que con un logo en negativo.
    if (!med || ![1, 3].includes(med.componentes)) return null;
    return { tipo: "jpeg", ancho: med.ancho, alto: med.alto, canales: med.componentes, datos: buf };
  }
  const png = decodificarPng(buf);
  return png ? { tipo: "png", ...png } : null;
}

// ═══ LOS BLOQUES ═══════════════════════════════════════════════════════════
//
// Cada bloque se convierte en "filas": pedazos que no se parten entre
// páginas (un renglón, una fila de tabla, un recuadro). Cada fila sabe su
// alto y cómo dibujarse en (x, y).
const INTERLINEA = 1.32;

function textoOps(x, yBase, seg) {
  return { op: "texto", x: x + seg.x, y: yBase, texto: seg.texto, estilo: seg.estilo, tamano: seg.tamano, color: seg.color };
}

function filasDeRenglones(renglones, { x0 = 0, tamano, espacioDespues = 0 }) {
  const alto = tamano * INTERLINEA;
  return renglones.map((r, i) => ({
    alto: alto + (i === renglones.length - 1 ? espacioDespues : 0),
    dibujar: (x, y) => r.segmentos.map(s => textoOps(x + x0, y + tamano * 0.95, s)),
  }));
}

function partesDe(bloque, tamano, color) {
  if (Array.isArray(bloque.partes)) {
    return bloque.partes.map(p => ({ texto: aWinAnsi(p.texto), estilo: p.estilo || "normal", tamano: p.tamano || tamano, color: p.color || color }));
  }
  return [{ texto: aWinAnsi(bloque.texto), estilo: bloque.estilo || "normal", tamano, color }];
}

// «continuacion»: un texto corto que se repite arriba si el bloque sigue en
// la página siguiente («30/08/2026, 10:30 (continuación)»). Sin eso, el
// renglón que pasa de hoja no dice de qué consulta es.
function medirBloque(b, anchoUtil) {
  const m = medirBloqueSolo(b, anchoUtil);
  if (b.continuacion && m.filas.length) {
    const tamano = 8;
    const texto = aWinAnsi(b.continuacion);
    m.continuacion = {
      alto: tamano * INTERLINEA + 3,
      dibujar: (x, y) => [{ op: "texto", x, y: y + tamano * 0.95, texto, estilo: "cursiva", tamano, color: COLORES.tenue }],
    };
  }
  return m;
}

function medirBloqueSolo(b, anchoUtil) {
  switch (b.tipo) {
    case "titulo": {
      const tamano = b.tamano || 15;
      const r = partirEnRenglones([{ texto: aWinAnsi(b.texto), estilo: "negrita", tamano, color: COLORES.texto }], anchoUtil);
      return { antes: 4, filas: filasDeRenglones(r, { tamano, espacioDespues: 4 }), conSiguiente: true };
    }
    case "seccion": {
      const tamano = 11;
      const r = partirEnRenglones([{ texto: aWinAnsi(String(b.texto).toUpperCase()), estilo: "negrita", tamano, color: COLORES.primario }], anchoUtil);
      const filas = filasDeRenglones(r, { tamano });
      const ultima = filas[filas.length - 1];
      const dibujarTexto = ultima.dibujar;
      ultima.alto += 7;
      ultima.dibujar = (x, y) => [
        ...dibujarTexto(x, y),
        { op: "linea", x1: x, y1: y + tamano * INTERLINEA + 1.5, x2: x + anchoUtil, y2: y + tamano * INTERLINEA + 1.5, grosor: 0.8, color: COLORES.primario },
      ];
      return { antes: 16, filas, conSiguiente: true };
    }
    case "subtitulo": {
      const tamano = 10;
      const partes = [{ texto: aWinAnsi(b.texto), estilo: "negrita", tamano, color: COLORES.texto }];
      if (b.extra) partes.push({ texto: aWinAnsi("  " + b.extra), estilo: "cursiva", tamano: 8.5, color: b.colorExtra || COLORES.tenue });
      return { antes: 9, filas: filasDeRenglones(partirEnRenglones(partes, anchoUtil), { tamano, espacioDespues: 2 }), conSiguiente: true };
    }
    case "parrafo":
    case "campo":
    case "nota": {
      // Un campo sin valor no se imprime: «Diagnóstico:» y nada abajo se lee
      // como que se evaluó y no se encontró nada.
      if (b.tipo === "campo" && !String(b.valor == null ? "" : b.valor).trim()) return { antes: 0, filas: [] };
      const tamano = b.tamano || (b.tipo === "nota" ? 8 : 9.5);
      let partes;
      if (b.tipo === "campo") {
        partes = [
          { texto: aWinAnsi(b.etiqueta + ": "), estilo: "negrita", tamano, color: COLORES.texto },
          { texto: aWinAnsi(b.valor), estilo: "normal", tamano, color: COLORES.texto },
        ];
      } else if (b.tipo === "nota") {
        partes = [{ texto: aWinAnsi(b.texto), estilo: "cursiva", tamano, color: COLORES.tenue }];
      } else {
        partes = partesDe(b, tamano, b.color || COLORES.texto);
      }
      const sangria = b.sangria || 0;
      const r = partirEnRenglones(partes, anchoUtil - sangria);
      return { antes: b.antes != null ? b.antes : (b.tipo === "nota" ? 6 : 3), filas: filasDeRenglones(r, { x0: sangria, tamano }) };
    }
    case "lista": {
      const tamano = b.tamano || 9.5;
      const sangria = 11;
      const filas = [];
      for (const item of b.items || []) {
        const partes = Array.isArray(item)
          ? item.map(p => ({ texto: aWinAnsi(p.texto), estilo: p.estilo || "normal", tamano, color: COLORES.texto }))
          : [{ texto: aWinAnsi(item), estilo: "normal", tamano, color: COLORES.texto }];
        const r = partirEnRenglones(partes, anchoUtil - sangria);
        const deItem = filasDeRenglones(r, { x0: sangria, tamano });
        const primera = deItem[0].dibujar;
        deItem[0].dibujar = (x, y) => [
          { op: "texto", x: x + 2, y: y + tamano * 0.95, texto: "\x95", estilo: "normal", tamano, color: COLORES.primario },
          ...primera(x, y),
        ];
        deItem[deItem.length - 1].alto += 1.5;
        filas.push(...deItem);
      }
      return { antes: 3, filas };
    }
    case "tabla": {
      const tamano = b.tamano || 8.5;
      const pad = 4;
      const anchos = b.columnas.map(c => c.ancho * anchoUtil);
      const alto = tamano * INTERLINEA;
      const celdas = (valores, estilo) => valores.map((v, i) =>
        partirEnRenglones([{ texto: aWinAnsi(v), estilo, tamano, color: COLORES.texto }], anchos[i] - pad * 2));
      const filaDe = (valores, estilo, fondo) => {
        const cel = celdas(valores, estilo);
        const n = Math.max(1, ...cel.map(c => c.length));
        return {
          alto: n * alto + pad * 2,
          dibujar: (x, y) => {
            const ops = [];
            if (fondo) ops.push({ op: "rect", x, y, ancho: anchoUtil, alto: n * alto + pad * 2, relleno: fondo });
            let cx = x;
            cel.forEach((renglones, i) => {
              renglones.forEach((r, j) => r.segmentos.forEach(s => ops.push(textoOps(cx + pad, y + pad + j * alto + tamano * 0.95, s))));
              cx += anchos[i];
            });
            ops.push({ op: "linea", x1: x, y1: y + n * alto + pad * 2, x2: x + anchoUtil, y2: y + n * alto + pad * 2, grosor: 0.4, color: COLORES.linea });
            return ops;
          },
        };
      };
      const encabezado = filaDe(b.columnas.map(c => c.titulo), "negrita", COLORES.fondoTabla);
      const filas = [encabezado, ...(b.filas || []).map(f => ({ ...filaDe(f, "normal", null), encabezado }))];
      return { antes: 5, filas };
    }
    case "alerta": {
      const tamano = 9.5;
      const pad = 7;
      const peligro = b.nivel !== "aviso";
      const borde = peligro ? COLORES.peligro : COLORES.aviso;
      const fondo = peligro ? COLORES.fondoPeligro : COLORES.fondoAviso;
      const titulo = partirEnRenglones([{ texto: aWinAnsi(b.titulo), estilo: "negrita", tamano, color: borde }], anchoUtil - pad * 2);
      const cuerpo = partirEnRenglones(partesDe(b, tamano, COLORES.texto), anchoUtil - pad * 2);
      const renglones = [...titulo, ...cuerpo];
      const altoR = tamano * INTERLINEA;
      const total = renglones.length * altoR + pad * 2;
      return {
        antes: 8,
        filas: [{
          alto: total,
          dibujar: (x, y) => [
            { op: "rect", x, y, ancho: anchoUtil, alto: total, relleno: fondo, borde, grosor: 1 },
            ...renglones.flatMap((r, j) => r.segmentos.map(s => textoOps(x + pad, y + pad + j * altoR + tamano * 0.95, s))),
          ],
        }],
      };
    }
    case "separador":
      return { antes: 6, filas: [{ alto: 8, dibujar: (x, y) => [{ op: "linea", x1: x, y1: y + 2, x2: x + anchoUtil, y2: y + 2, grosor: 0.4, color: COLORES.linea }] }] };
    case "espacio":
      return { antes: 0, filas: [{ alto: b.alto || 10, dibujar: () => [] }] };
    case "firma": {
      const tamano = 9;
      const ancho = Math.min(240, anchoUtil * 0.6);
      const lineas = (b.lineas || []).filter(Boolean).map(l => aWinAnsi(l));
      const altoR = tamano * INTERLINEA;
      const total = 46 + lineas.length * altoR;
      return {
        antes: 18,
        filas: [{
          alto: total,
          dibujar: (x, y) => {
            const x0 = x + (anchoUtil - ancho) / 2;
            const ops = [{ op: "linea", x1: x0, y1: y + 38, x2: x0 + ancho, y2: y + 38, grosor: 0.6, color: COLORES.tenue }];
            lineas.forEach((l, i) => {
              const estilo = i === 0 ? "negrita" : "normal";
              const w = anchoTexto(l, estilo, tamano);
              ops.push({ op: "texto", x: x + (anchoUtil - w) / 2, y: y + 44 + i * altoR + tamano * 0.95 - 4, texto: l, estilo, tamano, color: i === lineas.length - 1 && lineas.length > 1 ? COLORES.tenue : COLORES.texto });
            });
            return ops;
          },
        }],
      };
    }
    default:
      throw new Error(`bloque desconocido: ${b.tipo}`);
  }
}

// ═══ ACOMODAR EN PÁGINAS ═══════════════════════════════════════════════════
function maquetar(bloques, { pagina, margen, encabezado, pie }) {
  const anchoUtil = pagina.ancho - margen.izquierdo - margen.derecho;
  const limiteInferior = pagina.alto - margen.inferior;
  const paginas = [];
  let y = 0;
  let actual = null;

  const nueva = () => {
    const numero = paginas.length + 1;
    const enc = encabezado ? encabezado({ pagina: numero, anchoUtil, margen, hoja: pagina }) : { alto: 0, ops: [] };
    actual = { ops: [...enc.ops], inicio: margen.superior + enc.alto };
    paginas.push(actual);
    y = actual.inicio;
  };
  nueva();

  const medidos = bloques.filter(Boolean).map(b => medirBloque(b, anchoUtil));
  medidos.forEach((m, i) => {
    if (!m.filas.length) return;
    const alPrincipio = y <= actual.inicio + 0.01;
    // Un título no queda solo al pie: necesita lugar para él y al menos dos
    // renglones de lo que encabeza.
    if (m.conSiguiente && !alPrincipio) {
      const siguiente = medidos[i + 1];
      const deLoQueSigue = siguiente ? siguiente.filas.slice(0, 2).reduce((s, f) => s + f.alto, 0) + siguiente.antes : 0;
      const necesita = m.antes + m.filas.reduce((s, f) => s + f.alto, 0) + deLoQueSigue;
      if (y + necesita > limiteInferior) nueva();
    }
    if (y > actual.inicio + 0.01) {
      y += m.antes;
      // El bloque entero no entra: va a la hoja siguiente, y si es parte de
      // algo que empezó en esta, lo dice.
      if (y + m.filas[0].alto > limiteInferior) {
        nueva();
        if (m.continuacion) {
          actual.ops.push(...m.continuacion.dibujar(margen.izquierdo, y));
          y += m.continuacion.alto;
        }
      }
    }
    for (const f of m.filas) {
      if (y + f.alto > limiteInferior && y > actual.inicio + 0.01) {
        nueva();
        if (m.continuacion) {
          actual.ops.push(...m.continuacion.dibujar(margen.izquierdo, y));
          y += m.continuacion.alto;
        }
        if (f.encabezado) {
          actual.ops.push(...f.encabezado.dibujar(margen.izquierdo, y));
          y += f.encabezado.alto;
        }
      }
      actual.ops.push(...f.dibujar(margen.izquierdo, y));
      y += f.alto;
    }
  });

  if (pie) paginas.forEach((p, i) => p.ops.push(...pie({ pagina: i + 1, total: paginas.length, anchoUtil, margen, hoja: pagina })));
  return paginas;
}

// ═══ ESCRIBIR EL ARCHIVO ═══════════════════════════════════════════════════
const num = (n) => {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
};
const colorPdf = (c, trazo) => `${num(c[0])} ${num(c[1])} ${num(c[2])} ${trazo ? "RG" : "rg"}`;
const escaparPdf = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Texto de metadatos (título del documento): UTF-16 con BOM, en hexadecimal,
// así el título se ve con tildes en la ventana del lector.
function textoMeta(s) {
  const b = Buffer.from("﻿" + String(s || ""), "utf16le");
  for (let i = 0; i < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  return `<${b.toString("hex").toUpperCase()}>`;
}

function fechaPdf(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function contenidoDePagina(ops, alto, nombresImagen) {
  const partes = [];
  for (const o of ops) {
    if (o.op === "texto") {
      if (!o.texto) continue;
      const f = FUENTES[o.estilo] || FUENTES.normal;
      partes.push(`BT /${f.recurso} ${num(o.tamano)} Tf ${colorPdf(o.color || COLORES.texto)} ${num(o.x)} ${num(alto - o.y)} Td (${escaparPdf(o.texto)}) Tj ET`);
    } else if (o.op === "linea") {
      partes.push(`${colorPdf(o.color || COLORES.linea, true)} ${num(o.grosor || 0.5)} w ${num(o.x1)} ${num(alto - o.y1)} m ${num(o.x2)} ${num(alto - o.y2)} l S`);
    } else if (o.op === "rect") {
      const r = `${num(o.x)} ${num(alto - o.y - o.alto)} ${num(o.ancho)} ${num(o.alto)} re`;
      if (o.relleno && o.borde) partes.push(`${colorPdf(o.relleno)} ${colorPdf(o.borde, true)} ${num(o.grosor || 0.5)} w ${r} B`);
      else if (o.relleno) partes.push(`${colorPdf(o.relleno)} ${r} f`);
      else if (o.borde) partes.push(`${colorPdf(o.borde, true)} ${num(o.grosor || 0.5)} w ${r} S`);
    } else if (o.op === "imagen") {
      const nombre = nombresImagen[o.id];
      if (nombre) partes.push(`q ${num(o.ancho)} 0 0 ${num(o.alto)} ${num(o.x)} ${num(alto - o.y - o.alto)} cm /${nombre} Do Q`);
    }
  }
  return partes.join("\n");
}

function escribir(paginas, { pagina, info, imagenes }) {
  const objetos = []; // índice = número de objeto - 1; cada uno Buffer
  const reservar = () => { objetos.push(null); return objetos.length; };
  const fijar = (n, contenido) => { objetos[n - 1] = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, "latin1"); };
  const flujo = (diccionario, datos) => Buffer.concat([
    Buffer.from(`<< ${diccionario} /Length ${datos.length} >>\nstream\n`, "latin1"), datos, Buffer.from("\nendstream", "latin1"),
  ]);

  const catalogo = reservar();
  const raizPaginas = reservar();
  const fuentes = {};
  for (const [clave, f] of Object.entries(FUENTES)) {
    fuentes[clave] = reservar();
    fijar(fuentes[clave], `<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
  }

  const nombresImagen = {};
  const recursosImagen = [];
  let nImagen = 0;
  for (const [id, img] of Object.entries(imagenes || {})) {
    if (!img) continue;
    const n = reservar();
    const nombre = `Im${++nImagen}`;
    if (img.tipo === "jpeg") {
      fijar(n, flujo(`/Type /XObject /Subtype /Image /Width ${img.ancho} /Height ${img.alto} /ColorSpace /${img.canales === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`, img.datos));
    } else {
      let mascara = "";
      if (img.alfa) {
        const m = reservar();
        fijar(m, flujo(`/Type /XObject /Subtype /Image /Width ${img.ancho} /Height ${img.alto} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(img.alfa)));
        mascara = ` /SMask ${m} 0 R`;
      }
      fijar(n, flujo(`/Type /XObject /Subtype /Image /Width ${img.ancho} /Height ${img.alto} /ColorSpace /${img.canales === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /FlateDecode${mascara}`, zlib.deflateSync(img.color)));
    }
    nombresImagen[id] = nombre;
    recursosImagen.push(`/${nombre} ${n} 0 R`);
  }

  const recursos = `<< /Font << ${Object.entries(FUENTES).map(([k, f]) => `/${f.recurso} ${fuentes[k]} 0 R`).join(" ")} >>${recursosImagen.length ? ` /XObject << ${recursosImagen.join(" ")} >>` : ""} >>`;
  const hijos = [];
  for (const p of paginas) {
    const nPagina = reservar();
    const nContenido = reservar();
    const datos = zlib.deflateSync(Buffer.from(contenidoDePagina(p.ops, pagina.alto, nombresImagen), "latin1"));
    fijar(nContenido, flujo("/Filter /FlateDecode", datos));
    fijar(nPagina, `<< /Type /Page /Parent ${raizPaginas} 0 R /MediaBox [0 0 ${num(pagina.ancho)} ${num(pagina.alto)}] /Resources ${recursos} /Contents ${nContenido} 0 R >>`);
    hijos.push(`${nPagina} 0 R`);
  }
  fijar(catalogo, `<< /Type /Catalog /Pages ${raizPaginas} 0 R >>`);
  fijar(raizPaginas, `<< /Type /Pages /Kids [${hijos.join(" ")}] /Count ${paginas.length} >>`);
  const nInfo = reservar();
  const creado = info?.creado instanceof Date ? info.creado : new Date();
  fijar(nInfo, `<< /Title ${textoMeta(info?.titulo)} /Author ${textoMeta(info?.autor)} /Producer (Symphomed) /CreationDate (${fechaPdf(creado)}) >>`);

  // El ensamblado: cabecera, objetos, tabla de posiciones (xref) y cola.
  const trozos = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let posicion = trozos[0].length;
  const posiciones = [];
  objetos.forEach((contenido, i) => {
    const encabezadoObj = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
    const cierre = Buffer.from("\nendobj\n", "latin1");
    posiciones.push(posicion);
    trozos.push(encabezadoObj, contenido, cierre);
    posicion += encabezadoObj.length + contenido.length + cierre.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n`, "0000000000 65535 f \n", ...posiciones.map(p => `${String(p).padStart(10, "0")} 00000 n \n`)].join("");
  trozos.push(Buffer.from(xref, "latin1"));
  trozos.push(Buffer.from(`trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R /Info ${nInfo} 0 R >>\nstartxref\n${posicion}\n%%EOF\n`, "latin1"));
  return Buffer.concat(trozos);
}

// ═══ LA PUERTA DE ENTRADA ══════════════════════════════════════════════════
//
// generarPdf({
//   bloques: [{ tipo: "seccion", texto }, { tipo: "campo", etiqueta, valor }, …],
//   encabezado: ({ pagina, anchoUtil, margen }) => ({ alto, ops }),   // opcional
//   pie: ({ pagina, total, anchoUtil, margen }) => ops,               // opcional
//   imagenes: { logo: "data:image/png;base64,…" },                     // opcional
//   info: { titulo, autor, creado },
// }) → Buffer
//
// encabezado y pie reciben además `imagen(id)` (medidas de una imagen ya
// leída, o null) y dibujan con las mismas operaciones que los bloques.
function generarPdf({ bloques, encabezado, pie, imagenes = {}, info = {}, margen: margenPedido } = {}) {
  const pagina = A4;
  const margen = { superior: 36, inferior: 54, izquierdo: 50, derecho: 50, ...(margenPedido || {}) };
  const leidas = {};
  for (const [id, uri] of Object.entries(imagenes)) leidas[id] = leerImagen(uri);
  const imagen = (id) => (leidas[id] ? { ancho: leidas[id].ancho, alto: leidas[id].alto } : null);
  const paginas = maquetar(bloques || [], {
    pagina, margen,
    encabezado: encabezado ? (ctx) => encabezado({ ...ctx, imagen }) : null,
    pie: pie ? (ctx) => pie({ ...ctx, imagen }) : null,
  });
  return escribir(paginas, { pagina, info, imagenes: leidas });
}

module.exports = {
  generarPdf, aWinAnsi, anchoTexto, partirEnRenglones, decodificarPng, medidasJpeg, leerImagen,
  A4, COLORES,
};
