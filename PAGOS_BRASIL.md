# Cobrar en Brasil

## Dónde estamos

**Resuelto: la clave Pix de Takenos está de baja.** Se comprobó pegándola
suelta en un banco — no devuelve titular, así que no existe en DICT. No es la
clave mal copiada ni un problema del generador: no hay cuenta del otro lado.

Cómo se llegó acá: un pago de prueba de R$ 1,00 falló. Un banco dijo "erro ao
processar o pagamento" y otro, más preciso, "conta de destino não foi
encontrada". El segundo mensaje es de **DICT**, el directorio de claves Pix del
Banco Central, y ocurre *antes* de mirar el monto, el txid o el formato del
código. `scripts/pruebas/probar_pix.js` reproduce carácter por carácter, CRC
incluido, un QR que un banco brasileño ya aceptó, así que el generador estaba
descartado desde el principio.

No se puede consultar DICT desde el servidor: hace falta ser participante del
SPI. Por eso esta comprobación la hizo una persona con un banco en la mano, y
por eso hay que repetirla con la clave que reemplace a esta **antes** de
ponerla en producción. Que un QR se dibuje no dice absolutamente nada.

### Lo urgente, antes de elegir reemplazo

**Hay que vaciar la clave Pix cargada.** Mientras siga ahí, Symphomed le sigue
armando el QR a cualquier médico brasileño que entre a pagar: el único guardia
es `if (!datos?.cuenta)` en `routes/recargas.js`, que comprueba que el campo no
esté vacío, no que la clave exista.

Una clave muerta es peor que ninguna. Sin clave, la pantalla dice "todavía no
está cargada la clave Pix, escribinos" y el médico escribe — y nos enteramos.
Con la clave muerta, el médico ve un QR normal, lo escanea, y el error se lo da
su banco: nosotros no nos enteramos nunca, y él se queda pensando que el
producto no funciona.

Se vacía desde la pantalla de Pagos, dejando en blanco el campo de la clave
para Brasil. No hace falta tocar el servidor ni desplegar nada.

Queda una pregunta abierta para cuando haya reemplazo: ese guardia no distingue
"nunca se configuró" de "se configuró y se dio de baja", y son dos mensajes
distintos para el médico. Hoy no hay forma automática de distinguirlos —nadie
puede consultar DICT desde acá— así que si se quiere, tiene que ser una marca
que ponga a mano quien comprobó la clave.

## Estático y dinámico no son dos caminos alternativos

Conviene tenerlo claro porque es contraintuitivo:

- **QR estático** — texto puro con formato EMV. Lleva la clave Pix adentro.
  Se genera sin depender de nadie, y es lo que hace `services/pix.js`. Sirve
  para cobrar cualquier monto, siempre que del otro lado haya una clave
  **permanente** de una cuenta propia.
- **QR dinámico** — NO lleva la clave: lleva una URL. El banco del pagador
  entra a esa URL por mTLS y recibe el cobro firmado. Esa URL la hospeda un
  PSP; no hay forma de generarla por cuenta propia.

Es decir: el dinámico **exige más** que el estático, no menos. Si hay un PSP
con API Pix, el estático que ya está construido también funciona.

## Por qué igual conviene un PSP

No por el QR — por el **webhook**.

Hoy, cuando un médico paga, alguien tiene que mirar el extracto y acreditar a
mano desde el panel del operador. Un PSP con API Pix avisa cuando entra la
plata, y ahí Symphomed puede acreditar sola contra el `txid` que ya emitimos en
`routes/recargas.js`. Ese es el problema que no escala; el del QR es de una
sola vez.

Ojo con una deuda que hay que saldar antes: hoy el `txid` se genera y se le
manda al médico, **pero no se guarda**. Sin persistirlo contra la
`SolicitudRecarga`, ningún webhook va a poder saber de quién fue el pago.

## Elegir PSP

La pregunta que decide todo es si hay **CNPJ en Brasil**. Casi todos lo
exigen; sin eso, el bloqueo no es técnico y ningún código lo salta.

| PSP | Autenticación | Notas |
|---|---|---|
| Mercado Pago | API key | Alta rápida, sin certificado |
| Asaas | API key | Para PYME, Pix + boleto |
| Woovi / OpenPix | API key | Amigable para desarrollador, capa gratuita |
| Efí (ex-Gerencianet) | mTLS + certificado | Muy sólido para Pix |
| Banco do Brasil, Itaú, Sicoob | mTLS + certificado | Conviene solo con cuenta PJ ya abierta |

## Cuando se elija uno

El estático seguirá siendo el plan B: si el PSP se cae, se puede cobrar igual
con la clave permanente. Por eso conviene que la emisión del cobro quede
detrás de una interfaz —crear cobro, consultar estado— y no que el código del
PSP se meta directo en `routes/recargas.js`.

Lo que hay que construir, en orden:

1. Guardar el `txid` en la `SolicitudRecarga` al emitir el cobro.
2. Interfaz de cobro con dos implementaciones: la estática de hoy y la del PSP.
3. Webhook que acredite contra el libro mayor, **idempotente** — el mismo aviso
   puede llegar dos veces, y acreditar dos veces es plata regalada. El candado
   va en un índice único, no en un `if`.
4. Conciliación: qué hacer con un pago que llega sin `txid` conocido.
