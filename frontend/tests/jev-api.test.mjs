import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = new URL('http://localhost:5173');
const api = await import('../src/api.js');
const { rationaleLabel, estimateLabel } = await import('../src/model-display.js');
test('every prediction request uses the selected Jev model without credentials', async () => {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({url, ...options});
    return new Response('{}',{status:200});
  };
  try {
    await api.parseQuestion('sf','Would you support transit?');
    await api.poll('sim:main',{question:'Transit?',model:'removed-provider'});
    await api.abTest('sim:main',{question:'Transit?',variant_a:'A',variant_b:'B'});
    await api.counterfactual('sim:main',{question:'Transit?',marketing_text:'More buses'});
    assert.equal(requests.length,4);
    for (const request of requests) {
      assert.match(request.url,/^http:\/\/localhost:8080\//);
      assert.equal(JSON.parse(request.body).model,'jev-1.13.0');
      assert.equal(request.headers['content-type'],'application/json');
      // workspace/ngrok headers are fine; credentials never leave the server
      for (const h of Object.keys(request.headers)) assert.doesNotMatch(h,/authorization|api-key|x-api/i);
    }
  } finally { globalThis.fetch = original; }
});
test('missing live A/B endpoint reports failure and never loads saved predictions', async () => {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { requests.push(url); return new Response('{"error":"missing"}',{status:404}); };
  try {
    await assert.rejects(api.abTest('sim:main',{}),/404/);
    assert.equal(requests.length,1);
    assert.match(requests[0],/ab-test$/);
  } finally { globalThis.fetch = original; }
});
test('Jev factors and offline results are labeled without mislabeling old results', () => {
  assert.equal(rationaleLabel(['Jev-selected factor (template): affordability.']),'Jev-selected factors · not resident quotes');
  assert.equal(rationaleLabel(['Older model response']),'simulated responses from this audience');
  assert.equal(estimateLabel({model:'jev-1.13.0'}),'Jev model estimate');
  assert.match(estimateLabel({model:'jev-1.13.0',fixture_mode:true}),/not a live prediction/);
});
