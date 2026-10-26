// Middlewares reales y firmas reales, con reloj/HTTP/configuración simulados.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const ROOT = path.join(__dirname, '../..');
let reloj = Date.now(), n = 0;
class Fecha extends Date { static now() { return reloj; } }
function cargar(archivo, deps) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, archivo), 'utf8'), { module, exports: module.exports,
    require:k=>{if(k==='crypto')return crypto;if(Object.hasOwn(deps,k))return deps[k];throw new Error('Dependencia no simulada: '+k);},
    process:{env:{JWT_SECRET:'clave-local-solo-para-pruebas'}}, console, Buffer, Date:Fecha,
    setInterval:()=>({unref(){}}),
  }, {filename:archivo});
  return module.exports;
}
const auth = cargar('services/auth.js', {bcryptjs:{}});
const limites = cargar('services/ratelimit.js', {'../config':{log:{warn(){}}},'./auth':auth});
const req=(ip='192.0.2.1',body={})=>({headers:{},socket:{remoteAddress:ip},query:{},body});
function llamar(fn,r=req()) {
  let pasa=false;const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(d){this.data=d;return this;}};
  fn(r,res,()=>{pasa=true;});return {pasa,...res};
}
function test(nombre,fn){fn();n++;console.log('✅ '+nombre);}
const ticket=(id,rol='google_registro',duracion=600000)=>auth.generarToken(id,rol,duracion,{nonce:'nonce-test'});
test('abrir quince veces el botón no consume intentos de contraseña ni de acceso Google',()=>{
  for(let i=0;i<15;i++){assert.ok(llamar(limites.limitGoogleConfig).pasa);assert.ok(llamar(limites.limitGoogleInicio).pasa);}
  assert.ok(llamar(limites.limitGoogleEntrada).pasa);
  for(let i=0;i<8;i++)assert.ok(llamar(limites.limitAuth).pasa);
  assert.equal(llamar(limites.limitAuth).code,429);
  assert.ok(llamar(limites.limitGoogleConfig).pasa);assert.ok(llamar(limites.limitGoogleInicio).pasa);assert.ok(llamar(limites.limitGoogleEntrada).pasa);
});
test('los tres pasos de Google conservan límites separados y Retry-After',()=>{
  for(const [fn,tope,ip] of [[limites.limitGoogleConfig,120,'192.0.2.2'],[limites.limitGoogleInicio,60,'192.0.2.3'],[limites.limitGoogleEntrada,60,'192.0.2.4']]){
    for(let i=0;i<tope;i++)assert.ok(llamar(fn,req(ip)).pasa);
    const r=llamar(fn,req(ip));assert.equal(r.code,429);assert.ok(r.data.retryAfter>0);assert.equal(r.headers['Retry-After'],r.data.retryAfter);
  }
});
test('un router compartido permite registros de identidades Google distintas sin agotar auth',()=>{
  for(let i=0;i<20;i++)assert.ok(llamar(limites.limitRegistro,req('192.0.2.5',{googleTicket:ticket('persona-'+i)})).pasa);
  for(let i=0;i<8;i++)assert.ok(llamar(limites.limitAuth,req('192.0.2.5')).pasa);
});
test('cambiar IP o renovar el ticket no evade el límite de la misma identidad Google',()=>{
  for(let i=0;i<8;i++)assert.ok(llamar(limites.limitRegistro,req('192.0.2.'+(20+i),{googleTicket:ticket('misma')})).pasa);
  assert.equal(llamar(limites.limitRegistro,req('192.0.2.29',{googleTicket:ticket('misma')})).code,429);
});
test('tickets falsificados, vencidos, demasiado grandes o de otro rol no elevan la cuota de contraseña',()=>{
  const falsos=['falso',ticket('otro','medico'),ticket('vencido','google_registro',-1),'x'.repeat(12001),ticket('alterado').slice(0,-6)+'xxxxxx'];
  for(let i=0;i<8;i++)assert.ok(llamar(limites.limitRegistro,req('192.0.2.6',{googleTicket:falsos[i%falsos.length]})).pasa);
  assert.equal(llamar(limites.limitRegistro,req('192.0.2.6')).code,429);
});
test('el límite de ocho intentos por contraseña se mantiene aunque se agote la preparación Google',()=>{
  for(let i=0;i<61;i++)llamar(limites.limitGoogleInicio,req('192.0.2.7'));
  for(let i=0;i<8;i++)assert.ok(llamar(limites.limitAuth,req('192.0.2.7')).pasa);
  assert.equal(llamar(limites.limitAuth,req('192.0.2.7')).code,429);
});
test('la cuota vuelve a estar disponible al vencer la ventana',()=>{
  reloj+=600001;assert.ok(llamar(limites.limitAuth).pasa);assert.ok(llamar(limites.limitGoogleInicio,req('192.0.2.3')).pasa);
});
test('las rutas reales montan cada limitador en la etapa correspondiente',()=>{
  const rutas={};const app={get:(p,...h)=>rutas[p]=h,post:(p,...h)=>rutas[p]=h};
  cargar('routes/googleAuth.js',{'../db/models':{},'../services/googleAcceso':{},'../services/auth':{requireAuth:()=>()=>{}},
    '../services/totp':{},'../services/sesionMedico':{},'../services/auditoria':{},'../services/ratelimit':limites,
    '../services/httpHelpers':{asyncRoute:fn=>fn}})(app);
  assert.equal(rutas['/medico/google/config'][0],limites.limitGoogleConfig);
  assert.equal(rutas['/medico/google/iniciar'][0],limites.limitGoogleInicio);
  assert.equal(rutas['/medico/google/entrar'][0],limites.limitGoogleEntrada);
  assert.equal(rutas['/medico/google/vincular'][0],limites.limitAuth);
  for(const f of ['routes/medicoAuth.js','modulos/estudiantes/rutas/cuenta.js'])assert.match(fs.readFileSync(path.join(ROOT,f),'utf8'),/app.post\("\/medico\/registro(?:-estudiante)?", limitRegistro,/);
});
console.log(`\n${n} pruebas de límites aprobadas.`);
