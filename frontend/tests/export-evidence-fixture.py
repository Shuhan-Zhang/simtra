# Run tests/fixture-server.rs first. It clears real credentials and uses only a
# loopback Jev mock. This exports full seeded populations, not cloned small samples.
import gzip, json, urllib.request, hashlib
from pathlib import Path
base='http://127.0.0.1:5188'
root=Path(__file__).resolve().parents[2]
def req(path,body=None):
    data=None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'}),timeout=300) as r: return json.load(r)
cities=req('/cities')['cities']
target=root/'frontend/fixtures/population-demo'
target.mkdir(exist_ok=True)
out={'fixture_notice':'Seeded synthetic residents sampled from local Census/PUMS records. Outcomes are fixed loopback Jev fixture responses, not observed opinions or live predictions.','generator':{'seed':42,'n':10000,'population':'all','method':'Unmodified backend sampler, paginated agents and weighted poll aggregation. Model requests only to a loopback mock; no external evaluations.'},'cities':[]}
for city in cities:
    sim=req('/simulations',{'city':city['slug'],'n':10000,'seed':42,'start_datetime':'2026-09-19T08:00:00Z','tick_seconds':30,'commit_every':20})
    branch=sim['main_branch']
    agents=[]
    while len(agents)<10000:
        batch=req('/branches/'+branch+'/agents?limit=1000&offset='+str(len(agents)))['agents']
        if not batch: raise RuntimeError('Incomplete population for '+city['slug'])
        agents.extend(batch)
    assert len(agents)==10000 and len({a['id'] for a in agents})==10000
    print(city['slug'],'sampled',len(agents),'residents; aggregating fixture responses',flush=True)
    payload={'question':'Should the city expand public transit?','description':'A proposal to expand public transit.','framing':'vote','as_of_date':'2026-09-19','model':'jev-1.13.0','population':'all'}
    binary=req('/branches/'+branch+'/poll',payload)
    multi=req('/branches/'+branch+'/poll',{**payload,'question':'Which proposal should the city prioritize?','framing':'options','options':['Parks','Transit','Housing']})
    for result in [binary,multi]: result['fixture_mode']=True
    path=binary['evidence']['population_source']['local_snapshot']
    snapshot_hash=hashlib.sha256((root/path).read_bytes()).hexdigest()
    row={'city':city,'agents':agents,'binary':binary,'options':multi,'snapshot_sha256':snapshot_hash}
    filename=city['slug']+'.json.gz'
    encoded=gzip.compress(json.dumps(row,separators=(',',':')).encode(),mtime=0)
    (target/filename).write_bytes(encoded)
    out['cities'].append({'city':city,'file':filename,'n_agents':len(agents),'snapshot_sha256':snapshot_hash})
    print(city['slug'],'saved',len(encoded),'bytes',flush=True)
(target/'manifest.json').write_text(json.dumps(out,indent=2)+'\n')
