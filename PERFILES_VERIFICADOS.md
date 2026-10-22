# Perfiles, revisión profesional y teléfono de Symphomed

Esta entrega parte de `codex/acceso-google`. No despliega ni cambia credenciales del servidor.

## Registro y acceso

- Google confirma el control de una identidad Google. No acredita universidad, matrícula ni profesión.
- La primera alta exige elegir una tarjeta de perfil; ninguna aparece seleccionada. El servidor exige la selección para registros Google. Los ingresos posteriores recuperan el perfil guardado.
- Educativo: alta directa con Google, carrera, nivel, universidad y año/semestre. Sin invitación: prueba de 3 días y 15 minutos totales de audio. Las invitaciones existentes se mantienen como alternativa opcional. Ver [REGISTRO_ESTUDIANTES_ABIERTO.md](REGISTRO_ESTUDIANTES_ABIERTO.md).
- Profesional: país de la matrícula (código ISO de dos letras), profesión, área, matrícula y etapa profesional/residente. También se piden estos datos en el registro con contraseña. La cuenta queda inactiva y pendiente.
- El residente conserva una etapa de formación independiente de la habilitación. Elegir residente no acredita ni habilita funciones clínicas.
- Una cuenta Google pendiente o rechazada puede consultar/corregir su solicitud sin un segundo código. Recibe un ticket de diez minutos ligado al navegador, nunca un token clínico. El rechazo muestra el motivo. Para volver a entrar después de vencer el ticket se usa Google de nuevo.
- Las cuentas históricas mantienen el acceso. No se etiquetan como documentalmente verificadas por el mero despliegue.

## Panel de revisión

El operador autorizado con segundo factor activo debe comprobar identidad y matrícula, seleccionar consulta a registro oficial o revisión documental, y registrar una referencia de la comprobación. La referencia debe indicar fuente, fecha y resultado; no copiar documentos de identidad ni datos sensibles innecesarios.

Se guarda país, profesión, matrícula, método, referencia, autor y fecha. La verificación es manual: no se incluye una API de colegios profesionales ni reconocimiento automático de documentos. Una solicitud actualizada invalida la revisión anterior. Aprobar/rechazar compiten mediante actualización condicional: solo una decisión puede resolver esa versión de la solicitud. No se permite autoaprobarse.

Desde Configuración → Mi perfil, una cuenta educativa puede solicitar acceso profesional. Sigue como estudiante durante la revisión y también si se rechaza. Aprobar conserva el mismo ID, teléfono, identidad Google, formación e historial; invalida las sesiones anteriores. El antiguo comando `codigos_estudiante.js convertir` ya no convierte: dirige a este flujo.

El plan educativo se conserva con ámbito educativo y no cubre automáticamente el uso clínico tras la conversión. La contratación profesional sigue el circuito comercial existente. No se implementa alternar simultáneamente entre dos espacios independientes educativo/clínico.

Las rutas protegidas consultan el estado vigente de la cuenta y la marca educativa. Las cuentas nuevas con perfil profesional necesitan verificación vigente; una sesión antigua no puede conservar permisos tras un cambio de perfil. Los administradores y las cuentas históricas conservan sus reglas anteriores.

## Google y teléfono de contacto

El registro con Google ya verifica el correo. No se pide un segundo código por correo ni WhatsApp. Se conserva el segundo factor de Symphomed si la cuenta ya lo tenía activado. Elegir un perfil no basta para obtener permisos profesionales.

El teléfono nuevo sigue con `telefonoVerificado: false`. No sirve por sí solo para recuperar la cuenta, vincular otra identidad o evitar el segundo factor. Las verificaciones válidas de cuentas anteriores se conservan. Las rutas de OTP se retiraron del flujo y de la lista permitida a estudiantes. El servicio y sus pruebas de WhatsApp permanecen como código sin rutas activas para una futura entrega; configurar una plantilla no lo habilita.

## Activar avisos de correo

Se usa la API de **Resend** con Axios, ya incluido. No es necesario instalar otro paquete. Pasos para el administrador del servicio:

1. Crear una cuenta de Resend, agregar un dominio de envío de Symphomed y publicar los registros DNS que indique el proveedor. Esperar que el dominio figure verificado.
2. Crear una clave restringida al envío para ese dominio. Guardarla únicamente en el `.env` del servidor, nunca en Git ni por chat.
3. Configurar estas variables con valores reales:

```dotenv
RESEND_API_KEY=<clave-de-envio-del-proveedor>
CORREO_CUENTAS_REMITENTE="Symphomed <avisos@tu-dominio-verificado>"
APP_URL=https://app.symphomed.com
```

4. Integrar la rama, ejecutar las comprobaciones y reiniciar la aplicación con el procedimiento de instalación descrito abajo.
5. Probar con cuentas propias: solicitar acceso profesional, aprobar y rechazar desde el panel, y corregir/reenviar una solicitud. Comprobar ES/PT, destinatario, enlace y carpeta de spam. La prueba real requiere proveedor y DNS configurados.

Los avisos cubren recepción de solicitud profesional (incluidas conversión y corrección), aprobación y solicitud no aprobada que requiere revisar los datos. Solo se envían a `googleEmail` de una identidad Google vinculada y verificada por el servidor; no se confía en un correo enviado por el formulario ni en el email histórico de contacto. Las cuentas sin identidad Google conservan su acceso anterior y consultan su estado al ingresar; el panel indica que no tienen correo Google verificado.

Cada cambio de estado guarda el último aviso en la misma escritura de MongoDB. El proceso revisa la cola cada 30 segundos. Si la solicitud cambia antes de enviar, el aviso nuevo sustituye al anterior pendiente para priorizar la decisión actual. Un correo ya aceptado por el proveedor no se puede retirar; el estado vigente siempre se consulta al entrar.

Hay bloqueo temporal entre procesos, recuperación tras reinicio, cinco intentos con espera creciente e idempotencia del proveedor. Los reintentos automáticos se detienen antes de vencer su ventana de 24 horas. El panel muestra pendiente, en proceso, aceptado por el proveedor, error, vencido o sin correo Google. **Aceptado no confirma entrega ni lectura**; esta entrega no incluye webhooks de rebotes. Ante error, revisar la configuración y usar **Reintentar aviso**, reservado al mismo operador con segundo factor. Dentro de la ventana se reutiliza la clave; después, el reenvío explícito crea un aviso nuevo y puede duplicar un correo anterior cuya entrega no se confirmó.

Sin configuración, los avisos quedan pendientes; no se simula un envío exitoso. Configurar el proveedor inicia el procesamiento de esos avisos. Las solicitudes históricas sin aviso guardado no generan correos retroactivos por el despliegue. Un fallo del proveedor nunca cambia la decisión profesional. El correo no contiene matrícula, documentos, motivos sensibles del rechazo, códigos de acceso ni enlaces que aprueben cuentas.

## Validación de esta entrega

Ejecutables sin dependencias externas:

```bash
node scripts/pruebas/probar_google.js
node scripts/pruebas/probar_google_pantalla.js
node scripts/pruebas/probar_perfiles_acceso.js
node scripts/pruebas/probar_odontologia.js
node scripts/pruebas/probar_odontologia_pantalla.js
node scripts/pruebas/probar_globales_unicos.js
```

Las pruebas de perfiles ejecutan lógica y handlers reales, con persistencia y proveedor simulados. Incluyen carreras/niveles manipulados, roles, sesiones antiguas, revisión concurrente, rechazo de conversión, conservación del plan, cola de correo, concurrencia, reintentos, fallo del proveedor y ES/PT. También conservan pruebas del servicio OTP sin rutas activas. La prueba Google verifica firmas RSA reales. Las pruebas de pantalla utilizan DOM y SDK controlados.

**Pendiente de integración real antes de desplegar:** la instalación de dependencias no pudo completarse en este entorno. `probar_solicitudes_cuenta.js` fue actualizado, pero no pudo ejecutarse por falta de `mongodb-memory-server`. No se probó Google/Resend en vivo ni un navegador real. No confundir las pruebas simuladas con una certificación de producción.

En un entorno de pruebas con dependencias y MongoDB, ejecutar además:

```bash
node scripts/pruebas/probar_solicitudes_cuenta.js
```

Comprobar en móvil: alta educativa y profesional; perfil sin seleccionar; código de carrera equivocada; corrección de solicitud; aprobación y rechazo desde dos pestañas; ingreso antiguo y Google con 2FA; conversión conservando historial y cerrando la sesión anterior; teléfono nuevo sin verificación ni recuperación automática; avisos de recepción/aprobación/corrección, error real del proveedor y reintento desde el panel. Confirmar que el plan educativo no cubra consultas profesionales después de convertir.

## Instalación

Hacer respaldo de MongoDB y `.env`. Traer la rama `codex/perfiles-verificados` desde GitHub y revisar diferencias antes de integrarla. El servidor conserva JavaScript ofuscado localmente: guardarlo antes de actualizar; no usar `git reset --hard`, `git clean` ni borrar archivos para resolver conflictos. Con la rama integrada, ejecutar las pruebas, el ofuscador habitual y reiniciar PM2. No se añade ninguna dependencia npm.

El `.env` es del servidor y no debe subirse a Git. Para enviar avisos hace falta un dominio verificado y una clave válida de Resend. Sin configurar el correo, los accesos anteriores continúan y el teléfono nuevo permanece sin verificar.
