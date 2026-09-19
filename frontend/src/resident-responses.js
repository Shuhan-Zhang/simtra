import { factorText } from "./model-display.js";
// These labels follow exact response-group membership. They are never quotes or
// individual interviews; the inspector explains the inherited group estimate.
export function residentResponseLabels(groups, options) {
  const labels = new Map();
  for (const group of groups || []) {
    const probabilities = group.probabilities;
    if (!Array.isArray(probabilities) || probabilities.length !== options?.length || !probabilities.length || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) continue;
    if (Math.abs(probabilities.reduce((sum,p)=>sum+p,0)-1)>0.02) continue;
    const winner = probabilities.reduce((best,p,i)=>p>probabilities[best]?i:best,0);
    const factor = factorText(group.factor);
    const label = `${options[winner]} · ${(probabilities[winner]*100).toFixed(0)}%${factor ? ` · ${factor}` : ''}`;
    for (const id of group.agent_ids || []) labels.set(Number(id),label);
  }
  return labels;
}
