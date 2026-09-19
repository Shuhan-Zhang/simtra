import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Exercise the actual async controllers with minimal DOM shims and deferred HTTP.
// Rendering is covered separately by the browser harness.
const source = readFileSync(new URL('./feedpanel.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function harness() {
  const ctx = vm.createContext({ console, crypto: webcrypto, setTimeout, clearTimeout,
    setInterval, clearInterval, URLSearchParams, BASE: '', today: () => '2026-09-19',
    detectKind: () => 'news', document: {}, localStorage: { getItem: () => null } });
  vm.runInContext(source + `
    let city = 'sf';
    const button = { disabled: false, textContent: 'Post' };
    const error = { textContent: '' };
    const form = { elements: { text: { value: 'Transit fares rise', focus() {} }, as_of_date: { value: '2026-09-19' } },
      querySelector: (s) => s === '.fp-error' ? error : button };
    state.el = { formPost: form, kind: {dataset:{kind:'news'}}, body: {scrollTo() {}}, thread: {offsetTop:0} };
    state.getCity = () => city;
    state.getBranch = () => city + ':main';
    state.root = {};
    renderThread = () => { for (const item of state.items) {
      if (!state.posts.has(item.id)) state.posts.set(item.id, {dataset:{}, item});
    }};
    fillEvent = (post, item, options) => { post.item = item; post.pending = options?.pending || 0; };
    renderEventActions = (post, item, options) => { post.note = options?.note; };
    syncHeader = () => { button.disabled = state.posting; };
    setKind = () => {};
    setView = (v) => {state.view = v};
    globalThis.h = {state, api, button, error, form, postEvent, reactTo, refreshFeedPanel,
      setCity: (value) => {city = value; state.items = []; state.posts.clear();} };
  `, ctx);
  return ctx.h;
}
const submit = { preventDefault() {} };
const reaction = { agent_id: 7, sentiment: 'worried', text: 'Simulated reaction: worried.' };

test('news appears before persistence and composer unlocks before one reaction batch completes', async () => {
  const h = harness(), save = deferred(), update = deferred();
  let calls = 0;
  h.api.postEvent = () => save.promise;
  h.api.react = (branch, id, n) => { calls++; assert.equal(n, 12); return update.promise; };
  const posting = h.postEvent(submit);
  assert.equal(h.state.items[0].saving, true);
  assert.equal(h.button.disabled, true);
  await h.postEvent(submit); // duplicate submission must not create a second event
  save.resolve({event: {id: 'event-1', text: 'Transit fares rise'}});
  await posting;
  assert.equal(h.button.disabled, false);
  assert.equal(calls, 1);
  assert.equal(h.state.items[0].id, 'event-1');
  assert.equal(h.state.busy, 1);
  update.resolve({ reactions: [reaction, reaction] });
  await new Promise(setImmediate);
  assert.equal(h.state.items[0].reaction_count, 1);
  assert.equal(h.state.busy, 0);
  h.api.react = async () => ({ reactions: [reaction] });
  await h.reactTo('event-1');
  assert.equal(h.state.items[0].reaction_count, 1);
});

test('save failure removes the pending post and preserves the draft', async () => {
  const h = harness();
  h.api.postEvent = async () => { throw new Error('Could not save'); };
  await h.postEvent(submit);
  assert.equal(h.state.items.length, 0);
  assert.equal(h.form.elements.text.value, 'Transit fares rise');
  assert.equal(h.error.textContent, 'Could not save');
  assert.equal(h.button.disabled, false);
});

test('reaction failure keeps saved news and reports configuration error without claiming memory is off', async () => {
  const h = harness();
  h.api.postEvent = async () => ({event:{id:'saved'}});
  h.api.react = async () => { throw Object.assign(new Error('Configure TYPESAFE_API_KEY'), {status:503, code:'typesafe_not_configured'}); };
  await h.postEvent(submit);
  await new Promise(setImmediate);
  assert.equal(h.state.items[0].id, 'saved');
  assert.equal(h.state.posts.get('saved').note, 'Configure TYPESAFE_API_KEY');
  assert.equal(h.state.memoryOff, false);
  assert.equal(h.state.busy, 0);
});

test('late save cannot insert old-city news into a newly selected city', async () => {
  const h = harness(), save = deferred();
  h.api.postEvent = () => save.promise;
  const pending = h.postEvent(submit);
  h.setCity('neu_york');
  save.resolve({event:{id:'sf-event'}});
  await pending;
  assert.equal(h.state.items.length, 0);
  assert.equal(h.state.busy, 0);
});

test('history refresh cannot replace an in-flight news card', async () => {
  const h = harness();
  h.state.feedCity = 'sf';
  h.state.busy = 1;
  h.state.items = [{id:'pending-news', type:'event', saving:true}];
  h.api.lineage = () => { throw new Error('must not request history during mutation'); };
  await h.refreshFeedPanel();
  assert.equal(h.state.items[0].id, 'pending-news');
});
