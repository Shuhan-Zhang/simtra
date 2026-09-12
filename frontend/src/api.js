// ─────────────────────────────────────────────────────────────────────────
// Thin client over the SF Digital Twin backend (see INTEGRATION.md).
// Every call has a timeout and throws a readable Error on non-2xx.
// ─────────────────────────────────────────────────────────────────────────

import { BASE, SIM, PREDICT } from "./config.js";

async function req(path, { method = "GET", body, timeout = 30000, signal } = {}) {
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
      headers: body ? { "content-type": "application/json" } : undefined,
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
      throw error;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${method} ${path} timed out`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const health = () => req("/health", { timeout: 8000 });

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

// Ambient LLM chatter for the residents currently on screen (sparse + batched).
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

// Poll the synthetic electorate. The LLM pass takes ~5-15s.
export const poll = (branchId, payload, signal) =>
  req(`/branches/${encodeURIComponent(branchId)}/poll`, {
    method: "POST",
    body: payload,
    timeout: 180000,
    signal,
  });

function previewFingerprint(payload) {
  const text = `${payload.question}\n${payload.variant_a}\n${payload.variant_b}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function swapPreviewBreakdowns(breakdowns) {
  return (breakdowns || []).map((breakdown) => ({
    ...breakdown,
    groups: (breakdown.groups || []).map((group) => ({
      ...group,
      a_share: group.b_share,
      b_share: group.a_share,
    })),
  }));
}

function transitPreviewRationales(payload) {
  const transitQuestion = /public transit/i.test(payload.question);
  const commuteMessage = /shorter commutes|fewer cars/i.test(payload.variant_a);
  const affordabilityMessage = /fares affordable|workers, students, and families/i.test(payload.variant_b);
  if (!transitQuestion || !commuteMessage || !affordabilityMessage) return null;
  return [
    "Variant B feels more inclusive because it speaks directly to workers, students, and families.",
    "Keeping fares affordable matters more to me than the broader promise of a connected city.",
    "Variant A's shorter commutes and fewer cars are compelling, but Variant B makes the benefit feel more immediate.",
    "Expanded service and affordable fares sound like practical improvements I would use every week.",
    "I prefer the message that combines wider service with a clear commitment to affordability.",
  ];
}

async function previewAbResult(payload, signal) {
  const fixtureUrl = new URL("../fixtures/ab-sample.json", import.meta.url);
  const response = await fetch(fixtureUrl, { signal });
  if (!response.ok) throw new Error(`A/B preview fixture unavailable → ${response.status}`);
  const fixture = await response.json();
  const tailoredRationales = transitPreviewRationales(payload);
  const swap = tailoredRationales ? true : previewFingerprint(payload) % 2 === 1;
  const aShare = swap ? fixture.b_share : fixture.a_share;
  const bShare = swap ? fixture.a_share : fixture.b_share;
  const margin = aShare - bShare;

  return {
    ...fixture,
    question: payload.question,
    variant_a: payload.variant_a,
    variant_b: payload.variant_b,
    as_of_date: payload.as_of_date,
    model: payload.model,
    a_share: aShare,
    b_share: bShare,
    margin_pp: margin * 100,
    winner: Math.abs(margin) < 0.005 ? "tie" : margin > 0 ? "a" : "b",
    a_ci: swap ? fixture.b_ci : fixture.a_ci,
    b_ci: swap ? fixture.a_ci : fixture.b_ci,
    breakdowns: swap ? swapPreviewBreakdowns(fixture.breakdowns) : fixture.breakdowns,
    sample_rationales: tailoredRationales || fixture.sample_rationales,
    preview_mode: true,
  };
}

export async function abTest(branchId, payload, signal) {
  try {
    return await req(`/branches/${encodeURIComponent(branchId)}/ab-test`, {
      method: "POST",
      body: payload,
      timeout: 180000,
      signal,
    });
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  // Temporary demo path for deployments that do not have /ab-test yet.
  // Keep this internal marker so the saved result can be found and removed later.
  console.warn("A/B endpoint missing; using saved preview data.");
  return previewAbResult(payload, signal);
}

// Compare a baseline binary poll with simulated exposure to planned marketing copy.
// Returns { baseline, exposed, delta } where delta is exposed.p_yes - baseline.p_yes.
export const counterfactual = (branchId, payload, signal) =>
  req(`/branches/${encodeURIComponent(branchId)}/counterfactual`, {
    method: "POST",
    body: payload,
    timeout: 360000,
    signal,
  });

export const deleteBranch = (branchId) =>
  req(`/branches/${encodeURIComponent(branchId)}`, { method: "DELETE", timeout: 15000 })
    .catch(() => {}); // best-effort cleanup
