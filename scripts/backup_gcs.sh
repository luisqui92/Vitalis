#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

accion="${1:-}"
archivo="${2:-}"
nombre="${3:-}"
bucket="${BACKUP_GCS_BUCKET:-}"
prefijo="${BACKUP_GCS_PREFIJO:-symphomed}"

fallar() {
  printf '%s\n' "backup_gcs: $*" >&2
  exit 1
}

[[ "$accion" == "subir" || "$accion" == "verificar" ]] || fallar "acción inválida"
[[ -n "$archivo" && -f "$archivo" ]] || fallar "archivo local inexistente"
[[ -n "$nombre" && "$nombre" == "$(basename -- "$nombre")" ]] || fallar "nombre de objeto inválido"
[[ "$nombre" != "." && "$nombre" != ".." ]] || fallar "nombre de objeto inválido"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$ ]] || fallar "BACKUP_GCS_BUCKET inválido"
[[ "$prefijo" =~ ^[A-Za-z0-9._/-]+$ ]] || fallar "BACKUP_GCS_PREFIJO inválido"
prefijo="${prefijo#/}"
prefijo="${prefijo%/}"
[[ -n "$prefijo" && "$prefijo" != *".."* ]] || fallar "BACKUP_GCS_PREFIJO inválido"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
destino="gs://${bucket}/${prefijo}/${nombre}"

case "$accion" in
  subir)
    gcloud storage cp --no-clobber "$archivo" "$destino"
    ;;
  verificar)
    temporal="$(mktemp)"
    trap 'rm -f -- "$temporal"' EXIT
    gcloud storage cp "$destino" "$temporal"
    cmp -s -- "$archivo" "$temporal" || fallar "la copia externa no coincide con el archivo local"
    ;;
esac
