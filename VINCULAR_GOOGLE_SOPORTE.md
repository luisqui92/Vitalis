# Vincular una cuenta histórica con Google desde soporte

## Solicitud con aprobación desde el panel (sin conocer previamente el correo)

Para el cliente que solo conoce su teléfono y tiene un Google aún sin vincular:

```sh
node scripts/habilitar_revision_google.js TELEFONO_CON_PAIS
```

Habilita únicamente la cuenta encontrada durante 48 horas; admite formatos
históricos del teléfono y se detiene si hay varias coincidencias. No necesita un
correo guardado. Desactiva la excepción automática y enlaces anteriores de esa
cuenta para que la nueva vinculación requiera decisión humana.

El cliente entra con Google, escribe el teléfono en «Completá tu perfil» y toca
«Ya tengo cuenta: solicitar vinculación con Google». No necesita elegir carrera,
volver a declarar matrícula ni saber su contraseña. Si envía el alta profesional
habitual, la cuenta habilitada también se dirige a esta revisión.

El servidor valida el ticket de Google y su cookie/nonce antes de registrar la
solicitud. No se obtiene el correo de un campo libre. La solicitud no crea una
cuenta ni concede sesión. Repetir el envío con el mismo Google no crea duplicados.

En **Cuentas y pagos → Vinculaciones con Google**, un operador autorizado con 2FA
puede actualizar la lista, ver cuenta y teléfono originales y el correo que pide
acceso, y aprobar o rechazar tras confirmar la identidad por soporte. Google prueba
el correo, no la propiedad del teléfono: el operador debe revisar la solicitud.
No se envía ningún mensaje por WhatsApp, SMS o correo.

La decisión y la vinculación se guardan juntas en la cuenta mediante una operación
atómica con control de revisión. Aprobar consume el permiso y cierra las sesiones
anteriores; conserva teléfono literal, contraseña, permisos, plan y segundo factor.
El cliente vuelve a ingresar con el Google aprobado. La API de aprobación no
entrega al operador una sesión del cliente. Un Google ya vinculado a otra cuenta
no se reasigna. Rechazar no cambia el acceso, y una solicitud de otro Google no
puede sobrescribir la primera. Las solicitudes caducadas necesitan renovar la
habilitación mediante el comando de soporte. Máximo 50 solicitudes por cuenta.

Pruebas del nuevo flujo: `node scripts/pruebas/probar_google_revision.js`.
Incluye middleware, decisiones concurrentes, permisos, segundo factor, pantalla
de operador y datos preservados, con MongoDB y OAuth simulados. La prueba final
con el cliente y el operador debe hacerse en la instalación real.

## Excepción de un solo uso desde el registro habitual

Si el administrador confirma que el correo ya guardado en la cuenta pertenece
al cliente, puede autorizar únicamente esa cuenta sin enviar enlaces o mensajes:

```sh
node scripts/autorizar_google_existente.js TELEFONO_CON_PAIS
```

Busca una cuenta única ignorando el formato del teléfono. Toma `googleEmail`, o
`email` si no hay `googleEmail`; si no hay correo válido o Google ya está vinculado,
se detiene. Muestra el nombre, teléfono literal y correo autorizado. No deduce
el correo a partir de lo que declare el siguiente visitante.

Durante 48 horas, el cliente entra con Google, elige perfil profesional y envía
el formulario con su teléfono. Un ticket de Google válido que confirme exactamente
el correo autorizado vincula la cuenta original y consume el permiso atómicamente.
El resto de las cuentas mantiene el comportamiento anterior. El permiso usado no
puede reactivarse mediante este comando. El primer acceso conserva el control 2FA.
No cambia el teléfono, contraseña, permisos, datos o plan. No hace falta WhatsApp,
SMS ni códigos enviados por correo. La autorización es un acto de soporte; la
mera coincidencia de teléfono nunca alcanza para apropiarse de una cuenta.

## Enlace privado de soporte

Para un cliente que conserva su cuenta pero no recuerda la contraseña o el
formato del teléfono. No crea cuentas, no migra historias y no cambia el teléfono.

Después de desplegar y reiniciar la aplicación:

```sh
node scripts/vincular_google_cliente.js
```

1. Escribir los dígitos del teléfono completo, con código de país. La búsqueda
   admite espacios, paréntesis, guiones, puntos y varios signos `+` guardados.
2. Revisar el nombre, teléfono literal e ID encontrados. Si hay varias cuentas
   con los mismos dígitos, el programa se detiene: no decide cuál corresponde.
3. Indicar el correo de Google que el cliente confirmó que controla.
4. Tras verificar su identidad por el canal de soporte habitual, escribir la
   confirmación que aparece en la terminal.
5. Enviar el enlace privado directamente al cliente. No publicarlo en capturas.
6. El cliente lo abre en Chrome/Safari, confirma ese Google y, si tiene 2FA,
   introduce el código de su autenticador. Después ingresa normalmente con Google.

El enlace dura dos horas, sirve una vez y se guarda como hash. Emitir otro para
la misma cuenta invalida el anterior. No envía mensajes automáticamente.
El fragmento del enlace se elimina al abrir la pantalla; si se recarga esa
pantalla antes de terminar, hay que abrir otra vez el enlace original.

La emisión requiere acceso SSH al servidor. No hay endpoint público para
autorizar enlaces. Confirmar exige tanto el enlace como una identidad de Google
verificada, con el correo autorizado, origen y nonce del navegador válidos.
No sustituye un Google ya asociado ni acepta uno que pertenezca a otra cuenta.
No elimina 2FA ni habilita cuentas inactivas, rechazadas o pendientes de revisión.
Conserva contraseña, permisos, suscripción y teléfono; cierra sesiones anteriores
al completar la vinculación. El acceso posterior usa los controles habituales.

Queda auditoría de la autorización SSH y de la vinculación HTTP. La aprobación
del panel y sus requisitos no se alteran: esta es una herramienta de soporte.

Validación automática: `node scripts/pruebas/todas.js google --estricto`.
Las pruebas de soporte usan criptografía real y persistencia/OAuth simulados;
no sustituyen una prueba de Google y MongoDB reales en el despliegue.
