# Vitalis Rayos — instalación en la PC del consultorio

Este programita hace que las radiografías entren solas a la ficha del
paciente en Vitalis. Se instala **una sola vez**, en la PC donde está el
software del sensor (Ai-Dental, DBSWIN, VixWin, CS Imaging, etc.).

El equipo de rayos en sí (por ejemplo un Woodpecker Mini Ray) no se toca:
ese aparato solo dispara la radiación, no manda datos. Quien tiene la
imagen es el software del sensor, y de ahí la saca este agente.

---

## 1. Averiguar en qué carpeta guarda las imágenes el software del sensor

En Ai-Dental está en el botón de engranaje (abajo a la derecha de la
ventana), donde dice la ruta de almacenamiento. Si no aparece, hay una
forma infalible:

1. Tomá una radiografía de prueba.
2. Abrí el Explorador de Windows, entrá a `C:\` y buscá `*.jpg`.
3. Ordená por *Fecha de modificación*, de más nueva a más vieja.
4. La primera es tu radiografía: la carpeta donde está es la que va en
   `config.json`.

Anotá esa ruta completa.

## 2. Sacar el token en Vitalis

En Vitalis (desde cualquier navegador, con la cuenta del médico):
**Ajustes → Equipo de rayos → Agregar equipo**.

Te muestra un token una sola vez. Copialo ahora — después no se puede
volver a ver, solo generar uno nuevo.

## 3. Instalar

1. Copiá esta carpeta `agente-rayos` a la PC, por ejemplo en
   `C:\VitalisRayos`.
2. Si esa PC no tiene Node.js, instalalo desde https://nodejs.org
   (la versión LTS, siguiente-siguiente-siguiente, sin cambiar nada).
3. Copiá `config.ejemplo.json` y renombralo a `config.json`.
4. Abrí `config.json` con el Bloc de notas y completá:

```json
{
  "servidor": "https://salud.chatgo.ia.bo",
  "token": "vrx_...................",
  "carpeta": "C:\\Ai-Dental\\Images",
  "incluirSubcarpetas": true
}
```

> Ojo con las barras: en Windows van **dobles** (`C:\\Ai-Dental\\Images`),
> no simples.

5. Doble clic en `iniciar.bat`.

Tiene que aparecer una ventana negra que diga `✓ conectado a Vitalis`.
Dejala abierta: mientras esté abierta, las radiografías suben solas.

## 4. Que arranque solo cuando se prende la PC

Apretá `Windows + R`, escribí `shell:startup` y Enter. Se abre una
carpeta: arrastrá ahí un acceso directo a `iniciar.bat`.

---

## Cómo se usa, día a día

1. El médico abre la ficha del paciente en Vitalis.
2. Pestaña **Estudios** → botón **📸 Capturar radiografía**.
3. Toma la placa como siempre, con el software de siempre.
4. La imagen aparece sola en la ficha, en unos segundos.

Si se olvidó de tocar el botón antes de disparar, no se pierde nada: el
agente guarda la imagen y la sube en cuanto abra la ficha, hasta 20
minutos después.

---

## Si algo no anda

| Lo que dice la ventana | Qué pasa | Qué hacer |
|---|---|---|
| `token inválido` | El token se regeneró o está mal copiado | Generá uno nuevo en Vitalis y pegalo en `config.json` |
| `sin conexión con Vitalis` | La PC se quedó sin internet | Revisá la red; se reconecta solo |
| `en espera` | Nadie tocó "Capturar radiografía" | Abrí la ficha del paciente y tocá el botón |
| No aparece nada al tomar una placa | La carpeta de `config.json` no es la correcta | Repetí el paso 1 |

**La primera vez que arranca** marca todo lo que ya había en la carpeta
como historial viejo y **no lo sube** — si no, mandaría años de
radiografías de otros pacientes a la ficha equivocada. Sube solo lo que
llegue de ahí en adelante.

## Formatos

Sube `.jpg`, `.png`, `.webp`, `.gif` y `.pdf`. Si el software del sensor
guarda en `.bmp` o `.tif`, hay que configurarlo para que exporte JPG o
PNG (casi todos lo permiten en sus opciones de guardado). Avisanos si el
tuyo no puede y lo resolvemos del lado de Vitalis.

## Qué sale de la clínica y qué no

- El agente **solo sube**: nunca baja datos de pacientes a esa PC.
- Habla **hacia afuera** por HTTPS. No abre puertos, no necesita IP fija
  y no hace falta tocar el router.
- El token vale **solo** para subir imágenes. Con él no se puede leer
  historias clínicas, ni agenda, ni nada más. Si esa PC se pierde, das de
  baja el equipo desde Vitalis y el token muere en el acto.
