import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperiment, MEASURES, metricShare, scenarioShare, segmentRows, responseFor, refineDraft } from '../src/research.js';
const draft = () => ({ decision:'Raise prices?', kind:'price', product:'Standard burrito', current:'10', middle:'11', proposed:'12', measure:'intent', question:MEASURES.intent.question, assumptions:'Same portion size' });
test('prices and assumptions are explicit; missing, duplicate and invalid prices are rejected', () => {
  const d = draft();
  const result = buildExperiment(d);
  assert.deepEqual(result.scenarios.map(s => s.label), ['Current price', '+10% price', '+20% price']);
  assert.deepEqual(result.scenarios.map(s => s.price), [10, 11, 12]);
  for (const current of ['', '0', '-1', 'Infinity', '11', '11.001']) assert.throws(() => buildExperiment({...d, current}));
  assert.throws(() => buildExperiment({...d, assumptions:''}));
  assert.throws(() => buildExperiment({...d, question:''}));
  assert.equal(d.proposed,'12');
});
test('metric uses fixed response indices, never each scenario winner or agent counts', () => {
  const s = {result:{p_yes:.8,p_distribution:[['Buy',.2],['Not buy',.8]]}};
  assert.equal(scenarioShare(s,[0]), .2);
  assert.equal(metricShare([.5,.2,.2,.1],MEASURES.frequency.indices), .30000000000000004);
  assert.equal(metricShare(null,[0]),null);
  assert.equal(metricShare([0,1],[0]),0);
});
test('segment comparisons align keys across scenarios and preserve missing data', () => {
  const s = groups => ({result:{option_breakdowns:[{dimension:'age',groups}]}});
  const run = {experiment:{indices:[0]},scenarios:[s([{key:'25-34',shares:[.7,.3],n:10}]),s([{key:'35-44',shares:[.9,.1],n:20},{key:'25-34',shares:[.4,.6],n:10}])]};
  const rows = segmentRows(run,'age');
  assert.deepEqual(rows[0].shares,[.7,.4]);
  assert.ok(Math.abs(rows[0].delta + .3) < 1e-9);
  assert.equal(rows[1].delta,null);
  assert.equal(rows[1].shares[0],null);
});
test('resident responses are looked up by recorded membership, never demographic guesses', () => {
  const group = {agent_ids:[7,12],probabilities:[.1,.9],factor:'Fixture factor'};
  const scenario = {response_groups:[group]};
  assert.equal(responseFor(scenario,12),group);
  assert.equal(responseFor(scenario,8),null);
});
test('refinements preserve prior runs and require a concrete offer', () => {
  const run = {draft:draft(),experiment:buildExperiment(draft())};
  const smaller = refineDraft(run,'smaller');
  assert.equal(smaller.proposed,'11.00'); assert.equal(smaller.middle,'10.50');
  assert.equal(run.draft.proposed,'12');
  const offer = refineDraft(run,'offer');
  assert.equal(offer.kind,'custom'); assert.equal(offer.scenarios[2].description,'');
  assert.throws(() => buildExperiment(offer), /Describe/);
});
