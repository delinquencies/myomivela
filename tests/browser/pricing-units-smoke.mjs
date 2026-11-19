import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startServer,adminLogin,password} from '../helpers.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const server=await startServer(),browser=await chromium.launch();
const post=async(who,path,body)=>{const r=await server.call(who,'POST','/api/'+path,body);assert.equal(r.status,200,r.json?.error);return r.json;};
try {
  await post('staff','login',adminLogin);
  await post('staff','services',{name:'Dog walking',minutes:30,cents:3000});
  await post('staff','services',{name:'Overnight pet sitting',minutes:720,cents:9500});
  await post('staff','schedule',{days:[0,1,2,3,4,5,6],opens:'08:00',closes:'18:00',buffer:0,overnight_days:[0,1,2,3,4,5,6]});
  await post('customer','register',{name:'Camila',email:'pricing-units@example.test',password});
  await post('customer','pets',{name:'Coco',species:'Dog',details:''});
  const problems=[];
  for(const width of [1440,390]) for(const language of ['en','es']) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
    try {
      await context.addInitScript(value=>localStorage.setItem('myo-language',value),language);
      const page=await context.newPage();page.on('pageerror',error=>problems.push(error.message));
      await page.goto(server.base+'/');
      const night=page.locator('[data-service-price="Overnight pet sitting"]');
      await night.filter({hasText:language==='es'?'por noche':'per night'}).waitFor();
      assert.doesNotMatch(await night.innerText(),/720|min/);
      assert.match(await page.locator('[data-service-price="Dog walking"]').textContent(),/30 min/);
      await page.goto(server.base+'/portal/index.html?service=pet-sitting#book');
      const sheet=page.locator('[data-auth-price-sheet]');
      await sheet.locator('.rate-list').waitFor();
      assert.match(await sheet.innerText(),language==='es'?/por noche/:/per night/);
      assert.match(await sheet.innerText(),language==='es'?/noches disponibles/:/available nights/);
      assert.doesNotMatch(await sheet.innerText(),/720|No available times/);
      assert.ok(await sheet.locator('.rate-list li ul li').count()>0);
      await context.addCookies([...server.cookies('customer')].map(([name,value])=>({name,value,url:server.base})));
      await page.reload();
      const form=page.locator('[data-action=bookings]');await form.waitFor();
      const choices=await form.locator('[name=service]').evaluateAll(inputs=>inputs.map(input=>input.parentElement.textContent));
      assert.ok(choices.some(label=>/30 min/.test(label)));
      assert.ok(choices.some(label=>language==='es'?/por noche/.test(label):/per night/.test(label)));
      assert.ok(choices.every(label=>!label.includes('720')));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      console.log('Pricing units '+language+' '+width+'px passed');
    } finally {await context.close();}
  }
  assert.deepEqual(problems,[]);
} finally {await browser.close();await server.stop();}
