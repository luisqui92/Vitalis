# Poner symphomed.com en el aire

Procedimiento completo, en orden. Son unos 30 minutos, de los cuales 20 son
esperar a que propague el DNS.

## Cómo queda repartido

`symphomed.com` es **la cara pública**: info y contacto. La plataforma vive en
su propio subdominio y no comparte la raíz con el marketing.

| Dirección | Qué muestra |
|---|---|
| `symphomed.com` · `www.symphomed.com` | La página de venta |
| `app.symphomed.com` | La plataforma (login del médico) |
| `salud.chatgo.ia.bo/…` | Redirige a `app.symphomed.com/…` |

El subdominio no necesita ni una línea de código: la aplicación sirve la
página de venta **solo** en los dominios de `DOMINIOS_LANDING`, y en cualquier
otro sirve la plataforma. `app.symphomed.com` no está en esa lista, así que su
raíz muestra el login solo con apuntarle el DNS.

> **El nombre del subdominio no está clavado en ningún lado.** Acá se usa
> `app.` porque es corto y todo el mundo lo entiende, pero si preferís
> `consultorio.` o `salud.`, se cambia en dos lugares: el registro DNS y la
> variable `URL_PLATAFORMA`. No hay que tocar HTML ni volver a desplegar.

---

## Por qué la mudanza del dominio viejo se hace AHORA

Este procedimiento apaga `salud.chatgo.ia.bo` (lo deja redirigiendo). Eso solo
es seguro mientras **no haya nadie usando la plataforma**, que es la situación
hoy.

Desde el primer médico deja de serlo, porque ese dominio empieza a quedar
escrito adentro de links que viven en el WhatsApp de pacientes:

- `/reservar.html?token=…` — cada link de reserva enviado
- `/informe/<token>` — cada informe que un médico compartió
- `/teleconsulta/<token>` — cada sala de teleconsulta

Esos links no se pueden actualizar: ya están en el celular de otra persona.
Por eso la redirección del paso 5 usa `$request_uri`, que conserva el camino
completo. Con esa línea puesta, la mudanza no tiene fecha de vencimiento.

**Y por eso la redirección apunta al SUBDOMINIO y no a `symphomed.com`.** Un
`/informe/<token>` que aterrizara en la página de venta no le muestra el
informe a nadie: esa página no sabe qué es un token. El dominio viejo era la
plataforma, así que tiene que seguir llevando a la plataforma.

**Lo que no sobrevive a la mudanza son las sesiones abiertas.** El token vive
en el `localStorage` y el navegador lo guarda por dominio. Hoy no afecta a
nadie; el día que haya médicos trabajando, este paso se avisa antes.

---

## 1. La IP del servidor

```bash
curl ifconfig.me
```

Anotala. Es la misma a la que ya apunta `salud.chatgo.ia.bo`.

## 2. El DNS, en el panel del registrador

Donde compraste symphomed.com, buscá **DNS / Zona DNS / Administrar
registros** y creá **tres** registros, todos a la misma IP:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `@` | la IP del paso 1 | 3600 |
| A | `www` | la misma IP | 3600 |
| A | `app` | la misma IP | 3600 |

El tercero es el que suele olvidarse, y sin él el paso 4 falla a mitad de
camino: el certificado sale para dos dominios y no para el que usan los
médicos.

Tarda entre 10 minutos y 2 horas. Para saber si ya llegaron los tres:

```bash
for d in symphomed.com www.symphomed.com app.symphomed.com; do
  echo "$d → $(dig +short $d)"
done
```

Cuando los tres devuelvan tu IP, seguí. Antes de eso el paso 4 va a fallar.

## 3. Desplegar el código

En el servidor:

```bash
cd ~/vitalis-app
git fetch origin clinica-multiconsultorio
git checkout clinica-multiconsultorio
git pull origin clinica-multiconsultorio
npm install --omit=dev
```

### Las tres variables del `.env`

```bash
nano ~/vitalis-app/.env
```

```
WHATSAPP_APP_SECRET=el_valor_de_meta
APP_URL=https://app.symphomed.com
URL_PLATAFORMA=https://app.symphomed.com
```

**`WHATSAPP_APP_SECRET`** — obligatoria. Sin ella el webhook rechaza todos los
mensajes entrantes y **ningún paciente puede reservar por WhatsApp**. Está en
`developers.facebook.com` → tu app → **Configuración → Básica → App Secret →
Mostrar**. No es el token de acceso ni el verify token: es un tercer valor.

**`APP_URL`** — con qué dominio salen los links de reserva, informes y
teleconsulta. Va al **subdominio**, no a symphomed.com: esos links abren
pantallas de la plataforma.

**`URL_PLATAFORMA`** — a dónde manda el botón "Ingresar" de la página de
venta. Si no está, el enlace cae en `/app` del mismo servidor, que funciona
igual pero deja al médico dentro de symphomed.com.

```bash
pm2 restart vitalis
pm2 logs vitalis --lines 30
```

En el log de arranque **no tiene que aparecer** ningún `❌`, y sí estas dos
líneas:

```
[INICIO] Página de venta en /inicio y en la raíz de: symphomed.com, www.symphomed.com
[INICIO] El enlace "Ingresar" lleva a: https://app.symphomed.com
```

Y comprobá el WhatsApp:

```bash
node scripts/revisar_whatsapp.js
```

La línea `App Secret` tiene que decir `configurado` en verde.

## 4. nginx y los certificados

Los tres nombres nuevos al `server_name` que ya existe, **sin sacar el
viejo todavía**:

```nginx
server_name salud.chatgo.ia.bo symphomed.com www.symphomed.com app.symphomed.com;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d symphomed.com -d www.symphomed.com -d app.symphomed.com
```

certbot valida pidiéndole a cada dominio que le conteste, así que necesita los
tres registros del paso 2 ya propagados.

### Comprobá antes de seguir

```bash
curl -sI https://symphomed.com | head -1                       # 200
curl -s  https://symphomed.com | grep -c "En qué atendés"       # 1 → la página de venta
curl -s  https://app.symphomed.com | grep -c "En qué atendés"   # 0 → la plataforma, NO la venta
curl -s  https://app.symphomed.com | grep -c "<title>"          # 1 → el login
```

**La tercera es la que importa.** Si devuelve 1, la página de venta se quedó
con la raíz del subdominio de los médicos. Revisá `DOMINIOS_LANDING` en el
`.env`: si no está definida el valor por defecto ya es el correcto, así que lo
más probable es que esté definida y le hayan metido el subdominio.

**Si algo de esto falla, no sigas al paso 5.** Con la redirección puesta ya no
vas a tener el dominio viejo para volver.

## 5. Recién ahora, mudar el dominio viejo

El orden no es intercambiable: si ponés la redirección antes de sacar los
certificados, certbot pide la validación, nginx le contesta con el 301 y el
certificado no sale nunca.

Sacá `salud.chatgo.ia.bo` del `server_name` de arriba y dale su propio bloque:

```nginx
server {
    listen 443 ssl;
    server_name salud.chatgo.ia.bo;

    # El certificado del dominio viejo sigue haciendo falta aunque solo
    # redirija: sin él el navegador muestra la advertencia de seguridad ANTES
    # de leer el 301, y el visitante nunca llega a la redirección.
    ssl_certificate     /etc/letsencrypt/live/salud.chatgo.ia.bo/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/salud.chatgo.ia.bo/privkey.pem;

    # Al SUBDOMINIO, no a symphomed.com: este dominio era la plataforma y
    # tiene que seguir llevando a la plataforma. Un /informe/<token> que
    # aterrizara en la página de venta no le muestra el informe a nadie.
    #
    # $request_uri conserva el camino Y los parámetros. Sin él, todos los
    # links con token caen en la portada.
    return 301 https://app.symphomed.com$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. La comprobación final

```bash
curl -sI https://salud.chatgo.ia.bo/informe/abc123 | grep -i "^location"
# → location: https://app.symphomed.com/informe/abc123
```

Tiene que salir **el camino completo**. Si dice `https://app.symphomed.com/` a
secas, falta `$request_uri` y todos los links con token van a caer en la
portada.

Y desde el celular, la prueba que de verdad cuenta: abrir `symphomed.com`,
contestar las tres preguntas y tocar el botón de WhatsApp. Tiene que abrir un
chat con **+591 64637067** y el mensaje ya escrito.

---

## Después, cuando esté tranquilo

No hace falta el día del lanzamiento:

- **Poner `NODE_ENV=production`** en el `.env`. Hoy Express corre en modo
  desarrollo y su manejador de errores por defecto devuelve el stack trace
  completo.
- **Verificar los índices únicos del saldo** en producción. Son lo único que
  impide cobrar dos veces la misma consulta o acreditar dos veces la misma
  transferencia, y hoy nadie comprobó que se hayan construido.
