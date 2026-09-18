# Copias de seguridad de Symphomed

Symphomed hace una copia por día, sola, y **la verifica restaurándola de
verdad** en una base aparte antes de darla por buena. Una copia que nunca se
restauró no es una copia.

Qué se respalda:

- Toda la base de datos (pacientes, consultas, odontogramas, perfiles,
  objetivos, agenda — todo).
- Los archivos de `uploads/` (radiografías, laboratorios, fotos clínicas).

---

## 1. Configurar la clave de cifrado

En producción esta clave es obligatoria. Symphomed usa AES-256-GCM: cifra el
contenido y también detecta alteraciones o corrupción. La clave debe tener al
menos 32 bytes.

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

## 2. Mandar y verificar los respaldos fuera del servidor

**Un respaldo en el mismo disco que la base no es un respaldo.** El destino
recomendado para la VM de Google Cloud es un bucket de Cloud Storage dedicado,
preferentemente en otro proyecto con facturación y administradores separados.

El bucket debe tener:

- acceso uniforme, sin objetos públicos;
- cuenta de servicio con permiso únicamente para crear y leer objetos;
- retención de 90 días;
- eliminación automática después del plazo operativo acordado;
- bloqueo de la política de retención después de probarla. El bloqueo es
  irreversible, por eso no se activa hasta completar una subida y restauración.

Instalá [rclone](https://rclone.org) y configurá un remoto llamado
`respaldos`. En una VM de Google Cloud se puede usar la identidad de su
cuenta de servicio, sin guardar una llave JSON.

```bash
curl https://rclone.org/install.sh | sudo bash
rclone config
```

La subida usa un nombre exacto e inmutable. Después, `rclone check --download`
lee el objeto remoto y compara su contenido con el archivo local:

```dotenv
BACKUP_COMANDO_SUBIDA=rclone copyto --immutable --checksum {archivo} respaldos:symphomed/{nombre}
BACKUP_COMANDO_VERIFICAR=rclone check {archivo} respaldos:symphomed/{nombre} --one-way --download
```

Los marcadores disponibles son `{archivo}`, `{nombre}` y `{marca}`.
Symphomed ejecuta el binario directamente, sin un shell.

Cuando la clave y ambos comandos estén probados, activar el modo cerrado:

```dotenv
BACKUP_EXIGIR_SEGURO=1
```

Con esa bandera Symphomed no arranca si falta cifrado, subida o verificación.
Además, no sube nada que no esté cifrado o que no haya pasado primero la
restauración local.

## 3. Comprobar que anda

En Symphomed: **Panel → Seguridad**. Ahí abajo está el estado: cuándo fue la
última, si pasó la verificación, cuánto ocupa, y si se está mandando afuera.
Se pone en rojo sola si pasan más de 48 horas o si una falla.

También hay un botón para hacer una a mano y verlo funcionar. Solo aparece
para un operador autorizado en `OPERADORES_SALDO` con 2FA activo; las demás
cuentas ven el estado, pero no pueden provocar un volcado completo.

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
| `BACKUP_CLAVE` | *(vacío)* | Clave de cifrado de al menos 32 bytes. |
| `BACKUP_COMANDO_SUBIDA` | *(vacío)* | Comando para crear el objeto externo. Debe incluir `{archivo}`. |
| `BACKUP_COMANDO_VERIFICAR` | *(vacío)* | Comando que comprueba el contenido remoto. Debe incluir `{archivo}`. |
| `BACKUP_EXIGIR_SEGURO` | `0` | En `1`, impide arrancar si falta cualquiera de los tres controles. |
| `BACKUP_HORAS` | `24` | Cada cuántas horas se hace una. Entre 1 y 168 (una semana). |
| `BACKUP_DIAS` | `7` | Se conservan todas las de los últimos N días. |
| `BACKUP_SEMANAS` | `8` | Y una por semana hacia atrás, N semanas. |
| `BACKUP_DIR` | `./backups` | Dónde se guardan. |

El respaldo más viejo nunca se borra solo: si algo salió mal hace mucho, esa
es la última red.

---

## Lo que esto todavía no cubre

Para que quede dicho y no se descubra el día equivocado:

- **La restauración automática valida Mongo, pero no sustituye un simulacro
  completo.** Una vez al mes se debe descargar una copia externa, restaurar
  Mongo y `uploads/` en una VM aislada y documentar tiempo y resultado.
- **Si se pierde `BACKUP_CLAVE`, los respaldos cifrados no se abren.** No hay
  puerta trasera, a propósito. La clave debe quedar en un gestor de secretos y
  en una custodia de emergencia separada de la VM.
- **Un bucket en el mismo proyecto protege de perder la VM, pero no de perder
  toda la cuenta de Google Cloud.** Para cubrir ese caso, usar otro proyecto y
  administradores separados o replicar a un segundo proveedor.
