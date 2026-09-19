// Real pointer click through the map to the matching resident profile.
const {chromium}=require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto((process.env.SIMTRA_TEST_BASE||'http://127.0.0.1:5198')+'/?demo=1');
 await page.evaluate(async()=>{window.profileTestApp=await import(document.querySelector('script[type=module]').src);});
 await page.waitForFunction(()=>profileTestApp.state.mainBranch&&profileTestApp.state.rawResidents.length>0);
 assert.equal(await page.locator('#title-select #status').count(),1);
 assert.match(await page.locator('#status').innerText(),/10,000 simulated residents/);
 assert.equal(await page.locator('.status').count(),0);
 const hit=await page.evaluate(()=>{
  const {map,state}=profileTestApp;
  const a=map.agents[Math.floor(map.agents.length/2)];
  for(const sprite of map.agents)sprite.speed=0;
  map.cam={x:a.wx,y:a.wy,zoom:4};map.camTarget={...map.cam};map.zoomedIn=true;
  const point=map.worldToScreen(a.wx,a.wy),x=point.x,y=point.y-8;
  const sprite=map._hitSprite(x,y);
  if(!sprite)throw Error('No test resident under pointer');
  const r=map.canvas.getBoundingClientRect();
  return {x:r.left+x,y:r.top+y,name:state.rawResidents.find(p=>p.id===sprite.seed).name};
 });
 await page.mouse.click(hit.x,hit.y);
 await page.locator('#char-card:not(.hidden)').waitFor();
 assert.equal(await page.locator('#char-card .char-name').innerText(),hit.name);
 const bounds=await page.locator('#char-card').boundingBox();
 assert.ok(bounds.x<50 && bounds.y>500,'profile stays at the bottom left');
 await page.locator('#char-close').click();
 assert.equal(await page.locator('#char-card').isVisible(),false);
 assert.deepEqual(errors,[]);
 const tabs=await page.locator('.fp-view').allTextContents();assert.equal(tabs.length,2);assert.ok(tabs[0].startsWith('All'));assert.ok(tabs[1].startsWith('News'));
 console.log('PASS actual map click opens matching bottom-left resident profile and closes; feed only has All and News');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
