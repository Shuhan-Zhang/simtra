// Offline demo or actual HTTP engine behind a loopback model fixture. No paid calls.
// AGENT_BROWSER=/path/to/agent-browser node frontend/tests/research-browser.mjs
// SIMTRA_RESEARCH_URL=http://127.0.0.1:5197/?port=5188 uses fixture-server.rs.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const cli=process.env.AGENT_BROWSER || 'agent-browser';
const url=process.env.SIMTRA_RESEARCH_URL || 'http://127.0.0.1:5197/?demo=1';
const demo=new URL(url).searchParams.get('demo')==='1';
const output=process.env.SIMTRA_RESEARCH_OUTPUT || '/tmp/simtra-pipeline-browser';
mkdirSync(output,{recursive:true});
const call=(...args)=>{
  let stdout;
  try {stdout=execFileSync(cli,['--session','pipeline-regression','--json',...args],{encoding:'utf8',timeout:65000,maxBuffer:8*1024*1024,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'55000'}});}
  catch(e) {throw new Error(`Browser command ${args[0]} ${args[1] || ''}: ${e.stdout || e.message}`);}
  const response=JSON.parse(stdout);
  assert.equal(response.success,true,JSON.stringify(response));return response.data;
};
const evaluate=code=>call('eval',code).result;
const wait=code=>call('wait','--fn',code);
const click=selector=>{evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);return call('click',selector);};
const fill=(selector,value)=>call('fill',selector,value);
const app="await import(document.querySelector('script[type=module]').src)";
const report=name=>console.log(`PASS ${name}`);
const historyCount=()=>evaluate("(document.querySelector('select[aria-label=\"Previous experiments\"]')?.options.length || 1)-1");
function ask(question) {
  click('#ask');fill('#ask-input',question);click('#ask-submit');
  wait("!!document.querySelector('[data-action=approve]') && !document.querySelector('[data-action=approve]').disabled && !document.querySelector('#research-workspace').hidden");
}
function reopen(id) {call('select','select[aria-label="Previous experiments"]',id);}
try {
  call('open',url);call('set','viewport','1440','1000');call('set','media','light','reduced-motion');
  // Do not use an async import as a wait predicate: its Promise is truthy.
  evaluate(`(async()=>{window.testApp=${app};})()`);
  wait("window.testApp?.state.phase==='idle'");
  assert.equal(evaluate("document.querySelector('#research-workspace').hidden"),true);
  assert.equal(evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"),'#007aff');
  assert.equal(evaluate("document.querySelector('#map').getBoundingClientRect().width"),1440);
  if(demo) {
    assert.equal(evaluate('window.testApp.state.rawResidents.length'),10000);
    assert.equal(evaluate('window.testApp.map.agents.length'),10000);
    assert.equal(evaluate('new Set(window.testApp.state.rawResidents.map(r=>r.id)).size'),10000);
    report('demo loads 10,000 unique sampled residents into state and the actual map');
  }
  if(!demo) {
    evaluate("(async()=>{const {SIM}=await import('/src/config.js');SIM.n=256;})()");
    click('#audience-chip');click('#filter-clear');
    wait("document.querySelector('#filter-modal').classList.contains('hidden') && window.testApp.state.phase==='idle' && !window.testApp.state.switching");
    evaluate("window.realFetch=window.fetch;window.researchCalls=[];window.fetch=(url,options)=>{if(String(url).endsWith('/research/stream'))window.researchCalls.push(JSON.parse(options.body));return window.realFetch(url,options);}");
  }
  report('original blue town opens with just the ask box, no experiment form or sidebar');
  ask("i'm launching a new jolibee in sf");
  const initialCount=historyCount();
  assert.match(evaluate("document.querySelector('.ex-plan-summary').textContent"),/3 factors · 24 combinations/);
  assert.match(evaluate("document.querySelector('[data-action=approve]').textContent"),/24 combinations/);
  assert.match(evaluate("document.querySelector('#research-workspace').textContent"),/Service format/);
  assert.doesNotMatch(evaluate("document.querySelector('#research-workspace').textContent"),/first order|Cap 200|\$5000|pickup marketplace/i);
  assert.equal(evaluate("document.querySelectorAll('#research-workspace input, #research-workspace textarea, #research-workspace form').length"),0);
  if(!demo)assert.equal(evaluate('window.researchCalls.length'),0);
  call('screenshot',`${output}/proposal.png`);
  report('restaurant question proposes two areas by six prices by two service formats; no testing before approval');
  click('[data-range="12,22"]');assert.match(evaluate("document.querySelector('[data-range][aria-pressed=true]').textContent"),/12–\$22/);
  click('[data-range="10,20"]');click('[data-action=swap-areas]');
  const unselected=evaluate("document.querySelector('[data-location][aria-pressed=false]').dataset.location");
  click(`[data-location="${unselected}"]`);click('[data-action=swap-areas]');
  const area=evaluate(`document.querySelector('[data-location="${unselected}"]').textContent`);
  assert.equal(evaluate("document.querySelectorAll('[data-location][aria-pressed=true]').length"),2);
  report('one-tap steering changes locations and price ranges');
  click('[data-action=approve]');wait("document.querySelectorAll('.ex-rank').length===3");
  if(demo) assert.match(evaluate("document.querySelector('.ex-audience').textContent"),/10,000 synthetic residents/);
  const launchId=evaluate("document.querySelector('select[aria-label=\"Previous experiments\"] option:nth-child(2)').value");
  assert.equal(historyCount(),initialCount+1);
  click('[data-action=all-ranks]');assert.equal(evaluate("document.querySelectorAll('.ex-rank').length"),24);
  const values=evaluate("[...document.querySelectorAll('.ex-rank-value')].map(el=>parseFloat(el.textContent))");
  assert.deepEqual([...values].sort((a,b)=>b-a),values);
  if(!demo) {assert.equal(evaluate('window.researchCalls.length'),1);assert.equal(evaluate('window.researchCalls[0].scenarios.length'),24);assert.match(evaluate('JSON.stringify(window.researchCalls[0])'),new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
  assert.equal(evaluate("document.querySelector('#execution-log')"),null);
  assert.doesNotMatch(evaluate("document.querySelector('#research-workspace').textContent"),/model\.request|scenario\.completed|Cap 200|first order/i);
  assert.equal(evaluate("document.querySelectorAll('.ex-curve [data-scenario]').length"),6);
  const oldIds=evaluate("[...document.querySelectorAll('.ex-curve [data-scenario]')].map(e=>e.dataset.scenario)");
  const formats=evaluate("[...document.querySelector('[data-curve=format]').options].map(o=>o.value)");
  call('select','[data-curve=format]',formats.find(v=>v!==evaluate("document.querySelector('[data-curve=format]').value")));
  const newIds=evaluate("[...document.querySelectorAll('.ex-curve [data-scenario]')].map(e=>e.dataset.scenario)");
  assert.equal(newIds.length,6);assert.ok(newIds.every(id=>!oldIds.includes(id)));
  report('24 ranked results, six actual price points per controlled curve, no customer-facing diagnostic log or caps');
  click('.ex-rank:nth-child(2)');click('.ex-faces button:first-child');
  wait("document.querySelectorAll('.ex-person-result').length===24");
  assert.match(evaluate("document.querySelector('#experiment-person').textContent"),/Inherited group response/);
  click('[data-action=close-person]');click('.ex-people summary');click('#experiment-people .pc-row:first-child');
  const selection=evaluate('window.testApp.map.getSegmentSelectionSummary()');
  assert.equal(selection.active,true);assert.ok(selection.rawMatchingAgents>0);
  report('rank selection joins stored responses to personas; existing demographic chart highlights their actual map residents');
  ask('what if I raise chipotle price by 20%');
  assert.match(evaluate("document.querySelector('[data-percent][aria-pressed=true]').textContent"),/Current to \+20%/);
  click('[data-action=approve]');wait("document.querySelectorAll('.ex-curve [data-scenario]').length===6 && !document.querySelector('[data-action=approve]')");
  const priceId=evaluate("document.querySelector('select[aria-label=\"Previous experiments\"] option:nth-child(2)').value");
  assert.match(evaluate("document.querySelector('.ex-curve').textContent"),/Price change/);
  click('.ex-curve [data-scenario]:first-of-type .ex-hit');
  assert.match(evaluate("document.querySelector('.ex-selected').textContent"),/Current/);
  call('screenshot',`${output}/price-curve.png`);
  report('relative pricing produces a selectable demand curve without invented menu prices');
  click('[data-action=refine]');assert.match(evaluate("document.querySelector('[data-percent][aria-pressed=true]').textContent"),/Current to \+10%/);
  click('[data-action=approve]');wait("!!document.querySelector('.ex-parent')");
  assert.equal(evaluate("document.querySelector('.ex-parent').dataset.run"),priceId);
  click('.ex-parent');assert.match(evaluate("document.querySelector('.ex-curve').textContent"),/\+20%/);
  report('refinement generates a new approved experiment and preserves the unchanged parent');
  reopen(launchId);click('[data-action=all-ranks]'); // restore compact top-three when needed
  if(evaluate("document.querySelectorAll('.ex-rank').length")>3)click('[data-action=all-ranks]');
  call('set','viewport','390','844');
  evaluate("document.querySelector('#research-workspace').scrollTop=0");
  const bounds=evaluate("({width:document.documentElement.scrollWidth,card:document.querySelector('#research-workspace').getBoundingClientRect().toJSON(),title:document.querySelector('#title-select').getBoundingClientRect().toJSON(),scroll:document.querySelector('#research-workspace').scrollWidth,client:document.querySelector('#research-workspace').clientWidth,map:document.querySelector('#map').getBoundingClientRect().toJSON()})");
  assert.equal(bounds.width,390);assert.equal(bounds.scroll,bounds.client);assert.ok(bounds.card.top>bounds.title.bottom);assert.ok(bounds.card.bottom<844);assert.equal(bounds.map.width,390);
  call('screenshot',`${output}/mobile.png`);
  report('390px mobile retains the town and readable card without title overlap or horizontal overflow');
  call('set','viewport','1440','1000');call('screenshot',`${output}/results.png`);
  const point=evaluate(`(()=>{const map=window.testApp.map;map.returnToOverview();map._draw(performance.now());const a=map.agents.find(a=>{const p=map.worldToScreen(a.wx,a.wy);return p.x>20&&p.x<800&&p.y>150&&p.y<500&&document.elementFromPoint(p.x,p.y-2)?.id==='map';});if(!a)throw Error('No visible resident');const p=map.worldToScreen(a.wx,a.wy);return {x:p.x,y:p.y-2};})()`);
  call('mouse','move',String(Math.round(point.x)),String(Math.round(point.y)));call('mouse','down');call('mouse','up');wait("document.querySelectorAll('.ex-person-result').length===24");
  report('actual map resident tap opens its inherited estimates across the combinations');
  call('reload');evaluate(`(async()=>{window.testApp=${app};})()`);wait("window.testApp?.state.phase==='idle' && !document.querySelector('#research-launch').hidden");
  click('#research-launch');reopen(launchId);assert.match(evaluate("document.querySelector('.ex-question').textContent"),/jolibee/);
  assert.equal(evaluate("document.querySelector('#execution-log')"),null);
  report('saved experiment, sampled personas and results survive a reload');
  if(!demo) {
    evaluate("(async()=>{const {SIM}=await import('/src/config.js');SIM.n=256;})()");
    click('[data-action=new-audience]');wait("!document.querySelector('#filter-modal').classList.contains('hidden')");fill('#filter-age','35');click('#filter-apply');
    wait("document.querySelector('#filter-modal').classList.contains('hidden') && !!document.querySelector('[data-action=approve]') && !document.querySelector('[data-action=approve]').disabled");
    assert.match(evaluate("document.querySelector('.ex-context').textContent"),/35-year-old/);
    click('[data-action=approve]');wait("!!document.querySelector('.ex-rank')");assert.match(evaluate("document.querySelector('.ex-audience').textContent"),/35-year-old/);
    reopen(launchId);const ages=evaluate("({live:window.testApp.state.rawResidents.every(r=>r.age===35),old:window.testApp.map.agents.some(r=>r.age!==35)})");assert.equal(ages.live,true);assert.equal(ages.old,true);
    click('[data-action=refine]');wait("!!document.querySelector('[data-action=approve]') && !document.querySelector('[data-action=approve]').disabled");
    assert.equal(evaluate("Object.keys(window.testApp.state.filters).length"),0);
    report('audience steering resamples people; reopening and refining an old run restores its own sample and filters');
    evaluate("window.realFetch=window.fetch;window.fetch=(url,options)=>String(url).endsWith('/research/stream')?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))):window.realFetch(url,options)");
    click('[data-action=approve]');wait("!!document.querySelector('[data-action=cancel]')");click('[data-action=cancel]');assert.match(evaluate("document.querySelector('.ex-error').textContent"),/Cancelled/);
    const before=historyCount();
    evaluate("window.fetch=(url,options)=>String(url).endsWith('/research/stream')?Promise.resolve(new Response(JSON.stringify({error:'Incomplete fixture comparison'}),{status:502})):window.realFetch(url,options)");
    click('[data-action=approve]');wait("document.querySelector('.ex-error')?.textContent.includes('Incomplete fixture comparison')");assert.equal(historyCount(),before);evaluate('window.fetch=window.realFetch');
    report('cancel and failed comparisons preserve the proposal without saving partial or invented outcomes');
  }
  click('[data-action=close]');click('#ask');click('[data-mode=predict][role=radio]');fill('#ask-input','Should the city expand public transit?');click('#ask-submit');
  wait("!document.querySelector('#result-card').classList.contains('hidden')");assert.match(evaluate("document.querySelector('#result-card').textContent"),/transit/);
  report('secondary quick prediction still works');
  const errors=call('errors');assert.equal(errors.errors?.length || 0,0,JSON.stringify(errors));report('no browser runtime errors');
  call('open',new URL(`control.html${demo?'?demo=1':''}`,url).href);
  wait("document.querySelectorAll('#runs button').length>0");
  const target=evaluate("[...document.querySelectorAll('#runs button')].find(b=>b.textContent.includes('jolibee')&&b.textContent.includes('completed'))?.dataset.run");
  click(`[data-run="${target}"]`);wait("document.querySelector('#detail').textContent.includes('All 24 experiments')");
  assert.match(evaluate("document.querySelector('#detail').textContent"),/Service format/);
  assert.match(evaluate("document.querySelector('#detail').textContent"),/Would you buy a meal from this restaurant/);
  click('details[data-section=events] summary');
  assert.match(evaluate("document.querySelector('.logs').textContent"),demo?/fixture/:/research.completed/);
  call('screenshot',`${output}/control-panel.png`);
  call('reload');wait("document.querySelectorAll('#runs button').length>0");
  report('separate control panel persists exact factors, criteria, all scenarios and raw execution logs');
} catch(error) {
  console.error('Browser state:',evaluate("({error:document.querySelector('.ex-error')?.textContent,panel:document.querySelector('#research-workspace')?.innerText.slice(-1500)})"));throw error;
} finally {try {call('close');} catch(e) {console.error(e.message);}}
