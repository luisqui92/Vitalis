// Symphomed — La sesión de un médico: el token y lo que recibe la pantalla
// al entrar.
//
// Aparte de routes/medicoAuth.js porque no es solo del login: cualquier ruta
// que deje entrar a alguien (el registro con código de un módulo, por
// ejemplo) tiene que dar exactamente la misma sesión. Dos copias de esto
// terminan dando permisos distintos según por dónde se entró.
//
// Los módulos suman lo suyo con dos puntos de extensión (services/
// extensiones.js): «sesion.token» (las marcas que el servidor mira en cada
// pedido) y «sesion.datos» (lo que la pantalla necesita para saber qué
// dibujar).
const { generarToken } = require("./auth");
const { esOperador } = require("./operadores");
const extensiones = require("./extensiones");
const { ErrorHttp } = require("./httpHelpers");

// El rol del TOKEN no es el mismo campo que el rol de la cuenta, y la
// diferencia es la que sostiene el permiso: un director es médico para todo
// efecto clínico (rol "medico"), y además administra (admin: true). Un
// administrativo NO es médico, así que su token lleva rol "admin" y las
// rutas clínicas lo rechazan solas, por el requireAuth(["medico"]) que ya
// tenían — sin agregar un chequeo nuevo en cada una de las 30 rutas.
function tokenDeMedico(medico) {
  if ((medico.perfilAcceso === "profesional" && medico.verificacionProfesional?.estado !== "verificada") ||
      (medico.perfilAcceso === "educativo" && !medico.estudiante?.nivel)) {
    throw new ErrorHttp(403, "Tu perfil todavía no tiene habilitado este acceso.");
  }
  const esAdmin = medico.rol === "admin" || medico.rol === "director";
  const rolToken = medico.rol === "admin" ? "admin" : "medico";
  return generarToken(medico.phone, rolToken, 8 * 60 * 60 * 1000, {
    ...(esAdmin ? { admin: true } : {}),
    ...(medico.clinicaId ? { clinicaId: String(medico.clinicaId) } : {}),
    ...extensiones.sumar("sesion.token", medico),
  });
}

function datosDeSesion(medico) {
  return {
    phone: medico.phone,
    nombre: medico.nombre,
    tipoEspecialidad: medico.tipoEspecialidad,
    idioma: medico.idioma || "es",
    // La moneda decide bajo qué reglas trabaja esta cuenta, no solo cómo se
    // muestra el saldo: en Brasil la receta va por Memed porque ahí una
    // receta necesita firma digital. Por eso viaja en la sesión — el
    // navegador tiene que saber qué botón de recetar dibujar.
    moneda: medico.moneda || "BOB",
    rol: medico.rol || "medico",
    clinica: medico.clinicaId ? String(medico.clinicaId) : null,
    // Solo para que la pantalla sepa si dibujar la sección de pagos. NO es
    // un permiso: el permiso lo revisa el servidor en cada pedido contra
    // OPERADORES_SALDO, y quien mienta acá se encuentra con un 404. Igual
    // que rol, que también viaja así.
    operador: esOperador(medico.phone),
    ...extensiones.sumar("sesion.datos", medico),
  };
}

module.exports = { tokenDeMedico, datosDeSesion };
