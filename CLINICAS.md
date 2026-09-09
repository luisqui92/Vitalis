# Symphomed para clínicas

Cómo poner en marcha una clínica de varios consultorios, qué ve cada quien y
qué decisiones ya están tomadas (con el porqué, para que nadie las deshaga
sin querer).

---

## 1. La idea en una frase

Un médico solo usa Symphomed igual que siempre y no ve nada de esto. Una
clínica suma dos cosas encima: **un panel para quien administra** y **una
persona compartida entre los consultorios**.

Lo que NO suma: nadie pasa a ver la historia clínica de nadie. Ni el
administrador, ni el director, ni el colega del consultorio de al lado.

---

## 2. Los tres roles

| Rol | Atiende pacientes | Ve el panel de la clínica |
|---|---|---|
| `medico` | sí | no |
| `admin` | **no** | sí |
| `director` | sí | sí |

El **rol** es lo que abre las rutas clínicas; la bandera `admin` del token es
lo que abre `/admin`. Un administrativo tiene `rol: "admin"`, así que el
`requireAuth(["medico"])` que ya protegía las 30 rutas clínicas lo rechaza
solo — no hizo falta agregar un chequeo nuevo en ninguna.

Un **director** es médico Y administra: ve sus propios pacientes como
cualquier médico, y los números de la clínica como admin. Eso **no** le da
acceso a las fichas de sus colegas.

---

## 3. Los dos vínculos

| Vínculo | Qué ve el panel |
|---|---|
| `empleado` | ocupación de la sala, números **y facturación** |
| `alquila` | ocupación de la sala. **La plata no.** |

El que alquila el consultorio factura por su cuenta: esa plata no es de la
clínica, y mostrarla sería enseñarle al dueño del local cuánto gana su
inquilino. El panel dice cuántos quedaron afuera del total, porque un número
que no cierra sin explicación hace dudar del sistema entero.

La misma línea separa la agenda: del médico empleado sale el nombre del
paciente (la clínica lo recibe en la puerta y le cobra, ya sabe quién es); del
que alquila, la hora figura ocupada y sin nombre.

Si un médico se va, se lleva sus fichas enteras. Nunca dejaron de ser suyas.

---

## 4. Puesta en marcha

Todo se corre desde el servidor, en el directorio de la app.

### 4.1 Crear la clínica y su administrador

```bash
node scripts/crear_clinica.js "Clínica San Rafael" 78811000 [password] [--rol director]
```

- `78811000` es el teléfono de quien va a administrar.
- Sin `password`, genera una y la imprime **una sola vez**.
- `--rol director` si esa persona además atiende pacientes.
- Es idempotente: si ya existen, no los duplica ni le pisa la contraseña a
  nadie.

### 4.2 Que cada médico se registre

**Cada médico se registra él mismo, con su propia contraseña.** El
administrador no le pone la contraseña a nadie y nunca la ve. Es el registro
de siempre, en la pantalla de siempre.

### 4.3 Sumarlos a la clínica

Desde el panel (`Clínica` → *Sumar un médico*), o por línea de comandos:

```bash
node scripts/vincular_medico.js <telefonoAdmin> <telefonoMedico> [empleado|alquila] ["Consultorio 3"]
```

Desde el panel también se corrige después: cada fila tiene **Editar** para
cambiar el consultorio o el vínculo, y **Sacar de la clínica**.

### 4.4 Unir las fichas que son la misma persona

Solo si los médicos ya venían usando Symphomed por separado y ahora se juntan.

```bash
node scripts/proponer_personas.js <telefonoAdmin>              # solo mira
node scripts/proponer_personas.js <telefonoAdmin> --aplicar    # vincula los SEGUROS
```

**Este script propone; no decide.** Vincular dos fichas que son de dos
personas distintas fusiona dos historias clínicas, y el segundo Juan Pérez
hereda las alergias del primero. No tiene vuelta atrás.

Por eso "seguro" es una definición estrecha a propósito: hace falta el nombre
**más** la fecha de nacimiento, o el nombre **más** el teléfono. **El nombre
solo nunca alcanza.** Todo lo demás queda listado para que lo mire una
persona, y se vincula desde el Kardex de cada ficha.

Corré primero sin `--aplicar` y leé la salida. Siempre.

---

## 5. La persona compartida

Cuando un médico da de alta un paciente, Symphomed mira si esa persona ya viene
a la clínica por otro consultorio y lo ofrece. **Nunca vincula solo**, y lo
confirma el médico.

Lo que cruza consultorios:

- **Identidad**: nombre, nacimiento, sexo, teléfono, documento.
- **Alergias**: lo único clínico que se comparte, y es por seguridad del
  paciente — que el odontólogo no le recete amoxicilina a alguien alérgico a
  la penicilina porque esa alergia estaba anotada en la ficha del clínico.
  Una alergia dice qué **no** darle, no qué tiene.

Lo que **no** cruza: todo lo demás. Consultas, diagnósticos, recetas, fotos,
estudios, notas.

Y tampoco cruza **quién la atiende**. La ficha dice "la ven en 3
consultorios", nunca en cuáles: saber que la ven en varios le dice al médico
que pregunte; saber en cuáles sería decirle qué especialistas consulta, que no
es asunto suyo. Por lo mismo, de una alergia cargada por otro se muestra la
fecha y "desde otro consultorio de la clínica" — no quién.

Las alergias solo las puede editar un médico que **atiende** a esa persona.
Estar en la clínica no alcanza.

---

## 6. Lo que el panel no hace, a propósito

No devuelve una sola línea de historia clínica. Cuenta consultas; no las lee.

La garantía es estructural, no una lista de cuidados: las consultas de
`routes/admin.js` usan `countDocuments()` y `aggregate()` con `$group`.
Ninguna hace `.find()` sobre una colección clínica, y hay una prueba que
falla si alguna aparece.

La única excepción es el nombre del paciente en la agenda del día, y solo de
los médicos empleados. Un nombre y una hora son identidad y asistencia, no
historia clínica: el **por qué** viene no aparece para nadie — el motivo de
consulta lo escribe el paciente al reservar y suele ser clínico.

Si mañana hace falta que un director vea la ficha de un colega, eso es una
**interconsulta** —con motivo y auditada—, no un permiso general del panel.

---

## 7. Las pruebas

```bash
node scripts/pruebas/probar_permisos_clinica.js   # permisos y estructura
node scripts/pruebas/probar_personas.js           # la persona compartida
node scripts/pruebas/probar_carga.js              # que las pantallas no exploten
```

Y la que corre contra una base de datos de verdad:

```bash
MONGO_PRUEBAS="mongodb://localhost:27017/vitalis_prueba" \
  node scripts/pruebas/probar_clinica_integracion.js
```

Levanta las rutas reales contra una base descartable, arma una clínica de
tres consultorios más otra clínica aparte, y verifica más de cincuenta cosas:
que los números salgan, que una clínica no vea nada de la otra, que el motivo
y el teléfono no viajen en la agenda, que el índice único impida la doble
reserva pero deje existir una cancelada en el mismo horario.

**Se niega a correr** contra una base cuyo nombre no diga `prueba` o `test`, y
contra la `MONGODB_URI` de la aplicación. Borra lo que toca.

Sin Mongo instalado: `npm i --no-save mongodb-memory-server` (queda fuera de
`package.json` porque se baja un binario de 120 MB, y el servidor de
producción no tiene por qué pagarlo en cada despliegue).

---

## 8. Pendientes conocidos

- **Zona horaria.** La agenda de la clínica usa el reloj del navegador, que
  para un mostrador adentro de la clínica es el correcto. Pero
  `public/js/agenda.js` todavía tiene `America/La_Paz` escrito a mano, y
  Brasil tiene tres husos. Hay que resolverlo antes de vender esto allá.
- **Crear la clínica sigue siendo por línea de comandos.** Es una operación
  de alta que hacemos nosotros una vez; el resto ya está en el panel.
- **No hay una segunda persona administradora desde el panel**: promover a
  alguien a `admin` o `director` se hace con `crear_clinica.js`.
