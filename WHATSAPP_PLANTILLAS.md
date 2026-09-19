# Las plantillas de WhatsApp

## Por qué hacen falta

Meta deja mandar texto libre **solo dentro de las 24 h** desde el último
mensaje del paciente. Fuera de esa ventana, únicamente plantillas aprobadas
de antemano.

De los nueve lugares donde Symphomed manda algo por WhatsApp, el único que
siempre cae adentro es la respuesta del bot de reservas — ahí el paciente
acaba de escribir. Los otros ocho los inicia la plataforma, y la persona
puede no haber escrito nunca:

| Qué manda | Dónde | Cae fuera de la ventana |
|---|---|---|
| Respuestas del bot de reservas | `routes/whatsappSalud.js` | nunca |
| Confirmación de cita (la carga el médico) | `routes/citas.js` | casi siempre |
| Confirmación de cita (reserva desde la web) | `routes/reservaPublica.js` | casi siempre |
| Aviso de reconsulta | `routes/consultaMedica.js` | casi siempre |
| Informe al paciente | `routes/informes.js` | a menudo |
| Informe de avance a la familia | `routes/informeFamilia.js` | **casi siempre** |
| Cuenta profesional aprobada | `routes/solicitudesCuenta.js` | **casi siempre** |
| La llave a la historia propia | `routes/resumenCompartido.js` | **casi siempre** |
| Enlace para resetear la contraseña | `routes/reseteoClave.js` | **casi siempre** |

La de avance a la familia es la que más va a depender de la plantilla: la familia de un chico
en seguimiento de neurodesarrollo no le escribe al consultorio entre sesión y
sesión, así que la ventana de 24 h prácticamente nunca está abierta.

El código intenta **primero el texto libre** y solo cae a la plantilla cuando
Meta lo rechaza con el código `131047`. Así el paciente que está conversando
recibe el mensaje natural y completo, y la plantilla queda de red.

## Cómo cargarlas

`business.facebook.com` → WhatsApp Manager → **Message templates** → Create.

Para todas: categoría **Utility** (no Marketing — Marketing se cobra más
caro y se aprueba peor), idioma **Spanish** (`es`).

> **El acoplamiento frágil de todo esto:** el orden de los `{{1}}, {{2}}…`
> tiene que coincidir exacto con el orden de `parametros` en el código.
> Vive mitad acá y mitad en un panel web al que el código no le puede
> preguntar nada. `scripts/pruebas/probar_plantillas.js` compara este
> archivo contra el código y se pone rojo si se desincronizan.

---

### 1. `cita_confirmada`

Cuerpo:

```
Hola {{1}}, su cita con {{2}} quedó confirmada para el {{3}}.

Si necesita cancelarla, responda "cancelar" a este mensaje.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre del paciente | `María` |
| `{{2}}` | nombre del médico o del consultorio | `Dra. Camacho` |
| `{{3}}` | fecha y hora de la cita | `lunes 15 de septiembre a las 10:30` |

---

### 2. `reconsulta_sugerida`

Cuerpo:

```
Hola {{1}}, {{2}} le sugiere su próxima consulta para el {{3}}.

Elija el horario que le quede mejor acá: {{4}}

El enlace vence en 45 minutos.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre del paciente | `María` |
| `{{2}}` | nombre del médico | `Dra. Camacho` |
| `{{3}}` | fecha sugerida | `lunes 15 de septiembre` |
| `{{4}}` | enlace de reserva | `https://app.symphomed.com/reservar.html?token=abc123` |

Los 45 minutos van **escritos en la plantilla**, no como variable: es el
vencimiento del token que arma `routes/consultaMedica.js` y no cambia.

---

### 3. `informe_listo`

Cuerpo:

```
Hola {{1}}, su informe ya está disponible.

{{2}}

Puede verlo acá: {{3}}

El enlace vence en 90 días.
```

Los 90 días van escritos y no como variable: es `DIAS_VALIDEZ_ENLACE` en
`routes/informes.js` y no cambia por paciente. Si algún día cambia, hay que
pedir aprobación de la plantilla de nuevo — por eso está el número acá, para
que se encuentre.

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre del paciente | `María` |
| `{{2}}` | estudio y fecha | `Radiografía de tórax — 14/03/2026` |
| `{{3}}` | enlace al informe | `https://app.symphomed.com/informe/abc123` |

Nada clínico más allá del nombre del estudio: la vista previa de WhatsApp
aparece en la pantalla bloqueada de un teléfono que a veces es compartido.
El detalle vive detrás del enlace.

---

### 4. `avance_familia`

Cuerpo:

```
Hola. Le compartimos el informe de avance de {{1}}, de parte de {{2}}.

Es un resumen de cómo le fue en estas semanas. No hace falta contraseña ni instalar nada: toque el enlace y se abre.

{{3}}

Si algo no se entiende, escríbanos por acá.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre del chico o la chica | `Leo` |
| `{{2}}` | centro o profesional que lo manda | `Centro Aprender` |
| `{{3}}` | enlace al informe | `https://app.symphomed.com/avance/abc123` |

**Acá el cuidado con la vista previa importa más que en las otras tres.** El
mensaje no nombra ninguna condición, ni ningún objetivo, ni la palabra
"terapia": la notificación de WhatsApp se ve en la pantalla bloqueada de un
teléfono que en muchas casas es compartido, y una condición del
neurodesarrollo no se anuncia ahí. Todo el contenido vive detrás del enlace.

El vencimiento del enlace (un año, `DIAS_VALIDEZ_ENLACE` en
`routes/informeFamilia.js`) **no** va escrito en la plantilla, al revés que en
`informe_listo`. Es a propósito: este informe la familia lo vuelve a abrir —se
lo muestra a la escuela, al pediatra— y una fecha de vencimiento en el mensaje
invita a archivarlo antes de tiempo.

---

### 5. `historia_propia`

Cuerpo:

```
Hola {{1}}. Este es el enlace a tu historia clínica.

Desde ahí podés verla y, si vas a otro médico, generar un enlace para mostrársela. No hace falta contraseña.

{{2}}

Guardá este mensaje y no lo reenvíes: quien lo tenga puede abrir tu historia.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre del paciente | `Carla` |
| `{{2}}` | enlace a la llave | `https://app.symphomed.com/mi/abc123` |

Esta es la **llave**, no un enlace para compartir: quien la tenga puede abrir
la historia y además generar enlaces nuevos. Por eso la última línea del
cuerpo es una advertencia y no una cortesía, y por eso está adentro de la
plantilla —donde Meta la congela— en vez de quedar solo en la página.

No nombra ninguna especialidad ni ningún diagnóstico, por lo mismo que
`avance_familia`: la notificación se ve en la pantalla bloqueada.

El nombre de la plantilla dice `historia_propia` y no `llave_paciente` porque
es lo que se le muestra a Meta al pedir la aprobación, y "llave" en un mensaje
sobre datos de salud se lee como un aviso de seguridad — que es otra categoría
y se revisa distinto.

Si se emite una llave nueva, la anterior queda revocada en el mismo acto
(índice único parcial en `LlavePaciente`): un paciente tiene una sola llave
viva, siempre.

---

### 6. `cuenta_habilitada`

Cuerpo:

```
Hola {{1}}. Tu solicitud de cuenta en Symphomed fue aprobada. Ya puedes ingresar desde {{2}} con el teléfono que registraste.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | nombre del profesional | `Dra. María Pérez` |
| `{{2}}` | dirección de ingreso | `https://app.symphomed.com` |

No incluye contraseña ni matrícula. La contraseña solo la conoce la persona
que se registró y nunca debe viajar por WhatsApp.

La versión `pt_BR` fue rechazada por Meta para esta cuenta de WhatsApp.
Cuando el profesional usa portugués se intenta primero texto libre en ese
idioma; fuera de la ventana de 24 horas se usa esta plantilla española para
que el aviso no se pierda.

---

### 7. `reseteo_clave`

Cuerpo:

```
Hola {{1}}. Pediste restablecer tu contraseña de Symphomed.

Entrá acá para elegir una nueva. El enlace vale por 2 horas y sirve una sola vez:

{{2}}

Si no fuiste vos, ignorá este mensaje: tu contraseña actual sigue funcionando.
```

| Variable | Es | Ejemplo para Meta |
|---|---|---|
| `{{1}}` | primer nombre de la persona | `Carla` |
| `{{2}}` | enlace para elegir la contraseña nueva | `https://app.symphomed.com/restablecer/abc123` |

Esta plantilla **no tiene el atajo `idioma: "es"` fijo** que tiene
`cuenta_habilitada`: el código manda el idioma real de la cuenta
(`routes/reseteoClave.js`), porque `services/metaWhatsapp.js` ya traduce `pt`
al código de Meta (`pt_BR`) desde adentro de `enviarPlantilla()` — ver la
sección «Portugués» más abajo. El atajo de `cuenta_habilitada` es una cicatriz
de un rechazo puntual de ESA plantilla, no una regla general.

Por eso, además de la versión española de arriba —la que hay que cargar
primero, para que el reseteo funcione desde el día uno—, conviene cargar
también esta en portugués (`pt_BR`), apenas haya tiempo:

```
Olá {{1}}. Você pediu para redefinir sua senha da Symphomed.

Entre aqui para escolher uma nova. O link vale por 2 horas e serve uma única vez:

{{2}}

Se não foi você, ignore esta mensagem: sua senha atual continua funcionando.
```

Mismas dos variables, mismo orden. Sin ella cargada, un socio o médico en
portugués que pida el reseteo fuera de la ventana de 24 h se queda sin
enlace — el código intenta el texto libre en su idioma primero, así que
dentro de la ventana funciona igual; el hueco es solo fuera de ella.

Las dos horas de vencimiento van escritas en el cuerpo y **no** como variable,
mismo criterio que `informe_listo`: es `HORAS_VALIDEZ` en
`routes/reseteoClave.js` y no cambia por persona. Si el número cambia, hay que
pedir aprobación de nuevo — por eso está anotado acá.

**Es la plantilla más sensible de las siete.** El enlace da acceso completo a
la cuenta, así que el cuerpo tiene dos frases que no son decorativas: que
sirve *una sola vez* (para que quien la lea no la reenvíe pensando que puede
volver a usarla) y que ignorarla no hace nada si el pedido no fue de la
persona (para que un intento ajeno no la asuste ni la empuje a hacer algo).

---

## Reglas de Meta que hacen que te la rechacen

- El cuerpo **no puede empezar ni terminar con una variable**. Por eso las
  tres arrancan con "Hola" y ninguna termina en `{{n}}`.
- **No puede haber dos variables pegadas** (`{{1}} {{2}}` sin texto en medio).
- Las variables van **numeradas desde `{{1}}`, sin saltos**.
- Al crearla, Meta pide un **ejemplo para cada variable**. Poné los de las
  tablas de arriba: si no son verosímiles, la rechaza.
- Aprobación: de minutos a un día. Si la rechaza, en WhatsApp Manager dice
  por qué.

## Portugués

**No son dos plantillas: es una plantilla con dos idiomas.** El nombre es el
mismo (`cuenta_habilitada`, no `cuenta_habilitada_pt`) y en Meta se le agrega
la versión en portugués. El código manda `name` y `language.code` por separado,
así que con nombres distintos no hay forma de elegir.

**El idioma nuestro no es el código de Meta.** Symphomed guarda `es` o `pt`
(`Medico.idioma`). Meta no tiene un idioma `pt`: tiene `pt_BR` y `pt_PT`. Un
código que no está en su lista devuelve `132001` —"la plantilla no existe en
ese idioma"— **aunque la plantilla esté aprobada y perfecta**.

Por eso `services/metaWhatsapp.js` traduce `pt → pt_BR` adentro de
`enviarPlantilla()`, que es el único lugar por el que pasan todas las rutas: una
ruta nueva queda cubierta sin que nadie se acuerde. Un código que ya viene con
región (`pt_BR`, `es_MX`) se respeta tal cual.

Entonces, al cargarlas en Meta: **idioma Portuguese (BR)**, que es lo que el
código pide. Si se carga como `pt_PT` no se va a usar nunca.

### Al crear cada plantilla en el panel

**«Tipo de variable» decide el estilo, y las dos plantillas del mismo nombre
tienen que usar el mismo.** Meta tiene dos:

| En el panel | En el cuerpo | Qué manda el código |
|---|---|---|
| «Número» | `{{1}}`, `{{2}}` | `parametros` como **arreglo**: `[nombre, enlace]` |
| «Nombre» | `{{nome}}`, `{{link}}` | `parametros` como **objeto**: `{ nome, link }` |

`enviarPlantilla()` soporta las dos y elige por la forma de `parametros`: un
arreglo sale posicional, un objeto sale con `parameter_name`. No hay una
bandera aparte que haya que acordarse de poner — el dato ya está en lo que la
ruta escribe, así que una ruta no puede decir una cosa y mandar otra.

Las seis que hay hoy están aprobadas **posicionales**, y ese es el estilo por
defecto. Pero el editor de Meta abre en «Nombre» en las cuentas nuevas, así que
si el desplegable no se deja cambiar, se puede aprobar con nombres y pasar el
objeto en la ruta. Lo que **no** se puede es mezclar: aprobada con nombres y
mandando un arreglo, falla con la plantilla aprobada y correcta, que es la peor
forma de fallar porque no hay nada que revisar.

Si el panel rechaza `{{1}}` con «Los parámetros variables deben ser caracteres
en minúscula…», el desplegable está en «Nombre». Está arriba de «Muestra de
contenido multimedia», lejos del cuadro de texto — es fácil no verlo. Y después
de cambiarlo conviene borrar las variables del texto y volver a insertarlas con
«+ Añadir variable»: el editor las lleva como objetos internos y no siempre
revalida las escritas a mano.

### Cuando se apruebe una versión en portugués

Hay un lugar que la ignora a propósito y hay que tocarlo a mano:
`routes/solicitudesCuenta.js` manda `idioma: "es"` **fijo**, porque Meta había
rechazado la `pt_BR` de `cuenta_habilitada`. Si se aprueba, ese `"es"` tiene
que pasar a ser el idioma del médico — si no, la plantilla portuguesa queda
aprobada y sin usarse nunca, que no da ningún error y no lo nota nadie.

El resto de las rutas ya pasan `medico.idioma` y no hay que tocarlas.

## Cómo saber si están andando

```bash
node scripts/revisar_whatsapp.js
```

Y en el log, cuando una salga por plantilla:

```
[WHATSAPP] Fuera de la ventana de 24 h con 5917xxxxxxx — se manda la plantilla «cita_confirmada»
```

Si en cambio aparece `132000` o `132001`, la plantilla no existe con ese
nombre o los parámetros no coinciden con los aprobados.
