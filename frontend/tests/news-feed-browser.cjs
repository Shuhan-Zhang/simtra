// Isolated feed regression: dated cache coverage, publisher images and safe links.
const {chromium} = require(process.env.SIMTRA_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.SIMTRA_TEST_BASE || 'http://127.0.0.1:5198';
const articles = JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/news/sf.json'),'utf8')).articles;
(async()=>{
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.route(base+'/__news-test*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/feedpanel.css"><div id="ui"><aside id="feed-panel"></aside></div>'}));
    await page.route('https://example.test/broken.jpg',r=>r.abort());
    if(!process.env.SIMTRA_VERIFY_NEWS_IMAGES) await page.route(/https:\/\/(s\.hdnux\.com|assets\.sfstandard\.com|imgs\.search\.brave\.com)\//,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="45"><rect width="80" height="45" fill="blue"/></svg>'}));
    await page.goto(base+'/__news-test?demo=1');
    await page.evaluate(async articles=>{
      const {initFeedPanel}=await import('/src/feedpanel.js');
      initFeedPanel({getCity:()=> 'sf',getNews:()=>articles,getResidents:()=>10000});
    },[...articles,{headline:'Broken image fixture',date:'2026-09-19',url:'https://example.test/story',image_url:'https://example.test/broken.jpg'},
      {headline:'Unsafe link fixture',date:'2026-09-19',url:'javascript:alert(1)',image_url:'javascript:alert(1)'}]);
    await page.locator('.fp-post-news').first().waitFor();
    assert.equal(await page.locator('.fp-post-news').count(),articles.length+2,'feed must not truncate at six stories');
    const broken=page.locator('.fp-post-news').filter({hasText:'Broken image fixture'});
    await broken.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.fp-post-news')).find(e=>e.textContent.includes('Broken image fixture')).querySelector('img'));
    const unsafe=page.locator('.fp-post-news').filter({hasText:'Unsafe link fixture'});
    assert.equal(await unsafe.locator('a,img').count(),0);
    assert.equal(await page.locator('.fp-news-source').count(),articles.length+1);
    await page.locator('.fp-news-image').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.fp-news-image')).every(i=>i.complete),{},{timeout:30000});
    const loaded=await page.locator('.fp-news-image').evaluateAll(images=>images.filter(i=>i.naturalWidth>0).length);
    assert.ok(loaded>0,'publisher imagery should load');
    if(!process.env.SIMTRA_VERIFY_NEWS_IMAGES) assert.equal(loaded,articles.filter(a=>a.image_url).length);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({stories:articles.length,imagesLoaded:loaded,realPublisherImages:!!process.env.SIMTRA_VERIFY_NEWS_IMAGES,brokenImageRemoved:true}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
