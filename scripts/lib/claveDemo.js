// Symphomed — La contraseña de TODAS las cuentas de prueba.
//
// Antes cada seed elegía la suya: ocho generaban una al azar y la mostraban una
// sola vez (y si nadie la anotaba, la cuenta quedaba perdida, porque las
// contraseñas se guardan cifradas), uno usaba «Symphomed123» y otro
// «demo12345». Para una demo con apuro, eso es una cuenta a la que nadie puede
// entrar. Ahora todas nacen con la misma y se pueden pasar otra por argumento.
//
// Es una clave adivinable A PROPÓSITO, en un servidor donde también están las
// historias clínicas reales. Por eso las cuentas de prueba se borran al
// terminar (el --borrar de cada seed) y nunca se usa en una cuenta real.
const CLAVE_DEMO = "Symphomed1234";

module.exports = { CLAVE_DEMO };
