import { scenarioShare, responseFor, createRunStore, metricShare } from "./research.js";
import { autoPlan, compilePlan, rankScenarios, PRICE_RANGES, signed, priceLabel, priceSeries } from "./experiment-plan.js";
import { createPersonaChart } from "./persona-chart.js";
import { buildEvidenceChartModel } from "./evidence-chart.js";
import { describeAudience } from "./audience.js";
import { PREDICT } from "./config.js";
import * as api from "./api.js";
import { createControlWriter, controlRecordFromRun } from "./control-store.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = n => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const pp = n => n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
const money = n => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dimLabels = { income: "Income", age: "Age", education: "Education", gender: "Sex recorded in Census", race: "Race / ethnicity", geography: "Area", tenure: "Housing tenure" };

export function createResearchWorkspace({ map, getContext, openFilters, labelGroup, prepare, setBusy, getPersona, restoreAudience, compareScenarios = api.compareScenarios }) {
  const root = document.getElementById("research-workspace"), launcher = document.getElementById("research-launch");
  const store = createRunStore(api.isDemo ? "simtra-research-demo-v1" : "simtra-research-v1");
  let runs = [], plan = null, active = null, parentId = null, view = "proposal", busy = false, visible = false;
  let error = "", saveNote = "", selected = 0, person = null, chart = null, peopleOpen = false, abort = null, generation = 0, personGeneration = 0, planCity = null, areasOpen = false, allRanks = false;
  let executionLog = [], planningLog = [], control = null;
  const controlWriter = createControlWriter(api.isDemo);
  const controlLink = document.getElementById("control-panel-link");
  if (controlLink) controlLink.href = `control.html${api.isDemo ? "?demo=1" : ""}`;
  const ctx = () => getContext();
  const localRuns = () => runs.filter(r => r.city === ctx().city);
  const audienceText = a => { const d = describeAudience(a); return [d.title, d.qualification, d.location].filter(Boolean).join(" · "); };
  const liveMap = () => { map.setAgents(ctx().residents); map.clearSegmentSelection(); map.clearVerdicts(); };
  function visibility(show) {
    visible = show; root.hidden = !show;
    launcher.hidden = show || (!active && !localRuns().length && !plan);
    launcher.setAttribute("aria-expanded", String(show));
  }
  function disposeChart() { chart?.destroy(); chart = null; }
  function resetSelection() { personGeneration++; person = null; disposeChart(); map.clearSegmentSelection(); }
  const chip = (label, name, value, pressed) => `<button type="button" class="ex-chip" data-${name}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  function render() {
    if (!visible) { visibility(false); return; }
    const scroll = root.scrollTop;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const attr = focused?.getAttributeNames().find(a => a.startsWith("data-"));
    const focus = attr ? `[${attr}="${CSS.escape(focused.getAttribute(attr))}"]` : null;
    disposeChart();
    root.innerHTML = `<header class="ex-header"><span class="ex-kicker">${view === "results" ? "Experiment results" : view === "planning" ? "Planning experiment" : "Proposed experiment"}</span><div class="ex-header-tools">${localRuns().length ? `<select aria-label="Previous experiments"><option value="">History (${localRuns().length})</option>${localRuns().slice().reverse().map(r=>`<option value="${esc(r.id)}">${esc(r.experiment.decision)}</option>`).join("")}</select>` : ""}<button class="ex-close" data-action="close" aria-label="Close experiment" ${busy ? "disabled" : ""}>×</button></div></header>
      ${saveNote ? `<p class="ex-note" role="status">${esc(saveNote)}</p>` : ""}
      ${api.isDemo ? '<p class="ex-demo">Demo mode · no model calls. <a href="?pipeline=2">Open live backend →</a></p>' : ""}
      ${view === "planning" ? `<h2>Finding a useful experiment…</h2><p class="ex-muted">Turning your question into options to test.</p><div class="ex-loading" role="status">Preparing a proposal. No residents have been polled.</div><button class="ex-link" data-action="cancel">Cancel</button>` : view === "proposal" ? proposalHtml() : resultHtml()}`;
    if (busy) root.querySelectorAll("button, select").forEach(el => { el.disabled = el.dataset.action !== "cancel"; });
    if (view === "results") mountPeople();
    root.scrollTop = scroll;
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  }
  function syncControl(status, extra={}) {
    if(!control)return;
    control={...control,...extra,status,events:executionLog,updatedAt:new Date().toISOString()};
    controlWriter.write(control);
  }
  function addLog(event) {
    executionLog.push(event);syncControl(control?.status || "running");
    const progress=root.querySelector(".ex-progress");
    if(progress&&event.kind==="scenario.completed")progress.textContent=`${event.details.scenario} of ${compilePlan(plan).scenarios.length} combinations complete`;
  }
  function proposalHtml() {
  if (!plan) return `<p class="ex-error" role="alert">${esc(error)}</p><button class="ex-link" data-action="retry-plan">Try again</button>`;
  const exp=compilePlan(plan), commercial=plan.kind!=="compare";
  if (busy) return `<h2>Comparing your options.</h2><p class="ex-question">${esc(plan.decision)}</p><div class="ex-loading" role="status"><span class="ex-progress">Testing ${exp.scenarios.length} combinations…</span><small>Same audience. Prices and formats are explicit experiment assumptions.</small></div><details class="ex-details"><summary>What’s being tested</summary><p>${esc(exp.question)}</p><p>${esc(exp.assumptions)}</p></details><button class="ex-link" data-action="cancel">Cancel</button>`;
  return `<h2>${plan.kind==="launch"?"Find the right launch.":plan.kind==="price"?"Find the price trade-off.":"Find the stronger option."}</h2>
    <p class="ex-question">${esc(plan.decision)}</p>
    <div class="ex-context"><span>${esc(audienceText(ctx().audience))}</span><button class="ex-link" data-action="audience">Change</button></div>
    <div class="ex-plan-summary"><strong>${exp.factors.length} factors · ${exp.scenarios.length} combinations</strong><span>Same people · 30 days</span></div>
    ${commercial?`<div class="ex-steer"><span>1 · Location</span><div class="ex-chips">${plan.availableLocations.map((a,i)=>areasOpen||plan.locations.includes(a)?chip(a,"location",i,plan.locations.includes(a)):"").join("")}<button class="ex-link" data-action="swap-areas">${areasOpen?"Done":"Swap area"}</button></div></div>
      <div class="ex-steer"><span>2 · ${esc(exp.priceAxis)} <small>six test points${plan.priceSuggested&&plan.priceMode==="absolute"?" · suggested":""}</small></span>
      <div class="ex-chips">${plan.priceMode==="relative"?[...new Set([plan.percent,...[10,20,30].map(n=>plan.percent<0?-n:n)])].map(n=>chip(`Current to ${signed(n)}`,"percent",n,n===plan.percent)).join(""):[plan.priceRange,...PRICE_RANGES.filter(r=>String(r)!==String(plan.priceRange))].map(r=>chip(`$${r[0]}–$${r[1]}`,"range",r.join(","),String(r)===String(plan.priceRange))).join("")}</div>
      ${plan.priceMode==="relative"?'<button class="ex-link" data-action="absolute-prices">Test assumed dollar prices instead</button>':""}</div>
      <div class="ex-steer"><span>3 · ${esc(plan.context.factor)} <small>both tested at every price and area</small></span><div class="ex-options">${plan.context.values.map(v=>`<span>${esc(v)}</span>`).join("")}</div></div>`
      :exp.factors.map((f,i)=>`<div class="ex-steer"><span>${i+1} · ${esc(f.label)}</span><div class="ex-options">${f.levels.map(v=>`<span>${esc(v)}</span>`).join("")}</div></div>`).join("")}
    <div class="ex-steer"><span>Measure</span><div class="ex-chips">${(commercial?[["intent","Willingness to buy"],["frequency","Repeat interest"]]:[["support","Support"],["intent","Would try"]]).map(([id,label])=>chip(label,"measure",id,plan.measure===id)).join("")}</div></div>
    <details class="ex-details"><summary>What we’ll ask & assume</summary><p>${esc(exp.question)}</p><p>${esc(exp.assumptions)}</p><p>Same ${ctx().residents.length.toLocaleString()} synthetic residents across all combinations. Group estimates, not individual interviews.</p></details>
    ${error?`<p class="ex-error" role="alert">${esc(error)}</p>`:""}
    ${busy?`<div class="ex-loading" role="status"><span class="ex-progress">Testing ${exp.scenarios.length} combinations…</span><small>Comparing the same people across each configuration.</small></div><button class="ex-link" data-action="cancel">Cancel experiment</button>`:`<button class="ex-primary" data-action="approve" ${!ctx().ready?"disabled":""}>Run ${exp.scenarios.length} combinations<span>→</span></button>`}
    <p class="ex-foot">${parentId?"Your previous experiment stays saved. ":""}Experimental assumptions. Adjust only what you need, then run again.</p>`;
}
  function resultHtml() {
  const run=active,exp=run.experiment,ranked=rankScenarios(run),best=ranked[0], current=exp.scenarios[selected];
  const hasCurve=priceSeries(run,selected).length>=2, modern=exp.version===3;
  const share=scenarioShare(run.scenarios[selected],exp.indices);
  const selectedPrice=current.change??current.price;
  const mode=exp.priceMode || (current.change!=null?"relative":"absolute");
  return `<h2>${hasCurve?"The price trade-off.":"Your options, compared."}</h2><p class="ex-question">${esc(exp.decision)}</p>
    <p class="ex-audience">${esc(audienceText(run.audience))} · ${run.residents.length.toLocaleString()} synthetic residents</p>
    ${run.fixture?'<p class="ex-demo">Illustrative demo results · not model answers to your question.</p>':'<p class="ex-note">Model estimates, not observed customer behavior.</p>'}
    <div class="ex-metrics">${hasCurve?metric(esc(exp.metric),pct(share))+metric(esc(exp.priceAxis||"Price"),esc(priceLabel(selectedPrice,mode)))+metric("Combinations tested",String(ranked.length)):metric("Highest intent",pct(best.share))+metric("Lead over next",pp(best.delta))+metric("Options tested",String(ranked.length))}</div>
    ${hasCurve?curveHtml(run):""}
    <div class="ex-chart-label">${hasCurve?"Ranked combinations":esc(exp.metric)}</div>
    <div class="ex-ranks" aria-label="Ranked experiment results">${(allRanks?ranked:ranked.slice(0,3)).map(row=>`<button class="ex-rank" data-scenario="${row.index}" aria-pressed="${row.index===selected}"><span class="ex-rank-number">${row.rank}</span><span class="ex-rank-main"><strong>${esc(row.scenario.location||row.scenario.label)}</strong>${row.scenario.format?`<small>${esc(priceLabel(row.scenario.change??row.scenario.price,mode))} · ${esc(row.scenario.format)}</small>`:row.scenario.offer?`<small>${esc(row.scenario.offer.replace("$5 first order","$5 off the first order").replace("$3 next order","$3 credit on a second order"))}</small>`:""}<span class="ex-bar"><i style="width:${100*(row.share??0)}%"></i></span></span><span class="ex-rank-value">${pct(row.share)}</span></button>`).join("")}</div>
    ${ranked.length>3?`<button class="ex-link ex-more" data-action="all-ranks">${allRanks?"Show top three":`See all ${ranked.length} combinations`}</button>`:""}
    <div class="ex-selected"><span>${esc(current.label)}</span><small>Tap ${hasCurve?"a price or ":""}a combination to explore its people.</small></div>
    <div class="ex-faces" aria-label="Synthetic personas behind the selected estimate"></div>
    <details class="ex-details ex-people" ${peopleOpen?"open":""}><summary>Who’s behind this result?</summary><div id="experiment-people"></div></details>
    <div id="experiment-person" ${person==null?"hidden":""}></div>
    <details class="ex-details"><summary>What was tested</summary>${(exp.factors||[]).map(f=>`<p><b>${esc(f.label)}</b> ${f.levels.map(esc).join(" · ")}</p>`).join("")}<p>${esc(exp.question)}</p><p>${esc(exp.assumptions)}</p><p>${esc(run.model)} · ${esc(run.asOf)}. Highest modeled interest is not a profit estimate or a statistically established winner.</p>${!modern?'<p>Historical experiment. Replan to use the current three-factor design.</p>':""}</details>
    <details class="ex-details"><summary>Who this represents</summary><p>${run.residents.length.toLocaleString()} synthetic residents; ${run.audience.sourceRecords?.toLocaleString()??"unknown"} matching Census records. Weighted group responses, not independent interviews. City-wide audience, not a separate local demand sample for each area.</p></details>
    <div class="ex-next"><button class="ex-link" data-action="refine">Refine this experiment ↗</button><button class="ex-link" data-action="new-audience">Try another audience ↗</button></div>
    ${run.parentId?`<button class="ex-link ex-parent" data-run="${esc(run.parentId)}">← Previous experiment</button>`:""}<p class="ex-foot">${run.saved?"Saved in this browser":"Saved for this session only"} · ${esc(new Date(run.createdAt).toLocaleDateString())}</p>`;
}
  function metric(label,value) { return `<div><strong>${value}</strong><span>${label}</span></div>`; }
  function curveHtml(run) {
  const exp=run.experiment, series=priceSeries(run,selected), ref=exp.scenarios[selected];
  const values=series.map(r=>r.scenario.change??r.scenario.price), min=Math.min(...values),max=Math.max(...values);
  const mode=exp.priceMode || (ref.change!=null?"relative":"absolute");
  const X=x=>42+(x-min)/(max-min||1)*440,Y=y=>142-y*110;
  const points=series.map(r=>({...r,x:X(r.scenario.change??r.scenario.price),share:scenarioShare(r.result,exp.indices)}));
  return `<div class="ex-chart-label">${esc(exp.metric)} by ${esc((exp.priceAxis||"price").toLowerCase())}</div>
    ${ref.location?`<div class="ex-curve-controls"><label>Location<select data-curve="location" aria-label="Price curve location">${[...new Set(exp.scenarios.map(s=>s.location))].map(v=>`<option ${v===ref.location?"selected":""}>${esc(v)}</option>`).join("")}</select></label><label>${esc(exp.factors?.find(f=>f.id==="format")?.label||"Format")}<select data-curve="format" aria-label="Price curve format">${[...new Set(exp.scenarios.map(s=>s.format))].map(v=>`<option ${v===ref.format?"selected":""}>${esc(v)}</option>`).join("")}</select></label></div>`:""}
    <svg class="ex-curve pc-svg" viewBox="0 0 528 190" role="group" aria-label="${esc(exp.metric)} across tested prices">
    ${[0,.5,1].map(v=>`<line class="pc-grid" x1="42" x2="482" y1="${Y(v)}" y2="${Y(v)}"/><text class="pc-axis" x="32" y="${Y(v)+4}" text-anchor="end">${Math.round(v*100)}%</text>`).join("")}
    <polyline class="pc-line" points="${points.map(p=>`${p.x},${Y(p.share)}`).join(" ")}"/>
    ${points.map(p=>`<g class="pc-lpt ${selected===p.index?"sel":""}" role="button" tabindex="0" data-scenario="${p.index}" aria-pressed="${selected===p.index}" aria-label="${esc(p.scenario.label)}: ${pct(p.share)}"><circle cx="${p.x}" cy="${Y(p.share)}" r="6"/><circle class="ex-hit" cx="${p.x}" cy="${Y(p.share)}" r="18"/><text class="pc-axis" x="${p.x}" y="${Y(p.share)-14}" text-anchor="middle">${pct(p.share)}</text><text class="pc-axis" x="${p.x}" y="163" text-anchor="middle">${esc(priceLabel(p.scenario.change??p.scenario.price,mode))}</text></g>`).join("")}
    <text class="pc-axis" x="264" y="186" text-anchor="middle">${esc(exp.priceAxis||"Price")} →</text></svg>
    <p class="ex-foot">Location and format held fixed on this curve. Each dot was tested; connecting lines are only a guide. ${mode==="absolute"?"Prices are experimental assumptions.":""}</p>`;
}
  function mountPeople() {
    const run = active, scenario = run.scenarios[selected], exp = run.experiment;
    const answers = new Map();
    for (const group of scenario.response_groups) for (const id of group.agent_ids) {
      const p = metricShare(group.probabilities,exp.indices);
      answers.set(id,{p_yes:p,dist:[p,1-p],why:group.factor,archetype:group.archetype});
    }
    // Re-express the chosen metric as a binary share, keeping the SAME groups,
    // members and weights. The chart must not silently switch to the winning option.
    const model = buildEvidenceChartModel({ ...scenario.result, breakdowns:{}, p_distribution:[[exp.metric,scenarioShare(scenario,exp.indices)],["Other responses",1-scenarioShare(scenario,exp.indices)]],
      option_breakdowns:(scenario.result.option_breakdowns || []).map(b=>({...b,groups:b.groups.map(g=>{ const p=metricShare(g.shares,exp.indices); return {...g,shares:p==null?[]:[p,1-p]}; })})) });
    const aliases = {educ:"education",income_q:"income",puma:"geography"};
    model.breakdowns = model.breakdowns.filter(b=>!aliases[b.dimension] || !model.breakdowns.some(other=>other.dimension===aliases[b.dimension])).map(b=>({...b,dimension:aliases[b.dimension]||b.dimension,groups:b.groups.map(g=>({...g,dimension:aliases[g.dimension]||g.dimension}))}));
    chart = createPersonaChart(root.querySelector("#experiment-people"), {
      question:exp.question,framing:"options",options:[exp.metric,"Other responses"],topIndex:0,model,residents:run.residents,answers,
      answersNote:"Inherited demographic-group estimates, not individual interviews.",type:"bar",compact:true,
      labels:{dimension:d=>dimLabels[d]||d,group:labelGroup},drawHead:(canvas,id)=>map.drawHeadTo(canvas,id),
      openPerson:r=>inspect(r.id),onGroupSelect:segments=>map.setSegmentSelection(segments?.length?{clauses:segments,operator:"or"}:null),
    });
    const faces = run.residents.filter(r=>answers.has(r.id)).slice(0,6);
    const host = root.querySelector(".ex-faces");
    host.innerHTML = `${faces.map(r=>`<button data-person="${r.id}" aria-label="Inspect ${esc(r.name)}" title="${esc(r.name)}"><canvas width="40" height="40"></canvas></button>`).join("")}<span>Same people.<br>Different possibilities.</span>`;
    host.querySelectorAll("canvas").forEach((canvas,i)=>map.drawHeadTo(canvas,faces[i].id));
    root.querySelector(".ex-people").addEventListener("toggle", e=>{ peopleOpen=e.target.open; });
    if (person != null) inspect(person, false);
  }
  async function inspect(id, scroll = true) {
    if (!visible || view !== "results" || !active) return false;
    const resident = active.residents.find(r=>r.id===Number(id));
    if (!resident) return false;
    person=resident.id; const seq=++personGeneration, run=active;
    const host=root.querySelector("#experiment-person"); host.hidden=false;
    host.innerHTML=`<div class="ex-person-head"><canvas width="40" height="40"></canvas><div><strong>${esc(resident.name)}</strong><small>${esc([resident.age,resident.occupation,resident.neighborhood].filter(v=>v!=null).join(" · "))}</small></div><button class="ex-close" data-action="close-person" aria-label="Close persona">×</button></div><p class="ex-person-story">Synthetic persona · ${esc((resident.educ||"education not recorded").replaceAll("_"," "))}</p><p class="ex-note">Inherited group response, not an individual interview.</p>${run.scenarios.map((s,i)=>{const g=responseFor(s,id);return `<div class="ex-person-result ${i===selected?"selected":""}"><span>${esc(run.experiment.scenarios[i].label)}</span><strong>${pct(metricShare(g?.probabilities,run.experiment.indices))}</strong></div>`;}).join("")}<p class="ex-note">${esc(responseFor(run.scenarios[selected],id)?.factor || "No recorded factor.")} <span>Model-selected factor, not a quote.</span></p>`;
    map.drawHeadTo(host.querySelector("canvas"),id);
    if(scroll) host.scrollIntoView({block:"nearest",behavior:"smooth"});
    try { const detail=await getPersona?.(run,id); if(seq===personGeneration && detail?.persona) host.querySelector(".ex-person-story").textContent=detail.persona; } catch { /* Stored demographics remain available. */ }
    return true;
  }
  let lastQuestion = "";
  async function openDecision(question) {
    if(busy) return;
    lastQuestion=question; parentId=null; plan=null; error=""; areasOpen=false; allRanks=false; resetSelection(); prepare(); liveMap();
    planningLog=[]; executionLog=[{kind:"client.plan_requested",phase:"Plan",message:api.isDemo?"Demo recipe selected locally. No model will be called.":"Requesting a proposal from the backend; waiting for execution evidence."}];
    control={id:crypto.randomUUID(),createdAt:new Date().toISOString(),question,city:ctx().city,model:PREDICT.model,population:ctx().residents.length,fixture:api.isDemo};syncControl("planning");
    view="planning"; visibility(true); root.scrollTop=0; busy=true; setBusy(true); render();
    const seq=++generation, city=ctx().city; abort=new AbortController();
    try {
      const route=await api.proposeExperiment(city,question,abort.signal);
      if(seq!==generation) return;
      planningLog=(route.trace?.events || [{kind:api.isDemo?"demo.plan":"plan.untraced",message:api.isDemo?"Demo recipe only; no provider request.":"This backend returned a proposal without an execution trace. Model usage cannot be verified."}]).map(e=>({...e,phase:"Plan"})); executionLog=planningLog.slice();
      plan=autoPlan(question,route); planCity=city; const experiment=compilePlan(plan); view="proposal";syncControl("awaiting_approval",{experiment});
    } catch(e) { if(seq===generation) { if(e.trace?.events) executionLog.push(...e.trace.events.map(e=>({...e,phase:"Plan"}))); addLog({kind:"client.failed",message:e.message});syncControl("failed",{error:e.message});error=e.message;view="proposal"; } }
    finally { if(seq===generation) {busy=false;abort=null;setBusy(false);render();} }
    if(seq===generation && plan && !error) await submit();
  }
  async function submit() {
    if(busy || !plan || !ctx().ready) return;
    error=""; let experiment;
    try {experiment=compilePlan(plan);} catch(e) {error=e.message;render();return;}
    const context=ctx(), draft=structuredClone(plan), audience=structuredClone(context.audience), residents=structuredClone(context.residents), parent=parentId;
    executionLog=planningLog.slice();
    if(!control || ["completed","failed","cancelled"].includes(control.status))control={id:crypto.randomUUID(),createdAt:new Date().toISOString(),question:plan.decision,city:context.city,model:PREDICT.model,fixture:api.isDemo};
    syncControl("running",{experiment,population:residents.length});
    const seq=++generation; abort=new AbortController(); busy=true;setBusy(true);render();
    try {
      const response=await compareScenarios(context.branch,{question:experiment.question,assumptions:experiment.assumptions,options:experiment.options,scenarios:experiment.scenarios,as_of_date:PREDICT.as_of_date},abort.signal,event=>{if(seq===generation)addLog(event);});
      if(seq!==generation) return;
      if(response.scenarios?.length!==experiment.scenarios.length || response.scenarios.some(s=>s.result?.p_distribution?.length!==experiment.options.length || scenarioShare(s,experiment.indices)==null || !s.response_groups?.length)) throw new Error("The comparison was incomplete. No results were saved. Please retry.");
      const run={id:crypto.randomUUID(),controlId:control.id,createdAt:new Date().toISOString(),city:context.city,simId:ctx().simId,audience,residents,draft,experiment,scenarios:response.scenarios,parentId:parent,model:PREDICT.model,asOf:PREDICT.as_of_date,fixture:api.isDemo||response.fixture_mode===true,executionLog:structuredClone(executionLog),trace:response.trace,saved:true};
      try {await store.save(run);} catch {run.saved=false;saveNote="Browser storage is unavailable. Keep this tab open to retain the experiment.";}
      if(seq!==generation) return;
      controlWriter.write(controlRecordFromRun(run));controlWriter.flush().catch(()=>{});control.status="completed";
      runs.push(run);active=run;parentId=null;selected=rankScenarios(run)[0].index;
      resetSelection();view="results";peopleOpen=false;map.setAgents(residents);map.clearVerdicts();root.scrollTop=0;
    } catch(e) {if(seq===generation) { addLog({kind:"client.failed",message:e.message});syncControl("failed",{error:e.message});error=e.status===404?"The backend needs the updated experiment endpoint. Your proposal is preserved.":e.message; }}
    finally {if(seq===generation) {busy=false;abort=null;setBusy(false);render();}}
  }
  function cancel() {
    if(!busy) return;
    generation++;abort?.abort();abort=null;busy=false;setBusy(false);view="proposal";
    addLog({kind:"client.cancelled",message:"Cancelled locally. In-flight provider work may still finish; no result saved."});
    syncControl("cancelled");controlWriter.flush().catch(()=>{});
    error="Cancelled. No result was saved. Server work already started may finish in the background.";render();
  }
  function openRun(id) {
    if(busy) return;
    const run=localRuns().find(r=>r.id===id); if(!run) return;
    prepare();resetSelection();active=run;selected=rankScenarios(run)[0].index;view="results";peopleOpen=false;
    map.setAgents(run.residents);map.clearVerdicts();visibility(true);root.scrollTop=0;render();
  }
  async function refine(audience=false) {
    if(busy || !active || !ctx().ready) return;
    const run=active;
    try {
      if(JSON.stringify(run.audience.filters)!==JSON.stringify(ctx().audience.filters)) await restoreAudience(run);
      if(run.draft.version!==3) {await openDecision(run.experiment.decision);parentId=run.id;render();return;}
      planningLog=[{kind:"plan.refined",message:"Refined the saved proposal locally. No new planning model call."}]; executionLog=planningLog.slice();
      plan=structuredClone(run.draft);planCity=run.city;parentId=run.id;
      control=null;
      if(plan.kind==="price" && plan.priceMode==="relative" && !audience) plan.percent/=2;
      resetSelection();liveMap();view="proposal";error="";root.scrollTop=0;render();
      if(audience) openFilters();
    } catch {saveNote="Could not restore this audience. Reconnect and try again.";render();}
  }
  root.addEventListener("change",e=>{
    if(e.target.matches("select[aria-label='Previous experiments']"))openRun(e.target.value);
    if(e.target.dataset.curve&&active&&!busy){const ref=active.experiment.scenarios[selected],key=e.target.dataset.curve;const other=key==="location"?"format":"location";const index=active.experiment.scenarios.findIndex(s=>s[key]===e.target.value&&s[other]===ref[other]&&(s.change??s.price)===(ref.change??ref.price));if(index>=0){selected=index;render();}}
  });
  root.addEventListener("keydown",e=>{if(e.target.matches("g[data-scenario]") && ["Enter"," "].includes(e.key)){e.preventDefault();e.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
  root.addEventListener("click", e=>{
    const b=e.target.closest("button, g[data-scenario]"); if(!b || (busy && b.dataset.action!=="cancel")) return;
    const d=b.dataset;
    if(d.action==="cancel") return cancel();
    if(d.action==="close") {resetSelection();visibility(false);liveMap();return;}
    if(d.action==="retry-plan") return openDecision(lastQuestion);
    if(d.action==="approve") return submit();
    if(d.action==="audience") return openFilters();
    if(d.action==="refine") return refine();
    if(d.action==="new-audience") return refine(true);
    if(d.action==="swap-areas") {areasOpen=!areasOpen;render();return;}
    if(d.action==="all-ranks") {allRanks=!allRanks;render();return;}
    if(d.run) return openRun(d.run);
    if(d.person) return inspect(d.person);
    if(d.action==="close-person") {person=null;personGeneration++;render();return;}
    if(d.scenario!=null) {selected=Number(d.scenario);render();return;}
    if(!plan || view!=="proposal") return;
    error="";
    if(d.location!=null) {const location=plan.availableLocations[Number(d.location)];if(!plan.locations.includes(location)) plan.locations=[plan.locations[1],location];}
    if(d.action==="absolute-prices"){plan.priceMode="absolute";plan.priceRange=[10,20];plan.priceSuggested=true;}
    if(d.measure) plan.measure=d.measure;
    if(d.percent) plan.percent=Number(d.percent);
    if(d.range){plan.priceRange=d.range.split(",").map(Number);plan.priceSuggested=true;}
    syncControl("awaiting_approval",{experiment:compilePlan(plan)});
    render();
  });
  launcher.addEventListener("click",()=>{if(active) openRun(active.id);else if(localRuns().length) openRun(localRuns().at(-1).id);else if(plan){prepare();view="proposal";visibility(true);render();}});
  store.list().then(saved=>{runs=[...saved.filter(s=>!runs.some(r=>r.id===s.id)),...runs];render();}).catch(()=>{saveNote="Runs will remain in this tab; browser storage is unavailable.";render();});
  visibility(false);
  return {
    inspect,openDecision,cancel,
    get showingResults(){return visible && view==="results";}, get busy(){return busy;},
    refresh(){render();},
    clearInspection(){if(!visible||view!=="results"||(!chart?.hasSelection()&&person==null))return false;resetSelection();render();return true;},
    audienceChanged(){if(busy)cancel();resetSelection();if((view==="results"?active?.city:planCity)!==ctx().city){active=null;plan=null;parentId=null;visibility(false);}else if(visible&&view==="results"&&active)map.setAgents(active.residents);render();},
    suspend(){if(busy)return;resetSelection();visibility(false);liveMap();},
  };
}
