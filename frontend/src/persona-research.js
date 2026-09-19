// Data-only audience research. This module never calls scenario/poll endpoints.
import { BASE, BACKEND_SETUP_MESSAGE } from './config.js';

export const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function sourceUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function makeResearchRequest(values, { maxSources = 8, panelId, carriedSources = [] } = {}) {
  const question = String(values.question || '').trim();
  const business = String(values.business || '').trim();
  const size = Number(values.panel_size);
  if (question.length < 8 || !business) throw new Error('Enter a research question of at least 8 characters and a business.');
  if (!Number.isInteger(size) || size < 2 || size > 12) throw new Error('Choose a panel size from 2 to 12.');
  const urls = [...new Set(String(values.urls || '').split(/\n/).map(s => s.trim()).filter(Boolean))];
  const sources = [...carriedSources, ...urls.map(url => {
    if (!sourceUrl(url)) throw new Error('Each source URL must be a complete http:// or https:// link without credentials.');
    const host = new URL(url).hostname;
    return { url, kind: /(^|\.)reddit\.com$/.test(host) ? 'reddit' : /(^|\.)(x|twitter)\.com$/.test(host) ? 'x' : 'web' };
  })];
  const text = String(values.evidence || '').trim();
  if (text) sources.push({ text, title: String(values.evidence_title || '').trim() || 'Owner-supplied research excerpt', kind: ['web', 'review', 'reddit', 'x', 'interview'].includes(values.evidence_kind) ? values.evidence_kind : 'interview' });
  if (sources.length > maxSources) throw new Error(`Use at most ${maxSources} sources, including retained evidence and the pasted excerpt.`);
  return { question, business, location: String(values.location || '').trim(), panel_size: size, sources, discover: values.discover === true || values.discover === 'on', founder_context: String(values.founder_context || '').trim(), ...(panelId ? { panel_id: panelId } : {}) };
}

export function retainedResearchInputs(panel) {
  return {
    sources: (panel.sources || []).filter(s => s.kind !== 'founder').map(s => {
      const kind = String(s.kind || 'web').replace(/^(fetched_|pasted_)/, '');
      return { text: s.text, ...(sourceUrl(s.url) ? { url: s.url } : {}), title: s.title, kind: ['web', 'review', 'reddit', 'x', 'interview', 'official'].includes(kind) ? kind : 'web' };
    }),
    founderContext: (panel.sources || []).filter(s => s.kind === 'founder').map(s => s.text).join('\n\n'),
  };
}

export async function researchRequest(path, { body, base = BASE, fetcher = globalThis.fetch, timeout = 165000 } = {}) {
  if (!base) throw new Error(BACKEND_SETUP_MESSAGE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(`${base}/audience-research${path}`, { method: body ? 'POST' : 'GET', signal: controller.signal, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Research request failed (${response.status}). Check the research backend and retry.`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Research is taking longer than expected. Refresh saved panels before retrying; a version may already have been saved.');
    throw error;
  } finally { clearTimeout(timer); }
}

const list = (items) => `<ul>${items.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul>`;
const provenanceLabels = new Set(['sourced', 'founder-provided', 'inferred', 'unknown']);
export function renderResearchPanel(panel, latestVersion = panel.version) {
  const sources = panel.sources || [];
  const byId = new Map(sources.map(s => [s.id, s]));
  const sourceIndex = new Map(sources.map((s, i) => [s.id, i + 1]));
  const personas = panel.personas || [];
  const maxVersion = Math.max(Number(panel.version) || 1, Number(latestVersion) || 1);
  const versionNumbers = [...new Set([Number(panel.version) || 1, ...Array.from({ length: Math.min(maxVersion, 100) }, (_, i) => maxVersion - i)])].sort((a, b) => b - a);
  const attributeHtml = a => {
    const provenance = provenanceLabels.has(a.provenance) ? a.provenance : 'unknown';
    return `<div class="pr-attribute"><dt>${escapeText(a.key === 'customer_statement' ? 'source excerpt' : a.key.replaceAll('_', ' '))}<span class="pr-tag pr-tag-${provenance}">${provenance}</span></dt><dd>${escapeText(a.value ?? 'Unknown — no supported value')}${(a.evidence || []).map(e => `<details><summary>Evidence ${escapeText(sourceIndex.has(e.source_id) ? `[${sourceIndex.get(e.source_id)}]` : '[unresolved source]')}</summary><p>${escapeText(byId.get(e.source_id)?.title || 'Source unavailable')}</p><blockquote>${escapeText(e.excerpt)}</blockquote></details>`).join('')}</dd></div>`;
  };
  const personaHtml = p => {
    const unknown = (p.attributes || []).filter(a => a.value == null || a.provenance === 'unknown' || !provenanceLabels.has(a.provenance));
    const known = (p.attributes || []).filter(a => !unknown.includes(a));
    return `<article class="pr-persona"><h4>${escapeText(p.label)}</h4><dl>${known.map(attributeHtml).join('')}</dl>${unknown.length ? `<details class="pr-unknown"><summary>${unknown.length} unknown ${unknown.length === 1 ? 'attribute' : 'attributes'}</summary><dl>${unknown.map(attributeHtml).join('')}</dl></details>` : ''}</article>`;
  };
  return `<header class="pr-result-header"><span class="pr-kicker">Saved panel · version ${escapeText(panel.version)}</span><h3>${escapeText(panel.business)}</h3><p>${escapeText(panel.question)}</p><p class="pr-muted">${escapeText(panel.location || 'Location not specified')} · ${personas.length} research ${personas.length === 1 ? 'profile' : 'profiles'} · ${escapeText(panel.status === 'needs_evidence' ? 'Needs evidence' : 'Draft — review before use')}</p><label>Saved version<select id="pr-version" aria-label="Saved panel version">${versionNumbers.map(v => `<option value="${v}"${v === panel.version ? ' selected' : ''}>Version ${v}${v === maxVersion ? ' · latest' : ''}</option>`).join('')}</select></label><div class="pr-actions"><button type="button" data-pr-action="export">Export JSON</button><button type="button" data-pr-action="revise">Create next version</button></div></header>
  <p class="pr-notice">Synthetic research profiles, not verified individual customers or a representative population sample. No scenario has been evaluated.</p>
  ${(panel.conflicts || []).length ? `<section class="pr-warning"><h4>Conflicting evidence</h4>${panel.conflicts.map(c => `<p><strong>${escapeText(c.attribute)}</strong></p>${list(c.values || [])}<p>Sources: ${(c.source_ids || []).map(id => escapeText(sourceIndex.has(id) ? `[${sourceIndex.get(id)}]` : id)).join(', ')}</p>`).join('')}</section>` : ''}
  <section><h4>Audience profiles</h4>${personas.length ? personas.map(personaHtml).join('') : '<p>No supported profiles yet. Add customer evidence to create the next version.</p>'}</section>
  ${(panel.gaps || []).length ? `<details class="pr-warning"><summary>Missing information · ${panel.gaps.length}</summary>${list(panel.gaps)}</details>` : ''}
  ${(panel.warnings || []).length ? `<details class="pr-method"><summary>Research limitations · ${panel.warnings.length}</summary>${list(panel.warnings)}</details>` : ''}
  <section><h4>Sources &amp; lineage</h4>${sources.length ? sources.map((s, i) => `<details class="pr-source"><summary>[${i + 1}] ${escapeText(s.title || s.url || s.kind)}</summary><p>${escapeText(s.kind)} · retrieved ${escapeText(s.retrieved_at || 'date unavailable')}</p>${sourceUrl(s.url) ? `<a href="${escapeText(sourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>` : '<p>Supplied excerpt; no public URL.</p>'}<blockquote>${escapeText(s.text)}</blockquote><small>Content hash: ${escapeText(s.content_hash)}</small></details>`).join('') : '<p>No sources collected.</p>'}</section>
  <details class="pr-method"><summary>Methodology &amp; panel identity</summary><pre>${escapeText(typeof panel.methodology === 'string' ? panel.methodology : JSON.stringify(panel.methodology, null, 2))}</pre><p>ID: ${escapeText(panel.id)} · version ${escapeText(panel.version)}</p><p>Saved: ${escapeText(panel.created_at)}</p><p>Content hash: ${escapeText(panel.content_hash)}</p></details>`;
}

export function mountPersonaResearch() {
  const trigger = document.createElement('button');
  trigger.className = 'pr-trigger'; trigger.type = 'button'; trigger.textContent = '＋ Build audience'; trigger.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.className = 'pr-dialog'; dialog.setAttribute('aria-labelledby', 'pr-title');
  dialog.innerHTML = `<header class="pr-head"><div><span class="pr-kicker">Simtra · audience research</span><h2 id="pr-title">Build the right audience.</h2></div><button type="button" data-pr-action="close" aria-label="Close audience research">×</button></header><p class="pr-intro">Turn a business question and customer evidence into a reusable research panel. Keep facts, assumptions, and gaps visible.</p>
  <p id="pr-config" class="pr-notice" role="status">Checking research services…</p><div class="pr-layout"><section><form id="pr-form"><fieldset id="pr-fields"><label>Research question<textarea name="question" required minlength="8" maxlength="2000" rows="3" placeholder="What matters to Chipotle customers when choosing a lunch option?"></textarea></label><div class="pr-row"><label>Business / product<input name="business" required maxlength="160" placeholder="Chipotle"></label><label>Location / market<input name="location" maxlength="200" placeholder="San Francisco"></label></div><label>Maximum panel size<input name="panel_size" type="number" min="2" max="12" value="6" required></label><p class="pr-muted">We only create profiles supported by the available evidence; the panel may be smaller.</p>
  <p id="pr-retained" class="pr-muted"></p><button type="button" data-pr-action="clear-evidence" hidden>Remove retained evidence</button><label>Source URLs · one per line<textarea name="urls" rows="3" placeholder="https://…"></textarea></label><p class="pr-muted">Use relevant menu/pricing pages, public discussions, or reviews. Some sites block access; paste an excerpt when needed. Up to 8 sources total.</p>
  <details class="pr-input-details"><summary>Add customer evidence</summary><label>Source description<input name="evidence_title" maxlength="240" placeholder="Customer interviews, September 2026"></label><label>Evidence type<select name="evidence_kind"><option value="interview">Customer interview</option><option value="review">Review</option><option value="reddit">Reddit discussion</option><option value="x">X post</option><option value="web">Web page</option></select></label><label>Verbatim evidence<textarea name="evidence" rows="5" maxlength="12000" placeholder="Paste relevant excerpts; remove names, handles, emails, and other personal details."></textarea></label></details>
  <label>Founder / owner context<textarea name="founder_context" rows="3" maxlength="8000" placeholder="What you know about your customers. This stays labeled founder-provided."></textarea></label><label class="pr-check"><input name="discover" type="checkbox" disabled> Discover additional public sources</label><p id="pr-search-status" class="pr-muted">Checking search configuration…</p><p id="pr-version-note" class="pr-muted"></p><button class="pr-primary" id="pr-build" type="submit">Build research panel</button><button type="button" data-pr-action="new" hidden>Start a separate panel</button></fieldset></form><p id="pr-progress" role="status" aria-live="polite"></p><p id="pr-error" role="alert" hidden></p><section class="pr-history"><div class="pr-actions"><h3>Saved panels</h3><button type="button" data-pr-action="refresh">Refresh</button></div><p id="pr-history-status" class="pr-muted"></p><div id="pr-history"></div></section></section><section id="pr-result" aria-label="Research panel"><div class="pr-empty"><span aria-hidden="true">▦</span><h3>Evidence before personas.</h3><p>Your saved panel will show relevant customer attributes, source excerpts, conflicting information, and what we still don’t know.</p><p>Research only. This does not change the city’s residents or run a prediction.</p></div></section></div>`;
  document.body.append(trigger, dialog);
  const q = selector => dialog.querySelector(selector);
  const form = q('#pr-form');
  const lockIdentity = locked => { for (const name of ['question', 'business', 'location']) form.elements[name].readOnly = locked; };
  let config = null; let selected = null; let panelId; let busy = false; let carriedSources = []; const latestVersions = new Map();
  const error = message => { q('#pr-error').textContent = message || ''; q('#pr-error').hidden = !message; };
  const showPanel = panel => { selected = panel; latestVersions.set(panel.id, Math.max(latestVersions.get(panel.id) || 1, panel.version)); q('#pr-result').innerHTML = renderResearchPanel(panel, latestVersions.get(panel.id)); };
  async function loadHistory() {
    q('#pr-history-status').textContent = 'Loading saved panels…';
    try {
      const data = await researchRequest('/panels');
      const panels = data.panels || []; q('#pr-history').replaceChildren();
      for (const panel of panels) { latestVersions.set(panel.id, Math.max(latestVersions.get(panel.id) || 1, panel.version)); const button = document.createElement('button'); button.type = 'button'; button.textContent = `${panel.business} · v${panel.version} · ${(panel.personas || []).length} ${(panel.personas || []).length === 1 ? 'profile' : 'profiles'}`; button.title = panel.question; button.addEventListener('click', async () => { error(''); try { showPanel(await researchRequest(`/panels/${encodeURIComponent(panel.id)}?version=${panel.version}`)); } catch (e) { error(e.message); } }); q('#pr-history').append(button); }
      q('#pr-history-status').textContent = panels.length ? `${panels.length} saved ${panels.length === 1 ? 'panel' : 'panels'}` : 'No saved panels yet.';
    } catch (e) { q('#pr-history-status').textContent = `Saved panels unavailable: ${e.message}`; }
  }
  async function loadConfig() {
    try {
      config = await researchRequest('/config');
      q('#pr-config').textContent = config.jev_configured ? 'Jev available for structured attribute classification. Research profiles require review.' : 'Jev is not configured. Evidence can still be collected; unsupported attributes remain unknown.';
      form.elements.discover.disabled = !config.search_configured;
      q('#pr-search-status').textContent = config.search_configured ? 'Automatic discovery is ready. Powered by ' : 'Automatic discovery is not configured. Add source URLs or paste evidence to begin.';
      if (config.search_configured) {
        const attribution = document.createElement('a'); attribution.href = 'https://brave.com/search/api/'; attribution.textContent = 'Brave Search'; attribution.target = '_blank'; attribution.rel = 'noopener noreferrer';
        q('#pr-search-status').append(attribution, '. Discovery is optional and does not bypass site restrictions.');
      }
    } catch (e) { config = null; q('#pr-config').textContent = `Research service unavailable: ${e.message}`; q('#pr-search-status').textContent = 'Discovery unavailable until the research backend is connected.'; }
  }
  trigger.addEventListener('click', () => { dialog.showModal(); if (!config) loadConfig(); loadHistory(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; error('');
    let body; try { body = makeResearchRequest(Object.fromEntries(new FormData(form)), { maxSources: config?.max_sources || 8, panelId, carriedSources }); } catch (e) { error(e.message); return; }
    busy = true; q('#pr-fields').disabled = true; q('#pr-build').textContent = 'Building…'; q('#pr-progress').textContent = 'Collecting sources, assembling supported attributes, and saving the panel. This can take a minute.';
    try { const panel = await researchRequest('/panels', { body }); showPanel(panel); q('#pr-progress').textContent = `Saved version ${panel.version}. Review the evidence and gaps before handing off this panel.`; panelId = panel.id; lockIdentity(true); q('#pr-version-note').textContent = `Next build saves a new version of this panel. Question, business, and location stay fixed; start a separate panel to change them.`; q('[data-pr-action="new"]').hidden = false; await loadHistory(); } catch (e) { error(e.message); q('#pr-progress').textContent = 'Panel creation was not confirmed. Your inputs are preserved.'; } finally { busy = false; q('#pr-fields').disabled = false; form.elements.discover.disabled = !config?.search_configured; q('#pr-build').textContent = panelId ? 'Save next panel version' : 'Build research panel'; }
  });
  dialog.addEventListener('change', async event => {
    if (event.target.id === 'pr-version' && selected) {
      error(''); const id = selected.id; const version = event.target.value;
      try { showPanel(await researchRequest(`/panels/${encodeURIComponent(id)}?version=${version}`)); } catch (e) { error(e.message); }
    }
  });
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-pr-action]')?.dataset.prAction;
    if (action === 'close') dialog.close();
    if (action === 'refresh') loadHistory();
    if (action === 'clear-evidence' && !busy) { carriedSources = []; q('#pr-retained').textContent = ''; q('[data-pr-action="clear-evidence"]').hidden = true; }
    if (action === 'new' && !busy) { panelId = undefined; lockIdentity(false); carriedSources = []; q('#pr-retained').textContent = ''; q('[data-pr-action="clear-evidence"]').hidden = true; q('#pr-version-note').textContent = ''; q('#pr-build').textContent = 'Build research panel'; q('[data-pr-action="new"]').hidden = true; }
    if (action === 'revise' && selected && !busy) {
      panelId = selected.id; lockIdentity(true);
      const retained = retainedResearchInputs(selected); carriedSources = retained.sources;
      for (const name of ['question', 'business', 'location']) form.elements[name].value = selected[name] || '';
      form.elements.urls.value = ''; form.elements.evidence.value = ''; form.elements.evidence_title.value = '';
      form.elements.founder_context.value = retained.founderContext;
      form.elements.panel_size.value = Math.max(2, selected.personas?.length || 6);
      form.elements.discover.checked = false;
      q('#pr-retained').textContent = `${carriedSources.length} source snapshots retained from version ${selected.version}. These are saved excerpts, not freshly fetched pages. Add URLs below for new research, or remove retained evidence to start fresh.`;
      q('[data-pr-action="clear-evidence"]').hidden = !carriedSources.length;
      q('#pr-version-note').textContent = `Next build creates an immutable new version of panel ${selected.id}. Existing versions are preserved. Start a separate panel to change the question, business, or location.`;
      q('[data-pr-action="new"]').hidden = false; q('#pr-build').textContent = 'Save next panel version'; form.elements.question.focus();
    }
    if (action === 'export' && selected) { const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `simtra-audience-${String(selected.id).replace(/[^a-zA-Z0-9_-]/g, '')}-v${selected.version}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  return { dialog, trigger };
}
if (typeof document !== 'undefined') mountPersonaResearch();
