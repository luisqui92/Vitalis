# Grabar una demo de Symphomed

## Lo primero: nunca con pacientes reales

Una demo con historias clínicas de verdad es una filtración de datos de salud,
y en Brasil (LGPD) además es ilegal. No alcanza con tapar el nombre: la fecha
de nacimiento, el teléfono y el diagnóstico juntos identifican a una persona.

Para eso están los seeds. Crean una cuenta con diez pacientes de mentira, con
historia clínica larga y coherente — varias consultas espaciadas en el tiempo,
medicación activa y pasada, vacunas, signos vitales con tendencia y estudios
que se pueden abrir. Se ve lleno, que es como se ve una cuenta real, y no hay
nadie adentro.

```bash
# En el VM, una sola vez
cd ~/vitalis-app
node scripts/seed_medicina_general_demo.js 78811001
```

Imprime la contraseña generada. Anotala: esa es la cuenta con la que vas a
grabar. Es idempotente, así que se puede volver a correr sin romper nada.

Hay un seed por especialidad —`seed_odontologo_demo.js`,
`seed_oftalmologia_demo.js`, `seed_ginecologia_demo.js`,
`seed_neurodesarrollo_demo.js`, `seed_veterinaria_demo.js`— y
`seed_brasil_demo.js` para grabar la versión en portugués.

Los seeds dejan el **Brief Clínico ya armado**, a propósito: durante la
grabación no hay que esperar una llamada a OpenAI que puede tardar o fallar.

## Preparar la pantalla

- **Perfil de navegador limpio**, sin marcadores ni otras pestañas. Una ventana
  de incógnito alcanza. Lo que se ve en la barra de pestañas se ve en el video.
- **No abras `/report`.** Ese es el modelo financiero: otra audiencia, otro
  video.
- **Zoom del navegador al 110–125 %.** Casi todos van a ver esto en un teléfono.
- **Modo No molestar.** Una notificación de WhatsApp arruina la toma.
- **1920×1080 horizontal.** Un software médico grabado en vertical desde el
  celular parece un video casero, aunque el producto sea bueno.
- Dejá visible `salud.chatgo.ia.bo` en la barra de direcciones: prueba que
  está funcionando de verdad y no es una maqueta.

## Con qué grabar

| Herramienta | Dónde | Por qué |
|---|---|---|
| **OBS Studio** | Windows, Mac, Linux | Gratis, sin marca de agua, sin límite. Lo mejor si vas a grabar varias veces. |
| Barra de juegos (`Win`+`G`) | Windows | Ya está instalada. Cero configuración, graba la ventana activa. |
| `Cmd`+`Shift`+`5` | Mac | Ya está. |
| Loom, ScreenPal | Navegador | Lo más fácil, agrega tu cara en una burbuja. La versión gratis tiene límites. |

El micrófono de los auriculares del celular alcanza. Lo que no alcanza es el
micrófono de la notebook a un metro de distancia.

## El guion de la consulta

Este es el corazón de la demo: sin una consulta con contenido clínico real, la
IA no tiene de dónde sacar una nota buena y todo el video se cae.

Continúa la historia de **María Elena Rojas**, que el seed deja con hipertensión
y dos controles previos (145/92 hace cinco meses, 138/88 hace tres). Que la
consulta nueva *continúe* esa historia es lo que hace que el Brief Clínico
tenga algo que resumir.

Leelo en voz alta, haciendo las dos voces. Son unos 55 segundos.

> **MÉDICA** — Buenos días María Elena, ¿cómo ha estado?
>
> **PACIENTE** — Buenos días doctora. Más o menos. Los últimos diez días me
> está volviendo el dolor de cabeza, sobre todo en las mañanas.
>
> **MÉDICA** — ¿Está tomando el Losartán y la hidroclorotiazida todos los días?
>
> **PACIENTE** — El Losartán sí, pero la otra pastilla la dejé hace como tres
> semanas porque me hacía ir mucho al baño de noche.
>
> **MÉDICA** — Ya veo. ¿Y mareos, visión borrosa, dolor en el pecho?
>
> **PACIENTE** — Mareos un poco cuando me levanto rápido. Del pecho no, nada.
>
> **MÉDICA** — Le tomo la presión… ciento cincuenta sobre noventa y cinco.
> Está alta otra vez. Y subió dos kilos desde el control anterior.
>
> **PACIENTE** — Es que en las fiestas he comido bastante salado, doctora.
>
> **MÉDICA** — Bien. Vamos a retomar la hidroclorotiazida, pero la toma en la
> mañana y no en la noche, así no la despierta. Sigue con el Losartán de
> cincuenta. Dieta baja en sal. Le voy a pedir creatinina y electrolitos, y la
> quiero ver en tres semanas.

Tiene todo lo que la nota necesita: motivo, adherencia al tratamiento,
síntomas, examen físico, diagnóstico, plan, exámenes y próximo control.

## El guion de la grabación

Unos dos minutos y medio. Los tiempos son orientativos.

| Tiempo | Qué se ve | Qué decís |
|---|---|---|
| 0:00–0:15 | Kardex de María Elena, con sus consultas previas | "Esto es lo que un médico tarda diez minutos en escribir después de cada consulta." |
| 0:15–0:25 | Consulta nueva → botón de grabar | "Symphomed lo hace mientras el médico atiende." |
| 0:25–1:20 | La pantalla grabando, mientras leés el guion de arriba | *(nada — que se escuche la consulta)* |
| 1:20–1:30 | Parar. "Transcribiendo…" | "Esto tarda menos de un minuto." |
| 1:30–2:00 | La nota clínica aparecida: motivo, examen, diagnóstico, plan | "Nadie escribió esto. Salió de lo que se habló." |
| 2:00–2:15 | La receta, ya generada | "Y la receta sale firmada." |
| 2:15–2:30 | Vuelta al kardex: medicación actualizada, próximo control | "Todo queda en la historia del paciente." |

**El tiempo muerto de la transcripción**: no lo dejes crudo. Cortalo en la
edición, o aceleralo cuatro veces con un cartel que diga "acelerado". Acelerar
con el cartel puesto es honesto y es lo que hace todo el mundo; simular que fue
instantáneo se nota y te cuesta la credibilidad.

## Errores que arruinan una demo

- **Improvisar la consulta.** Sale corta, sin datos clínicos, y la nota queda
  pobre. El video termina probando lo contrario de lo que querías.
- **Empezar por el login.** A nadie le importa. Arrancá con la pantalla llena.
- **Mostrar todo.** Odontograma, mapa corporal, telemedicina, rayos — cada uno
  merece su propio video de un minuto. Una demo que muestra doce módulos no
  muestra ninguno.
- **Grabar sin guion de cámara.** Se nota en los titubeos y en el mouse dando
  vueltas buscando el botón. Hacé una pasada en seco antes de grabar.
- **Hablar sobre la consulta mientras se graba la consulta.** Se mezcla con el
  audio que Symphomed está transcribiendo y la nota sale con tus comentarios
  adentro.

## Después

Para inversores conviene una segunda versión de treinta segundos, sin
narración, solo el antes y el después: consulta hablada → nota escrita. Esa es
la que se manda por WhatsApp y la que se mira entera.
