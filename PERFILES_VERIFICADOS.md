# Perfiles, revisión profesional y teléfono de Symphomed

Esta entrega parte de `codex/acceso-google`. No despliega ni cambia credenciales del servidor.

## Registro y acceso

- Google confirma el control de una identidad Google. No acredita universidad, matrícula ni profesión.
- La primera alta exige elegir una tarjeta de perfil; ninguna aparece seleccionada. El servidor exige la selección para registros Google. Los ingresos posteriores recuperan el perfil guardado.
- Educativo: código de invitación, carrera, nivel, universidad y año/semestre. Carrera y nivel deben coincidir con el código; el código sigue fijando duración y cuotas. Se conserva el modelo comercial de invitaciones; no se crea una prueba gratuita sin código.
- Profesional: país de la matrícula (código ISO de dos letras), profesión, área, matrícula y etapa profesional/residente. También se piden estos datos en el registro con contraseña. La cuenta queda inactiva y pendiente.
- El residente conserva una etapa de formación independiente de la habilitación. Elegir residente no acredita ni habilita funciones clínicas.
- Una cuenta Google pendiente o rechazada puede consultar/corregir su solicitud y verificar su teléfono. Recibe un ticket de diez minutos ligado al navegador, nunca un token clínico. El rechazo muestra el motivo. Para volver a entrar después de vencer el ticket se usa Google de nuevo.
- Las cuentas históricas mantienen el acceso. No se etiquetan como documentalmente verificadas por el mero despliegue.

## Panel de revisión

El operador autorizado con segundo factor activo debe comprobar identidad y matrícula, seleccionar consulta a registro oficial o revisión documental, y registrar una referencia de la comprobación. La referencia debe indicar fuente, fecha y resultado; no copiar documentos de identidad ni datos sensibles innecesarios.

Se guarda país, profesión, matrícula, método, referencia, autor y fecha. La verificación es manual: no se incluye una API de colegios profesionales ni reconocimiento automático de documentos. Una solicitud actualizada invalida la revisión anterior. Aprobar/rechazar compiten mediante actualización condicional: solo una decisión puede resolver esa versión de la solicitud. No se permite autoaprobarse.

Desde Configuración → Mi perfil, una cuenta educativa puede solicitar acceso profesional. Sigue como estudiante durante la revisión y también si se rechaza. Aprobar conserva el mismo ID, teléfono, identidad Google, formación e historial; invalida las sesiones anteriores. El antiguo comando `codigos_estudiante.js convertir` ya no convierte: dirige a este flujo.

El plan educativo se conserva con ámbito educativo y no cubre automáticamente el uso clínico tras la conversión. La contratación profesional sigue el circuito comercial existente. No se implementa alternar simultáneamente entre dos espacios independientes educativo/clínico.

Las rutas protegidas consultan el estado vigente de la cuenta y la marca educativa. Las cuentas nuevas con perfil profesional necesitan verificación vigente; una sesión antigua no puede conservar permisos tras un cambio de perfil. Los administradores y las cuentas históricas conservan sus reglas anteriores.

## Activar códigos de WhatsApp

Se reutiliza el WhatsApp oficial de Symphomed. Antes de habilitar los envíos:

1. En WhatsApp Manager de Meta, crear una plantilla de categoría **Autenticación**, con botón **Copiar código**. Por ejemplo, nombre `symphomed_verificacion`, idioma español. Configurar vencimiento visible de diez minutos. Esperar la aprobación real de Meta.
2. Conservar `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` existentes. Agregar al `.env` el nombre y el código de idioma exactos que Meta aprobó:

```dotenv
WHATSAPP_AUTH_TEMPLATE=symphomed_verificacion
WHATSAPP_AUTH_LANGUAGE=es
```

3. Reiniciar con el procedimiento habitual y probar con un número propio autorizado en Meta. El nombre anterior es un ejemplo, no una plantilla ya creada. Si se aprueba en portugués usar el código exacto de Meta, por ejemplo `pt_BR`.

No hace falta otro proveedor ni enviar secretos por chat. La plantilla lleva el mismo código en el cuerpo y en el botón URL de autenticación, como espera la API de Meta para COPY_CODE. No se envía texto libre como alternativa ni se asume abierta la ventana de 24 horas.

Controles: código aleatorio de seis dígitos, HMAC con el secreto del servidor, vencimiento de diez minutos, máximo cinco intentos, consumo de un solo uso, un envío por minuto y cinco cada 24 horas por cuenta. Los contadores y desafíos están en MongoDB y sobreviven a reinicios. Solo se usa el teléfono de la cuenta autenticada o de la solicitud Google confirmada; un destino enviado por el navegador se ignora. No se registran códigos ni se devuelven al cliente. Un fallo de Meta no verifica el teléfono.

La comprobación está en Configuración y en la pantalla de solicitud pendiente. Verificar el teléfono no aprueba la matrícula. Habilita el canal para el circuito existente de recuperación con revisión del operador; no vincula otras cuentas por número ni evita el segundo factor. El teléfono sigue siendo la clave interna: cambiarlo requiere un proceso aparte, no se cambia desde este formulario.

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

Las pruebas de perfiles ejecutan lógica y handlers reales, con persistencia y proveedor simulados. Incluyen carreras/niveles manipulados, roles, sesiones antiguas, revisión concurrente, rechazo de conversión, conservación del plan, controles de OTP, fallo del proveedor y ES/PT. La prueba Google verifica firmas RSA reales. Las pruebas de pantalla utilizan DOM y SDK controlados.

**Pendiente de integración real antes de desplegar:** la instalación de dependencias no pudo completarse en este entorno. `probar_solicitudes_cuenta.js` fue actualizado, pero no pudo ejecutarse por falta de `mongodb-memory-server`. No se probó Google/Meta en vivo ni un navegador real. No confundir las pruebas simuladas con una certificación de producción.

En un entorno de pruebas con dependencias y MongoDB, ejecutar además:

```bash
node scripts/pruebas/probar_solicitudes_cuenta.js
```

Comprobar en móvil: alta educativa y profesional; perfil sin seleccionar; código de carrera equivocada; corrección de solicitud; aprobación y rechazo desde dos pestañas; ingreso antiguo y Google con 2FA; conversión conservando historial y cerrando la sesión anterior; recuperación con teléfono verificado; código incorrecto, repetido, vencido y fallo real de Meta. Confirmar que el plan educativo no cubra consultas profesionales después de convertir.

## Instalación

Hacer respaldo de MongoDB y `.env`. Traer la rama `codex/perfiles-verificados` desde GitHub y revisar diferencias antes de integrarla. El servidor conserva JavaScript ofuscado localmente: guardarlo antes de actualizar; no usar `git reset --hard`, `git clean` ni borrar archivos para resolver conflictos. Con la rama integrada, ejecutar las pruebas, el ofuscador habitual y reiniciar PM2. No se añade ninguna dependencia npm.

El `.env` es del servidor y no debe subirse a Git. No basta reiniciar: la plantilla de autenticación necesita estar aprobada por Meta para que lleguen códigos. Si no se configura, los accesos anteriores continúan y el teléfono permanece sin verificar.
