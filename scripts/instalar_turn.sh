#!/usr/bin/env bash
# Symphomed — Instalar el relay de la teleconsulta (coturn) en esta misma VM.
#
# ═══ POR QUÉ ESTO NO SE CONTRATA ═══════════════════════════════════════════
#
# Sin TURN, entre 1 y 2 de cada 10 teleconsultas conectan y no se escuchan.
# No dan error: dan silencio. Los dos extremos creen que el otro colgó.
#
# La salida fácil es contratar un TURN de tercero. Pero un relay VE EL
# TRÁFICO que releva — cifrado extremo a extremo por DTLS-SRTP, sí, pero es
# el metadato completo de quién habló con quién, cuándo y cuánto, en la
# infraestructura de otro, bajo la ley de otro país. Sacamos al proveedor de
# video de la teleconsulta por ese motivo exacto; no tiene sentido volver a
# meterlo en la última milla.
#
# coturn en esta VM cuesta cero, no tiene key que gestionar, y el audio no
# sale de tu servidor.
#
# ═══ QUÉ HACE ══════════════════════════════════════════════════════════════
#
#   · instala coturn;
#   · lo configura con secreto compartido (credenciales que vencen a las 4h,
#     no un usuario fijo que sería un relay abierto para el mundo);
#   · le PROHÍBE relevar hacia adentro —incluido 169.254.169.254, el
#     servidor de metadatos de Google Cloud, que es de donde se roban las
#     credenciales de la VM;
#   · usa el certificado de Let's Encrypt que ya tenés, con un hook para que
#     siga andando después de cada renovación;
#   · abre el firewall de Google Cloud;
#   · escribe TURN_URL y TURN_SECRET en el .env, sin pisar lo demás.
#
# Uso, desde ~/vitalis-app, en la VM:
#   sudo ./scripts/instalar_turn.sh
#
# Después:
#   node scripts/probar_turn.js      ← esto es lo que dice si de verdad anda
#   pm2 restart vitalis
set -euo pipefail

DOMINIO="${DOMINIO:-salud.chatgo.ia.bo}"
PUERTO_MIN="${PUERTO_MIN:-49160}"
PUERTO_MAX="${PUERTO_MAX:-49200}"
ARCHIVO_ENV="${ARCHIVO_ENV:-$HOME/vitalis-app/.env}"
CERTS_DIR="/etc/coturn/certs"

# Se llenan en el paso 4 solo si hay certificado. Vacías, desaparecen del
# archivo generado: un heredoc anidado adentro de otro heredoc "funciona"
# pero es de las cosas que se rompen al editar y nadie entiende por qué.
LINEA_TLS_PUERTO=""
BLOQUE_TLS=""

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }

if [ "$(id -u)" != "0" ]; then
  rojo "Esto necesita sudo:  sudo $0"
  exit 1
fi

# El .env es del usuario, no de root. Si corriste con sudo, $HOME es /root.
if [ ! -f "$ARCHIVO_ENV" ] && [ -n "${SUDO_USER:-}" ]; then
  ARCHIVO_ENV="$(getent passwd "$SUDO_USER" | cut -d: -f6)/vitalis-app/.env"
fi
if [ ! -f "$ARCHIVO_ENV" ]; then
  rojo "No encuentro el .env en $ARCHIVO_ENV"
  rojo "Corré con:  sudo ARCHIVO_ENV=/ruta/al/.env $0"
  exit 1
fi

paso "1. Las dos IP de la VM"
# En Google Cloud la VM NO tiene su IP pública puesta en la placa de red: ve
# una IP interna y Google hace NAT. coturn necesita saber las dos, o le
# ofrece al navegador del paciente una dirección 10.x que no existe fuera.
IP_INTERNA="$(hostname -I | awk '{print $1}')"
IP_EXTERNA="$(curl -s --max-time 10 -H 'Metadata-Flavor: Google' \
  'http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' || true)"
if [ -z "$IP_EXTERNA" ]; then
  IP_EXTERNA="$(curl -s --max-time 10 https://api.ipify.org || true)"
fi
if [ -z "$IP_EXTERNA" ]; then
  rojo "No pude averiguar la IP pública. Pasala a mano:"
  rojo "  sudo IP_EXTERNA=34.x.x.x $0"
  exit 1
fi
echo "   interna:  $IP_INTERNA"
echo "   pública:  $IP_EXTERNA"

paso "2. Instalar coturn"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn >/dev/null
verde "   coturn instalado"

paso "3. El secreto"
# Si ya hay uno en el .env se respeta: regenerarlo cortaría las llamadas en
# curso y obligaría a reiniciar la app para que vuelvan a coincidir.
SECRETO="$(grep -E '^TURN_SECRET=' "$ARCHIVO_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [ -n "$SECRETO" ]; then
  gris "   ya había uno en el .env, se reutiliza"
else
  SECRETO="$(openssl rand -hex 32)"
  verde "   generado (64 caracteres)"
fi

paso "4. El certificado"
CERT_ORIGEN="/etc/letsencrypt/live/$DOMINIO/fullchain.pem"
HAY_TLS=0
if [ -f "$CERT_ORIGEN" ]; then
  mkdir -p "$CERTS_DIR"
  # Un hook de renovación, no una copia y listo: Let's Encrypt renueva cada
  # 60 días y el día que renueve, coturn seguiría sirviendo el certificado
  # viejo hasta que alguien se dé cuenta — o sea, hasta que un paciente no
  # pueda conectarse.
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/vitalis-turn.sh <<HOOK
#!/usr/bin/env bash
# Generado por scripts/instalar_turn.sh — copia el certificado renovado a
# donde coturn puede leerlo y lo reinicia. Sin esto, coturn sirve el
# certificado vencido y las teleconsultas por TLS dejan de conectar.
set -e
install -o turnserver -g turnserver -m 640 \
  /etc/letsencrypt/live/$DOMINIO/fullchain.pem $CERTS_DIR/fullchain.pem
install -o turnserver -g turnserver -m 640 \
  /etc/letsencrypt/live/$DOMINIO/privkey.pem $CERTS_DIR/privkey.pem
systemctl restart coturn
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/vitalis-turn.sh
  install -o turnserver -g turnserver -m 640 "$CERT_ORIGEN" "$CERTS_DIR/fullchain.pem"
  install -o turnserver -g turnserver -m 640 "/etc/letsencrypt/live/$DOMINIO/privkey.pem" "$CERTS_DIR/privkey.pem"
  chown -R turnserver:turnserver "$CERTS_DIR"
  chmod 750 "$CERTS_DIR"
  HAY_TLS=1
  LINEA_TLS_PUERTO="tls-listening-port=5349"
  BLOQUE_TLS="cert=$CERTS_DIR/fullchain.pem
pkey=$CERTS_DIR/privkey.pem
no-tlsv1
no-tlsv1_1"
  verde "   usando el certificado de $DOMINIO, con hook de renovación"
else
  gris "   sin certificado en $CERT_ORIGEN — queda solo TURN sin TLS."
  gris "   Anda igual, pero algunas redes corporativas bloquean el 3478."
fi

paso "5. Configurar"
[ -f /etc/turnserver.conf ] && cp /etc/turnserver.conf "/etc/turnserver.conf.antes-de-vitalis.$(date +%s)"

cat > /etc/turnserver.conf <<CONF
# Symphomed — relay de teleconsulta. Generado por scripts/instalar_turn.sh
# $(date -Is)

listening-port=3478
$LINEA_TLS_PUERTO

# Las dos caras de la VM en Google Cloud: sin esto coturn le ofrece al
# paciente una dirección interna que no existe fuera de la red de Google.
external-ip=$IP_EXTERNA/$IP_INTERNA

realm=$DOMINIO
server-name=$DOMINIO
fingerprint

# ═══ CREDENCIALES QUE VENCEN ═══════════════════════════════════════════════
# Un usuario y clave fijos de TURN quedan escritos en el navegador de
# cualquiera que abra una teleconsulta — o sea, en el de cualquiera. Sería
# un relay abierto al mundo con tu ancho de banda. Con secreto compartido,
# cada llamada recibe una credencial propia que muere a las 4 horas.
# services/video.js las deriva con el mismo HMAC-SHA1.
lt-cred-mech
use-auth-secret
static-auth-secret=$SECRETO

$BLOQUE_TLS

# Rango angosto a propósito: son los puertos que hay que abrir en el
# firewall, y 16.000 puertos abiertos "por si acaso" es una superficie que
# nadie va a auditar nunca.
min-port=$PUERTO_MIN
max-port=$PUERTO_MAX

# ═══ LO QUE NO SE PUEDE RELEVAR ════════════════════════════════════════════
# Un TURN mal configurado es un proxy hacia la red interna del servidor. En
# Google Cloud, 169.254.169.254 entrega el token de servicio de la VM: quien
# llegue ahí a través del relay se lleva las credenciales de la máquina que
# guarda las historias clínicas. Esto no es una precaución teórica; es la
# forma habitual en que se compromete un coturn.
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# Una teleconsulta son dos flujos. 12 asignaciones por usuario es holgado y
# corta el abuso; 200 en total es el techo de la VM antes de que el relay
# empiece a comerse el ancho de banda de la aplicación.
user-quota=12
total-quota=200

# Sin consola de administración: es un puerto más que defender para algo
# que se configura por archivo.
no-cli
CONF

chmod 640 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
verde "   /etc/turnserver.conf escrito"

# En Debian el paquete arranca deshabilitado hasta que se toca esta línea.
if [ -f /etc/default/coturn ]; then
  sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi

paso "6. Firewall de Google Cloud"
if command -v gcloud >/dev/null 2>&1; then
  gcloud compute firewall-rules create vitalis-turn \
    --allow="udp:3478,tcp:3478,tcp:5349,udp:$PUERTO_MIN-$PUERTO_MAX" \
    --description="Symphomed: relay de teleconsulta (coturn)" \
    --direction=INGRESS 2>/dev/null \
    && verde "   regla vitalis-turn creada" \
    || gris "   ya existía (o no hay permisos) — verificá que permita udp:3478 y udp:$PUERTO_MIN-$PUERTO_MAX"
else
  rojo "   gcloud no está instalado. Creá la regla desde la consola web:"
  echo "     udp:3478, tcp:3478, tcp:5349, udp:$PUERTO_MIN-$PUERTO_MAX"
fi

# El firewall del sistema, si lo hay. En GCE normalmente no está activo.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  ufw allow 3478/udp >/dev/null; ufw allow 3478/tcp >/dev/null
  [ "$HAY_TLS" = "1" ] && ufw allow 5349/tcp >/dev/null
  ufw allow "$PUERTO_MIN:$PUERTO_MAX/udp" >/dev/null
  verde "   ufw abierto"
fi

paso "7. Arrancar"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2
if systemctl is-active --quiet coturn; then
  verde "   coturn andando"
else
  rojo "   coturn NO arrancó. Mirá por qué:"
  rojo "     journalctl -u coturn -n 40 --no-pager"
  exit 1
fi

paso "8. El .env"
cp "$ARCHIVO_ENV" "$ARCHIVO_ENV.antes-de-turn.$(date +%s)"
if [ "$HAY_TLS" = "1" ]; then
  URL="turns:$DOMINIO:5349?transport=tcp"
else
  URL="turn:$DOMINIO:3478"
fi
# sed -i sobre una línea que puede no existir no la crea; por eso las dos
# ramas. Y el backup de arriba, porque este archivo tiene el JWT_SECRET.
for par in "TURN_URL=$URL" "TURN_SECRET=$SECRETO"; do
  clave="${par%%=*}"
  if grep -qE "^$clave=" "$ARCHIVO_ENV"; then
    sed -i "s|^$clave=.*|$par|" "$ARCHIVO_ENV"
  else
    printf '%s\n' "$par" >> "$ARCHIVO_ENV"
  fi
done
verde "   TURN_URL=$URL"
verde "   TURN_SECRET=(64 caracteres, no se imprime)"
gris  "   copia del .env anterior guardada al lado"

paso "Listo — pero todavía no sabés si anda"
cat <<FIN

coturn está corriendo. Eso NO significa que releve: puede estar arriba y
tener el firewall cerrado, y el síntoma sería exactamente el mismo que
ahora — la llamada conecta y no se escucha.

Comprobalo de verdad, desde ~/vitalis-app:

    node scripts/probar_turn.js

Pide una asignación real al relay, igual que lo haría el navegador de un
paciente. Recién si eso dice OK:

    pm2 restart vitalis
    pm2 logs vitalis --lines 20

El arranque tiene que decir "con TURN propio (credenciales temporales)".
Si sigue diciendo "SIN TURN", la app no leyó el .env — es pm2 que guarda el
entorno viejo:  pm2 restart vitalis --update-env
FIN
