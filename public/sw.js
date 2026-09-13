// Symphomed — Service worker: lo único que hace es recibir las notificaciones
// del navegador y abrir la app cuando el médico las toca. No cachea nada a
// propósito: Symphomed es una app médica, mostrar datos viejos de un paciente
// sería peor que no mostrar nada.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { titulo: "Symphomed", cuerpo: event.data ? event.data.text() : "" };
  }

  // ═══ SE MUESTRA SIEMPRE, Y ES A PROPÓSITO ════════════════════════════════
  //
  // Tienta no avisar cuando el médico ya está mirando esa misma consulta: la
  // vio aparecer sola y la notificación encima es ruido.
  //
  // No se puede saber desde acá. El service worker solo ve la URL de cada
  // ventana, y la app limpia la barra de direcciones apenas usa el enlace
  // (si no, un F5 horas después devolvería al médico a esa consulta sin que
  // entienda por qué — ver irAPantallaInicial en public/js/auth.js). Así que
  // comparar contra la URL da siempre "no la está mirando".
  //
  // Se probó y se sacó: una supresión que parece funcionar y nunca se
  // dispara es peor que no tenerla, porque el que la lee cree que el caso
  // está cubierto. Para hacerlo bien, la app tendría que decirle al service
  // worker en qué pantalla está, y no vale la molestia: el caso es raro
  // —justamente el médico se va de la pantalla, por eso hay notificación— y
  // el costo de equivocarse para el otro lado es no enterarse.
  event.waitUntil(
    self.registration.showNotification(datos.titulo || "Symphomed", {
      body: datos.cuerpo || "",
      icon: "/img/simbolo-192.png",
      badge: "/img/simbolo-192.png",
      // Vibra al llegar: si el celular está en el bolsillo durante una
      // consulta, es lo único que se nota.
      vibrate: [180, 80, 180],
      data: { url: datos.url || "/" },
      // Sin tag: dos reservas seguidas tienen que verse las dos, no
      // pisarse una a la otra.
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      // Si Symphomed ya está abierto en alguna pestaña, se trae esa al frente
      // en vez de abrir otra más.
      for (const v of ventanas) {
        if (v.url.includes(self.location.origin) && "focus" in v) {
          v.navigate(destino).catch(() => {});
          return v.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
