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
    const ask = async question => {
      await page.locator('#ask-input').fill(question); await page.locator('#ask-submit').click();
      await page.locator('.ex-rank').first().waitFor({timeout:30000});
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
    assert.equal(await page.locator('.ex-curve [data-scenario]').count(),6);
    assert.match(await page.locator('#research-workspace').innerText(), /24/);
    assert.match(await page.locator('.ex-demo').filter({hasText:'Illustrative'}).innerText(), /Illustrative/);
    await page.locator('.ex-faces button').first().click();
    assert.equal(await page.locator('.ex-person-result').count(),24);
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
      first.researchPanel = {sources:[{title:'Saved market evidence',url:'https://example.com/saved-evidence'}],personas:[{label:'Saved customer profile',attributes:[{key:'budget',value:'Original budget context',provenance:'source'}]}]};
      await store.save(first);
      return first.residents[0].name;
    });
    await page.reload(); await ready(); await page.locator('#research-launch').waitFor();
    await page.locator('#research-launch').click();
    await page.locator('.ex-history-entry').first().waitFor();
    assert.equal(await page.locator('.ex-history-entry').count(), 3, 'all completed runs survive reload');
    const original = page.locator('.ex-history-entry').filter({hasText:"I'm launching a new restaurant in SF"});
    await original.click(); await page.locator('.ex-rank').first().waitFor();
    assert.match(await page.locator('.ex-question').innerText(), /launching a new restaurant/);
    await page.getByText('1 sources · 1 researched profiles', {exact:true}).click();
    assert.equal(await page.getByRole('link',{name:'Saved market evidence'}).getAttribute('href'),'https://example.com/saved-evidence');
    assert.match(await page.locator('#research-workspace').innerText(), /Original budget context/);
    assert.equal(await page.locator('.ex-faces button').first().getAttribute('title'), savedName);
    assert.equal(await page.locator('.ex-curve [data-scenario]').count(),6);
    await page.getByText('Experiment record · 24 combinations', {exact:true}).click();
    assert.equal(await page.locator('.ex-details').filter({hasText:'Experiment record'}).locator('details').count(),24);
    await page.locator('[data-action=history]').click();
    await page.locator('.ex-history-entry').filter({hasText:'What if I raise Chipotle price by 20%?'}).last().click();
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
