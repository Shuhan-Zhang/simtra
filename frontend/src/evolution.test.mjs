import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./evolution.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const flush=()=>new Promise(setImmediate);
function element(){return {hidden:false,value:'2400',dataset:{},children:new Map(),listeners:{},setAttribute(){},focus(){},append(){},querySelector(s){if(!this.children.has(s))this.children.set(s,element());return this.children.get(s);},querySelectorAll(){return[];},addEventListener(n,f){this.listeners[n]=f;},fire(n='click',e={}){return this.listeners[n]?.(e);}};}
function fixture(){
 return {id:'run',branch:'main',scenario:'Restaurant prices rise 20%',population:10000,max_ticks:14,groups:[{id:0,members:[1],weight:1}],outcomes:[{id:'same',label:'Keep routine',changed:false},{id:'switch',label:'Switch restaurants',changed:true}],frames:[frame(0)]};
}
const frame=tick=>({tick,day:tick,changed_count:tick?4000:0,changed_share:tick?.4:0,behaviors:[{group:0,outcome:tick?'switch':'same'}],totals:[{id:'same',share:tick?.6:1,count:tick?6000:10000},{id:'switch',share:tick?.4:0,count:tick?4000:0}]});
function harness(){
 const els=[],pending=[],saved=new Map(),map={setEvolution(v){this.evolution=v;}};
 const document={body:{append(e){els.push(e)},classList:{add(){},remove(){}}},createElement:element,addEventListener(){}};
 const ctx=vm.createContext({document,console,AbortController,BASE:'',workspaceHeaders:()=>({'X-Simtra-Workspace':'test'}),sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},setTimeout:()=>1,clearTimeout(){},setInterval(){},fetch:(url)=>new Promise(resolve=>pending.push({url,resolve:data=>resolve({ok:true,json:async()=>data})}))});
 vm.runInContext(source+'\nglobalThis.init=initEvolution;',ctx);
 const controller=ctx.init({map,getBranch:()=> 'main',getCity:()=> 'sf',isReady:()=>true});
 const [root,transport]=els,q=s=>root.querySelector(s),t=s=>transport.querySelector(s);
 controller.open();
 return {map,pending,q,t,launch:{fire:()=>controller.open()},root,controller,async start(){t('[data-step-forward]').fire();pending.shift().resolve(fixture());await flush();},resolveStep(tick){pending.shift().resolve({frame:frame(tick)});}};
}
test('reset during pending step retains baseline and records result for exact replay',async()=>{
 const h=harness();await h.start();h.t('[data-reset]').fire();h.resolveStep(1);await flush();
 assert.equal(h.map.evolution.frame.tick,0);assert.equal(h.t('[data-scrub]').max,1);
 h.t('[data-step-forward]').fire();await flush();assert.equal(h.map.evolution.frame.tick,1);assert.equal(h.pending.length,0);
});
test('closing during inference never restores the overlay or schedules further calls',async()=>{
 const h=harness();await h.start();h.q('[data-close]').fire();h.resolveStep(1);await flush();
 assert.equal(h.map.evolution,null);assert.equal(h.pending.length,0);assert.equal(h.root.hidden,true);
 h.launch.fire();assert.equal(h.map.evolution.frame.tick,0);h.t('[data-latest]').fire();assert.equal(h.map.evolution.frame.tick,1);
});
test('duplicate step clicks create only one request and pause preserves the viewed frame',async()=>{
 const h=harness();await h.start();h.t('[data-step-forward]').fire();assert.equal(h.pending.length,1);
 h.resolveStep(1);await flush();assert.equal(h.t('[data-scrub]').max,1);
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
