// Vitalis — ¿El relay de la teleconsulta releva de verdad?
//
// ═══ POR QUÉ HACE FALTA ESTE PROGRAMA ══════════════════════════════════════
//
// "systemctl status coturn: active (running)" no prueba nada. coturn puede
// estar impecable y el firewall cerrado; puede autenticar y no saber su IP
// pública; puede andar por TCP y no por UDP. En los tres casos el síntoma es
// EXACTAMENTE el mismo que si no lo hubieras instalado: la teleconsulta dice
// "conectado" y no se escucha nada.
//
// Eso no se descubre mirando logs. Se descubre en la primera consulta real,
// con un paciente esperando.
//
// Así que esto hace lo que haría el navegador de ese paciente: pide una
// asignación (Allocate) al relay, con las mismas credenciales temporales que
// genera services/video.js, y mira qué dirección le devuelven.
//
// ═══ LAS TRES COSAS QUE COMPRUEBA ══════════════════════════════════════════
//
//   1. Que se LLEGUE al relay          → si no, es el firewall.
//   2. Que ACEPTE las credenciales     → si no, el secreto del .env y el de
//                                         /etc/turnserver.conf no coinciden.
//   3. Que la dirección relevada sea PÚBLICA → si devuelve una 10.x, le falta
//      external-ip y le está dando a los pacientes una dirección que no
//      existe fuera de Google Cloud. Éste es el que se pasa por alto: los
//      dos primeros pasos dan OK y la llamada igual no se escucha.
//
// Uso, desde ~/vitalis-app:
//   node scripts/probar_turn.js
//   node scripts/probar_turn.js turn:otro.servidor:3478   (forzar una URL)
const path = require("path");
const crypto = require("crypto");
const dgram = require("dgram");
const net = require("net");
const tls = require("tls");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const MAGIC = 0x2112a442;
const ALLOCATE = 0x0003;
const ALLOCATE_OK = 0x0103;
const ALLOCATE_ERROR = 0x0113;

const ATR = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009,
  REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED_ADDRESS: 0x0020,
};

const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const gris = (s) => `\x1b[90m${s}\x1b[0m`;

// ═══ ARMAR Y LEER MENSAJES STUN ════════════════════════════════════════════

function encabezado(tipo, largo, tid) {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(tipo, 0);
  b.writeUInt16BE(largo, 2);
  b.writeUInt32BE(MAGIC, 4);
  tid.copy(b, 8);
  return b;
}

function atributo(tipo, valor) {
  const relleno = (4 - (valor.length % 4)) % 4;
  const b = Buffer.alloc(4 + valor.length + relleno);
  b.writeUInt16BE(tipo, 0);
  b.writeUInt16BE(valor.length, 2);
  valor.copy(b, 4);
  return b;
}

function armarAllocate(tid, cred) {
  // 17 = UDP. Es el transporte que se pide PARA EL RELAY, y no tiene nada
  // que ver con cómo le hablamos nosotros al servidor.
  const partes = [atributo(ATR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))];
  if (!cred) {
    const cuerpo = Buffer.concat(partes);
    return Buffer.concat([encabezado(ALLOCATE, cuerpo.length, tid), cuerpo]);
  }

  partes.push(atributo(ATR.USERNAME, Buffer.from(cred.usuario, "utf8")));
  partes.push(atributo(ATR.REALM, Buffer.from(cred.realm, "utf8")));
  partes.push(atributo(ATR.NONCE, cred.nonce));
  const cuerpo = Buffer.concat(partes);

  // El largo del encabezado ya tiene que contar los 24 bytes del
  // MESSAGE-INTEGRITY que todavía no escribimos. Si no, el HMAC se calcula
  // sobre bytes distintos a los que el servidor va a verificar y el error
  // que vuelve es un 401 idéntico al de una clave equivocada — o sea,
  // horas buscando en el lugar incorrecto.
  const cab = encabezado(ALLOCATE, cuerpo.length + 24, tid);
  const clave = crypto.createHash("md5")
    .update(`${cred.usuario}:${cred.realm}:${cred.clave}`, "utf8").digest();
  const firma = crypto.createHmac("sha1", clave)
    .update(Buffer.concat([cab, cuerpo])).digest();
  return Buffer.concat([cab, cuerpo, atributo(ATR.MESSAGE_INTEGRITY, firma)]);
}

function leerAtributos(msg) {
  const out = {};
  const fin = Math.min(20 + msg.readUInt16BE(2), msg.length);
  let i = 20;
  while (i + 4 <= fin) {
    const tipo = msg.readUInt16BE(i);
    const largo = msg.readUInt16BE(i + 2);
    if (i + 4 + largo > msg.length) break;
    out[tipo] = msg.slice(i + 4, i + 4 + largo);
    i += 4 + largo + ((4 - (largo % 4)) % 4);
  }
  return out;
}

// Las direcciones viajan XOR-eadas con el magic cookie. No es seguridad: es
// para que los NAT viejos que reescriben IP dentro del payload no la toquen.
function leerDireccion(val) {
  if (!val || val.length < 8) return null;
  const familia = val.readUInt8(1);
  const puerto = val.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (familia !== 0x01) return { ip: "(IPv6)", puerto };
  const ip = [];
  for (let i = 0; i < 4; i++) ip.push(val.readUInt8(4 + i) ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
  return { ip: ip.join("."), puerto };
}

function leerError(val) {
  if (!val || val.length < 4) return { codigo: 0, texto: "" };
  const codigo = (val.readUInt8(2) & 0x07) * 100 + val.readUInt8(3);
  return { codigo, texto: val.slice(4).toString("utf8") };
}

const ES_PRIVADA = (ip) =>
  /^10\./.test(ip) || /^127\./.test(ip) || /^169\.254\./.test(ip) ||
  /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

// ═══ HABLARLE AL SERVIDOR ══════════════════════════════════════════════════

function porUdp(host, puerto, mensaje, msTimeout) {
  return new Promise((resolver, rechazar) => {
    const s = dgram.createSocket("udp4");
    const reloj = setTimeout(() => { s.close(); rechazar(new Error("TIMEOUT")); }, msTimeout);
    s.on("error", (e) => { clearTimeout(reloj); try { s.close(); } catch {} rechazar(e); });
    s.on("message", (m) => { clearTimeout(reloj); s.close(); resolver(m); });
    s.send(mensaje, puerto, host, (e) => {
      if (e) { clearTimeout(reloj); try { s.close(); } catch {} rechazar(e); }
    });
  });
}

function porFlujo(seguro, host, puerto, mensaje, msTimeout) {
  return new Promise((resolver, rechazar) => {
    let acumulado = Buffer.alloc(0);
    const opciones = { host, port: puerto, servername: host };
    const s = seguro ? tls.connect(opciones) : net.connect(opciones);
    const reloj = setTimeout(() => { s.destroy(); rechazar(new Error("TIMEOUT")); }, msTimeout);
    const listo = () => s.write(mensaje);
    s.once(seguro ? "secureConnect" : "connect", listo);
    s.on("data", (d) => {
      acumulado = Buffer.concat([acumulado, d]);
      // Un mensaje STUN dice su propio largo; sobre TCP puede llegar
      // partido en varios pedazos o pegado al siguiente.
      if (acumulado.length >= 20 && acumulado.length >= 20 + acumulado.readUInt16BE(2)) {
        clearTimeout(reloj);
        s.destroy();
        resolver(acumulado.slice(0, 20 + acumulado.readUInt16BE(2)));
      }
    });
    s.on("error", (e) => { clearTimeout(reloj); s.destroy(); rechazar(e); });
  });
}

// ═══ LA PRUEBA ═════════════════════════════════════════════════════════════

function interpretarUrl(url) {
  const m = /^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(\w+))?$/i.exec(String(url).trim());
  if (!m) return null;
  const seguro = m[1].toLowerCase() === "turns";
  const transporte = (m[4] || (seguro ? "tcp" : "udp")).toLowerCase();
  return {
    seguro, host: m[2], transporte,
    puerto: Number(m[3] || (seguro ? 5349 : 3478)),
  };
}

function credencialTemporal(secreto) {
  // El mismo cálculo que services/video.js. Si acá anda y en la llamada no,
  // el problema no es el relay.
  const vence = Math.floor(Date.now() / 1000) + 600;
  const usuario = `${vence}:vitalis`;
  return {
    usuario,
    clave: crypto.createHmac("sha1", secreto).update(usuario).digest("base64"),
  };
}

async function pedir(destino, mensaje) {
  const ms = 6000;
  if (destino.transporte === "udp") return porUdp(destino.host, destino.puerto, mensaje, ms);
  return porFlujo(destino.seguro, destino.host, destino.puerto, mensaje, ms);
}

async function probar(destino, credBase) {
  const tid = crypto.randomBytes(12);

  // Paso 1: sin credenciales. Un TURN sano SIEMPRE contesta 401 acá — es
  // así como entrega el realm y el nonce que hacen falta para el paso 2.
  const primera = await pedir(destino, armarAllocate(tid, null));
  const tipo1 = primera.readUInt16BE(0);
  const a1 = leerAtributos(primera);

  if (tipo1 !== ALLOCATE_ERROR) {
    throw new Error(`El servidor contestó 0x${tipo1.toString(16)} en vez de pedir credenciales. ` +
      `¿Es un STUN a secas y no un TURN?`);
  }
  const err1 = leerError(a1[ATR.ERROR_CODE]);
  if (err1.codigo !== 401) {
    throw new Error(`Esperaba 401 y llegó ${err1.codigo} ${err1.texto}`);
  }
  const realm = (a1[ATR.REALM] || Buffer.alloc(0)).toString("utf8");
  const nonce = a1[ATR.NONCE];
  if (!realm || !nonce) throw new Error("El 401 llegó sin realm o sin nonce");
  console.log(verde("✅ 1. El relay contesta") + gris(`   realm: ${realm}`));

  // Paso 2: con credenciales.
  const segunda = await pedir(destino,
    armarAllocate(crypto.randomBytes(12), { ...credBase, realm, nonce }));
  const tipo2 = segunda.readUInt16BE(0);
  const a2 = leerAtributos(segunda);

  if (tipo2 !== ALLOCATE_OK) {
    const err2 = leerError(a2[ATR.ERROR_CODE]);
    if (err2.codigo === 401 || err2.codigo === 441) {
      throw new Error(
        `Rechazó las credenciales (${err2.codigo} ${err2.texto}).\n` +
        `   El TURN_SECRET del .env y el static-auth-secret de\n` +
        `   /etc/turnserver.conf no son el mismo. Comparalos:\n` +
        `     grep TURN_SECRET ~/vitalis-app/.env\n` +
        `     sudo grep static-auth-secret /etc/turnserver.conf`);
    }
    throw new Error(`Falló la asignación: ${err2.codigo} ${err2.texto}`);
  }

  const relevada = leerDireccion(a2[ATR.XOR_RELAYED_ADDRESS]);
  if (!relevada) throw new Error("Asignó, pero no dijo qué dirección relevada le dio");
  console.log(verde("✅ 2. Acepta las credenciales y asigna un relay"));

  // Paso 3: el que se pasa por alto.
  if (ES_PRIVADA(relevada.ip)) {
    throw new Error(
      `Asignó ${relevada.ip}:${relevada.puerto}, que es una dirección PRIVADA.\n` +
      `   Le está dando a los pacientes una dirección que no existe fuera de\n` +
      `   la red de Google. La llamada va a conectar y no se va a escuchar —\n` +
      `   el mismo síntoma que si no hubiera TURN.\n` +
      `   Falta external-ip en /etc/turnserver.conf. Volvé a correr:\n` +
      `     sudo ./scripts/instalar_turn.sh`);
  }
  console.log(verde("✅ 3. La dirección relevada es pública") +
    gris(`   ${relevada.ip}:${relevada.puerto}`));

  const vista = leerDireccion(a2[ATR.XOR_MAPPED_ADDRESS]);
  if (vista) console.log(gris(`   (el relay te ve desde ${vista.ip})`));
}

async function principal() {
  const url = process.argv[2] || process.env.TURN_URL;
  const secreto = process.env.TURN_SECRET;
  const usuarioFijo = process.env.TURN_USUARIO;
  const claveFija = process.env.TURN_CLAVE;

  console.log("\n\x1b[1mVitalis — prueba del relay de teleconsulta\x1b[0m\n");

  if (!url) {
    console.log(rojo("No hay TURN_URL en el .env."));
    console.log("La teleconsulta anda igual, pero entre 1 y 2 de cada 10");
    console.log("llamadas van a conectar sin audio. Instalalo con:\n");
    console.log("    sudo ./scripts/instalar_turn.sh\n");
    process.exit(1);
  }

  const destino = interpretarUrl(url);
  if (!destino) {
    console.log(rojo(`No entiendo TURN_URL="${url}"`));
    console.log(gris('Tiene que ser algo como  turn:salud.chatgo.ia.bo:3478'));
    console.log(gris('                     o  turns:salud.chatgo.ia.bo:5349?transport=tcp'));
    process.exit(1);
  }

  let credBase;
  if (secreto) {
    credBase = credencialTemporal(secreto);
  } else if (usuarioFijo && claveFija) {
    credBase = { usuario: usuarioFijo, clave: claveFija };
    console.log(gris("Usando usuario fijo. Conviene pasar a TURN_SECRET:"));
    console.log(gris("una credencial que no vence, puesta en el navegador de"));
    console.log(gris("cualquiera que abra una teleconsulta, es un relay abierto.\n"));
  } else {
    console.log(rojo("Hay TURN_URL pero no hay TURN_SECRET (ni TURN_USUARIO/TURN_CLAVE)."));
    console.log("Sin credenciales el relay rechaza todo, así que hoy es como no tenerlo.");
    process.exit(1);
  }

  console.log(gris(`${destino.seguro ? "TLS" : destino.transporte.toUpperCase()} → ` +
    `${destino.host}:${destino.puerto}\n`));

  try {
    await probar(destino, credBase);
    console.log(verde("\n🏁 El relay anda. La teleconsulta ya cubre las redes difíciles."));
    console.log(gris("   Que la app lo use:  pm2 restart vitalis --update-env"));
    console.log(gris('   El arranque tiene que decir "con TURN propio (credenciales temporales)"\n'));
    process.exit(0);
  } catch (e) {
    if (e.message === "TIMEOUT") {
      console.log(rojo("❌ No contesta nadie.\n"));
      console.log("Casi siempre es el firewall, no coturn. Revisá, en orden:\n");
      console.log("  1. ¿Está corriendo?");
      console.log(gris("       sudo systemctl status coturn"));
      console.log(`  2. ¿Está escuchando en el ${destino.puerto}?`);
      console.log(gris(`       sudo ss -lnup | grep ${destino.puerto}`));
      console.log("  3. ¿Lo deja pasar Google Cloud?");
      console.log(gris("       gcloud compute firewall-rules list --filter='name~turn'"));
      console.log(gris("\n   Ojo: probar desde la misma VM puede dar OK aunque el firewall"));
      console.log(gris("   esté cerrado. La prueba que vale es desde afuera.\n"));
    } else {
      console.log(rojo(`❌ ${e.message}\n`));
    }
    process.exit(1);
  }
}

principal();
