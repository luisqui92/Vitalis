// Vitalis — En qué moneda cobra cada médico.
//
// ═══ POR QUÉ NO SE DEDUCE DEL IDIOMA ═══════════════════════════════════════
//
// Los datos de cobro (services/datosPago.js) sí salen del idioma, y ahí está
// bien: si mañana un médico brasileño trabaja en español, ver la cuenta
// equivocada se nota y se arregla.
//
// Con la plata no. Si la moneda saliera del idioma, un médico boliviano que
// cambia la interfaz a portugués vería su saldo de Bs 300 escrito como
// R$ 300 — y su próxima recarga se registraría en la moneda equivocada, en
// el libro mayor, para siempre. Una preferencia de pantalla no puede decidir
// qué es el dinero.
//
// Por eso la moneda es un campo propio de la cuenta, se fija al crearla y no
// la toca ninguna pantalla de configuración.
//
// ═══ Y POR QUÉ CADA MOVIMIENTO LA GUARDA ═══════════════════════════════════
//
// Porque un asiento que dice "200" y no dice de qué, no es un hecho: es un
// número. Si mañana un médico cambia de país, o si hay que sumar lo que
// entró en el mes, el libro tiene que poder responder solo, sin ir a
// preguntarle a la cuenta cómo está configurada HOY.
//
// El precio y el mínimo son por moneda. Hoy los dos arrancan en el mismo
// número (12 y 100), que NO es una conversión: es una decisión comercial
// pendiente. R$ 12 y Bs 12 no valen lo mismo.
const MONEDAS = {
  BOB: {
    codigo: "BOB",
    simbolo: "Bs",
    precioConsulta: Number(process.env.PRECIO_CONSULTA_CENTAVOS || 1200),
    recargaMinima: Number(process.env.RECARGA_MINIMA_CENTAVOS || 10000),
    // Techo por operación: no protege de un operador deshonesto —puede hacer
    // varias— pero sí de un dedo que resbala y convierte 200 en 200000.
    techoPorCarga: Number(process.env.TECHO_CARGA_CENTAVOS || 500000),
  },
  BRL: {
    codigo: "BRL",
    simbolo: "R$",
    // R$ 10,00. NO cae al precio boliviano si falta la variable: son
    // mercados distintos y el número de Bolivia acá sería una decisión que
    // nadie tomó. Antes heredaba de PRECIO_CONSULTA_CENTAVOS y eso hacía que
    // Brasil cobrara Bs 12 disfrazados de R$ 12.
    precioConsulta: Number(process.env.PRECIO_CONSULTA_CENTAVOS_BRL || 1000),
    recargaMinima: Number(process.env.RECARGA_MINIMA_CENTAVOS_BRL || process.env.RECARGA_MINIMA_CENTAVOS || 10000),
    techoPorCarga: Number(process.env.TECHO_CARGA_CENTAVOS_BRL || process.env.TECHO_CARGA_CENTAVOS || 500000),
  },
};

const POR_DEFECTO = "BOB";
const CODIGOS = Object.keys(MONEDAS);

function normalizar(codigo) {
  return MONEDAS[String(codigo || "").toUpperCase()] ? String(codigo).toUpperCase() : POR_DEFECTO;
}

function config(codigo) {
  return MONEDAS[normalizar(codigo)];
}

// Cuando se crea una cuenta nueva y nadie dijo la moneda, se toma del idioma
// —que es el único dato de país que hay en ese momento—. De ahí en adelante
// vive por su cuenta: cambiar el idioma después NO la cambia.
function monedaSegunIdioma(idioma) {
  return idioma === "pt" ? "BRL" : "BOB";
}

// "1234" → "12.34". Sin símbolo: quién lo muestra decide si va "Bs" o "R$",
// porque la pantalla del médico lo saca de su idioma y la del operador de la
// moneda del médico que está mirando.
function monto(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2);
}

// Con símbolo, para donde hace falta decirlo entero — el panel del operador,
// que ve las dos monedas a la vez, y la auditoría.
function conSimbolo(centavos, codigo) {
  return `${config(codigo).simbolo} ${monto(centavos)}`;
}

module.exports = { MONEDAS, CODIGOS, POR_DEFECTO, normalizar, config, monedaSegunIdioma, monto, conSimbolo };
