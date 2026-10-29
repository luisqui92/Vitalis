# Vincular una cuenta histórica con Google desde soporte

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
