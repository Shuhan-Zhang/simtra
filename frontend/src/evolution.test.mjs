import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./evolution.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const flush=()=>new Promise(setImmediate);
function classList(){const values=new Set();return {add(...names){names.forEach(n=>values.add(n));},remove(...names){names.forEach(n=>values.delete(n));},contains(name){return values.has(name);},toggle(name,force){const selected=force??!values.has(name);if(selected)values.add(name);else values.delete(name);return selected;}};}
function element(){return {classList:classList(),replaceChildren(...nodes){this.nodes=nodes;},hidden:false,value:'2400',dataset:{},children:new Map(),listeners:{},setAttribute(){},focus(){},append(){},querySelector(s){if(!this.children.has(s))this.children.set(s,element());return this.children.get(s);},querySelectorAll(){return[];},addEventListener(n,f){this.listeners[n]=f;},fire(n='click',e={}){return this.listeners[n]?.(e);}};}
function fixture(){
 return {id:'run',branch:'main',scenario:'Restaurant prices rise 20%',population:10000,max_ticks:14,groups:[{id:0,members:[1],weight:1}],outcomes:[{id:'same',label:'Keep routine',changed:false},{id:'switch',label:'Switch restaurants',changed:true}],frames:[frame(0)]};
}
const frame=tick=>({tick,day:tick,changed_count:tick?4000:0,changed_share:tick?.4:0,behaviors:[{group:0,outcome:tick?'switch':'same'}],totals:[{id:'same',share:tick?.6:1,count:tick?6000:10000},{id:'switch',share:tick?.4:0,count:tick?4000:0}]});
function harness(){
 const els=[],pending=[],saved=new Map(),map={setEvolution(v){this.evolution=v;}};
 const document={body:{append(...nodes){for(const node of nodes)if(!els.includes(node))els.push(node);},classList:classList()},createElement:element,addEventListener(){}};
 const ctx=vm.createContext({document,console,AbortController,DOMException,structuredClone,BASE:'',workspaceHeaders:()=>({'X-Simtra-Workspace':'test'}),sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},setTimeout:()=>1,clearTimeout(){},setInterval(){},fetch:(url,options)=>new Promise(resolve=>pending.push({url,body:JSON.parse(options.body||'null'),resolve:data=>resolve({ok:!data.error,json:async()=>data})}))});
 vm.runInContext(source+'\nglobalThis.init=initEvolution;',ctx);
 const controller=ctx.init({map,getBranch:()=> 'main',getCity:()=> 'sf',isReady:()=>true});
 const [root,transport]=els,q=s=>root.querySelector(s),t=s=>transport.querySelector(s);
 controller.open();
 return {map,pending,q,t,launch:{fire:()=>controller.open()},root,controller,async start(){t('[data-step-forward]').fire();pending.shift().resolve(fixture());await flush();},resolveStep(tick){pending.shift().resolve({frame:frame(tick)});}};
}
test('reset during pending step retains baseline and records result for exact replay',async()=>{
 const h=harness();await h.start();h.t('[data-reset]').fire();h.resolveStep(1);await flush();
 assert.equal(h.map.evolution.frame.tick,0);assert.equal(h.t('[data-scrub]').max,14);
 h.t('[data-step-forward]').fire();await flush();assert.equal(h.map.evolution.frame.tick,1);assert.equal(h.pending.length,0);
});
test('closing during inference never restores the overlay or schedules further calls',async()=>{
 const h=harness();await h.start();h.q('[data-close]').fire();h.resolveStep(1);await flush();
 assert.equal(h.map.evolution,null);assert.equal(h.pending.length,0);assert.equal(h.root.hidden,true);
 h.launch.fire();assert.equal(h.map.evolution.frame.tick,0);h.t('[data-latest]').fire();assert.equal(h.map.evolution.frame.tick,1);
});
test('duplicate step clicks create only one request and pause preserves the viewed frame',async()=>{
 const h=harness();await h.start();h.t('[data-step-forward]').fire();assert.equal(h.pending.length,1);
 h.resolveStep(1);await flush();assert.equal(h.t('[data-scrub]').max,14);
});
test('failure preserves timeline and next step retries the same position',async()=>{
 const h=harness();await h.start();const pending=h.pending.shift();pending.resolve({error:'bad'});await flush();
 assert.equal(h.map.evolution.frame.tick,0);assert.ok(h.q('[data-error]').textContent);
 h.t('[data-step-forward]').fire();await flush();assert.equal(h.pending.length,1);h.resolveStep(1);await flush();assert.equal(h.map.evolution.frame.tick,1);
});

test('scrubber retains the requested value when pause refreshes the controls',async()=>{
 const h=harness();await h.start();h.resolveStep(1);await flush();
 const slider=h.t('[data-scrub]');slider.value='0';slider.fire('input',{target:slider});
 assert.equal(h.map.evolution.frame.tick,0);assert.equal(h.pending.length,0);
 slider.value='1';slider.fire('input',{target:slider});assert.equal(h.map.evolution.frame.tick,1);
});

test('an event starts playback without a launcher or another scenario submission',async()=>{
 const h=harness();h.controller.start('A local restaurant raises prices');
 assert.equal(h.q('#evo-scenario').value,'A local restaurant raises prices');
 assert.equal(h.pending.length,1);h.pending.shift().resolve(fixture());await flush();
 assert.equal(h.pending.length,1);h.resolveStep(1);await flush();
 assert.equal(h.map.evolution.frame.tick,1);
});

test('selected experiment carries frozen research into its timeline',async()=>{
 const h=harness();h.controller.start('Chipotle bowls +10%',{id:'panel',version:2,content_hash:'hash'},{newsContext:'Frozen dated news',asOf:'2026-09-19'});
 assert.deepEqual(h.pending[0].body.research_panel,{id:'panel',version:2,content_hash:'hash'});
 assert.equal(h.pending[0].body.pinned_news,'Frozen dated news');
 assert.equal(h.pending[0].body.as_of_date,'2026-09-19');
});
test('update waits for pending day and starts at the next uncomputed day',async()=>{
 const h=harness();await h.start();h.q('#evo-message').value='Competitor cuts bowl prices';
 h.q('[data-composer]').fire('submit',{preventDefault(){}});assert.equal(h.pending.length,1);
 h.resolveStep(1);await flush();
 const sent=h.q('[data-composer]').fire('submit',{preventDefault(){}});
 assert.equal(h.pending[0].url,'/evolution/run/event');assert.equal(h.pending[0].body.expected_tick,1);
 h.pending.shift().resolve({text:'Competitor cuts bowl prices',effective_day:2});await sent;
 assert.equal(h.q('#evo-message').value,'');assert.equal(h.pending[0].url,'/evolution/run/step');
 assert.equal(h.map.evolution.frame.tick,1);
});
test('question reads the viewed recorded day without advancing it',async()=>{
 const h=harness();await h.start();h.resolveStep(1);await flush();h.t('[data-reset]').fire();
 h.q('#evo-message').value='Would residents buy bowls?';
 const sent=h.q('[data-composer]').fire('submit',{preventDefault(){}});
 assert.equal(h.pending[0].url,'/evolution/run/question');assert.equal(h.pending[0].body.tick,0);
 h.pending.shift().resolve({question:'Would residents buy bowls?',tick:0,shares:{yes:.4,no:.3,unsure:.3}});await sent;
 assert.equal(h.map.evolution.frame.tick,0);assert.equal(h.pending.length,0);assert.match(h.q('[data-updates]').innerHTML,/modeled agreement/);
});
test('failed timeline question retains the draft and recorded frame',async()=>{
 const h=harness();await h.start();h.resolveStep(1);await flush();
 h.q('#evo-message').value='Why would residents change?';
 const sent=h.q('[data-composer]').fire('submit',{preventDefault(){}});
 h.pending.shift().resolve({error:'Ask a yes/no question'});await sent;
 assert.equal(h.q('#evo-message').value,'Why would residents change?');
 assert.equal(h.map.evolution.frame.tick,1);assert.equal(h.pending.length,0);
});

test('future timeline positions keep the full horizon and start calculating instead of showing nonexistent frames',async()=>{const h=harness();await h.start();h.resolveStep(1);await flush();const slider=h.t('[data-scrub]');slider.value='14';slider.fire('input',{target:slider});await flush();assert.equal(slider.max,14);assert.equal(h.map.evolution.frame.tick,1);assert.equal(h.pending.length,1);h.resolveStep(2);await flush();assert.equal(h.map.evolution.frame.tick,2);});
