// Browser integration with mocked live HTTP responses. No provider claims are made.
const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const base=process.env.SIMTRA_TEST_BASE || 'http://127.0.0.1:5198';
const question='I want to raise chipotle bowl prices in sf';
const fixtures=path.join(__dirname,'../fixtures/population-demo');
const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json')));
const entry=manifest.cities.find(e=>e.city.slug==='sf');
const row=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures,entry.file))));
const panel={id:'chipotle-research',version:1,content_hash:'pinned-hash',status:'draft',question,question_context:{requested_market:'sf'},sources:[{id:'source-1',title:'Mock public source for browser verification',url:'https://example.com/chipotle',text:'Fixture evidence'}],personas:[{id:'persona-1',label:'Budget-conscious customer',attributes:[{key:'price_sensitivity',value:'High',provenance:'inferred'}]}],gaps:[]};
const ready=async page=>{await page.evaluate(async()=>{window.__appState=(await import(document.querySelector('script[type=module]').src)).state;});await page.waitForFunction(()=>window.__appState.phase==='idle'&&!!window.__appState.mainBranch&&window.__appState.rawResidents.length===10000);};
const ask=async page=>{await page.locator('#ask-input').fill(question);await page.locator('#ask-submit').click();};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  // The offline path remains explicit and does not contact external providers.
  const offline=await browser.newPage({viewport:{width:1440,height:1000}}),external=[];
  await offline.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():(external.push(r.request().url()),r.abort()));
  await offline.goto(base+'/?demo=1');await ready(offline);await ask(offline);await offline.locator('.ex-matrix-cell').first().waitFor();
  assert.match(await offline.locator('.ex-curve').textContent(),/20%/);
  assert.equal(await offline.locator('input[type=file]').count(),0,'image upload removed from entry');
  assert.equal(await offline.locator('.ask-options').count(),0);
  assert.equal(await offline.locator('.ask-mode[data-mode=ab]').count(),0);
  assert.equal(await offline.locator('.ask-mode[data-mode=research]').isVisible(),true);
  assert.match(await offline.locator('.ask-mode[data-mode=research]').innerText(),/Automatic/);
  assert.equal(await offline.locator('.ask-mode[data-mode=predict]').isVisible(),true);
  assert.equal(await offline.locator('[data-action=approve]').count(),0,'one prompt automatically runs comparison');
  assert.match(await offline.locator('.ex-impact').innerText(),/Other tested factors held fixed/);
  assert.deepEqual(external,[]);await offline.close();
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],calls=[];
  let researchBody,compareBody,evolutionBody,eventBody,questionBody,researchRelease,comparisonRelease;
  const researchGate=new Promise(resolve=>researchRelease=resolve),comparisonGate=new Promise(resolve=>comparisonRelease=resolve);
  setTimeout(()=>{researchRelease();comparisonRelease();},60000).unref();
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=decodeURIComponent(url.pathname),body=req.postDataJSON?.();
   if(url.origin===base)return route.continue();
   if(url.hostname!=='localhost')return route.abort(); // prevent satellite calls in mocked live mode
   calls.push(p);
   const json=data=>route.fulfill({json:data});
   if(p==='/cities')return json({cities:[{...entry.city,default:true}]});
   if(p==='/simulations')return json({simulation_id:'mock-sim',main_branch:'mock-main'});
   if(p.endsWith('/branches'))return json({branch_id:'mock-comparison'});
   if(p.endsWith('/agents')){const offset=Number(url.searchParams.get('offset')||0);return json({agents:row.agents.slice(offset,offset+1000),total_matched:row.agents.length});}
   if(p==='/audience-research/panels')return json({panels:[]});
   if(p==='/audience-research/config')return json({search_configured:true,jev_configured:true,progress_stream:true});
   if(p==='/audience-research/automatic/stream'){
    researchBody=body;await researchGate;
    return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'progress',step:'search',message:'Reviewing public sources'})+'\n'+JSON.stringify({type:'result',panel})+'\n'});
   }
   if(p.endsWith('/experiment-plan'))return json({kind:'price',measure:'trial',locations:['Mission','Sunset'],available_locations:['Mission','Sunset']});
   if(p.endsWith('/research/stream')){
    compareBody=body;await comparisonGate;
    const data={fixture_mode:true,scenarios:body.scenarios.map((scenario,i)=>{const probabilities=[.7-i%6*.05,.3+i%6*.05];return {scenario,result:{...row.binary,p_distribution:body.options.map((o,i)=>[o,probabilities[i]]),option_breakdowns:row.binary.option_breakdowns.map(b=>({...b,groups:b.groups.map(g=>({...g,shares:probabilities}))}))},response_groups:[{agent_ids:row.agents.map(a=>a.id),probabilities,archetype:'mock-cohort',factor:'Mocked price sensitivity'}]};})};
    return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data})+'\n'});
   }
   const frame=tick=>({tick,day:tick,changed_share:tick*.02,changed_count:tick*200,totals:[{id:'same',share:1-tick*.02,count:10000-tick*200},{id:'switch',share:tick*.02,count:tick*200}],behaviors:[]});
   if(p.endsWith('/evolution')){evolutionBody=body;return json({id:'mock-evolution',branch:'mock-main',scenario:body.scenario,population:10000,max_ticks:14,groups:[],outcomes:[{id:'same',label:'Same routine'},{id:'switch',label:'Switch restaurants'}],frames:[frame(0)],events:[],questions:[]});}
   if(p.endsWith('/step'))return json({frame:frame(body.expected_tick+1)});
   if(p.endsWith('/event')){eventBody=body;return json({text:body.text,effective_day:body.expected_tick+1});}
   if(p.endsWith('/question')){questionBody=body;return json({question:body.question,tick:body.tick,shares:{yes:.6,no:.3,unsure:.1}});}
   if(p.endsWith('/news'))return json({articles:[]});
   if(p.endsWith('/chatter'))return json({chatter:{}});
   if(p.endsWith('/locations/areas'))return json({areas:[]});
   if(p.endsWith('/prediction-results'))return json({results:[]});
   if(p.includes('/feed'))return json({events:[],surveys:[]});
   return json({});
  });
  await page.goto(base+'/?pipeline=2');await ready(page);await ask(page);
  await page.waitForFunction(()=>document.querySelector('.ex-pipeline')?.textContent.includes('Building your research audience'));
  assert.equal(calls.some(p=>p.endsWith('/experiment-plan')),false,'research completes before planning');
  await page.waitForTimeout(100);researchRelease();
  await page.locator('.ex-factor-grid').waitFor();
  assert.deepEqual(researchBody,{question,market:'sf'});
  assert.deepEqual(compareBody.research_panel,{id:panel.id,version:1,content_hash:'pinned-hash',role:'research_context_only'});
  assert.equal(compareBody.scenarios.length,24);assert.ok(compareBody.scenarios.some(s=>s.change===0));assert.ok(compareBody.scenarios.some(s=>s.change===20));
  await page.screenshot({path:'/tmp/simtra-chipotle-plan.png'});comparisonRelease();
  await page.locator('.ex-matrix-cell').first().waitFor();
  assert.equal(await page.locator('.ex-curve [data-scenario]').count(),6);
  assert.match(await page.locator('.ex-impact').innerText(),/Price|Location/);
  assert.match(await page.locator('#research-workspace').innerText(),/20%/);
  if(!await page.locator('.ex-people').evaluate(el=>el.open))await page.locator('.ex-people summary').click();await page.locator('#experiment-people').waitFor();
  assert.equal(await page.locator('[data-action=timeline]').count(),1);
  await page.screenshot({path:'/tmp/simtra-chipotle-result.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390,'no horizontal overflow on mobile');
  await page.screenshot({path:'/tmp/simtra-chipotle-result-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-action=timeline]').click();await page.locator('[data-clock]').filter({hasText:'Day 1'}).waitFor();
  await page.locator('#evo-message').focus();
  assert.match(evolutionBody.scenario,/20%/);assert.equal(evolutionBody.research_panel.id,panel.id);
  await page.locator('#evo-message').fill('A competitor cuts bowl prices by 10%');await page.locator('[data-composer] button').click();
  await page.locator('[data-clock]').filter({hasText:'Day 2'}).waitFor();await page.locator('#evo-message').focus();
  assert.equal(eventBody.expected_tick,1);
  await page.locator('#evo-message').fill('Would you still buy a Chipotle bowl?');await page.locator('[data-composer] button').click();
  await page.waitForFunction(()=>document.querySelector('[data-updates]')?.textContent.includes('60.0%'));assert.equal(questionBody.tick,2);
  await page.screenshot({path:'/tmp/simtra-chipotle-timeline.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS exact Chipotle prompt: image-free entry, offline relative curve, research-before-plan, pinned evidence handoff, 24 combinations, line curve, factor impacts, demographics, timeline with pinned context, news affecting the next day, question on viewed day, mobile. HTTP responses mocked; no live provider verification.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
