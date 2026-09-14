// Symphomed Neurodesarrollo — Quién puede aplicar qué, y qué promete la venta.
//
// ═══ EL PROBLEMA QUE ESTO VIGILA ══════════════════════════════════════════
//
// Un M-CHAT-R/F son veinte preguntas de dominio público que cualquier
// pediatra usa en el control del año y medio. Un WISC-V es nivel C de
// Pearson: hace falta posgrado en evaluación para comprarlo siquiera. Un
// ADOS-2 además pide un curso formal de administración.
//
// Symphomed no tiene ninguno adentro —ni ítems, ni algoritmo, ni puntos de
// corte— así que nadie puede "aplicarlo leyendo la pantalla". Ese es el
// control de fondo y es el que más importa: se comprueba abajo.
//
// Pero quedaba una grieta que no era técnica sino de lectura: un desplegable
// donde el M-CHAT y el ADOS-2 valían lo mismo se lee como un MENÚ de cosas
// que Symphomed te da. Y del otro lado, la página de venta y el bot de
// WhatsApp nombraban los instrumentos como si fueran una función incluida.
//
// Nada de eso "falla" nunca: la app anda igual. Por eso hay una prueba.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

const { INSTRUMENTOS_NEURO, CALIFICACIONES_INSTRUMENTO } = require(path.join(RAIZ, "db", "models"));
const RUTA = fs.readFileSync(path.join(RAIZ, "routes", "instrumentos.js"), "utf8");
const PANTALLA = fs.readFileSync(path.join(RAIZ, "public", "js", "instrumentos.js"), "utf8");
const sinComentarios = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const RUTA_CODIGO = sinComentarios(RUTA);

console.log("── 1. El control de fondo: el instrumento NO está adentro ──");
// Esto es lo único que de verdad impide que alguien sin entrenamiento lo
// "aplique" desde Symphomed. Todo lo demás es señalización.
const catalogo = JSON.stringify(INSTRUMENTOS_NEURO);
verificar("el catálogo no guarda ítems ni preguntas", !/"items"|"preguntas"|"reactivos"/.test(catalogo));
verificar("  ...ni puntos de corte ni tablas de conversión",
  !/corte|cutoff|baremo|conversi[oó]n|percentil\s*\d/i.test(catalogo));
verificar("  ...ni algoritmo de puntuación", !/algoritmo de (c[aá]lculo|puntuaci)/i.test(catalogo));
// Lo que sí guarda es descriptivo y está publicado: cómo se llama y qué
// campos arroja. Anotar que alguien puntuó X no es reproducir la prueba.
verificar("sí guarda el nombre y qué puntajes devuelve",
  INSTRUMENTOS_NEURO.every(i => typeof i.nombre === "string" && Array.isArray(i.puntajes)));

console.log("\n── 2. Cada instrumento dice qué calificación pide ──");
const NIVELES = ["libre", "profesional", "certificado"];
verificar("los tres niveles están definidos",
  NIVELES.every(n => CALIFICACIONES_INSTRUMENTO[n]?.etiqueta));
verificar("todos los instrumentos tienen nivel, y es uno de los tres",
  INSTRUMENTOS_NEURO.every(i => NIVELES.includes(i.quienPuede)));
// Los casos que importan, uno por uno. Si alguien reclasifica un ADOS-2 como
// "libre", esto se pone rojo.
const nivelDe = (n) => INSTRUMENTOS_NEURO.find(i => i.nombre === n)?.quienPuede;
[["ADOS-2", "certificado"], ["ADI-R", "certificado"], ["WISC-V", "certificado"],
 ["WPPSI-IV", "certificado"], ["Bayley-4", "certificado"],
 ["M-CHAT-R/F", "libre"],
 ["SCQ", "profesional"], ["Vineland-3", "profesional"], ["Conners-4", "profesional"]]
  .forEach(([nombre, esperado]) =>
    verificar(`  «${nombre}» → ${esperado}`, nivelDe(nombre) === esperado));
// Lo que no está en la lista se trata con el criterio prudente, no el cómodo.
verificar("«Otro» cae en profesional, no en libre", nivelDe("Otro") === "profesional");
verificar("el nivel más estricto avisa que Symphomed NO habilita a nadie",
  /no habilita a nadie|no verifica credenciales/i.test(CALIFICACIONES_INSTRUMENTO.certificado.aviso));
verificar("y la tabla dice que no es asesoramiento legal",
  /NO ES ASESORAMIENTO LEGAL/.test(fs.readFileSync(path.join(RAIZ, "db", "models.js"), "utf8")));

console.log("\n── 3. Lo único que Symphomed puede hacer cumplir de verdad ──");
// No puede verificar una certificación —no hay registro público de quién
// tiene el curso de ADOS-2— y fingir que la verifica sería peor que no
// controlar nada: le daría al centro una garantía falsa.
//
// Lo que sí puede: no guardar un nivel C sin el nombre y la matrícula de
// quien lo aplicó. "Alguien cargó un ADOS-2" pasa a ser "lo aplicó tal
// persona, con tal matrícula, tal día".
const guion = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf("const normalizar"), RUTA_CODIGO.indexOf("function limpiarPuntajes"));
const { calificacionDe, exigirFirmaSiCorresponde } =
  new Function("INSTRUMENTOS_NEURO", "ErrorHttp",
    guion + "\nreturn { calificacionDe, exigirFirmaSiCorresponde };"
  )(INSTRUMENTOS_NEURO, class extends Error { constructor(e, m) { super(m); this.status = e; } });

const rechaza = (nivel, quien, mat) => {
  try { exigirFirmaSiCorresponde(nivel, quien, mat); return false; } catch { return true; }
};
verificar("un ADOS-2 sin nombre de quien lo aplicó NO se guarda", rechaza("certificado", "", "4821"));
verificar("  ...ni sin matrícula", rechaza("certificado", "Lic. Torres", ""));
verificar("  ...y con las dos cosas, sí", !rechaza("certificado", "Lic. Torres", "4821"));
verificar("un M-CHAT no exige firma: no tendría sentido", !rechaza("libre", "", ""));
verificar("un nivel B tampoco", !rechaza("profesional", "", ""));

console.log("\n── 4. El nombre llega como texto libre, así que se normaliza ──");
// Hay una opción "Otro" y hay quien escribe "WISC V" sin guion. Si el cruce
// fallara, un WISC-V entraría como "profesional" y se guardaría sin firma.
verificar("«ADOS-2» se reconoce", calificacionDe("ADOS-2") === "certificado");
verificar("  ...y «ados 2» escrito a mano también", calificacionDe("ados 2") === "certificado");
verificar("  ...y «WISC V» sin guion", calificacionDe("WISC V") === "certificado");
verificar("lo que no se reconoce cae en profesional, no en libre",
  calificacionDe("Escala inventada") === "profesional" && calificacionDe("") === "profesional");

console.log("\n── 5. La edición no es la puerta de atrás ──");
// Guardar el ADOS-2 con la firma puesta y vaciarla después de un PATCH
// dejaría el registro exactamente como si el control no existiera.
const patch = RUTA_CODIGO.slice(RUTA_CODIGO.indexOf('app.patch("/medico/instrumentos/:id"'));
verificar("el PATCH vuelve a exigir la firma", /exigirFirmaSiCorresponde/.test(patch));
verificar("  ...y recalcula el nivel, por si cambió el nombre del instrumento",
  /aplicado\.quienPuede = calificacionDe\(aplicado\.instrumento\)/.test(patch));
verificar("el nivel queda CONGELADO en el registro, no se mira el catálogo al dibujar",
  /quienPuede: \{ type: String, enum:/.test(fs.readFileSync(path.join(RAIZ, "db", "models.js"), "utf8")));

console.log("\n── 6. La pantalla lo dice ANTES de cargar, no al apretar Guardar ──");
verificar("el catálogo le manda las calificaciones a la pantalla",
  /calificaciones: CALIFICACIONES_INSTRUMENTO/.test(RUTA_CODIGO));
verificar("al elegir el instrumento se muestra qué pide", /in-calificacion/.test(PANTALLA));
verificar("  ...y en los de nivel C los campos dicen «obligatorio»",
  /\(obligatorio\)/.test(PANTALLA));
verificar("se nombra al editor y se aclara que no estamos afiliados",
  /no está afiliado ni vende sus materiales/.test(PANTALLA));
// El campo venía prellenado con el dueño de la cuenta, que es cómodo para un
// M-CHAT y es la respuesta equivocada en un nivel C: quien paga la cuenta no
// es necesariamente quien tiene la certificación, y el caso más común es que
// el ADOS-2 lo haya hecho una evaluadora externa. Un campo ya completo se
// firma sin leerlo.
verificar("en un nivel C no se prellena con el dueño de la cuenta",
  /campoQuien\.value === String\(MEDICO_NOMBRE \|\| ""\)\.trim\(\)|certificado && campoQuien\.value\.trim\(\) === String\(MEDICO_NOMBRE/.test(PANTALLA));
verificar("la pantalla sigue diciendo que Symphomed no aplica ni puntúa",
  /no aplica ni puntúa/i.test(PANTALLA));

console.log("\n── 7. Lo que promete la venta ──");
// Acá es donde el problema deja de ser técnico. Una página que dice
// "ADOS-2, WISC-V, Vineland-3" como lista de funciones se lee como si
// vinieran incluidos.
const TEXTOS = fs.readFileSync(path.join(RAIZ, "scripts", "diseno", "textos.js"), "utf8");
const lineasNeuro = TEXTOS.split("\n").filter(l => /NEURODESARROLLO|NEURODESENVOLVIMENTO|NEURODEVELOPMENT/.test(l));
verificar(`la página habla de neurodesarrollo en los tres idiomas`, lineasNeuro.length === 3);
lineasNeuro.forEach(l => {
  const idioma = l.match(/NEURODES[A-Z]+|NEURODEVELOPMENT/)[0];
  verificar(`  [${idioma}] dice que Symphomed no administra ni puntúa`,
    /no administra ni puntúa|não administra nem pontua|neither administers nor scores/.test(l));
});
// Y la promesa que NO se cumplía: los instrumentos se listan de la más nueva
// a la más vieja, en tarjetas sueltas. No hay comparación entre aplicaciones
// —ni delta, ni lado a lado— así que la página no puede decir que la hay.
verificar("no se promete comparar entre aplicaciones (no existe todavía)",
  !/se comparan entre aplicaciones|se comparam entre aplicações|compare across administrations/.test(TEXTOS));

console.log("\n── 8. El bot de ventas no puede vender un permiso ──");
// Es el lugar donde esto sale más caro: una psicóloga pregunta por WhatsApp
// "¿me sirve para hacer el ADOS-2?" y el bot contesta que sí.
const VENTAS = fs.readFileSync(path.join(RAIZ, "services", "asistenteVentas.js"), "utf8");
verificar("tiene prohibido decir que Symphomed aplica o puntúa un instrumento",
  /"aplica" o "puntúa" un instrumento/.test(VENTAS));
// El salto de línea del prompt cae en cualquier lado, así que se aplana
// antes de buscar. Si no, la prueba se rompería sola la próxima vez que
// alguien reacomode el párrafo.
const ventasEnUnaLinea = VENTAS.replace(/\s+/g, " ");
verificar("  ...y tiene escrita la respuesta correcta a «¿me sirve para hacer el ADOS-2?»",
  /¿me sirve para hacer el ADOS-2\?/.test(ventasEnUnaLinea) &&
  /la respuesta es que no/.test(ventasEnUnaLinea));
verificar("  ...y ya no describe la rama como «los instrumentos y sus puntajes»",
  !/neurodesarrollo con los instrumentos y sus puntajes/.test(VENTAS));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
process.exit(fallos === 0 ? 0 : 1);
