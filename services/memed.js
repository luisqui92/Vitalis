// Symphomed — Recetar en Brasil: Memed.
//
// ═══ POR QUÉ NO ALCANZA LA RECETA DE SYMPHOMED ═══════════════════════════════
//
// La receta de Symphomed (routes/recetas.js) es un documento que se imprime.
// En Bolivia eso funciona. En Brasil no: una prescripción necesita firma
// digital ICP-Brasil para tener validez legal, y un PDF lindo sin firmar no
// es una receta — es un papel.
//
// Memed emite con esa firma. Así que en Brasil no se receta "también" por
// Memed: se receta SOLO por Memed. Dos botones de recetar, uno con validez
// legal y otro sin ella, es una trampa esperando a que alguien apurado use
// el equivocado.
//
// ═══ ESTO NO ES UNA API QUE DEVUELVE UN PDF ════════════════════════════════
//
// Memed es un módulo que se embebe: el médico prescribe DENTRO de la pantalla
// de Memed, que Symphomed muestra. El reparto es:
//
//   · el backend (este archivo) registra al médico con la API Key y la
//     Secret Key, y recibe un token propio de ese médico;
//   · el navegador carga el módulo de Memed con ese token y le pasa el
//     paciente;
//   · la receta firmada QUEDA EN MEMED. Symphomed guarda la referencia y una
//     copia de los medicamentos —que son dato clínico y los necesita el hilo
//     clínico y el brief—, pero el documento legal no es suyo y no finge
//     serlo.
//
// Las llaves NUNCA salen del servidor. Lo único que viaja al navegador es el
// token de ese médico, que además no es fijo: se pide cada vez.
//
// ═══ LO QUE NO PUDE VERIFICAR ══════════════════════════════════════════════
//
// Esto se escribió leyendo la documentación de Memed, no ejecutándolo: su
// ambiente de pruebas contestaba 503 al momento de escribirlo. Por eso cada
// respuesta inesperada se registra ENTERA en el log en vez de morir con un
// mensaje genérico — el primer uso real es lo que va a decir la verdad.
const axios = require("axios");
const { log } = require("../config");

// Las de staging son públicas: están en la documentación de Memed
// (doc.memed.com.br). Sirven para desarrollar. Las de producción se entregan
// después de que Memed valide técnicamente la integración.
const API_URL = (process.env.MEMED_API_URL || "https://integrations.api.memed.com.br/v1").replace(/\/+$/, "");
const API_KEY = String(process.env.MEMED_API_KEY || "").trim();
const SECRET_KEY = String(process.env.MEMED_SECRET_KEY || "").trim();

// El script del módulo que carga el navegador. Va en una variable porque el
// dominio cambia entre pruebas y producción, y porque tiene que coincidir
// con lo que permite la CSP (ver dominiosCsp más abajo).
const SCRIPT_URL = process.env.MEMED_SCRIPT_URL
  || "https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js";

const TIMEOUT = Number(process.env.MEMED_TIMEOUT_MS || 15000);

function configurado() {
  return Boolean(API_KEY && SECRET_KEY);
}

// ═══ APAGADO HASTA NUEVO AVISO ═════════════════════════════════════════════
//
// Se descartó Memed por el momento: un médico en Brasil no pudo bajar el PDF
// de la receta, y se decidió volver a la receta de Symphomed (impresa,
// firmada y sellada a mano) también en Brasil. El código queda, apagado:
// prenderlo es poner MEMED_ACTIVO=si en el .env, sin tocar nada más.
//
// Apagado significa: nadie ve el botón de Memed, la receta de Symphomed
// vuelve a estar para todos, las rutas de Memed contestan 404 y la CSP deja
// de permitir sus dominios (una excepción que no se usa no debe quedar).
function activo() {
  return String(process.env.MEMED_ACTIVO || "").trim().toLowerCase() === "si";
}

// Los dominios que la CSP tiene que dejar pasar para que el módulo cargue.
//
// Sale de acá y no de una lista escrita a mano en index.js por una razón
// práctica: si Memed pide un dominio más que no está en la documentación, el
// síntoma va a ser una pantalla en blanco sin error visible, y poder
// arreglarlo con una variable de entorno evita tener que desplegar a ciegas
// para probar.
function dominiosCsp() {
  if (!activo()) return [];
  const extra = String(process.env.MEMED_DOMINIOS_EXTRA || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const base = [
    "https://integrations.memed.com.br",
    "https://integrations.api.memed.com.br",
    "https://memed.com.br",
    "https://*.memed.com.br",
  ];
  return [...new Set([...base, ...extra])];
}

function scriptUrl() {
  return SCRIPT_URL;
}

// ═══ EL CONSEJO PROFESIONAL ════════════════════════════════════════════════
//
// Memed no acepta la matrícula como un texto suelto: la quiere partida en
// sigla (CRM, CRO...), estado y número. Y el estado es el DEL CONSEJO, no el
// del domicilio del médico — es el error más fácil de cometer y nadie lo ve
// hasta que una receta sale con el registro de otro estado.
const UF_BRASIL = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const SIGLAS_CONSEJO = ["CRM", "CRO", "CRMV", "CRN", "CRP", "CRF", "COREN"];

function consejoCompleto(medico) {
  const c = medico?.conselho;
  return Boolean(c?.sigla && c?.uf && c?.numero);
}

// ═══ REGISTRAR AL MÉDICO Y TRAER SU TOKEN ══════════════════════════════════
//
// El token no se guarda: se pide cada vez que el médico va a recetar. Memed
// dice explícitamente que no es fijo, y cachear algo que el proveedor declara
// variable es la clase de "optimización" que falla en silencio meses después.
async function tokenDeMedico(medico) {
  if (!configurado()) {
    throw new Error("MEMED_API_KEY / MEMED_SECRET_KEY no están configurados");
  }
  if (!consejoCompleto(medico)) {
    throw new Error("Falta el consejo profesional (sigla, UF y número) de este médico");
  }

  const [nombre, ...resto] = String(medico.nombre || "").trim().split(/\s+/);
  const cuerpo = {
    data: {
      type: "usuarios",
      attributes: {
        // external_id ata el médico de Symphomed con el de Memed. Se usa el
        // teléfono porque es la identidad de una cuenta acá: es único, no
        // cambia solo, y es lo mismo que usa el resto del sistema.
        external_id: String(medico.phone),
        nome: nombre || String(medico.nombre || "Médico"),
        // Memed pide nombre y apellido por separado. Un médico cargado con
        // un solo nombre no puede hacer fallar el alta por eso.
        sobrenome: resto.join(" ") || ".",
        ...(medico.cpf ? { cpf: String(medico.cpf).replace(/\D/g, "") } : {}),
        ...(medico.email ? { email: medico.email } : {}),
        board: {
          board_code: medico.conselho.sigla,
          board_state: medico.conselho.uf,
          board_number: String(medico.conselho.numero),
        },
      },
    },
  };

  let res;
  try {
    res = await axios.post(`${API_URL}/sinapse-prescricao/usuarios`, cuerpo, {
      params: { "api-key": API_KEY, "secret-key": SECRET_KEY },
      headers: { "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" },
      timeout: TIMEOUT,
    });
  } catch (e) {
    // La respuesta de error ENTERA al log. Un "no se pudo conectar con Memed"
    // no le sirve a nadie para arreglar nada, y este es justamente el punto
    // que no se pudo probar contra el ambiente real.
    const detalle = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    log.error(`[MEMED] alta de ${medico.phone} falló (${e.response?.status || "sin respuesta"}): ${detalle}`);
    throw new Error("Memed no aceptó el registro de este médico");
  }

  const token = res.data?.data?.attributes?.token;
  if (!token) {
    log.error(`[MEMED] respuesta sin token para ${medico.phone}: ${JSON.stringify(res.data).slice(0, 800)}`);
    throw new Error("Memed no devolvió el token del médico");
  }
  return token;
}

// ═══ LO QUE SYMPHOMED SE QUEDA DE UNA RECETA EMITIDA ═════════════════════════
//
// El navegador manda lo que Memed le entregó en el evento prescricaoImpressa.
// Eso viene de afuera, así que se saca solo lo que hace falta y con la forma
// que se espera: guardar el objeto crudo sería meter en la historia clínica
// lo que mande quien controle esa pantalla.
//
// Se copian los medicamentos —no para reemplazar el documento firmado, que
// vive en Memed— sino porque son dato clínico: el hilo clínico, el brief y
// los avisos de interacción los necesitan, y no van a ir a buscarlos afuera.
function extraerReceta(datos) {
  const p = datos?.prescricao || {};
  const medicamentos = (Array.isArray(p.medicamentos) ? p.medicamentos : [])
    .map(m => ({
      nombre: String(m?.nome || "").trim().slice(0, 300),
      // En Memed la posología es un texto solo ("1 comprimido cada 8 horas"),
      // no los tres campos separados que usa la receta boliviana. Se guarda
      // como viene: partirla con una expresión regular sería inventar una
      // precisión que el dato no tiene.
      dosis: String(m?.posologia || "").trim().slice(0, 300),
      frecuencia: "",
      duracion: String(m?.quantidade ? `${m.quantidade} ${m.unit || ""}`.trim() : "").slice(0, 100),
    }))
    .filter(m => m.nombre);

  return {
    medicamentos,
    prescriptionUuid: String(p.prescriptionUuid || "").slice(0, 100),
    // Puede venir sin fecha; en ese caso la pone quien guarda, que es ahora.
    emitidaEn: p.prescriptionDate ? new Date(p.prescriptionDate) : new Date(),
    reimpresion: Boolean(datos?.reimpressao),
  };
}

module.exports = {
  activo, configurado, dominiosCsp, scriptUrl, tokenDeMedico, consejoCompleto,
  extraerReceta, UF_BRASIL, SIGLAS_CONSEJO,
};
