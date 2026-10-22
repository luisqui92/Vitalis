# Acceso con Google para Symphomed

## Qué cambia

El botón oficial «Continuar con Google» aparece en login y registros cuando se configura Google. Las cuentas nuevas eligen explícitamente un perfil y completan los datos descritos en [PERFILES_VERIFICADOS.md](PERFILES_VERIFICADOS.md). Resumen:

- Profesionales: área y matrícula; permanecen pendientes de aprobación.
- Estudiantes, internos y residentes: código de invitación. La carrera, nivel, duración y horas salen del código, también para Enfermería y Odontología.

Las cuentas existentes conservan teléfono, contraseña, permisos, pacientes y datos. Desde Configuración pueden vincular Google confirmando la contraseña y el TOTP si está activo. Nunca se unen cuentas automáticamente por correo o por teléfono.

El teléfono continúa como clave interna de los datos existentes. Google añade una identidad estable `sub` con índice único sparse. No se migran las historias clínicas.

## Teléfono y recuperación

El teléfono del formulario queda sin verificar. No se ofrece recuperación automática por ese dato. Las cuentas creadas exclusivamente con Google usan la recuperación oficial de Google; los endpoints de aprobar y usar restablecimientos impiden emitir/usar un cambio de contraseña basado en un teléfono no verificado para esas cuentas. Una cuenta previa vinculada mantiene su recuperación habitual con revisión de operador.

El acceso Google no exige otro código por correo ni WhatsApp. El teléfono se conserva como contacto sin verificar; completarlo no habilita recuperación. Los avisos de revisión llegan al correo verificado por Google cuando se configura el proveedor, según [PERFILES_VERIFICADOS.md](PERFILES_VERIFICADOS.md). Tampoco se incluye cambiar/desvincular la identidad Google desde la pantalla: un reemplazo de identidad necesita un flujo de reautenticación y recuperación propio.

El 2FA de Symphomed se mantiene al entrar con Google. Las cuentas Google sin contraseña confirman el código actual del autenticador, dentro de una sesión autenticada, para desactivarlo; las cuentas antiguas mantienen la confirmación por contraseña.

## Configurar Google Cloud

1. En el proyecto de Symphomed, abrir **Google Auth Platform** (o **APIs y servicios → Credenciales**, según la consola).
2. Completar Branding: nombre Symphomed, correo de soporte, dominio de la aplicación, política de privacidad y condiciones reales. Configurar Audience como externa si se venderá al público. Durante pruebas agregar los usuarios de prueba.
3. Crear un **ID de cliente OAuth → Aplicación web**.
4. Añadir como **origen JavaScript autorizado** el origen exacto desde el que se abre la aplicación. Ejemplo: `https://app.symphomed.com`. No poner rutas. Si se accede desde otro dominio/subdominio, autorizar el correcto y usarlo de forma consistente.
5. Solo se utiliza Google Identity Services para identidad básica (nombre/correo); no se piden permisos de Calendar, Drive ni Gmail. El flujo es popup con callback JavaScript: no tiene una ruta redirect OAuth propia.
6. Copiar el ID público que termina en `.apps.googleusercontent.com` al servidor. No hace falta enviar ni guardar un Client Secret para este flujo.

En el `.env` del servidor:

```dotenv
APP_URL=https://app.symphomed.com
GOOGLE_LOGIN_CLIENT_ID=TU_ID.apps.googleusercontent.com
```

El `APP_URL` debe corresponder al origen real de la aplicación, no a una landing distinta. HTTPS es obligatorio salvo `http://localhost` para desarrollo. `JWT_SECRET` y MongoDB siguen siendo necesarios. Si falta configuración, el botón no se carga y el acceso anterior permanece disponible.

Este ID no es `GOOGLE_SERVICE_ACCOUNT_JSON`: esa variable es de la integración de Calendar y no debe sustituirse.

## Controles técnicos

- Botón oficial GIS, sin auto-select; no se carga el SDK hasta confirmar que está habilitado.
- CSP limita script, estilos, conexiones y frames a los endpoints de Google necesarios. Se conserva COOP `same-origin-allow-popups`.
- Verificación RS256 con `crypto.verify` y claves públicas obtenidas exclusivamente de `https://www.googleapis.com/oauth2/v3/certs` (axios, HTTPS, timeout, sin redirecciones, caché de un minuto).
- Verifica issuer, audience, azp si existe, nonce, firma, exp, iat, sub y email_verified booleano. No confía en identidad ni permisos enviados por el formulario.
- Nonce aleatorio en MongoDB con TTL y consumo atómico. Cookie HttpOnly, Secure en HTTPS, SameSite=Lax, duración diez minutos. POST requiere Origin exacto y JSON.
- Ticket de registro de diez minutos firmado y ligado al navegador; no es token de sesión. Índice único de Google evita doble registro y vínculos concurrentes. Google nunca se vincula solo por coincidencia de teléfono/email.
- Reutiliza sesión/roles, restricciones de módulos y 2FA actuales. Mantiene los códigos de estudiante de un solo uso y su devolución si falla el alta.
- Los teléfonos de operadores no se pueden reclamar mediante un alta nueva con Google: requieren una cuenta previa.
- Registro del acceso y vinculación en la auditoría. No se guardan los ID tokens de Google ni se registran en logs.
- No se añadieron dependencias npm.

## Validación y activación

```bash
node scripts/pruebas/probar_google.js
node scripts/pruebas/probar_google_pantalla.js
node scripts/pruebas/probar_globales_unicos.js
node scripts/pruebas/probar_odontologia.js
node scripts/pruebas/probar_odontologia_pantalla.js
```

Las pruebas nuevas usan firma RSA real, pero MongoDB/HTTP, el middleware de sesión y el SDK/DOM están simulados explícitamente. No son una prueba de OAuth con Google real. La instalación de dependencias y las pruebas completas con MongoDB/navegador no pudieron ejecutarse en el entorno de desarrollo. No declarar listo para producción sin esta validación.

Antes de activar para todos, probar en un entorno de pruebas con Google configurado:

1. Alta profesional nueva, aprobación en el panel e ingreso posterior con Google.
2. Alta de cada carrera con código, rechazo del código reutilizado, y restricciones de estudiante.
3. Login de una cuenta antigua y vinculación desde Configuración; comprobar que conserva sus datos.
4. Rechazo de teléfono ocupado, de Google vinculado a otra cuenta y de contraseña/TOTP incorrectos.
5. Login de una cuenta con 2FA, pendiente, rechazada e inactiva.
6. Cancelación de Google, popup bloqueado, ticket vencido y recarga del formulario.
7. Confirmar índices `googleSub_1` (unique, sparse) y TTL de desafíos en MongoDB. La primera iniciación de Google también crea/verifica los índices, incluyendo despliegues con autoIndex desactivado.
8. Recuperación: cuenta Google con teléfono sin verificar no recibe ni utiliza un enlace de restablecimiento. Probar la recuperación anterior de cuentas existentes.
9. Chrome móvil y escritorio en el origen real, incluyendo CSP, cookies y retorno del popup.

Para instalar, usar el procedimiento de despliegue habitual con respaldo previo y conservación de los JavaScript ofuscados locales. Después de las comprobaciones, ofuscar con `node scripts/ofuscar.js` y reiniciar PM2. No usar `git reset --hard` sobre el servidor.

Para deshabilitar solo Google, vaciar `GOOGLE_LOGIN_CLIENT_ID` y reiniciar. Las cuentas antiguas siguen entrando por contraseña, pero las nuevas creadas solo con Google necesitarán que se reactive Google. No retirar el acceso sin contemplar esas cuentas.

## Registro educativo abierto

La inscripción educativa ya no exige invitación: Google permite iniciar una prueba de 3 días y 15 minutos totales. Los códigos anteriores siguen siendo opcionales. Ver [REGISTRO_ESTUDIANTES_ABIERTO.md](REGISTRO_ESTUDIANTES_ABIERTO.md).
