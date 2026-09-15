// Symphomed Fisioterapia.
//
// ═══ POR QUÉ ESTA PRUEBA ═════════════════════════════════════════════════
//
// Tres cosas de este módulo se rompen sin hacer ruido, y las tres dejan una
// ficha clínica equivocada en vez de un error en pantalla:
//
//   1. EL LADO. Mirando a alguien de frente, su hombro derecho está a la
//      izquierda de quien mira. Si la deducción se invierte, Symphomed anota
//      "hombro izquierdo" cuando era el derecho, y ese error se arrastra a
//      la goniometría, al objetivo y al informe. Nadie lo ve hasta que el
//      paciente pregunta por qué le trabajan el brazo sano.
//
//   2. LA REFERENCIA CON NORMAL 0. La extensión de codo y de rodilla tienen
//      rango de referencia 0°. Una división por cero pinta la barra vacía y
//      dice 0%, que es lo contrario de lo que pasa: llegar a 0 es tener la
//      extensión COMPLETA.
//
//   3. QUE UN MOVIMIENTO CORRESPONDA A SU ARTICULACIÓN. Sin validar, se
//      puede guardar "flexión de sacroilíaca", que después aparece en el
//      gráfico como un movimiento que no existe y nadie sabe de dónde salió.
//
// Y lo de siempre: que un kinesiólogo no vea nunca la ficha de otro.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

(async () => {
  const http = require("http");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("fisio");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "fisioterapia"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Paciente, EvaluacionFisio, MedicionFisio, ObjetivoFisio } =
    require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();

  const clave = await hashPassword("Prueba1234!");
  await Medico.create({ phone: "70100001", nombre: "Lic. Kine", passwordHash: clave, activo: true, tipoEspecialidad: "fisioterapia" });
  await Medico.create({ phone: "70100002", nombre: "Lic. Otro", passwordHash: clave, activo: true, tipoEspecialidad: "fisioterapia" });
  const tk = generarToken("70100001", "medico", 3600 * 1000);
  const tkOtro = generarToken("70100002", "medico", 3600 * 1000);

  const juan = await Paciente.create({ nombre: "Juan Pérez", medicoPhone: "70100001", codigo: "K-0001" });
  const ajeno = await Paciente.create({ nombre: "Paciente Ajeno", medicoPhone: "70100002", codigo: "K-0001" });

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  let n = 0;
  const pedir = (ruta, token, metodo = "GET", cuerpo = null) => new Promise(res => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": `203.0.113.${(n++ % 250) + 1}`,
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, r => { let t = ""; r.on("data", d => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} res({ estado: r.statusCode, cuerpo: j, texto: t }); }); });
    req.on("error", () => res({ estado: 0 }));
    if (datos) req.write(datos);
    req.end();
  });

  // ═══ 1. IZQUIERDA Y DERECHA ══════════════════════════════════════════════
  // Se prueba contra la función real de la pantalla, no contra una copia:
  // se lee el archivo y se evalúa ladoSegunVista tal como está escrita. Si
  // alguien invierte la condición, esta prueba lo agarra.
  console.log("── 1. El lado no se anota al revés ──");
  const fuentePantalla = require("fs").readFileSync(path.join(RAIZ, "public", "js", "fisioterapia.js"), "utf8");
  const cuerpoLado = fuentePantalla.match(/function ladoSegunVista\([\s\S]*?\n\}/);
  const cuerpoSinLado = fuentePantalla.match(/const REGIONES_SIN_LADO = new Set\(\[[^\]]*\]\);/);
  const ladoSegunVista = new Function(`${cuerpoSinLado[0]}\n${cuerpoLado[0]}\nreturn ladoSegunVista;`)();

  verificar("de FRENTE, la mitad izquierda de la pantalla es el lado DERECHO del paciente",
    ladoSegunVista("frente", "hombro", 25) === "derecho");
  verificar("de FRENTE, la mitad derecha de la pantalla es el lado IZQUIERDO del paciente",
    ladoSegunVista("frente", "hombro", 75) === "izquierdo");
  verificar("de ESPALDAS, la mitad izquierda de la pantalla es el lado IZQUIERDO",
    ladoSegunVista("espalda", "hombro", 25) === "izquierdo");
  verificar("de ESPALDAS, la mitad derecha de la pantalla es el lado DERECHO",
    ladoSegunVista("espalda", "hombro", 75) === "derecho");
  verificar("la columna y la línea media no tienen lado",
    ladoSegunVista("espalda", "lumbar", 20) === "central" &&
    ladoSegunVista("frente", "cervical", 80) === "central");
  verificar("y la pantalla le avisa al profesional que de frente está cruzado",
    /fisio\.dolor\.ladoAviso/.test(fuentePantalla));

  // ═══ 2. LA REFERENCIA CON NORMAL 0 ═══════════════════════════════════════
  console.log("\n── 2. Extensión de rodilla y codo: la referencia es 0° ──");
  const cuerpoBarra = fuentePantalla.match(/function barraMovilidad\([\s\S]*?\n\}/);
  const barraMovilidad = new Function(
    `const t = (k) => k; ${cuerpoBarra[0]}\nreturn barraMovilidad;`
  )();
  const barraEn0 = barraMovilidad(0, 0);
  const barraEn15 = barraMovilidad(15, 0);
  // Ojo con el «no 0%»: /0%/ matchea adentro de «100%». Tiene que pedirse
  // la barra llena Y el texto de extensión completa, no la ausencia de "0%".
  verificar("llegar a 0° es extensión COMPLETA, no 0%",
    /width:100%/.test(barraEn0) && /extensionCompleta/.test(barraEn0) && !/faltaExtension/.test(barraEn0));
  verificar("y quedarse en 15° dice que le faltan grados",
    /faltaExtension/.test(barraEn15));
  verificar("un movimiento normal sí se calcula como porcentaje",
    /width:50%/.test(barraMovilidad(90, 180)));

  // ═══ 3. LA EVALUACIÓN Y EL MAPA ══════════════════════════════════════════
  console.log("\n── 3. El mapa de dolor ──");
  const ev0 = await pedir(`/medico/pacientes/${juan._id}/fisio`, tk);
  verificar("la evaluación se crea sola la primera vez", ev0.estado === 200 && !!ev0.cuerpo?.evaluacion);
  verificar("y viene con las listas para dibujar la pantalla",
    (ev0.cuerpo?.opciones?.ARTICULACIONES_ROM || []).length === 8 &&
    (ev0.cuerpo?.opciones?.BANDERAS_ROJAS || []).length === 10);

  const marcar = await pedir(`/medico/pacientes/${juan._id}/fisio/dolor`, tk, "POST", {
    region: "lumbar", lado: "central", vista: "espalda", x: 50, y: 35, intensidad: 7, tipo: "mecanico",
  });
  verificar("se marca un punto de dolor", marcar.estado === 201);
  verificar("y el punto queda con su intensidad y su vista",
    marcar.cuerpo?.evaluacion?.puntosDolor?.[0]?.intensidad === 7 &&
    marcar.cuerpo?.evaluacion?.puntosDolor?.[0]?.vista === "espalda");

  // Marcar un punto tiene que arrancar la serie de tiempo solo. Si esto no
  // pasa, el dolor se ve en el mapa pero no aparece en ningún gráfico y
  // nadie se entera de que faltaba.
  const serie = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones?clase=dolor`, tk);
  verificar("marcar un punto deja además una medición en la serie de tiempo",
    (serie.cuerpo?.mediciones || []).some(m => m.clase === "dolor" && m.zona === "lumbar" && m.valor === 7));

  const malDolor = await pedir(`/medico/pacientes/${juan._id}/fisio/dolor`, tk, "POST",
    { region: "lumbar", intensidad: 47 });
  verificar("no se puede marcar un dolor de 47 sobre 10", malDolor.estado === 400);

  // Sacar el punto del mapa NO borra lo que ya pasó: que haya tenido dolor 7
  // hace tres semanas es cierto, y es justo lo que muestra que mejoró.
  await pedir(`/medico/pacientes/${juan._id}/fisio/dolor/0`, tk, "DELETE");
  const serieDespues = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones?clase=dolor`, tk);
  verificar("sacar el punto del mapa no borra el historial de dolor",
    (serieDespues.cuerpo?.mediciones || []).length === 1);

  // ═══ 4. GONIOMETRÍA ══════════════════════════════════════════════════════
  console.log("\n── 4. La goniometría se valida contra su articulación ──");
  const romOk = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones`, tk, "POST", {
    clase: "goniometria", zona: "hombro", movimiento: "flexion", lado: "derecho", valor: 95,
  });
  verificar("se guarda una flexión de hombro", romOk.estado === 201 && romOk.cuerpo?.medicion?.valor === 95);

  const romMalMov = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones`, tk, "POST", {
    clase: "goniometria", zona: "rodilla", movimiento: "rotacion_externa", valor: 30,
  });
  verificar("NO se puede guardar una rotación externa de rodilla", romMalMov.estado === 400);

  const romMalArt = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones`, tk, "POST", {
    clase: "goniometria", zona: "sacroiliaca", movimiento: "flexion", valor: 30,
  });
  verificar("NO se puede medir una articulación que no está en la tabla", romMalArt.estado === 400);

  const romAbsurdo = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones`, tk, "POST", {
    clase: "goniometria", zona: "codo", movimiento: "flexion", valor: 900,
  });
  verificar("900° es un error de tipeo y no entra", romAbsurdo.estado === 400);

  const listaRom = await pedir(`/medico/pacientes/${juan._id}/fisio/mediciones?clase=goniometria`, tk);
  verificar("la lista de goniometría trae solo goniometría",
    (listaRom.cuerpo?.mediciones || []).every(m => m.clase === "goniometria"));
  verificar("y viene con tope, no abierta",
    typeof listaRom.cuerpo?.tope === "number" && listaRom.cuerpo.tope > 0);

  // ═══ 5. OBJETIVOS ════════════════════════════════════════════════════════
  console.log("\n── 5. Los objetivos se miden sesión a sesión ──");
  const obj = await pedir(`/medico/pacientes/${juan._id}/fisio/objetivos`, tk, "POST", {
    titulo: "Sube un piso de escalera sin baranda", area: "marcha",
    criterio: "10 escalones alternando pies, sin apoyo",
  });
  verificar("se crea un objetivo", obj.estado === 201);
  const objId = obj.cuerpo?.objetivo?._id;

  const sinTitulo = await pedir(`/medico/pacientes/${juan._id}/fisio/objetivos`, tk, "POST", { titulo: "  " });
  verificar("un objetivo sin título no se crea", sinTitulo.estado === 400);

  const ses1 = await pedir(`/medico/fisio/objetivos/${objId}/progreso`, tk, "POST", {
    intentos: 10, logros: 4, ayuda: "fisica_parcial", dolor: 6,
  });
  verificar("se registra una sesión", ses1.estado === 200 && ses1.cuerpo?.objetivo?.progreso?.length === 1);
  verificar("y la sesión guarda el dolor, que es lo que este módulo agrega",
    ses1.cuerpo?.objetivo?.progreso?.[0]?.dolor === 6);

  const imposible = await pedir(`/medico/fisio/objetivos/${objId}/progreso`, tk, "POST", {
    intentos: 5, logros: 9, ayuda: "independiente", dolor: 0,
  });
  verificar("no puede haber más logros que intentos", imposible.estado === 400);

  const sinDolor = await pedir(`/medico/fisio/objetivos/${objId}/progreso`, tk, "POST", {
    intentos: 10, logros: 8, ayuda: "verbal", dolor: 99,
  });
  verificar("un dolor de 99 tampoco entra", sinDolor.estado === 400);

  // El caso que justifica que el dolor y la ayuda vayan en el MISMO gráfico:
  // bajó la ayuda pero subió el dolor. Si la pantalla no lo dijera, eso se
  // leería como un avance cuando probablemente sea una compensación.
  verificar("la pantalla avisa cuando baja la ayuda pero sube el dolor",
    /fisio\.obj\.ojoDolor/.test(fuentePantalla));

  // ═══ 6. NADIE VE LA FICHA DE OTRO ════════════════════════════════════════
  console.log("\n── 6. Un kinesiólogo no ve la ficha de otro ──");
  const espia = await pedir(`/medico/pacientes/${juan._id}/fisio`, tkOtro);
  verificar("otro profesional no puede abrir esta evaluación", espia.estado === 404);
  const espiaObj = await pedir(`/medico/fisio/objetivos/${objId}`, tkOtro, "PATCH", { estado: "suspendido" });
  verificar("ni tocar sus objetivos", espiaObj.estado === 404);
  const espiaMed = await pedir(`/medico/pacientes/${ajeno._id}/fisio/mediciones`, tk);
  verificar("ni pedir las mediciones de un paciente ajeno", espiaMed.estado === 404);
  // 404 y no 403: un 403 confirmaría que el objeto existe, y eso ya es
  // contar algo de un paciente de otro.
  verificar("y el rechazo es 404, que no confirma que exista",
    espia.estado === 404 && espiaObj.estado === 404);

  // ═══ 7. QUE LA PANTALLA ESTÉ CABLEADA ════════════════════════════════════
  console.log("\n── 7. El módulo está enchufado a la app ──");
  const estado = require("fs").readFileSync(path.join(RAIZ, "public", "js", "estado.js"), "utf8");
  const pacientesJs = require("fs").readFileSync(path.join(RAIZ, "public", "js", "pacientes.js"), "utf8");
  const indexHtml = require("fs").readFileSync(path.join(RAIZ, "index.html"), "utf8");
  const indexJs = require("fs").readFileSync(path.join(RAIZ, "index.js"), "utf8");
  const authJs = require("fs").readFileSync(path.join(RAIZ, "public", "js", "auth.js"), "utf8");

  verificar("fisioterapia tiene su juego de pestañas", /TABS_KARDEX_FISIOTERAPIA/.test(estado));
  verificar("y el selector de especialidad lo elige", /"fisioterapia" \? TABS_KARDEX_FISIOTERAPIA/.test(estado));
  verificar("la pestaña de objetivos sabe a cuál de las dos pantallas ir",
    /fisioterapia.*renderTabObjetivosFisio/s.test(pacientesJs));
  verificar("el archivo se carga en la app", /js\/fisioterapia\.js/.test(indexHtml));
  verificar("las rutas están registradas", /routes\/fisioterapia/.test(indexJs));
  verificar("y un kinesiólogo puede elegir su especialidad al registrarse",
    /"fisioterapia"/.test(authJs));

  // Todo texto de pantalla tiene que salir de i18n. El módulo de neuro dejó
  // castellano incrustado y hoy no se puede traducir sin tocar el código;
  // acá se controla desde el primer día.
  const esFisio = require("fs").readFileSync(path.join(RAIZ, "public", "i18n", "es", "fisio.js"), "utf8");
  const ptFisio = require("fs").readFileSync(path.join(RAIZ, "public", "i18n", "pt", "fisio.js"), "utf8");
  const clavesEs = [...esFisio.matchAll(/^\s*"([a-zA-Z0-9_.]+)"\s*:/gm)].map(m => m[1]);
  const clavesPt = new Set([...ptFisio.matchAll(/^\s*"([a-zA-Z0-9_.]+)"\s*:/gm)].map(m => m[1]));
  const faltanEnPt = clavesEs.filter(k => !clavesPt.has(k));
  verificar(`las ${clavesEs.length} claves de texto están también en portugués`, faltanEnPt.length === 0);
  if (faltanEnPt.length) console.log("   faltan:", faltanEnPt.slice(0, 10).join(", "));

  const usadas = [...fuentePantalla.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\)/g)].map(m => m[1]);
  const declaradas = new Set(clavesEs);
  const sinDeclarar = [...new Set(usadas)].filter(k => !declaradas.has(k));
  verificar("y toda clave que la pantalla pide existe", sinDeclarar.length === 0);
  if (sinDeclarar.length) console.log("   sin declarar:", sinDeclarar.join(", "));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
