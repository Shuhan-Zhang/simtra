import test from 'node:test';
import assert from 'node:assert/strict';
import { personaResultHtml } from '../src/persona-result.js';
const makeRun = () => {
  const scenarios = ['Bayview','Mission'].flatMap(location => ['Takeaway','Dine-in'].flatMap(format => [0,4,8,12,16,20].map(change => ({location,format,change,label:`${location} ${change} ${format}`}))));
  return { residents:[{id:7,name:'Sam <resident>',age:29,occupation:'Nurse',educ:'some_college'}], experiment:{scenarios,indices:[0],metric:'Willingness to buy',priceMode:'relative'}, scenarios:scenarios.map((_, i) => ({response_groups:[{agent_ids:[7],probabilities:[.8 - (i%6)*.1, .2+(i%6)*.1],factor:'Jev-selected factor (template): affordability'}]})) };
};
test('persona gives selected estimate and six controlled prices, not 24 repeated combinations', () => {
  const html = personaResultHtml(makeRun(),7,5);
  assert.equal((html.match(/data-scenario=/g)||[]).length,6);
  assert.match(html,/30.0%/);
  assert.match(html,/80.0%/);
  assert.match(html,/-50.0/);
  assert.match(html,/At current price/);
  assert.match(html,/for people with this profile/);
  assert.match(html,/demographic-group estimate/);
  assert.doesNotMatch(html,/Mission|Dine-in|Jev-selected|Inherited group response/);
  assert.match(html,/data-scenario="5" aria-pressed="true"/);
  assert.match(html,/Sam &lt;resident&gt;/);
  assert.match(html,/Modeled driver/);
});
test('absent profile answers remain unknown, not zero', () => {
  const run=makeRun();run.scenarios[5].response_groups=[];
  const html=personaResultHtml(run,7,5);
  assert.match(html,/pr-person-metric"><strong>Not recorded/);
  assert.doesNotMatch(html,/percentage points/);
});
test('nonprice comparisons do not invent price curves or baselines', () => {
  const run=makeRun();run.experiment.scenarios=[{label:'Offer A'}];run.scenarios=run.scenarios.slice(0,1);
  const html=personaResultHtml(run,7,0);
  assert.match(html,/Offer A/);
  assert.doesNotMatch(html,/price-bars|At current price|percentage points/);
});
test('negative changes compare with actual current price rather than sorted first price', () => {
  const run=makeRun();run.experiment.scenarios.forEach(s=>s.change=-s.change);
  assert.match(personaResultHtml(run,7,5),/80.0%<small>At current price/);
});
test('absolute price baselines say price, never current price', () => {
  const run=makeRun();run.experiment.priceMode='absolute';run.experiment.scenarios.forEach(s=>{s.price=10+s.change;delete s.change;});
  const html=personaResultHtml(run,7,5);
  assert.match(html,/At \$10/);assert.doesNotMatch(html,/At current price/);
});
