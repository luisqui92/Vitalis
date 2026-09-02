# Teleconsulta — qué necesita y qué no

## No necesita ninguna cuenta ni ningún API key

La videollamada va **directo entre el navegador del médico y el del
paciente** (WebRTC). No hay Daily, ni Twilio, ni Zoom, ni proveedor de
ninguna clase.

Eso no es sobre todo un ahorro —aunque no haya minutos que pagar, nunca—:
es que el video de un paciente contándole a su médico qué le duele **no
pasa por nadie más**. Un proveedor de video en el medio es una copia de
datos clínicos en una empresa que hay que auditar, en un país que hay que
mirar, con un contrato que hay que leer.

Si aparece `DAILY_API_KEY` en algún lado, es de una versión anterior y no
lo lee nadie. `daily.co` sí queda permitido en la CSP (`index.js:59`), pero
es para **Vapi**, la recepcionista de voz de las reservas: Vapi usa la
infraestructura de Daily por debajo. Otra función, otras variables
(`VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_SERVER_SECRET`).

## Lo único que sí hace falta: el relay (TURN)

Entre 1 y 2 de cada 10 llamadas, los dos extremos están detrás de NAT
simétrico y no logran verse directo — típico de dos celulares en datos
móviles, o sea de media Bolivia. Ahí hace falta un relay.

**Sin TURN esas llamadas fallan de la peor forma: conectan y no se escucha
nada.** No dan error. Los dos creen que el otro colgó.

El relay va en la misma VM, no se contrata: un TURN de tercero vería el
metadato completo de quién habló con quién, cuándo y cuánto, y eso anula el
motivo por el que sacamos al proveedor de video.

```bash
cd ~/vitalis-app
sudo ./scripts/instalar_turn.sh     # instala y configura coturn
node scripts/probar_turn.js         # ← esto es lo que dice si ANDA
pm2 restart vitalis --update-env
```

El arranque tiene que decir:

```
[TELECONSULTA] WebRTC directo, con TURN propio (credenciales temporales)
```

Si dice `SIN TURN`, la app no leyó el `.env` — falta `--update-env`.

### Por qué hay un probador aparte

`systemctl status coturn: active (running)` **no prueba nada**. coturn
puede estar impecable y el firewall cerrado; puede autenticar y no saber su
IP pública. En los dos casos el síntoma es idéntico a no tenerlo instalado,
y se descubre en la primera consulta real, con un paciente esperando.

`probar_turn.js` pide una asignación de verdad, igual que el navegador del
paciente, y comprueba tres cosas:

| | Si falla |
|---|---|
| Que se llegue al relay | firewall |
| Que acepte las credenciales | el `TURN_SECRET` del `.env` y el `static-auth-secret` de `/etc/turnserver.conf` no son el mismo |
| Que la dirección relevada sea **pública** | falta `external-ip` — le está dando a los pacientes una `10.x` que no existe fuera de Google Cloud |

El tercero es el que se pasa por alto: los dos primeros dan OK y la llamada
igual no se escucha.

### Lo que el instalador prohíbe, y por qué

coturn por defecto releva hacia **cualquier** dirección, incluida
`169.254.169.254` — el servidor de metadatos de Google Cloud, que entrega
el token de servicio de la VM. Quien llegue ahí a través del relay se lleva
las credenciales de la máquina que guarda las historias clínicas. No es una
precaución teórica: es la forma habitual en que se compromete un coturn.
Por eso el `.conf` generado tiene una lista de `denied-peer-ip` con todos
los rangos privados.

También usa **credenciales que vencen a las 4 horas**, derivadas por HMAC
de un secreto compartido (`services/video.js:58-70`). Un usuario y clave
fijos de TURN quedarían escritos en el navegador de cualquiera que abra una
teleconsulta — o sea, en el de cualquiera: un relay abierto al mundo con tu
ancho de banda.

## Variables

| Variable | Para qué |
|---|---|
| `TURN_URL` | `turns:salud.chatgo.ia.bo:5349?transport=tcp` (lo escribe el instalador) |
| `TURN_SECRET` | 64 caracteres; el mismo que `static-auth-secret` |
| `STUN_URLS` | opcional; por defecto el público de Google, que solo sirve para descubrir la IP propia y no ve tráfico |

## Lo que todavía falta

- **Audio en dos pistas.** Hoy la transcripción de la teleconsulta mezcla
  las dos voces. Grabar el micrófono del médico aparte del audio que llega
  hace innecesaria la diarización: el micrófono del médico *es* el médico.
- **Probar el relay desde afuera.** Correr `probar_turn.js` en la misma VM
  puede dar OK aunque el firewall esté cerrado.
