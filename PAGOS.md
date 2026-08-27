# Los pagos en Vitalis

Cómo entra la plata, quién la aprueba y desde qué cuenta. Con el porqué de
cada regla, para que nadie las deshaga sin querer.

---

## 1. La idea en una frase

Vitalis es **prepago**: el médico carga saldo, y cada consulta completada le
descuenta **Bs 12**. No hay factura a fin de mes ni corte de servicio a mitad
de una consulta.

---

## 2. El circuito, de punta a punta

1. El médico entra a **Configuración**, y en la tarjeta de su saldo ve **dónde
   pagar**: el QR, el banco, la cuenta y el titular.
2. Paga **por fuera de Vitalis** (QR o transferencia).
3. Vuelve y **avisa**: "pagué Bs 200, referencia X". Eso crea una **solicitud
   pendiente**. **No mueve un centavo.**
4. Al operador le llega una **notificación**, y el aviso aparece en su
   **panel de Pagos** con un globito con los pendientes.
5. El operador **lo verifica en el extracto del banco** y aprueba o rechaza.
6. Recién al aprobar **se acredita**.

### Las tres reglas que sostienen esto

**Avisar no es pagar.** Una solicitud es la *palabra* del médico. Si pudiera
acreditarse sola —o "automáticamente si pasan 24 horas"— cualquiera se
cargaría saldo escribiendo un número en un formulario.

**Se acredita lo que vio el operador, no lo declarado.** Si el médico declaró
Bs 300 y en el banco entraron Bs 250, se acreditan 250. Confiar en el número
declarado es dejar que el médico se ponga su propio saldo con un paso extra.

**Una captura de pantalla no prueba nada.** Se falsifica en dos minutos y
quien la mira no tiene cómo notarlo. Lo único que prueba que el dinero entró
es verlo en el extracto. Por eso no se sube el comprobante: guardarlo daría
una sensación de control que no existe.

---

## 3. Qué NO corta el saldo

Una consulta empezada **se termina siempre**, aunque el saldo se acabe en el
medio. El saldo puede quedar en negativo hasta **Bs −60** (cinco consultas).
Cortar una grabación a mitad de una consulta real es perder trabajo clínico
para cobrar Bs 12; no vale el cambio.

El aviso de saldo bajo aparece **antes de grabar**, que es el único momento en
que el médico todavía puede hacer algo.

---

## 4. Quién puede aprobar pagos

**El permiso no está en la base de datos. Está en el `.env`.**

```
OPERADORES_SALDO=62741818
```

Si viviera en Mongo, cualquiera que consiga escribir ahí —o cualquier futuro
bug de escalada de privilegios— se haría operador solo. Estando en el
entorno, para dárselo hay que tener acceso al servidor, que es exactamente el
nivel que corresponde para **crear dinero**.

Además de estar en esa lista hacen falta otras dos cosas:

- **Segundo factor obligatorio.** Sin 2FA activo, las rutas de operador no le
  responden. Una cuenta que emite saldo sin 2FA está a un phishing de
  distancia de emitirlo para otro.
- **Todo queda auditado** con el teléfono de quien acreditó.

A quien no es operador se le contesta **404, no 403**: no se le confirma que
la pantalla existe.

---

## 5. Dos formas de tener un operador

### a) La cuenta del dueño (lo que hay hoy)

Una cuenta de médico que además está en `OPERADORES_SALDO`. Atiende pacientes
**y** aprueba pagos, incluidos los suyos. Mientras el operador sea el dueño,
es cómodo y no hay a quién engañar.

### b) Una cuenta que **solo** administra pagos

El día que entra otra persona a manejar cobranzas, conviene que **quien maneja
la plata no sea el mismo que la gasta**. Para eso existe una cuenta
administrativa: `rol: "admin"`, sin clínica, sin pacientes.

```
node scripts/crear_operador.js 71234567 "María Pagos"
```

Esa cuenta:

- **no abre ninguna historia clínica** — las 30 rutas clínicas la rechazan
  solas, por el mismo `requireAuth(["medico"])` que ya tenían;
- **no consume saldo**, porque no atiende;
- **no puede aprobar sus propias recargas**, porque no tiene ninguna.

Lo único que ve al entrar es el panel de Pagos.

Crear la cuenta **no le da el permiso**. Faltan los dos pasos de siempre:

```
# 1. sumarla a la lista y reiniciar
nano ~/vitalis-app/.env      # OPERADORES_SALDO=62741818,71234567
pm2 restart vitalis

# 2. que entre con ese teléfono y active el 2FA en Configuración
```

---

## 6. Dónde se cambian los datos bancarios

**Desde la pantalla, no por SSH.** Panel de Pagos → *Dónde nos pagan*. Se
guarda quién los cambió y cuándo.

Cambiar ese número desvía **todos los pagos futuros**, así que solo lo puede
hacer un operador, con 2FA, y queda auditado. El QR se toma de
`public/pago-qr.jpg`.

---

## 7. Precio y mínimo, si hay que moverlos

```
PRECIO_CONSULTA_CENTAVOS=1200    # Bs 12 por consulta
RECARGA_MINIMA_CENTAVOS=10000    # Bs 100 mínimo de recarga
```

El mínimo es para el médico al avisar. Del lado del operador hay un
`--igual`: **un mínimo que rechaza plata que ya entró no es un mínimo, es
quedársela.** Si alguien pagó Bs 50, se le acredita Bs 50.

---

## 8. El libro mayor

Cada movimiento queda en `MovimientoSaldo`: cargas, consumos, ajustes y
devoluciones, con el saldo que quedó después de cada uno. El saldo guardado en
`Medico.saldoCentavos` es una **comodidad**, no la verdad — se puede
reconstruir sumando los movimientos, y por eso un cobro se puede discutir en
vez de tener que creernos.

Un consumo se cobra **una sola vez por consulta**, y no lo garantiza un `if`
—que se puede correr dos veces a la vez— sino un **índice único** en la base.
