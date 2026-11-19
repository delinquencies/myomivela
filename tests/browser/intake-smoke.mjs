import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {startServer,password} from '../helpers.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const axeSource=readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const server=await startServer(),browser=await chromium.launch(),problems=[];
const post=async(who,path,body)=>{const r=await server.call(who,'POST','/api/'+path,body);assert.equal(r.status,200,r.json?.error);return r.json;};
try {
  for(const width of [1440,390]) for(const language of ['en','es']) {
    const who='intake-'+width+'-'+language;
    await post(who,'register',{name:'Camila',email:who+'@example.test',password});
    for(const name of ['Coco','Luna']) await post(who,'pets',{name,species:'Dog',details:JSON.stringify({food:'Dry food',portion:'One cup',feeding:'Breakfast',health:'None known',medication:'None'})});
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
    try {
      await context.addCookies([...server.cookies(who)].map(([name,value])=>({name,value,url:server.base})));
      await context.addInitScript(value=>localStorage.setItem('myo-language',value),language);
      const page=await context.newPage();
      page.on('pageerror',error=>problems.push(error.message));
      await page.goto(server.base+'/portal/index.html#care');
      const form=page.locator('[data-care-action=intake]');
      await form.waitFor();
      const save=form.locator('[data-intake-save]');
      const go=step=>form.locator('.intake-progress [data-intake-go="'+step+'"]').click();
      const panel=step=>form.locator('[data-intake-step="'+step+'"]:visible');
      assert.match(await form.locator('[name=feeding]').inputValue(),/Coco.*One cup[\s\S]*Luna.*One cup/);
      await save.click();
      assert.equal(await form.locator('[name=service]').first().getAttribute('aria-invalid'),'true');
      assert.equal(await form.locator('[name=service]').first().evaluate(node=>node===document.activeElement),true);
      await form.locator('[name=service][value=walk]').check();
      await form.locator('[name=feeding]').fill('Coco: breakfast at eight. Luna: dinner at six.');
      await go(1);
      await form.locator('[name=health]').fill('PRIVATE_HEALTH_UNSAVED');
      await go(0);
      await page.waitForFunction(()=>Object.entries(sessionStorage).some(([,value])=>value.includes('breakfast at eight')));
      assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('PRIVATE_HEALTH_UNSAVED')),false);
      await page.reload();
      await panel(0).waitFor();
      assert.match(await form.locator('[name=feeding]').inputValue(),/breakfast at eight/);
      assert.doesNotMatch(await form.locator('[name=health]').inputValue(),/PRIVATE_HEALTH/);
      await save.click();
      assert.equal(await form.locator('[name=behavior]').getAttribute('aria-invalid'),'true');
      await form.locator('[name=behavior]').fill('Both enjoy a quiet walk.');
      await save.click();
      await panel(1).waitFor();
      assert.equal(await panel(1).locator('legend').first().evaluate(node=>node===document.activeElement),true);
      const routines=(await server.call(who,'GET','/api/intake')).json;
      assert.equal(routines.complete,false);
      assert.match(routines.feeding,/breakfast at eight/);
      await form.locator('[name=health]').fill('No known conditions.');
      await form.locator('[name=medication]').fill('None.');
      await form.locator('[name=vaccines]').fill('Records will be shared with Myomi.');
      await page.route('**/api/intake',route=>route.fulfill({status:400,json:{code:'invalid_field',fieldErrors:[{field:'health',code:'invalid'}]}}));
      await save.click();
      await form.locator('[name=health][aria-invalid=true]').waitFor();
      assert.equal(await form.locator('[name=health]').evaluate(node=>node===document.activeElement),true);
      const other=language==='en'?'es':'en';
      await page.locator('[data-language='+other+']').click();
      assert.equal(await form.locator('[name=health]').inputValue(),'No known conditions.');
      assert.match(await form.locator('[data-intake-field=health] [data-intake-error]').innerText(),other==='es'?/Revisa/:/Please check/);
      await page.locator('[data-language='+language+']').click();
      await page.unroute('**/api/intake');
      await save.click();
      await panel(2).waitFor();
      for(const name of ['vet','emergency','decisionMakers']) await form.locator('[name='+name+']').fill('Household '+name+' contact');
      await form.locator('[name=vetAuthorization][value=no]').check();
      await save.click();
      assert.equal(await form.locator('[name=spendingLimit]').getAttribute('aria-invalid'),'true');
      await form.locator('[name=spendingLimit]').fill('0');
      await page.route('**/api/intake',route=>route.fulfill({status:503,json:{error:'Please try again.'}}));
      await save.click();
      await form.locator('[data-care-status]').filter({hasText:language==='es'?'No se guardaron':'weren’t saved'}).waitFor();
      assert.equal(await form.locator('[name=spendingLimit]').inputValue(),'0');
      await page.unroute('**/api/intake');
      await save.click();
      await page.locator('#feedback').filter({hasText:/Saved\.|Guardado\./}).waitFor();
      const saved=(await server.call(who,'GET','/api/intake')).json;
      assert.equal(saved.complete,true);assert.equal(saved.spendingLimit,0);assert.equal(saved.vetAuthorization,'no');
      assert.equal(await form.locator('[data-intake-complete]').filter({hasText:'✓'}).count(),3);
      await go(0);
      await form.locator('[name=service][value=overnight]').check();
      assert.equal(await form.locator('[name=overnightAlone]').isVisible(),true);
      await save.click();
      assert.equal(await form.locator('[name=overnightAlone]').getAttribute('aria-invalid'),'true');
      await form.locator('[name=service][value=walk]').check();
      assert.equal(await form.locator('[name=overnightAlone]').isEnabled(),false);
      assert.equal(await form.locator('[name=overnightAlone]').isVisible(),false);
      for(let step=0;step<3;step++) {
        await go(step);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(width===390) {
          const height=(await form.boundingBox()).height;
          assert.ok(height<1600,'Care form remains a bounded screen: '+language+' section '+step+' '+height+'px');
        }
        await page.evaluate(axeSource);
        const a11y=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
        assert.deepEqual(a11y.violations.map(issue=>({id:issue.id,targets:issue.nodes.map(node=>node.target)})),[]);
        if(process.env.MYO_INTAKE_SCREENSHOTS) await form.screenshot({path:join(process.env.MYO_INTAKE_SCREENSHOTS,language+'-'+width+'-'+step+'.png')});
      }
      await page.locator('[data-load-access]').click();
      const access=page.locator('[data-care-action=home-access]');
      await access.locator('[name=method][value=lockbox]').check();
      await access.locator('[name=instructions]').fill('ENTRY_SECRET_NEVER_DRAFT');
      await page.locator('.site-header .menu-toggle').focus();
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('ENTRY_SECRET_NEVER_DRAFT')),false);
      await post(who,'pets',{name:'Moss',species:'Cat',details:JSON.stringify({feeding:'New feeding information'})});
      await page.reload();
      await form.waitFor();
      assert.equal(await form.locator('[name=feeding]').inputValue(),saved.feeding,'A new pet must not overwrite saved household notes');
      if(width===390) {
        await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        for(const button of await form.locator('.intake-progress button').all()) {
          const box=await button.boundingBox();assert.ok(box.width>=44 && box.height>=44);
        }
      }
      console.log('Progressive intake '+language+' '+width+'px passed');
    } finally {await context.close();}
  }
  assert.deepEqual(problems,[]);
} finally {await browser.close();await server.stop();}
