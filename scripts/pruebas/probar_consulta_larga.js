// Symphomed — Una consulta de 60-70 minutos llega entera.
//
// Un médico en Brasil atiende consultas de una hora o más. Cada eslabón
// tiene un límite, y basta uno para perder la consulta:
//   · el tamaño del audio: sin pedir calidad, el navegador graba a 128 kbps
//     → 70 min = 67 MB, al borde de lo que acepta el servidor (medido en
//     Chromium: 67,4 MB antes, 23,7 MB a 48 kbps);
//   · la espera de la transcripción, la de la nota y el largo de la nota.
// Esta prueba mira que cada límite deje pasar una consulta de 70 minutos
// con margen, y que ninguna pantalla que graba se saltee la calidad de voz.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
const path = require("path");
const fs = require("fs");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), "utf8");

const MINUTOS = 70;
const aMB = (bitsPorSegundo) => bitsPorSegundo / 8 * MINUTOS * 60 / 1e6;

console.log(`── 1. El audio de ${MINUTOS} minutos entra ──`);
const audio = leer("public/js/audio.js");
const bits = Number((audio.match(/const BITS_POR_SEGUNDO_VOZ = (\d+);/) || [])[1]);
verificar(`la voz se graba a ${bits / 1000} kbps (suficiente para voz, entre 24 y 64)`, bits >= 24000 && bits <= 64000);
const limiteMB = Number((leer("routes/consultaMedica.js").match(/audioRaw = express\.raw\(\{ type: "audio\/\*", limit: "(\d+)mb" \}\)/) || [])[1]);
verificar(`${MINUTOS} min a esa calidad = ${aMB(bits).toFixed(0)} MB, y el servidor acepta ${limiteMB} MB`, aMB(bits) * 3 < limiteMB);
verificar(`aunque un navegador ignore el pedido y grabe a 128 kbps (${aMB(128000).toFixed(0)} MB), también entra`, aMB(128000) * 1.5 < limiteMB);

// Cada pantalla que graba una consulta usa la grabadora de voz. Un
// "new MediaRecorder(" suelto vuelve a los 128 kbps sin que nadie lo note.
for (const archivo of ["public/js/consultas.js", "public/js/vinculacion.js", "public/js/grabacionTele.js"]) {
  const js = leer(archivo);
  verificar(`${archivo} graba con crearGrabadora (calidad de voz)`, /crearGrabadora\(/.test(js) && !/new MediaRecorder\(/.test(js));
}

console.log("\n── 2. Las esperas alcanzan ──");
const { CONFIG } = require(path.join(RAIZ, "config"));
verificar(`la transcripción puede tardar hasta ${CONFIG.TIMEOUT_TRANSCRIPCION_TOTAL / 60000} min (una de ${MINUTOS} suele tardar 5-10)`,
  CONFIG.TIMEOUT_TRANSCRIPCION_TOTAL >= 40 * 60000);
verificar(`la nota puede tardar hasta ${CONFIG.TIMEOUT_NOTA_CLINICA / 1000} s (antes 45 s)`, CONFIG.TIMEOUT_NOTA_CLINICA >= 120000);
const nota = leer("services/notaClinica.js");
verificar("la nota usa su propia espera, no la de 45 s", /timeout: CONFIG\.TIMEOUT_NOTA_CLINICA/.test(nota));
const maxTokens = Number((nota.match(/max_tokens: (\d+)/) || [])[1]);
verificar(`la nota puede ser larga: hasta ${maxTokens} tokens (antes 3000)`, maxTokens >= 6000);

console.log("\n── 3. El celular no se apaga a la mitad ──");
verificar("se pide que la pantalla no se apague", /navigator\.wakeLock\.request\("screen"\)/.test(audio));
verificar("si el sistema suelta ese pedido, se vuelve a pedir", /addEventListener\("release"/.test(audio));
verificar("se avisa si la batería está baja y sin cargar", /getBattery/.test(audio) && /onAviso\("bateria"/.test(audio));
for (const idioma of ["es", "pt"]) {
  verificar(`el aviso de batería está en ${idioma}`, /"consulta\.avisoBateria":/.test(leer(`public/i18n/${idioma}/consultas.js`)));
}
verificar("las dos pantallas que graban muestran el aviso de batería", ["public/js/consultas.js", "public/js/vinculacion.js"]
  .every(a => /textoAvisoGrabacion\(/.test(leer(a))));

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
