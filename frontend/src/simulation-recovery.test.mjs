import test from 'node:test';
import assert from 'node:assert/strict';
import {withSimulationRecovery} from './simulation-recovery.js';
const missing=()=>Object.assign(new Error('gone'),{status:404,serverMessage:'simulation not found'});
test('restores missing simulation once and retries with updated state',async()=>{
  let id='old', calls=[];
  const result=await withSimulationRecovery({run:async()=>{calls.push(id);if(id==='old')throw missing();return 'branch';},restore:async()=>{id='new';}});
  assert.equal(result,'branch');assert.deepEqual(calls,['old','new']);
});
test('never retries inference failures or unrelated 404s',async()=>{
  for(const error of [Object.assign(new Error('inference'),{status:502}),Object.assign(new Error('route'),{status:404,serverMessage:'route not found'})]) {
    let restored=false;
    await assert.rejects(withSimulationRecovery({run:async()=>{throw error;},restore:async()=>{restored=true;}}));
    assert.equal(restored,false);
  }
});
test('second missing simulation is surfaced, not retried indefinitely',async()=>{
  let runs=0,restores=0;
  await assert.rejects(withSimulationRecovery({run:async()=>{runs++;throw missing();},restore:async()=>{restores++;}}));
  assert.equal(runs,2);assert.equal(restores,1);
});
test('cancellation during restoration prevents another request',async()=>{
  const ctrl=new AbortController();let calls=0;
  await assert.rejects(withSimulationRecovery({signal:ctrl.signal,run:async()=>{calls++;throw missing();},restore:async()=>ctrl.abort()}),{name:'AbortError'});
  assert.equal(calls,1);
});
