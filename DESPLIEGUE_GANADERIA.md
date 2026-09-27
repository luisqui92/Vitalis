# Desplegar Ganadería (y lo que venía detrás)

Producción se actualiza con `git pull origin claude/best-voice-transcription-api-536z7k`.
El último pull confirmado fue `fdc89b4`. Desde ahí la rama trae **22 commits**:
9 de antes de Ganadería (olvidé mi contraseña, foto de perfil, recordatorio de
medicación, ofuscar el JS, corregir moneda…) y 13 de Ganadería.

Todo lo que se describe acá **se ensayó** en una copia: un repositorio parado
en el commit de producción, con `public/js/` ya ofuscado, al que se le aplicaron
exactamente estos comandos. También se ensayó volver atrás.

---

## Lo que cambia respecto de un pull de siempre

**El JS ofuscado bloquea el pull.** `node scripts/ofuscar.js` reescribe
`public/js/` en el lugar. Git ve esos 60 y pico archivos como modificados, y el
próximo `git pull` se niega: *"Your local changes would be overwritten"*. Por
eso, antes del pull, se devuelven esos archivos a su versión del repositorio
(`git checkout -- public/js`) y después del pull se vuelven a ofuscar. No se
pierde nada: son archivos generados.

**No hay variables de entorno nuevas, ni migración, ni cambios en nginx.**
Las colecciones de Ganadería se crean solas y sus índices se arman al
arrancar. Los campos nuevos tienen valor por defecto. Ningún documento
existente se modifica.

---

## Paso 1 — Mirar (no cambia nada)

```bash
cd ~/vitalis-app
git log --oneline -1
git status --short | grep -v ' public/js/'
echo "ofuscados: $(git status --short | grep -c ' public/js/')"
```

- La primera línea es el commit de producción. **Anotalo**: es a donde se vuelve.
- La segunda tiene que salir **vacía**. Si muestra algún archivo, alguien tocó
  algo a mano en el servidor: pará y avisá antes de seguir.

## Paso 2 — Respaldo (no sigas sin esto)

```bash
cd ~/vitalis-app
git fetch origin claude/best-voice-transcription-api-536z7k
git show FETCH_HEAD:scripts/respaldar_ahora.js > scripts/_respaldo_antes.js
node scripts/_respaldo_antes.js ; rm -f scripts/_respaldo_antes.js
```

Tiene que terminar con `✅` y `verificado restaurándolo: SÍ`. Si dice ❌, no
sigas. (Es el mismo respaldo diario de `services/backup.js`, hecho a mano.)

## Paso 3 — Actualizar

```bash
cd ~/vitalis-app
git checkout -- public/js
git pull --ff-only origin claude/best-voice-transcription-api-536z7k
npm install --omit=dev
node scripts/ofuscar.js
pm2 restart all
```

`--ff-only`: si por algún motivo el servidor no puede avanzar en línea recta,
se detiene sin mezclar nada. `git log --oneline -1` tiene que decir el commit
de la rama (`Ganadería: …`). `ofuscar.js` tiene que decir `0 fallido(s)`.

## Paso 4 — Comprobar

```bash
sleep 5
curl -s http://localhost:3000/health ; echo
curl -s -o /dev/null -w "campo-sw: %{http_code}\n" http://localhost:3000/campo-sw.js
pm2 logs --lines 80 --nostream | grep -E "IDIOMAS|MongoDB|puerto|ERROR|Error"
```

Tiene que decir `{"ok":true,…}`, `campo-sw: 200`, la línea `[IDIOMAS] es (…) · pt (…)`,
`MongoDB conectado` y `corriendo en puerto`. Si aparece `[IDIOMAS]` faltando o
un error al arrancar: paso 5.

Con los ojos, en este orden (lo que ya funcionaba primero):

1. Entrar con una cuenta de medicina humana que ya existía, abrir el Kardex de
   un paciente y la agenda.
2. Entrar con una cuenta veterinaria: aparece **Ganadería** en el menú. Crear
   una finca y un lote de prueba.

## Paso 5 — Volver atrás (solo si algo del punto 1 falla)

```bash
cd ~/vitalis-app
git checkout -- public/js
git reset --hard <el-commit-que-anotaste-en-el-paso-1>
node scripts/ofuscar.js
pm2 restart all
```

Los datos no se tocan: lo de Ganadería queda guardado en sus colecciones y el
código viejo lo ignora. Si después se vuelve a desplegar, sigue ahí.

---

## Después del despliegue

- **Plantillas de WhatsApp** (`WHATSAPP_PLANTILLAS.md`): `retiro_ganado_registrado`,
  `retiro_ganado_libre` y `acceso_finca` hay que darlas de alta en Meta. Mientras
  no estén aprobadas, esos mensajes salen solo si la persona le escribió al
  WhatsApp de Symphomed en las últimas 24 h; el enlace de acceso del dueño igual
  le queda al veterinario para mandarlo a mano.
- **Revisión veterinaria**: gestación, umbrales de alertas y esquemas de vacunas
  son de referencia general y cambian por país. Antes de venderlo como producto,
  que los mire un veterinario.
