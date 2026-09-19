import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= new URL('http://localhost:5173');
const { automaticResearchInput, prepareAutomaticAudience, researchReference } = await import('../src/automatic-audience.js');
const question = 'Would Chipotle customers prefer a smaller, cheaper lunch?';
const panel = { id: 'p', version: 2, content_hash: 'hash', question, location: 'San Francisco', question_context: { requested_market: 'San Francisco' }, status: 'draft', sources: [{ id: 's' }], personas: [{ id: 'a' }] };

test('one question creates a bounded discovery request without inventing owner claims or a company', () => {
  const body = automaticResearchInput(question, 'San Francisco');
  assert.equal(body.question, question);
  assert.deepEqual(body, { question, market: 'San Francisco' });
  assert.throws(() => automaticResearchInput(''), /Ask a question/);
  assert.throws(() => automaticResearchInput('x'.repeat(2001)), /Ask a question/);
});

test('fresh question automatically checks configuration, builds once, and returns the saved version', async () => {
  const calls = [], progress = [];
  const result = await prepareAutomaticAudience(question, { location: panel.location, onProgress: p => progress.push(p.stage), request: async (path, options) => {
    calls.push([path, options.body]);
    if (path === '/config') return { search_configured: true, jev_configured: true };
    if (options.body) return panel;
    return { panels: [] };
  } });
  assert.equal(result, panel);
  assert.deepEqual(progress, ['checking', 'researching', 'ready']);
  assert.deepEqual(calls.map(c => c[0]), ['/panels', '/config', '/automatic']);
  assert.equal(calls.filter(c => c[1]).length, 1);
  assert.deepEqual(researchReference(result), { id: 'p', version: 2, content_hash: 'hash', role: 'research_context_only' });
});

test('same question and market reuses the exact saved version without discovery or model work', async () => {
  const calls = [];
  const result = await prepareAutomaticAudience(question, { location: panel.location, request: async (path, options) => {
    calls.push(path); assert.equal(options.body, undefined);
    return path === '/panels' ? { panels: [panel] } : panel;
  } });
  assert.equal(result, panel);
  assert.deepEqual(calls, ['/panels', '/panels/p?version=2']);
});

test('a different market or question cannot silently reuse a saved panel', async () => {
  for (const other of [{ ...panel, question_context: { requested_market: 'New York City' } }, { ...panel, question: 'An entirely different question?' }]) {
    const paths = [];
    await assert.rejects(prepareAutomaticAudience(question, { location: panel.location, request: async path => {
      paths.push(path); return path === '/panels' ? { panels: [other] } : { search_configured: false };
    } }), /Brave Search and Jev/);
    assert.deepEqual(paths, ['/panels', '/config']);
  }
});

test('insufficient evidence preserves its saved panel and prevents downstream continuation', async () => {
  const empty = { ...panel, status: 'needs_evidence', personas: [] }, progress = [];
  let continued = false;
  await assert.rejects((async () => {
    await prepareAutomaticAudience(question, { onProgress: p => progress.push(p), request: async (path, options) => {
      if (options.body) return empty;
      return path === '/config' ? { search_configured: true, jev_configured: true } : { panels: [] };
    } });
    continued = true;
  })(), /does not support an audience/);
  assert.equal(continued, false);
  assert.equal(progress.at(-1).panel, empty);
  assert.equal(progress.at(-1).stage, 'needs_evidence');
});

test('cancellation between collection and response prevents a stale success or next step', async () => {
  const controller = new AbortController(), progress = [];
  await assert.rejects(prepareAutomaticAudience(question, { signal: controller.signal, onProgress: p => progress.push(p.stage), request: async (path, options) => {
    assert.equal(options.signal, controller.signal);
    if (options.body) { controller.abort(); return panel; }
    return path === '/config' ? { search_configured: true, jev_configured: true } : { panels: [] };
  } }), { name: 'AbortError' });
  assert.deepEqual(progress, ['checking', 'researching']);
});

test('a pre-cancelled request and a backend failure never proceed to a paid build', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(prepareAutomaticAudience(question, { signal: controller.signal, request: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(prepareAutomaticAudience(question, { request: async () => { calls++; throw new Error('Backend unavailable'); } }), /Backend unavailable/);
  assert.equal(calls, 1);
});

test('legacy panels without interpreted context do not bypass automatic identification', async () => {
  const { question_context, ...legacy } = panel;
  const calls = [];
  await prepareAutomaticAudience(question, { location: panel.location, request: async (path, options) => {
    calls.push(path);
    if (options.body) return panel;
    return path === '/config' ? { search_configured: true, jev_configured: true } : { panels: [legacy] };
  } });
  assert.deepEqual(calls, ['/panels', '/config', '/automatic']);
});
