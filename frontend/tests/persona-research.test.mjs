import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = new URL('http://localhost:5173');
const { makeResearchRequest, renderResearchPanel, researchRequest, sourceUrl, retainedResearchInputs } = await import('../src/persona-research.js');
const values = { question: ' Pricing concerns? ', business: 'Chipotle', location: 'SF', panel_size: '6' };
test('research request preserves founder context, deduplicates URLs, and separates pasted evidence', () => {
  const payload = makeResearchRequest({ ...values, urls: 'https://www.reddit.com/r/test\nhttps://x.com/test\nhttps://x.com/test', evidence: ' Actual excerpt ', evidence_kind: 'review', founder_context: 'Owner assumption', discover: 'on' }, { panelId: 'saved-panel' });
  assert.equal(payload.question, 'Pricing concerns?'); assert.equal(payload.sources.length, 3);
  assert.deepEqual(payload.sources.map(s => s.kind), ['reddit', 'x', 'review']);
  assert.equal(payload.sources[2].text, 'Actual excerpt'); assert.equal(payload.founder_context, 'Owner assumption');
  assert.equal(payload.panel_id, 'saved-panel'); assert.equal(payload.discover, true);
  assert.equal('model' in payload, false); assert.equal('scenario' in payload, false);
});
test('input validation rejects unsafe links, unsupported panel sizes and too many sources', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com']) {
    assert.equal(sourceUrl(url), null); assert.throws(() => makeResearchRequest({ ...values, urls: url }), /source URL/);
  }
  for (const size of [0, 1, 13, 1.5, 'not-a-number']) assert.throws(() => makeResearchRequest({ ...values, panel_size: size }), /panel size/);
  assert.throws(() => makeResearchRequest({ ...values, urls: 'https://a.com\nhttps://b.com', evidence: 'excerpt' }, { maxSources: 2 }), /at most 2/);
  assert.throws(() => makeResearchRequest({ ...values, business: ' ' }), /business/);
});
test('render keeps unknowns and conflicts visible, resolves citations and escapes untrusted text', () => {
  const html = renderResearchPanel({ id: 'p', version: 1, business: '<img onerror=bad()>', question: 'What?', status: 'needs_evidence', sources: [{ id: 's', title: '<script>evil()</script>', url: 'javascript:bad()', text: 'Original quote', kind: 'review' }], personas: [{ label: 'Price-sensitive situation', attributes: [{ key: 'purchase_frequency', value: null, provenance: 'unknown', evidence: [] }, { key: 'objection', value: '<iframe>', provenance: 'sourced', evidence: [{ source_id: 's', excerpt: 'Evidence <b>quote</b>' }] }] }], conflicts: [{ attribute: 'price', values: ['$10', '$12'], source_ids: ['s'] }], gaps: ['Unknown location'], methodology: { synthetic: true } });
  assert.match(html, /Needs evidence/); assert.match(html, /Unknown — no supported value/); assert.match(html, /Conflicting evidence/);
  assert.match(html, /Sources: \[1\]/); assert.match(html, /Evidence \[1\]/); assert.match(html, /Evidence &lt;b&gt;quote&lt;\/b&gt;/);
  assert.match(html, /not verified individual customers/); assert.match(html, /No scenario has been evaluated/);
  assert.doesNotMatch(html, /<img|<script|<iframe|href="javascript/);
});
test('missing sources never turn into fabricated citations', () => {
  const html = renderResearchPanel({ personas: [{ label: 'A', attributes: [{ key: 'need', value: 'Value', provenance: 'invented', evidence: [{ source_id: 'missing', excerpt: 'Source missing' }] }] }] });
  assert.match(html, /unresolved source/); assert.match(html, /pr-tag-unknown/); assert.match(html, /No sources collected/);
});
test('client calls only research endpoints without browser credentials', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return new Response('{"id":"p"}', { status: 200 }); };
  const body = makeResearchRequest(values);
  await researchRequest('/panels', { base: 'http://localhost:8080', body, fetcher });
  assert.equal(calls[0].url, 'http://localhost:8080/audience-research/panels');
  assert.deepEqual(calls[0].options.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  await assert.rejects(researchRequest('/panels', { base: '', fetcher }), /Set SIMTRA_BACKEND/);
  assert.equal(calls.length, 1);
});
test('client surfaces failed service and timeout without pretending a panel was saved', async () => {
  await assert.rejects(researchRequest('/panels', { base: 'http://localhost:8080', fetcher: async () => new Response('{"error":"Evidence fetch failed"}', { status: 422 }) }), /Evidence fetch failed/);
  await assert.rejects(researchRequest('/panels', { base: 'http://localhost:8080', timeout: 2, fetcher: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }), /Refresh saved panels before retrying/);
});

test('revision preserves evidence and owner provenance without pretending old pages are fresh', () => {
  const panel = { sources: [
    { kind: 'fetched_review', title: 'Review', text: 'Price matters', url: 'https://example.com/review' },
    { kind: 'pasted_reddit', title: 'Discussion', text: 'Pickup helps' },
    { kind: 'founder', text: 'Customers often order lunch' },
  ] };
  const retained = retainedResearchInputs(panel);
  assert.equal(retained.founderContext, 'Customers often order lunch');
  assert.deepEqual(retained.sources.map(s => s.kind), ['review', 'reddit']);
  assert.equal(retained.sources[0].text, 'Price matters');
  const request = makeResearchRequest({ ...values, founder_context: retained.founderContext }, { panelId: 'panel', carriedSources: retained.sources });
  assert.equal(request.sources.length, 2); assert.equal(request.sources[0].url, 'https://example.com/review');
  assert.equal(request.founder_context, 'Customers often order lunch'); assert.equal(request.panel_id, 'panel');
  assert.throws(() => makeResearchRequest({ ...values, evidence: 'Added' }, { carriedSources: retained.sources, maxSources: 2 }), /retained evidence/);
});
test('version picker preserves a route back to latest while viewing an older immutable panel', () => {
  const html = renderResearchPanel({ id: 'p', version: 1, personas: [] }, 3);
  assert.match(html, /value="1" selected/);
  assert.match(html, /value="3">Version 3 · latest/);
  const bounded = renderResearchPanel({ id: 'p', version: 1, personas: [] }, 1000);
  assert.equal((bounded.match(/<option /g) || []).length, 101);
});
test('compact result shows supported attributes first without hiding that unknowns and gaps exist', () => {
  const html = renderResearchPanel({ version: 1, personas: [{ label: 'Buyer', attributes: [
    { key: 'frequency', value: null, provenance: 'unknown' },
    { key: 'need', value: 'Pickup convenience', provenance: 'sourced' },
  ] }], gaps: ['Frequency unknown'], warnings: ['Small evidence base'] });
  assert.match(html, /1 research profile ·/);
  assert.match(html, /<details class="pr-unknown"><summary>1 unknown attribute<\/summary>/);
  assert.match(html, /<details class="pr-warning"><summary>Missing information · 1/);
  assert.match(html, /<details class="pr-method"><summary>Research limitations · 1/);
  assert.ok(html.indexOf('Pickup convenience') < html.indexOf('1 unknown attribute'));
  assert.ok(html.indexOf('Audience profiles') < html.indexOf('Missing information'));
  assert.match(html, /Unknown — no supported value/);
});
