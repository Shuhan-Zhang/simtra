// Preserve historical provider labels while describing Jev output honestly.
export function rationaleLabel(rationales, exposed = false) {
  return rationales.length > 0 && rationales.every((s) => /^Jev-selected factor \(template\):/.test(s))
    ? "Modeled factors · not resident quotes"
    : exposed ? "simulated responses after exposure" : "simulated responses from this audience";
}
export function estimateLabel(result) {
  if (result.fixture_mode || result.preview_mode) return "Offline fixture · not a live prediction";
  return String(result.model || "").startsWith("jev-") ? "Jev model estimate" : "Model estimate";
}

export function factorText(value) {
  return String(value || '').replace(/^Jev-selected factor \(template\):\s*/, '').replace(/\s*\[Jev-selected template\]$/, '');
}
