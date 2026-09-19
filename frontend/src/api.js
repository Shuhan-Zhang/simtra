// ─────────────────────────────────────────────────────────────────────────
// Thin client over the SF Digital Twin backend (see INTEGRATION.md).
// Every call has a timeout and throws a readable Error on non-2xx.
// ─────────────────────────────────────────────────────────────────────────

import { BASE, SIM, PREDICT, BACKEND_SETUP_MESSAGE } from "./config.js";
import { readExecutionStream } from "./execution-log.js";
import { workspaceHeaders } from "./workspace.js?v=2";

async function req(path, { method = "GET", body, timeout = 30000, signal } = {}) {
  if (isDemo && path === "/data-query") return {
    status:"unsupported", question:body.question, answer:null, chart:null, query_spec:null,
    geography:null, source:null, method:null,
    limitations:["Offline simulation demo has no verified-data query service."],
  };
  if (isDemo) return demoRequest(path, { method, body, signal });
  if (!BASE) throw new Error(BACKEND_SETUP_MESSAGE);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  // honor an external abort signal (user cancellation) in addition to the timeout
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...workspaceHeaders(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.error || data?.message || text || res.statusText;
      const error = new Error(`${method} ${path} → ${res.status}: ${msg}`);
      error.status = res.status;
      error.path = path;
      error.trace = data.trace;
      error.serverMessage = data?.error || data?.message || "";
      throw error;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${method} ${path} timed out`);
    if (e instanceof TypeError) throw new Error("Cannot reach the live backend. Start the local API server and configure TYPESAFE_API_KEY. No demo results were substituted.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Schema 1.0 statistical queries never call parse/poll or use preview fixtures.
export const dataQuery = (city, question, signal, { record = true } = {}) =>
  req("/data-query", { method:"POST", body:{city, question, ...(record ? {} : { record: false })}, signal, timeout:60000 });

export const health = () => req("/health", { timeout: 8000 });
export const seedWorkspace = () => req("/workspace/seed", { method: "POST", body: {}, timeout: 90000 });

// Persisted prediction history from InsForge. The Rust backend keeps the
// InsForge admin key server-side and returns only stored result data here.
export const getPredictionResults = (city, limit = 25) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (city) params.set("city", city);
  return req(`/prediction-results?${params.toString()}`, { timeout: 12000 });
};

// Multi-city catalog. Returns { cities: [{slug, display, prompt_name, bbox, n_pums, knowledge_date, default}] }.
export const getCities = () => req("/cities", { timeout: 12000 });

// Recent news for a city's bubble. Returns { city, date, articles:[{headline, summary, url}] }.
export const getNews = (city) =>
  req(`/cities/${encodeURIComponent(city)}/news`, { timeout: 10000 });

// Ambient Jev-selected template chatter for the residents currently on screen (sparse + batched).
// Returns { chatter: { "<agentId>": "<thought>", ... } }.
export const getChatter = (branchId, ids) =>
  req(`/branches/${encodeURIComponent(branchId)}/chatter`, {
    method: "POST",
    body: { ids },
    timeout: 15000,
  });

// Classify a free-form question for a city before polling. Returns either
// { supported:true, framing, question, description, options } or
// { supported:false, reason, examples }.
export const parseQuestion = (city, question, signal) =>
  req(`/cities/${encodeURIComponent(city)}/parse`, {
    method: "POST",
    body: { question, model: PREDICT.model },
    timeout: 60000,
    signal,
  });

// Turn 1–2 downscaled images into neutral stimulus attributes with the server's
// vision model. Returns { stimuli:[{kind, summary, attributes, unknowns}], provider }.
export const describeStimulus = (city, images, question, signal) =>
  req(`/cities/${encodeURIComponent(city)}/stimulus`, {
    method: "POST",
    body: { images, ...(question ? { question } : {}) },
    timeout: 90000,
    signal,
  });

// `city` rides along in the body (defaults to "sf" server-side when omitted).
export const createSimulation = (overrides = {}) =>
  req("/simulations", { method: "POST", body: { ...SIM, ...overrides }, timeout: 60000 });

// Page through every alive agent on a branch. Returns [{id, name, lonlat, values, ...}].
// `cap` is only a runaway guard; the real bound is the branch's total_matched,
// which we learn from the first page — so we never silently drop agents.
export async function getAllAgents(branchId, onProgress, cap = 50000) {
  const limit = 1000;
  let offset = 0;
  const out = [];
  while (offset < cap) {
    const page = await req(`/branches/${encodeURIComponent(branchId)}/agents?limit=${limit}&offset=${offset}`, { timeout: 30000 });
    const batch = page.agents || [];
    out.push(...batch);
    const total = page.total_matched ?? out.length;
    offset += limit;
    if (onProgress) onProgress(out.length, total);
    if (out.length >= total || batch.length < limit) break;
  }
  return out;
}

// "Trigger the branching": clone main, optionally broadcast an event, run a
// couple ticks so the branch reflects it.
export const createBranch = (simId, { ticks = PREDICT.branch_ticks, event, name, signal } = {}) =>
  req(`/simulations/${encodeURIComponent(simId)}/branches`, {
    method: "POST",
    body: { ticks, ...(event ? { event } : {}), ...(name ? { name } : {}) },
    timeout: 90000,
    signal,
  });

// Poll the synthetic electorate using batched Jev decisions.
export const poll = (branchId, payload, signal) =>
  req(`/branches/${encodeURIComponent(branchId)}/poll`, {
    method: "POST",
    body: { ...payload, model: PREDICT.model },
    timeout: 180000,
    signal,
  });

export async function compareScenarios(branchId, payload, signal, onLog = () => {}) {
  if (isDemo) {
    const event = { kind:"demo.fixture", elapsed_ms:0, message:"DEMO: fixed illustrative responses loaded. Zero model requests, zero resident evaluations.", details:{fixture:true} };
    onLog(event);
    const result = await req(`/branches/${encodeURIComponent(branchId)}/research`, { method:"POST", body:payload, signal });
    return { ...result, trace:{provider_requests:0,cache_hits:0,events:[event]} };
  }
  if (!BASE) throw new Error(BACKEND_SETUP_MESSAGE);
  const controller = new AbortController(), cancel = () => controller.abort();
  const timer = setTimeout(cancel, 540000);
  if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once:true });
  try {
    const response = await fetch(`${BASE}/branches/${encodeURIComponent(branchId)}/research/stream`, {
      method:"POST", headers:{...workspaceHeaders(),"content-type":"application/json"}, body:JSON.stringify({...payload,model:PREDICT.model}), signal:controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Experiment backend returned HTTP ${response.status}.`);
      error.status = response.status; error.serverMessage = data.error || ""; error.trace = data.trace; throw error;
    }
    if (!response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("The backend needs the updated streaming experiment endpoint.");
    return await readExecutionStream(response, onLog);
  } catch (error) {
    if (error.name === "AbortError") throw new Error(signal?.aborted ? "Experiment cancelled." : "Experiment timed out. No complete result was saved.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

// Planning selects a recipe; automatic comparison follows once the recipe is valid.
export const proposeExperiment = (city, question, signal) =>
  req(`/cities/${encodeURIComponent(city)}/experiment-plan`, { method: "POST", body: { question, city }, signal, timeout: 60000 });

// Missing or failed live endpoints are errors. Saved fixtures are available
// only through the explicitly labeled ?demo=1 mode in req().
export const abTest = (branchId, payload, signal) =>
  req(`/branches/${encodeURIComponent(branchId)}/ab-test`, {
    method: "POST", body: { ...payload, model: PREDICT.model }, timeout: 180000, signal,
  });

// Compare a baseline binary poll with simulated exposure to planned marketing copy.
// Returns { baseline, exposed, delta } where delta is exposed.p_yes - baseline.p_yes.
export const counterfactual = (branchId, payload, signal) =>
  req(`/branches/${encodeURIComponent(branchId)}/counterfactual`, {
    method: "POST",
    body: { ...payload, model: PREDICT.model },
    timeout: 360000,
    signal,
  });

// persona memory: a recorded test, every resident's answer to it, one resident's full persona
export const getTest = (testId) => req(`/tests/${encodeURIComponent(testId)}`, { timeout: 20000 });
export const getTestAnswers = (testId) => req(`/tests/${encodeURIComponent(testId)}/answers`, { timeout: 30000 });
export const postPersonalAnswers = (testId, body) =>
  req(`/tests/${encodeURIComponent(testId)}/personal-answers`, { method: "POST", body, timeout: 90000 });
export const getAgentDetail = (branchId, agentId) => req(`/branches/${branchId}/agents/${agentId}`, { timeout: 12000 });

export const deleteBranch = (branchId) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("simtra:branch-deleted", { detail: { branchId } }));
  return req(`/branches/${encodeURIComponent(branchId)}`, { method: "DELETE", timeout: 15000 })
    .catch(() => {}); // best-effort cleanup
};

// Explicit offline demo. Every demographic and PWGTP value is from the saved
// backend response; probabilities are fixed test responses, never live answers.
export const isDemo = typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "1";
let demoData, demoSequence = 0;
const demoPopulations = new Map();
async function demoPopulation(entry) {
  const slug = entry.city.slug;
  if (!demoPopulations.has(slug)) {
    const pending = (async () => {
      const response = await fetch(new URL(`../fixtures/population-demo/${entry.file}`, import.meta.url));
      if (!response.ok) throw new Error(`Demo population unavailable: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Some static hosts decode Content-Encoding automatically, while the local
      // server serves the .gz file as bytes. Accept either without double decoding.
      const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
      const stream = new Blob([bytes]).stream();
      const row = await new Response(compressed ? stream.pipeThrough(new DecompressionStream("gzip")) : stream).json();
      if (row.agents.length !== entry.n_agents || new Set(row.agents.map(a => a.id)).size !== entry.n_agents) throw new Error("Demo population is incomplete");
      return row;
    })();
    demoPopulations.set(slug, pending);
    pending.catch(() => demoPopulations.delete(slug));
  }
  return demoPopulations.get(slug);
}
async function demoRequest(path, { method, body, signal }) {
  signal?.throwIfAborted();
  demoData ||= fetch(new URL("../fixtures/population-demo/manifest.json", import.meta.url)).then(async (r) => {
    if (!r.ok) throw new Error(`Demo fixture unavailable: ${r.status}`);
    return r.json();
  });
  const data = await demoData;
  signal?.throwIfAborted();
  const url = new URL(path, "http://local.invalid");
  const route = decodeURIComponent(url.pathname);
  if (route === "/cities") return { cities: structuredClone(data.cities.map(r => r.city)) };
  const slug = route.match(/demo:([^/:]+)/)?.[1] || route.match(/^\/cities\/([^/]+)/)?.[1] || body?.city || "sf";
  const entry = data.cities.find((entry) => entry.city.slug === slug);
  if (!entry) throw new Error(`No committed demo snapshot for ${slug}`);
  const row = await demoPopulation(entry);
  signal?.throwIfAborted();
  let result;
  if (route.endsWith("/news")) result = { articles: [] };
  else if (route.endsWith("/chatter")) result = { chatter: {} };
  else if (route.endsWith("/parse")) {
    const options = /which|choose|prioriti[sz]e/i.test(body.question);
    result = { supported: true, framing: options ? "options" : "vote", question: body.question,
      description: "Offline fixture demonstration; saved outcomes do not answer this question.",
      ...(options ? { options: row.options.p_distribution.map(([label]) => label) } : {}) };
  } else if (route.endsWith("/experiment-plan")) {
    const areas = [...new Set(row.agents.map(a => a.neighborhood).filter(Boolean))];
    const kind = /\b(price|prices|pricing)\b/i.test(body.question) ? "price" : /\b(launch\w*|marketplace|start a|open\w* a|business)\b/i.test(body.question) ? "launch" : "compare";
    result = { kind, measure: /frequen|repeat|often/i.test(body.question) ? "repeat" : kind === "compare" ? "support" : "trial",
      locations: areas.slice(0,2), available_locations: areas, source: "demo_recipe" };
  } else if (route === "/simulations") result = { simulation_id: `demo:${slug}`, main_branch: `demo:${slug}:main` };
  else if (route.startsWith("/simulations/") && route.endsWith("/branches")) result = { branch_id: `demo:${slug}:prediction:${++demoSequence}` };
  else if (route.endsWith("/agents")) {
    const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 1000);
    result = { agents: row.agents.slice(offset, offset + limit), total_matched: row.agents.length };
  } else if (route.endsWith("/research")) {
    // Explicitly illustrative fixed curves/rankings, never answers to the query.
    const fixtures = body.scenarios.length <= 3 ? [.67, .58, .45] : [.43, .61, .55, .38, .52, .49];
    result = { fixture_mode: true, context_policy: "explicit_assumptions_only", n_agents: row.agents.length,
      scenarios: body.scenarios.map((scenario, index) => {
        const p = body.scenarios.length>6 ? Math.max(.12,.72-(index%6)*.075-Math.floor(index/6)*.025) : fixtures[index];
        const probabilities = body.options.length === 2 ? [p, 1-p] : [(1-p)*.6, (1-p)*.4, p*.7, p*.3];
        return { scenario,
        result: { ...row.binary, question: body.question, p_distribution: body.options.map((o, i) => [o, probabilities[i]]),
          option_breakdowns: row.binary.option_breakdowns.map(b => ({ ...b, groups: b.groups.map(g => ({ ...g, shares: probabilities })) })) },
        response_groups: [{ agent_ids: row.agents.map(a => a.id), probabilities, archetype: "offline-fixture", factor: "Fixed demo response; no model evaluation." }],
      }; }) };
  } else if (route.endsWith("/poll")) result = body.framing === "options" ? row.options : row.binary;
  else if (route.endsWith("/counterfactual")) result = { baseline: row.binary, exposed: row.binary, delta: 0, fixture_mode: true };
  else if (route.endsWith("/ab-test")) result = { ...row.binary, ...body, a_share: row.binary.p_yes, b_share: 1-row.binary.p_yes,
    a_ci: [row.binary.ci_low,row.binary.ci_high], b_ci: [1-row.binary.ci_high,1-row.binary.ci_low], winner: "a", margin_pp: (2*row.binary.p_yes-1)*100,
    breakdowns: row.binary.option_breakdowns.map((b) => ({ ...b, groups: b.groups.map((g) => ({ ...g, a_share:g.shares[0], b_share:g.shares[1] })) })) };
  else if (method === "DELETE") result = { deleted: true };
  else throw new Error(`Unsupported offline fixture route: ${method} ${route}`);
  return structuredClone(result);
}

// Public geography only: no population, demand, or prediction estimates.
export const getLocations = (city = "sf", signal) =>
  req(`/cities/${encodeURIComponent(city)}/locations/areas`, { timeout: 12000, signal });
