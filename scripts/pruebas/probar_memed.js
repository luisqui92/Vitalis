// Symphomed — Recetar en Brasil pasa por Memed, y solo por Memed.
//
// En Brasil una receta necesita firma digital ICP-Brasil. La receta de
// Symphomed se imprime y no la tiene, así que allá no vale. Por eso en cuentas
// brasileñas la receta de Symphomed NO CONVIVE con la de Memed: desaparece.
// Dos botones de recetar —uno con validez legal y otro sin ella— es una
// trampa esperando a que alguien apurado use el equivocado.
//
// HOY MEMED ESTÁ APAGADO (services/memed.js → activo): Brasil receta con la
// receta de Symphomed. La sección 0 prueba el apagado; el resto prende
// MEMED_ACTIVO para que el módulo no se pudra mientras no se usa.
//
// Lo que se prueba acá es esa regla y los bordes que la sostienen: que la
// decisión salga de la MONEDA y no del idioma, que las llaves no se filtren
// al navegador, que una reimpresión no duplique la receta en el Kardex, y
// que lo que manda Memed se trate como lo que es: contenido de afuera.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);
process.env.MEMED_API_KEY = "llave-de-prueba";
process.env.MEMED_SECRET_KEY = "secreto-de-prueba";

const path = require("path");
const http = require("http");
const fs = require("fs");
const Module = require("module");
const RAIZ = path.join(__dirname, "..", "..");

let fallos = 0;
function verificar(descripcion, condicion) {
  console.log(`${condicion ? "✅" : "❌"} ${descripcion}`);
  if (!condicion) fallos++;
}

// Memed no se llama de verdad: se intercepta axios y se guarda con qué la
// habrían llamado. Lo que importa es QUÉ SE MANDA, no que ellos anden.
const pedidosAMemed = [];
const cargarOriginal = Module.prototype.require;
Module.prototype.require = function (nombre) {
  if (nombre === "axios") {
    return {
      post: async (url, cuerpo, opciones) => {
        pedidosAMemed.push({ url, cuerpo, opciones });
        return { data: { data: { attributes: { token: "token-del-medico-falso" } } } };
      },
    };
  }
  return cargarOriginal.apply(this, arguments);
};

let nPedido = 0;
function pedir(servidor, metodo, ruta, token, cuerpo) {
  const ip = `203.0.113.${(nPedido++ % 250) + 1}`;
  return new Promise((resolver) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo,
      headers: {
        "X-Forwarded-For": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(datos ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(datos) } : {}),
      },
    }, (res) => {
      let texto = "";
      res.on("data", d => { texto += d; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(texto); } catch { /* no era JSON */ }
        resolver({ estado: res.statusCode, cuerpo: json });
      });
    });
    req.on("error", () => resolver({ estado: 0, cuerpo: null }));
    if (datos) req.write(datos);
    req.end();
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("vitalis_prueba");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);

  const express = require("express");
  const app = express();
  app.use(express.json());
  require(path.join(RAIZ, "routes", "memed"))(app);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico, Paciente, Receta } = require(path.join(RAIZ, "db", "models"));
  const { hashPassword, generarToken } = require(path.join(RAIZ, "services", "auth"));
  await mongoose.connection.dropDatabase();
  await Receta.syncIndexes();   // el índice único de reimpresión vive en el esquema

  const hash = await hashPassword("Prueba123.");
  // Brasileña, con el consejo puesto.
  await Medico.create({
    phone: "5511900001", nombre: "Dra. Ana Souza", passwordHash: hash, activo: true,
    moneda: "BRL", idioma: "pt", conselho: { sigla: "CRM", uf: "SP", numero: "123456" },
  });
  // Boliviana, pero con la interfaz en portugués: NO receta por Memed.
  await Medico.create({
    phone: "70000001", nombre: "Dr. Boliviano", passwordHash: hash, activo: true,
    moneda: "BOB", idioma: "pt",
  });
  // Brasileña sin consejo cargado.
  await Medico.create({
    phone: "5511900002", nombre: "Dr. Sem Conselho", passwordHash: hash, activo: true,
    moneda: "BRL", idioma: "pt",
  });

  const pacBr = await Paciente.create({ medicoPhone: "5511900001", nombre: "João Silva", cpf: "52998224725" });
  const pacSinCpf = await Paciente.create({ medicoPhone: "5511900001", nombre: "Maria Sem CPF" });

  const tkBr = generarToken("5511900001", "medico", 3600 * 1000);
  const tkBo = generarToken("70000001", "medico", 3600 * 1000);
  const tkSinConsejo = generarToken("5511900002", "medico", 3600 * 1000);

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const GET = (ruta, tk) => pedir(servidor, "GET", ruta, tk);
  const POST = (ruta, tk, c) => pedir(servidor, "POST", ruta, tk, c);

  console.log("── 0. Apagado (como está hoy) ──");
  const memedSrv = require(path.join(RAIZ, "services", "memed"));
  delete process.env.MEMED_ACTIVO;
  const apagado = await GET("/medico/memed/estado", tkBr);
  verificar("sin MEMED_ACTIVO, una cuenta brasileña NO receta por Memed (vuelve la receta de Symphomed)",
    apagado.estado === 200 && apagado.cuerpo?.corresponde === false);
  verificar("  ...las rutas de Memed no existen (404)", (await GET(`/medico/pacientes/${pacBr._id}/memed/sesion`, tkBr)).estado === 404);
  verificar("  ...y la CSP ya no deja pasar sus dominios", memedSrv.dominiosCsp().length === 0);
  process.env.MEMED_ACTIVO = "si";
  verificar("con MEMED_ACTIVO=si vuelve (sin tocar código)", (await GET("/medico/memed/estado", tkBr)).cuerpo?.corresponde === true
    && memedSrv.dominiosCsp().length > 0);

  console.log("\n── 1. Lo decide la MONEDA, no el idioma ──");
  // Un médico boliviano con la interfaz en portugués sigue recetando en
  // Bolivia. Una preferencia de pantalla no decide bajo qué ley se emite un
  // documento — es la misma regla que services/monedas.js.
  const estadoBo = await GET("/medico/memed/estado", tkBo);
  verificar("una cuenta boliviana en portugués NO receta por Memed",
    estadoBo.estado === 200 && estadoBo.cuerpo?.corresponde === false);

  const estadoBr = await GET("/medico/memed/estado", tkBr);
  verificar("una cuenta brasileña sí", estadoBr.cuerpo?.corresponde === true);
  verificar("  ...y está lista", estadoBr.cuerpo?.listo === true);

  console.log("\n── 2. Las rutas no existen para quien no receta por Memed ──");
  const sesionBo = await GET(`/medico/pacientes/${pacBr._id}/memed/sesion`, tkBo);
  verificar("404, no 'no tenés permiso'", sesionBo.estado === 404);

  console.log("\n── 3. Sin consejo profesional no se receta ──");
  const sinConsejo = await GET("/medico/memed/estado", tkSinConsejo);
  verificar("el estado lo dice", sinConsejo.cuerpo?.faltaConsejo === true);
  verificar("  ...y distingue que la configuración del servidor SÍ está",
    sinConsejo.cuerpo?.faltaConfiguracion === false);

  console.log("\n── 4. Sin CPF del paciente tampoco ──");
  // Se corta acá con un mensaje claro en vez de dejar que el módulo abra y
  // falle adentro, donde el error ya no es nuestro y no se puede explicar.
  const sinCpf = await GET(`/medico/pacientes/${pacSinCpf._id}/memed/sesion`, tkBr);
  verificar("se frena antes de abrir", sinCpf.estado === 400);
  verificar("  ...diciendo qué falta", /CPF/i.test(sinCpf.cuerpo?.error || ""));

  console.log("\n── 5. Las llaves NO salen del servidor ──");
  pedidosAMemed.length = 0;
  const sesion = await GET(`/medico/pacientes/${pacBr._id}/memed/sesion`, tkBr);
  verificar("la sesión se entrega", sesion.estado === 200);
  verificar("  ...con el token del médico", sesion.cuerpo?.token === "token-del-medico-falso");
  const comoTexto = JSON.stringify(sesion.cuerpo);
  // Lo único que puede viajar al navegador es el token de ese médico. Las
  // llaves de la integración abren la cuenta de Symphomed entera en Memed.
  verificar("la API key NO viaja al navegador", !comoTexto.includes("llave-de-prueba"));
  verificar("la secret key TAMPOCO", !comoTexto.includes("secreto-de-prueba"));
  verificar("  ...y el paciente va con su CPF", sesion.cuerpo?.paciente?.cpf === "52998224725");

  console.log("\n── 6. Al médico se lo da de alta con su consejo partido ──");
  const alta = pedidosAMemed[0];
  const board = alta?.cuerpo?.data?.attributes?.board;
  verificar("se manda la sigla", board?.board_code === "CRM");
  // El estado es el DEL CONSEJO, no el del domicilio. Es el error más fácil
  // de cometer y no se nota hasta que una receta sale con otro registro.
  verificar("  ...el estado del consejo", board?.board_state === "SP");
  verificar("  ...y el número", board?.board_number === "123456");
  verificar("las llaves van como parámetros, no en el cuerpo",
    alta?.opciones?.params?.["api-key"] === "llave-de-prueba");

  console.log("\n── 7. Lo que manda Memed es contenido de afuera ──");
  const evento = {
    prescricao: {
      prescriptionUuid: "uuid-receta-1",
      prescriptionDate: "2026-09-03T10:00:00Z",
      medicamentos: [
        { nome: "Dipirona 500mg", posologia: "1 comprimido a cada 6 horas", quantidade: 20, unit: "comprimidos" },
        { nome: "", posologia: "sin nombre, se descarta" },
      ],
      // Un campo que no esperamos no puede terminar guardado en la ficha.
      pacienteInventado: { _id: "otro-paciente" },
    },
    reimpressao: false,
  };
  const guardada = await POST(`/medico/pacientes/${pacBr._id}/memed/recetas`, tkBr, evento);
  verificar("se guarda", guardada.estado === 200);

  const enBase = await Receta.findOne({ "memed.prescriptionUuid": "uuid-receta-1" }).lean();
  verificar("queda marcada como firmada por Memed", enBase?.origen === "memed");
  verificar("  ...en la ficha del paciente que Symphomed abrió", String(enBase?.pacienteId) === String(pacBr._id));
  verificar("  ...con el medicamento y su posología", enBase?.medicamentos[0]?.dosis === "1 comprimido a cada 6 horas");
  verificar("  ...descartando el que venía sin nombre", enBase?.medicamentos.length === 1);

  console.log("\n── 8. Una reimpresión no duplica la receta ──");
  // Reimprimir en Memed vuelve a disparar el MISMO evento con el mismo uuid.
  // Sin el índice único, cada reimpresión sería una receta nueva en el Kardex.
  const otraVez = await POST(`/medico/pacientes/${pacBr._id}/memed/recetas`, tkBr,
    { ...evento, reimpressao: true });
  verificar("contesta tranquilo, no con un error", otraVez.estado === 200);
  verificar("  ...avisando que ya estaba", otraVez.cuerpo?.yaEstaba === true);
  verificar("  ...y sigue habiendo UNA sola",
    (await Receta.countDocuments({ "memed.prescriptionUuid": "uuid-receta-1" })) === 1);

  console.log("\n── 9. Una receta sin medicamentos no es una receta ──");
  const vacia = await POST(`/medico/pacientes/${pacBr._id}/memed/recetas`, tkBr,
    { prescricao: { prescriptionUuid: "uuid-2", medicamentos: [] } });
  verificar("se rechaza", vacia.estado === 400);

  console.log("\n── 10. La receta de Symphomed desaparece en Brasil ──");
  // No convive: se elimina la caja del formulario de siempre. Si conviviera,
  // tarde o temprano alguien apurado emite la que no vale.
  const front = fs.readFileSync(path.join(RAIZ, "public", "js", "memed.js"), "utf8");
  verificar("memed.js quita la caja de la receta de Symphomed",
    /getElementById\("recetaNuevaBox"\)[\s\S]{0,120}remove\(\)/.test(front));

  console.log("\n── 11. La CSP deja pasar a Memed, y solo a Memed ──");
  // Sin esto el módulo no carga y la pantalla queda EN BLANCO sin ningún
  // error visible, que es la peor forma de fallar.
  const dominios = require(path.join(RAIZ, "services", "memed")).dominiosCsp();
  const indice = fs.readFileSync(path.join(RAIZ, "index.js"), "utf8");
  verificar("frameSrc existe y sale de la lista de Memed",
    /frameSrc:\s*\["'self'",\s*\.\.\.DOMINIOS_MEMED\]/.test(indice));
  verificar("  ...y esa lista incluye el dominio del módulo",
    dominios.includes("https://integrations.memed.com.br"));
  verificar("scriptSrc también", /scriptSrc:[^\]]*DOMINIOS_MEMED/.test(indice));
  verificar("frameAncestors sigue en 'none' (nadie embebe a Symphomed)",
    /frameAncestors:\s*\["'none'"\]/.test(indice));

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
