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
        case "$ne": return Array.isArray(actual) ? !actual.includes(x) : actual !== x; case "$exists": return (actual !== undefined) === x;
        case "$in": return x.some(a => a == null ? actual == null : a === actual); default: throw new Error(op); }
    });
    return actual instanceof Date && v instanceof Date ? +actual === +v : actual === v;
  });
}
function modelo() {
  const docs = new Map();
  function query(value) { return { select() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return Promise.resolve(structuredClone(value)); }, then(a, b) { return Promise.resolve(structuredClone(value)).then(a, b); } }; }
  function update(d, u) { for (const [k,v] of Object.entries(u.$set || {})) set(d,k,structuredClone(v)); for (const k of Object.keys(u.$unset || {})) set(d,k,null,true); for (const [k,v] of Object.entries(u.$push || {})) set(d,k,[...(get(d,k)||[]),v]); for (const [k,v] of Object.entries(u.$inc || {})) set(d,k,(get(d,k)||0)+v); }
  return { docs, async create(d) { if (docs.has(d._id)) throw Object.assign(new Error("duplicate"), { code: 11000 }); docs.set(d._id,structuredClone(d)); return structuredClone(d); },
    findOne(q) { return query([...docs.values()].find(d => matches(d,q)) || null); }, find(q) { return query([...docs.values()].filter(d => matches(d,q))); },
    async updateOne(q,u) { const d=[...docs.values()].find(d=>matches(d,q)); if (!d) return { matchedCount:0,modifiedCount:0 }; update(d,u); return { matchedCount:1,modifiedCount:1 }; },
    async findOneAndUpdate(q,u) { const d=[...docs.values()].find(d=>matches(d,q)); if (!d) return null; update(d,u); return structuredClone(d); },
  };
}
const Medico=modelo(), PruebaEstudiante=modelo(), ConsultaMedica=modelo();
for (const m of [Medico,PruebaEstudiante,ConsultaMedica]) {
  m.init=async()=>{};m.findById=id=>m.findOne({_id:String(id)});
  m.deleteOne=async q=>{const d=[...m.docs.values()].find(x=>matches(x,q));if(d)m.docs.delete(d._id);};
}
const createClaim=PruebaEstudiante.create;
PruebaEstudiante.create=async d=>{if([...PruebaEstudiante.docs.values()].some(x=>x.phone===d.phone))throw Object.assign(new Error('duplicado'),{code:11000});return createClaim(d);};
const createMedico=Medico.create;let fallaCrear=false;
Medico.create=async d=>{if(fallaCrear)throw new Error('persistencia simulada');return createMedico({_id:d.googleSub,...d});};
const carreras=require('../../modulos/estudiantes/carreras');
const trial=cargar('modulos/estudiantes/prueba.js',{'../../db/models':{Medico,ConsultaMedica},'./modelos':{PruebaEstudiante},'./carreras':carreras,
  '../../services/zonaHoraria':{zonaPorMoneda:()=> 'America/La_Paz'},'../../services/httpHelpers':helpers,'../../services/googleAcceso':{configuracion:()=>({})}});
const cuenta=cargar('modulos/estudiantes/cuenta.js',{'../../db/models':{ConsultaMedica,VistaPrevia:modelo()},'./carreras':carreras,'./prueba':trial});
const planes=cargar('modulos/estudiantes/planes.js',{'../../db/models':{Medico},'../../services/monedas':{normalizar:m=>m||'BOB',conSimbolo:(c,m)=>`${m} ${c/100}`},'../../services/httpHelpers':helpers,'../../services/auditoria':{registrar(){}},'./cuenta':cuenta});
let sec=0;
const datos=()=>({google:{googleSub:`google-${++sec}`,googleEmail:'prueba@example.test',googleSolo:true},phone:`59170000${sec}`,nombre:'Prueba',universidad:'U',periodo:'2',idioma:'es',carrera:'odontologia',nivel:'estudiante'});
async function crear(extra={}){return trial.registrar({...datos(),...extra});}
const ctx=(m,id)=>({req:{adminUser:{usuario:m.phone,estudiante:true}},consultaId:id});
(async()=>{
 await test('registro sin invitación: tres días, 900 segundos y solo permisos educativos',async()=>{
   const m=await crear({rol:'admin',horasMes:999,activo:false});
   assert.equal(m.perfilAcceso,'educativo');assert.equal(m.rol,undefined);assert.equal(m.estudiante.horasMes,.25);assert.equal(m.telefonoVerificado,false);
   assert.equal(m.estudiante.hasta-m.estudiante.prueba.desde,3*86400000);assert.equal(m.formacion.acreditacion,'declarada');assert.equal(m.suscripcion.precioCentavos,0);
 });
 await test('carrera y nivel válidos: no acepta roles o residencia de odontología inventados',async()=>{
   for(const e of [{carrera:'__proto__'},{carrera:'otra'},{nivel:'admin'},{nivel:'residente'}])await assert.rejects(()=>crear(e),e=>e.status===400);
   assert.equal((await crear({carrera:'medicina',nivel:'residente'})).estudiante.nivel,'residente');
 });
 await test('el servicio no admite alta gratuita sin identidad Google verificada',async()=>{await assert.rejects(()=>crear({google:null}),e=>e.status===400);});
 await test('un Google y un teléfono no reciben dos pruebas, tampoco en peticiones simultáneas',async()=>{
   const d=datos();const r=await Promise.allSettled([trial.registrar(d),trial.registrar(d)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
   await assert.rejects(()=>crear({phone:d.phone}),e=>e.status===409);await assert.rejects(()=>crear({google:d.google}),e=>e.status===409);
 });
 await test('si falla la creación de la cuenta se libera la reserva de alta',async()=>{
   const d=datos();fallaCrear=true;await assert.rejects(()=>trial.registrar(d));fallaCrear=false;assert.ok(!PruebaEstudiante.docs.has(d.google.googleSub));await trial.registrar(d);
 });
 await test('dos subidas simultáneas solo reservan el cupo una vez',async()=>{
   const m=await crear(), a=ctx(m,'audio1'), b=ctx(m,'audio2');const r=await Promise.allSettled([trial.reservar(a),trial.reservar(b)]);
   assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(PruebaEstudiante.docs.get(m.googleSub).usados,900);
   const ganador=a.limitesAudio?a:b;assert.equal(ganador.limitesAudio.segundos,900);
 });
 await test('finalizar devuelve solo los segundos no usados y no puede devolverlos dos veces',async()=>{
   const m=await crear(), c=ctx(m,'corto');await trial.reservar(c);const fin={consulta:{_id:'corto',limitesAudio:c.limitesAudio},duracionSegundos:100};
   await trial.completar(fin);await trial.completar(fin);assert.equal(PruebaEstudiante.docs.get(m.googleSub).usados,100);
   const otro=ctx(m,'resto');await trial.reservar(otro);assert.equal(otro.limitesAudio.segundos,800);
   await trial.completar({consulta:{_id:'resto',limitesAudio:otro.limitesAudio},duracionSegundos:5000});
   assert.equal(PruebaEstudiante.docs.get(m.googleSub).usados,900);await assert.rejects(()=>trial.reservar(ctx(m,'extra')),e=>e.status===402);
 });
 await test('fallo al guardar el audio devuelve la reserva, no concede minutos adicionales',async()=>{
   const m=await crear(), c=ctx(m,'disco');await trial.reservar(c);await trial.descartar(c);await trial.descartar(c);assert.equal(PruebaEstudiante.docs.get(m.googleSub).usados,0);
 });
 await test('tras reinicio se concilia una transcripción ya guardada antes de aceptar otra',async()=>{
   const m=await crear(), c=ctx(m,'guardada');await trial.reservar(c);
   await ConsultaMedica.create({_id:'guardada',estado:'completado',duracionSegundos:120,limitesAudio:c.limitesAudio});
   assert.equal((await trial.estado(m)).usados,120);assert.equal((await trial.estado(m)).usados,120);
 });
 await test('cambio de mes no renueva los minutos; vencimiento bloquea nuevas grabaciones',async()=>{
   const m=await crear();PruebaEstudiante.docs.get(m.googleSub).usados=840;
   const futuro=new Date(m.estudiante.hasta.getTime()+86400000);const e=await cuenta.estadoDe(m,futuro);
   assert.equal(e.segundosRestantes,60);assert.equal(e.vencido,true);assert.equal(e.prueba,true);
   PruebaEstudiante.docs.get(m.googleSub).hasta=new Date(0);await assert.rejects(()=>trial.reservar(ctx(m,'vencido')),e=>e.status===402);
 });
 await test('la prueba no abre transcripción en vivo; cuentas de pago conservan el comportamiento',async()=>{
   const m=await crear(), c=ctx(m,'vista');await trial.vistaPrevia(c);assert.equal(c.sinVistaPrevia,true);
   Medico.docs.get(m._id).estudiante.prueba.activa=false;const pago=ctx(m,'pago');await trial.vistaPrevia(pago);assert.equal(pago.sinVistaPrevia,undefined);
 });
 await test('plan educativo tiene precios propios y la prueba no se presenta como plan pagado',async()=>{
   const m=await crear();const s=planes.estado({medico:m}).suscripcion;assert.equal(s.activa,false);assert.equal(s.prueba,true);assert.equal(s.precios.mensual,10000);
   const r=await crear({carrera:'medicina',nivel:'residente'});assert.equal(planes.oferta(r).mensual,15000);
 });
 await test('pago desde el panel habilita horas del plan y conserva la identidad y el perfil educativo',async()=>{
   const m=await crear();const c={medico:m,plan:'mensual',referencia:'pago-1',quien:'operador',req:{}};await planes.activar(c);
   const d=Medico.docs.get(m._id);assert.equal(d.estudiante.prueba.activa,false);assert.equal(d.estudiante.horasMes,3);assert.equal(d.googleSub,m.googleSub);assert.equal(d.perfilAcceso,'educativo');assert.equal(d.suscripcion.ambito,'educativo');
   assert.ok(c.respuesta.ok);await assert.rejects(()=>planes.activar({...c,medico:structuredClone(d)}),e=>e.status===409);
 });
 await test('dos activaciones con la misma referencia solo renuevan una vez',async()=>{
   const m=await crear();const c={medico:m,plan:'mensual',referencia:'simultaneo',quien:'operador',req:{}};
   const r=await Promise.allSettled([planes.activar({...c}),planes.activar({...c})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 });
 await test('AssemblyAI recibe el límite del servidor y los audios ordinarios no se recortan',async()=>{
   const pedidos=[];const assembly=cargar('services/assemblyai.js',{'./idiomas':{idiomaSoportado:i=>i,perfil:()=>({transcripcion:{porEspecialidad:{},generales:[],farmacos:[]}})},'../config':{CONFIG:{ASSEMBLYAI_API_KEY:'simulada',TIMEOUT_ASSEMBLYAI:1000,TIMEOUT_TRANSCRIPCION_TOTAL:1000},log:{warn(){},info(){}}},axios:{
     post:async(url,body)=>{pedidos.push({url,body});return{data:url.endsWith('/upload')?{upload_url:'https://example.test/audio'}:{id:'job'}};},
     get:async()=>({data:{status:'completed',audio_duration:120,text:'prueba',utterances:[]}})
   }});
   await assembly.transcribirConsultaMedica(Buffer.from('audio'),'odontologia','es',{maxSegundos:800});
   assert.equal(pedidos.find(p=>p.url.endsWith('/transcript')).body.audio_end_at,800000);
   pedidos.length=0;await assembly.transcribirConsultaMedica(Buffer.from('audio'),'odontologia','es');assert.equal(pedidos.find(p=>p.url.endsWith('/transcript')).body.audio_end_at,undefined);
 });
 await test('la ruta pública crea una prueba sin código e ignora permisos, duración y precio enviados',async()=>{
   const rutas={};const app={get:(p,...h)=>rutas[p]=h.at(-1),post:(p,...h)=>rutas[p]=h.at(-1)};
   const d=datos();let identidad=d.google;
   cargar('modulos/estudiantes/rutas/cuenta.js',{
    '../../../db/models':{Medico},'../modelos':{CodigoEstudiante:{}},'../prueba':trial,
    '../../../services/auth':{requireAuth:()=>()=>{},hashPassword:async()=>''},'../../../services/auditoria':{registrar(){}},
    '../../../services/ratelimit':{},'../../../services/httpHelpers':helpers,
    '../../../services/telefono':{soloDigitos:p=>String(p||'').replace(/\D/g,''),buscarPorTelefono:async(_m,p)=>Medico.findOne({phone:p})},
    '../../../services/zonaHoraria':{zonaPorMoneda:()=> 'America/La_Paz'},
    '../../../services/sesionMedico':{tokenDeMedico:()=> 'sesion-educativa',datosDeSesion:m=>({estudiante:m.estudiante})},
    '../../../config':{log:{info(){}}},'../cuenta':cuenta,'../carreras':carreras,
    '../../../services/googleAcceso':{identidadParaRegistro:async()=>identidad},
   }).registro(app);
   const body={...d,google:undefined,perfilSolicitado:'estudiante',codigo:'',phone:d.phone,horasMes:999,meses:24,precioCentavos:0,rol:'admin'};
   const pedir=async()=>{const res={code:200,status(c){this.code=c;return this;},json(data){this.data=data;return this;}};await rutas['/medico/registro-estudiante']({body},res);return res;};
   const r=await pedir();assert.equal(r.code,200);assert.equal(r.data.estudiante.horasMes,.25);assert.ok(r.data.token);
   assert.equal((await pedir()).code,409);identidad=null;body.phone='59199999999';assert.equal((await pedir()).code,400);
 });
 await test('la pantalla de estudiantes ofrece Google sin código obligatorio y limita los niveles por carrera',async()=>{
   const nodos=new Map(), hooks={};const nodo=id=>{if(!nodos.has(id))nodos.set(id,{value:'',innerHTML:'',textContent:'',isConnected:true,querySelector:()=>nodo('residente')});return nodos.get(id);};
   let googlePintado=0;const s={console,document:{getElementById:nodo},localStorage:{getItem:()=>null},
     app:{innerHTML:''},detenerPolling(){},t:k=>k,esc:x=>String(x),svgIcono:()=>'',selectorIdiomaHtml:()=>'',cablearSelectorIdioma(){},
     renderLogin(){},pintarBotonGoogle:async()=>{googlePintado++;},api:async()=>({disponible:true}),
     Extensiones:{moduloPrendido:()=>true,agregar:(k,fn)=>hooks[k]=fn,negar(){},pantalla(){}}};
   vm.createContext(s);vm.runInContext(fs.readFileSync(path.join(ROOT,'public/js/estudiantes.js'),'utf8'),s);
   await s.renderRegistroEstudiante();assert.equal(googlePintado,1);assert.ok(!s.app.innerHTML.includes('id="eCodigo"'));
   const p=hooks['registro.google']([])[0];assert.ok(p.html.includes('<details>'));assert.ok(!p.html.includes('required'));
   nodo('gCodigo').value='';nodo('gCarrera').value='odontologia';nodo('gNivel').value='residente';p.alPintar();
   assert.equal(nodo('residente').disabled,true);assert.equal(nodo('gNivel').value,'');nodo('gNivel').value='estudiante';
   assert.equal(p.datos().codigo,'');nodo('gCarrera').value='medicina';nodo('gCarrera').onchange();assert.equal(nodo('residente').disabled,false);
 });
 console.log(`\n${n} pruebas aprobadas; MongoDB, red y proveedores simulados.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
