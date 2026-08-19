// Vitalis — Notificaciones del navegador (Web Push).
//
// Sirve para avisarle al médico de cosas que pasan sin que él esté mirando
// la pantalla: hoy, que le entró una reserva. A diferencia del WebSocket de
// tiempo real (services/realtime.js), esto llega aunque tenga Vitalis
// cerrado, porque quien despierta al navegador es el service worker.
const webpush = require("web-push");
const { SuscripcionPush } = require("../db/models");
const { CONFIG, log } = require("../config");

let configurado = false;
if (CONFIG.VAPID_PUBLIC_KEY && CONFIG.VAPID_PRIVATE_KEY) {
  // El "subject" identifica a quién reclamarle si desde este servidor se
  // manda algo mal; los servicios de push solo lo aceptan como mailto: o
  // https:. Se usa el correo de contacto y no APP_URL justamente porque
  // APP_URL puede ser http:// (desarrollo) y web-push lo rechaza.
  //
  // Todo va en try/catch a propósito: una clave mal pegada en el .env
  // hacía que este require tirara y el servidor no arrancara para nadie.
  // Que fallen las notificaciones es un problema; que no se pueda abrir
  // una historia clínica por eso, es mucho peor.
  try {
    webpush.setVapidDetails(
      CONFIG.VAPID_SUBJECT || "mailto:soporte@chatgo.ia.bo",
      CONFIG.VAPID_PUBLIC_KEY,
      CONFIG.VAPID_PRIVATE_KEY
    );
    configurado = true;
  } catch (e) {
    log.error("[PUSH] configuración inválida, las notificaciones quedan apagadas:", e.message);
  }
}

function pushConfigurado() {
  return configurado;
}

// Manda el aviso a TODOS los navegadores que el médico haya suscrito (el
// celular, la compu del consultorio...). Nunca tira error hacia arriba: que
// falle una notificación no puede tumbar la reserva que la disparó.
async function notificarMedico(medicoPhone, { titulo, cuerpo, url }) {
  if (!configurado) return { enviadas: 0, motivo: "VAPID no configurado" };

  const suscripciones = await SuscripcionPush.find({ medicoPhone }).lean();
  if (!suscripciones.length) return { enviadas: 0, motivo: "sin dispositivos suscritos" };

  const payload = JSON.stringify({ titulo, cuerpo, url: url || "/" });
  let enviadas = 0, dadasDeBaja = 0;

  await Promise.all(suscripciones.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
        payload
      );
      enviadas++;
    } catch (e) {
      // 404/410 = el navegador dio de baja esa suscripción (desinstaló la
      // app, revocó el permiso, limpió datos). No es un error a reportar:
      // se limpia y listo, si no se acumulan endpoints muertos para siempre.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await SuscripcionPush.deleteOne({ endpoint: s.endpoint }).catch(() => {});
        dadasDeBaja++;
      } else {
        log.error("[PUSH] no se pudo notificar:", e.statusCode || "", e.message);
      }
    }
  }));

  if (dadasDeBaja) log.info(`[PUSH] ${dadasDeBaja} suscripción(es) vencida(s) eliminada(s) de ${medicoPhone}`);
  return { enviadas, dadasDeBaja };
}

module.exports = { notificarMedico, pushConfigurado };
