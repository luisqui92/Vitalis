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
