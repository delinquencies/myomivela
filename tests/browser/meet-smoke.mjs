import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password } from '../helpers.mjs';

const playwright = await import('playwright').catch(() => {
  const root = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(join(root,'playwright','index.mjs')));
});
const browser = await playwright.chromium.launch();
const server = await startServer();
const post = async (who, path, body) => {
  const result = await server.call(who,'POST','/api/'+path,body);
  assert.equal(result.status,200,result.json?.error);
  return result.json;
};

try {
  await post('staff','login',adminLogin);
  await post('staff','services',{ name:'Dog walking',minutes:30,cents:3000 });
  await post('staff','services',{ name:'Meet & Greet',minutes:30,cents:0 });
  await post('staff','schedule',{ days:[0,1,2,3,4,5,6],opens:'08:00',closes:'18:00',buffer:0 });
  await post('customer','register',{ name:'Casey', email:'meet@example.test',password });
  await post('customer','pets',{ name:'Cooper',species:'Dog',details:'' });
  const context = await browser.newContext({ viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce' });
  await context.addCookies([...server.cookies('customer')].map(([name,value]) => ({name,value,url:server.base})));
  const page = await context.newPage();
  await page.goto(server.base+'/portal/index.html#client-home');
  await page.getByRole('link',{name:'Book a free Meet & Greet'}).waitFor();

  await page.goto(server.base+'/#how');
  const href = 'portal/index.html?service=meet#book';
  assert.equal(await page.getByRole('link',{name:'Book a free Meet & Greet'}).getAttribute('href'),href);
  await page.getByLabel('Menu',{exact:true}).tap();
  await page.locator('[data-language="es"]').tap();
  await page.getByLabel('Menú',{exact:true}).tap();
  const link = page.getByRole('link',{name:'Reservar una Visita de Presentación Gratuita (Meet & Greet)'});
  assert.equal(await link.getAttribute('href'),href);
  await link.tap();

  const booking = page.locator('[data-action="bookings"]');
  await booking.waitFor();
  assert.match(await booking.locator('[name=service]:checked').locator('xpath=..').innerText(),/Meet & Greet.*Gratis/);
  await booking.locator('[name=pets]').locator('xpath=..').tap();
  await booking.getByRole('button',{name:'Revisar reserva'}).tap();
  await booking.getByText('Sin costo',{exact:true}).waitFor();
  assert.doesNotMatch(await booking.locator('[data-booking-review]').innerText(),/pago en línea/);
  await booking.getByRole('button',{name:'Enviar solicitud de reserva'}).tap();
  await page.locator('#feedback').filter({hasText:'Solicitud enviada.'}).waitFor();

  const { json:{ bookings } } = await server.call('customer','GET','/api/portal');
  const visit = bookings.find(row => row.service_name === 'Meet & Greet');
  assert.equal(visit?.cents,0);
  await post('staff','status',{ id:visit.id,status:'Confirmed' });
  await post('staff','status',{ id:visit.id,status:'In Progress' });
  await post('staff','status',{ id:visit.id,status:'Completed',summary:'We met Cooper.',secured:true });
  await page.goto(server.base+'/portal/index.html#client-home');
  await page.reload();
  await page.getByRole('heading',{name:'Inicio de clientes'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Reservar una Visita de Presentación Gratuita (Meet & Greet)'}).count(),0);
  console.log('Free Meet & Greet passed through booking and completion');
} finally {
  await browser.close();
  await server.stop();
}
