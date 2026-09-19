import test from 'node:test';
import assert from 'node:assert/strict';
import { researchMapColors } from '../src/map-colors.js';
import { SFMap } from '../src/map.js';
const groups = [
  {agent_ids:[42], probabilities:[.2,.8], factor:'Cost'},
  {agent_ids:[7], probabilities:[.7,.3], factor:'Convenience'},
  {agent_ids:[9], probabilities:[.5,.5], factor:'Cost'},
];
const residents = [{seed:42, segments:{income:'low',age:'18-24'}},{seed:7,segments:{income:'high',age:'65+'}},{seed:9,segments:{}}];
test('binary defaults preserve red/green, exact IDs and neutral ties',()=>{
  const result=researchMapColors(groups,['Yes','No'],residents);
  assert.equal(result.mode,'response');
  assert.equal(result.colors.get(42), result.legend[1].color);
  assert.equal(result.colors.get(7), result.legend[0].color);
  assert.equal(result.colors.get(9),null);
  assert.equal(result.colors.has(0),false);
  assert.deepEqual([...result.verdicts.values()],['no','yes',null]);
});
test('multiple choice dots and legend share option colors and ties have no dot',()=>{
  const result=researchMapColors([{agent_ids:[42],probabilities:[.1,.2,.7]},{agent_ids:[9],probabilities:[.4,.4,.2]}],['Stay','Switch','Skip']);
  assert.deepEqual(result.legend.map(x=>x.label),['Stay','Switch','Skip']);
  assert.equal(new Set(result.legend.map(x=>x.color)).size,3);
  assert.equal(result.colors.get(42),result.legend[2].color);
  assert.equal(result.colors.get(9),null);assert.equal(result.verdicts.get(42),null);
});
test('factor and demographic modes use observed keys and keep semantic responses',()=>{
  for(const mode of ['factor','income','age']){
    const result=researchMapColors(groups,['Yes','No'],residents,mode);
    assert.equal(result.mode,mode);assert.equal(result.legend.length,2);
    assert.notEqual(result.colors.get(42),result.colors.get(7));
    assert.equal(result.verdicts.get(42),'no');
  }
  const result=researchMapColors(groups,['Yes','No'],residents,'age');
  assert.equal(result.colors.has(9),false);
  assert.deepEqual(result.legend.map(x=>x.label),['18-24','65+']);
});
test('invalid groups cannot color a resident, and mode changes remove previous colors',()=>{
  const map=Object.assign(Object.create(SFMap.prototype),{agents:residents.map(x=>({...x})),reducedMotion:true});
  map.setResearchResponses(groups,['Yes','No'],{colorBy:'factor'});
  assert.ok(map.agents[2].markerColor);
  map.setResearchResponses(groups,['Yes','No'],{colorBy:'response'});
  assert.equal(map.agents[2].markerColor,null);
  map.setResearchResponses([{agent_ids:[42],probabilities:[.2,.2]}],['Yes','No']);
  assert.ok(map.agents.every(x=>x.markerColor===null));
  map.setResearchResponses(groups,['Yes','No'],{colorBy:'age'});
  map.clearVerdicts();
  assert.ok(map.agents.every(x=>x.markerColor===null));assert.deepEqual(map.mapColorLegend,[]);
});
test('larger categorical palettes remain valid canvas colors',()=>{
 const options=Array.from({length:12},(_,i)=>`Option ${i}`);
 const result=researchMapColors([],options);
 assert.equal(new Set(result.legend.map(x=>x.color)).size,12);
 assert.ok(result.legend.every(x=>/^#[0-9a-f]{6}$/i.test(x.color)));
});
test('canvas categorical markers match legend; missing demographics do not fall back to response red',()=>{
  const fills=[];
  const ctx={beginPath(){},arc(){},fill(){fills.push(this.fillStyle)},stroke(){},fillRect(){}};
  const map=Object.assign(Object.create(SFMap.prototype),{
    ctx,cam:{zoom:1},cssW:400,cssH:400,reducedMotion:true,spriteReady:false,
    _segmentResult:{summary:{active:false}},worldToScreen:(x,y)=>({x,y}),_isLand:()=>true,
    agents:[42,7].map((seed,i)=>({seed,segments:i===0?{income:'low'}:{},wx:50+i*50,wy:100,ang:0,speed:0,turnClock:1,frameClock:0,char:0})),
  });
  map.setResearchResponses(groups,['Yes','No'],{colorBy:'income'});
  map._drawSprites(performance.now(),0);
  assert.equal(fills.length,1);
  assert.ok(map.agents[1].verdict);assert.equal(map.agents[1].markerColor,null);
  fills.length=0;
  map.setResearchResponses([{agent_ids:[42,7],probabilities:[.1,.2,.7]}],['A','B','C']);
  map._drawSprites(performance.now(),0);
  assert.equal(fills.length,2);assert.equal(fills[0],fills[1]);
});
