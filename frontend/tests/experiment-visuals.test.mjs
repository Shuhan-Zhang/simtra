import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioMatrixHtml, experimentDesignHtml } from '../src/experiment-visuals.js';
const fixture=()=>({experiment:{metric:'Willingness to buy',priceMode:'relative',indices:[0],options:['Buy','Do not buy'],question:'Would you buy?',assumptions:'Same meal',factors:[{id:'location',label:'Location',levels:['A','B']},{id:'price',label:'Price',levels:['Current','+20%']}],scenarios:[{location:'B',format:'Takeaway',change:20,label:'B higher',description:'Higher price'},{location:'A',format:'Takeaway',change:0,label:'A current'},{location:'B',format:'Takeaway',change:0,label:'B current'},{location:'A',format:'Takeaway',change:20,label:'A higher'}]},scenarios:[.2,.8,.7,.3].map(p=>({result:{p_distribution:[['Buy',p],['Do not buy',1-p]]},response_groups:[{agent_ids:[42],probabilities:[p/2,1-p/2]}]}))});
test('matrix preserves original indices after rows and prices reorder; selected detail records distribution',()=>{
 const html=scenarioMatrixHtml(fixture(),0);
 assert.match(html,/data-scenario="2"[^>]*aria-pressed="false"/);
 assert.match(html,/data-scenario="0"[^>]*aria-pressed="true"/);
 assert.equal((html.match(/data-scenario=/g)||[]).length,4);
 assert.match(html,/Selected combination/);assert.match(html,/Higher price/);assert.match(html,/80.0%/);
 assert.ok(html.indexOf('data-scenario="2"')<html.indexOf('data-scenario="0"'));
});
test('persona metric is taken from its actual group; unrecorded values are not fabricated',()=>{
 const run=fixture();
 assert.match(scenarioMatrixHtml(run,0,{personId:42}),/10.0%/);
 const html=scenarioMatrixHtml(run,0,{personId:999});
 assert.match(html,/Not recorded/);assert.doesNotMatch(html,/20.0%/);
 run.scenarios[0]=null;assert.match(scenarioMatrixHtml(run,0),/Not recorded/);
});
test('missing combination is shown untested and non-price historical options use cards',()=>{
 const run=fixture();run.experiment.scenarios.pop();run.scenarios.pop();
 assert.match(scenarioMatrixHtml(run,0),/Not tested/);
 const historical={experiment:{indices:[0],scenarios:[{label:'Keep <price>',description:'One'},{label:'Change',description:'Two'}]},scenarios:[]};
 const html=scenarioMatrixHtml(historical,0);
 assert.match(html,/ex-scenario-cards/);assert.match(html,/Keep &lt;price&gt;/);assert.doesNotMatch(html,/<table/);
});
test('design renders recorded factors as nodes with expandable exact assumptions',()=>{
 const run=fixture();run.experiment.assumptions='<script>not markup</script>';
 const html=experimentDesignHtml(run);
 assert.match(html,/ex-design-node/);assert.match(html,/<strong>4<\/strong>/);assert.match(html,/Would you buy\?/);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/Assumptions and model details/);
});
