// Symphomed — Que todos los esc() de las pantallas escapen lo mismo.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Cada pantalla tiene su propio esc() para meter texto del paciente o del
// médico adentro de un HTML armado a mano. Los nuevos escapaban la comilla
// simple; los de la app principal (estado.js), la reserva pública, el panel
// de socios y el reporte, no. Hoy no se usa ninguno dentro de un atributo
// entre comillas simples, así que un «O'Brien» no rompía nada: el día que
// alguien escribiera title='${esc(nombre)}', sí, y sin aviso.
//
// Se buscan TODOS los esc() que hay en public/js y vistas, se corren de
// verdad y se les pasa el mismo texto. Uno nuevo que se olvide la comilla
// simple aparece acá.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

function archivos(dir, extension) {
  return fs.readdirSync(path.join(RAIZ, dir)).filter(n => n.endsWith(extension)).map(n => path.join(dir, n));
}

// Se recorta la función entera contando llaves desde la primera: alcanza para
// estas, que son de una línea o tres y no tienen llaves dentro de un texto.
function extraer(fuente, desde) {
  let i = fuente.indexOf("{", desde), nivel = 0;
  for (; i < fuente.length; i++) {
    if (fuente[i] === "{") nivel++;
    else if (fuente[i] === "}" && --nivel === 0) return fuente.slice(desde, i + 1);
  }
  return null;
}

const encontradas = [];
for (const archivo of [...archivos("public/js", ".js"), ...archivos("vistas", ".html")]) {
  const fuente = fs.readFileSync(path.join(RAIZ, archivo), "utf8");
  for (const m of fuente.matchAll(/function\s+([A-Za-z]*[eE]sc)\s*\(/g)) {
    const codigo = extraer(fuente, m.index);
    if (codigo) encontradas.push({ archivo, nombre: m[1], codigo });
  }
}

console.log("── Todos los esc() de las pantallas ──");
// Si cambia la forma de escribirlos y la búsqueda deja de encontrarlos, la
// prueba pasaría sin probar nada.
verificar(`se encontraron ${encontradas.length} funciones de escape (al menos 9)`, encontradas.length >= 9);

const TEXTO = `O'Brien <b class="x">&amp;</b>`;
for (const f of encontradas) {
  let salida, error = null;
  try {
    salida = vm.runInNewContext(`${f.codigo}; ${f.nombre}(TEXTO)`, { TEXTO });
  } catch (e) { error = e.message; }
  if (error) { verificar(`${f.archivo} ${f.nombre}(): se puede correr (${error})`, false); continue; }
  const sinCrudos = !/[<>"']/.test(salida) && !/&(?!(amp|lt|gt|quot|#39);)/.test(salida);
  verificar(`${f.archivo} ${f.nombre}() no deja ' " < > ni & sueltos`, sinCrudos);
  if (!sinCrudos) console.log(`   → ${salida}`);
  verificar(`  ...y no pierde ni inventa texto`, salida === "O&#39;Brien &lt;b class=&quot;x&quot;&gt;&amp;amp;&lt;/b&gt;");
  verificar(`  ...y null da vacío`, vm.runInNewContext(`${f.codigo}; ${f.nombre}(null)`) === "");
}

console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
