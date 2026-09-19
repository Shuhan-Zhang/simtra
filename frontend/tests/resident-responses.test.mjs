import test from 'node:test';
import assert from 'node:assert/strict';
import {residentResponseLabels} from '../src/resident-responses.js';
test('map reactions preserve exact group members, factors and estimates',()=>{
 const groups=[{agent_ids:[42,7],probabilities:[.2,.8],factor:'Price sensitivity'},{agent_ids:[90],probabilities:[.65,.35],factor:'Convenience'}];
 const labels=residentResponseLabels(groups,['Would buy','Would not buy']);
 assert.equal(labels.get(42),'Would not buy · 80% · Price sensitivity');
 assert.equal(labels.get(7),labels.get(42));
 assert.equal(labels.get(90),'Would buy · 65% · Convenience');
 assert.equal(labels.has(2),false);
 const changed=residentResponseLabels([{...groups[0],probabilities:[.7,.3]}],['Would buy','Would not buy']);
 assert.equal(changed.get(42),'Would buy · 70% · Price sensitivity');
});
test('missing or incomplete probabilities never fabricate a reaction',()=>{
 for(const probabilities of [[.1],[NaN,.2],[-1,2],[.2,.2],[]])assert.equal(residentResponseLabels([{agent_ids:[1],probabilities}],['Yes','No']).size,0);
 assert.equal(residentResponseLabels(null,['Yes','No']).size,0);
});
test('renderer replaces reaction labels when scenario changes and clears them on reset',async()=>{
 const {SFMap}=await import('../src/map.js');
 const map={agents:[{seed:7},{seed:9}],reducedMotion:true,mode:'idle'};
 SFMap.prototype.setResearchResponses.call(map,[{agent_ids:[7],probabilities:[.8,.2],factor:'Cost'}],['Yes','No']);
 assert.equal(map.agents[0].response,'Yes · 80% · Cost');assert.equal(map.agents[1].response,null);
 SFMap.prototype.setResearchResponses.call(map,[{agent_ids:[9],probabilities:[.1,.9],factor:'Price'}],['Yes','No']);
 assert.equal(map.agents[0].response,null);assert.equal(map.agents[1].response,'No · 90% · Price');
 SFMap.prototype.clearVerdicts.call(map);
 assert.ok(map.agents.every(a=>a.response===null));
});
test('optional voice is bounded and cached per branch even when provider returns nothing',async()=>{
 const {SFMap}=await import('../src/map.js');
 const batches=[],map={agents:Array.from({length:70},(_,seed)=>({seed})),mode:'idle',bubbleIdx:[],onNeedChatter:ids=>batches.push(ids)};
 SFMap.prototype.setSim.call(map,'sf','first');
 for(let start=0;start<70;start+=7){map.bubbleIdx=Array.from({length:7},(_,i)=>start+i);SFMap.prototype._requestChatter.call(map);SFMap.prototype._requestChatter.call(map);}
 assert.equal(batches.length,4);assert.equal(new Set(batches.flat()).size,28);assert.ok(batches.every(b=>b.length<=7));
 SFMap.prototype.setThought.call(map,3,'The lunch queue will make me late.');
 assert.equal(map.agents[3].thought,'The lunch queue will make me late.');assert.equal(map.agents[2].thought,null);
 SFMap.prototype.setSim.call(map,'sf','first');assert.equal(map.chatterAsked.size,28);assert.equal(map.thoughts.size,1);
 SFMap.prototype.setSim.call(map,'sf','second');assert.equal(map.chatterAsked.size,0);assert.equal(map.thoughts.size,0);assert.equal(map.agents[3].thought,null);
 map.hasResearchResponses=true;SFMap.prototype._requestChatter.call(map);assert.equal(batches.length,4);
});

test('map factors omit stored provider/debug labels',()=>{
 const labels=residentResponseLabels([{agent_ids:[1],probabilities:[.7,.3],factor:'Jev-selected factor (template): affordability. [Jev-selected template]'}],['Would buy','Would not buy']);
 assert.equal(labels.get(1),'Would buy · 70% · affordability.');
});


test('research head dots show exact group preferences and replace stale scenario colors', async()=>{
 const {SFMap}=await import('../src/map.js');
 const map={agents:[{seed:7},{seed:9},{seed:11},{seed:12}],mode:'clearing',clearFade:0};
 SFMap.prototype.setResearchResponses.call(map,[
  {agent_ids:[7],probabilities:[.8,.2]},
  {agent_ids:[9],probabilities:[.1,.9]},
  {agent_ids:[11],probabilities:[.5,.5]},
 ],['Would buy','Would not buy']);
 assert.deepEqual(map.agents.map(a=>a.verdict),['yes','no',null,null]);
 assert.equal(map.mode,'results');assert.equal(map.clearFade,1);
 assert.ok(map.agents.every(a=>a.activateAt<=performance.now()));
 SFMap.prototype.setResearchResponses.call(map,[{agent_ids:[7],probabilities:[.2,.8]}],['Would buy','Would not buy']);
 assert.deepEqual(map.agents.map(a=>a.verdict),['no',null,null,null]);
 SFMap.prototype.setResearchResponses.call(map,[{agent_ids:[7],probabilities:[.2,.2]}],['Would buy','Would not buy']);
 assert.ok(map.agents.every(a=>a.verdict===null));assert.equal(map.mode,'idle');
});

test('nonbinary response groups never imply red/green yes-no preferences',async()=>{
 const {SFMap}=await import('../src/map.js');
 const map={agents:[{seed:7}]};
 SFMap.prototype.setResearchResponses.call(map,[{agent_ids:[7],probabilities:[.1,.7,.2]}],['A','B','C']);
 assert.equal(map.agents[0].verdict,null);
 assert.equal(map.agents[0].response,'B · 70%');
});

test('research results render green and red head markers, not merely labels',async()=>{
 const {SFMap}=await import('../src/map.js');
 const fills=[];
 const ctx={beginPath(){},arc(){},fill(){fills.push(this.fillStyle)},stroke(){},fillRect(){}};
 const map=Object.assign(Object.create(SFMap.prototype),{
  ctx,cam:{zoom:1},cssW:400,cssH:400,reducedMotion:true,spriteReady:false,
  _segmentResult:{summary:{active:false}},worldToScreen:(x,y)=>({x,y}),_isLand:()=>true,
  agents:[7,9,11].map((seed,i)=>({seed,wx:50+i*50,wy:100,ang:0,speed:0,turnClock:1,frameClock:0,char:0})),
 });
 map.setResearchResponses([{agent_ids:[7],probabilities:[.8,.2]},{agent_ids:[9],probabilities:[.2,.8]}],['Yes','No']);
 map._drawSprites(performance.now(),0);
 assert.equal(fills.length,2);
 assert.notEqual(fills[0],fills[1]);
 map.clearVerdicts();fills.length=0;map._drawSprites(performance.now(),0);
 assert.deepEqual(fills,[]);
});

test('leaving research clears markers without waiting for animation and preserves simulation',async()=>{
 const {SFMap}=await import('../src/map.js');
 const evolution={frame:{tick:4}};
 const map=Object.assign(Object.create(SFMap.prototype),{
  agents:[{seed:7}],reducedMotion:false,evolution,bubbleIdx:[0],bubbleT:100,
 });
 map.setResearchResponses([{agent_ids:[7],probabilities:[.8,.2]}],['Yes','No']);
 map.clearVerdicts();
 assert.equal(map.mode,'idle');assert.equal(map.hasResearchResponses,false);
 assert.deepEqual(map.mapColorLegend,[]);assert.deepEqual(map.bubbleIdx,[]);
 assert.ok(map.agents.every(a=>a.verdict===null&&a.markerColor===null&&a.response===null));
 assert.equal(map.evolution,evolution);
 // Explicit cleanup must also remove a stale marker if the mode/flag drifted.
 map.agents[0].verdict='no';map.agents[0].markerColor='#ff0000';
 map.clearResearchResponses();
 assert.equal(map.agents[0].verdict,null);assert.equal(map.agents[0].markerColor,null);
});

test('simulation keeps matching resident sprites opaque and dims only other behaviors',async()=>{
 const {SFMap}=await import('../src/map.js');
 const alpha=[];
 const map=Object.assign(Object.create(SFMap.prototype),{
  ctx:{fillRect(){alpha.push(this.globalAlpha)}},cam:{zoom:.2},cssW:400,cssH:400,
  reducedMotion:true,spriteReady:false,_segmentResult:{summary:{active:false}},
  worldToScreen:(x,y)=>({x,y}),_isLand:()=>true,
  agents:[7,9].map(seed=>({seed,wx:50,wy:100,ang:0,speed:0,turnClock:1,frameClock:0,char:0})),
 });
 map.setEvolution({groups:[{id:'a',members:[7]},{id:'b',members:[9]}],frame:{behaviors:[{group:'a',probabilities:{switch:1}},{group:'b',probabilities:{same:1}}]},activeAction:'switch'});
 map._drawSprites(performance.now(),0);
 assert.deepEqual(alpha,[.92,.23]);
});
