// Chrome regression for generated voices; responses are mocked, never provider evidence.
const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto((process.env.SIMTRA_TEST_BASE||'http://127.0.0.1:5198')+'/?demo=1');
 const result=await page.evaluate(async()=>{
  const {SFMap}=await import('/src/map.js');
  const drawn=[],requests=[];
  const map=Object.create(SFMap.prototype);
  Object.assign(map,{agents:Array.from({length:70},(_,seed)=>({seed,wx:seed*20,wy:200,segmentIndex:seed})),mode:'idle',bubbleIdx:[1,4],ctx:{globalAlpha:1},cam:{zoom:1},_segmentResult:{summary:{active:false}},worldToScreen:(x,y)=>({x,y}),_drawBubble:(_ctx,_x,_y,text)=>drawn.push(text)});
  map.setSim('sf','voice-browser');
  map.onNeedChatter=ids=>{requests.push(ids);for(const id of ids)map.setThought(id,`Resident ${id}: taking lunch near the office.`);};
  map._requestChatter();map._drawBubbles();const ambient=[...drawn];drawn.length=0;
  map._requestChatter();
  map.setResearchResponses([{agent_ids:[4],probabilities:[.2,.8],factor:'Price sensitivity'}],['Would buy','Would not buy']);
  map.setThought(4,'Late ambient response');map._drawBubbles();const experiment=[...drawn];drawn.length=0;
  map._requestChatter();const afterExperiment=requests.length;
  map.reducedMotion=true;map.clearVerdicts();map._drawBubbles();const restored=[...drawn];
  for(let start=0;start<70;start+=7){map.bubbleIdx=Array.from({length:7},(_,i)=>start+i);map._requestChatter();map._requestChatter();}
  return {ambient,experiment,restored,afterExperiment,requested:requests.flat(),maxBatch:Math.max(...requests.map(r=>r.length))};
 });
 assert.deepEqual(result.ambient,['Resident 1: taking lunch near the office.','Resident 4: taking lunch near the office.']);
 assert.deepEqual(result.experiment,['Would not buy · 80% · Price sensitivity']);
 assert.deepEqual(result.restored,['Resident 1: taking lunch near the office.','Late ambient response']);
 assert.equal(result.afterExperiment,1);assert.equal(result.requested.length,28);assert.equal(new Set(result.requested).size,28);assert.ok(result.maxBatch<=7);
 console.log('PASS generated voice exact resident mapping, no suffix/fabricated fallback, research response priority, ambient restore and finite request budget; voices mocked.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
