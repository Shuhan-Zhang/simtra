import { BASE } from './config.js';
import { workspaceHeaders } from './workspace.js?v=2';

export const COLORS = {same:'#aeb8c5',unaffected:'#dce2e9',switch:'#007aff',less:'#5c62d6',home:'#36a5dd',adjust:'#5676c7',avoid:'#5c62d6',delay:'#36a5dd'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Math.round(n||0).toLocaleString();
const percent=n=>`${((n||0)*100).toFixed(1)}%`;
const day=n=>n?`Day ${n}`:'Before event';
export function messageKind(text){return /\?\s*$/.test(text)||/^(would|will|do|does|did|is|are|can|could|should|have|has|may|might|why|how|what|when|where)\b/i.test(text.trim())?'question':'event';}
export function frameAt(run,index){return run?.frames[Math.max(0,Math.min(index,run.frames.length-1))]??null;}
export function appendFrame(run,frame){
  if(!Number.isInteger(frame?.tick))throw new Error('Invalid timeline response. Retry this step.');
  if(frame.tick<run.frames.length)return false;
  if(frame.tick!==run.frames.length)throw new Error('Timeline is out of order. Start a new scenario.');
  run.frames.push(frame);return true;
}
export function trendSvg(frames,index,metric='changed'){
  const value=f=>metric==='changed'?f.changed_share:f.totals.find(t=>t.id===metric)?.share||0;
  const width=440,height=150,left=30,right=425,top=10,bottom=125;
  const points=frames.slice(0,index+1).map(f=>[left+f.day/14*(right-left),bottom-value(f)*(bottom-top)]);
  const path=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const grid=[0,.5,1].map(v=>`<line x1="${left}" x2="${right}" y1="${bottom-v*(bottom-top)}" y2="${bottom-v*(bottom-top)}" stroke="currentColor" opacity=".12"/><text x="24" y="${bottom-v*(bottom-top)+3}" text-anchor="end">${v*100}%</text>`).join('');
  const [cx,cy]=points.at(-1)||[left,bottom];
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric==='changed'?'Changed routines':esc(metric)} through day ${index}: ${percent(value(frames[index]||frames[0]))}" class="evo-trend-svg">${grid}<text x="${left}" y="146">Before</text><text x="${left+7/14*(right-left)}" y="146" text-anchor="middle">Day 7</text><text x="${right}" y="146" text-anchor="end">Day 14</text><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent)"/></svg>`;
}
async function request(path,body){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),90000);
  try{
    const res=await fetch(BASE+path,{method:body===undefined?'GET':'POST',headers:{...workspaceHeaders(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'Could not complete this step.');return data;
  }catch(e){if(e.name==='AbortError')throw new Error('This step timed out. Retry to recover the recorded result.');throw e;}
  finally{clearTimeout(timer);}
}

export function initEvolution({map,getBranch,getCity,isReady}){
  const root=document.createElement('section');root.id='evolution';root.hidden=true;root.setAttribute('aria-label','City behavior simulation');
  root.innerHTML=`<div class="evo-heading"><div><span class="evo-eyebrow">CITY SIMULATION</span><h2>What changes across the city?</h2></div><button data-close aria-label="Close city simulation">×</button></div>
    <div data-setup class="evo-setup"><label for="evo-scenario">What happens?</label><textarea id="evo-scenario" maxlength="2000" rows="3" placeholder="Chipotle raises menu prices by 20% in San Francisco."></textarea><div class="evo-examples"><button data-example="Chipotle raises menu prices by 20% in this city.">Restaurant prices +20%</button><button data-example="A serious public safety incident occurs downtown. How do residents change their outings?">Safety incident</button><button data-example="Public transit fares increase by 50% across this city.">Transit fares +50%</button></div><p class="evo-empty">Watch how everyday choices change over 14 simulated days.</p></div>
    <div data-results hidden class="evo-results"><p class="evo-scenario-text" data-scenario></p>
      <div class="evo-overview"><div><span class="evo-eyebrow">CHANGED THEIR ROUTINE</span><div class="evo-headline"><strong data-count>0</strong><span data-share>0%</span></div><p data-denominator></p></div><span class="evo-delta" data-delta></span></div>
      <div class="pc evo-chart"><div class="pc-head"><h3 class="pc-title">What people do</h3><span class="pc-caption" data-chart-caption></span></div><div class="pc-rows" data-bars></div></div>
      <div class="pc evo-trend"><div class="pc-head"><h3 class="pc-title" data-trend-title>Changed routines over time</h3><button class="pc-dim" data-all hidden>Show all changes</button></div><div data-trend></div></div>
      <p class="pc-note">Census-weighted model estimates, not observed behavior. Counts are scaled to the simulated population.</p>
      <div class="evo-updates" data-updates aria-live="polite"></div>
      <details class="evo-method"><summary>How this is estimated</summary><p data-method></p></details>
    </div><form class="evo-composer" data-composer hidden><label for="evo-message">Add a hypothetical update or ask a yes/no question</label><div><input id="evo-message" maxlength="2000" placeholder="A competitor cuts bowl prices by 10%" autocomplete="off"><button type="submit" aria-label="Send timeline update">↑</button></div><small data-composer-note>Updates affect the next day. Questions use the day you’re viewing.</small></form><p class="evo-error" role="alert" data-error></p>`;
  document.body.append(root);
  const transport=document.createElement('section');transport.id='evo-transport';transport.hidden=true;transport.setAttribute('aria-label','Simulation playback');
  transport.innerHTML=`<div class="evo-transport-top"><div><span class="evo-live" data-mode>READY</span><strong data-clock>Before event</strong><span data-step>0 / 14 days</span></div><span data-latency></span></div>
    <input type="range" min="0" max="0" value="0" step="1" data-scrub aria-label="Simulation timeline" disabled>
    <div class="evo-controls"><button data-play class="evo-primary">▶ Start</button><details class="evo-more"><summary>Playback options</summary><button data-step-forward>Next day →</button><button data-reset>↶ Rewind</button><button data-latest>Latest</button><button data-new>New scenario</button><label>Speed <select data-speed aria-label="Playback speed"><option value="1800">1×</option><option value="800">2×</option><option value="300">4×</option></select></label></details></div>
    <div class="evo-track-note">Drag back to compare earlier days. Replay uses the same recorded results.</div>`;
  document.body.append(transport);
  const q=s=>root.querySelector(s),t=s=>transport.querySelector(s);
  let run=null,index=0,playing=false,busy=false,opened=false,timer=null,context='',generation=0,initializing=false,viewRevision=0,metric='changed',researchPanel=null,messageBusy=false,pinnedNews=null;
  const storageKey=()=>`simtra.behavior.v2:${workspaceHeaders()['X-Simtra-Workspace']||'public'}:${getCity()}`;
  const contextKey=()=>`${getCity()}:${getBranch()}`;
  function save(){if(run)try{sessionStorage.setItem(storageKey(),JSON.stringify(run));}catch{}}
  function pause(){viewRevision++;playing=false;clearTimeout(timer);timer=null;renderControls();}
  function renderControls(){
    const max=run?.frames.length-1||0,limit=run?.max_ticks||14;
    t('[data-play]').textContent=playing?'Ⅱ Pause':!run?'▶ Start':index<max?'▶ Replay':index>=limit?'Finished':'▶ Play';
    t('[data-play]').disabled=(initializing&&!playing)||(!playing&&index>=limit);
    t('[data-step-forward]').disabled=busy||initializing||index>=limit;
    t('[data-new]').disabled=busy||initializing||messageBusy;
    t('[data-reset]').disabled=!run;t('[data-latest]').disabled=!run||index===max;
    t('[data-scrub]').disabled=!run||max===0;t('[data-scrub]').max=max;t('[data-scrub]').value=index;
    t('[data-clock]').textContent=day(index);t('[data-step]').textContent=`${index} / ${limit} days`;
    t('[data-mode]').textContent=index<max?'REPLAY':busy?'UPDATING':playing?'RUNNING':run?'PAUSED':'READY';
    t('[data-latency]').textContent=busy?'Updating city choices…':'';
    q('#evo-scenario').disabled=initializing||busy;
    q('[data-composer]').hidden=!run;
    q('[data-composer] button').disabled=busy||initializing||messageBusy;
    t('[data-play]').disabled ||=messageBusy; t('[data-step-forward]').disabled ||=messageBusy;
  }
  function render(){
    renderControls();if(!opened)return;
    q('[data-setup]').hidden=!!run;q('[data-results]').hidden=!run;if(!run)return;
    const f=frameAt(run,index),prev=frameAt(run,Math.max(0,index-1));
    q('[data-scenario]').textContent=run.scenario;
    q('[data-count]').textContent=number(f.changed_count);q('[data-share]').textContent=percent(f.changed_share);
    q('[data-denominator]').textContent=`of ${number(run.population)} simulated residents`;
    const delta=(f.changed_share-prev.changed_share)*100;
    q('[data-delta]').textContent=index>1?`${delta>=0?'+':''}${delta.toFixed(1)} pts since yesterday`:index?'vs. before the event':'Before-event reference';
    q('[data-chart-caption]').textContent=index?`${day(index)} · primary behavioral response`:'No scenario-induced changes yet';
    q('[data-bars]').innerHTML=run.outcomes.map(o=>{
      const total=f.totals.find(x=>x.id===o.id),share=total?.share||0;
      return `<button class="evo-bar pc-row" data-outcome="${esc(o.id)}" aria-pressed="${metric===o.id}" aria-label="${esc(o.label)}: ${number(total?.count)} people, ${percent(share)}"><span class="evo-bar-head"><span>${esc(o.label)}</span><span><b>${number(total?.count)}</b><small>${percent(share)}</small></span></span><span class="evo-bar-track"><span style="width:${share*100}%;background:${COLORS[o.id]||'#007aff'}"></span></span></button>`;
    }).join('');
    const chosen=run.outcomes.find(o=>o.id===metric);
    q('[data-trend-title]').textContent=chosen?`${chosen.label} over time`:'Changed routines over time';
    q('[data-all]').hidden=!chosen;q('[data-trend]').innerHTML=trendSvg(run.frames,index,metric);
    q('[data-method]').textContent=`${run.groups.length} demographic cohorts represent all ${number(run.population)} simulated residents. Choice probabilities are weighted by Census person weights. Dots are a stable illustration sampled from cohort probabilities; weighted totals can differ from raw dot counts. The reference starts with no changes caused by the scenario. Jev reevaluates choices each day using prior choices, time to adapt, and the previous citywide behavior mix. Only updates you add are assumed, from the next uncomputed day. Questions estimate agreement at the viewed day without changing recorded behavior. These estimates have not been calibrated to real-world outcomes.`;
    q('[data-updates]').innerHTML=[...(run.events||[]).map(e=>`<article><small>Hypothetical update · Day ${e.effective_day}${e.effective_day>index?' · scheduled':''}</small><p>${esc(e.text)}</p></article>`),...(run.questions||[]).filter(a=>a.tick<=index).map(a=>`<article><small>Day ${a.tick} · modeled agreement</small><p>${esc(a.question)}</p><b>${percent(a.shares.yes)} yes · ${percent(a.shares.no)} no · ${percent(a.shares.unsure)} unsure</b></article>`)].join('');
    map.setEvolution({frame:f,groups:run.groups,colors:COLORS,activeAction:metric==='changed'?null:metric});
  }
  async function ensureRun(){
    if(run)return;
    const scenario=q('#evo-scenario').value.trim();if(!scenario)throw new Error('Enter a scenario or choose an example.');
    if(!isReady())throw new Error('Wait for the city population to finish loading.');
    initializing=true;renderControls();const gen=generation,branch=getBranch();
    try{
      const data=await request(`/branches/${encodeURIComponent(branch)}/evolution`,{scenario,...(pinnedNews?{pinned_news:pinnedNews.newsContext,as_of_date:pinnedNews.asOf}:{}),...(researchPanel?{research_panel:{id:researchPanel.id,version:researchPanel.version,content_hash:researchPanel.content_hash}}:{})});
      if(gen!==generation||branch!==getBranch()||!opened)return;
      run=data;index=0;metric='changed';save();render();
    }finally{initializing=false;renderControls();}
  }
  async function advance(){
    if(busy||initializing||messageBusy)return;
    busy=true;const gen=generation,revision=viewRevision;q('[data-error]').textContent='';
    try{
      await ensureRun();if(!run||gen!==generation||!opened||revision!==viewRevision)return;
      if(index<run.frames.length-1){index++;render();return;}
      if(index>=run.max_ticks){pause();return;}
      renderControls();const currentRun=run;
      const {frame}=await request(`/evolution/${encodeURIComponent(run.id)}/step`,{expected_tick:run.frames.length-1});
      if(gen!==generation||currentRun!==run)return;
      appendFrame(run,frame);save();if(opened&&revision===viewRevision)index=frame.tick;render();
    }catch(e){if(gen===generation){pause();q('[data-error]').textContent=e.message;}}
    finally{busy=false;renderControls();if(playing&&opened){if(index>=(run?.max_ticks||14))pause();else timer=setTimeout(advance,Number(t('[data-speed]').value));}}
  }
  function close(){pause();opened=false;root.hidden=true;transport.hidden=true;document.body.classList.remove('evolution-open');map.setEvolution(null);document.getElementById?.('ask-input')?.focus();}
  function open(){
    if(!isReady())return;
    if(context!==contextKey()){generation++;run=null;researchPanel=null;pinnedNews=null;index=0;context=contextKey();}
    opened=true;root.hidden=false;transport.hidden=false;document.body.classList.add('evolution-open');q('[data-error]').textContent='';
    if(!run)try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(saved?.branch===getBranch()&&saved.outcomes&&saved.frames?.length){run=saved;}}catch{}
    render();if(run)t('[data-play]').focus();else q('#evo-scenario').focus();
  }
  q('#evo-message').addEventListener('focus',pause);
  q('[data-composer]').addEventListener('submit',async e=>{
    e.preventDefault();if(!run||busy||initializing||messageBusy)return;
    const input=q('#evo-message'),text=input.value.trim();if(!text)return;
    pause();messageBusy=true;renderControls();q('[data-error]').textContent='';
    const activeRun=run,gen=generation,kind=messageKind(text);
    try {
      if(kind==='question') {
        const answer=await request(`/evolution/${encodeURIComponent(run.id)}/question`,{question:text,tick:index});
        if(gen!==generation||run!==activeRun)return;
        run.questions??=[];if(!run.questions.some(a=>a.tick===answer.tick&&a.question===answer.question))run.questions.push(answer);
      } else {
        const event=await request(`/evolution/${encodeURIComponent(run.id)}/event`,{text,expected_tick:run.frames.length-1});
        if(gen!==generation||run!==activeRun)return;
        run.events??=[];if(!run.events.some(a=>a.effective_day===event.effective_day&&a.text===event.text))run.events.push(event);
        index=run.frames.length-1;playing=opened;
      }
      input.value='';save();render();q('[data-updates]').lastElementChild?.scrollIntoView({block:'nearest'});
    } catch(error) {if(gen===generation)q('[data-error]').textContent=error.message;}
    finally {messageBusy=false;renderControls();if(playing&&opened&&!busy)void advance();}
  });
  q('[data-close]').addEventListener('click',close);
  t('[data-play]').addEventListener('click',()=>{if(playing){pause();return;}playing=true;renderControls();if(!busy)void advance();});
  t('[data-step-forward]').addEventListener('click',()=>{pause();void advance();});
  t('[data-new]').addEventListener('click',()=>{pause();generation++;researchPanel=null;pinnedNews=null;if(run)q('#evo-scenario').value=run.scenario;run=null;index=0;metric='changed';try{sessionStorage.removeItem(storageKey());}catch{}map.setEvolution(null);q('[data-error]').textContent='';render();q('#evo-scenario').focus();});
  t('[data-reset]').addEventListener('click',()=>{pause();index=0;render();});
  t('[data-latest]').addEventListener('click',()=>{pause();index=(run?.frames.length||1)-1;render();});
  t('[data-scrub]').addEventListener('input',e=>{const nextIndex=Number(e.target.value);pause();index=nextIndex;render();});
  root.addEventListener('click',e=>{const ex=e.target.closest('[data-example]');if(ex)q('#evo-scenario').value=ex.dataset.example;const bar=e.target.closest('[data-outcome]');if(bar){metric=metric===bar.dataset.outcome?'changed':bar.dataset.outcome;render();}});
  q('[data-all]').addEventListener('click',()=>{metric='changed';render();});
  q('#evo-scenario').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();playing=true;void advance();}});
  for(const el of [root,transport])for(const event of ['pointerdown','wheel','keydown'])el.addEventListener(event,e=>e.stopPropagation());
  document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape'){e.preventDefault();close();}},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  setInterval(()=>{if(opened&&context!==contextKey()){close();generation++;run=null;index=0;}},500);
  renderControls();
  return { open, start(scenario,panel=null,news=null) {
    if (!isReady() || busy || initializing || messageBusy) throw new Error('Wait for the current city update to finish.');
    open(); researchPanel=panel; pinnedNews=news; pause(); generation++; run=null; index=0; metric='changed';
    q('#evo-scenario').value=scenario;
    playing=true; render(); void advance();return true;
  }};
}
