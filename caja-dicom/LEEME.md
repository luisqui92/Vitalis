# Caja Symphomed · puente DICOM

Los equipos de imagen (ecógrafo, tomógrafo, panorámico) hablan DICOM. La Caja
Symphomed es una máquina en la clínica que los escucha, guarda el estudio
original en su propio disco, y le manda a Symphomed solo dos cosas: la metadata
y una vista previa.

**El `.dcm` original no sale de la clínica.** Es todo el punto: subir una
tomografía entera por el enlace de un consultorio es hacer esperar a todo el
mundo, y el médico la necesita ahora.

---

## Qué se instala

Dos cosas, en la misma máquina:

1. **Orthanc** — recibe los estudios de los equipos por C-STORE.
2. **Este agente** — mira lo que va llegando y lo sube a Symphomed.

### Orthanc

La forma más simple es con Docker:

```bash
docker run -d --name orthanc --restart unless-stopped \
  -p 8042:8042 -p 4242:4242 \
  -v /var/lib/orthanc:/var/lib/orthanc/db \
  -e ORTHANC__DICOM_AET=VITALIS_BOX \
  -e ORTHANC__DICOM_SERVER_ENABLED=true \
  orthancteam/orthanc:latest
```

- `4242` es el puerto DICOM: es al que apuntan los equipos.
- `8042` es la interfaz web y la API que usa este agente.
- `-v` es dónde quedan guardados los estudios. **Que apunte a los discos en
  espejo, no al disco del sistema.**

Para producción conviene además el plugin de PostgreSQL: con SQLite el índice
se arrastra cuando pasás las decenas de miles de imágenes.

### El agente

```bash
cp config.ejemplo.json config.json
# editar config.json: vitalisUrl y token
node agente.js
```

El **token** se saca de Symphomed: ficha de cualquier paciente → pestaña
Estudios → *Administrar* → dar de alta un equipo. Se muestra **una sola vez**.

Para que arranque solo con la máquina, en Linux con systemd:

```ini
[Unit]
Description=Caja Symphomed - puente DICOM
After=network-online.target docker.service

[Service]
ExecStart=/usr/bin/node /opt/caja-dicom/agente.js
WorkingDirectory=/opt/caja-dicom
Restart=always
RestartSec=10
User=vitalis

[Install]
WantedBy=multi-user.target
```

---

## Configurar los equipos

Al técnico del proveedor del equipo hay que darle tres datos:

| | |
|---|---|
| **AE Title** | `VITALIS_BOX` |
| **IP** | la de la caja en la red de la clínica (fija) |
| **Puerto** | `4242` |

Conviene tenerlos grabados en la cara trasera de la caja.

---

## Lo que hace que un estudio se archive solo

Cuando llega una imagen, Symphomed decide de quién es en este orden:

1. **El técnico tipeó el código del paciente** (`P-0147`) en el campo
   *Patient ID* del equipo → se archiva solo, sin que nadie toque nada. Es el
   camino bueno y para eso existe el código.
2. **Hay una ventana de captura abierta** — el médico entró a la ficha y tocó
   *Capturar radiografía*. Es el flujo del consultorio con un sillón.
3. **Nadie sabe** → va a la bandeja de entrada, con el nombre que el técnico
   escribió, y el médico lo asigna desde Symphomed.

**Que la bandeja esté vacía es el caso bueno**, no el raro.

---

## Detalles que importan

**La misma imagen no puede entrar dos veces.** Cada imagen DICOM trae un
identificador único en el mundo (`SOPInstanceUID`). Si el equipo reintenta, o
alguien reenvía un estudio viejo, la segunda copia se descarta sola.

**Los milímetros salen del archivo.** El DICOM dice cuánto mide un píxel, así
que el médico mide sin calibrar nada. Y queda anotado de dónde salió esa
escala: no es lo mismo un milímetro leído del equipo que uno marcado a ojo.

**La vista previa se achica si hace falta**, y se anota cuánto. Sin eso, una
medición sobre una panorámica reducida saldría corta en silencio — que es la
peor forma de estar mal.

**Si algo falla, no se pierde nada.** Lo que no se pudo subir se reintenta en
la vuelta siguiente. Lo que ya subió queda anotado en `subidos.json`; si se
borra ese archivo, se reenvía todo y Symphomed lo descarta por duplicado.

---

## Comandos útiles

```bash
node agente.js --una-vuelta     # revisa una vez y sale
curl http://127.0.0.1:8042/instances   # qué tiene Orthanc guardado
```

Si el agente no arranca, dice por qué: casi siempre es que Orthanc no está
levantado, o que el token está mal copiado.
