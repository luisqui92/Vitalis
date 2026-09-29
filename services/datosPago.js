// Symphomed — A dónde le paga el médico a Symphomed.
//
// ═══ POR QUÉ ESTO NO VIVE SOLO EN EL .env ══════════════════════════════════
//
// Son datos que cambian: se abre otra cuenta, cambia el titular, se agrega un
// WhatsApp. Pedirle a alguien que entre por SSH, edite un archivo y reinicie
// el servidor para corregir un número de cuenta es la mejor forma de
// garantizar que ese número quede desactualizado — y un número de cuenta
// desactualizado significa pagos que se pierden.
//
// Así que la fuente principal es la base de datos, editable desde la pantalla
// de Pagos. El .env queda como respaldo para el primer arranque, cuando
// todavía no hay nada cargado.
//
// ═══ UNA CUENTA POR PAÍS, Y NO SE MEZCLAN ══════════════════════════════════
//
// Un médico en Bolivia paga por QR boliviano en bolivianos. Uno en Brasil
// paga por Pix en reales. No son la misma cuenta ni la misma moneda, y
// mostrarle la boliviana a un brasileño no es un detalle de presentación:
// es plata transferida a un lugar del que no vuelve.
//
// Por eso, cuando el país del médico NO tiene datos cargados, la pantalla
// dice "todavía no hay dónde pagar" en vez de caer a los del otro país. Un
// médico que no puede pagar hoy nos escribe; uno que pagó a la cuenta
// equivocada perdió el dinero y la confianza.
//
// El país sale del IDIOMA del médico, que ya es un dato de su cuenta y no del
// navegador (ver el comentario de "idioma" en db/models.js). No se agrega un
// campo nuevo para lo mismo: hoy Symphomed está en dos países y habla dos
// idiomas. El día que eso deje de coincidir —un médico brasileño que trabaja
// en español— hará falta un campo propio, y este es el lugar donde va a
// doler, a propósito.
//
//   PAGO_QR_IMAGEN / PAGO_BANCO / PAGO_CUENTA / PAGO_TITULAR /
//   PAGO_DOCUMENTO / PAGO_WHATSAPP                        → Bolivia
//   PAGO_BR_QR_IMAGEN / PAGO_BR_BANCO / PAGO_BR_CUENTA / ... → Brasil
//
// El QR sigue siendo un archivo y no un campo: es una imagen, y subir
// archivos desde el navegador es una superficie que no vale la pena abrir
// para algo que se cambia una vez cada varios años. Si el archivo está donde
// se espera, se usa solo.
const fs = require("fs");
const path = require("path");
const { ConfigPago } = require("../db/models");
const { perfil } = require("./idiomas");

const PAISES = ["bo", "br"];

// ═══ POR QUÉ BOLIVIA SIGUE GUARDADA COMO "unico" ═══════════════════════════
//
// Antes había una sola cuenta y su registro se llamaba "unico". Renombrarlo a
// "bo" quedaría más prolijo y es exactamente el tipo de prolijidad que no
// vale el riesgo: es EL registro con el número de cuenta donde ya están
// entrando los pagos, en producción. Una migración que falle a la mitad deja
// a los médicos sin saber dónde pagar.
//
// La fealdad vive acá, en una línea, y no se nota en ningún otro lado.
const CLAVE = { bo: "unico", br: "br" };

const QR_POR_DEFECTO = {
  bo: ["/pago-qr.jpg", "/pago-qr.png"],
  br: ["/pago-qr-br.jpg", "/pago-qr-br.png"],
};

function qrEnDisco(pais) {
  return QR_POR_DEFECTO[pais].find(rel =>
    fs.existsSync(path.join(__dirname, "..", "public", rel))) || "";
}

// bo → PAGO_BANCO ; br → PAGO_BR_BANCO
function delEntorno(pais) {
  const p = (campo) => process.env[pais === "bo" ? `PAGO_${campo}` : `PAGO_BR_${campo}`];
  return {
    banco: String(p("BANCO") || "").trim(),
    cuenta: String(p("CUENTA") || "").trim(),
    titular: String(p("TITULAR") || "").trim(),
    documento: String(p("DOCUMENTO") || "").trim(),
    whatsapp: String(p("WHATSAPP") || "").replace(/\D/g, ""),
    qr: String(p("QR_IMAGEN") || "").trim(),
  };
}

// El idioma de la cuenta decide el país. Ver el bloque de arriba sobre por
// qué no hay un campo aparte todavía.
function paisDelMedico(medico) {
  return perfil(medico?.idioma).pais.toLowerCase();
}

function normalizarPais(pais) {
  return PAISES.includes(pais) ? pais : "bo";
}

// Lo que ve el médico. Gana lo que esté cargado en la base; si un campo está
// vacío ahí, se cae al .env — así una instalación que ya tenía todo en el
// entorno sigue funcionando igual hasta que alguien lo edite por pantalla.
async function datosDePago(pais = "bo") {
  const p = normalizarPais(pais);
  let guardado = null;
  try {
    guardado = await ConfigPago.findOne({ clave: CLAVE[p] }).lean();
  } catch {
    // Que falle esta consulta no puede dejar sin pantalla de recarga a nadie:
    // se sigue con lo del entorno.
  }
  const env = delEntorno(p);
  const tomar = (campo) => String(guardado?.[campo] || env[campo] || "").trim();

  const qr = String(env.qr || qrEnDisco(p)).trim();
  const banco = tomar("banco");
  const cuenta = tomar("cuenta");
  const titular = tomar("titular");
  const documento = tomar("documento");
  const whatsapp = tomar("whatsapp").replace(/\D/g, "");
  // Solo la usa Brasil, para el campo 60 del código Pix. Se devuelve siempre
  // para no tener dos formas distintas de leer estos datos según el país.
  const ciudad = tomar("ciudad");

  return {
    pais: p,
    qr, banco, cuenta, titular, documento, whatsapp, ciudad,
    // Con esto la pantalla decide si mostrar la tarjeta o avisar que todavía
    // no hay dónde pagar, en vez de dejar al médico adivinando. Es por país:
    // que Bolivia esté configurada no significa que Brasil lo esté.
    configurado: Boolean(qr || (banco && cuenta)),
  };
}

// Lo guarda un operador desde la pantalla de Pagos.
async function guardarDatosDePago(campos, quien, pais = "bo") {
  const p = normalizarPais(pais);
  const limpio = {
    banco: String(campos.banco || "").trim().slice(0, 80),
    cuenta: String(campos.cuenta || "").trim().slice(0, 60),
    titular: String(campos.titular || "").trim().slice(0, 80),
    documento: String(campos.documento || "").trim().slice(0, 40),
    whatsapp: String(campos.whatsapp || "").replace(/\D/g, "").slice(0, 20),
    // Solo Brasil, pero se guarda siempre: el estándar del código Pix EXIGE
    // la ciudad del que cobra (campo 60) y algunos bancos se la muestran al
    // pagador. Sin esto no había forma de cargarla desde el panel y todos los
    // códigos salían diciendo "SAO PAULO", que es el valor por defecto de
    // services/pix.js — correcto solo por casualidad.
    ciudad: String(campos.ciudad || "").trim().slice(0, 40),
    actualizadoPor: quien,
  };
  await ConfigPago.findOneAndUpdate({ clave: CLAVE[p] }, { $set: limpio }, { upsert: true, new: true });
  return datosDePago(p);
}

module.exports = { datosDePago, guardarDatosDePago, paisDelMedico, normalizarPais, PAISES };
