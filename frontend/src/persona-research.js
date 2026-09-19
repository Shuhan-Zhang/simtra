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

export async function researchRequest(path, { body, base = BASE, fetcher = globalThis.fetch, timeout = 165000, signal } = {}) {
  if (!base) throw new Error(BACKEND_SETUP_MESSAGE);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetcher(`${base}/audience-research${path}`, { method: body ? 'POST' : 'GET', signal: controller.signal, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Research request failed (${response.status}). Check the research backend and retry.`);
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Audience research cancelled', 'AbortError');
    if (error.name === 'AbortError') throw new Error('Research is taking longer than expected. Refresh saved panels before retrying; a version may already have been saved.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const list = (items) => `<ul>${items.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul>`;
const provenanceLabels = new Set(['sourced', 'founder-provided', 'inferred', 'unknown']);
export function renderResearchSummary(panel) {
  if (!panel?.id || !panel.question) return '';
  const sources = new Map((panel.sources || []).map(source => [source.id, source]));
  const labels = { needs: 'Need', objections: 'Objection', decision_criteria: 'Decision criterion', alternatives: 'Alternative', price_sensitivity: 'Price sensitivity', buying_situation: 'Buying situation', purchase_frequency: 'Purchase frequency', switching_conditions: 'Switching condition' };
  const profiles = (panel.personas || []).map(profile => {
    const attributes = (profile.attributes || []).flatMap(attribute => {
      if (!labels[attribute.key] || attribute.value == null || !provenanceLabels.has(attribute.provenance) || attribute.provenance === 'unknown') return [];
      const evidence = (attribute.evidence || []).filter(item => item.excerpt?.trim() && sources.get(item.source_id)?.text?.includes(item.excerpt));
      if (!evidence.length) return [];
      return [`<li><strong>${escapeText(labels[attribute.key])}:</strong> ${escapeText(attribute.value)} <span class="pr-tag">${escapeText(attribute.provenance)}</span><details><summary>Supporting evidence</summary>${evidence.map(item => {
        const source = sources.get(item.source_id), url = sourceUrl(source.url);
        return `<blockquote>${escapeText(item.excerpt)}</blockquote><p>${url ? `<a href="${escapeText(url)}" target="_blank" rel="noopener noreferrer">${escapeText(source.title || 'Source')}</a>` : escapeText(source.title || 'Saved evidence')} · ${escapeText(source.retrieved_at || 'Date unavailable')}</p>`;
      }).join('')}</details></li>`];
    });
    const unknowns = (profile.attributes || []).filter(a => a.value == null || a.provenance === 'unknown' || !provenanceLabels.has(a.provenance));
    return `<article><h4>${escapeText(profile.label)}</h4>${attributes.length ? `<ul>${attributes.join('')}</ul>` : '<p>No source-backed attributes available.</p>'}${unknowns.length ? `<p class="pr-muted">Unknown: ${unknowns.map(a => escapeText(a.key.replaceAll('_', ' '))).join(', ')}.</p>` : ''}</article>`;
  });
  return `<section class="research-summary" aria-label="Audience research summary"><h3>Audience research summary</h3><p>${escapeText(panel.business)} · saved panel v${escapeText(panel.version)}</p><p class="pr-muted">${escapeText(panel.question)}</p><p class="pr-muted">Synthetic research profiles, not verified customers. Context only; these profiles were not used to calculate the simulation results.</p>${profiles.length ? profiles.join('') : '<p>No supported audience profiles available.</p>'}${(panel.conflicts || []).length ? `<details open><summary>Conflicting evidence</summary>${panel.conflicts.map(c => `<p><strong>${escapeText(c.attribute)}</strong></p>${list(c.values || [])}`).join('')}</details>` : ''}${(panel.gaps || []).length ? `<details><summary>Missing information</summary>${list(panel.gaps)}</details>` : ''}${(panel.warnings || []).length ? `<details><summary>Research limitations</summary>${list(panel.warnings)}</details>` : ''}</section>`;
}

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
  const context = panel.question_context;
  const contextHtml = context ? `<section class="pr-notice"><h4>Understood from your question</h4><dl>${['business', 'topic', 'audience', 'market'].map(key => {
    const a = context[key] || {};
    return `<div class="pr-attribute"><dt>${escapeText(key)} <span class="pr-tag">${escapeText(a.provenance || 'unknown')}</span></dt><dd>${escapeText(a.value || 'Unknown — not identified')}${a.excerpt ? `<details><summary>Basis</summary><blockquote>${escapeText(a.excerpt)}</blockquote></details>` : ''}</dd></div>`;
  }).join('')}</dl></section>` : '';
  return `<header class="pr-result-header"><span class="pr-kicker">Saved panel · version ${escapeText(panel.version)}</span><h3>${escapeText(panel.business)}</h3><p>${escapeText(panel.question)}</p><p class="pr-muted">${escapeText(panel.location || 'Location not specified')} · ${personas.length} research ${personas.length === 1 ? 'profile' : 'profiles'} · ${escapeText(panel.status === 'needs_evidence' ? 'Needs evidence' : 'Draft — review before use')}</p><label>Saved version<select id="pr-version" aria-label="Saved panel version">${versionNumbers.map(v => `<option value="${v}"${v === panel.version ? ' selected' : ''}>Version ${v}${v === maxVersion ? ' · latest' : ''}</option>`).join('')}</select></label><div class="pr-actions"><button type="button" data-pr-action="export">Export JSON</button></div></header>
  ${renderResearchSummary(panel)}${contextHtml}<p class="pr-notice">Synthetic research profiles, not verified individual customers or a representative population sample. No scenario has been evaluated.</p>
  ${(panel.conflicts || []).length ? `<section class="pr-warning"><h4>Conflicting evidence</h4>${panel.conflicts.map(c => `<p><strong>${escapeText(c.attribute)}</strong></p>${list(c.values || [])}<p>Sources: ${(c.source_ids || []).map(id => escapeText(sourceIndex.has(id) ? `[${sourceIndex.get(id)}]` : id)).join(', ')}</p>`).join('')}</section>` : ''}
  <section><h4>Audience profiles</h4>${personas.length ? personas.map(personaHtml).join('') : '<p>No supported profiles yet. Review the gaps below and make your question more specific in the main input.</p>'}</section>
  ${(panel.gaps || []).length ? `<details class="pr-warning"><summary>Missing information · ${panel.gaps.length}</summary>${list(panel.gaps)}</details>` : ''}
  ${(panel.warnings || []).length ? `<details class="pr-method"><summary>Research limitations · ${panel.warnings.length}</summary>${list(panel.warnings)}</details>` : ''}
  <section><h4>Sources &amp; lineage</h4>${sources.length ? sources.map((s, i) => `<details class="pr-source"><summary>[${i + 1}] ${escapeText(s.title || s.url || s.kind)}</summary><p>${escapeText(s.kind)} · retrieved ${escapeText(s.retrieved_at || 'date unavailable')}</p>${sourceUrl(s.url) ? `<a href="${escapeText(sourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>` : '<p>Supplied excerpt; no public URL.</p>'}<blockquote>${escapeText(s.text)}</blockquote><small>Content hash: ${escapeText(s.content_hash)}</small></details>`).join('') : '<p>No sources collected.</p>'}</section>
  <details class="pr-method"><summary>Methodology &amp; panel identity</summary><pre>${escapeText(typeof panel.methodology === 'string' ? panel.methodology : JSON.stringify(panel.methodology, null, 2))}</pre><p>ID: ${escapeText(panel.id)} · version ${escapeText(panel.version)}</p><p>Saved: ${escapeText(panel.created_at)}</p><p>Content hash: ${escapeText(panel.content_hash)}</p></details>`;
}

export function mountPersonaResearch() {
  const trigger = document.createElement('button');
  trigger.className = 'pr-trigger'; trigger.type = 'button'; trigger.textContent = 'Audience research · automatic'; trigger.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.className = 'pr-dialog pr-readonly'; dialog.setAttribute('aria-labelledby', 'pr-title');
  dialog.innerHTML = `<header class="pr-head"><div><span class="pr-kicker">Simtra · audience research</span><h2 id="pr-title">Your audience research.</h2></div><button type="button" data-pr-action="close" aria-label="Close audience research">×</button></header>
    <p class="pr-intro">One question is enough. Simtra identifies its business, topic and audience, discovers public evidence, and saves supported profiles automatically.</p>
    <p id="pr-auto-status" class="pr-notice" role="status">Ask your question in the main city input. No research form to fill out.</p>
    <p class="pr-muted">Research profiles are context only. The current simulation still evaluates Census residents; these profiles do not replace them. Discovery powered by <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer">Brave Search</a>.</p>
    <p id="pr-error" role="alert" hidden></p>
    <section id="pr-result" aria-label="Research panel"><p class="pr-empty">Your audience, citations and missing information will appear here after you ask a question.</p></section>
    <details class="pr-history"><summary>Saved research</summary><p id="pr-history-status" class="pr-muted"></p><div id="pr-history"></div></details>`;
  document.body.append(trigger, dialog);
  const q = selector => dialog.querySelector(selector);
  let selected = null;
  const latestVersions = new Map();
  const error = message => { q('#pr-error').textContent = message || ''; q('#pr-error').hidden = !message; };
  const showPanel = panel => {
    selected = panel;
    latestVersions.set(panel.id, Math.max(latestVersions.get(panel.id) || 1, panel.version));
    q('#pr-result').innerHTML = renderResearchPanel(panel, latestVersions.get(panel.id));
  };
  async function loadHistory() {
    try {
      const { panels = [] } = await researchRequest('/panels');
      q('#pr-history').replaceChildren();
      for (const panel of panels) {
        latestVersions.set(panel.id, Math.max(latestVersions.get(panel.id) || 1, panel.version));
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${panel.business} · v${panel.version}`; button.title = panel.question;
        button.addEventListener('click', async () => {
          error('');
          try {
            showPanel(await researchRequest(`/panels/${encodeURIComponent(panel.id)}?version=${panel.version}`));
            q('#pr-auto-status').textContent = 'Viewing saved research. Original source dates and limitations still apply.';
          } catch (e) { error(e.message); }
        });
        q('#pr-history').append(button);
      }
      q('#pr-history-status').textContent = `${panels.length} saved panels`;
    } catch (e) { q('#pr-history-status').textContent = `Saved panels unavailable: ${e.message}`; }
  }
  trigger.addEventListener('click', () => { dialog.showModal(); loadHistory(); });
  dialog.addEventListener('change', async event => {
    if (event.target.id === 'pr-version' && selected) {
      error('');
      try { showPanel(await researchRequest(`/panels/${encodeURIComponent(selected.id)}?version=${event.target.value}`)); } catch (e) { error(e.message); }
    }
  });
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-pr-action]')?.dataset.prAction;
    if (action === 'close') dialog.close();
    if (action === 'export' && selected) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `simtra-audience-${String(selected.id).replace(/[^a-zA-Z0-9_-]/g, '')}-v${selected.version}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  function updateAutomatic({ stage, question, panel, reused, message }) {
    const count = panel?.personas?.length || 0;
    const label = `${count} ${count === 1 ? 'profile' : 'profiles'}`;
    const labels = {
      demo: 'Offline demo: automatic audience research is not run.',
      checking: 'Checking saved audience research…',
      researching: 'Identifying business, topic and audience → discovering evidence → saving profiles…',
      ready: `${reused ? 'Reusing' : 'Saved'} audience · ${label} · version ${panel?.version || ''}`,
      needs_evidence: 'Research saved · insufficient evidence for profiles. See the gaps below; refine your question in the main input.',
      failed: message || 'Audience research could not finish.',
      cancelled: 'Audience research cancelled. No simulation started from this request.',
    };
    q('#pr-auto-status').textContent = labels[stage] || '';
    trigger.textContent = stage === 'demo' ? 'Audience · offline demo' : stage === 'ready' ? `Audience · ${label}` : stage === 'researching' || stage === 'checking' ? 'Audience · researching…' : stage === 'cancelled' ? 'Audience · cancelled' : 'Audience · needs attention';
    trigger.title = question || ''; trigger.setAttribute('aria-live', 'polite');
    if (stage === 'checking' || stage === 'demo') {
      error(''); selected = null;
      q('#pr-result').innerHTML = `<p class="pr-empty">${stage === 'demo' ? 'Offline fixture demonstration. No audience research was performed.' : 'Preparing research for your current question…'}</p>`;
    }
    if (panel) showPanel(panel);
  }
  const controller = { dialog, trigger, updateAutomatic };
  return controller;
}
export const personaResearchUI = typeof document !== 'undefined' ? mountPersonaResearch() : null;
