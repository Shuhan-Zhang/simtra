import { setTimelineExperiments, showCityTimeline } from "./feedpanel.js?v=18";
import { scenarioMatrixHtml, experimentDesignHtml } from "./experiment-visuals.js";
import { personaResultHtml } from "./persona-result.js";
import { researchMapColors } from "./map-colors.js";
import { factorText } from "./model-display.js";
import { workspaceHeaders } from "./workspace.js?v=2";
import { prepareAutomaticAudience, researchReference } from "./automatic-audience.js";
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
const dimLabels = { all: "All population", income: "Income", age: "Age", education: "Education", gender: "Sex recorded in Census", race: "Race / ethnicity", geography: "Area", tenure: "Housing tenure" };
const dimensionName = key => (key || "group").split("_x_").map(part=>dimLabels[part] || part.replaceAll("_"," ")).join(" × ");

export function createResearchWorkspace({ map, getContext, openFilters, labelGroup, prepare, setBusy, getPersona, restoreAudience, startTimeline, suspendTimeline, showScenarioLocation, getSimulationLog, compareScenarios = api.compareScenarios }) {
  const root = document.getElementById("research-workspace"), launcher = document.getElementById("research-launch");
  // Keep the panel outside the transformed composer so it docks to the viewport.
  document.getElementById("dock").before(root);
  const residentPanel = document.createElement("aside");
  residentPanel.id="experiment-person";residentPanel.className="ex-resident-panel";residentPanel.hidden=true;
  residentPanel.setAttribute("aria-label","Resident details");document.body.append(residentPanel);
  let reviewingSaved=false, resultSection="overview", logsOpen=false;
  const chartDialog = document.createElement("dialog");
  chartDialog.className = "ex-chart-dialog";
  chartDialog.setAttribute("aria-label", "Expanded results chart");
  document.body.append(chartDialog);
  const closeChart = () => chartDialog.close();
  chartDialog.addEventListener("close", () => root.querySelector('[data-action="expand-chart"]')?.focus({preventScroll:true}));
  chartDialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if(event.target.matches("g[data-scenario]") && ["Enter"," "].includes(event.key)) {event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}
  });
  chartDialog.addEventListener("click", event => {if(event.target===chartDialog)closeChart();});
  chartDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeChart();}},{capture:true});
  function renderExpandedChart() {
    const content=root.querySelector('.ex-unified-chart');
    if(!content)return;
    chartDialog.innerHTML='<header class="ex-expanded-head"><h2>Explore results</h2><button type="button" class="ex-close" data-action="close-chart" aria-label="Close expanded chart">×</button></header>';
    chartDialog.append(content);
    if(chartDialog.open)chartDialog.querySelector('[data-action="close-chart"]')?.focus({preventScroll:true});
  }
  chartDialog.addEventListener('close',()=>{
    const content=chartDialog.querySelector('.ex-unified-chart');
    if(content)root.querySelector('.ex-chart-mount')?.append(content);
    root.querySelector('[data-action="expand-chart"]')?.focus({preventScroll:true});
  });
  const store = createRunStore(`${api.isDemo ? "simtra-research-demo-v1" : "simtra-research-v1"}:${workspaceHeaders()["X-Simtra-Workspace"] || "public"}`);
  let runs = [], plan = null, active = null, parentId = null, view = "proposal", busy = false, visible = false;
  let error = "", saveNote = "", selected = 0, person = null, chart = null, demographicDimension = "all", abort = null, generation = 0, personGeneration = 0, planCity = null, areasOpen = false, allRanks = false;
  let mapColorBy = "response", curveFilters=null, selectedMetric=null, chartType="line", audienceKeys=new Set(), pointGroup=null;
  const displayRun = run => selectedMetric==null ? run : {...run,experiment:{...run.experiment,indices:[selectedMetric],metric:run.experiment.options[selectedMetric]}};
  let researchPanel = null, researchProgress = "Checking saved research…";
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
    if(!show && chartDialog.open)closeChart();
    document.body.classList.toggle("experiment-open", show);
    document.body.classList.toggle("reviewing-experiment",show && reviewingSaved && view==="results");
    if(!show){suspendTimeline?.();map.clearResearchResponses?.();residentPanel.hidden=true;showScenarioLocation?.(null);}
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", String(show));
  }
  let disposingChart=false;
  function disposeChart() { disposingChart=true;chart?.destroy();chart=null;disposingChart=false; }
  function resetSelection() { personGeneration++; person = null; residentPanel.hidden=true; disposeChart(); map.clearSegmentSelection(); }
  const chip = (label, name, value, pressed) => `<button type="button" class="ex-chip" data-${name}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  function render() {
    if (!visible) { visibility(false); return; }
    document.body.classList.toggle("reviewing-experiment",reviewingSaved && view==="results");
    const scroll = root.scrollTop;
    const openControls=[...root.querySelectorAll('[data-control][open]')].map(el=>el.dataset.control);
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const attr = focused?.getAttributeNames().find(a => a.startsWith("data-"));
    const focus = attr ? `[${attr}="${CSS.escape(focused.getAttribute(attr))}"]` : null;
    disposeChart();
    root.innerHTML = `<header class="ex-header"><span class="ex-kicker">${view === "history" ? "Saved experiments" : view === "results" ? "Experiment results" : busy ? "Experiment in progress" : "Proposed experiment"}</span><div class="ex-header-tools">${active && view === "results" ? `<button class="ex-link ex-history-trigger" data-action="logs">${logsOpen?"Results":"Logs"}</button>` : ""}<button class="ex-close" data-action="close" aria-label="Close experiment" ${busy ? "disabled" : ""}>×</button></div></header>
      ${saveNote ? `<p class="ex-note" role="status">${esc(saveNote)}</p>` : ""}
      ${api.isDemo ? '<p class="ex-demo">Demo mode · no model calls. <a href="?pipeline=2">Open live backend →</a></p>' : ""}
      ${view === "planning" ? progressHtml() : view === "proposal" ? proposalHtml() : logsOpen ? logViewHtml() : resultHtml()}`;
    openControls.forEach(key=>root.querySelector(`[data-control="${key}"]`)?.setAttribute('open',''));
    if (busy) root.querySelectorAll("button, select").forEach(el => { el.disabled = el.dataset.action !== "cancel"; });
    const showingResults=view==='results' && !logsOpen && resultSection==='overview';
    if(!showingResults){map.clearResearchResponses?.();map.clearSegmentSelection();showScenarioLocation?.(null);}
    if (view === "results" && !logsOpen && resultSection === "simulate") mountSimulation();
    else {suspendTimeline?.();if(showingResults)mountPeople();}
    if(chartDialog.open)renderExpandedChart();
    scheduleViewedResult();
    root.scrollTop = scroll;
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  }
  function openHistory() {
    if(busy)return;
    resetSelection();visibility(false);liveMap();showCityTimeline();
  }
  function executionHtml(run) {
    const events=run.executionLog || run.trace?.events || [];
    return `<details class="ex-details"><summary>Run activity</summary><p>Saved ${esc(new Date(run.createdAt).toLocaleString())}</p><ol class="ex-saved-activity">${events.map(event=>`<li><strong>${esc(event.phase || "Experiment")}</strong><span>${esc(event.message || event.kind)}</span></li>`).join("")}</ol></details>`;
  }
  function mapPayload(run) {
    const groups=run.scenarios[selected].response_groups;
    if(selectedMetric==null)return {groups,options:run.experiment.options};
    return {groups:groups.map(g=>{const p=metricShare(g.probabilities,[selectedMetric]);return {...g,probabilities:p==null?[]:[p,1-p]};}),options:[run.experiment.options[selectedMetric],'Other responses']};
  }
  const legendHtml = colors => colors.legend.map(item=>`<span><i style="background:${esc(item.color)}"></i>${esc(item.label)}</span>`).join("");
  function mapKeyHtml(run) {
    const payload=mapPayload(run);
    const colors = researchMapColors(payload.groups,payload.options,map.agents,mapColorBy);
    return `<div class="ex-map-key" aria-label="Map legend">${legendHtml(colors)}</div>`;
  }
  function followVisibleResult() {
    if(!visible || view!=="results" || !active || resultSection!=="overview" || logsOpen)return;
    const desired=demographicDimension==='all'?'response':demographicDimension;
    const payload=mapPayload(active);
    const colors=map.setResearchResponses(payload.groups,payload.options,{colorBy:desired});
    mapColorBy=colors.mode;
    root.querySelectorAll('.ex-map-key').forEach(el=>el.innerHTML=legendHtml(colors));
  }
  let mapViewFrame=null;
  const scheduleViewedResult=()=>{if(mapViewFrame!=null)return;mapViewFrame=requestAnimationFrame(()=>{mapViewFrame=null;followVisibleResult();});};
  root.addEventListener("scroll",scheduleViewedResult,{passive:true});
  window.addEventListener("resize",scheduleViewedResult);
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
  function logViewHtml() {
    const simulation=getSimulationLog?.(active) || {};
    const events=active.executionLog || active.trace?.events || [];
    return `<section class="ex-log-view"><h2>Run log</h2><article><small>Original request</small><p>${esc(active.experiment.decision)}</p></article><article><small>Question tested · ${active.scenarios.length} combinations</small><p>${esc(active.experiment.question)}</p></article>${events.map(e=>`<article><small>${esc(e.phase||e.kind||'Activity')}</small><p>${esc(e.message||e.kind)}</p></article>`).join('')}${(simulation.events||[]).map(e=>`<article><small>Simulation update · Day ${e.effective_day}</small><p>${esc(e.text)}</p></article>`).join('')}${(simulation.questions||[]).map(q=>`<article><small>Question · Day ${q.tick}</small><p>${esc(q.question)}</p><strong>${pct(q.shares?.yes)} yes · ${pct(q.shares?.no)} no · ${pct(q.shares?.unsure)} unsure</strong></article>`).join('')}${executionHtml(active)}</section>`;
  }
  function evidenceHtml(panel, expanded=false) {
    if (!panel) return '<p class="ex-note">No web-researched personas saved for this run.</p>';
    const link=source=>{let url;try{url=new URL(source.url);if(!['https:','http:'].includes(url.protocol))url=null;}catch{}return url?`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.title||'Source')}</a>`:esc(source.title);};
    const cards=(panel.personas||[]).map((p,i)=>{
      const attrs=(p.attributes||[]).filter(a=>a.value && a.provenance!=='unknown');
      const originalLabel=String(p.label||'Research persona').replace(/\s*\(inferred archetype\)\s*$/i,'');
      const objection=originalLabel.match(/^Customers expressing (?:a |an )?(.+?) objection$/i);
      const title=objection ? `${objection[1][0].toUpperCase()}${objection[1].slice(1)} concerns` : originalLabel;
      const traits=attrs.filter(a=>a.key!=='customer_statement' && !(objection && a.key==='objections'));

      return `<article class="ex-research-persona"><header><span class="pr-sprite-head" aria-hidden="true" style="background-position:-${((i%5)*48+16)*4}px -${Math.floor((i%10)/5)*64*4}px"></span><div><h3>${esc(title)}</h3><small>Research profile</small></div></header><dl>${traits.slice(0,2).map(a=>`<div><dt>${esc(a.key.replaceAll('_',' '))}</dt><dd>${esc(String(a.value).length>80?String(a.value).slice(0,77)+'…':a.value)}</dd></div>`).join('')||''}</dl><details><summary>Evidence</summary>${attrs.map(a=>`<p><b>${esc(a.key.replaceAll('_',' '))}</b> · ${esc(a.provenance)}<br>${esc(a.value)}</p>`).join('')}</details></article>`;
    }).join('');
    return `<section class="ex-research-personas"><h3>Customer personas</h3><p class="ex-note">${panel.personas?.length||0} research profiles · ${panel.sources?.length||0} ${panel.sources?.length===1?'source':'sources'}</p><div class="ex-persona-carousel" tabindex="0" role="region" aria-label="Customer persona tiles">${cards}</div><div class="ex-research-sources"><h3>Sources</h3>${(panel.sources||[]).map(source=>`<p>${link(source)}</p>`).join('')}</div><details class="ex-details"><summary>Research limits</summary>${(panel.gaps||[]).map(g=>`<p>${esc(g)}</p>`).join('')}<p>These qualitative profiles have no population weights. Demographics and sample weights come from Census data.</p></details></section>`;
  }
  function newsHtml(run) {
    if(!run.newsContext)return '';
    let articles;try{articles=JSON.parse(run.newsContext.slice(run.newsContext.indexOf('\n')+1));}catch{return '';}
    return `<details class="ex-details"><summary>News context · past week</summary><p>The same dated headlines inform each scenario and its timeline. Individual awareness is modeled.</p>${articles.map(a=>{let url;try{url=new URL(a.url);if(!['https:','http:'].includes(url.protocol))url=null;}catch{}return `<p><small>${esc(a.published)}</small><br>${url?`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(a.headline)}</a>`:esc(a.headline)}<br>${esc(a.summary)}</p>`;}).join('')}</details>`;
  }
  function progressHtml(exp = null) {
    return `<div class="ex-pipeline"><span class="ex-kicker">ONE QUESTION → A CITY OF POSSIBILITIES</span><h2>${exp?'Testing the price trade-offs.':'Building your research audience.'}</h2><p class="ex-question">${esc(lastQuestion)}</p>
      <ol class="ex-stages"><li class="${exp?'done':'current'}"><b>01</b><span>Research & personas<small>${esc(exp ? (researchPanel?`${researchPanel.sources.length} sources · ${researchPanel.personas.length} profiles pinned`:'Offline fixture') : researchProgress)}</small></span></li><li class="${exp?'current':''}"><b>02</b><span>Controlled experiment<small class="ex-progress">${exp?`Testing ${exp.scenarios.length} combinations…`:'Region × price × format'}</small></span></li><li><b>03</b><span>Impact & time<small>Compare results, then follow daily adaptation</small></span></li></ol>
      ${exp?`<div class="ex-factor-grid">${exp.factors.map(f=>`<div><span>${esc(f.label)}</span><strong>${f.levels.length}</strong><small>${f.levels.map(esc).join(' · ')}</small></div>`).join('')}</div><p class="ex-note">Income, age and geography breakdowns · same Census-weighted audience throughout.</p>${plan.priceSuggested&&plan.priceMode==='relative'?'<p class="ex-note">No amount specified: testing current price through +20% as an editable hypothesis.</p>':''}`:''}
      ${evidenceHtml(researchPanel)}<button class="ex-link" data-action="cancel">Cancel</button></div>`;
  }
  function proposalHtml() {
  if (!plan) return `<p class="ex-error" role="alert">${esc(error)}</p><button class="ex-link" data-action="retry-plan">Try again</button>`;
  const exp=compilePlan(plan), commercial=plan.kind!=="compare";
  if (busy) return progressHtml(exp);
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
  const run=displayRun(active),exp=run.experiment,ranked=rankScenarios(run),best=ranked[0], current=exp.scenarios[selected];
  const hasCurve=priceSeries(run,selected).length>=2, modern=exp.version===3;
  const share=scenarioShare(run.scenarios[selected],exp.indices);
  const selectedPrice=current.change??current.price;
  const mode=exp.priceMode || (current.change!=null?"relative":"absolute");
  const tabPanel = key => `id="result-section-${key}" role="tabpanel" aria-labelledby="result-tab-${key}" ${resultSection===key?"":"hidden"}`;
  return `<nav class="ex-section-tabs" role="tablist" aria-label="Result sections">${["research","comparisons","overview","simulate"].map(key=>`<button type="button" role="tab" id="result-tab-${key}" data-section="${key}" aria-controls="result-section-${key}" aria-selected="${resultSection===key}" tabindex="${resultSection===key?0:-1}">${({research:"Data & personas",comparisons:"Design",overview:"Results",simulate:"Simulate"})[key]}</button>`).join("")}</nav><h2 class="ex-result-title" ${resultSection==='overview'?'hidden':''}>${hasCurve?"Price experiment":"Experiment"}</h2><p class="ex-question">${esc(exp.decision)}</p>
    <p class="ex-audience">${esc(audienceText(run.audience))} · ${run.residents.length.toLocaleString()} synthetic residents</p>
    ${run.fixture?'<p class="ex-demo">Illustrative demo results · not model answers to your question.</p>':'<p class="ex-note">Model estimates, not observed customer behavior.</p>'}
    <div ${tabPanel("overview")}>
    <div class="ex-result-controls"><details name="chart-controls" data-control="factors"><summary>Factors<span>${curveFilters && (curveFilters.location.size||curveFilters.format.size)?'Filtered':'All'}</span></summary><div class="ex-control-body">${factorControlsHtml(run)}${hasCurve?`<label class="ex-price-select" ${chartType==='line'?'hidden':''}>${esc(exp.priceAxis||'Price')} <select id="experiment-price" aria-label="Selected price">${priceSeries(run,selected).map(row=>`<option value="${row.index}" ${row.index===selected?'selected':''}>${esc(priceLabel(row.scenario.change??row.scenario.price,mode))}</option>`).join('')}</select></label>`:''}</div></details><details name="chart-controls" data-control="audience"><summary>Audience<span>${demographicDimension==='all'?'Everyone':esc(dimensionName(demographicDimension))}</span></summary><div class="ex-control-body" id="experiment-audience-control"></div></details><details name="chart-controls" data-control="metric"><summary>Metric<span>${esc(exp.metric)}</span></summary><div class="ex-control-body"><select id="experiment-metric" aria-label="Key metric"><option value="" ${selectedMetric==null?'selected':''}>${esc(active.experiment.metric)}</option>${active.experiment.options.map((label,i)=>active.experiment.indices.length===1&&active.experiment.indices[0]===i?'':`<option value="${i}" ${selectedMetric===i?'selected':''}>${esc(label)}</option>`).join('')}</select></div></details></div>
    ${mapKeyHtml(run)}

    <div class="ex-chart-mount"><section class="ex-unified-chart ${chartType==='line'&&hasCurve?'ex-show-price':''}" aria-label="Interactive results chart">
      <div class="ex-chart-tools"><label>Chart type <select id="experiment-chart-type" aria-label="Chart type">${['line','bar','histogram','scatter','box'].map(t=>`<option value="${t}" ${chartType===t?'selected':''}>${({line:'Line',bar:'Bar',histogram:'Histogram',scatter:'Scatter',box:'Box plot'})[t]}</option>`).join('')}</select></label><button type="button" class="ex-expand-chart" data-action="expand-chart" aria-label="Expand chart" title="Expand chart">↗</button></div>
      <div class="ex-price-plot" ${chartType==='line'&&hasCurve?'':'hidden'}>${hasCurve?curveHtml(run):''}</div>
      <h3 id="experiment-audience-heading" ${chartType==='line'&&hasCurve?'hidden':''}>${esc(exp.metric)}</h3>
      <p class="ex-chart-context" ${chartType==='line'&&hasCurve?'hidden':''}>${esc(current.label)}</p><div id="experiment-people"></div>
      <div class="ex-resident-preview"><span>People behind this result</span><div class="ex-faces" aria-label="Synthetic personas behind the selected estimate"></div></div>
    </section></div>
    <details class="ex-details"><summary>All combinations</summary>${scenarioMatrixHtml(run,selected)}</details>
    ${hasCurve?`<details class="ex-details"><summary>Factor effects</summary>${factorImpactHtml(run)}</details>`:''}

    </div><div ${tabPanel("comparisons")}>
    ${experimentDesignHtml(run)}
    <div class="ex-selected"><span>${esc(current.label)}</span><small>Tap ${hasCurve?"a price or ":""}a combination to explore its people.</small></div>
    </div><div ${tabPanel("research")}>
    <section class="ex-sample-summary"><h3>Sample</h3><p>${run.residents.length.toLocaleString()} synthetic residents; ${run.audience.sourceRecords?.toLocaleString()??"unknown"} matching Census records. Weighted group responses, not independent interviews. City-wide audience, not a separate local demand sample for each area.</p></section>
    ${evidenceHtml(run.researchPanel,true)}
    ${newsHtml(run)}
    ${executionHtml(run)}
    </div><div ${tabPanel("simulate")}>
    <div id="experiment-simulation" aria-live="polite"><p class="ex-note">Preparing this scenario…</p></div>
    <div class="ex-simulation-residents ex-faces" aria-label="Explore residents"></div>

    </div><div class="ex-next"><button class="ex-link" data-action="refine">Refine this experiment ↗</button><button class="ex-link" data-action="new-audience">Try another audience ↗</button></div>
    ${run.parentId?`<button class="ex-link ex-parent" data-run="${esc(run.parentId)}">← Previous experiment</button>`:""}<p class="ex-foot">${run.saved?"Saved in this browser":"Saved for this session only"} · ${esc(new Date(run.createdAt).toLocaleDateString())}</p>`;
}
  function factorImpactHtml(run) {
    const exp=run.experiment, chosen=exp.scenarios[selected], share=scenarioShare(run.scenarios[selected],exp.indices);
    const rows=exp.factors.map(f=>{
      const key=f.id==='price'?(exp.priceMode==='relative'?'change':'price'):f.id;
      const others=['location','format',exp.priceMode==='relative'?'change':'price'].filter(k=>k!==key);
      const matches=exp.scenarios.map((scenario,index)=>({scenario,index})).filter(r=>others.every(k=>r.scenario[k]===chosen[k]));
      const baseline=f.id==='price'?matches[0]:(matches.find(r=>r.scenario[key]!==chosen[key]) || matches[0]);if(!baseline)return '';
      const delta=share-scenarioShare(run.scenarios[baseline.index],exp.indices);
      return `<button class="ex-factor-impact" type="button" data-scenario="${baseline.index}" aria-label="Compare ${esc(f.label)}: ${esc(baseline.scenario.label)}"><span>${esc(f.label)}<small>vs. ${esc(f.id==='price'?priceLabel(baseline.scenario[key],exp.priceMode):baseline.scenario[key])}</small></span><strong>${pp(delta)}</strong></button>`;
    });
    return `<section class="ex-impact"><h3>What changes modeled interest?</h3>${rows.join('')}<p class="ex-foot">Other tested factors held fixed for each comparison. Demographic differences are associations, not causal effects. Operating costs and profit are not estimated.</p></section>`;
  }
  function metric(label,value) { return `<div><strong>${value}</strong><span>${label}</span></div>`; }
  function factorControlsHtml(run) {
    const exp=run.experiment,ref=exp.scenarios[selected];
    if(!curveFilters)curveFilters={location:new Set(),format:new Set()};
    return ref.location?`<div class="ex-curve-controls">${["location","format"].map(key=>`<div class="ex-quick-filter"><span>${key==="location"?"Location":esc(exp.factors?.find(f=>f.id==="format")?.label||"Service format")}</span><div class="ex-filter-pills" role="group" aria-label="${key==="location"?"Location":"Service format"}">${[...new Set(exp.scenarios.map(s=>s[key]))].map(value=>`<button type="button" data-curve="${key}" data-value="${esc(value)}" aria-pressed="${curveFilters[key].has(value)}">${esc(value)}</button>`).join("")}</div></div>`).join("")}</div>`:"";
  }
  function curveHtml(run, expanded = false) {
  const exp=run.experiment, series=priceSeries(run,selected), ref=exp.scenarios[selected];
  if(!curveFilters)curveFilters={location:new Set(),format:new Set()};
  const colors=['#087fff','#a44ac2','#168b6b','#e28520','#db4667','#6670bd'];
  const combinations=exp.scenarios.map((scenario,index)=>({scenario,index})).filter(({scenario})=>(!curveFilters.location.size||curveFilters.location.has(scenario.location))&&(!curveFilters.format.size||curveFilters.format.has(scenario.format)));
  const keys=[...new Set(combinations.map(({scenario})=>JSON.stringify([scenario.location,scenario.format])))];
  let curves=keys.map((key,i)=>{const first=combinations.find(({scenario})=>JSON.stringify([scenario.location,scenario.format])===key);return {index:first.index,color:colors[i%colors.length],label:[first.scenario.location,first.scenario.format].filter(Boolean).join(' · '),rows:priceSeries(run,first.index)};});
  if(demographicDimension!=='all'){
    const aliases={income:'income_q',education:'educ',geography:'puma'};
    const audienceColors=new Map(researchMapColors(mapPayload(run).groups,mapPayload(run).options,map.agents,demographicDimension).legend.map(g=>[g.key,g.color]));
    curves=curves.flatMap(curve=>{
      const breakdown=curve.rows[0]?.result.result.option_breakdowns?.find(b=>b.dimension===demographicDimension||b.dimension===aliases[demographicDimension]);
      return (breakdown?.groups||[]).filter(g=>!audienceKeys.size||audienceKeys.has(g.key)).map(group=>({...curve,group:group.key,label:`${labelGroup(demographicDimension,group.key)} · ${curve.label}`,rows:curve.rows.map(row=>{
        const b=row.result.result.option_breakdowns?.find(b=>b.dimension===demographicDimension||b.dimension===aliases[demographicDimension]);
        const g=b?.groups.find(g=>g.key===group.key);
        return {...row,result:{...row.result,result:{...row.result.result,p_distribution:g?.shares.map((p,i)=>[exp.options[i],p])||[]}}};
      })}));
    }).map((curve,i)=>({...curve,color:audienceColors.get(curve.group)||colors[i%colors.length]}));
  }
  const multiple=curves.length>1;
  const values=series.map(r=>r.scenario.change??r.scenario.price), min=Math.min(...values),max=Math.max(...values);
  const mode=exp.priceMode || (ref.change!=null?"relative":"absolute");
  const X=x=>80+(x-min)/(max-min||1)*400,Y=y=>190-y*130;
  const dense = series.length > 8;
  const tickStep = Math.ceil((series.length-1)/5);
  const points=series.map(r=>({...r,x:X(r.scenario.change??r.scenario.price),share:scenarioShare(r.result,exp.indices)}));
  const yLabel = /^(willingness to buy|would buy)$/i.test(exp.metric) ? "Estimated audience who would buy (%)" : `Estimated audience · ${exp.metric} (%)`;
  return `<div class="ex-chart-heading"><div class="ex-chart-label">${esc(exp.metric)} by ${esc((exp.priceAxis||"price").toLowerCase())}</div></div>
    ${expanded?factorControlsHtml(run):""}
    <div class="ex-plot-heading"><p class="ex-y-label">↑ ${esc(yLabel)}</p></div>
    <div class="ex-plot-wrap">
    <svg class="ex-curve pc-svg ${dense?"ex-curve-dense":""}"  viewBox="0 0 560 262" role="group" aria-label="${esc(yLabel)} by ${esc(exp.priceAxis||"price")}">
    ${[0,.5,1].map(v=>`<line class="pc-grid" x1="80" x2="480" y1="${Y(v)}" y2="${Y(v)}"/><text class="pc-axis" x="64" y="${Y(v)+4}" text-anchor="end">${Math.round(v*100)}%</text>`).join("")}
    ${curves.map(curve=>{const ps=curve.rows.map(r=>({...r,x:X(r.scenario.change??r.scenario.price),share:scenarioShare(r.result,exp.indices)})).filter(p=>p.share!=null);return `<polyline class="pc-line" style="stroke:${curve.color}" points="${ps.map(p=>`${p.x},${Y(p.share)}`).join(' ')}"/>${ps.map((p,i)=>`<g class="pc-lpt ${(selected===p.index&&(!curve.group||pointGroup===curve.group))?'sel':''}" role="button" tabindex="0" data-scenario="${p.index}" data-audience-group="${esc(curve.group||'all')}" aria-pressed="${(selected===p.index&&(!curve.group||pointGroup===curve.group))}" aria-label="${esc(p.scenario.label)}: ${pct(p.share)}"><title>${esc(curve.label)} · ${esc(priceLabel(p.scenario.change??p.scenario.price,mode))}: ${pct(p.share)}</title><circle class="ex-hit" cx="${p.x}" cy="${Y(p.share)}" r="${multiple?6:dense?9:18}"/><circle class="ex-price-point" style="stroke:${curve.color};fill:${(selected===p.index&&(!curve.group||pointGroup===curve.group))?curve.color:'white'}" cx="${p.x}" cy="${Y(p.share)}" r="${(selected===p.index&&(!curve.group||pointGroup===curve.group))?6:multiple||dense?3:6}"/>${(selected===p.index&&(!curve.group||pointGroup===curve.group))||(!multiple&&!dense)?`<text class="pc-axis ex-point-value" x="${p.x}" y="${Y(p.share)-18}" text-anchor="${i===0?'start':i===ps.length-1?'end':'middle'}">${pct(p.share)}</text>`:''}</g>`).join('')}`;}).join('')}
    ${points.map((p,i)=>!dense||i%tickStep===0||i===points.length-1?`<text class="pc-axis ex-price-tick ${i!==0&&i!==points.length-1&&(dense?Math.round(i/tickStep):i)%2?'ex-minor-tick':''}" x="${p.x}" y="218" text-anchor="middle">${esc(priceLabel(p.scenario.change??p.scenario.price,mode))}</text>`:'').join('')}
    <text class="pc-axis" x="280" y="253" text-anchor="middle">${esc(exp.priceAxis||"Price")} →</text></svg></div>
    ${multiple?`<details class="ex-chart-series"><summary>${curves.length} series · choose a group</summary><div class="ex-series-legend">${curves.map(c=>`<button type="button" data-curve-series="${c.index}" data-audience-group="${esc(c.group||'all')}" aria-label="Show ${esc(c.label)} on map"><i style="background:${c.color}"></i>${esc(c.label)}</button>`).join('')}</div></details>`:''}
    <div class="ex-curve-legend"><span>${dense?`${points.length} tested prices · select the line to inspect`:'<i></i>Tested price'}</span><span><i class="selected"></i>Selected price</span></div>
    <details class="ex-chart-explanation"><summary>About this chart</summary><p class="ex-foot">Percentages are modeled shares of the simulated audience, not sales or profit. Each line holds location and format fixed. Select a point to update the map. Lines connect tested prices. ${mode==="absolute"?"Prices are experimental assumptions.":""}</p></details>`;
}
  function mountSimulation() {
    const host=root.querySelector('#experiment-simulation'),run=active,scenario=selected;
    const faces=run.residents.slice(0,6),faceHost=root.querySelector('.ex-simulation-residents');
    faceHost.innerHTML=faces.map(r=>`<button data-person="${r.id}" aria-label="Inspect ${esc(r.name)}"><canvas width="40" height="40"></canvas></button>`).join('');
    faceHost.querySelectorAll('canvas').forEach((canvas,i)=>map.drawHeadTo(canvas,faces[i].id));
    void (async()=>{try {
      if(JSON.stringify(run.audience.filters)!==JSON.stringify(ctx().audience.filters))await restoreAudience(run);
      if(!host.isConnected||!visible||active!==run||selected!==scenario||resultSection!=="simulate")return;
      await startTimeline(run,scenario,host);
    } catch(error) {if(host.isConnected)host.textContent=error.message;}})();
  }
  function mountPeople() {
    const run = displayRun(active), scenario = run.scenarios[selected], exp = run.experiment;
    const payload=mapPayload(active);
    map.setResearchResponses?.(payload.groups, payload.options, {colorBy:mapColorBy});
    showScenarioLocation?.(curveFilters?.location.size ? [...curveFilters.location] : null);
    const answers = new Map();
    for (const group of scenario.response_groups) for (const id of group.agent_ids) {
      const p = metricShare(group.probabilities,exp.indices);
      answers.set(id,{p_yes:p,dist:[p,1-p],why:factorText(group.factor),archetype:group.archetype});
    }
    // Re-express the chosen metric as a binary share, keeping the SAME groups,
    // members and weights. The chart must not silently switch to the winning option.
    const model = buildEvidenceChartModel({ ...scenario.result, breakdowns:{}, p_distribution:[[exp.metric,scenarioShare(scenario,exp.indices)],["Other responses",1-scenarioShare(scenario,exp.indices)]],
      option_breakdowns:(scenario.result.option_breakdowns || []).map(b=>({...b,groups:b.groups.map(g=>{ const p=metricShare(g.shares,exp.indices); return {...g,shares:p==null?[]:[p,1-p]}; })})) });
    const aliases = {educ:"education",income_q:"income",puma:"geography"};
    model.breakdowns = model.breakdowns.filter(b=>!aliases[b.dimension] || !model.breakdowns.some(other=>other.dimension===aliases[b.dimension])).map(b=>({...b,dimension:aliases[b.dimension]||b.dimension,groups:b.groups.map(g=>({...g,dimension:aliases[g.dimension]||g.dimension}))}));
    const allShare=scenarioShare(scenario,exp.indices);
    model.breakdowns.unshift({dimension:'all',groups:[{dimension:'all',key:'all',n:run.residents.length,weight:run.residents.reduce((n,r)=>n+(r.pums_weight>0?r.pums_weight:1),0),shares:[allShare,1-allShare]}]});
    chart = createPersonaChart(root.querySelector("#experiment-people"), {
      question:exp.question,framing:"options",options:[exp.metric,"Other responses"],topIndex:0,model:{...model,breakdowns:model.breakdowns.map(b=>b.dimension===demographicDimension&&audienceKeys.size?{...b,groups:b.groups.filter(g=>audienceKeys.has(g.key))}:b)},residents:run.residents.filter(r=>!audienceKeys.size||audienceKeys.has(r.segments?.[demographicDimension])),answers,
      answersNote:"Inherited demographic-group estimates, not individual interviews.",type:chartType==='line'?'bar':chartType,compact:true,showHeading:false,showChartTypes:false,
      dimension: [demographicDimension,"all"].find(d=>model.breakdowns.some(b=>b.dimension===d && b.groups.length)),
      onDimensionChange:dimension=>{demographicDimension=dimension;audienceKeys.clear();pointGroup=null;render();},
      labels:{dimension:dimensionName,group:(d,k)=>d==='all'?'All population':labelGroup(d,k)},drawHead:(canvas,id)=>map.drawHeadTo(canvas,id),
      openPerson:r=>inspect(r.id),onGroupSelect:segments=>{if(disposingChart)return;pointGroup=segments?.[0]?.key??null;map.setSegmentSelection(segments?.length && segments[0].dimension!=="all"?{clauses:segments,operator:"or"}:null);},
    });
    root.querySelector("#experiment-audience-control")?.append(root.querySelector("#experiment-people .pc-dim"));
    const groups=model.breakdowns.find(b=>b.dimension===demographicDimension)?.groups||[];
    if(demographicDimension!=='all')root.querySelector('#experiment-audience-control').insertAdjacentHTML('beforeend',`<div class="ex-filter-pills ex-audience-pills">${groups.map(g=>`<button type="button" data-audience-key="${esc(g.key)}" aria-pressed="${audienceKeys.has(g.key)}">${esc(labelGroup(demographicDimension,g.key))}</button>`).join('')}</div>`);
    if(pointGroup!=null)chart.selectGroup(demographicDimension,pointGroup);

    root.querySelector("#experiment-audience-heading").textContent=chart.dimension==="all"?`${exp.metric} · all population`:`${exp.metric} by ${dimensionName(chart.dimension).toLowerCase()}`;
    const location=exp.scenarios[selected].location;
    const regional=curveFilters?.location.size ? run.residents.filter(r=>answers.has(r.id)&&curveFilters.location.has(r.neighborhood)) : [];
    const pool=regional.length?regional:run.residents.filter(r=>answers.has(r.id));
    const faces=pool.filter(r=>(!audienceKeys.size||audienceKeys.has(r.segments?.[demographicDimension]))&&(pointGroup==null||pointGroup==='all'||r.segments?.[demographicDimension]===pointGroup)).slice(0,6);
    const host = root.querySelector(".ex-faces");
    host.innerHTML = `${faces.map(r=>`<button data-person="${r.id}" aria-label="Inspect ${esc(r.name)}" title="${esc(r.name)}"><canvas width="40" height="40"></canvas></button>`).join("")}`;
    host.querySelectorAll("canvas").forEach((canvas,i)=>map.drawHeadTo(canvas,faces[i].id));
    if (person != null) inspect(person, false);
  }
  async function inspect(id, scroll = true) {
    if (!visible || view !== "results" || !active) return false;
    const resident = active.residents.find(r=>r.id===Number(id));
    if (!resident) return false;
    if(chartDialog.open)closeChart();
    person=resident.id; const seq=++personGeneration, run=displayRun(active);
    const host=residentPanel; host.hidden=false;
    host.innerHTML=personaResultHtml(run,id,selected);
    if(resultSection==='simulate' && map.evolution){
      const {frame,groups,outcomes=[]}=map.evolution;
      const group=groups.find(g=>g.members.includes(Number(id)));
      const behavior=frame.behaviors.find(b=>b.group===group?.id);
      const rows=Object.entries(behavior?.probabilities||{}).sort((a,b)=>b[1]-a[1]);
      const header=host.querySelector('.ex-person-head'),story=host.querySelector('.ex-person-story');
      host.replaceChildren(header,story);
      host.insertAdjacentHTML('beforeend',`<h3>Day ${frame.day??frame.tick} · modeled response</h3>${rows.length?rows.map(([key,p])=>`<div class="ex-simulation-person-row"><span>${esc(outcomes.find(o=>o.id===key)?.label||key)}</span><strong>${pct(p)}</strong></div>`).join(''):'<p>No response recorded for this profile yet.</p>'}<p class="pr-group-note">Estimates for this resident’s demographic group.</p>`);
    }
    map.drawHeadTo(host.querySelector("canvas"),id);
    if(scroll) host.scrollTop=0;
    try { const detail=await getPersona?.(run,id); if(seq===personGeneration && detail?.persona) host.querySelector(".ex-person-story").textContent=detail.persona; } catch { /* Stored demographics remain available. */ }
    return true;
  }
  let lastQuestion = "";
  async function openDecision(question) {
    if(busy || !ctx().ready) return;
    reviewingSaved=false;resultSection="overview";curveFilters=null;logsOpen=false;selectedMetric=null;demographicDimension="all";audienceKeys.clear();pointGroup=null;chartType="line";
    lastQuestion=question; researchPanel=null; researchProgress="Checking saved research…"; parentId=null; plan=null; error=""; areasOpen=false; allRanks=false; resetSelection(); prepare(); liveMap();
    planningLog=[]; executionLog=[{kind:"client.plan_requested",phase:"Plan",message:api.isDemo?"Demo recipe selected locally. No model will be called.":"Requesting a proposal from the backend; waiting for execution evidence."}];
    control={id:crypto.randomUUID(),createdAt:new Date().toISOString(),question,city:ctx().city,model:PREDICT.model,population:ctx().residents.length,fixture:api.isDemo};syncControl("planning");
    view="planning"; visibility(true); root.scrollTop=0; busy=true; setBusy(true); render();
    const seq=++generation, city=ctx().city; const controller=new AbortController(); abort=controller;
    try {
      if (!api.isDemo) {
        const preparedPanel = await prepareAutomaticAudience(question, {
        location: city, signal: controller.signal,
        onProgress: p => { if(seq!==generation)return; researchProgress=p.message || ({checking:'Checking saved research…',researching:'Searching public sources and building evidence-backed profiles…',ready:'Research complete. Planning the experiment…'})[p.stage] || 'Reviewing source evidence…'; render(); },
      });
        if(seq!==generation) return;
        researchPanel=preparedPanel;
      }
      const route=await api.proposeExperiment(city,question,controller.signal);
      if(seq!==generation) return;
      planningLog=(route.trace?.events || [{kind:api.isDemo?"demo.plan":"plan.untraced",message:api.isDemo?"Demo recipe only; no provider request.":"This backend returned a proposal without an execution trace. Model usage cannot be verified."}]).map(e=>({...e,phase:"Plan"})); executionLog=planningLog.slice();
      plan=autoPlan(question,route); planCity=city; const experiment=compilePlan(plan); view="proposal";syncControl("prepared",{experiment});
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
      const response=await compareScenarios(context.branch,{question:experiment.question,assumptions:experiment.assumptions,research_panel:researchReference(researchPanel),options:experiment.options,scenarios:experiment.scenarios,as_of_date:PREDICT.as_of_date},abort.signal,event=>{if(seq===generation)addLog(event);});
      if(seq!==generation) return;
      if(response.scenarios?.length!==experiment.scenarios.length || response.scenarios.some(s=>s.result?.p_distribution?.length!==experiment.options.length || scenarioShare(s,experiment.indices)==null || !s.response_groups?.length)) throw new Error("The comparison was incomplete. No results were saved. Please retry.");
      const run={id:crypto.randomUUID(),controlId:control.id,createdAt:new Date().toISOString(),city:context.city,simId:ctx().simId,audience,residents,researchPanel,draft,experiment,scenarios:response.scenarios,parentId:parent,model:PREDICT.model,asOf:PREDICT.as_of_date,fixture:api.isDemo||response.fixture_mode===true,newsContext:response.news_context || "",executionLog:structuredClone(executionLog),trace:response.trace,saved:true};
      try {await store.save(run);} catch {run.saved=false;saveNote="Browser storage is unavailable. Keep this tab open to retain the experiment.";}
      if(seq!==generation) return;
      controlWriter.write(controlRecordFromRun(run));controlWriter.flush().catch(()=>{});control.status="completed";
      runs.push(run);setTimelineExperiments(runs,openRun);active=run;parentId=null;selected=run.experiment.priceMode==="relative" ? Math.max(0,run.experiment.scenarios.findIndex(s=>s.change===Number(Number(run.draft?.percent).toFixed(2)))) : rankScenarios(run)[0].index;
      resetSelection();view="results";map.setAgents(residents);map.clearVerdicts();root.scrollTop=0;
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
    reviewingSaved=true;resultSection="overview";curveFilters=null;logsOpen=false;selectedMetric=null;demographicDimension="all";audienceKeys.clear();pointGroup=null;chartType="line";
    prepare();resetSelection();active=run;selected=run.experiment.priceMode==="relative" ? Math.max(0,run.experiment.scenarios.findIndex(s=>s.change===Number(Number(run.draft?.percent).toFixed(2)))) : rankScenarios(run)[0].index;view="results";
    map.setAgents(run.residents);map.clearVerdicts();visibility(true);root.scrollTop=0;render();
  }
  async function refine(audience=false) {
    if(busy || !active || !ctx().ready) return;
    const run=active;
    try {
      if(JSON.stringify(run.audience.filters)!==JSON.stringify(ctx().audience.filters)) await restoreAudience(run);
      if(run.draft.version!==3) {await openDecision(run.experiment.decision);parentId=run.id;render();return;}
      planningLog=[{kind:"plan.refined",message:"Refined the saved proposal locally. No new planning model call."}]; executionLog=planningLog.slice();
      researchPanel=run.researchPanel || null;plan=structuredClone(run.draft);planCity=run.city;parentId=run.id;
      control=null;
      if(plan.kind==="price" && plan.priceMode==="relative" && !audience) plan.percent/=2;
      resetSelection();liveMap();view="proposal";error="";root.scrollTop=0;render();
      if(audience) openFilters();
    } catch {saveNote="Could not restore this audience. Reconnect and try again.";render();}
  }
  function handleChartChange(e){
    if(e.target.id==='experiment-metric'){selectedMetric=e.target.value===''?null:Number(e.target.value);render();}
    if(e.target.id==='experiment-chart-type'){chartType=e.target.value;render();}
    if(e.target.id==='experiment-price'){selected=Number(e.target.value);pointGroup=null;render();}
  }
  root.addEventListener('change',handleChartChange);
  chartDialog.addEventListener('change',handleChartChange);
  residentPanel.addEventListener("keydown",e=>{if(e.target.matches("g[data-scenario]") && ["Enter"," "].includes(e.key)){e.preventDefault();e.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
  root.addEventListener("keydown",e=>{if(e.target.matches("g[data-scenario]") && ["Enter"," "].includes(e.key)){e.preventDefault();e.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
  function handleResearchClick(e) {
    const b=e.target.closest("button, g[data-scenario]");
    if(!b && !busy && active && e.target.closest("[data-expand-plot]")) {renderExpandedChart();chartDialog.showModal();return;}
    if(!b || (busy && b.dataset.action!=="cancel")) return;
    const d=b.dataset;
    if(d.audienceKey!=null){if(audienceKeys.has(d.audienceKey))audienceKeys.delete(d.audienceKey);else audienceKeys.add(d.audienceKey);pointGroup=null;render();map.setSegmentSelection(audienceKeys.size?{operator:'or',clauses:[...audienceKeys].map(key=>({dimension:demographicDimension,key}))}:null);return;}
    if(d.section) {resultSection=d.section;root.scrollTop=0;render();root.querySelector(`[data-section="${resultSection}"]`)?.focus({preventScroll:true});return;}
    if(d.action==="close-chart")return closeChart();
    if(d.action==="expand-chart") {renderExpandedChart();chartDialog.showModal();return;}
    if(d.curveSeries!=null && active){const ref=active.experiment.scenarios[selected],target=active.experiment.scenarios[Number(d.curveSeries)];const index=active.experiment.scenarios.findIndex(s=>s.location===target.location&&s.format===target.format&&(s.change??s.price)===(ref.change??ref.price));if(index>=0){selected=index;pointGroup=d.audienceGroup??(demographicDimension==='all'?'all':null);render();}return;}
    if(d.curve && active && !busy) {
      const ref=active.experiment.scenarios[selected], key=d.curve, values=curveFilters[key];
      if(values.has(d.value))values.delete(d.value);else values.add(d.value);
      const matches=s=>(!curveFilters.location.size||curveFilters.location.has(s.location))&&(!curveFilters.format.size||curveFilters.format.has(s.format));
      const index=active.experiment.scenarios.findIndex(s=>matches(s)&&(s.change??s.price)===(ref.change??ref.price));
      if(index>=0)selected=index;
      render();return;
    }
    if(d.action==="cancel") return cancel();
    if(d.action==="close") {resetSelection();visibility(false);liveMap();return;}
    if(d.action==="logs"){logsOpen=!logsOpen;root.scrollTop=0;render();return;}
    if(d.action==="history") return openHistory();
    if(d.action==="retry-plan") return openDecision(lastQuestion);
    if(d.action==="approve") return submit();
    if(d.action==="audience") return openFilters();
    if(d.action==="refine") return refine();
    if(d.action==="new-audience") return refine(true);
    if(d.action==="swap-areas") {areasOpen=!areasOpen;render();return;}
    if(d.action==="all-ranks") {allRanks=!allRanks;render();return;}
    if(d.run) return openRun(d.run);
    if(d.person) return inspect(d.person);
    if(d.action==="close-person") {residentPanel.hidden=true;person=null;personGeneration++;render();return;}
    if(d.scenario!=null) {selected=Number(d.scenario);pointGroup=d.audienceGroup??(demographicDimension==='all'?'all':null);render();return;}
    if(!plan || view!=="proposal") return;
    error="";
    if(d.location!=null) {const location=plan.availableLocations[Number(d.location)];if(!plan.locations.includes(location)) plan.locations=[plan.locations[1],location];}
    if(d.action==="absolute-prices"){plan.priceMode="absolute";plan.priceRange=[10,20];plan.priceSuggested=true;}
    if(d.measure) plan.measure=d.measure;
    if(d.percent) plan.percent=Number(d.percent);
    if(d.range){plan.priceRange=d.range.split(",").map(Number);plan.priceSuggested=true;}
    syncControl("awaiting_approval",{experiment:compilePlan(plan)});
    render();
  }
  root.addEventListener("click",handleResearchClick);
  chartDialog.addEventListener("click",handleResearchClick);
  residentPanel.addEventListener("click",handleResearchClick);
  root.addEventListener("keydown",event=>{
    if(!event.target.matches("[data-section]") || !["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();const tabs=[...root.querySelectorAll("[data-section]")],i=tabs.indexOf(event.target);
    tabs[event.key==="Home"?0:event.key==="End"?tabs.length-1:(i+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length].click();
  });
  launcher.addEventListener("click",openHistory);
  store.list().then(saved=>{runs=[...saved.filter(s=>!runs.some(r=>r.id===s.id)),...runs];setTimelineExperiments(runs,openRun);render();}).catch(()=>{saveNote="Runs will remain in this tab; browser storage is unavailable.";render();});
  visibility(false);
  return {
    inspect,openDecision,cancel,
    refreshInspection(){if(person!=null&&visible&&resultSection==='simulate')void inspect(person,false);},
    get showingResults(){return visible && view==="results";}, get busy(){return busy;},
    refresh(){render();},
    clearInspection(){if(!visible||view!=="results"||(!chart?.hasSelection()&&person==null))return false;resetSelection();render();return true;},
    audienceChanged(){if(busy)cancel();resetSelection();if((view==="results"?active?.city:planCity)!==ctx().city){active=null;plan=null;parentId=null;visibility(false);}else if(visible&&view==="results"&&active)map.setAgents(active.residents);render();},
    suspend(){if(busy)return;resetSelection();visibility(false);liveMap();},
  };
}
