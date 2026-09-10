# Poner symphomed.com en el aire

Procedimiento completo, en orden. Son unos 30 minutos, de los cuales 20 son
esperar a que propague el DNS.

Al final de esto:

| Dirección | Qué muestra |
|---|---|
| `symphomed.com` | La página de venta |
| `symphomed.com/app` | La aplicación (login del médico) |
| `salud.chatgo.ia.bo/…` | Redirige a `symphomed.com/…`, conservando el camino |

---

## Por qué la mudanza se hace AHORA y no después

Este procedimiento incluye apagar el dominio viejo. Eso solo es seguro
mientras **no haya nadie usando la plataforma**, que es la situación hoy.

Desde el primer médico deja de serlo, porque `salud.chatgo.ia.bo` empieza a
quedar escrito adentro de links que viven en el WhatsApp de pacientes:

- `/reservar.html?token=…` — cada link de reserva enviado
- `/informe/<token>` — cada informe que un médico compartió
- `/teleconsulta/<token>` — cada sala de teleconsulta

Esos links no se pueden actualizar: ya están en el celular de otra persona.
Por eso la redirección del paso 4 usa `$request_uri` — conserva el camino
completo, así un link viejo sigue llegando a donde tiene que llegar en vez de
caer en la portada. Con esa línea puesta, mudarse no rompe nada ni hoy ni
dentro de un año.

**Lo que no sobrevive a la mudanza son las sesiones abiertas.** El token vive
en el `localStorage`, y el navegador lo guarda por dominio: lo guardado bajo
salud.chatgo.ia.bo no existe bajo symphomed.com. Hoy no afecta a nadie. El
día que haya médicos trabajando, este paso se avisa antes.

---

## 1. La IP del servidor

```bash
curl ifconfig.me
```

Anotala. Es la misma a la que ya apunta `salud.chatgo.ia.bo`.

## 2. El DNS, en el panel del registrador

Donde compraste symphomed.com, buscá **DNS / Zona DNS / Administrar
registros** y creá dos:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `@` | la IP del paso 1 | 3600 |
| A | `www` | la misma IP | 3600 |

Tarda entre 10 minutos y 2 horas. Para saber si ya llegó:

```bash
dig +short symphomed.com
```

Cuando devuelva tu IP, seguí. Antes de eso el paso 4 va a fallar.

## 3. Desplegar el código

En el servidor:

```bash
cd ~/vitalis-app
git fetch origin clinica-multiconsultorio
git checkout clinica-multiconsultorio
git pull origin clinica-multiconsultorio
npm install --omit=dev
```

### ⚠️ Antes de reiniciar: el App Secret de WhatsApp

Esto **no es opcional**. Sin esta variable el webhook rechaza todos los
mensajes entrantes y **ningún paciente puede reservar por WhatsApp**.

En `developers.facebook.com` → tu app → **Configuración → Básica → App Secret
→ Mostrar**. No es el token de acceso ni el verify token: es un tercer valor.

```bash
nano ~/vitalis-app/.env
```

Agregá estas dos líneas:

```
WHATSAPP_APP_SECRET=el_valor_que_copiaste
APP_URL=https://symphomed.com
```

`APP_URL` es lo que decide con qué dominio salen los links de reserva,
informes y teleconsulta. De acá en adelante salen todos con symphomed.com.

```bash
pm2 restart vitalis
pm2 logs vitalis --lines 30
```

En el log de arranque **no tiene que aparecer** ningún `❌`. Si aparece
`WHATSAPP_APP_SECRET no está definido`, el `.env` no se guardó bien.

Comprobalo:

```bash
node scripts/revisar_whatsapp.js
```

La línea `App Secret` tiene que decir `configurado` en verde.

## 4. nginx y el certificado

Se hace en **dos tandas**, y el orden no es intercambiable: el certificado de
symphomed.com hay que sacarlo mientras el dominio viejo todavía atiende
normal. Si se pone la redirección primero, certbot pide la validación, nginx
le contesta con un 301 y el certificado no sale.

### 4a. Primero, que symphomed.com funcione

Agregá los dos nombres al `server_name` que ya existe, **sin sacar el viejo**:

```nginx
server_name salud.chatgo.ia.bo symphomed.com www.symphomed.com;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d symphomed.com -d www.symphomed.com
```

certbot necesita que el DNS ya esté propagado (paso 2): valida pidiéndole al
dominio que le conteste.

**Comprobá que anda antes de seguir:**

```bash
curl -sI https://symphomed.com | head -1                        # 200
curl -s  https://symphomed.com | grep -c "En qué atendés"        # 1 → la página de venta
curl -s  https://symphomed.com/app | grep -c "<title>"           # 1 → la aplicación
```

Si alguna no da eso, **no sigas al 4b**: con la redirección puesta ya no vas
a tener el dominio viejo para volver.

### 4b. Recién ahora, mudar el dominio viejo

Sacá `salud.chatgo.ia.bo` del `server_name` de arriba y dale su propio bloque:

```nginx
server {
    listen 443 ssl;
    server_name salud.chatgo.ia.bo;

    # El certificado del dominio viejo sigue haciendo falta: sin él el
    # navegador muestra la advertencia de seguridad ANTES de leer el 301,
    # y el visitante nunca llega a la redirección.
    ssl_certificate     /etc/letsencrypt/live/salud.chatgo.ia.bo/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/salud.chatgo.ia.bo/privkey.pem;

    # $request_uri conserva el camino Y los parámetros. Sin él, un link como
    # /informe/abc123 caería en la portada de symphomed.com y el paciente no
    # vería su informe. Hoy no hay links viejos dando vueltas; el día que los
    # haya, esta línea es la diferencia entre que anden y que no.
    return 301 https://symphomed.com$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Comprobar, en este orden

```bash
curl -sI https://symphomed.com | head -1                         # 200
curl -s  https://symphomed.com | grep -c "En qué atendés"         # 1 → la página de venta
curl -s  https://symphomed.com/app | grep -c "<title>"            # 1 → la aplicación

# La mudanza: el dominio viejo redirige y conserva el camino
curl -sI https://salud.chatgo.ia.bo/app | grep -i "^location"
# → location: https://symphomed.com/app     ← con el /app, no pelado
```

**La última es la que importa.** Si dice `https://symphomed.com/` a secas, te
falta `$request_uri` y todos los links con token van a caer en la portada.

Y si `symphomed.com` te muestra la aplicación en vez de la página de venta,
revisá `DOMINIOS_LANDING` en el `.env`: si no está definida, el valor por
defecto ya es el correcto (solo symphomed.com y www), así que lo más probable
es que esté definida y le falte el dominio.

Al final, desde el celular, la prueba que de verdad cuenta: abrir
`symphomed.com`, contestar las tres preguntas y tocar el botón de WhatsApp.
Tiene que abrir un chat con **+591 64637067** y el mensaje ya escrito.

---

## Después, cuando esté tranquilo

No hace falta el día del lanzamiento:

- **Poner `NODE_ENV=production`** en el `.env`. Hoy Express corre en modo
  desarrollo y su manejador de errores por defecto devuelve el stack trace
  completo.
- **Verificar los índices únicos del saldo** en producción. Son lo único que
  impide cobrar dos veces la misma consulta o acreditar dos veces la misma
  transferencia, y hoy nadie comprobó que se hayan construido.
