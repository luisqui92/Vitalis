# Desplegar la rama de clínicas

Este despliegue es **grande**: 95 archivos, 29 del frontend. No es un parche.
Trae dos cosas que se pensaron por separado pero viajan juntas.

Leelo entero antes de tocar nada. Lleva unos 15 minutos.

---

## 1. Qué entra, exactamente

`clinica-multiconsultorio` está construida **encima** de `i18n-andamiaje`. No
son ramas independientes. Desplegar la clínica sube también el portugués.

| | Qué es | Riesgo |
|---|---|---|
| **i18n** (10 commits) | 29 archivos del frontend con los textos sacados a diccionarios | **Alto.** Toca casi toda la interfaz que ya funciona. |
| **Clínica** (5 commits) | Panel de administración, persona compartida, agenda unificada | **Bajo.** Todo código nuevo; un médico solo no lo ve. |

El riesgo real de este despliegue **no es la clínica: es el i18n**. La clínica
es código nuevo que nadie usa todavía. El i18n reescribió pantallas que hoy
usan médicos de verdad.

Faltan 12 archivos por convertir (Symphomed Face, crecimiento, neurodesarrollo,
embarazo, instrumentos y algunos más). **Eso no rompe nada**: esas pantallas
siguen en español, tal cual están hoy.

---

## 2. Qué NO hace falta

- **No hay variables de entorno nuevas.** El `.env` queda igual.
- **No hay migración de datos.** Los campos nuevos (`idioma`, `rol`,
  `vinculo`, `clinicaId`, `personaId`) tienen valor por defecto y las
  colecciones nuevas (`clinicas`, `personaclinicas`) se crean solas.
- **No hay que tocar nginx.** No hay rutas nuevas de nivel superior.

Lo de "no hay migración" está probado, no supuesto: la sección 9 de
`probar_clinica_integracion.js` inserta un médico **con el driver crudo, sin
pasar por el esquema** —exactamente como están los documentos de producción
hoy, sin ninguno de los campos nuevos— y verifica que inicia sesión, que le
toca español y no `undefined`, que sus rutas de siempre siguen abiertas y que
lo nuevo simplemente no le aparece.

---

## 3. Antes de tocar el servidor

Corré esto donde tengas el código. Todo tiene que dar verde.

```bash
node scripts/i18n_cobertura.js
for f in scripts/pruebas/probar_*.js; do echo "== $f"; node "$f" || break; done
```

Las dos que hacen falta contra una base de datos:

```bash
npm i --no-save mongodb-memory-server     # una sola vez
node scripts/pruebas/probar_clinica_integracion.js
node scripts/pruebas/probar_arranque.js
```

`probar_arranque.js` es el control más importante antes de desplegar: levanta
`index.js` de verdad y comprueba que **los paquetes de idioma se arman al
arrancar**. Están en `.gitignore`, así que en el servidor no existen hasta que
Symphomed los genera; si eso falla, la app queda desplegada sin un solo texto y
ninguna otra prueba lo ve.

---

## 4. El respaldo

**No sigas sin esto.** Es un despliegue grande y es lo único que hace que
volver atrás sea barato.

Con Symphomed todavía corriendo, entrá a **Panel → Seguridad** y apretá el
botón de hacer un respaldo a mano. Ahí mismo se ve cuándo fue, si pasó la
verificación y cuánto ocupa (ver `RESPALDOS.md`).

Después confirmalo en el disco:

```bash
cd ~/vitalis-app
ls -lh backups/ | tail -3
```

Mirá la fecha y el tamaño del último archivo antes de continuar. Un respaldo
que no miraste es un respaldo que no tenés.

Anotá también en qué commit está corriendo producción ahora, que es a donde
vas a volver si algo sale mal:

```bash
git rev-parse --short HEAD
```

---

## 5. El despliegue

```bash
cd ~/vitalis-app
git fetch origin
git checkout clinica-multiconsultorio
git pull origin clinica-multiconsultorio
npm install --omit=dev
pm2 restart vitalis --update-env
pm2 logs vitalis --lines 60
```

En los logs tenés que ver, **antes** de dar por buena la cosa:

```
[IDIOMAS] es (21 módulos, … KB) · pt (21 módulos, … KB)
✅ MongoDB conectado
🚀 Symphomed corriendo en puerto 3000
```

**Si no aparece la línea `[IDIOMAS]`, volvé atrás.** Significa que los
paquetes de idioma no se generaron y la interfaz va a salir sin textos.

---

## 6. Comprobar, con los ojos

En este orden. Los tres primeros son sobre lo que ya funcionaba: si algo se
rompió, se rompió ahí.

1. **Entrar con una cuenta que ya existía.** Tiene que quedar en español y
   verse igual que siempre.
2. **Abrir el Kardex de un paciente** y recorrer sus pestañas.
3. **Abrir la agenda y una consulta.**
4. Recién ahora: `/i18n/es.js` y `/i18n/pt.js` en el navegador — los dos
   tienen que devolver texto, y ser distintos entre sí.
5. Cambiar el idioma a portugués en Configuración, mirar dos o tres
   pantallas, y volver a español.

Si algo de 1 a 3 falla, volvé atrás y avisá. Eso es una regresión sobre lo
que ya funcionaba, que es lo único inaceptable acá.

---

## 7. Volver atrás

```bash
cd ~/vitalis-app
git checkout <el-commit-que-anotaste-en-el-paso-4>
npm install --omit=dev
pm2 restart vitalis --update-env
```

**Los datos no hay que revertirlos.** Nada de este despliegue borra ni
transforma nada existente: solo agrega campos con valor por defecto y
colecciones nuevas. Si volvés al código viejo, esos campos quedan ahí,
ignorados, y no molestan. Si después volvés a desplegar, siguen sirviendo.

La única excepción es si ya empezaste a usar la clínica: las personas
vinculadas (`personaId` en las fichas) quedan guardadas. El código viejo las
ignora, no las rompe.

---

## 8. Después, para poner en marcha la clínica

Ver `CLINICAS.md`. En resumen:

```bash
node scripts/crear_clinica.js "Nombre de la clínica" <telefonoAdmin>
# cada médico se registra él mismo, con su propia contraseña
node scripts/vincular_medico.js <telefonoAdmin> <telefonoMedico> [empleado|alquila] "Consultorio 3"
```

Y si esos médicos ya venían usando Symphomed por separado:

```bash
node scripts/proponer_personas.js <telefonoAdmin>            # solo mira
node scripts/proponer_personas.js <telefonoAdmin> --aplicar  # vincula los seguros
```

Corré primero sin `--aplicar` y leé la salida. Siempre.

---

## 9. Dos cosas para decidir antes de vender esto en Brasil

- **La zona horaria.** La agenda de la clínica usa el reloj del navegador,
  que para un mostrador adentro de la clínica es el correcto. Pero
  `public/js/agenda.js` sigue con `America/La_Paz` escrito a mano, y Brasil
  tiene tres husos.
- **La transcripción en portugués no la escuchó nadie todavía.** El idioma ya
  llega a todos lados —transcripción, vista previa en vivo, vocabulario y nota
  clínica—, pero eso solo demuestra que los parámetros viajan bien. Falta lo
  que ningún test puede dar: **5 audios reales de consultas en portugués** y
  **un médico brasileño que lea 5 notas clínicas** y diga si sirven.

  Y hay una limitación de fondo que no se arregla con código: el Medical Mode
  de AssemblyAI no cubre portugués, así que ahí no hay modelo afinado para
  medicamentos y dosis — solo el vocabulario que le pasamos. El vocabulario
  pt-BR de `services/assemblyai.js` está armado con nomenclatura DCB pero
  **todavía no lo revisó un médico brasileño**.

  Hasta que eso pase, lo honesto con los médicos de Brasil es: la interfaz ya
  está en portugués, la transcripción la estamos afinando.
