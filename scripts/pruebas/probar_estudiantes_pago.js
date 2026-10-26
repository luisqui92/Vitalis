// Flujo de pago educativo con DOM y API controlados. No realiza transferencias.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raiz = path.join(__dirname, '../..');
async function pantalla(pago, idioma = 'es') {
  const nodos = new Map();
  const nodo = id => {
    if (!nodos.has(id)) nodos.set(id, { innerHTML: '', isConnected: true });
    return nodos.get(id);
  };
  const s = {
    app: { innerHTML: '' }, document: { getElementById: nodo },
    localStorage: { getItem: () => null }, I18N: { es: {}, pt: {} },
    Extensiones: { moduloPrendido: () => true, agregar() {}, negar() {}, pantalla() {} },
    detenerPolling() {}, irAPantallaInicial() {}, svgIcono: () => '',
    esc: x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    api: async () => ({ pago, suscripcion: { precios: { mensualTexto: 'Bs 100.00' }, horasMes: 3 } }),
  };
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(raiz, `public/i18n/${idioma}/estudiantes.js`), 'utf8'), s);
  s.t = (k, valores = {}) => (s.I18N[idioma][k] || k).replace(/\{(\w+)\}/g, (_, v) => valores[v] ?? '');
  vm.runInContext(fs.readFileSync(path.join(raiz, 'public/js/estudiantes.js'), 'utf8'), s);
  await s.renderPlanEstudiante();
  return nodo('estPlanCaja').innerHTML;
}
(async () => {
  const qr = '/pago-qr.jpg', whatsapp = '59170000000';
  const completo = await pantalla({ qr, whatsapp, banco: 'Banco', cuenta: '123', titular: '<Titular>', configurado: true });
  assert.ok(completo.includes('1. Realizá el pago'));
  assert.ok(completo.includes('2. Enviá tu comprobante'));
  assert.ok(completo.includes('download'));
  assert.ok(completo.includes('correo con el que ingresás'));
  assert.ok(completo.includes('&lt;Titular&gt;'));
  const enlace = completo.match(/href="(https:\/\/wa.me\/[^\"]+)"/)[1];
  const destino = new URL(enlace);
  assert.equal(destino.pathname, '/' + whatsapp);
  assert.ok(destino.searchParams.get('text').includes('Bs 100.00'));
  console.log('✅ QR descargable, instrucciones y WhatsApp con importe; datos escapados');

  const soloQr = await pantalla({ qr, whatsapp, configurado: true });
  assert.ok(soloQr.includes('<img'));
  assert.ok(!soloQr.includes('Cuenta:'));
  assert.ok(!soloQr.includes('Titular:'));
  console.log('✅ QR sin cuenta bancaria no genera etiquetas vacías');

  for (const contacto of ['', '123', '0000000', '591123456789012345']) {
    const html = await pantalla({ qr, whatsapp: contacto, configurado: true });
    assert.ok(html.includes('antes de pagar'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('https://wa.me'));
    assert.ok(html.includes('estPlanVolver'));
  }
  console.log('✅ QR sin canal de comprobantes válido no invita a transferir');

  const soloContacto = await pantalla({ whatsapp });
  assert.ok(soloContacto.includes('Consultar cómo pagar'));
  assert.ok(!soloContacto.includes('<img'));
  const banco = await pantalla({ banco: 'Banco', cuenta: '123', whatsapp });
  assert.ok(banco.includes('Cuenta: 123'));
  assert.ok(banco.includes('Enviar comprobante'));
  console.log('✅ Transferencia sin QR y consulta sin datos bancarios');

  const inseguro = await pantalla({ qr: 'javascript:alert(1)', whatsapp, configurado: true });
  assert.ok(!inseguro.includes('javascript:'));
  assert.ok(!inseguro.includes('<img'));
  const externo = await pantalla({ qr: 'https://example.test/qr.png', whatsapp });
  assert.ok(externo.includes('Abrir QR'));
  assert.ok(!externo.includes('download'));
  const portugues = await pantalla({ qr, whatsapp }, 'pt');
  assert.ok(portugues.includes('Baixar QR'));
  assert.ok(portugues.includes('anexe a foto'));
  console.log('✅ URL de QR validada, alternativa para imagen externa y portugués');
})().catch(e => { console.error(e); process.exitCode = 1; });
