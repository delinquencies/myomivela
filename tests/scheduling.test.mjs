import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password } from './helpers.mjs';

test('weekly hours roll forward and buffers and exceptions affect booking and public availability',async()=>{
  const server = await startServer();
  const post = async (who,path,body,status=200) => {
    const result = await server.call(who,'POST','/api/'+path,body);
    assert.equal(result.status,status,result.json?.error);
    return result.json;
  };
  const portal = async () => (await server.call('client','GET','/api/portal')).json;
  const day = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'America/New_York'});
  const clock = new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  try {
    await post('staff','login',adminLogin);
    await post('staff','services',{name:'Dog walking',minutes:30,cents:2500});
    const hours = {days:[0,1,2,3,4,5,6],opens:'09:00',closes:'17:00',buffer:30};
    await post('staff','schedule',hours);
    await post('client','register',{name:'Casey',email:'standing@example.test',password});
    await post('client','schedule',hours,403);
    await post('client','pets',{name:'Cooper',species:'Dog',details:''});
    const target = day.format(Date.now()+48*60*60_000);
    const targetSlots = async () => (await portal()).slots.filter(slot=>day.format(slot.starts)===target);
    let slots = await targetSlots();
    assert.equal(slots.length,16);
    assert.equal(clock.format(slots[0].starts),'09:00');
    const info = await portal();
    const eleven = slots.find(slot=>clock.format(slot.starts)==='11:00');
    const body = {slot:eleven.id,start:eleven.starts,service:info.services[0].id,pets:[info.pets[0].id],cents:2500,notes:''};
    const booking = await post('client','bookings',body);
    await post('staff','status',{id:booking.id,status:'Confirmed'});
    slots = (await targetSlots()).map(slot=>clock.format(slot.starts));
    for (const time of ['10:30','11:00','11:30']) assert.ok(!slots.includes(time),time);
    for (const time of ['10:00','12:00']) assert.ok(slots.includes(time),time);
    await post('client','checkout-hold',{...body,start:eleven.starts-30*60_000},409);
    await post('staff','schedule',{...hours,buffer:0});
    assert.ok((await targetSlots()).some(slot=>clock.format(slot.starts)==='10:30'));
    await post('staff','schedule-exception',{day:target,mode:'closed'});
    assert.equal((await targetSlots()).length,0);
    await post('staff','schedule-exception',{day:target,mode:'custom',opens:'13:00',closes:'15:00'});
    assert.deepEqual((await targetSlots()).map(slot=>clock.format(slot.starts)),['13:00','13:30','14:00','14:30']);
    await post('staff','schedule-exception',{day:target,mode:'reset'});
    assert.equal((await targetSlots()).length,15);
    const publicRows = (await server.call('guest','GET','/api/availability')).json;
    assert.equal(publicRows[0].times.length,3);
  } finally {
    await server.stop();
  }
});
