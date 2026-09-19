import test from 'node:test';
import assert from 'node:assert/strict';
import {autoPlan, compilePlan, budgetFrom, priceRangeFrom, priceSeries, rankScenarios, explicitAlternatives} from '../src/experiment-plan.js';
import {controlRecordFromRun} from '../src/control-store.js';
const route={kind:'launch',business:'marketplace',measure:'trial',locations:['Mission','Sunset'],available_locations:['Mission','Sunset','Richmond']};
test('Jollibee overrides a stale marketplace route: three factors, 24 combinations, no invented budget or discount',()=>{
  const plan=autoPlan("i'm launching a new jolibee in sf",route),exp=compilePlan(plan);
  assert.equal(plan.business,'restaurant');assert.equal(plan.budget,null);
  assert.deepEqual(exp.factors.map(f=>f.label),['Location','Meal price','Service format']);
  assert.equal(exp.scenarios.length,24);assert.equal(new Set(exp.scenarios.map(s=>s.label)).size,24);
  assert.deepEqual([...new Set(exp.scenarios.map(s=>s.price))],[10,12,14,16,18,20]);
  assert.deepEqual([...new Set(exp.scenarios.map(s=>s.format))],['Takeaway','Dine-in']);
  assert.ok(exp.scenarios.every(s=>!('incentiveCap' in s)&&!('offer' in s)));
  assert.match(exp.question,/buy a meal from this restaurant/);
  assert.match(exp.assumptions,/not a marketplace/);assert.doesNotMatch(exp.assumptions,/\$5000/);
  assert.deepEqual(exp.indices,[0]);
});
test('explicit marketplace budget stays a constraint, not an invented allocation',()=>{
  const plan=autoPlan('I have 5000 dollars to launch a food marketplace in SF',route),exp=compilePlan(plan);
  assert.equal(plan.budget,5000);assert.equal(exp.scenarios.length,24);
  assert.equal(exp.factors[2].label,'Fulfillment');
  assert.match(exp.assumptions,/No budget allocation/);assert.equal(exp.incentiveBudget,undefined);
});
test('relative price range has six values without inventing a current menu price',()=>{
  const plan=autoPlan('what if I raise chipotle price by 20%',{...route,kind:'price'}),exp=compilePlan(plan);
  assert.deepEqual(exp.scenarios.slice(0,6).map(s=>s.change),[0,4,8,12,16,20]);
  assert.equal(exp.scenarios.length,24);assert.match(exp.assumptions,/No absolute menu price/);
  assert.ok(exp.scenarios.every(s=>!s.description.includes('$')));
  assert.equal(autoPlan('Reduce restaurant price by 12.5 percent',{...route,kind:'price'}).percent,-12.5);
  for(const q of ['Cut price 100%','Raise price by 0%'])assert.throws(()=>autoPlan(q,{...route,kind:'price'}));
});
test('explicit dollar ranges override defaults and validation rejects reversed or tiny ranges',()=>{
  for(const q of ['meals from $12 to $22','12-22 dollars','between $12 and $22'])assert.deepEqual(priceRangeFrom(q),[12,22]);
  const plan=autoPlan('Jollibee price $12 to $22',{...route,kind:'price'});
  assert.equal(plan.priceSuggested,false);assert.deepEqual(compilePlan(plan).scenarios.slice(0,6).map(s=>s.price),[12,14,16,18,20,22]);
  assert.throws(()=>priceRangeFrom('$20 to $10'));
  assert.throws(()=>compilePlan({...plan,priceRange:[10,10.01]}));
  assert.throws(()=>autoPlan('launch a restaurant',{kind:'launch'}));
});
test('steering changes actual payloads without mutating the previous plan',()=>{
  const plan=autoPlan('launch a restaurant',route),next=structuredClone(plan);
  next.locations=['Mission','Richmond'];next.priceRange=[12,22];next.measure='frequency';
  const exp=compilePlan(next);
  assert.equal(exp.scenarios.length,24);assert.match(exp.scenarios[12].description,/Richmond/);
  assert.equal(exp.scenarios[0].price,12);assert.deepEqual(exp.indices,[2,3]);
  assert.equal(compilePlan(plan).scenarios[0].price,10);
  assert.throws(()=>compilePlan({...plan,locations:['Mission','Mission']}));
});
test('curves vary only price, never connect different locations or formats',()=>{
  const experiment=compilePlan(autoPlan('launch a restaurant',route));
  const run={experiment,scenarios:experiment.scenarios.map(()=>({}))};
  for(let selected=0;selected<24;selected++){
    const series=priceSeries(run,selected),ref=experiment.scenarios[selected];
    assert.equal(series.length,6);assert.deepEqual(series.map(r=>r.scenario.price),[10,12,14,16,18,20]);
    assert.ok(series.every(r=>r.scenario.location===ref.location&&r.scenario.format===ref.format));
  }
});
test('budget extraction and generic comparisons retain explicit alternatives with three factors',()=>{
  for(const q of ['$5,000 to launch','5000 dollar budget','5k dollars','$5k to start','5000 USD'])assert.equal(budgetFrom(q),5000,q);
  assert.equal(budgetFrom('launch soon'),null);
  assert.deepEqual(explicitAlternatives('Which offer: pickup, delivery or subscription?'),['pickup','delivery','subscription']);
  const exp=compilePlan(autoPlan('Which offer: pickup, delivery or subscription?',{kind:'compare',measure:'support'}));
  assert.equal(exp.factors.length,3);assert.equal(exp.scenarios.length,12);
  assert.throws(()=>autoPlan('What is the population?',{kind:'unsupported'}));
});
test('ranking is numeric and tied ranks stay honest',()=>{
  const run={experiment:{indices:[0],scenarios:[{label:'A'},{label:'B'},{label:'C'}]},scenarios:[.2,.6,.6].map(p=>({result:{p_yes:.99,p_distribution:[['Buy',p],['No',1-p]]}}))};
  const rows=rankScenarios(run);
  assert.deepEqual(rows.map(r=>r.index),[1,2,0]);assert.deepEqual(rows.map(r=>r.rank),[1,1,3]);assert.equal(rows[0].delta,0);
});
test('control records retain exact experiments and evidence without duplicating personas',()=>{
  const run={id:'old',controlId:'audit',createdAt:'2026-09-19',city:'sf',model:'fixture',residents:[{id:1,privatePersona:'example'}],experiment:{decision:'Launch?',scenarios:[{label:'A'}]},executionLog:[{kind:'model.request'}],scenarios:[{result:{p_distribution:[['Buy',.5],['No',.5]]},response_groups:[{agent_ids:[1]}]}]};
  const record=controlRecordFromRun(run);assert.equal(record.id,'audit');assert.equal(record.status,'completed');
  assert.equal(record.scenarios[0].coveredResidents,1);assert.equal(record.events.length,1);
  assert.doesNotMatch(JSON.stringify(record),/privatePersona/);assert.deepEqual(record.experiment,run.experiment);
});
test('Chipotle demo without a stated price uses a bounded relative bowl sweep',()=>{
  const plan=autoPlan('I want to raise chipotle bowl prices in sf',{...route,kind:'price'}), exp=compilePlan(plan);
  assert.equal(plan.business,'restaurant');
  assert.equal(plan.priceMode,'relative');
  assert.equal(plan.priceSuggested,true);
  assert.deepEqual(exp.scenarios.slice(0,6).map(s=>s.change),[0,4,8,12,16,20]);
  assert.equal(exp.scenarios.length,24);
  assert.match(exp.question,/buy a bowl/);
  assert.match(exp.assumptions,/No absolute menu price is assumed/);
  assert.match(exp.assumptions,/same city-wide audience/);
  assert.ok(exp.scenarios.every(s=>s.price===undefined && !s.description.includes('$')));
});
