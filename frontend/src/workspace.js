// A browser session scope for in-memory behavioral runs only. Existing news and
// prediction endpoints retain the repository's city-scoped memory contract.
const KEY = 'simtra.behavior.workspace';
function resolveRunWorkspace() {
  try {
    const saved = localStorage.getItem(KEY);
    if (/^[A-Za-z0-9_-]{1,32}$/.test(saved || '')) return saved;
  } catch {}
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  try { localStorage.setItem(KEY, id); } catch {}
  return id;
}
const workspace = resolveRunWorkspace();
export function workspaceHeaders() { return {'X-Simtra-Workspace': workspace}; }
