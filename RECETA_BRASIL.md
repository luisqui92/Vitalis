# Recetar en Brasil — Memed

## Por qué existe esto

La receta de Symphomed es un documento que se imprime. En Bolivia alcanza. En
Brasil no: una prescripción necesita **firma digital ICP-Brasil**, y sin ella
no es una receta, es un papel.

Memed emite con esa firma. Por eso en cuentas brasileñas la receta de Symphomed
**no convive** con la de Memed: desaparece de la pantalla. Dos botones de
recetar —uno con validez legal y otro sin ella— es una trampa esperando a que
alguien apurado use el equivocado.

## Qué cuesta

Nada, para nadie:

| | |
|---|---|
| Recetar | Gratis para el médico |
| Firma digital | Gratis (Memed la da junto con Soluti) |
| Uso de la API | Sin costo para el integrador |
| Llaves de prueba | Públicas, en su documentación |

Lo único pago que encontramos es mandar la receta por **WhatsApp Business**
(desde R$ 59,90/mes), y no hace falta: Symphomed ya manda por WhatsApp.

## Las llaves

```bash
MEMED_API_KEY=...
MEMED_SECRET_KEY=...
```

**De prueba** (públicas, sirven para desarrollar — recetas sin validez legal):
http://doc.memed.com.br/docs/primeiros-passos/

**De producción**: se piden en https://memed.com.br/parceiro-software/ con el
formulario *"Quero ser um parceiro Memed"*, y las entregan después de una
**validación técnica** de la integración. Eso no se programa: hay que pedirlo.

Cuando lleguen, se cambian esas dos variables y nada más.

Hay dos más, opcionales:

| Variable | Para qué |
|---|---|
| `MEMED_SCRIPT_URL` | El módulo del navegador, si cambia de dominio |
| `MEMED_DOMINIOS_EXTRA` | Dominios extra para la CSP, separados por coma |

`MEMED_DOMINIOS_EXTRA` existe por un motivo concreto: si su módulo pide un
dominio que no está en la documentación, **el síntoma es una pantalla en
blanco sin ningún error**. Con esa variable se destraba sin desplegar.

## Probarlo

```bash
cd ~/vitalis-app
nano .env                      # las dos llaves
pm2 restart vitalis --update-env
```

Hace falta una cuenta con `moneda: BRL`. La demo brasileña la tiene:

```bash
node scripts/seed_brasil_demo.js 11987650001
```

Después, dentro de Symphomed:

1. **Configuración → Consejo profesional**: sigla (CRM/CRO…), estado y número.
   El estado es **el del consejo, no el del domicilio** — es el error más
   fácil de cometer y no se nota hasta que una receta sale con el registro de
   otro estado.
2. **Ficha de un paciente → 🪪**: cargar el CPF. Sin CPF, Memed no puede
   identificar al paciente.
3. **Pestaña Recetas → Recetar**: se abre el módulo de Memed con el paciente
   cargado.

Al emitir, la receta vuelve sola al Kardex con la etiqueta **Firmada**.

## Qué hace Symphomed y qué hace Memed

Symphomed **no tiene** base de medicamentos, ni firma, ni pantalla de recetar.
La integración son cuatro cosas:

1. `POST integrations.api.memed.com.br/v1/sinapse-prescricao/usuarios` — da de
   alta al médico y recibe **su** token. Las llaves nunca salen del servidor.
2. Carga el script de Memed con ese token.
3. `MdHub.command.send("setPaciente")` + `MdHub.module.show()` — les pasa el
   paciente y abre **su** pantalla.
4. Escucha su evento `prescricaoImpressa` para copiar la receta al Kardex.

La receta firmada **queda en Memed**. Symphomed guarda la referencia y una copia
de los medicamentos —que son dato clínico, y los necesitan el hilo clínico y
el brief— pero el documento legal no es suyo y no finge serlo. Por eso cada
receta lleva `origen` guardado: dentro de un año nadie va a poder decir cuál
tenía firma mirando los medicamentos.

## Si algo no anda

| Lo que se ve | Qué pasa |
|---|---|
| No aparece el botón de recetar | La cuenta no tiene `moneda: BRL` |
| "Falta tu consejo profesional" | Cargarlo en Configuración |
| "Falta el CPF del paciente" | Cargarlo en la ficha (🪪) |
| "Todavía no está habilitada en este servidor" | Faltan las llaves en el `.env` |
| La pantalla queda **en blanco** | La CSP está bloqueando un dominio de Memed → `MEMED_DOMINIOS_EXTRA` |

Y ante cualquier rechazo de ellos, el log tiene la respuesta **entera**:

```
[MEMED] alta de <teléfono> falló (400): {...lo que contestaron...}
```

Eso está a propósito: la integración se escribió leyendo la documentación de
Memed, no ejecutándola —su ambiente de pruebas contestaba 503—, así que el
primer uso real es lo que va a decir la verdad.
