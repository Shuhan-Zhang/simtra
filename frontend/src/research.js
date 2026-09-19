// Pure experiment definitions and comparisons. No inferred prices or model answers.
export const MEASURES = {
  intent: { label: "Purchase intent", question: "Would you buy this product at least once in the next 30 days?", options: ["Would buy", "Would not buy"], indices: [0], metric: "Would buy in the next 30 days" },
  frequency: { label: "Purchase frequency", question: "How often would you buy this product in the next 30 days?", options: ["No purchases", "1 purchase", "2–3 purchases", "4 or more purchases"], indices: [2, 3], metric: "Would buy at least twice in 30 days" },
  custom: { label: "Custom yes/no measure", question: "", options: ["Yes", "No"], indices: [0], metric: "Estimated yes response" },
};
export function buildExperiment(draft) {
  const measure = MEASURES[draft.measure];
  if (!measure) throw new Error("Choose what you want to measure.");
  if (!draft.decision?.trim()) throw new Error("Describe the decision you want to make.");
  if (!draft.question?.trim()) throw new Error("Add a specific measurement question.");
  if (!draft.assumptions?.trim()) throw new Error("Add the assumptions shared by every scenario.");
  let scenarios;
  if (draft.kind === "price") {
    const prices = [draft.current, draft.middle, draft.proposed].map(Number);
    if (prices.some(n => !Number.isFinite(n) || n <= 0)) throw new Error("Enter a current price and two positive comparison prices.");
    if (new Set(prices.map(n => n.toFixed(2))).size !== 3) throw new Error("Use three distinct prices.");
    if (!draft.product?.trim()) throw new Error("Name the product and serving size being priced.");
    scenarios = prices.map((price, i) => ({
      label: i === 0 ? "Current price" : `${price >= prices[0] ? "+" : ""}${Number(((price / prices[0] - 1) * 100).toFixed(1))}% price`,
      description: `${draft.product.trim()}. Price: $${price.toFixed(2)} USD per purchase.`, price,
    }));
  } else {
    scenarios = draft.scenarios.map(s => ({ label: s.label.trim(), description: s.description.trim() }));
    if (scenarios.some(s => !s.label || !s.description)) throw new Error("Describe the baseline and both alternatives.");
    if (new Set(scenarios.map(s => s.label.toLowerCase())).size !== scenarios.length || new Set(scenarios.map(s => s.description.toLowerCase())).size !== scenarios.length) throw new Error("Give every scenario a distinct label and description.");
  }
  return { decision: draft.decision.trim(), question: draft.question.trim(), assumptions: draft.assumptions.trim(), options: [...measure.options], metric: measure.metric, indices: [...measure.indices], scenarios };
}
export function metricShare(probabilities, indices) {
  if (!Array.isArray(probabilities) || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1) || indices.some(i => !Number.isFinite(probabilities[i]))) return null;
  return indices.reduce((sum, i) => sum + probabilities[i], 0);
}
export function scenarioShare(scenario, indices) {
  return metricShare(scenario?.result?.p_distribution?.map(d => d[1]), indices);
}
export function segmentRows(run, dimension) {
  const maps = run.scenarios.map(s => new Map((s.result.option_breakdowns?.find(b => b.dimension === dimension)?.groups || []).map(g => [g.key, g])));
  return [...new Set(maps.flatMap(m => [...m.keys()]))].map(key => {
    const groups = maps.map(m => m.get(key));
    const shares = groups.map(g => g ? metricShare(g.shares, run.experiment.indices) : null);
    return { key, n: groups[0]?.n ?? 0, shares, delta: shares[0] == null || shares.at(-1) == null ? null : shares.at(-1) - shares[0] };
  });
}
export function responseFor(scenario, id) {
  return scenario?.response_groups?.find(g => g.agent_ids.includes(Number(id))) || null;
}
export function refineDraft(run, action) {
  const draft = structuredClone(run.draft);
  if (action === "smaller" && draft.kind === "price") {
    const current = Number(draft.current), proposed = Number(draft.proposed);
    draft.proposed = (current + (proposed - current) / 2).toFixed(2);
    draft.middle = (current + (proposed - current) / 4).toFixed(2);
    draft.decision = `Would a smaller price ${proposed >= current ? "increase" : "change"} work for ${draft.product}?`;
  } else if (action === "offer") {
    draft.kind = "custom";
    draft.decision = `How would an alternative offer change the response?`;
    draft.scenarios = [{ ...run.experiment.scenarios[0] }, { ...run.experiment.scenarios.at(-1) }, { label: "Value-meal offer", description: "" }];
  }
  return draft;
}

// Save the actual sampled residents as well as estimates, so a reload or audience
// change never attaches past answers to new residents. Storage failure is surfaced.
export function createRunStore(name = "simtra-research-v1") {
  let dbPromise;
  const db = () => dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("runs", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return {
    async list() {
      const database = await db();
      return new Promise((resolve, reject) => {
        const req = database.transaction("runs").objectStore("runs").getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        req.onerror = () => reject(req.error);
      });
    },
    async save(run) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction("runs", "readwrite");
        tx.objectStore("runs").put(structuredClone(run));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Save aborted"));
      });
    },
  };
}
