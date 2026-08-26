#!/usr/bin/env bash
# Vitalis — Desplegar una rama en el servidor.
#
# Hace los controles que uno se saltea cuando tiene apuro, y se PLANTA si
# alguno falla en vez de seguir de largo:
#
#   · que no haya cambios sin guardar en el servidor (hacer checkout encima
#     de un archivo editado a mano lo pisa sin avisar);
#   · que el commit al que vamos sea el que creemos;
#   · que después de reiniciar la app conteste, y que los paquetes de idioma
#     se hayan generado —están en .gitignore, así que si eso falla la
#     interfaz sale sin un solo texto;
#   · deja anotado el commit anterior en un archivo, no solo en la pantalla,
#     para que volver atrás siga siendo posible aunque cierres la terminal.
#
# Uso:
#   ./scripts/desplegar.sh clinica-multiconsultorio b1c75fe
#   ./scripts/desplegar.sh <rama> [commit-esperado]
#
# NO hace el respaldo: eso se hace desde Panel → Seguridad, con los ojos en
# el resultado. El script pregunta si ya lo hiciste.
set -euo pipefail

RAMA="${1:-}"
COMMIT_ESPERADO="${2:-}"
PM2_NOMBRE="${PM2_NOMBRE:-vitalis}"
PUERTO="${PORT:-3000}"
ARCHIVO_RETORNO="$HOME/vitalis-punto-de-retorno.txt"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }

if [ -z "$RAMA" ]; then
  echo "Uso: $0 <rama> [commit-esperado]"
  exit 1
fi

paso "0. Dónde estamos"
cd "$(dirname "$0")/.."
pwd
git rev-parse --is-inside-work-tree >/dev/null || { rojo "❌ Esto no es un repositorio git."; exit 1; }

if ! pm2 describe "$PM2_NOMBRE" >/dev/null 2>&1; then
  rojo "❌ pm2 no conoce ningún proceso llamado '$PM2_NOMBRE'."
  echo "   Mirá 'pm2 list' y volvé a correr con: PM2_NOMBRE=<elnombre> $0 $RAMA"
  exit 1
fi

paso "1. Punto de retorno"
ANTES="$(git rev-parse --short HEAD)"
RAMA_ANTES="$(git branch --show-current || echo '(detached)')"
{
  echo "fecha:  $(date -Is)"
  echo "rama:   $RAMA_ANTES"
  echo "commit: $ANTES"
} | tee "$ARCHIVO_RETORNO"
verde "Guardado en $ARCHIVO_RETORNO"

# Este script llega al servidor con:
#   git checkout origin/<rama> -- scripts/desplegar.sh
# y eso, además de escribir el archivo, lo deja EN EL ÍNDICE. O sea que el
# script aparece como cambio pendiente en su propia comprobación y se planta
# a sí mismo. Pasó la primera vez que se usó.
#
# Se excluye entonces su propia ruta. No se pierde nada: el checkout de la
# rama lo va a reemplazar por la versión de la rama de todos modos. Lo que
# esta comprobación tiene que atajar son los OTROS archivos, los que alguien
# editó a mano en el servidor y un checkout pisaría sin avisar.
YO="${BASH_SOURCE[0]#./}"
SUCIO="$(git status --porcelain | grep -v "[[:space:]]scripts/desplegar\.sh$" || true)"
if [ -n "$SUCIO" ]; then
  rojo "❌ Hay cambios sin guardar en el servidor:"
  echo "$SUCIO"
  echo
  echo "   Alguien editó archivos acá a mano. Hacer checkout encima los pisa."
  echo "   Averiguá qué son ANTES de seguir. No los borres sin mirar."
  echo
  echo "   Si estás seguro de que se pueden descartar:"
  echo "     git stash push --include-untracked   # los guarda por si acaso"
  exit 1
fi
verde "✅ El árbol está limpio (sin contar $YO, que llega así por diseño)"

paso "2. Respaldo"
echo "¿Ya hiciste el respaldo desde Panel → Seguridad y verificaste que quedó?"
read -r -p "Escribí SI para seguir: " RESPUESTA
[ "$RESPUESTA" = "SI" ] || { rojo "Cancelado. Hacé el respaldo primero."; exit 1; }
ls -lh backups/ 2>/dev/null | tail -3 || echo "(no hay carpeta backups/ acá)"

paso "3. Traer el código"
git fetch origin "$RAMA"
PENDIENTES="$(git log --oneline "HEAD..origin/$RAMA" | wc -l | tr -d ' ')"
echo "Commits que entran: $PENDIENTES"
git checkout "$RAMA"
git pull origin "$RAMA"
AHORA="$(git rev-parse --short HEAD)"
echo "Ahora en: $AHORA"

if [ -n "$COMMIT_ESPERADO" ] && [ "$AHORA" != "$COMMIT_ESPERADO" ]; then
  rojo "❌ Esperaba el commit $COMMIT_ESPERADO y quedó en $AHORA."
  echo "   Algo no coincide. Volvé atrás con:  git checkout $ANTES"
  exit 1
fi

# No hubo dependencias nuevas en este despliegue, pero si las hay en otro,
# esto las instala. --omit=dev para no bajar nada de desarrollo al servidor.
if ! git diff --quiet "$ANTES" HEAD -- package.json package-lock.json; then
  paso "3b. Cambió package.json — instalando"
  npm install --omit=dev
else
  echo "package.json no cambió: no hace falta npm install"
fi

paso "4. Reiniciar"
pm2 restart "$PM2_NOMBRE" --update-env
sleep 8
pm2 logs "$PM2_NOMBRE" --lines 40 --nostream || true

paso "5. ¿Contesta?"
fallos=0
if curl -fsS "localhost:$PUERTO/health" >/dev/null 2>&1; then
  verde "✅ /health responde"
else
  rojo "❌ /health NO responde"; fallos=$((fallos+1))
fi

# Los paquetes de idioma se arman al arrancar (están en .gitignore). Si esto
# falla, la app queda desplegada sin textos.
for idioma in es pt; do
  bytes="$(curl -fsS "localhost:$PUERTO/i18n/$idioma.js" 2>/dev/null | wc -c | tr -d ' ')" || bytes=0
  if [ "${bytes:-0}" -gt 40000 ]; then
    verde "✅ /i18n/$idioma.js — $bytes bytes"
  else
    rojo "❌ /i18n/$idioma.js vino con $bytes bytes (esperaba >40000)"; fallos=$((fallos+1))
  fi
done

echo
if [ "$fallos" -gt 0 ]; then
  rojo "💥 $fallos control(es) fallaron. Volvé atrás:"
  echo "   git checkout $ANTES && pm2 restart $PM2_NOMBRE --update-env"
  exit 1
fi

verde "🏁 El servidor levantó bien."
cat <<FIN

Falta lo que ningún script puede comprobar. En el navegador, EN ESTE ORDEN:

  1. Entrar con una cuenta que YA existía → tiene que quedar en español y
     verse igual que siempre.
  2. Abrir el Kardex de un paciente y recorrer sus pestañas.
  3. Abrir la agenda y una consulta.
  4. Recién ahora: Configuración → portugués, mirar un par de pantallas,
     y volver a español.

Si algo de 1 a 3 falla, eso es una regresión sobre lo que ya funcionaba:

  git checkout $ANTES && pm2 restart $PM2_NOMBRE --update-env

Los datos no hay que revertirlos: este despliegue solo agrega campos con
valor por defecto y colecciones nuevas. El código viejo los ignora.
FIN
