// Symphomed — Qué le está pasando de verdad al WhatsApp.
//
// El panel de Meta muestra media docena de pantallas y ninguna contesta la
// pregunta que importa: "¿el número que está usando ESTE servidor puede
// escribirle a cualquier paciente, o solo a la lista de prueba?".
//
// Peor: cuando no puede, el envío falla con el código 131030 y el paciente
// simplemente no recibe nada. Nadie se entera hasta que un médico avisa que
// sus pacientes dejaron de recibir recordatorios — y para entonces ya pasaron
// semanas.
//
// Este script le pregunta a Meta directamente, con las credenciales que el
// servidor tiene puestas ahora mismo. Eso es lo que lo hace útil: no dice qué
// hay configurado en el panel, dice qué está usando el proceso que corre.
//
//   node scripts/revisar_whatsapp.js
//
// Y opcionalmente, la prueba definitiva — mandar un mensaje real a un número
// que NO esté en la lista de prueba:
//
//   node scripts/revisar_whatsapp.js 59170123456
require("dotenv").config();
const axios = require("axios");
const { CONFIG } = require("../config");

const VERDE = (t) => `\x1b[32m${t}\x1b[0m`;
const ROJO = (t) => `\x1b[31m${t}\x1b[0m`;
const AMBAR = (t) => `\x1b[33m${t}\x1b[0m`;
const GRIS = (t) => `\x1b[90m${t}\x1b[0m`;

const API = "https://graph.facebook.com/v21.0";

async function pedir(ruta, params = {}) {
  const r = await axios.get(`${API}/${ruta}`, {
    params: { access_token: CONFIG.WHATSAPP_TOKEN, ...params },
    timeout: 15000,
  });
  return r.data;
}

(async () => {
  console.log("\n── Lo que tiene puesto ESTE servidor ──\n");

  if (!CONFIG.WHATSAPP_TOKEN || !CONFIG.WHATSAPP_PHONE_NUMBER_ID) {
    console.log(ROJO("  Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el .env."));
    console.log("  Sin eso no se manda ni un mensaje, y el log solo dice 'No configurado'.\n");
    process.exit(1);
  }
  console.log(`  Phone Number ID : ${CONFIG.WHATSAPP_PHONE_NUMBER_ID}`);
  console.log(`  Token           : ${GRIS(CONFIG.WHATSAPP_TOKEN.slice(0, 12) + "…")}`);

  // Este decide si los mensajes ENTRANTES se procesan, así que va antes de
  // hablar con Meta. Sin él, mandar sigue funcionando y recibir no: el médico
  // manda recordatorios sin problema y ningún paciente logra reservar. Los
  // dos síntomas no parecen tener nada que ver entre sí.
  console.log(`  App Secret      : ${CONFIG.WHATSAPP_APP_SECRET
    ? VERDE("configurado") : ROJO("FALTA — nadie puede reservar por WhatsApp")}`);
  if (!CONFIG.WHATSAPP_APP_SECRET) {
    console.log("\n  " + ROJO("El webhook rechaza TODOS los mensajes entrantes con 503."));
    console.log("  Con él se comprueba la firma que Meta pone en cada entrega. Sin");
    console.log("  comprobarla, cualquiera que sepa la URL puede cancelarle la cita a");
    console.log("  un paciente o llenarle la agenda al médico — por eso no se saltea.\n");
    console.log("  Está en developers.facebook.com → tu app → Configuración → Básica");
    console.log("  → App Secret → Mostrar. NO es el token de acceso ni el verify token.\n");
    console.log("  " + GRIS("WHATSAPP_APP_SECRET=... en el .env, y después: pm2 restart vitalis\n"));
  }

  // ─── El número ───────────────────────────────────────────────────────────
  let numero;
  try {
    numero = await pedir(CONFIG.WHATSAPP_PHONE_NUMBER_ID, {
      fields: "display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput",
    });
  } catch (e) {
    const err = e.response?.data?.error || {};
    console.log("\n" + ROJO(`  Meta rechazó la consulta (código ${err.code ?? "?"}): ${err.message || e.message}`));
    if (err.code === 190) console.log("  El token venció o fue revocado. Generá uno nuevo y actualizá WHATSAPP_TOKEN.");
    if (err.code === 100) console.log("  El PHONE_NUMBER_ID no corresponde a este token — suelen ser de apps distintas.");
    console.log("");
    process.exit(1);
  }

  console.log("\n── El número, según Meta ──\n");
  console.log(`  Número visible  : ${numero.display_phone_number || "—"}`);
  console.log(`  Nombre visible  : ${numero.verified_name || "—"}`);
  console.log(`  Estado nombre   : ${numero.name_status || "—"}`);
  console.log(`  Verificación    : ${numero.code_verification_status || "—"}`);
  console.log(`  Calidad         : ${numero.quality_rating || "—"}`);

  if (numero.name_status && numero.name_status !== "APPROVED") {
    console.log("\n  " + AMBAR(`El nombre visible está en estado ${numero.name_status}.`));
    console.log("  Mientras no esté aprobado, el paciente ve el número pelado en vez de la marca.");
  }

  // ─── El webhook, que es la mitad que nadie mira ──────────────────────────
  //
  // Guardar la URL y suscribir el campo "messages" son DOS pasos distintos en
  // el panel, y el segundo no se ve: la pantalla dice que la URL quedó
  // verificada igual. Si falta, el consultorio puede MANDAR mensajes y no
  // recibe ninguno — los pacientes escriben y nadie contesta, sin un solo
  // error en el log, porque el pedido nunca llega hasta acá.
  if (CONFIG.WHATSAPP_WABA_ID) {
    console.log("\n── El webhook ──\n");
    try {
      const susc = await pedir(`${CONFIG.WHATSAPP_WABA_ID}/subscribed_apps`);
      const apps = susc.data || [];
      if (!apps.length) {
        console.log("  " + ROJO("Ninguna app suscrita a esta cuenta."));
        console.log("  Meta no va a entregar NI UN mensaje entrante. En el panel:");
        console.log("  WhatsApp → Configuración → Webhook, y suscribir el campo 'messages'.\n");
      } else {
        for (const a of apps) {
          const d = a.whatsapp_business_api_data || {};
          console.log(`  App suscrita    : ${d.name || d.id || "(sin nombre)"}`);
          // Meta no siempre devuelve la lista de campos por este camino. Si no
          // viene, se dice que no vino, en vez de inventar un veredicto: un
          // diagnóstico que afirma de más es peor que uno que no sabe.
          const campos = a.subscribed_fields || d.subscribed_fields;
          if (Array.isArray(campos)) {
            console.log(`  Campos          : ${campos.join(", ")}`);
            console.log(`  ¿'messages'?    : ${campos.includes("messages")
              ? VERDE("sí") : ROJO("NO — no va a llegar ningún mensaje")}`);
          } else {
            console.log("  " + AMBAR("Meta no devolvió la lista de campos en esta consulta."));
            console.log("  " + GRIS("Miralo en el panel: WhatsApp → Configuración → Campos del"));
            console.log("  " + GRIS("webhook → 'messages' tiene que figurar como suscrito."));
          }
        }
        console.log("");
      }
    } catch (e) {
      const err = e.response?.data?.error || {};
      console.log("  " + ROJO(`No se pudo consultar (código ${err.code ?? "?"}): ${err.message || e.message}`));
      if (err.code === 100) console.log("  Revisá WHATSAPP_WABA_ID — no es el ID del número ni el de la app.\n");
    }

    // ─── Las plantillas ────────────────────────────────────────────────────
    //
    // Sin plantilla aprobada, todo lo que INICIA la plataforma —confirmación
    // de cita, reconsulta, informe— falla fuera de la ventana de 24 h. La
    // aprobación tarda y puede volver rechazada, así que conviene poder
    // preguntar cómo va sin entrar al panel.
    console.log("── Las plantillas ──\n");
    try {
      const { PLANTILLAS } = require("../services/metaWhatsapp");
      const esperadas = Object.values(PLANTILLAS);
      const r = await pedir(`${CONFIG.WHATSAPP_WABA_ID}/message_templates`, { limit: 100 });
      const porNombre = {};
      for (const p of r.data || []) (porNombre[p.name] ||= []).push(p);

      for (const nombre of esperadas) {
        const versiones = porNombre[nombre];
        if (!versiones) {
          console.log(`  ${ROJO("✗")} ${nombre.padEnd(22)} no existe todavía`);
          continue;
        }
        for (const v of versiones) {
          const estado = v.status === "APPROVED" ? VERDE(v.status)
            : v.status === "REJECTED" ? ROJO(v.status) : AMBAR(v.status);
          console.log(`  ${v.status === "APPROVED" ? VERDE("✓") : AMBAR("•")} ${nombre.padEnd(22)} ${v.language || "?"}  ${estado}`);
        }
      }
      const faltan = esperadas.filter(n => !porNombre[n]);
      if (faltan.length) {
        console.log("\n  " + AMBAR(`Faltan ${faltan.length}. Los mensajes que inicia la plataforma no salen`));
        console.log("  " + GRIS("fuera de la ventana de 24 h. El cuerpo exacto está en WHATSAPP_PLANTILLAS.md\n"));
      } else {
        console.log("");
      }
    } catch (e) {
      const err = e.response?.data?.error || {};
      console.log("  " + ROJO(`No se pudieron listar (código ${err.code ?? "?"}): ${err.message || e.message}\n`));
    }
  } else {
    console.log("\n  " + GRIS("Poniendo WHATSAPP_WABA_ID en el .env, este script también te dice si el"));
    console.log("  " + GRIS("webhook quedó suscrito y cómo van las plantillas.\n"));
  }

  // ─── La pregunta que importa ─────────────────────────────────────────────
  console.log("\n── ¿Puede escribirle a cualquiera? ──\n");
  const destino = String(process.argv[2] || "").replace(/\D/g, "");

  if (!destino) {
    console.log("  " + AMBAR("No se puede saber sin intentarlo."));
    console.log("  Meta no expone si la app está en modo Desarrollo: la única forma de");
    console.log("  averiguarlo es mandarle un mensaje a un número que NO esté en la lista");
    console.log("  de prueba y ver si lo rechaza.\n");
    console.log("  " + GRIS("node scripts/revisar_whatsapp.js 59170123456"));
    console.log("  " + GRIS("(usá un celular tuyo que no hayas agregado como número de prueba)\n"));
    process.exit(0);
  }

  console.log(`  Mandando un mensaje real a ${destino}…\n`);
  try {
    await axios.post(`${API}/${CONFIG.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: destino,
      type: "text",
      text: { body: "Prueba de Symphomed. Si te llegó esto, los recordatorios a pacientes funcionan." },
    }, {
      headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      timeout: 15000,
    });
    console.log("  " + VERDE("Aceptado por Meta."));
    console.log("  Si el mensaje llega al celular, la app está Activa y los recordatorios");
    console.log("  a pacientes funcionan. Si NO llega, revisá que el número tenga WhatsApp.\n");
  } catch (e) {
    const err = e.response?.data?.error || {};
    console.log("  " + ROJO(`Rechazado (código ${err.code ?? "?"}): ${err.message || e.message}`));
    if (err.code === 131030) {
      console.log("\n  " + ROJO("Ese es el código que importa: la app está en modo DESARROLLO."));
      console.log("  Solo escribe a los números de la lista de prueba. Con médicos reales,");
      console.log("  los recordatorios a pacientes fallan EN SILENCIO.\n");
      console.log("  Se arregla en developers.facebook.com → tu app → el selector");
      console.log("  Desarrollo/Activa arriba a la izquierda. Necesita la verificación del");
      console.log("  negocio hecha, que ya la tenés si el número quedó aprobado.\n");
    } else if (err.code === 131047) {
      console.log("\n  Pasaron más de 24 h desde el último mensaje de ese número: para escribir");
      console.log("  primero hay que usar una plantilla aprobada. Probá con un número que te");
      console.log("  haya escrito recién, o mandá una plantilla.\n");
    } else {
      console.log("");
    }
    process.exit(1);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
