# Registro directo de estudiantes desde redes sociales

## Lo que verá la persona

Enlace para difundir **después de instalar y comprobar el cambio**:

`https://app.symphomed.com/?registro=estudiante`

1. Abre la página y continúa con Google.
2. Elige Estudiante y completa nombre, teléfono, carrera, nivel, universidad y año/semestre.
3. Entra inmediatamente al espacio educativo, sin invitación ni aprobación manual.
4. Tiene **3 días desde el alta y 15 minutos de audio en total**, además de hasta 3 pacientes virtuales y 3 simulacros durante ese período. No requiere tarjeta ni produce cobros automáticos.
5. El inicio muestra el cupo y el botón **Ver planes y continuar**. Al vencer, puede ingresar y consultar lo guardado. La transcripción requiere activar un plan.

Durante la prueba, se transcribe al terminar la grabación: no hay vista previa en vivo. El servidor envía a AssemblyAI `audio_end_at` con el cupo restante. Si el archivo supera ese cupo, se procesa solamente ese tramo. La pantalla lo explica antes de grabar. Las pruebas de integración deben confirmar el comportamiento real del proveedor antes de ofrecer la promoción.

La carrera/nivel son declarados; no se presentan como verificación documental de estudiante. Elegir residente no habilita permisos clínicos. Medicina admite estudiante, interno y residente; Enfermería y Odontología admiten estudiante e interno. Se mantienen las restricciones educativas y las reglas profesionales actuales.

Dentro del navegador integrado de TikTok/Instagram puede ser necesario abrir el enlace en Chrome o Safari para usar Google; la pantalla lo indica.

## Continuar con un plan sin SSH

Los precios educativos por defecto son **Bs 100/mes para estudiante e interno y Bs 150/mes para residente**. Horas mensuales: 3, 6 y 12 respectivamente. El anual conserva 12 meses al precio de 11. Los precios BRL conservan los valores educativos existentes (29/49/99 por mes); confirmar la oferta comercial brasileña antes de anunciarla.

La pantalla educativa toma el QR, banco, cuenta, titular y WhatsApp de la configuración de pagos existente por país. No muestra precios de planes profesionales. Si no hay datos de pago, avisa que faltan; no inventa un checkout.

El alumno paga y envía el comprobante por el WhatsApp configurado. El operador verifica el pago y desde **Pagos → buscar la cuenta → plan mensual/anual**, introduce la referencia y activa el plan. Se actualizan también el vencimiento y las horas del acceso educativo, sin invitación ni comandos SSH. Una referencia repetida para la misma cuenta no renueva dos veces. Los controles de operador y segundo factor son los existentes.

**El registro es automático; la confirmación del pago sigue siendo manual.** No se integra una nueva pasarela ni se confirma un pago por un simple clic del alumno. El precio es el del catálogo del servidor; el operador debe cotejarlo con el importe recibido.

Para cambiar precios por entorno: `PLAN_EDUCATIVO_ESTUDIANTE_BOB=10000`, `PLAN_EDUCATIVO_INTERNO_BOB=10000`, `PLAN_EDUCATIVO_RESIDENTE_BOB=15000` (centavos); también se admite sufijo `BRL`. No es necesario generar códigos para cada nuevo cliente.

## Controles y compatibilidad

- Solo una identidad validada por el flujo Google puede abrir la prueba sin código. Se mantienen la cookie/nonce, tickets limitados, validación de correo y restricciones de vinculación existentes.
- La colección `PruebaEstudiante` conserva la identidad Google y teléfono que ya recibieron prueba. Su índice único se espera antes de aceptar registros. Volver a iniciar sesión o cambiar de mes no renueva el cupo. No equivale a impedir que alguien cree varias identidades y use diferentes teléfonos.
- Duración, cuotas, precio y permisos se fijan en el servidor; se ignoran valores manipulados del formulario.
- Cada audio reserva atómicamente el cupo restante; un segundo envío concurrente no puede gastarlo otra vez. Al terminar se descuenta la duración informada por el proveedor y se libera lo no usado. La conciliación es idempotente y recupera finalizaciones ya guardadas tras reinicio.
- Si falla el guardado local inicial se libera la reserva. Si el proveedor falla o el proceso se interrumpe antes de confirmar una transcripción, el cupo queda reservado para el reintento del mismo caso; no se regalan minutos por un fallo incierto. Una reserva sin consulta tras caída entre escrituras requiere revisión técnica. Los reintentos del proveedor pueden tener costo adicional.
- Las invitaciones ya emitidas continúan funcionando como alternativa dentro de un apartado opcional. Las cuentas existentes conservan datos y acceso.
- El módulo usa puntos de extensión del núcleo para cuotas y planes. Los controles siguen montados aunque se apague el módulo.
- `REGISTRO_ESTUDIANTE_ABIERTO=apagado` deshabilita nuevas pruebas tras reiniciar; los códigos existentes siguen disponibles. Apagar el módulo completo también retira el registro.
- Teléfono nuevo: contacto sin verificar; no habilita recuperación automática. Los avisos de revisión profesional por correo permanecen como antes.

## Validación y despliegue

Ejecutado sin proveedores reales:

```bash
node scripts/pruebas/todas.js google perfiles_acceso registro_abierto odontologia globales_unicos --estricto
```

La prueba nueva cubre alta, roles manipulados, duplicados concurrentes, rollback, reservas y devolución de minutos, reinicio, expiración, cambio de mes, activación del plan, pagos duplicados, parámetro de recorte de AssemblyAI y pantalla sin invitación. MongoDB/HTTP/proveedores/DOM están simulados. Se verifica también la sintaxis de los archivos modificados.

La instalación de dependencias quedó bloqueada por permisos de red y la solicitud de permiso se canceló. No se ejecutó integración real con MongoDB, Google, AssemblyAI ni navegador móvil. La comprobación arquitectónica `probar_modulo_estudiantes.js` detecta referencias a la marca educativa en el núcleo (varias anteriores a esta entrega) y después se interrumpe por faltar `dotenv`; **no se declara aprobada**. Los imports del núcleo hacia `modulos/*` siguen ausentes salvo el montaje en `index.js`.

Antes de anunciar el enlace: respaldar MongoDB y `.env`; integrar la rama sin borrar cambios locales/ofuscados; instalar dependencias del lockfile; ejecutar las pruebas de integración pertinentes; ofuscar con el procedimiento habitual; reiniciar PM2. Verificar con cuentas propias un alta por carrera, una identidad repetida, un audio corto y otro mayor que el cupo, expiración, conservación de casos, pago manual y activación del plan. Comprobar el acceso desde TikTok/Instagram y Chrome/Safari. No desplegar suponiendo que los mocks acreditan estas integraciones.
