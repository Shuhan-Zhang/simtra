// Requires Playwright and Chrome. Run against a static frontend with SIMTRA_TEST_BASE.
const {chromium} = require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.SIMTRA_TEST_BASE || 'http://127.0.0.1:5198';
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(base+'/')) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const ready = () => page.waitForFunction(async () => (await import(document.querySelector('script[type=module]').src)).state.phase === 'idle');
    const researchMarkers = () => page.evaluate(async()=>{
      const {map}=await import(document.querySelector('script[type=module]').src);
      return {active:map.hasResearchResponses,marked:map.agents.filter(a=>a.markerColor||a.verdict||a.response).length};
    });
    const ask = async question => {
      await page.locator('#ask-input').fill(question); await page.locator('#ask-submit').click();
      await page.locator('.ex-matrix-cell').first().waitFor({state:'attached',timeout:30000});
      assert.equal(await page.locator('[data-action=approve]').count(), 0, 'initial question must run automatically');
    };
    await page.goto(base+'/?demo=1'); await ready();
    assert.equal(await page.locator('.ask-options').count(), 0);
    assert.equal(await page.locator('.ask-mode[data-mode=research]').isVisible(), true);
    assert.equal(await page.locator('.ask-mode[data-mode=predict]').isVisible(), true);
    assert.equal(await page.locator('.ask-mode[data-mode=ab]').count(), 0);
    assert.equal(await page.locator('#location-context').isVisible(), false);
    assert.equal(await page.locator('#evo-launch').count(), 0);
    assert.equal(await page.locator('.pr-trigger').isVisible(), false);
    await ask("I'm launching a new restaurant in SF");
    assert.equal(await page.locator('.ex-curve [data-scenario]').count(),24);
    assert.equal(await page.locator('.ex-matrix-cell').count(),24);
    assert.match(await page.locator('.ex-demo').filter({hasText:'Illustrative'}).innerText(), /Illustrative/);
    await page.locator('.ex-faces button').first().click();
    assert.equal(await page.locator('.pr-price-point').count(),6);
    await page.locator('[data-action=close-person]').click();
    await page.locator('[data-action=close]').click();
    await ask('What if I raise Chipotle price by 20%?');
    assert.match(await page.locator('.ex-curve').textContent(), /20%/);
    await page.locator('[data-action=refine]').click();
    assert.match(await page.locator('[data-percent][aria-pressed=true]').textContent(), /10%/);
    await page.locator('[data-action=approve]').click();
    await page.locator('.ex-parent').waitFor();
    await page.locator('.ex-parent').click();
    assert.match(await page.locator('.ex-curve').textContent(), /20%/);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#research-workspace').evaluate(el=>el.scrollTop=0);
    const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,card:document.querySelector('#research-workspace').getBoundingClientRect().toJSON(),title:document.querySelector('#title-select').getBoundingClientRect().toJSON(),scroll:document.querySelector('#research-workspace').scrollWidth,client:document.querySelector('#research-workspace').clientWidth}));
    assert.equal(bounds.width,390); assert.equal(bounds.scroll,bounds.client); assert.ok(bounds.card.bottom<=844); assert.ok(bounds.card.top>bounds.title.bottom, "experiment must not overlap city title");
    await page.screenshot({path:'/tmp/simtra-merge-final-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'/tmp/simtra-merge-final-desktop.png'});
    // Add a known research snapshot to a completed fixture to verify that reopening
    // reads its persisted evidence and residents rather than rebuilding either.
    const savedName = await page.evaluate(async () => {
      const {createRunStore} = await import('./src/research.js');
      const store = createRunStore(`simtra-research-demo-v1:${localStorage.getItem('simtra.workspace')}`);
      const runs = await store.list();
      const first = runs.find(run => run.experiment.decision.includes('launching a new restaurant'));
      first.researchPanel = {sources:[{title:'Saved market evidence',url:'https://example.com/saved-evidence'}],personas:[{label:'Customers expressing a quality objection (inferred archetype)',attributes:[{key:'budget',value:'Original budget context',provenance:'source'}]},{label:'Customers expressing a trust objection (inferred archetype)',attributes:[{key:'objections',value:'trust',provenance:'inferred'}]}]};
      await store.save(first);
      return first.residents[0].name;
    });
    await page.reload(); await ready(); await page.locator('.fp-post-experiment').first().waitFor();
    assert.equal(await page.locator('.fp-views').isVisible(),false, 'news and experiments share one timeline');
    assert.equal(await page.locator('.fp-post-experiment').count(),3, 'all completed runs survive reload');
    await page.evaluate(async()=>{
      const app=await import(document.querySelector('script[type=module]').src);
      app.state.news=Array.from({length:16},(_,i)=>({headline:`Timeline verification headline ${i}`,summary:'Fixture news beside saved experiments.',date:'2026-09-18',url:`https://example.org/news/${i}`,image_url:'/invalid'}));
      app.state.news[0].image_url=location.origin+'/assets/sprites.png';
      (await import('./src/feedpanel.js?v=18')).showCityTimeline();
    });
    assert.equal(await page.locator('.fp-thread .fp-post-news').count(),16);
    assert.equal(await page.locator('.fp-thread .fp-post-experiment').count(),3);
    await page.screenshot({path:'/tmp/simtra-unified-timeline.png'});

    const original = page.locator('.fp-post-experiment').filter({hasText:"I'm launching a new restaurant in SF"});
    await original.locator("button").click();
    assert.equal(await page.locator('.dock .ask').isVisible(),false); await page.locator('.ex-matrix-cell').first().waitFor({state:'attached'});
    assert.match(await page.locator('.ex-question').innerText(), /launching a new restaurant/);
    await page.locator('[data-section=research]').click();
    assert.deepEqual(await researchMarkers(),{active:false,marked:0},'Data & personas removes result overlays');
    assert.equal(await page.getByRole('link',{name:'Saved market evidence'}).getAttribute('href'),'https://example.com/saved-evidence');
    assert.match(await page.locator('#research-workspace').innerText(), /Original budget context/);
    assert.equal(await page.locator('.ex-research-persona h3').first().innerText(),'Quality concerns');
    const tile=await page.locator('.ex-research-persona').first().boundingBox();assert.ok(tile.width<=245 && tile.height<230);
    assert.equal(await page.locator('.ex-research-persona details[open]').count(),0,'persona evidence starts collapsed');
    await page.locator('.ex-research-persona').first().locator('summary').click();
    assert.match(await page.locator('.ex-research-persona details[open]').innerText(),/Original budget context/);
    await page.locator('.ex-research-persona').first().locator('summary').click();
    await page.screenshot({path:'/tmp/simtra-compact-persona-tiles.png'});
    await page.setViewportSize({width:390,height:844});
    const carousel=await page.locator('.ex-persona-carousel').evaluate(el=>{
      el.scrollLeft=el.scrollWidth;
      return {width:el.clientWidth,scrollWidth:el.scrollWidth,left:el.scrollLeft,pageWidth:document.documentElement.scrollWidth};
    });
    assert.ok(carousel.scrollWidth>carousel.width && carousel.left>0,'persona tiles scroll horizontally');
    assert.equal(carousel.pageWidth,390,'persona tiles do not widen the page');
    await page.locator('[data-section=comparisons]').click();
    assert.deepEqual(await researchMarkers(),{active:false,marked:0},'Design removes result overlays');
    const design=await page.locator('.ex-design-node').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().toJSON()));
    assert.equal(design.length,3);
    assert.ok(design.every((box,i)=>i===0||box.top>=design[i-1].bottom),'design factors stack vertically');
    assert.ok(design.every(box=>box.left>=0&&box.right<=390),'design factors remain inside the mobile viewport');
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-section=overview]').click();
    assert.ok((await researchMarkers()).marked>0,'Results restores its response overlays');
    assert.ok(await page.locator('.ex-faces button').count()>0);
    assert.equal(await page.locator('.ex-unified-chart').count(),1,'results use a single chart feature');
    for(const type of ['bar','histogram','scatter','box','line']){
      await page.locator('#experiment-chart-type').selectOption(type);
      assert.equal(await page.locator('.ex-unified-chart').count(),1);
      assert.ok(await page.locator('.ex-faces button').count()>0,`${type} keeps the residents behind the result`);
      assert.equal(await page.locator('.ex-price-plot').isVisible(),type==='line');
      await page.locator('.ex-faces button').first().click();
      assert.equal(await page.locator('#experiment-person').isVisible(),true,`${type} permits resident inspection`);
      await page.locator('[data-action=close-person]').click();
    }
    assert.equal(await page.locator('.ex-curve [data-scenario]').count(),24);
    assert.equal(await page.locator('.ex-matrix-cell').count(),24);
    assert.equal(await page.locator('.ex-design-node').count(),3);
    await page.locator('[data-action=logs]').click();
    assert.deepEqual(await researchMarkers(),{active:false,marked:0},'Logs removes result overlays');
    assert.match(await page.locator('.ex-log-view').innerText(), /Original request/);
    assert.match(await page.locator('.ex-log-view').innerText(), /launching a new restaurant/);
    await page.locator('[data-action=close]').click();
    assert.deepEqual(await researchMarkers(),{active:false,marked:0},'closing experiment leaves no response dots');
    await page.locator('.fp-post-experiment').filter({hasText:'What if I raise Chipotle price by 20%?'}).last().locator('button').click();
    assert.match(await page.locator('.ex-curve').textContent(), /20%/);
    await page.locator('[data-action=close]').click();
    await page.locator('#ask-input').fill('Should the city expand public transit?'); await page.locator('#ask-submit').click();
    await page.getByRole('dialog',{name:'Prediction result'}).waitFor();
    await page.locator('#evidence-panel').waitFor();
    await page.goto(base+'/control.html?demo=1'); await page.locator('#runs button').first().waitFor();
    await page.locator('#runs button').first().click();
    assert.match(await page.locator('#detail').textContent(), /24/);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    console.log('PASS automatic launch + price comparisons, persona inspection, refinement, history, mobile layout, quick prediction and diagnostics; no external requests or runtime errors');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1)});
