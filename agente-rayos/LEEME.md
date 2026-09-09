# Symphomed Rayos — instalación en la PC del consultorio

Este programita hace que las radiografías entren solas a la ficha del
paciente en Symphomed. Se instala **una sola vez**, en la PC donde está el
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

## 2. Instalar (todo desde el navegador de esa misma PC)

Lo más cómodo es hacer esto **sentado en la PC del consultorio**, no en
otra máquina: los dos archivos se descargan ahí mismo.

1. Si esa PC no tiene Node.js, instalalo desde https://nodejs.org
   (la versión LTS, siguiente-siguiente-siguiente, sin cambiar nada).
2. Creá una carpeta nueva, por ejemplo `C:\SymphomedRayos`.
3. Entrá a Symphomed con la cuenta del médico, abrí la ficha de cualquier
   paciente → pestaña **Estudios** → **Conectalo y las placas entran
   solas** (o **Administrar**, si ya hay un equipo).
4. Poné un nombre para la PC y tocá **Conectar una PC**.
5. Pegá la ruta del paso 1 en el campo de la carpeta y bajá los dos
   archivos: **config.json** y **agente.js**. Guardalos en
   `C:\SymphomedRayos`.
6. Abrí una ventana de comandos en esa carpeta (clic derecho dentro de
   ella → *Abrir en Terminal*) y escribí:

```
node agente.js
```

Tiene que decir `✓ conectado a Symphomed`. Dejá esa ventana abierta:
mientras esté abierta, las radiografías suben solas.

> El `config.json` que baja Symphomed ya trae el token y la ruta bien
> escritos. No hace falta editarlo a mano, y conviene no hacerlo: las
> barras de Windows se escriben distinto adentro de un archivo JSON y es
> el error más común.

## 3. Que arranque solo cuando se prende la PC

Copiá también el `iniciar.bat` de esta carpeta a `C:\SymphomedRayos`.
Después apretá `Windows + R`, escribí `shell:startup` y Enter: se abre
una carpeta, arrastrá ahí un acceso directo a `iniciar.bat`.

---

## Cómo se usa, día a día

1. El médico abre la ficha del paciente en Symphomed.
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
| `token inválido` | El token se regeneró o está dado de baja | Generá uno nuevo en Symphomed y bajá otra vez el `config.json` |
| `sin conexión con Symphomed` | La PC se quedó sin internet | Revisá la red; se reconecta solo |
| `en espera` | Nadie tocó "Capturar radiografía" | Abrí la ficha del paciente y tocá el botón |
| No aparece nada al tomar una placa | La carpeta de `config.json` no es la correcta | Repetí el paso 1 y bajá otra vez el `config.json` |

**La primera vez que arranca** marca todo lo que ya había en la carpeta
como historial viejo y **no lo sube** — si no, mandaría años de
radiografías de otros pacientes a la ficha equivocada. Sube solo lo que
llegue de ahí en adelante.

## Formatos

Sube `.jpg`, `.png`, `.webp`, `.gif` y `.pdf`. Si el software del sensor
guarda en `.bmp` o `.tif`, hay que configurarlo para que exporte JPG o
PNG (casi todos lo permiten en sus opciones de guardado). Avisanos si el
tuyo no puede y lo resolvemos del lado de Symphomed.

## Qué sale de la clínica y qué no

- El agente **solo sube**: nunca baja datos de pacientes a esa PC.
- Habla **hacia afuera** por HTTPS. No abre puertos, no necesita IP fija
  y no hace falta tocar el router.
- El token vale **solo** para subir imágenes. Con él no se puede leer
  historias clínicas, ni agenda, ni nada más. Si esa PC se pierde, das de
  baja el equipo desde Symphomed y el token muere en el acto.
