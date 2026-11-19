import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {startServer,adminLogin,password} from '../helpers.mjs';
import {requiredFields} from '../../assets/intake-model.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const axeSource=readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const browser=await chromium.launch();
try {
 for(const online of [false,true]) {
  const server=await startServer({MYO_PRICING_MODE:'launch',...(online?{MYO_PAYMENTS:'fake',MYO_STRIPE_WEBHOOK_SECRET:'review-test-secret'}:{})});
  try {
   const post=async(who,path,body)=>{const r=await server.call(who,'POST','/api/'+path,body);assert.equal(r.status,200,JSON.stringify(r.json));return r.json;};
   await post('staff','login',adminLogin);
   await post('staff','schedule',{days:[0,1,2,3,4,5,6],opens:'08:00',closes:'18:00',buffer:0});
   for(const name of ['Dog walking','Meet & Greet']) await post('staff','services',{name,minutes:30,cents:name==='Meet & Greet'?0:3000});
   for(const width of [1440,390]) for(const language of ['en','es']) {
    const who='review-'+width+'-'+language;
    await post(who,'register',{name:'Camila',email:who+'@example.test',password});
    await post(who,'pets',{name:'Coco',species:'Dog',details:'{"age":"4"}'});
    await post(who,'intake',{service:'walk',...Object.fromEntries(requiredFields('walk').map(key=>[key,key==='spendingLimit'?0:key==='vetAuthorization'?'no':'Care details']))});
    const catalog=(await server.call(who,'GET','/api/portal')).json;
    const meet=catalog.services.find(s=>s.kind==='meet');
    const days=(await server.call(who,'GET','/api/availability/days?service='+meet.id)).json.days;
    const date=days.filter(day=>day.open)[2].date;
    const time=(await server.call(who,'GET','/api/availability/times?service='+meet.id+'&date='+date)).json.times[0];
    const made=await post(who,'bookings',{service:meet.id,pets:[catalog.pets[0].id],slot:time.slot,start:time.start,cents:0,notes:''});
    for(const status of ['Confirmed','In Progress']) await post('staff','status',{id:made.id,status});
    await post('staff','status',{id:made.id,status:'Completed',summary:'Met Coco',secured:true});
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
    try {
     await context.addCookies([...server.cookies(who)].map(([name,value])=>({name,value,url:server.base})));
     await context.addInitScript(value=>localStorage.setItem('myo-language',value),language);
     const page=await context.newPage();
     await page.goto(server.base+'/portal/index.html?service=dog-walking#book');
     const form=page.locator('[data-action=bookings]');
     await form.locator('[name=pets]').check();
     await form.locator('[data-booking-summary] button[type=submit]:not([disabled])').waitFor();
     await form.locator('[data-booking-summary] button[type=submit]').click();
     const review=form.locator('[data-booking-review]');
     await review.locator('.review-terms').waitFor();
     assert.match(await review.innerText(),/48/);assert.match(await review.innerText(),/50/);
     assert.match(await review.innerText(),language==='es'?/Saldo restante/:/Remaining balance/);
     assert.match(await review.innerText(),online?(language==='es'?/Paga el depósito en línea/:/Pay the deposit online/):(language==='es'?/Coordina el depósito/:/Arrange the deposit/));
     await review.locator('button[type=submit]').click();
     await review.locator('#review-terms-error').filter({hasText:language==='es'?'Revisa y acepta':'Please review and accept'}).waitFor();
     assert.equal(await review.locator('[name=accept_terms]').evaluate(node=>node===document.activeElement),true);
     await review.locator('[name=accept_terms]').check();
     await page.locator('[data-language='+(language==='en'?'es':'en')+']').click();
     assert.equal(await review.locator('[name=accept_terms]').isChecked(),true);
     await page.locator('[data-language='+language+']').click();
     await page.evaluate(axeSource);
     const results=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
     assert.deepEqual(results.violations.map(v=>v.id),[]);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     if(process.env.MYO_REVIEW_SCREENSHOTS) await review.screenshot({path:join(process.env.MYO_REVIEW_SCREENSHOTS,(online?'online':'manual')+'-'+language+'-'+width+'.png')});
     if(!online && width===390 && language==='en') {
      await page.route('**/api/bookings',route=>route.fulfill({status:409,json:{code:'terms_changed'}}));
      await review.locator('button[type=submit]').click();
      await form.locator('[data-booking-inputs]:visible').waitFor();
      await page.unroute('**/api/bookings');
      await form.locator('[data-booking-summary] button[type=submit]:not([disabled])').waitFor();
      await form.locator('[data-booking-summary] button[type=submit]').click();
      await review.locator('.review-terms').waitFor();
      assert.equal(await review.locator('[name=accept_terms]').isChecked(),false,'Changed terms require fresh consent');
      await review.locator('[name=accept_terms]').check();
     }
     await review.locator('button[type=submit]').click();
     await page.locator('#feedback').filter({hasText:language==='es'?'Solicitud enviada':'Request sent'}).waitFor();
     const requests=(await server.call(who,'GET','/api/portal')).json.bookings.filter(b=>b.status==='Requested' && b.service_kind==='visit');
     assert.equal(requests.length,1);assert.ok(requests[0].terms_accepted_at);assert.ok(requests[0].terms_version);
     const payment=page.locator('[data-action="payments/start"][data-id="'+requests[0].id+'"]');
     assert.equal(await payment.count(),online?1:0);
     console.log('Financial review '+(online?'online':'manual')+' '+language+' '+width+'px passed');
    } finally {await context.close();}
   }
  } finally {await server.stop();}
 }
} finally {await browser.close();}
