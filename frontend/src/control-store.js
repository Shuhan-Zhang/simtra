import { createRunStore } from "./research.js";
export const controlStore = demo => createRunStore(demo ? "simtra-control-demo-v1" : "simtra-control-v1");

// Separate lightweight records: never duplicate 10,000 personas on every log event.
export function createControlWriter(demo=false) {
  const store=controlStore(demo); let latest=null,timer=null,queue=Promise.resolve();
  function flush() {
    clearTimeout(timer);timer=null;
    if(latest){const row=latest;latest=null;queue=queue.catch(()=>{}).then(()=>store.save(row));}
    return queue;
  }
  return {
    write(record){if(latest&&latest.id!==record.id)flush().catch(()=>{});latest=structuredClone(record);if(!timer)timer=setTimeout(()=>flush().catch(()=>{}),200);},
    flush,
  };
}

export function controlRecordFromRun(run) {
  return {id:run.controlId || run.id,createdAt:run.createdAt,updatedAt:run.createdAt,status:"completed",question:run.experiment.decision,
    city:run.city,model:run.model,population:run.residents.length,fixture:run.fixture,experiment:run.experiment,
    events:run.executionLog || [],trace:run.trace,runId:run.id,scenarios:run.scenarios.map((s,i)=>({
      scenario:run.experiment.scenarios[i],distribution:s.result.p_distribution,archetypes:s.response_groups?.length,
      coveredResidents:s.response_groups?.reduce((n,g)=>n+g.agent_ids.length,0),
    }))};
}
