// Vitalis — El código Pix, generado acá.
//
// ═══ EL PROBLEMA QUE RESUELVE ══════════════════════════════════════════════
//
// El QR de Brasil tenía el monto grabado adentro:
//
//     ...53039865406100.00...   ← R$ 100,00, fijo
//
// Así que solo servía para cobrar exactamente R$ 100. Para cualquier otro
// monto había que ir a pedirle un QR nuevo al proveedor, a mano, cada vez.
// Con dos médicos es una molestia; con veinte es que alguien no puede pagar
// un domingo.
//
// ═══ NO HACE FALTA NINGUNA API ═════════════════════════════════════════════
//
// Un código Pix es un texto con un formato estándar (EMV MPM, el "BR Code"
// del Banco Central). Se arma con la clave Pix, el nombre, la ciudad y el
// monto, y se le pega un CRC al final. Eso es todo. No hay servicio que
// consultar ni token que renovar.
//
// Lo que SÍ necesita un proveedor es la conciliación automática —saber que
// entró la plata y de quién— y eso es otra cosa, que llega por webhook.
// Generar el código y saber que pagaron son dos problemas distintos, y este
// archivo resuelve solo el primero.
//
// ═══ ESTE CÓDIGO NO VENCE ══════════════════════════════════════════════════
//
// No lleva la etiqueta 01 (Point of Initiation Method), así que es de los
// reutilizables: no tiene fecha de expiración. Se genera uno por recarga
// porque lleva el monto, no porque el anterior se muera.
//
// ═══ CÓMO SE VERIFICÓ ══════════════════════════════════════════════════════
//
// No se escribió leyendo la especificación y cruzando los dedos: se tomó el
// QR de Brasil que YA funcionaba —uno que un banco real aceptó— se decodificó,
// y se comprobó que este generador lo reproduce carácter por carácter, CRC
// incluido. Está en scripts/pruebas/probar_pix.js.

// CRC16/CCITT-FALSE. Es el que manda la especificación del BR Code, y es la
// parte que no perdona: un CRC mal calculado da un código que el banco
// rechaza sin decir por qué.
function crc16(texto) {
  let crc = 0xFFFF;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Cada campo es identificador + largo + valor. El largo va en dos dígitos, así
// que ningún campo puede pasar de 99 caracteres.
function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, "0") + v;
}

// El estándar no acepta acentos ni ñ en el nombre ni en la ciudad: hay bancos
// que muestran basura y otros que directamente rechazan el código. Se limpia
// acá y no en quien llama, para que no dependa de que alguien se acuerde.
function limpiar(texto, max) {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // saca los acentos
    .replace(/[^A-Za-z0-9 .\-]/g, "")
    .trim()
    .slice(0, max)
    .trim();
}

// El monto va con punto decimal y dos decimales, siempre. Se recibe en
// centavos porque es como viaja la plata en todo Vitalis: un float acá sería
// la única parte del sistema donde el dinero es aproximado.
function montoDesdeCentavos(centavos) {
  const n = Math.round(Number(centavos) || 0);
  if (n <= 0) return "";
  return (n / 100).toFixed(2);
}

// El txid identifica esta recarga. Va en el código y vuelve en el aviso del
// banco, así que es lo que va a permitir conciliar automáticamente el día que
// se conecte el webhook del proveedor. Hasta entonces no molesta.
//
// Solo letras y números, hasta 25 caracteres: es lo que acepta el estándar.
function txidLimpio(txid) {
  const t = String(txid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  // "***" es como el estándar dice "sin identificador". Un txid vacío hace
  // que algunos bancos rechacen el código.
  return t || "***";
}

// Arma el texto del código Pix. Es lo mismo que se dibuja como QR y lo mismo
// que se copia con "Pix Copia e Cola" — no son dos formatos, es el mismo.
function armarCodigo({ chave, nombre, ciudad, montoCentavos, txid }) {
  const llave = String(chave || "").trim();
  if (!llave) throw new Error("Falta la clave Pix");

  const cuenta = campo("00", "br.gov.bcb.pix") + campo("01", llave);
  const monto = montoDesdeCentavos(montoCentavos);

  let s =
    campo("00", "01") +
    campo("26", cuenta) +
    campo("52", "0000") +          // sin rubro
    campo("53", "986") +           // real brasileño
    (monto ? campo("54", monto) : "") +
    campo("58", "BR") +
    campo("59", limpiar(nombre, 25) || "RECEBEDOR") +
    campo("60", limpiar(ciudad, 15) || "SAO PAULO") +
    campo("62", campo("05", txidLimpio(txid)));

  // El CRC se calcula sobre todo lo anterior MÁS su propio encabezado.
  s += "6304";
  return s + crc16(s);
}

module.exports = { armarCodigo, crc16, montoDesdeCentavos, txidLimpio, limpiar };
