import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResearchSummary, renderResearchPanel } from '../src/persona-research.js';
const quote = 'Price matters and pickup is convenient.';
const panel = {
  id: 'panel', version: 2, business: 'Chipotle', question: 'Would Chipotle customers prefer pickup?',
  sources: [{ id: 's', text: quote, title: 'Review', url: 'https://example.com/review', retrieved_at: '2026-09-19' }],
  personas: [{ id: 'p', label: 'Value-oriented buyers', attributes: [
    { key: 'objections', value: 'price', provenance: 'inferred', evidence: [{ source_id: 's', excerpt: quote }] },
    { key: 'purchase_frequency', value: null, provenance: 'unknown' },
  ] }],
  conflicts: [{attribute:'price sensitivity', values:['high','low']}], gaps:['No purchase history'], warnings:['Small source sample'],
};
test('summary retains profile evidence, provenance, version and uncertainty separately from simulation', () => {
  const html = renderResearchSummary(panel);
  for (const value of ['Customer personas','Value-oriented buyers',quote,'https://example.com/review','inferred','saved panel v2','Unknown: purchase frequency','Conflicting evidence','No purchase history','Small source sample','not used to calculate the simulation']) assert.ok(html.includes(value), value);
  assert.ok(renderResearchPanel(panel).includes('Customer personas'));
  assert.doesNotMatch(html, /research-cast|data-research-index|gold-outlined/);
});
test('summary rejects unsupported claims and fabricated or missing citations', () => {
  for (const evidence of [[],[{source_id:'missing',excerpt:quote}],[{source_id:'s',excerpt:'Fabricated quote'}]]) {
    const copy = structuredClone(panel); copy.personas[0].attributes[0].value='UNSUPPORTED'; copy.personas[0].attributes[0].evidence=evidence;
    assert.doesNotMatch(renderResearchSummary(copy), /UNSUPPORTED|Fabricated quote/);
  }
  assert.equal(renderResearchSummary(null),'');
});
test('summary escapes untrusted text and refuses unsafe links', () => {
  const copy = structuredClone(panel); copy.personas[0].label='<script>alert(1)</script>'; copy.sources[0].url='javascript:alert(1)';
  const html = renderResearchSummary(copy);
  assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script>|javascript:/);
});

test('personas are compact interactive heads with evidence behind disclosure', () => {
  const html = renderResearchSummary(panel);
  assert.match(html, /class="pr-persona-head"/);
  assert.match(html, /What this persona adds/);
  assert.match(html, /Sources &amp; limits/);
  assert.match(html, /class="pc-person-portrait pr-sprite-head"/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test('persona heads reuse the city sprite sheet crop, not custom avatar artwork', () => {
  const html = renderResearchSummary(panel);
  assert.match(html, /background-position:-64px -0px/);
  assert.doesNotMatch(html, /<svg|pr-avatar/);
});
