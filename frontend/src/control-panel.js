import { controlStore, controlRecordFromRun } from "./control-store.js";
import { createRunStore } from "./research.js";
import { executionCounts } from "./execution-log.js";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $=s=>document.querySelector(s);
let demo=new URLSearchParams(location.search).get("demo")==="1",rows=[],selected=null,historical=[],signature="",loading=false;
$("#mode").value=demo?"demo":"live";
async function loadHistory(){historical=(await createRunStore(demo?"simtra-research-demo-v1":"simtra-research-v1").list()).map(controlRecordFromRun);}
async function refresh(){
  if(loading)return;loading=true;
  try{
    const current=await controlStore(demo).list();const ids=new Set(current.map(r=>r.id));
    rows=[...current,...historical.filter(r=>!ids.has(r.id))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(!rows.some(r=>r.id===selected))selected=rows[0]?.id;
    $("#runs").innerHTML=rows.map(r=>`<button data-run="${esc(r.id)}" aria-pressed="${r.id===selected}">${esc(r.question)}<small>${esc(r.status.replaceAll("_"," "))} · ${esc(new Date(r.createdAt).toLocaleTimeString())}</small></button>`).join("")||'<p class="muted">No runs in this browser yet. Start an experiment in the town.</p>';
    const row=rows.find(r=>r.id===selected),next=JSON.stringify(row);
    if(signature!==next){signature=next;render(row);}
    $("#status").textContent="Up to date · refreshes locally";
  }catch(error){$("#status").textContent=`Diagnostics unavailable: ${error.message}`;}
  finally{loading=false;}
}
function render(row){
  const host=$("#detail");if(!row){host.innerHTML="<p>No experiment selected.</p>";return;}
  const open=[...host.querySelectorAll("details[open]")].map(d=>d.dataset.section),scroll=host.querySelector(".logs")?.scrollTop||0;
  const counts=executionCounts(row.events),exp=row.experiment,results=row.scenarios||[],fixture=row.fixture||row.events?.some(e=>e.details?.fixture);
  const completed=(row.events||[]).filter(e=>e.kind==="scenario.completed").length;
  const usageKnown=fixture||(row.events||[]).some(e=>e.kind?.startsWith("model.")||e.kind==="plan.refined");
  host.innerHTML=`<span class="pill">${fixture?"Fixture / demo":"Backend"} · ${esc(row.status.replaceAll("_"," "))}</span><h2>${esc(row.question)}</h2><p class="muted">${esc(row.city)} · ${esc(row.model)} · ${(row.population||0).toLocaleString()} synthetic residents</p>
    <div class="stats"><div><strong>${usageKnown?counts.requests:"—"}</strong><span>${fixture?"Mock":"Provider"} requests</span></div><div><strong>${usageKnown?counts.cacheHits:"—"}</strong><span>Exact cache hits</span></div><div><strong>${usageKnown?counts.retries:"—"}</strong><span>Retries</span></div><div><strong>${fixture&&results.length?results.length:completed} / ${exp?.scenarios.length??"—"}</strong><span>${fixture?"Fixture results":"Scenarios completed"}</span></div></div>
    ${row.error?`<p class="error">${esc(row.error)}</p>`:""}
    ${exp?`<h3>Factors and levels</h3>${exp.factors?.length?`<table><thead><tr><th>Factor</th><th>Tested levels</th></tr></thead><tbody>${exp.factors.map(f=>`<tr><td>${esc(f.label)}</td><td>${f.levels.map(esc).join(" · ")}</td></tr>`).join("")}</tbody></table>`:'<p class="muted">Historical design: use the exact scenario descriptions below. No retroactive factor metadata.</p>'}
    <h3>Exact question and criteria</h3><p>${esc(exp.question)}</p><p>Response options: ${exp.options.map(esc).join(" / ")}. Metric: ${esc(exp.metric)}. Ranked by Census-weighted model probabilities, not profit, sales or proven business success. Group members inherit the representative response; complete group coverage is required.</p>
    <details data-section="assumptions"><summary>Shared assumptions</summary><p>${esc(exp.assumptions)}</p></details>
    <h3>All ${exp.scenarios.length} experiments</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>Configuration</th><th>Metric</th><th>Coverage</th></tr></thead><tbody>${exp.scenarios.map((s,i)=>{const r=results[i],p=r?.distribution?(exp.indices||[0]).reduce((n,j)=>n+(r.distribution[j]?.[1]||0),0):null;return `<tr><td>${i+1}</td><td><b>${esc(s.label)}</b><details><summary>Exact scenario</summary>${esc(s.description)}</details></td><td>${p==null?"—":(p*100).toFixed(1)+"%"}</td><td>${r?`${r.coveredResidents?.toLocaleString()} residents / ${r.archetypes} groups`:"Pending"}</td></tr>`;}).join("")}</tbody></table></div>`:"<p>Preparing the experiment design.</p>"}
    <details data-section="events"><summary>Raw execution log (${row.events?.length||0} events)</summary><ol class="logs">${(row.events||[]).map(e=>`<li><small>${esc(e.phase||"Experiment")} · ${((e.elapsed_ms||0)/1000).toFixed(2)}s · ${esc(e.kind)}</small>${esc(e.message)}<code>${esc(JSON.stringify(e.details||{}))}</code><code>${esc(e.run_id||"client")}</code></li>`).join("")}</ol></details>
    <p class="muted">No web research or independent customer interviews. Logs contain execution evidence, not hidden model reasoning.</p><button id="export">Download diagnostic JSON</button>`;
  for(const name of open)host.querySelector(`details[data-section="${name}"]`)?.setAttribute("open","");
  if(host.querySelector(".logs"))host.querySelector(".logs").scrollTop=scroll;
}
$("#runs").addEventListener("click",e=>{const b=e.target.closest("[data-run]");if(b){selected=b.dataset.run;signature="";refresh();}});
$("#mode").addEventListener("change",async e=>{demo=e.target.value==="demo";selected=null;signature="";historical=[];await loadHistory();refresh();});
$("#refresh").addEventListener("click",async()=>{await loadHistory();refresh();});
$("#detail").addEventListener("click",e=>{if(e.target.id!=="export")return;const row=rows.find(r=>r.id===selected);const url=URL.createObjectURL(new Blob([JSON.stringify(row,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=`simtra-experiment-${row.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
loadHistory().then(refresh).catch(e=>{$("#status").textContent=e.message;});
setInterval(()=>{if(!document.hidden)refresh();},2000);
