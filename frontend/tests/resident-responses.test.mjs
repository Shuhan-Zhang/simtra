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
