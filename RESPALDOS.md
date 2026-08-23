# Copias de seguridad de Vitalis

Vitalis hace una copia por día, sola, y **la verifica restaurándola de
verdad** en una base aparte antes de darla por buena. Una copia que nunca se
restauró no es una copia.

Qué se respalda:

- Toda la base de datos (pacientes, consultas, odontogramas, perfiles,
  objetivos, agenda — todo).
- Los archivos de `uploads/` (radiografías, laboratorios, fotos clínicas).

---

## 1. Configurar la clave de cifrado

Sin esto los respaldos se guardan **sin cifrar**. Funcionan igual, pero no se
pueden mandar fuera del servidor.

Generá una clave larga:

```
openssl rand -base64 48
```

Y agregala al `.env`:

```
BACKUP_CLAVE=lo-que-salió-del-comando-de-arriba
```

> **Guardá esa clave en otro lado además del servidor.** Si se pierde el
> servidor y la clave estaba solo ahí, los respaldos no se pueden abrir.
> Ponela en un gestor de contraseñas, no en un WhatsApp.

Reiniciá:

```
pm2 restart vitalis --update-env
```

## 2. Mandar los respaldos fuera del servidor

**Un respaldo en el mismo disco que la base no es un respaldo.** Protege de un
borrado por error, no de que el disco se muera, que es el caso que uno
realmente teme.

Vitalis no se ata a ningún proveedor: ejecuta el comando que le pongas.

Con [rclone](https://rclone.org) (funciona con Backblaze B2, Cloudflare R2,
Google Drive, S3, lo que sea):

```
curl https://rclone.org/install.sh | sudo bash
rclone config          # seguí el asistente, ponele de nombre "respaldos"
```

Y en el `.env`:

```
BACKUP_COMANDO_SUBIDA=rclone copy {archivo} respaldos:vitalis-respaldos/
```

`{archivo}` lo reemplaza Vitalis por la ruta de cada archivo.

Si el respaldo **no está cifrado, Vitalis se niega a subirlo** aunque esto
esté configurado. Son datos de pacientes.

## 3. Comprobar que anda

En Vitalis: **Panel → Seguridad**. Ahí abajo está el estado: cuándo fue la
última, si pasó la verificación, cuánto ocupa, y si se está mandando afuera.
Se pone en rojo sola si pasan más de 48 horas o si una falla.

También hay un botón para hacer una a mano y verlo funcionar.

---

## Si algún día hay que restaurar

**Respirá. No hagas nada apurado.** El orden importa.

### Paso 1 — ver qué hay

```
cd /home/rastreoplus/vitalis-app
node scripts/restaurar.js
```

Lista los respaldos, del más nuevo al más viejo. El ✅ quiere decir que ese
respaldo pasó la verificación el día que se hizo.

### Paso 2 — mirar adentro sin tocar nada

```
node scripts/restaurar.js <ruta-del-respaldo> --revisar
```

Muestra cuántos pacientes, consultas y demás tiene. Sirve para elegir bien
cuál usar.

### Paso 3 — restaurarlo en una base de prueba

```
node scripts/restaurar.js <ruta-del-respaldo> --a-prueba
```

**Esto no toca la base real.** Restaura en una base aparte llamada
`<nombre>__restaurado` para que puedas mirarla y confirmar que es la que
querías antes de decidir nada.

### Paso 4 — recién ahora, reemplazar la base real

```
node scripts/restaurar.js <ruta-del-respaldo> --encima
```

Pide escribir `RESTAURAR` a mano. **Borra todo lo que haya ahora** y lo
reemplaza: lo que se cargó después de ese respaldo se pierde.

Antes de correrlo, si el servidor todavía funciona, hacé una copia de lo que
hay ahora desde Panel → Seguridad. Por si la elección fue equivocada.

### Paso 5 — los archivos de estudios

La base y los archivos son dos cosas separadas. Si también se perdieron las
radiografías:

```
node -e 'const b=require("./services/backup"),fs=require("fs");fs.writeFileSync("/tmp/arch.tar.gz",b.descifrar(fs.readFileSync(process.argv[1])))' <respaldo>-archivos.tar.gz
tar -xzf /tmp/arch.tar.gz -C /home/rastreoplus/vitalis-app
rm /tmp/arch.tar.gz
```

### Paso 6

```
pm2 restart vitalis
```

Y entrá a comprobar que los pacientes están.

---

## Ajustes

Todos opcionales, en el `.env`:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `BACKUP_CLAVE` | *(vacío)* | Clave de cifrado. Sin ella no se cifra ni se sube afuera. |
| `BACKUP_COMANDO_SUBIDA` | *(vacío)* | Comando para mandar la copia afuera. |
| `BACKUP_HORAS` | `24` | Cada cuántas horas se hace una. |
| `BACKUP_DIAS` | `7` | Se conservan todas las de los últimos N días. |
| `BACKUP_SEMANAS` | `8` | Y una por semana hacia atrás, N semanas. |
| `BACKUP_DIR` | `./backups` | Dónde se guardan. |

El respaldo más viejo nunca se borra solo: si algo salió mal hace mucho, esa
es la última red.

---

## Lo que esto todavía no cubre

Para que quede dicho y no se descubra el día equivocado:

- **La copia afuera hay que configurarla.** Mientras no lo esté, todo vive en
  el mismo disco.
- **Nadie prueba una restauración completa periódicamente.** Vitalis verifica
  cada respaldo, pero probar el procedimiento entero —incluidos los archivos y
  el reinicio— conviene hacerlo a mano una vez cada tanto. Media hora, dos
  veces al año.
- **Si se pierde `BACKUP_CLAVE`, los respaldos cifrados no se abren.** No hay
  puerta trasera, a propósito.
