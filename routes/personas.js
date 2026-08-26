// Vitalis — Persona compartida entre los consultorios de una clínica.
//
// El mismo señor que va al clínico y al odontólogo es una persona con dos
// fichas. Estas rutas dejan que el médico las reconozca como la misma, sin
// que ninguno pueda leer la historia clínica del otro.
//
// ═══ LO QUE ESTAS RUTAS DEVUELVEN ══════════════════════════════════════════
//
// Identidad y alergias. Nada más. Buscar una persona NO dice qué le pasa ni
// quién la atiende: devuelve nombre, nacimiento, documento y alergias. Si
// devolviera "atendida por el Dr. X en oncología", buscar un paciente sería
// una forma de averiguar quién trata a quién.
//
// ═══ POR QUÉ NADA SE VINCULA SOLO ══════════════════════════════════════════
//
// Vincular dos fichas que en realidad son de dos personas distintas fusiona
// dos historias clínicas. En una clínica hay dos "Juan Pérez", y si el
// sistema los une porque se llaman igual, el segundo hereda las alergias y
// los antecedentes del primero. Eso no tiene vuelta atrás.
//
// Por eso acá se BUSCA y se PROPONE; confirmar es siempre del médico.
const express = require("express");
const mongoose = require("mongoose");
const { PersonaClinica, Medico, Paciente } = require("../db/models");
const { requireAuth } = require("../services/auth");
const { limitMedico } = require("../services/ratelimit");
const { asyncRoute, ErrorHttp, obtenerOFallar } = require("../services/httpHelpers");
const { registrar } = require("../services/auditoria");

const requireMedico = requireAuth(["medico"]);

// La clínica del médico que hace el pedido. Sale de su cuenta, nunca del
// cliente: si viniera del pedido, cualquiera podría buscar personas de otra
// clínica cambiando un parámetro.
async function clinicaDelMedico(medicoPhone) {
  const medico = await Medico.findOne({ phone: medicoPhone }).select("clinicaId").lean();
  return medico?.clinicaId || null;
}

// Para comparar nombres sin que "José Pérez" y "jose perez" parezcan dos
// personas. No decide nada por sí solo — solo ordena los candidatos que el
// médico va a mirar.
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = function (app) {
  // ─── BUSCAR UNA PERSONA YA CONOCIDA EN LA CLÍNICA ───────────────────────
  // Se usa al dar de alta un paciente: antes de crear una ficha nueva, ver
  // si esa persona ya viene a la clínica por otro consultorio.
  app.get("/medico/personas/buscar", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const clinicaId = await clinicaDelMedico(req.adminUser.usuario);
    // Un médico que trabaja solo no tiene con quién compartir. No es un
    // error: simplemente no hay nada que buscar.
    if (!clinicaId) return res.json({ enClinica: false, personas: [] });

    const q = normalizar(req.query.q);
    const documento = String(req.query.documento || "").trim();
    if (q.length < 3 && !documento) return res.json({ enClinica: true, personas: [] });

    const filtro = { clinicaId };
    if (documento) {
      filtro.documento = documento;
    } else {
      // Se traen los de la clínica y se filtra en memoria: son decenas o
      // cientos, no millones, y así el acento y las mayúsculas no importan.
      // Una regex sobre el nombre en Mongo no ignora tildes.
    }

    let personas = await PersonaClinica.find(filtro)
      .select("nombre fechaNacimiento sexo telefono documento alergias")
      .limit(400)
      .lean();

    if (!documento) {
      personas = personas
        .filter(p => normalizar(p.nombre).includes(q))
        .slice(0, 20);
    }

    res.json({ enClinica: true, personas });
  }));

  // ─── VINCULAR UNA FICHA A UNA PERSONA ───────────────────────────────────
  // Lo confirma el médico. Queda auditado: fusionar dos historias por error
  // es el peor accidente posible acá, y tiene que poder rastrearse.
  app.post("/medico/pacientes/:pacienteId/persona", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const clinicaId = await clinicaDelMedico(medicoPhone);
    if (!clinicaId) throw new ErrorHttp(400, "Tu cuenta no está en ninguna clínica");

    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");

    let persona;
    if (req.body?.personaId) {
      persona = await PersonaClinica.findOne({ _id: req.body.personaId, clinicaId });
      if (!persona) throw new ErrorHttp(404, "Esa persona no existe en tu clínica");
    } else {
      // No hay persona todavía: esta ficha la estrena. Los datos salen del
      // paciente que el médico ya cargó, no de lo que mande el cliente.
      persona = await PersonaClinica.create({
        clinicaId,
        nombre: paciente.nombre,
        fechaNacimiento: paciente.fechaNacimiento,
        sexo: paciente.sexo,
        telefono: paciente.telefono,
        documento: String(req.body?.documento || "").trim().slice(0, 40),
      });
    }

    paciente.personaId = persona._id;
    await paciente.save();
    registrar({ req, medicoPhone, accion: "vincular_persona", recurso: `Paciente:${paciente._id}→Persona:${persona._id}` });
    res.json({ ok: true, persona });
  }));

  // ─── DESVINCULAR ────────────────────────────────────────────────────────
  // Para deshacer un vínculo equivocado. No borra la persona ni toca la
  // ficha: solo corta la asociación.
  app.delete("/medico/pacientes/:pacienteId/persona", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    const antes = paciente.personaId;
    paciente.personaId = null;
    await paciente.save();
    registrar({ req, medicoPhone, accion: "desvincular_persona", recurso: `Paciente:${paciente._id}←Persona:${antes}` });
    res.json({ ok: true });
  }));

  // ─── ALERGIAS COMPARTIDAS ───────────────────────────────────────────────
  // Lo único clínico que cruza consultorios, y por seguridad del paciente:
  // que el odontólogo no le recete amoxicilina a alguien alérgico a la
  // penicilina porque esa alergia estaba anotada en la ficha del clínico.
  app.patch("/medico/personas/:personaId/alergias", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const clinicaId = await clinicaDelMedico(medicoPhone);
    if (!clinicaId) throw new ErrorHttp(400, "Tu cuenta no está en ninguna clínica");

    // Solo puede tocarlas un médico que atiende a esa persona. Estar en la
    // clínica no alcanza: si no, cualquiera podría editarle las alergias a
    // un paciente que nunca vio.
    const persona = await PersonaClinica.findOne({ _id: req.params.personaId, clinicaId });
    if (!persona) throw new ErrorHttp(404, "Persona no encontrada");
    const atiende = await Paciente.exists({ medicoPhone, personaId: persona._id });
    if (!atiende) throw new ErrorHttp(403, "Solo podés editar las alergias de un paciente que atendés");

    if (!Array.isArray(req.body?.alergias)) throw new ErrorHttp(400, "alergias tiene que ser una lista");
    persona.alergias = req.body.alergias
      .map(a => String(a || "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 30);
    persona.alergiasActualizadasPor = medicoPhone;
    persona.alergiasActualizadasEn = new Date();
    await persona.save();

    registrar({ req, medicoPhone, accion: "editar_alergias_persona", recurso: `Persona:${persona._id}` });
    res.json({ ok: true, persona });
  }));

  // ─── QUÉ SABE LA CLÍNICA DE ESTA PERSONA ────────────────────────────────
  // Lo que se muestra arriba de la ficha: identidad, alergias, y en cuántos
  // consultorios la atienden — el NÚMERO, no quiénes. Saber que "la ven en
  // 3 consultorios" le dice al médico que pregunte; saber en cuáles sería
  // decirle qué especialistas consulta, que no es asunto suyo.
  app.get("/medico/pacientes/:pacienteId/persona", limitMedico, requireMedico, asyncRoute(async (req, res) => {
    const medicoPhone = req.adminUser.usuario;
    const paciente = await obtenerOFallar(Paciente, { _id: req.params.pacienteId, medicoPhone }, "Paciente no encontrado");
    if (!paciente.personaId) return res.json({ persona: null });

    const clinicaId = await clinicaDelMedico(medicoPhone);
    const persona = await PersonaClinica.findOne({ _id: paciente.personaId, clinicaId }).lean();
    if (!persona) return res.json({ persona: null });

    const fichas = await Paciente.countDocuments({ personaId: persona._id });
    res.json({ persona, fichasEnLaClinica: fichas });
  }));
};
