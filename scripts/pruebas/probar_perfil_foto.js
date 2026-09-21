// Symphomed — Foto de perfil, de punta a punta.
//
// Lo que importa comprobar acá: que el archivo viejo se borra del disco
// cuando se sube uno nuevo (si no, cada "cambiar foto" deja un huérfano
// para siempre), que nadie más puede ver la foto de otro médico, y que
// quitarla de verdad borra el archivo — no solo la referencia en Mongo.
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(64);

const fs = require("fs");
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
  process.env.MONGODB_URI = mongod.getUri("perfilfoto");

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const express = require("express");
  const app = express();
  require(path.join(RAIZ, "routes", "perfilFoto"))(app);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));

  const { Medico } = require(path.join(RAIZ, "db", "models"));
  const { generarToken, hashPassword } = require(path.join(RAIZ, "services", "auth"));
  const { DIR_PERFILES } = require(path.join(RAIZ, "services", "archivosPerfil"));
  await mongoose.connection.dropDatabase();

  const clave = await hashPassword("ClaveVieja1234!");
  await Medico.create({ phone: "71000001", nombre: "Dra. Alejandra Quiroga", passwordHash: clave, activo: true, estadoCuenta: "aprobada" });
  await Medico.create({ phone: "71000002", nombre: "Dr. Vecino", passwordHash: clave, activo: true, estadoCuenta: "aprobada" });

  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, "127.0.0.1", r));
  const pedir = (ruta, token, metodo, cuerpo, contentType) => new Promise(res => {
    const req = http.request({
      host: "127.0.0.1", port: servidor.address().port, path: ruta, method: metodo || "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cuerpo ? { "Content-Type": contentType, "Content-Length": Buffer.byteLength(cuerpo) } : {}),
      },
    }, r => {
      const partes = [];
      r.on("data", d => partes.push(d));
      r.on("end", () => {
        const buf = Buffer.concat(partes);
        let j = null; try { j = JSON.parse(buf.toString()); } catch {}
        res({ estado: r.statusCode, cuerpo: j, buf, tipo: r.headers["content-type"] });
      });
    });
    req.on("error", () => res({ estado: 0 }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });

  const tk1 = generarToken("71000001", "medico", 3600000);
  const tk2 = generarToken("71000002", "medico", 3600000);
  // Un JPEG mínimo válido no hace falta: la ruta no decodifica la imagen,
  // solo la guarda — cualquier buffer con el content-type correcto alcanza.
  const fotoA = Buffer.from("contenido-de-la-foto-A");
  const fotoB = Buffer.from("contenido-de-la-foto-B-distinta-y-mas-larga");

  console.log("── 1. Sin foto todavía ──");
  const sinFoto = await pedir("/medico/perfil/foto", tk1);
  verificar("404: todavía no subió ninguna", sinFoto.estado === 404);

  console.log("\n── 2. Subir la primera foto ──");
  const subida1 = await pedir("/medico/perfil/foto", tk1, "POST", fotoA, "image/jpeg");
  verificar("responde 201", subida1.estado === 201);
  const medico1 = await Medico.findOne({ phone: "71000001" }).lean();
  verificar("  ...y queda la referencia en Mongo", Boolean(medico1.fotoPerfil?.archivoNombre));
  const archivo1 = medico1.fotoPerfil.archivoNombre;
  verificar("  ...con el archivo de verdad en disco", fs.existsSync(path.join(DIR_PERFILES, archivo1)));

  const traida1 = await pedir("/medico/perfil/foto", tk1);
  verificar("se puede volver a traer, con el mismo contenido", traida1.estado === 200 && traida1.buf.equals(fotoA));
  verificar("  ...con el content-type correcto", traida1.tipo === "image/jpeg");

  console.log("\n── 2b. Ningún otro médico ve esta foto ──");
  const otroLaVe = await pedir("/medico/perfil/foto", tk2);
  verificar("el médico vecino no tiene ninguna (no ve la de al lado)", otroLaVe.estado === 404);

  console.log("\n── 3. Cambiarla: la vieja se borra del disco ──");
  const subida2 = await pedir("/medico/perfil/foto", tk1, "POST", fotoB, "image/png");
  verificar("responde 201", subida2.estado === 201);
  const medico2 = await Medico.findOne({ phone: "71000001" }).lean();
  const archivo2 = medico2.fotoPerfil.archivoNombre;
  verificar("  ...el nombre de archivo cambió", archivo2 !== archivo1);
  verificar("  ...la foto vieja YA NO está en disco (no queda huérfana)", !fs.existsSync(path.join(DIR_PERFILES, archivo1)));
  verificar("  ...y la nueva sí", fs.existsSync(path.join(DIR_PERFILES, archivo2)));
  const traida2 = await pedir("/medico/perfil/foto", tk1);
  verificar("  ...y trae el contenido nuevo, no el viejo", traida2.buf.equals(fotoB));

  console.log("\n── 4. Quitarla borra el archivo de verdad, no solo la referencia ──");
  const quitar = await pedir("/medico/perfil/foto", tk1, "DELETE", "");
  verificar("responde 200", quitar.estado === 200);
  const medico3 = await Medico.findOne({ phone: "71000001" }).lean();
  verificar("  ...y la referencia queda vacía en Mongo", !medico3.fotoPerfil?.archivoNombre);
  verificar("  ...y el archivo ya no está en disco", !fs.existsSync(path.join(DIR_PERFILES, archivo2)));
  const traida3 = await pedir("/medico/perfil/foto", tk1);
  verificar("  ...y pedirla de nuevo da 404", traida3.estado === 404);

  console.log("\n── 5. Quitar una que ya no existe no rompe nada ──");
  const quitarDeNuevo = await pedir("/medico/perfil/foto", tk1, "DELETE", "");
  verificar("responde 200 igual (no hay nada que fallar)", quitarDeNuevo.estado === 200);

  console.log("\n── 6. Sin sesión, ninguna de las tres puertas responde ──");
  for (const [metodo, cuerpo, ct] of [["GET", null], ["POST", fotoA, "image/jpeg"], ["DELETE", null]]) {
    const r = await pedir("/medico/perfil/foto", null, metodo, cuerpo, ct);
    verificar(`${metodo} sin token: 401`, r.estado === 401);
  }

  servidor.close();
  await mongoose.disconnect();
  await mongod.stop();
  console.log(fallos === 0 ? "\n🏁 TODO BIEN" : `\n💥 ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
