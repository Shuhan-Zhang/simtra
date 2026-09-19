const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage();const requests=[];
 const base=process.env.SIMTRA_TEST_BASE||'http://127.0.0.1:5198';
 await page.route('**/evolution-recovery-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 const frame=tick=>({tick,day:tick,changed_count:0,changed_share:0,totals:[{id:'same',share:1,count:10}]});
 await page.route('http://localhost:8080/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;requests.push({path,body:req.postDataJSON()});
  const send=(status,body)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  if(path==='/branches/old/evolution')return send(404,{error:'City population is no longer available. Reload the city.'});
  if(path==='/simulations')return send(200,{main_branch:'restored'});
  if(path==='/branches/restored/evolution')return send(200,{id:'run',branch:'restored',scenario:req.postDataJSON().scenario,population:10,groups:[],outcomes:[{id:'same',label:'Same routine'}],frames:[frame(0)],max_ticks:14});
  if(path==='/evolution/run/step')return send(200,{frame:frame(1)});
  return send(500,{error:'Unexpected request'});
 });
 await page.goto(base+'/evolution-recovery-test');
 await page.evaluate(async()=>{
  const {initEvolution}=await import('./src/evolution.js');const {withSimulationRecovery}=await import('./src/simulation-recovery.js');
  let branch='old';window.restoreCount=0;
  window.evo=initEvolution({map:{setEvolution(){}},getBranch:()=>branch,getCity:()=> 'sf',isReady:()=>true,withCurrentSimulation:(run,signal)=>withSimulationRecovery({run,signal,restore:async()=>{
   window.restoreCount++;const data=await (await fetch('http://localhost:8080/simulations',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).json();branch=data.main_branch;
   // Allow the context watcher to run while recovery owns the branch change.
   await new Promise(r=>setTimeout(r,650));
  }})});
  window.inlineHost=document.createElement('div');window.inlineHost.id='experiment-simulation';document.body.append(window.inlineHost);
  window.evo.start('Chipotle +20%. Selected experiment scenario: SoMa · Takeaway',{id:'panel',version:1,content_hash:'hash'},{newsContext:'Pinned local context',asOf:'2026-09-19'},{host:window.inlineHost,key:'experiment:0'});
 });
 await page.waitForFunction(()=>document.querySelector('[data-clock]').textContent==='Day 1');
 await page.locator('[data-play]').click();
 assert.equal(await page.locator('#evolution').isVisible(),true);
 assert.equal(await page.locator('[data-error]').innerText(),'');
 assert.equal(await page.evaluate(()=>window.restoreCount),1);
 assert.equal(await page.locator('#experiment-simulation #evolution.evo-inline').count(),1);
 assert.equal(await page.locator('#experiment-simulation #evo-transport').count(),1);
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('evolution-open')),false);
 await page.evaluate(()=>{window.evo.suspend();const host=document.createElement('div');host.id='replacement-host';document.body.append(host);window.evo.start('same selected experiment',null,null,{host,key:'experiment:0'});});
 assert.equal(await page.locator('#replacement-host #evolution').isVisible(),true);
 assert.equal(await page.locator('[data-clock]').innerText(),'Day 1');

 const starts=requests.filter(r=>r.path.endsWith('/evolution'));
 assert.equal(starts.length,2);assert.deepEqual(starts[0].body,starts[1].body);
 assert.equal(starts[1].body.research_panel.id,'panel');assert.equal(starts[1].body.pinned_news,'Pinned local context');
 assert.match(await page.locator('[data-scenario-details]').textContent(),/SoMa · Takeaway/);
 // A real city change must not continue a recovered request in the new city.
 const previousStarts=starts.length;
 await page.reload();
 await page.evaluate(async()=>{
  const {initEvolution}=await import('./src/evolution.js');const {withSimulationRecovery}=await import('./src/simulation-recovery.js');
  let city='sf';window.recoveryDone=false;
  const evo=initEvolution({map:{setEvolution(){}},getBranch:()=> 'old',getCity:()=>city,isReady:()=>true,withCurrentSimulation:(run,signal)=>withSimulationRecovery({run,signal,restore:async()=>{
   city='neu_york';await new Promise(r=>setTimeout(r,650));window.recoveryDone=true;
  }})});evo.start('Original SF scenario');
 });
 await page.waitForFunction(()=>window.recoveryDone);
 await page.waitForFunction(()=>document.querySelector('#evolution').hidden);
 assert.equal(requests.filter(r=>r.path.endsWith('/evolution')).length,previousStarts+1);
 console.log('PASS: missing population recreates once, preserves context, advances to day 1; city change cancels recovery');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
