import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startServer,adminLogin,password} from '../helpers.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch(),server=await startServer();
const post=async(who,path,body)=>{const r=await server.call(who,'POST','/api/'+path,body);assert.equal(r.status,200,r.json?.error);return r.json;};
try {
  await post('staff','login',adminLogin);
  await post('staff','services',{name:'Dog walking',minutes:30,cents:3000});
  await post('staff','services',{name:'Overnight pet sitting',minutes:720,cents:9500});
  await post('staff','schedule',{days:[0,1,2,3,4,5,6],opens:'08:00',closes:'20:00',buffer:0,overnight_days:[0,1,2,3,4,5,6]});
  await post('customer','register',{name:'Casey',email:'ergonomics@example.test',password});
  await post('customer','pets',{name:'Cooper',species:'Dog',details:''});
  const pet=(await server.call('customer','GET','/api/portal')).json.pets[0];
  const problems=[];
  for(const width of [1440,390]) for(const language of ['en','es']) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
    try {
      await context.addCookies([...server.cookies('customer')].map(([name,value])=>({name,value,url:server.base})));
      await context.addInitScript(value=>localStorage.setItem('myo-language',value),language);
      const page=await context.newPage();
      page.on('pageerror',error=>problems.push(error.message));
      let expectedDay;
      await page.route('**/api/availability/days?*',async route=>{
        const response=await route.fetch(),body=await response.json();
        const open=body.days.filter(date=>date.open);
        expectedDay=open[2].date;
        body.default_day=expectedDay;
        open[0].open=false;open[0].full=true;
        open[1].last_minute=true;
        open[2].peak=true;
        await route.fulfill({response,json:body});
      });
      await page.route('**/api/quote',async route=>route.fulfill({json:{total_cents:3000,lines:[],blockers:[
        {code:'vaccine_missing',pet_id:pet.id,vaccine:'Rabies'},
        {code:'vaccine_expired',pet_id:pet.id,vaccine:'Bordetella',expires:'2026-01-01'},
        {code:'agreement_required'},{code:'meet_required'},
      ]}}));
      await page.goto(server.base+'/portal/index.html?service=dog-walking#book');
      const form=page.locator('[data-action=bookings]');
      await page.waitForFunction(value=>document.querySelector('[data-booking-days]')?.textContent.includes(value),language==='es'?'Temporada alta':'Peak day');
      assert.equal(await form.locator('[name=day]:checked').inputValue(),expectedDay);
      await form.locator('[name=pets]').check();
      await form.locator('[data-quote-status] a').first().waitFor();
      assert.equal(await form.locator('[data-quote-status] a').count(),4);
      assert.equal(await form.locator('[data-booking-summary] a').count(),0);
      assert.equal(await form.locator('[data-booking-summary] button').isDisabled(),true);
      const dock=await form.locator('[data-booking-summary]').boundingBox();
      assert.ok(dock.height <= 211,'Dock stays below 25% of the mobile viewport: '+dock.height);
      const more=form.locator('.more-times').first();
      await more.locator('summary').click();
      await more.locator('label').last().click();
      assert.ok(await form.locator('[name=slot]:checked').inputValue());
      const nextDay=form.locator('[name=day]').nth(1);
      await nextDay.locator('xpath=..').click();
      const chosenDay=await nextDay.inputValue();
      await page.locator('[data-language="'+(language==='en'?'es':'en')+'"]').click();
      await page.waitForFunction(value=>document.querySelector('[name=day]:checked')?.value===value,chosenDay);
      assert.equal(await form.locator('[name=day]:checked').inputValue(),chosenDay);
      await page.locator('[data-language="'+language+'"]').click();
      await page.goto(server.base+'/portal/index.html?service=pet-sitting#book');
      await form.locator('[data-stay-date]').first().waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const dates=form.locator('[data-stay-date]:visible');
      assert.ok(await dates.count()>0,'Calendar fits at 390px');
      for(const target of [dates.first(),page.locator('.site-header .wordmark')]){
        const bounds=await target.boundingBox();assert.ok(bounds.width>=44 && bounds.height>=44,JSON.stringify(bounds));
      }
      await page.goto(server.base+'/portal/index.html#pets');
      const help=page.locator('.pet-field-tip summary').first();
      const bounds=await help.boundingBox();assert.ok(bounds.width>=44 && bounds.height>=44);
      if(width===390){
        await page.goto(server.base+'/portal/index.html?service=pet-sitting#book');
        await form.locator('[name=stay_start]').waitFor();
        await page.setViewportSize({width:320,height:568});
        assert.equal(await form.locator('[data-stay-date]:visible').count(),0);
        assert.equal(await form.locator('[name=stay_start]').isVisible(),true);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await form.locator('[name=stay_end]').isVisible(),true);
      }
      console.log('Booking ergonomics '+language+' '+width+'px passed');
    } finally {await context.close();}
  }
  assert.deepEqual(problems,[]);
} finally {await browser.close();await server.stop();}
