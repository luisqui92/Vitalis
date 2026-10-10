// Symphomed — Los puntos de extensión del núcleo.
//
// ═══ PARA QUÉ ═══════════════════════════════════════════════════════════════
//
// El núcleo (routes/, services/, db/) no conoce a los módulos (modulos/*):
// nunca hace require de nada de ahí adentro. Donde un módulo necesita sumar
// algo a lo que hace el núcleo —una marca en la sesión, un freno antes de
// grabar, un dato más al abrir una consulta—, el núcleo ofrece un PUNTO con
// nombre, y el módulo se engancha ahí al arrancar (index.js → montar).
//
// Sin módulos, cada punto no hace nada y el núcleo funciona igual. Así un
// módulo se agrega, se apaga o se saca sin tocar el núcleo, y quien lee
// routes/consultaMedica.js ve en una línea que ahí puede entrar algo de
// afuera, en vez de un if por cada cosa que algún día se le agregó.
//
// ═══ CÓMO SE USA ════════════════════════════════════════════════════════════
//
// La lista de puntos está acá abajo, con lo que se espera de cada uno.
// Engancharse a uno que no está en la lista, o llamarlo de una forma que no
// es la suya, es un error al arrancar: un enganche con un nombre mal escrito
// sería código que no corre nunca, y nadie se enteraría.
//
// Cada forma tiene su verbo, para que en el núcleo se lea qué pasa si un
// módulo falla:
//   · sumar    — junta los objetos que devuelven (sin esperar). Si uno
//                falla, falla el pedido: lo que se suma acá decide permisos.
//   · revisar  — cada uno puede frenar tirando un ErrorHttp.
//   · permite  — sí, salvo que alguno diga que no.
//   · lista    — junta las listas que devuelven.
//   · extras   — junta los objetos que devuelven; si uno falla, se anota y
//                se sigue sin lo suyo. Es para lo que se agrega a una
//                respuesta y no puede tirar abajo lo del núcleo.
const { log } = require("../config");

const PUNTOS = {
  // La sesión del médico (services/sesionMedico.js).
  "sesion.token": { forma: "sumar", que: "marcas que se suman al token de sesión" },
  "sesion.datos": { forma: "sumar", que: "datos que se suman a la sesión que recibe la pantalla" },
  // Las consultas (routes/consultaMedica.js).
  // Al subir, req.vistaPrevia es la vista previa de esa misma grabación, si
  // tuvo (services/vistaPrevia.js → deEstaGrabacion).
  "consulta.antesDeGrabar": { forma: "revisar", que: "antes de empezar o de subir una grabación: puede frenarla" },
  // La vista previa en vivo (services/vistaPrevia.js): se llama con
  // { adminUser } al abrirla y cada medio minuto mientras sigue abierta.
  "vistaPrevia.durante": { forma: "revisar", que: "mientras la vista previa en vivo está abierta: puede cortarla" },
  "consulta.alCrear": { forma: "sumar", que: "campos que se suman a la consulta nueva" },
  "consulta.alConfirmar": { forma: "sumar", que: "lo que se fuerza en lo que se aplica al confirmar" },
  "consulta.detalle": { forma: "extras", que: "lo que viaja con la consulta al abrirla (consulta.extras)" },
  "notaEnVivo.extras": { forma: "extras", que: "lo que viaja junto al borrador de la nota en vivo" },
  // Lo que le llega al paciente sin que nadie toque una ruta
  // (services/recordatorioMedicamento.js).
  "paciente.mensajes": { forma: "permite", que: "si a los pacientes de esta cuenta se les puede escribir" },
  // El Kardex en PDF (routes/kardexPdf.js).
  "kardex.alertas": { forma: "lista", que: "alertas que van primero en el Kardex en PDF" },
};

const enganches = new Map(Object.keys(PUNTOS).map(p => [p, []]));

function verificarPunto(punto, forma) {
  const def = PUNTOS[punto];
  if (!def) throw new Error(`[EXTENSIONES] no existe el punto «${punto}»`);
  if (forma && def.forma !== forma) throw new Error(`[EXTENSIONES] «${punto}» es de la forma «${def.forma}», no «${forma}»`);
}

// La misma función dos veces cuenta una sola: montar un módulo dos veces
// (dos apps en una prueba) no duplica lo que hace.
function enganchar(punto, fn) {
  verificarPunto(punto);
  if (typeof fn !== "function") throw new Error(`[EXTENSIONES] «${punto}» necesita una función`);
  const lista = enganches.get(punto);
  if (!lista.includes(fn)) lista.push(fn);
}

function de(punto, forma) {
  verificarPunto(punto, forma);
  return enganches.get(punto);
}

function sumar(punto, ...args) {
  return Object.assign({}, ...de(punto, "sumar").map(fn => fn(...args) || {}));
}

async function revisar(punto, ...args) {
  for (const fn of de(punto, "revisar")) await fn(...args);
}

async function permite(punto, ...args) {
  for (const fn of de(punto, "permite")) if ((await fn(...args)) === false) return false;
  return true;
}

async function lista(punto, ...args) {
  const partes = await Promise.all(de(punto, "lista").map(fn => fn(...args)));
  return partes.flatMap(p => (Array.isArray(p) ? p : []));
}

async function extras(punto, ...args) {
  const partes = await Promise.all(de(punto, "extras").map(async (fn) => {
    try {
      return (await fn(...args)) || {};
    } catch (e) {
      log.warn(`[EXTENSIONES] ${punto}:`, e.message);
      return {};
    }
  }));
  return Object.assign({}, ...partes);
}

// Para las pruebas: cuántos enganches tiene cada punto.
function enganchados() {
  return Object.fromEntries([...enganches].map(([p, fns]) => [p, fns.length]));
}

module.exports = { PUNTOS, enganchar, sumar, revisar, permite, lista, extras, enganchados };
