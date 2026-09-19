// Exercise on-open loading, progressive reveal, deduplication and stale responses.
const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  // Keep offline boot fixtures but exercise the real chatter HTTP client.
  await page.route('**/src/api.js*',async route=>{
   const response=await route.fetch();
   const body=(await response.text()).replace('if (isDemo) return demoRequest(path,','if (isDemo && !path.endsWith("/chatter")) return demoRequest(path,');
   await route.fulfill({response,body});
  });
  let capture=false;const requests=[];
  await page.route('**/branches/*/chatter',async route=>{
   if(capture)requests.push(route);
   else await route.fulfill({json:{chatter:{}}});
  });
  await page.goto((process.env.SIMTRA_TEST_BASE||'http://127.0.0.1:5198')+'/?demo=1');
  await page.evaluate(async()=>{window.app=await import(document.querySelector('script[type=module]').src);});
  await page.waitForFunction(()=>app.state.mainBranch&&app.map.agents.length>0);
  await page.evaluate(()=>{app.map.onNeedChatter=null;app.map.thoughts.clear();for(const a of app.map.agents)a.thought=null;});
  capture=true;
  const open=idx=>page.evaluate(i=>app.map.onSpriteTap(app.map.agents[i]),idx);
  const waitRequest=async count=>{await page.waitForFunction(()=>true);for(let i=0;i<100&&requests.length<count;i++)await new Promise(r=>setTimeout(r,20));assert.equal(requests.length,count);};
  const answer=async(index,text)=>{const route=requests[index];const id=route.request().postDataJSON().ids[0];await route.fulfill({json:{chatter:{[id]:text}}});};
  await open(0);await waitRequest(1);
  assert.equal(await page.locator('.char-thought').innerText(),'Thinking…');
  await open(0);assert.equal(requests.length,1,'reopening shares the pending request');
  const thought='I am thinking about how higher lunch prices will affect my weekly budget.';
  await answer(0,thought);
  await page.waitForFunction(()=>document.querySelector('#char-typed')?.textContent.length>0);
  assert.ok((await page.locator('#char-typed').innerText()).length<thought.length,'thought reveals progressively');
  await page.waitForFunction(t=>document.querySelector('#char-typed')?.textContent===t,thought);
  assert.equal(await page.locator('.char-label').textContent(),'Recent thought');
  await page.locator('#char-close').click();await open(0);assert.equal(requests.length,1,'cached thought needs no second request');
  await open(1);await waitRequest(2);await open(2);await waitRequest(3);
  await answer(1,'This belongs to the previous resident.');
  assert.equal(await page.locator('.char-thought').innerText(),'Thinking…','stale response cannot replace selected resident');
  await page.locator('#char-close').click();await answer(2,'The card must remain closed.');
  assert.equal(await page.locator('#char-card').isVisible(),false);
  await open(3);await waitRequest(4);await requests[3].fulfill({status:503,json:{error:'Unavailable'}});
  await page.waitForFunction(()=>document.querySelector('.char-label')?.textContent==='Thought unavailable');
  assert.match(await page.locator('.char-thought').innerText(),/Open this resident again/);
  assert.deepEqual(errors,[]);
  console.log('PASS loading, progressive reveal, exact resident, shared requests, cache, close/switch races and failure state');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
