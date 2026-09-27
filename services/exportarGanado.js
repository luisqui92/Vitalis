// Symphomed Ganadería — La planilla de Excel de una finca o de un lote.
//
// Para qué la quieren: el contador del productor, el banco que le pide los
// números para un crédito, el SENASAG / la inspección que pide los registros
// sanitarios, o el veterinario que arma su propio informe. Por eso:
//
//   · UNA HOJA POR COSA, con una fila por registro y una columna «Lote»:
//     así se filtra y se arma una tabla dinámica sin copiar nada a mano.
//   · FECHAS Y NÚMEROS DE VERDAD (services/xlsx.js), no texto: sumar la
//     columna de litros tiene que funcionar.
//   · LO CALCULADO SE CALCULA IGUAL QUE EN PANTALLA: mortalidad, retiros,
//     calendario, % de postura, costo por litro — con las mismas funciones
//     de services/, no con una segunda versión que algún día diga otra cosa.
//   · EN EL IDIOMA DE LA CUENTA: la planilla la lee alguien en Bolivia o en
//     Brasil, y los encabezados tienen que decirle algo.
const {
  Finca, LoteGanado, EventoLote, RegistroProduccion, GastoLote, AnimalGanado, EventoReproductivo,
} = require("../db/models");
const { mortalidadAcumulada, retirosVigentes } = require("./lotesGanado");
const { calendarioLote } = require("./esquemaGanado");
const { resumenProduccion } = require("./produccion");
const { resumenCostos } = require("./costos");
const { resumenHembra } = require("./reproduccion");
const { TIPO_PRODUCCION } = require("./cargasGanado");
const { generarXlsx } = require("./xlsx");

// ─── Textos ────────────────────────────────────────────────────────────────
const TEXTOS = {
  es: {
    hoja: { lotes: "Lotes", eventos: "Sanidad y eventos", produccion: "Producción", gastos: "Gastos", animales: "Animales", repro: "Reproducción", calendario: "Calendario sanitario" },
    col: {
      lote: "Lote", codigo: "Código", nombre: "Nombre", finca: "Finca", especie: "Especie", proposito: "Propósito", estado: "Estado",
      ingreso: "Fecha de ingreso", edadIngreso: "Edad al ingreso (días)", iniciales: "Animales al ingreso", actuales: "Animales actuales",
      muertes: "Muertes", mortalidad: "Mortalidad %", libreLeche: "Leche en retiro hasta", libreCarne: "Carne en retiro hasta",
      vacunasPendientes: "Vacunas pendientes o vencidas", gastoTotal: "Gasto total", costoAnimal: "Costo por animal",
      conversion: "Conversión alimenticia", prom7: "Producción promedio últimos 7 días", cierre: "Fecha de cierre", motivoCierre: "Motivo de cierre",
      fecha: "Fecha", tipo: "Tipo", causa: "Causa", producto: "Producto", dosis: "Dosis", via: "Vía", aplicados: "Animales tratados",
      retiroCarneDias: "Retiro carne (días)", retiroLecheDias: "Retiro leche (días)", pesoKg: "Peso promedio (kg)", muestra: "Animales pesados",
      notas: "Notas", anotadoPor: "Anotado por", dia: "Día", cantidad: "Cantidad", unidad: "Unidad", animales: "Animales",
      porAnimal: "Por animal (L/vaca o % postura)", enRetiro: "En retiro", categoria: "Categoría", detalle: "Detalle", monto: "Monto",
      moneda: "Moneda", kg: "Kg de alimento", identificador: "Identificador", raza: "Raza", nacimiento: "Nacimiento", activa: "Activa",
      prenez: "Preñez", lactando: "Lactando", ultimoServicio: "Último servicio", ultimoParto: "Último parto", partoProbable: "Parto probable",
      diasAbiertos: "Días abiertos", baja: "Baja", motivoBaja: "Motivo de baja", animal: "Animal", metodo: "Método", reproductor: "Reproductor", resultado: "Resultado",
      criasVivas: "Crías vivas", criasMuertas: "Crías muertas", criasDestetadas: "Crías destetadas", vacuna: "Vacuna",
      desde: "Aplicar desde", hasta: "Aplicar hasta", ultima: "Última aplicación", proxima: "Próxima",
    },
    especie: { bovino: "Bovino", porcino: "Porcino", avicola: "Avícola" },
    estadoLote: { activo: "Activo", cerrado: "Cerrado" },
    tipoEvento: { mortalidad: "Mortalidad", vacunacion: "Vacunación", tratamiento: "Tratamiento", pesaje: "Pesaje" },
    tipoRepro: { servicio: "Servicio", diagnostico: "Diagnóstico de preñez", parto: "Parto", aborto: "Aborto", destete: "Destete", secado: "Secado" },
    categoria: { alimento: "Alimento", sanidad: "Sanidad", mano_obra: "Mano de obra", compra_animales: "Compra de animales", otros: "Otros" },
    unidad: { leche: "litros", huevos: "huevos" },
    prenez: { vacia: "Vacía", servida: "Servida", prenada: "Preñada" },
    metodo: { monta: "Monta", inseminacion: "Inseminación" },
    resultado: { prenada: "Preñada", vacia: "Vacía" },
    estadoCal: { pendiente: "Pendiente", vencida: "Vencida", perdida: "Perdida", al_dia: "Al día", futuro: "Más adelante", sin_edad: "Falta la edad del lote", campana: "Campaña oficial" },
    si: "Sí", no: "No", dueno: "(dueño)",
  },
  pt: {
    hoja: { lotes: "Lotes", eventos: "Sanidade e eventos", produccion: "Produção", gastos: "Gastos", animales: "Animais", repro: "Reprodução", calendario: "Calendário sanitário" },
    col: {
      lote: "Lote", codigo: "Código", nombre: "Nome", finca: "Fazenda", especie: "Espécie", proposito: "Finalidade", estado: "Situação",
      ingreso: "Data de entrada", edadIngreso: "Idade na entrada (dias)", iniciales: "Animais na entrada", actuales: "Animais atuais",
      muertes: "Mortes", mortalidad: "Mortalidade %", libreLeche: "Leite em carência até", libreCarne: "Carne em carência até",
      vacunasPendientes: "Vacinas pendentes ou vencidas", gastoTotal: "Gasto total", costoAnimal: "Custo por animal",
      conversion: "Conversão alimentar", prom7: "Produção média últimos 7 dias", cierre: "Data de encerramento", motivoCierre: "Motivo do encerramento",
      fecha: "Data", tipo: "Tipo", causa: "Causa", producto: "Produto", dosis: "Dose", via: "Via", aplicados: "Animais tratados",
      retiroCarneDias: "Carência carne (dias)", retiroLecheDias: "Carência leite (dias)", pesoKg: "Peso médio (kg)", muestra: "Animais pesados",
      notas: "Notas", anotadoPor: "Anotado por", dia: "Dia", cantidad: "Quantidade", unidad: "Unidade", animales: "Animais",
      porAnimal: "Por animal (L/vaca ou % postura)", enRetiro: "Em carência", categoria: "Categoria", detalle: "Detalhe", monto: "Valor",
      moneda: "Moeda", kg: "Kg de ração", identificador: "Identificação", raza: "Raça", nacimiento: "Nascimento", activa: "Ativa",
      prenez: "Prenhez", lactando: "Em lactação", ultimoServicio: "Última cobertura", ultimoParto: "Último parto", partoProbable: "Parto previsto",
      diasAbiertos: "Dias em aberto", baja: "Baixa", motivoBaja: "Motivo da baixa", animal: "Animal", metodo: "Método", reproductor: "Reprodutor", resultado: "Resultado",
      criasVivas: "Crias vivas", criasMuertas: "Crias mortas", criasDestetadas: "Crias desmamadas", vacuna: "Vacina",
      desde: "Aplicar a partir de", hasta: "Aplicar até", ultima: "Última aplicação", proxima: "Próxima",
    },
    especie: { bovino: "Bovino", porcino: "Suíno", avicola: "Avícola" },
    estadoLote: { activo: "Ativo", cerrado: "Encerrado" },
    tipoEvento: { mortalidad: "Mortalidade", vacunacion: "Vacinação", tratamiento: "Tratamento", pesaje: "Pesagem" },
    tipoRepro: { servicio: "Cobertura", diagnostico: "Diagnóstico de prenhez", parto: "Parto", aborto: "Aborto", destete: "Desmame", secado: "Secagem" },
    categoria: { alimento: "Ração", sanidad: "Sanidade", mano_obra: "Mão de obra", compra_animales: "Compra de animais", otros: "Outros" },
    unidad: { leche: "litros", huevos: "ovos" },
    prenez: { vacia: "Vazia", servida: "Coberta", prenada: "Prenhe" },
    metodo: { monta: "Monta natural", inseminacion: "Inseminação" },
    resultado: { prenada: "Prenhe", vacia: "Vazia" },
    estadoCal: { pendiente: "Pendente", vencida: "Vencida", perdida: "Perdida", al_dia: "Em dia", futuro: "Mais adiante", sin_edad: "Falta a idade do lote", campana: "Campanha oficial" },
    si: "Sim", no: "Não", dueno: "(dono)",
  },
};

// Los nombres de las vacunas del calendario ya están traducidos para la
// pantalla (public/i18n/*/ganaderia.js). Se leen de ahí para que la
// planilla diga exactamente lo mismo que la app.
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const NOMBRES_VACUNA = {};
for (const idioma of ["es", "pt"]) {
  const contexto = { I18N: { [idioma]: {} }, Object };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "i18n", idioma, "ganaderia.js"), "utf8"), contexto);
  NOMBRES_VACUNA[idioma] = contexto.I18N[idioma];
}

const redondear = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const plata = (centavos) => (centavos == null ? null : centavos / 100);
const quien = (reg, T) => [reg.registradoPor, reg.origen === "dueno" ? T.dueno : ""].filter(Boolean).join(" ");

// ─── Leer todo de una vez ──────────────────────────────────────────────────
async function leerLotes(lotes, medicoPhone) {
  const ids = lotes.map(l => l._id);
  const filtro = { medicoPhone, loteId: { $in: ids } };
  const [eventos, registros, gastos, animales, eventosRepro, fincas] = await Promise.all([
    EventoLote.find(filtro).sort({ fecha: 1, createdAt: 1 }).lean(),
    RegistroProduccion.find(filtro).sort({ dia: 1 }).lean(),
    GastoLote.find(filtro).sort({ dia: 1, createdAt: 1 }).lean(),
    AnimalGanado.find(filtro).sort({ identificador: 1 }).lean(),
    EventoReproductivo.find(filtro).sort({ fecha: 1, createdAt: 1 }).lean(),
    Finca.find({ medicoPhone, _id: { $in: lotes.map(l => l.fincaId).filter(Boolean) } }).select("nombre").lean(),
  ]);
  const por = (lista) => {
    const m = new Map(ids.map(id => [String(id), []]));
    for (const x of lista) m.get(String(x.loteId))?.push(x);
    return m;
  };
  return {
    eventos: por(eventos), registros: por(registros), gastos: por(gastos),
    animales: por(animales), eventosRepro, fincas: new Map(fincas.map(f => [String(f._id), f.nombre])),
  };
}

// lotes: documentos de LoteGanado ya autorizados por quien llama.
// moneda: la de la cuenta; los gastos en otra moneda se listan con la suya
// pero no entran en los totales (mismo criterio que la pantalla de costos).
async function libroGanadero(lotes, { medicoPhone, idioma = "es", moneda = "BOB", hoy = new Date() }) {
  const T = TEXTOS[idioma] || TEXTOS.es;
  const C = T.col;
  const nombresVacuna = NOMBRES_VACUNA[idioma] || NOMBRES_VACUNA.es;
  const d = await leerLotes(lotes, medicoPhone);
  const nombreLote = new Map(lotes.map(l => [String(l._id), `${l.codigo} ${l.nombre}`.trim()]));
  const loteDe = (x) => nombreLote.get(String(x.loteId)) || "";

  // ── Lotes: una fila por lote, con los indicadores de la pantalla
  const filasLotes = [];
  const filasCalendario = [];
  const filasProduccion = [];
  for (const l of lotes) {
    const id = String(l._id);
    const eventos = d.eventos.get(id);
    const tipo = TIPO_PRODUCCION[l.especie] || null;
    const registros = d.registros.get(id).filter(r => r.tipo === tipo);
    const prod = tipo ? resumenProduccion(tipo, registros, { eventosLote: eventos, hoy }) : null;
    const gastosEnMoneda = d.gastos.get(id).filter(g => (g.moneda || "BOB") === moneda);
    const costos = resumenCostos(l, gastosEnMoneda, {
      pesajes: eventos.filter(e => e.tipo === "pesaje"), tipoProduccion: tipo, serieProduccion: prod ? prod.serie : [], hoy,
    });
    const mort = mortalidadAcumulada(l, eventos);
    const retiros = retirosVigentes(eventos, hoy);
    const maxFecha = (campo) => retiros.map(r => r[campo]).filter(Boolean).sort((a, b) => b - a)[0] || null;
    const cal = l.estado === "cerrado" ? null : calendarioLote(l, eventos, hoy);
    const porHacer = cal ? cal.items.filter(i => i.estado === "pendiente" || i.estado === "vencida") : [];

    filasLotes.push([
      l.codigo, l.nombre, l.fincaId ? d.fincas.get(String(l.fincaId)) || "" : "", T.especie[l.especie] || l.especie,
      l.proposito || "", T.estadoLote[l.estado] || l.estado, l.fechaIngreso, l.edadIngresoDias,
      l.cantidadInicial, l.cantidadActual, mort.totalMuertes, redondear(mort.porcentaje, 2),
      maxFecha("fechaLibreLeche"), maxFecha("fechaLibreCarne"),
      porHacer.map(i => nombresVacuna[`ganaderia.cal.item.${i.id}`] || i.id).join(", "),
      plata(costos.total), plata(redondear(costos.costoPorAnimal, 0)), redondear(costos.conversion?.valor, 2),
      prod ? redondear(prod.promedio7, 2) : null, l.fechaCierre, l.motivoCierre || "",
    ]);

    if (cal) {
      for (const i of cal.items) {
        filasCalendario.push([
          nombreLote.get(id), nombresVacuna[`ganaderia.cal.item.${i.id}`] || i.id, T.estadoCal[i.estado] || i.estado,
          i.desdeFecha, i.hastaFecha, i.ultima, i.proxima,
        ]);
      }
    }

    if (prod) {
      const original = new Map(registros.map(r => [String(r._id), r]));
      for (const r of prod.serie) {
        const o = original.get(String(r._id)) || {};
        filasProduccion.push([
          nombreLote.get(id), r.dia, T.unidad[tipo] === "litros" ? (idioma === "pt" ? "Leite" : "Leche") : (idioma === "pt" ? "Ovos" : "Huevos"),
          r.cantidad, T.unidad[tipo], r.animales, redondear(r.porAnimal, 2),
          tipo === "leche" ? (r.enRetiro ? T.si : T.no) : "", r.productoRetiro || "", r.notas || "", quien(o, T),
        ]);
      }
    }
  }

  const todos = (mapa) => [...mapa.values()].flat();

  const hojas = [
    {
      nombre: T.hoja.lotes,
      columnas: [
        { titulo: C.codigo }, { titulo: C.nombre }, { titulo: C.finca }, { titulo: C.especie }, { titulo: C.proposito },
        { titulo: C.estado }, { titulo: C.ingreso, tipo: "fecha" }, { titulo: C.edadIngreso, tipo: "numero" },
        { titulo: C.iniciales, tipo: "numero" }, { titulo: C.actuales, tipo: "numero" }, { titulo: C.muertes, tipo: "numero" },
        { titulo: C.mortalidad, tipo: "decimal" }, { titulo: C.libreLeche, tipo: "fecha" }, { titulo: C.libreCarne, tipo: "fecha" },
        { titulo: C.vacunasPendientes, ancho: 40 }, { titulo: `${C.gastoTotal} (${moneda})`, tipo: "plata" },
        { titulo: `${C.costoAnimal} (${moneda})`, tipo: "plata" }, { titulo: C.conversion, tipo: "decimal" },
        { titulo: C.prom7, tipo: "decimal" }, { titulo: C.cierre, tipo: "fecha" }, { titulo: C.motivoCierre },
      ],
      filas: filasLotes,
    },
    {
      nombre: T.hoja.eventos,
      columnas: [
        { titulo: C.lote }, { titulo: C.fecha, tipo: "fecha" }, { titulo: C.tipo }, { titulo: C.muertes, tipo: "numero" },
        { titulo: C.causa }, { titulo: C.producto }, { titulo: C.dosis }, { titulo: C.via }, { titulo: C.aplicados, tipo: "numero" },
        { titulo: C.retiroCarneDias, tipo: "numero" }, { titulo: C.retiroLecheDias, tipo: "numero" },
        { titulo: C.libreCarne, tipo: "fecha" }, { titulo: C.libreLeche, tipo: "fecha" },
        { titulo: C.pesoKg, tipo: "decimal" }, { titulo: C.muestra, tipo: "numero" }, { titulo: C.notas, ancho: 40 }, { titulo: C.anotadoPor },
      ],
      filas: todos(d.eventos).map(e => {
        const libre = (dias) => (dias == null ? null : new Date(new Date(e.fecha).getTime() + dias * 86400000));
        return [
          loteDe(e), e.fecha, T.tipoEvento[e.tipo] || e.tipo, e.cantidadMuertes, e.causaPresunta || "", e.producto || "",
          e.dosis || "", e.viaAplicacion || "", e.tipo === "vacunacion" || e.tipo === "tratamiento" ? e.cantidadAplicada : null,
          e.diasRetiroCarne, e.diasRetiroLeche, libre(e.diasRetiroCarne), libre(e.diasRetiroLeche),
          e.pesoPromedioKg, e.tamanoMuestra, e.notas || "", quien(e, T),
        ];
      }),
    },
  ];

  if (filasProduccion.length || lotes.some(l => TIPO_PRODUCCION[l.especie])) {
    hojas.push({
      nombre: T.hoja.produccion,
      columnas: [
        { titulo: C.lote }, { titulo: C.dia, tipo: "fecha" }, { titulo: C.tipo }, { titulo: C.cantidad, tipo: "decimal" },
        { titulo: C.unidad }, { titulo: C.animales, tipo: "numero" }, { titulo: C.porAnimal, tipo: "decimal" },
        { titulo: C.enRetiro }, { titulo: C.producto }, { titulo: C.notas, ancho: 30 }, { titulo: C.anotadoPor },
      ],
      filas: filasProduccion,
    });
  }

  hojas.push({
    nombre: T.hoja.gastos,
    columnas: [
      { titulo: C.lote }, { titulo: C.dia, tipo: "fecha" }, { titulo: C.categoria }, { titulo: C.detalle, ancho: 30 },
      { titulo: C.monto, tipo: "plata" }, { titulo: C.moneda }, { titulo: C.kg, tipo: "decimal" }, { titulo: C.anotadoPor },
    ],
    filas: todos(d.gastos).map(g => [
      loteDe(g), g.dia, T.categoria[g.categoria] || g.categoria, g.concepto || "", plata(g.montoCentavos), g.moneda || "", g.kg, quien(g, T),
    ]),
  });

  const animales = todos(d.animales);
  if (animales.length) {
    const eventosPorAnimal = new Map();
    for (const e of d.eventosRepro) {
      const k = String(e.animalId);
      if (!eventosPorAnimal.has(k)) eventosPorAnimal.set(k, []);
      eventosPorAnimal.get(k).push(e);
    }
    const nombreAnimal = new Map(animales.map(a => [String(a._id), `${a.identificador}${a.nombre ? ` (${a.nombre})` : ""}`]));
    hojas.push({
      nombre: T.hoja.animales,
      columnas: [
        { titulo: C.lote }, { titulo: C.identificador }, { titulo: C.nombre }, { titulo: C.raza }, { titulo: C.especie },
        { titulo: C.nacimiento, tipo: "fecha" }, { titulo: C.activa }, { titulo: C.prenez }, { titulo: C.lactando },
        { titulo: C.ultimoServicio, tipo: "fecha" }, { titulo: C.ultimoParto, tipo: "fecha" }, { titulo: C.partoProbable, tipo: "fecha" },
        { titulo: C.diasAbiertos, tipo: "numero" }, { titulo: C.baja, tipo: "fecha" }, { titulo: C.motivoBaja },
      ],
      filas: animales.map(a => {
        const r = resumenHembra(a, eventosPorAnimal.get(String(a._id)) || [], hoy);
        return [
          loteDe(a), a.identificador, a.nombre || "", a.raza || "", T.especie[a.especie] || a.especie, a.fechaNacimiento,
          a.activa ? T.si : T.no, T.prenez[r.prenez] || r.prenez || "", r.lactando ? T.si : T.no,
          r.ultimoServicio, r.ultimoParto, r.fechaProbableParto, r.diasAbiertos, a.fechaBaja, a.motivoBaja || "",
        ];
      }),
    });
    hojas.push({
      nombre: T.hoja.repro,
      columnas: [
        { titulo: C.lote }, { titulo: C.animal }, { titulo: C.fecha, tipo: "fecha" }, { titulo: C.tipo }, { titulo: C.metodo },
        { titulo: C.reproductor }, { titulo: C.resultado }, { titulo: C.criasVivas, tipo: "numero" },
        { titulo: C.criasMuertas, tipo: "numero" }, { titulo: C.criasDestetadas, tipo: "numero" }, { titulo: C.notas, ancho: 30 },
      ],
      filas: d.eventosRepro.map(e => [
        loteDe(e), nombreAnimal.get(String(e.animalId)) || "", e.fecha, T.tipoRepro[e.tipo] || e.tipo,
        T.metodo[e.metodo] || "", e.reproductor || "", T.resultado[e.resultado] || "",
        e.criasVivas, e.criasMuertas, e.criasDestetadas, e.notas || "",
      ]),
    });
  }

  if (filasCalendario.length) {
    hojas.push({
      nombre: T.hoja.calendario,
      columnas: [
        { titulo: C.lote }, { titulo: C.vacuna, ancho: 34 }, { titulo: C.estado }, { titulo: C.desde, tipo: "fecha" },
        { titulo: C.hasta, tipo: "fecha" }, { titulo: C.ultima, tipo: "fecha" }, { titulo: C.proxima, tipo: "fecha" },
      ],
      filas: filasCalendario,
    });
  }

  return generarXlsx(hojas);
}

// El nombre del archivo que baja: sin tildes ni espacios, para que llegue
// igual por WhatsApp, por correo y a una memoria USB.
function nombreArchivo(base, hoy = new Date()) {
  const limpio = String(base || "ganaderia").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "ganaderia";
  return `${limpio}_${hoy.toISOString().slice(0, 10)}.xlsx`;
}

module.exports = { libroGanadero, nombreArchivo, TEXTOS };
