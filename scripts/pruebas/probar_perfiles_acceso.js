// Lógica y handlers reales, con MongoDB, red y middleware de transporte simulados.
// No sustituye integración con MongoDB/Meta ni una prueba OAuth en navegador.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const ROOT = path.join(__dirname, "../..");
let n = 0;
async function test(nombre, fn) { await fn(); console.log("✅ " + nombre); n++; }
class ErrorHttp extends Error { constructor(status, message) { super(message); this.status = status; this.publicMessage = message; } }
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const helpers = { ErrorHttp, asyncRoute: wrap };
function cargar(archivo, deps) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, archivo), "utf8"), {
    module, exports: module.exports, require: k => {
      if (Object.hasOwn(deps, k)) return deps[k];
      if (["crypto", "node:crypto"].includes(k)) return crypto;
      throw new Error("Dependencia sin simular: " + k);
    }, Date, Buffer, URL, console, process: { env: { JWT_SECRET: "solo-pruebas-no-produccion" } },
  }, { filename: archivo });
  return module.exports;
}
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
function set(o, p, v, borrar = false) { const ks = p.split("."), last = ks.pop(); for (const k of ks) o = o[k] ||= {}; if (borrar) delete o[last]; else o[last] = v; }
function matches(o, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === "$or") return v.some(s => matches(o, s));
    const actual = get(o, k);
    if (v && typeof v === "object" && !(v instanceof Date)) return Object.entries(v).every(([op, x]) => {
      switch (op) { case "$lt": return actual < x; case "$lte": return actual <= x; case "$gt": return actual > x;
        case "$ne": return actual !== x; case "$exists": return (actual !== undefined) === x;
        case "$in": return x.some(a => a == null ? actual == null : a === actual); default: throw new Error(op); }
    });
    return actual === v;
  });
}
function modelo() {
  const docs = new Map();
  function query(value) { return { select() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return Promise.resolve(structuredClone(value)); }, then(a, b) { return Promise.resolve(structuredClone(value)).then(a, b); } }; }
  function update(d, u) { for (const [k,v] of Object.entries(u.$set || {})) set(d,k,structuredClone(v)); for (const k of Object.keys(u.$unset || {})) set(d,k,null,true); for (const [k,v] of Object.entries(u.$inc || {})) set(d,k,(get(d,k)||0)+v); }
  return { docs, async create(d) { if (docs.has(d._id)) throw Object.assign(new Error("duplicate"), { code: 11000 }); docs.set(d._id,structuredClone(d)); return structuredClone(d); },
    findOne(q) { return query([...docs.values()].find(d => matches(d,q)) || null); }, find(q) { return query([...docs.values()].filter(d => matches(d,q))); },
    async updateOne(q,u) { const d=[...docs.values()].find(d=>matches(d,q)); if (!d) return { matchedCount:0,modifiedCount:0 }; update(d,u); return { matchedCount:1,modifiedCount:1 }; },
    async findOneAndUpdate(q,u) { const d=[...docs.values()].find(d=>matches(d,q)); if (!d) return null; update(d,u); return structuredClone(d); },
  };
}
const Medico = modelo(), Desafio = modelo();
const perfiles = cargar("services/perfilesCuenta.js", { "./httpHelpers": helpers });
const profesional = { pais:"BO", profesion:"Odontología", matricula:"ODO-123", tipoEspecialidad:"odontologia", etapa:"profesional" };
const revision = m => ({ revision:m.solicitud.revision, identidadComprobada:true, matriculaComprobada:true, metodo:"registro_oficial", referencia:"Registro de prueba consultado el 21/10/2026" });
const CONFIG = { WHATSAPP_TOKEN:"test", WHATSAPP_PHONE_NUMBER_ID:"test", WHATSAPP_AUTH_TEMPLATE:"test", APP_URL:"https://example.test" };
let enviado, fallaProveedor = false, envios=0;
const telefono = cargar("services/verificarTelefono.js", {
  mongoose: { Schema:class {}, models:{ VerificacionTelefono:Desafio } }, "../config":{ CONFIG }, "../db/models":{ Medico }, "./httpHelpers":helpers,
  "./metaWhatsapp": { enviarCodigoAcceso:async (phone,codigo) => { envios++; enviado={phone,codigo}; if (fallaProveedor) throw new Error("caída"); return {messages:[{id:"test"}]}; } },
});
const noop = (_q,_s,next) => next();
const rutas = {}, cadenas = {};
const app = { get:(p,...h)=>{rutas["GET "+p]=h.at(-1); cadenas["GET "+p]=h;}, post:(p,...h)=>{rutas["POST "+p]=h.at(-1); cadenas["POST "+p]=h;} };
const auditoria=[];
const comunes = { "../db/models":{ Medico }, "../services/auth":{ requireAuth:()=>noop }, "../services/perfilesCuenta":perfiles,
  "../services/httpHelpers":helpers, "../services/ratelimit":{ limitAuth:noop,limitMedico:noop }, "../services/auditoria":{registrar:x=>auditoria.push(x)} };
cargar("routes/solicitudesCuenta.js", { ...comunes, "../services/operadores":{esOperador:p=>p==="operador"}, "../services/metaWhatsapp":{enviarTextoOPlantilla:async()=>true,normalizarDestino:p=>p,PLANTILLAS:{}}, "../config":{CONFIG,log:{info(){},warn(){},error(){}}}, "../services/idiomas":{esCuentaBrasil:()=>false} })(app);
cargar("routes/perfilCuenta.js", { ...comunes, "../services/googleAcceso":{cuentaDeSolicitud:async req=>Medico.findOne({phone:req.cuentaPrueba})}, "../services/verificarTelefono":telefono })(app);
async function pedir(ruta,phone,body={},usuario="operador") {
  const req={params:{phone},adminUser:{usuario},body,cuentaPrueba:phone};
  const res={code:200,set(){return this;},status(c){this.code=c;return this;},json(d){this.data=d;return this;}};
  await rutas[ruta](req,res);return res;
}
async function crear(id,extra={}) { const m={_id:id,phone:id,nombre:"Persona de prueba",activo:false,estadoCuenta:"pendiente",matricula:profesional.matricula,tipoEspecialidad:"odontologia",solicitud:perfiles.nuevaSolicitud(profesional),...extra}; Medico.docs.set(id,structuredClone(m));return m; }
const aprobar="POST /medico/solicitudes-cuenta/:phone/aprobar", rechazar="POST /medico/solicitudes-cuenta/:phone/rechazar";
(async()=>{
  await test("el esquema de Medico conserva perfil, verificación, formación y ámbito del plan",()=>{
    class Schema { constructor(def){this.obj=def;} index(){} pre(){} set(){} }
    Schema.Types={ObjectId:class {},Mixed:class {}};
    const models=cargar("db/models.js",{mongoose:{Schema,connect:()=>Promise.resolve(),connection:{on(){}},model:(name,schema)=>({schema,on(){}})},"../config":{CONFIG:{},log:{info(){},error(){},warn(){}}}});
    const d=models.Medico.schema.obj;
    assert.ok(d.perfilAcceso);assert.ok(d.verificacionProfesional.verificadoPor);assert.ok(d.formacion.nivelEducativoAnterior);
    assert.ok(d.suscripcion.ambito);assert.ok(d.solicitud.revision);assert.ok(d.solicitud.correo.type.remitente);
    assert.equal(models.Clinica.schema.obj.suscripcion.ambito,undefined);
  });
  await test("un plan educativo conservado no financia uso clínico tras la conversión",()=>{
    const planes=cargar("services/suscripciones.js",{"./monedas":{}});
    const plan={ambito:"educativo",hasta:new Date(Date.now()+86400000)};
    assert.equal(planes.vigente({suscripcion:plan,estudiante:{nivel:"estudiante"}}),true);
    assert.equal(planes.vigente({suscripcion:plan,perfilAcceso:"profesional"}),false);
    assert.equal(planes.vigente({suscripcion:{...plan,ambito:"profesional"}}),true);
  });
  await test("el panel exige operador autorizado y segundo factor activo", async()=>{
    const cadena=cadenas[aprobar];
    const guardia=cadena[2];
    async function control(usuario){return new Promise((resolve,reject)=>{
      const res={status(c){this.code=c;return this;},json(d){resolve({code:this.code,data:d});}};
      guardia({adminUser:{usuario}},res,e=>e?reject(e):resolve({code:200}));
    });}
    assert.equal((await control("intruso")).code,404);
    await crear("operador",{activo:true,estadoCuenta:"aprobada",dosFA:{activo:false}});
    assert.equal((await control("operador")).code,403);
    Medico.docs.get("operador").dosFA.activo=true;assert.equal((await control("operador")).code,200);
  });
  await test("emisión de sesión rechaza profesional sin verificar y educativo sin marca",()=>{
    const sesion=cargar("services/sesionMedico.js",{"./auth":{generarToken:()=>"token"},"./operadores":{esOperador:()=>false},"./extensiones":{sumar:()=>({})},"./httpHelpers":helpers});
    assert.throws(()=>sesion.tokenDeMedico({perfilAcceso:"profesional"}),e=>e.status===403);
    assert.throws(()=>sesion.tokenDeMedico({perfilAcceso:"educativo"}),e=>e.status===403);
    assert.equal(sesion.tokenDeMedico({phone:"antigua"}),"token");
  });
  await test("plantilla Meta usa categoría de autenticación y parámetros de cuerpo y botón",async()=>{
    let enviado;
    const meta=cargar("services/metaWhatsapp.js",{axios:{post:async(url,body)=>{enviado={url,body};return{data:{messages:[{id:"prueba"}]}};}},"../config":{CONFIG,log:{warn(){},info(){},error(){}}},"./idiomas":{IDIOMAS:{}}});
    await meta.enviarCodigoAcceso("59171111111","001234");
    assert.equal(enviado.body.template.name,CONFIG.WHATSAPP_AUTH_TEMPLATE);
    assert.equal(enviado.body.template.components[0].parameters[0].text,"001234");
    assert.equal(enviado.body.template.components[1].parameters[0].text,"001234");
    assert.equal(enviado.body.template.components[1].sub_type,"url");
  });
  await test("la selección de país, profesión, área y matrícula es obligatoria",()=>{
    for(const k of ["pais","profesion","tipoEspecialidad","matricula"]) assert.throws(()=>perfiles.datosProfesionales({...profesional,[k]:""}));
    assert.throws(()=>perfiles.datosProfesionales({...profesional,etapa:"admin"}));
  });
  await test("residente es formación; la solicitud nace pendiente",()=>{
    const s=perfiles.nuevaSolicitud({...profesional,etapa:"residente"});assert.equal(s.estado,"pendiente");assert.equal(s.etapa,"residente");assert.ok(s.revision);
  });
  await test("aprobar requiere identidad, matrícula y evidencia documentada",async()=>{
    const m=await crear("cuenta1");
    for(const extra of [{identidadComprobada:false},{matriculaComprobada:false},{referencia:""},{metodo:"google"}]) assert.equal((await pedir(aprobar,m.phone,{...revision(m),...extra})).code,400);
    assert.equal(Medico.docs.get(m._id).activo,false);
  });
  await test("ni revisión obsoleta ni autoaprobación conceden acceso",async()=>{
    const m=await crear("cuenta2");assert.equal((await pedir(aprobar,m.phone,{...revision(m),revision:"otra"})).code,409);
    assert.equal((await pedir(aprobar,m.phone,revision(m),m.phone)).code,403);
  });
  await test("aprobar guarda autor, fecha y datos de la solicitud, sin aceptar matrícula adulterada",async()=>{
    const m=await crear("cuenta3");assert.equal((await pedir(aprobar,m.phone,{...revision(m),matricula:"falsa",rol:"admin"})).code,200);
    const d=Medico.docs.get(m._id);assert.equal(d.verificacionProfesional.matricula,profesional.matricula);assert.equal(d.verificacionProfesional.verificadoPor,"operador");assert.ok(d.verificacionProfesional.verificadoEn);assert.equal(d.perfilAcceso,"profesional");assert.equal(d.rol,undefined);
  });
  await test("aprobación y rechazo concurrentes resuelven una sola vez",async()=>{
    const m=await crear("cuenta4"); const r=await Promise.all([pedir(aprobar,m.phone,revision(m)),pedir(rechazar,m.phone,{revision:m.solicitud.revision,motivo:"Prueba"})]);
    assert.equal(r.filter(x=>x.code===200).length,1);assert.equal(r.filter(x=>x.code===409).length,1);
  });
  await test("un estudiante solicita conversión sin cambiar permisos ni plan",async()=>{
    const m=await crear("estudiante1",{activo:true,estadoCuenta:"aprobada",perfilAcceso:"educativo",estudiante:{nivel:"estudiante",carrera:"odontologia",universidad:"Universidad"},solicitud:{},suscripcion:{plan:"mensual",hasta:new Date(Date.now()+86400000)}});
    const r=await pedir("POST /medico/perfil-acceso/solicitar-profesional",m.phone,profesional,m.phone);assert.equal(r.code,200);
    const d=Medico.docs.get(m._id);assert.equal(d.estudiante.nivel,"estudiante");assert.equal(d.perfilAcceso,"educativo");assert.equal(d.solicitud.tipo,"conversion");assert.equal(d.suscripcion.plan,"mensual");
    assert.equal((await pedir("POST /medico/perfil-acceso/solicitar-profesional",m.phone,profesional,m.phone)).code,409);
  });
  await test("rechazar conversión mantiene acceso educativo e historial",async()=>{
    const m=structuredClone(Medico.docs.get("estudiante1"));assert.equal((await pedir(rechazar,m.phone,{revision:m.solicitud.revision,motivo:"Falta acreditación"})).code,200);
    const d=Medico.docs.get(m._id);assert.equal(d.activo,true);assert.equal(d.estadoCuenta,"aprobada");assert.equal(d.estudiante.nivel,"estudiante");
  });
  await test("conversión aprobada conserva formación y plan educativo, revoca sesiones",async()=>{
    const m=await crear("estudiante2",{activo:true,estadoCuenta:"aprobada",perfilAcceso:"educativo",estudiante:{nivel:"residente",carrera:"medicina",universidad:"U"},solicitud:perfiles.nuevaSolicitud({...profesional,etapa:"residente"},"conversion"),suscripcion:{plan:"mensual",hasta:new Date(Date.now()+86400000)}});
    assert.equal((await pedir(aprobar,m.phone,revision(m))).code,200);const d=Medico.docs.get(m._id);
    assert.equal(d.estudiante,undefined);assert.equal(d.formacion.nivel,"residente");assert.equal(d.verificacionProfesional.etapa,"residente");assert.equal(d.suscripcion.plan,"mensual");assert.equal(d.suscripcion.ambito,"educativo");assert.ok(d.sesionesDesde);
  });
  await test("editar una solicitud no activa la cuenta ni permite autoaprobarse",async()=>{
    const m=await crear("editar");const r=await pedir("POST /medico/google/solicitud/actualizar",m.phone,{...profesional,activo:true,estadoCuenta:"aprobada",verificacionProfesional:{estado:"verificada"}});
    assert.equal(r.code,200);const d=Medico.docs.get(m._id);assert.equal(d.activo,false);assert.equal(d.verificacionProfesional.estado,"pendiente");assert.notEqual(d.solicitud.revision,m.solicitud.revision);
    assert.equal((await pedir(aprobar,m.phone,revision(m))).code,409);
  });
  const auth=cargar("services/auth.js",{bcryptjs:{},"../db/models":{Medico}});
  await test("cuentas históricas siguen accediendo sin rotularse verificadas",async()=>{
    await crear("vieja",{activo:true,estadoCuenta:"aprobada",solicitud:{}});assert.equal(await auth.sesionVigente({usuario:"vieja",rol:"medico",iat:Date.now()}),true);
  });
  await test("permiso clínico exige habilitación vigente aunque el token siga firmado",async()=>{
    await crear("sinVerificar",{activo:true,estadoCuenta:"aprobada",perfilAcceso:"profesional",verificacionProfesional:{estado:"pendiente"}});
    assert.equal(await auth.sesionVigente({usuario:"sinVerificar",rol:"medico",iat:Date.now()}),false);
    const d=Medico.docs.get("cuenta3");d.verificacionProfesional.estado="suspendida";assert.equal(await auth.sesionVigente({usuario:d.phone,rol:"medico",iat:Date.now()}),false);
  });
  await test("token sin marca educativa y sesiones previas a conversión son inválidos",async()=>{
    assert.equal(await auth.sesionVigente({usuario:"estudiante1",rol:"medico",iat:Date.now()}),false);
    assert.equal(await auth.sesionVigente({usuario:"estudiante1",rol:"medico",estudiante:true,iat:Date.now()}),true);
    assert.equal(await auth.sesionVigente({usuario:"estudiante2",rol:"medico",estudiante:true,iat:0}),false);
  });
  await test("ninguna ruta de este flujo envía ni confirma OTP de teléfono",()=>{
    assert.ok(!Object.keys(rutas).some(p=>/\/telefono\/(enviar|confirmar)$/.test(p)));
    const s=fs.readFileSync(path.join(ROOT,"public/js/perfilAcceso.js"),"utf8");
    assert.ok(!s.includes("one-time-code"));assert.ok(!s.includes("solicitud/telefono/"));
  });
  await test("recepción, aprobación y corrección guardan el aviso junto a la decisión",async()=>{
    const m=await crear("avisos");assert.equal(m.solicitud.correo.tipo,"recibida");
    assert.equal((await pedir(aprobar,m.phone,revision(m))).code,200);
    assert.equal(Medico.docs.get(m.phone).solicitud.correo.tipo,"aprobada");
    const otro=await crear("avisos2");await pedir(rechazar,otro.phone,{revision:otro.solicitud.revision,motivo:"Faltan datos"});
    assert.equal(Medico.docs.get(otro.phone).solicitud.correo.tipo,"corregir");
    assert.equal(Medico.docs.get("estudiante1").solicitud.correo.tipo,"corregir");
    assert.equal(Medico.docs.get("editar").solicitud.correo.tipo,"recibida");
  });
  const MailMedico=modelo(), mailConfig={APP_URL:"https://example.test"}, enviosCorreo=[];
  let fallaCorreo=false, antesDeResponder=null;
  const correoDeps={"../db/models":{Medico:MailMedico},"../config":{CONFIG:mailConfig,log:{warn(){}}},axios:{post:async(url,body,options)=>{
    enviosCorreo.push({url,body,options});if(antesDeResponder)await antesDeResponder();
    if(fallaCorreo)throw new Error("fallo simulado");return{data:{id:"proveedor-1"}};
  }}};
  const correos=cargar("services/correosCuenta.js",correoDeps);
  function nuevaCuentaCorreo(extra={}){
    MailMedico.docs.clear();enviosCorreo.length=0;fallaCorreo=false;antesDeResponder=null;
    const m={_id:"mail",googleSub:"google-verificado",googleEmail:"persona@example.test",activo:false,telefonoVerificado:false,
      solicitud:perfiles.nuevaSolicitud(profesional),...extra};MailMedico.docs.set(m._id,structuredClone(m));return MailMedico.docs.get(m._id);
  }
  await test("sin proveedor configurado conserva el aviso pendiente sin afirmar envío",async()=>{
    const m=nuevaCuentaCorreo();assert.equal(await correos.procesarUno(),false);assert.equal(m.solicitud.correo.estado,"pendiente");assert.equal(enviosCorreo.length,0);
    mailConfig.RESEND_API_KEY="clave-simulada";mailConfig.CORREO_CUENTAS_REMITENTE="Symphomed <avisos@example.test>";
  });
  await test("dos trabajadores compiten por un único envío; correo no activa ni verifica la cuenta",async()=>{
    const m=nuevaCuentaCorreo();await Promise.all([correos.procesarUno(),correos.procesarUno()]);
    assert.equal(enviosCorreo.length,1);assert.equal(m.solicitud.correo.estado,"enviado");assert.equal(m.activo,false);assert.equal(m.telefonoVerificado,false);
    assert.deepEqual(Array.from(enviosCorreo[0].body.to),["persona@example.test"]);assert.equal(enviosCorreo[0].options.maxRedirects,0);
  });
  await test("correo histórico sin identidad Google nunca se usa como destino verificado",async()=>{
    const m=nuevaCuentaCorreo({googleSub:undefined,googleEmail:undefined,email:"no-verificado@example.test"});
    await correos.procesarUno();assert.equal(m.solicitud.correo.estado,"sin_correo");assert.equal(enviosCorreo.length,0);
  });
  await test("reinicio y fallo de red conservan clave idempotente y contenido del envío",async()=>{
    const m=nuevaCuentaCorreo();fallaCorreo=true;await correos.procesarUno();assert.equal(m.solicitud.correo.estado,"pendiente");
    const primero=JSON.stringify(enviosCorreo[0]);m.solicitud.correo.proximoIntento=new Date(0);m.idioma="pt";fallaCorreo=false;
    const reiniciado=cargar("services/correosCuenta.js",correoDeps);await reiniciado.procesarUno();
    assert.equal(JSON.stringify(enviosCorreo[1]),primero);assert.equal(m.solicitud.correo.estado,"enviado");
  });
  await test("cinco fallos detienen el reintento automático sin revertir la aprobación",async()=>{
    const m=nuevaCuentaCorreo({activo:true,estadoCuenta:"aprobada"});fallaCorreo=true;
    for(let i=0;i<5;i++){m.solicitud.correo.proximoIntento=new Date(0);await correos.procesarUno();}
    assert.equal(m.solicitud.correo.estado,"error");assert.equal(await correos.procesarUno(),false);assert.equal(enviosCorreo.length,5);assert.equal(m.activo,true);
  });
  await test("un bloqueo vencido se recupera; un aviso fuera de la ventana idempotente no se reenvía",async()=>{
    const m=nuevaCuentaCorreo();Object.assign(m.solicitud.correo,{estado:"enviando",bloqueo:"proceso-muerto",proximoIntento:new Date(0)});
    await correos.procesarUno();assert.equal(enviosCorreo.length,1);
    const viejo=nuevaCuentaCorreo();viejo.solicitud.correo.iniciadoEn=new Date(Date.now()-24*3600000);
    await correos.procesarUno();assert.equal(viejo.solicitud.correo.estado,"expirado");assert.equal(enviosCorreo.length,0);
  });
  await test("una respuesta tardía del proveedor no sobrescribe una nueva decisión",async()=>{
    const m=nuevaCuentaCorreo();antesDeResponder=async()=>{m.solicitud.correo=structuredClone(perfiles.nuevoAvisoCuenta("aprobada"));};
    await correos.procesarUno();assert.equal(m.solicitud.correo.tipo,"aprobada");assert.equal(m.solicitud.correo.estado,"pendiente");
  });
  await test("avisos ES/PT no incluyen datos clínicos, matrícula ni motivo del rechazo",()=>{
    for(const lang of ["es","pt"])for(const tipo of ["recibida","aprobada","corregir"]){
      const c=correos.contenido(tipo,lang,"https://example.test");assert.ok(c.subject);assert.ok(c.text.includes("https://example.test"));
      assert.ok(!c.text.includes(profesional.matricula));assert.ok(!c.text.includes("Faltan datos"));
    }
  });
  await test("reenvío administrativo usa los mismos controles y no modifica permisos",async()=>{
    const ruta="POST /medico/solicitudes-cuenta/:phone/reenviar-correo";
    assert.equal(cadenas[ruta][2],cadenas[aprobar][2]);
    const m=await crear("reintentar",{googleSub:"g",googleEmail:"persona@example.test"}), d=Medico.docs.get(m.phone);
    Object.assign(d.solicitud.correo,{estado:"error",intentos:5,iniciadoEn:new Date()});const id=d.solicitud.correo.id;
    assert.equal((await pedir(ruta,m.phone,{avisoId:"obsoleto"})).code,409);
    assert.equal((await pedir(ruta,m.phone,{avisoId:id})).code,200);assert.equal(d.solicitud.correo.id,id);
    assert.equal(d.solicitud.correo.estado,"pendiente");assert.equal(d.activo,false);
    assert.equal((await pedir(ruta,m.phone,{avisoId:id})).code,409);
  });

  // Servicio OTP reservado para una futura entrega: no tiene rutas activas.
  const phone="59171111111";
  let m=await crear(phone,{activo:true,estadoCuenta:"aprobada",telefonoVerificado:false});
  await test("sin plantilla WhatsApp no envía ni verifica",async()=>{
    CONFIG.WHATSAPP_AUTH_TEMPLATE="";await assert.rejects(()=>telefono.enviar(m),e=>e.status===503);assert.equal(envios,0);CONFIG.WHATSAPP_AUTH_TEMPLATE="test";
  });
  await test("OTP solo se envía al teléfono de la cuenta; no guarda ni devuelve el código",async()=>{
    const r=await telefono.enviar(m,{phone:"otra"});assert.equal(enviado.phone,m.phone);assert.match(enviado.codigo,/^\d{6}$/);assert.equal(r.codigo,undefined);
    const d=Desafio.docs.get(phone);assert.ok(d.codigoHash);assert.equal(d.codigo,undefined);assert.notEqual(d.codigoHash,enviado.codigo);
  });
  await test("reenvíos concurrentes respetan el minuto de espera",async()=>{
    const resultados=await Promise.allSettled([telefono.enviar(m),telefono.enviar(m)]);assert.equal(resultados.filter(x=>x.status==="rejected"&&x.reason.status===429).length,2);assert.equal(envios,1);
  });
  await test("cinco errores agotan el desafío",async()=>{
    const incorrecto=enviado.codigo==="999999"?"888888":"999999";
    for(let i=0;i<5;i++) await assert.rejects(()=>telefono.confirmar(m,{codigo:incorrecto}),e=>e.status===400);
    await assert.rejects(()=>telefono.confirmar(m,{codigo:enviado.codigo}),e=>e.status===400);assert.equal(Medico.docs.get(phone).telefonoVerificado,false);
  });
  await test("renovar invalida el código anterior y un código vencido no verifica",async()=>{
    Desafio.docs.get(phone).ultimoEnvio=new Date(0);const viejo=enviado.codigo;await telefono.enviar(m);
    if(viejo!==enviado.codigo) await assert.rejects(()=>telefono.confirmar(m,{codigo:viejo}));
    Desafio.docs.get(phone).vence=new Date(0);await assert.rejects(()=>telefono.confirmar(m,{codigo:enviado.codigo}));assert.equal(Medico.docs.get(phone).telefonoVerificado,false);
  });
  await test("código correcto se consume una sola vez aunque lleguen peticiones simultáneas",async()=>{
    Desafio.docs.get(phone).ultimoEnvio=new Date(0);await telefono.enviar(m);
    const r=await Promise.allSettled([telefono.confirmar(m,{codigo:enviado.codigo}),telefono.confirmar(m,{codigo:enviado.codigo})]);assert.equal(r.filter(x=>x.status==="fulfilled").length,1);
    assert.equal(Medico.docs.get(phone).telefonoVerificado,true);assert.ok(Medico.docs.get(phone).telefonoVerificadoEn);
  });
  await test("caída del proveedor deja desafío inutilizable y teléfono sin verificar",async()=>{
    m=await crear("59172222222",{telefonoVerificado:false});fallaProveedor=true;await assert.rejects(()=>telefono.enviar(m),e=>e.status===502);fallaProveedor=false;
    await assert.rejects(()=>telefono.confirmar(m,{codigo:enviado.codigo}));assert.equal(Medico.docs.get(m.phone).telefonoVerificado,false);
  });
  await test("cuota de cinco envíos se aplica por cuenta y se renueva después de 24 horas",async()=>{
    m=await crear("59173333333",{telefonoVerificado:false});for(let i=0;i<5;i++){if(Desafio.docs.has(m.phone))Desafio.docs.get(m.phone).ultimoEnvio=new Date(0);await telefono.enviar(m);}
    Desafio.docs.get(m.phone).ultimoEnvio=new Date(0);await assert.rejects(()=>telefono.enviar(m),e=>e.status===429);
    Desafio.docs.get(m.phone).ventanaDesde=new Date(0);await telefono.enviar(m);assert.equal(Desafio.docs.get(m.phone).envios,1);
  });
  await test("los dos idiomas incluyen todas las nuevas etiquetas de perfil",()=>{
    const c={I18N:{es:{},pt:{}}};vm.createContext(c);for(const i of ["es","pt"])vm.runInContext(fs.readFileSync(path.join(ROOT,`public/i18n/${i}/perfilAcceso.js`),"utf8"),c);
    assert.deepEqual(Object.keys(c.I18N.es).sort(),Object.keys(c.I18N.pt).sort());
    for(const f of ["perfilAcceso","operador","auth","accesoGoogle","estudiantes"])for(const m of fs.readFileSync(path.join(ROOT,`public/js/${f}.js`),"utf8").matchAll(/t\("(perfil\.[^"]+)"\)/g))assert.ok(c.I18N.es[m[1]],m[1]);
  });
  console.log(`\n${n} pruebas aprobadas; persistencia y proveedores simulados explícitamente.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
