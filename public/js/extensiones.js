// Symphomed — Los puntos de extensión de la pantalla.
//
// ═══ PARA QUÉ ═══════════════════════════════════════════════════════════════
//
// Lo mismo que services/extensiones.js, del lado del navegador. Las pantallas
// del núcleo (pacientes.js, consultas.js, escritorio.js…) no conocen a los
// módulos (public/js/estudiantes*.js): no llaman a ninguna función suya ni
// preguntan «¿es estudiante?». Ofrecen LUGARES con nombre y PERMISOS, y el
// módulo, al cargar, pone ahí lo suyo. Sin módulos, cada lugar queda vacío,
// cada permiso dice que sí, y la pantalla es la de siempre.
//
// ═══ LAS FORMAS ═════════════════════════════════════════════════════════════
//
//   · lugar   — un pedazo de HTML en una pantalla y, ya pintado, lo que lo
//               hace andar:
//                   const arriba = Extensiones.lugar("panel.aviso");
//                   app.innerHTML = `${arriba.html} …`;
//                   arriba.alPintar();
//   · momento — un aviso: Extensiones.avisar("sesion.entrar", datos)
//   · revisión — antes de hacer algo: await Extensiones.revisar("grabar")
//               devuelve por qué no (un texto para mostrar) o "".
//   · filtro  — Extensiones.filtrar("escritorio.menu", items) → items
//   · permiso — puede("recetar"): no, si algún módulo lo niega para esta
//               cuenta. Solo decide qué se DIBUJA: el permiso de verdad lo
//               revisa el servidor en cada pedido.
//
// Engancharse a un punto o pedir un permiso que no está en estas listas es
// un error al cargar: sería código que no corre nunca, sin que nadie se
// entere.
//
// Las pantallas propias de un módulo se anotan con Extensiones.pantalla(…):
// rutas.js les da su dirección, realtime.js no las repinta solas y
// escritorio.js marca su ítem del menú. Por eso los módulos se cargan antes
// que esos tres (index.html).
const Extensiones = (() => {
  const PUNTOS = {
    // Debajo del formulario de entrar (auth.js).
    "login": "lugar",
    "registro.google": "filtro", // perfiles que pueden completar un alta con Google
    // Arriba del panel del celular y en el inicio de la compu (pacientes.js,
    // escritorio.js).
    "panel.aviso": "lugar",
    // Una pestaña más en el panel del celular (pacientes.js).
    "panel.pestanas": "lugar",
    // Dentro de la nota de una consulta, arriba (consultas.js).
    "consulta.nota": "lugar",
    // Debajo de la nota de una consulta (consultas.js).
    "consulta.despues": "lugar",
    // Dentro del recuadro de la nota en vivo, mientras se graba (consultas.js).
    "notaEnVivo": "lugar",
    // Al entrar y al salir de una cuenta (auth.js, estado.js).
    "sesion.entrar": "momento",
    "sesion.salir": "momento",
    // Antes de grabar una consulta (consultas.js).
    "grabar": "revision",
    // Los ítems del menú de la compu (escritorio.js).
    "escritorio.menu": "filtro",
    // Las pestañas de la ficha del paciente (pacientes.js).
    "kardex.pestanas": "filtro",
  };
  const PERMISOS = [
    "agenda",            // dar turnos
    "recetar",           // hacer recetas
    "reconsulta",        // agendar la reconsulta y avisarle al paciente
    "presupuestos",      // presupuestos de tratamientos
    "saldo",             // cargar saldo y ver los movimientos
    "compartirPaciente", // teleconsulta, resumen compartido, la persona entre consultorios
  ];

  const enganches = new Map(Object.keys(PUNTOS).map(p => [p, []]));
  const negadores = [];
  const pantallas = [];

  function de(punto, forma) {
    if (!PUNTOS[punto]) throw new Error(`[extensiones] no existe el punto «${punto}»`);
    if (forma && PUNTOS[punto] !== forma) throw new Error(`[extensiones] «${punto}» es un ${PUNTOS[punto]}, no un ${forma}`);
    return enganches.get(punto);
  }

  // Lo que un módulo pone en un punto. Para un lugar, fn(...args) devuelve
  // { html, alPintar } (o solo el html, o nada).
  function agregar(punto, fn) {
    if (typeof fn !== "function") throw new Error(`[extensiones] «${punto}» necesita una función`);
    de(punto).push(fn);
  }

  function lugar(punto, ...args) {
    const partes = de(punto, "lugar").map(fn => fn(...args)).filter(Boolean)
      .map(p => (typeof p === "string" ? { html: p } : p));
    return {
      html: partes.map(p => p.html || "").join(""),
      // Cada pedazo por separado, para quien los cuenta (las pestañas).
      partes: partes.map(p => p.html || "").filter(Boolean),
      alPintar: () => partes.forEach(p => { if (typeof p.alPintar === "function") p.alPintar(); }),
    };
  }

  function avisar(punto, ...args) {
    for (const fn of de(punto, "momento")) fn(...args);
  }

  async function revisar(punto, ...args) {
    for (const fn of de(punto, "revision")) {
      const motivo = await fn(...args);
      if (motivo) return motivo;
    }
    return "";
  }

  function filtrar(punto, valor, ...args) {
    return de(punto, "filtro").reduce((v, fn) => fn(v, ...args), valor);
  }

  // fn() → la lista de permisos que esta cuenta NO tiene, ahora.
  function negar(fn) {
    if (typeof fn !== "function") throw new Error("[extensiones] negar necesita una función");
    negadores.push(fn);
  }

  function puede(permiso) {
    if (!PERMISOS.includes(permiso)) throw new Error(`[extensiones] no existe el permiso «${permiso}»`);
    return !negadores.some(fn => (fn() || []).includes(permiso));
  }

  // { fn: "renderX", tipo: "x", ruta?: "x", menu?: "id del ítem del menú" }
  function pantalla(p) {
    if (!p || !p.fn || !p.tipo) throw new Error("[extensiones] una pantalla necesita fn y tipo");
    pantallas.push(Object.freeze({ ...p }));
  }

  // Si un módulo está prendido en este servidor (/modulos.js). Sin el dato
  // (no cargó), prendido: es como era antes de que hubiera interruptor.
  function moduloPrendido(nombre) {
    const m = typeof window !== "undefined" && window.MODULOS;
    return !(m && m[nombre] === false);
  }

  return { agregar, lugar, avisar, revisar, filtrar, negar, puede, pantalla,
    pantallas: () => pantallas.slice(), moduloPrendido, PUNTOS, PERMISOS };
})();

// Corto, porque se lee en medio de las pantallas: if (puede("agenda")) …
const puede = (permiso) => Extensiones.puede(permiso);
