# Poner symphomed.com en el aire

Procedimiento completo, en orden. Son unos 30 minutos, de los cuales 20 son
esperar a que propague el DNS.

Al final de esto:

| Dirección | Qué muestra |
|---|---|
| `symphomed.com` | La página de venta |
| `symphomed.com/app` | La aplicación (login del médico) |
| `salud.chatgo.ia.bo` | La aplicación, **igual que siempre** |
| `salud.chatgo.ia.bo/app` | También la aplicación |

---

## Lo que NO se hace, y por qué

**`salud.chatgo.ia.bo` no se apaga ni se redirige.** No es apego al dominio
viejo: es que ese dominio ya está escrito adentro de links que viven en el
WhatsApp de pacientes reales.

- `salud.chatgo.ia.bo/reservar.html?token=…` — cada link de reserva enviado
- `salud.chatgo.ia.bo/informe/<token>` — cada informe que un médico compartió
- `salud.chatgo.ia.bo/teleconsulta/<token>` — cada sala de teleconsulta

Si el dominio deja de resolver, todos esos links mueren a la vez y no hay
forma de avisarle a nadie: el paciente toca y le sale un error del navegador.

Los dos dominios apuntan al mismo servidor y sirven lo mismo. Lo único que
cambia de dueño es **la raíz**, y solo en symphomed.com.

**Los médicos que ya estaban con sesión abierta van a tener que entrar de
nuevo** si pasan a usar symphomed.com. El token vive en el `localStorage` del
navegador, y el navegador lo guarda por dominio: lo que está guardado bajo
salud.chatgo.ia.bo no existe bajo symphomed.com. No es un error y no se puede
evitar — conviene avisarles antes.

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

`APP_URL` es lo que decide con qué dominio salen los links **nuevos** de
reserva, informes y teleconsulta. Los ya enviados no cambian, y siguen
funcionando porque el dominio viejo sigue vivo.

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

Agregá los dos nombres al `server_name` que ya existe, sin sacar el viejo:

```nginx
server_name salud.chatgo.ia.bo symphomed.com www.symphomed.com;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d symphomed.com -d www.symphomed.com
```

certbot necesita que el DNS ya esté propagado (paso 2): valida pidiéndole al
dominio que le conteste. Se renueva solo.

## 5. Comprobar, en este orden

```bash
curl -sI https://symphomed.com | head -1                    # 200
curl -s  https://symphomed.com | grep -c "En qué atendés"    # 1 → la página de venta
curl -s  https://symphomed.com/app | grep -c "<title>"       # 1 → la aplicación
curl -s  https://salud.chatgo.ia.bo | grep -c "En qué atendés" # 0 → sigue la app, NO la venta
```

**La cuarta es la que importa.** Si devuelve 1, la página de venta se quedó
con la raíz del dominio de los médicos y todos perdieron el login. En ese
caso, revertí:

```bash
pm2 restart vitalis --update-env
```

y revisá `DOMINIOS_LANDING` en el `.env` (si no está, el valor por defecto ya
es el correcto: solo symphomed.com y www).

Y desde el celular, la prueba que de verdad cuenta: abrir `symphomed.com`,
contestar las tres preguntas y tocar el botón de WhatsApp. Tiene que abrir un
chat con **+591 64637067** y el mensaje ya escrito.

---

## Después, cuando esté tranquilo

No hace falta el día del lanzamiento:

- **Redirigir** `salud.chatgo.ia.bo` → `symphomed.com` conservando el camino
  (`return 301 https://symphomed.com$request_uri;`). Recién cuando ya no
  queden links viejos circulando, y nunca sin conservar `$request_uri`.
- **Poner `NODE_ENV=production`** en el `.env`. Hoy Express corre en modo
  desarrollo y su manejador de errores por defecto devuelve el stack trace
  completo.
- **Verificar los índices únicos del saldo** en producción. Son lo único que
  impide cobrar dos veces la misma consulta o acreditar dos veces la misma
  transferencia, y hoy nadie comprobó que se hayan construido.
