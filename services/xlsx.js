// Symphomed — Planillas de Excel (.xlsx), sin dependencias.
//
// ═══ POR QUÉ A MANO ════════════════════════════════════════════════════════
//
// Un .xlsx es un .zip con unos pocos XML adentro. Las librerías que lo
// arman (exceljs, xlsx) pesan megas, traen decenas de dependencias y hacen
// mil cosas que acá no se usan: gráficos, fórmulas, leer planillas. Lo que
// Symphomed necesita es ESCRIBIR tablas con encabezado, fechas que Excel
// entienda como fechas y montos con dos decimales. Eso son estas ~200 líneas,
// que además no hay que actualizar cada vez que una de esas librerías saca
// un aviso de seguridad.
//
// ═══ LO QUE ESTE ARCHIVO GARANTIZA ═════════════════════════════════════════
//
//   · FECHAS COMO FECHAS: se guardan como número de serie de Excel con
//     formato de fecha, así ordenar y filtrar por fecha anda. Y como día
//     CIVIL: un "2026-09-05" es el 5 de septiembre en cualquier huso, no el
//     4 a la noche en Bolivia (el mismo problema que resuelve fechaCorta()
//     en public/js/i18n.js).
//   · NADA SE EJECUTA: el texto va como texto literal (inlineStr), nunca
//     como fórmula. Un productor que anotó "=HIPERVINCULO(...)" como causa
//     de muerte ve eso escrito, no un enlace. Es la «inyección CSV» que tienen
//     las exportaciones a .csv, y que acá no puede pasar por construcción.
//   · El archivo abre en Excel, LibreOffice y Google Sheets
//     (scripts/pruebas/probar_xlsx.js lo lee de vuelta).
const zlib = require("zlib");

// ─── ZIP ────────────────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// archivos: [{ nombre, contenido (string) }] → Buffer del .zip
function zip(archivos) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  // Fecha fija (1/1/2026 00:00): el contenido no depende de la hora, y así
  // el mismo libro da siempre los mismos bytes — útil para probarlo.
  const hora = 0;
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, "utf8");
    const datos = Buffer.from(a.contenido, "utf8");
    const comprimido = zlib.deflateRawSync(datos);
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // versión necesaria
    local.writeUInt16LE(0x0800, 6);        // nombres en UTF-8
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += local.length + nombre.length + comprimido.length;
  }

  const tamCentral = centrales.reduce((a, b) => a + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, ...centrales, fin]);
}

// ─── XML ────────────────────────────────────────────────────────────────────
// Además de escapar, saca los caracteres de control que XML no admite: uno
// solo (un \u0001 pegado desde otra app) y Excel dice que el archivo está
// dañado, sin decir dónde.
function xml(texto) {
  return String(texto)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function letraColumna(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Día civil → número de serie de Excel (días desde el 30/12/1899).
// Acepta "YYYY-MM-DD" o un Date; de un Date se toma el día en UTC, que es
// como se guardan las fechas sin hora en toda la plataforma.
function serieExcel(valor) {
  let y, m, d;
  const texto = typeof valor === "string" && /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (texto) {
    [y, m, d] = [Number(texto[1]), Number(texto[2]), Number(texto[3])];
  } else {
    const f = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(f.getTime())) return null;
    [y, m, d] = [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
  }
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

// Estilos (índice en cellXfs): 0 normal · 1 encabezado · 2 fecha · 3 plata · 4 decimal
const ESTILO = { texto: 0, numero: 0, encabezado: 1, fecha: 2, plata: 3, decimal: 4 };

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.0#"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF2"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function celda(ref, valor, tipo) {
  if (valor === null || valor === undefined || valor === "") return "";
  if (tipo === "fecha") {
    const n = serieExcel(valor);
    return n == null ? "" : `<c r="${ref}" s="${ESTILO.fecha}"><v>${n}</v></c>`;
  }
  if (tipo === "numero" || tipo === "plata" || tipo === "decimal") {
    const n = Number(valor);
    if (!Number.isFinite(n)) return "";
    return `<c r="${ref}" s="${ESTILO[tipo]}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
}

function hojaXml(hoja) {
  const cols = hoja.columnas;
  const ultima = letraColumna(Math.max(cols.length - 1, 0));
  const filas = [];
  filas.push(`<row r="1">${cols.map((c, i) =>
    `<c r="${letraColumna(i)}1" t="inlineStr" s="${ESTILO.encabezado}"><is><t xml:space="preserve">${xml(c.titulo)}</t></is></c>`).join("")}</row>`);
  hoja.filas.forEach((fila, f) => {
    const r = f + 2;
    filas.push(`<row r="${r}">${cols.map((c, i) => celda(`${letraColumna(i)}${r}`, fila[i], c.tipo || "texto")).join("")}</row>`);
  });
  const anchos = cols.map((c, i) => {
    // Ancho: el que se pidió, o lo que ocupa lo más largo de la columna
    // (con tope, para que una nota larga no haga una columna de un metro).
    const largo = c.ancho || Math.min(50, Math.max(
      String(c.titulo).length + 2,
      ...hoja.filas.slice(0, 500).map(fila => (c.tipo === "fecha" ? 11 : String(fila[i] ?? "").length + 1))
    ));
    return `<col min="${i + 1}" max="${i + 1}" width="${largo}" customWidth="1"/>`;
  }).join("");
  const conFilas = hoja.filas.length > 0;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${anchos}</cols>
<sheetData>${filas.join("")}</sheetData>
${conFilas ? `<autoFilter ref="A1:${ultima}${hoja.filas.length + 1}"/>` : ""}
</worksheet>`;
}

// Excel no acepta en el nombre de una hoja : \ / ? * [ ], ni más de 31
// caracteres, ni dos hojas con el mismo nombre (sin distinguir mayúsculas).
function nombresDeHojas(hojas) {
  const usados = new Set();
  return hojas.map((h) => {
    const base = String(h.nombre || "Hoja").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Hoja";
    let nombre = base;
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    usados.add(nombre.toLowerCase());
    return nombre;
  });
}

// hojas: [{ nombre, columnas: [{ titulo, tipo: "texto"|"numero"|"decimal"|"plata"|"fecha", ancho? }], filas: [[…]] }]
function generarXlsx(hojas) {
  if (!hojas.length) throw new Error("un libro necesita al menos una hoja");
  const nombres = nombresDeHojas(hojas);
  const archivos = [
    { nombre: "[Content_Types].xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>` },
    { nombre: "_rels/.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { nombre: "xl/workbook.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${hojas.some(h => h.filas.length) ? `<definedNames>${hojas.map((h, i) => h.filas.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nombres[i]).replace(/'/g, "''")}'!$A$1:$${letraColumna(h.columnas.length - 1)}$${h.filas.length + 1}</definedName>`
    : "").join("")}</definedNames>` : ""}
</workbook>` },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nombre: "xl/styles.xml", contenido: ESTILOS_XML },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(h) })),
  ];
  return zip(archivos);
}

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

module.exports = { generarXlsx, serieExcel, letraColumna, crc32, TIPO_XLSX };
