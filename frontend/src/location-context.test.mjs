import test from 'node:test';
import assert from 'node:assert/strict';
import { areaCount, locationEvidence, initLocationContext } from './location-context.js';

globalThis.Option = class { constructor(text,value) { this.text=text; this.value=value; } };
function controls(getLocations) {
  const select = { value:'', disabled:false, options:[], addEventListener(){},
    replaceChildren(...options) { this.options=options; this.value=options[0].value; },
    add(option) { this.options.push(option); } };
  const note = {textContent:''};
  return {select,note,control:initLocationContext({select,note,getLocations})};
}
const snapshot = {areas:{features:[{id:'mission',properties:{name:'Mission',mapped_poi_count:30}}]}};

test('area selection is excluded from unsupported modes and resets on city changes',async()=>{
  const {select,control}=controls(async()=>snapshot);
  await control.load('sf'); select.value='mission';
  assert.equal(control.selectedId(),'mission');
  control.setMode('ab'); assert.equal(control.selectedId(),'');
  control.setMode('predict'); assert.equal(control.selectedId(),'mission');
  await control.load('neu_york'); assert.equal(control.selectedId(),'');
});

test('late SF response cannot populate another city and failures leave no stale selection',async()=>{
  let resolve;
  const {select,note,control}=controls(()=>new Promise(r=>{resolve=r;}));
  const pending=control.load('sf');
  await control.load('neu_york'); resolve(snapshot); await pending;
  assert.equal(select.options.length,1); assert.equal(select.disabled,true);
  assert.match(note.textContent,/San Francisco/);
  const failed=controls(async()=>{throw Error('offline');});
  await failed.control.load('sf');
  assert.equal(failed.select.disabled,true); assert.match(failed.note.textContent,/unavailable/);
});

test('evidence preserves unknown counts, exposes provenance, and escapes source text',()=>{
  assert.equal(areaCount({mapped_poi_count:null}),'Place counts unavailable');
  assert.equal(areaCount({mapped_poi_count:0}),'0 mapped places');
  const html=locationEvidence({area_name:'<script>alert(1)</script>',mapped_poi_count:12,
    population_scope:'City population',sources:{osm:{status:'stale',retrieved_at:'2026-09-19'}},
    limitations:['Coverage incomplete']});
  assert.ok(!html.includes('<script>')); assert.match(html,/stale/);
  assert.match(html,/City population/); assert.match(html,/12 mapped places/);
});
