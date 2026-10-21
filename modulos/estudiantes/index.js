// ═══════════════════════════════════════════════════════════════════════════
// Symphomed — Módulo de estudiantes
// ═══════════════════════════════════════════════════════════════════════════
//
// Estudiantes, internos y residentes: un Symphomed más simple para grabar sus
// consultas y aprender con ellas. Todo lo del módulo está en esta carpeta
// (el servidor) y en public/js/estudiantes*.js (la pantalla).
//
// ═══ LA FRONTERA ════════════════════════════════════════════════════════════
//
// · El núcleo no conoce este módulo: nada de routes/, services/ ni db/ hace
//   require de acá. El módulo entra por los puntos de extensión del núcleo
//   (services/extensiones.js) y monta sus propias rutas. Lo vigila
//   scripts/pruebas/probar_modulo_estudiantes.js.
// · El módulo sí usa el núcleo (la cuenta, las consultas, los pacientes, la
//   IA, la zona horaria): esa es la dirección permitida.
// · Sus datos están en sus colecciones (modelos.js). En el núcleo queda solo
//   lo que es de la cuenta y la marca de las notas (ver modelos.js).
//
// ═══ EL INTERRUPTOR ═════════════════════════════════════════════════════════
//
// MODULO_ESTUDIANTES=apagado en el .env, y reiniciar. Apagado:
//   · No se entra con códigos nuevos, y no hay tutor, razonamiento,
//     Estudiar, paciente virtual ni simulacros (sus rutas no existen).
//   · Las cuentas de estudiante que ya existen siguen entrando, con sus
//     casos, y siguen con TODAS sus reglas: no recetan, no le escriben a
//     pacientes, no cobran, sus notas llevan la marca, y tienen su tope de
//     horas. Apagar el módulo nunca convierte a un estudiante en médico.
// La pantalla se entera por /modulos.js (index.js de la raíz).
//
// ═══ LOS ARCHIVOS ═══════════════════════════════════════════════════════════
//
//   cuenta.js            niveles, códigos, cómo está el acceso
//   restricciones.js     lo que una cuenta de estudiante no puede hacer
//   modelos.js           sus colecciones
//   textos.js            lo que arma el servidor en es/pt (el PDF)
//   tutor.js             «te falta preguntar» y el razonamiento (IA)
//   estudio.js           tarjetas de repaso, racha y logros
//   pacienteVirtual.js   la entrevista con un paciente simulado (IA)
//   simulacros.js        preguntas tipo examen de residencia (IA)
//   rutas/               lo que llama la pantalla
const { CONFIG, log } = require("../../config");
const extensiones = require("../../services/extensiones");
const restricciones = require("./restricciones");
const rutasCuenta = require("./rutas/cuenta");
const tutor = require("./tutor");

const nombre = "estudiantes";

function activo() {
  return !/^(apagado|off|no|0|false)$/i.test(String(CONFIG.MODULO_ESTUDIANTES || "").trim());
}

function montar(app) {
  // Siempre, aunque el módulo esté apagado: las reglas de las cuentas que ya
  // existen, y cómo está su acceso (la pantalla lo pide antes de grabar).
  restricciones.montar(app);
  rutasCuenta.estado(app);

  if (!activo()) {
    log.info("[ESTUDIANTES] módulo apagado (MODULO_ESTUDIANTES): sin registro ni funciones de estudio; las reglas de las cuentas siguen.");
    return;
  }

  // Prendido: lo que el estudiante hace.
  rutasCuenta.registro(app);
  extensiones.enganchar("notaEnVivo.extras", tutor.extrasDelBorrador);
  require("./rutas/razonamiento")(app);
  require("./rutas/estudio")(app);
  require("./rutas/pacienteVirtual")(app);
  require("./rutas/simulacros")(app);
  require("./rutas/odontologia")(app);
}

module.exports = { nombre, activo, montar };
