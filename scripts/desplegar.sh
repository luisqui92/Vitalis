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

# Hace falta conocer la rama de destino ANTES de revisar el árbol: la
# comprobación de abajo compara contra ella.
git fetch origin "$RAMA"

# ─── ¿Hay algo que un checkout pisaría? ───────────────────────────────────
#
# La pregunta correcta NO es "¿hay cambios sin guardar?" sino "¿hay algún
# archivo cuyo contenido se PERDERÍA al pasar a la rama?".
#
# La diferencia importa. Para traer este script al servidor hay que hacer
#   git checkout origin/<rama> -- scripts/desplegar.sh
# y eso deja el archivo EN EL ÍNDICE, así que figura como cambio pendiente.
# Igual con cualquier otro que se baje del mismo modo — cuentas.js,
# cargar_saldo.js. Ninguno es un cambio hecho a mano: son exactamente lo que
# el checkout iba a dejar.
#
# La primera versión de esto excluía solo su propia ruta, y volvió a frenar
# el despliegue cuando alguien bajó cuentas.js del mismo modo. Excluir por
# nombre es tapar el síntoma; lo que corresponde es comparar contenidos.
#
# Un archivo cuyo contenido ya es idéntico al de la rama no se pierde con el
# checkout. Uno que difiere, sí — y ése es el que hay que mirar antes.
igual_a_la_rama() {
  local ruta="$1" enRama enDisco
  enRama="$(git rev-parse --verify --quiet "origin/$RAMA:$ruta" 2>/dev/null)" || return 1
  [ -f "$ruta" ] || return 1
  enDisco="$(git hash-object "$ruta" 2>/dev/null)" || return 1
  [ "$enRama" = "$enDisco" ]
}

SUCIO=""
IDENTICOS=0
while IFS= read -r linea; do
  [ -z "$linea" ] && continue
  # El formato de --porcelain son dos caracteres de estado, un espacio y la
  # ruta. Se sacan las comillas que git pone cuando el nombre las necesita.
  ruta="${linea:3}"
  ruta="${ruta%\"}"; ruta="${ruta#\"}"
  if igual_a_la_rama "$ruta"; then
    IDENTICOS=$((IDENTICOS + 1))
    continue
  fi
  SUCIO="${SUCIO}${linea}"$'\n'
done < <(git status --porcelain)

if [ -n "$SUCIO" ]; then
  rojo "❌ Estos archivos se perderían al pasar a $RAMA:"
  printf '%s' "$SUCIO"
  echo
  echo "   Su contenido NO es el de la rama, así que alguien los editó acá a"
  echo "   mano. Averiguá qué son ANTES de seguir; no los borres sin mirar."
  echo
  echo "   Si estás seguro de que se pueden descartar:"
  echo "     git stash push --include-untracked   # los guarda por si acaso"
  exit 1
fi
if [ "$IDENTICOS" -gt 0 ]; then
  verde "✅ Nada que perder ($IDENTICOS archivo(s) ya idénticos a la rama)"
else
  verde "✅ El árbol está limpio"
fi

paso "2. Respaldo"
echo "¿Ya hiciste el respaldo desde Panel → Seguridad y verificaste que quedó?"
read -r -p "Escribí SI para seguir: " RESPUESTA
[ "$RESPUESTA" = "SI" ] || { rojo "Cancelado. Hacé el respaldo primero."; exit 1; }
ls -lh backups/ 2>/dev/null | tail -3 || echo "(no hay carpeta backups/ acá)"

paso "3. Traer el código"
# El fetch ya se hizo arriba, para poder comparar el árbol contra la rama.
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
