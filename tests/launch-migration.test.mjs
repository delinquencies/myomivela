import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startServer,password,nodeOnly} from './helpers.mjs';
import {schemaVersion} from '../lib/db.mjs';
import {myoConfig} from '../assets/myo-config.js';

test('the unpublished intake migration can upgrade through main Phase 3 without losing customer data',{skip:nodeOnly},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'myo-merge-migrate-'));
  const path=join(dir,'data.sqlite');
  let app=await startServer({}, {dbPath:path});
  try{
    await app.call('c','POST','/api/register',{name:'Client',email:'upgrade@example.test',password});
    const intake={service:'walk',spendingLimit:100,vetAuthorization:'yes'};
    for(const [key] of myoConfig.intakeFields)if(!(key in intake))intake[key]='Saved '+key;
    assert.equal((await app.call('c','POST','/api/intake',intake)).status,200);
    await app.stop();app=null;
    const db=new DatabaseSync(path);
    try{
      db.exec("DROP TABLE fee_rules; DROP TABLE holidays; UPDATE meta SET value='20' WHERE key='schema_version'");
    }finally{db.close();}
    app=await startServer({}, {dbPath:path});
    await app.call('c','POST','/api/login',{email:'upgrade@example.test',password});
    assert.equal((await app.call('c','GET','/api/intake')).json.emergency,intake.emergency);
    const inspection=new DatabaseSync(path,{readOnly:true});
    try{
      assert.equal(Number(inspection.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value),schemaVersion);
      assert.ok(inspection.prepare("SELECT name FROM sqlite_master WHERE name='fee_rules'").get());
      assert.ok(inspection.prepare("SELECT name FROM sqlite_master WHERE name='ledger_entries'").get());
    }finally{inspection.close();}
  }finally{
    await app?.stop();
    await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
