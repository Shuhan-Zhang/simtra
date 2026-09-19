const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.goto((process.env.SIMTRA_TEST_BASE||'http://127.0.0.1:5198')+'/?demo=1');
 await page.evaluate(async()=>{window.testApp=await import(document.querySelector('script[type=module]').src);});
 await page.waitForFunction(()=>testApp.state.phase==='idle'&&testApp.map.spriteReady);
 const result=await page.evaluate(()=>{
  const map=testApp.map;map.stop();
  const agent=map.agents.find(a=>{const p=map.worldToScreen(a.wx,a.wy);return p.x>350&&p.x<700&&p.y>250&&p.y<600;});
  map.agents=[agent];agent.speed=0;
  map.onSpriteTap=a=>window.inspected=a.seed;map.onResidentSelect=a=>window.selected=a.id;
  const original=map._drawSprites.bind(map);window.spriteDraws=0;
  map._drawSprites=(...args)=>{window.spriteDraws++;return original(...args);};
  const camera={...map.camTarget};
  map.setEvolution({groups:[{id:'test',members:[agent.seed]}],frame:{behaviors:[{group:'test',probabilities:{switch:1}}]},colors:{switch:'#a855f7'},activeAction:'switch'});
  map.lastT=performance.now();map._draw(performance.now());
  const p=map.worldToScreen(agent.wx,agent.wy);
  return {id:agent.seed,x:p.x,y:p.y-3,camera,draws:window.spriteDraws};
 });
 assert.equal(result.draws,1,'simulation continues drawing resident sprites');
 await page.mouse.click(result.x,result.y);
 assert.deepEqual(await page.evaluate(()=>({inspected:window.inspected,selected:window.selected})),{inspected:result.id,selected:result.id});
 assert.deepEqual(await page.evaluate(()=>({...testApp.map.camTarget})),result.camera,'simulation selection does not zoom');
 console.log('PASS simulation retains resident sprites and clickable personas without moving the camera');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
