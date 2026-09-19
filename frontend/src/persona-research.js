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

export async function researchRequest(path, { body, base = BASE, fetcher = globalThis.fetch, timeout = 165000, signal, onActivity } = {}) {
  if (!base) throw new Error(BACKEND_SETUP_MESSAGE);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetcher(`${base}/audience-research${path}`, { method: body ? 'POST' : 'GET', signal: controller.signal, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
      return await readResearchStream(response.body, onActivity, controller.signal);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Research request failed (${response.status}). Check the research backend and retry.`);
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Audience research cancelled', 'AbortError');
    if (error.name === 'AbortError') throw new Error('Research is taking longer than expected. Refresh saved panels before retrying; a version may already have been saved.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function readResearchStream(body, onActivity = () => {}, signal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', panel;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message || 'Research could not finish.');
    if (event.type === 'progress') onActivity(event);
    if (event.type === 'result') panel = event.panel;
  };
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      lines.forEach(consume);
      if (done) { consume(buffer); break; }
    }
    if (!panel) throw new Error('Research connection ended before a saved result was confirmed.');
    return panel;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function renderResearchActivity(entries) {
  return `<ol class="pr-activity-list">${entries.map(e => `<li data-status="${escapeText(e.status)}"><span class="pr-activity-icon" aria-hidden="true">${e.status === 'active' ? '◌' : e.status === 'done' ? '✓' : '–'}</span><span>${escapeText(e.message)}<small>${e.status === 'active' ? 'In progress' : e.status === 'done' ? 'Complete' : 'Stopped'}</small></span></li>`).join('')}</ol>`;
}

const list = (items) => `<ul>${items.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul>`;
const provenanceLabels = new Set(['sourced', 'founder-provided', 'inferred', 'unknown']);
export function renderResearchSummary(panel) {
  if (!panel?.id || !panel.question) return '';
  const sources = new Map((panel.sources || []).map(source => [source.id, source]));
  const labels = { needs: 'Need', objections: 'Objection', decision_criteria: 'Decision criterion', alternatives: 'Alternative', price_sensitivity: 'Price sensitivity', buying_situation: 'Buying situation', purchase_frequency: 'Purchase frequency', switching_conditions: 'Switching condition' };
  const profiles = (panel.personas || []).map((profile, index) => {
    const supported = (profile.attributes || []).flatMap(attribute => {
      if (!labels[attribute.key] || attribute.value == null || !provenanceLabels.has(attribute.provenance) || attribute.provenance === 'unknown') return [];
      const evidence = (attribute.evidence || []).filter(item => item.excerpt?.trim() && sources.get(item.source_id)?.text?.includes(item.excerpt));
      return evidence.length ? [{ ...attribute, evidence }] : [];
    });
    const name = String(profile.label || 'Research persona').replace(/\s*\(inferred archetype\)\s*$/i, '');
    const unknowns = (profile.attributes || []).filter(a => a.value == null || a.provenance === 'unknown');
    return `<details class="pr-persona-head"><summary aria-label="${escapeText(name)}: view research traits"><span class="pc-person-portrait pr-sprite-head" aria-hidden="true" style="background-position:-${((index % 5) * 48 + 16) * 4}px -${Math.floor((index % 10) / 5) * 64 * 4}px"></span><strong>${escapeText(name)}</strong><span class="pr-trait-preview">${supported.slice(0, 2).map(a => `${escapeText(labels[a.key])}: ${escapeText(a.value)}`).join(' · ') || 'No supported traits yet'}</span></summary><div class="pr-persona-popover"><strong>What this persona adds</strong>${supported.length ? `<ul>${supported.map(a => `<li><b>${escapeText(labels[a.key])}:</b> ${escapeText(a.value)}</li>`).join('')}</ul>` : '<p>No supported traits yet.</p>'}<details class="pr-persona-evidence"><summary>Sources &amp; limits</summary>${supported.map(a => `<p class="pr-muted">${escapeText(labels[a.key])} · ${escapeText(a.provenance)}</p>${a.evidence.map(item => {
      const source = sources.get(item.source_id), url = sourceUrl(source.url);
      return `<blockquote>${escapeText(item.excerpt)}</blockquote>${url ? `<a href="${escapeText(url)}" target="_blank" rel="noopener noreferrer">${escapeText(source.title || 'Source')}</a>` : '<span>Saved evidence</span>'}`;
    }).join('')}`).join('')}${unknowns.length ? `<p>Unknown: ${unknowns.map(a => escapeText(a.key.replaceAll('_', ' '))).join(', ')}</p>` : ''}</details></div></details>`;
  });
  return `<section class="research-summary" aria-label="Audience research summary"><div class="pr-personas-heading"><h3>Customer personas</h3><span>${profiles.length} built from research</span></div><div class="pr-persona-heads">${profiles.join('') || '<p>No supported personas yet.</p>'}</div><details class="pr-summary-notes"><summary>Research details</summary><p>${escapeText(panel.business)} · saved panel v${escapeText(panel.version)}</p><p>Inferred profiles; not used to calculate the simulation results. Avatars are illustrative.</p>${(panel.conflicts || []).length ? `<strong>Conflicting evidence</strong>${panel.conflicts.map(c => `<p>${escapeText(c.attribute)}</p>${list(c.values || [])}`).join('')}` : ''}${list(panel.gaps || [])}${list(panel.warnings || [])}</details></section>`;

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
  return `${renderResearchSummary(panel)}<details class="pr-full-research"><summary>Full research &amp; saved versions</summary><header class="pr-result-header"><span class="pr-kicker">Saved panel · version ${escapeText(panel.version)}</span><h3>${escapeText(panel.business)}</h3><p>${escapeText(panel.question)}</p><p class="pr-muted">${escapeText(panel.location || 'Location not specified')} · ${personas.length} research ${personas.length === 1 ? 'profile' : 'profiles'} · ${escapeText(panel.status === 'needs_evidence' ? 'Needs evidence' : 'Draft — review before use')}</p><label>Saved version<select id="pr-version" aria-label="Saved panel version">${versionNumbers.map(v => `<option value="${v}"${v === panel.version ? ' selected' : ''}>Version ${v}${v === maxVersion ? ' · latest' : ''}</option>`).join('')}</select></label><div class="pr-actions"><button type="button" data-pr-action="export">Export JSON</button></div></header>
  ${contextHtml}<p class="pr-notice">Synthetic research profiles, not verified individual customers or a representative population sample. No scenario has been evaluated.</p>
  ${(panel.conflicts || []).length ? `<section class="pr-warning"><h4>Conflicting evidence</h4>${panel.conflicts.map(c => `<p><strong>${escapeText(c.attribute)}</strong></p>${list(c.values || [])}<p>Sources: ${(c.source_ids || []).map(id => escapeText(sourceIndex.has(id) ? `[${sourceIndex.get(id)}]` : id)).join(', ')}</p>`).join('')}</section>` : ''}
  <section><h4>Audience profiles</h4>${personas.length ? personas.map(personaHtml).join('') : '<p>No supported profiles yet. Review the gaps below and make your question more specific in the main input.</p>'}</section>
  ${(panel.gaps || []).length ? `<details class="pr-warning"><summary>Missing information · ${panel.gaps.length}</summary>${list(panel.gaps)}</details>` : ''}
  ${(panel.warnings || []).length ? `<details class="pr-method"><summary>Research limitations · ${panel.warnings.length}</summary>${list(panel.warnings)}</details>` : ''}
  <section><h4>Sources &amp; lineage</h4>${sources.length ? sources.map((s, i) => `<details class="pr-source"><summary>[${i + 1}] ${escapeText(s.title || s.url || s.kind)}</summary><p>${escapeText(s.kind)} · retrieved ${escapeText(s.retrieved_at || 'date unavailable')}</p>${sourceUrl(s.url) ? `<a href="${escapeText(sourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>` : '<p>Supplied excerpt; no public URL.</p>'}<blockquote>${escapeText(s.text)}</blockquote><small>Content hash: ${escapeText(s.content_hash)}</small></details>`).join('') : '<p>No sources collected.</p>'}</section>
  <details class="pr-method"><summary>Methodology &amp; panel identity</summary><pre>${escapeText(typeof panel.methodology === 'string' ? panel.methodology : JSON.stringify(panel.methodology, null, 2))}</pre><p>ID: ${escapeText(panel.id)} · version ${escapeText(panel.version)}</p><p>Saved: ${escapeText(panel.created_at)}</p><p>Content hash: ${escapeText(panel.content_hash)}</p></details></details>`;
}

export function mountPersonaResearch() {
  const trigger = document.createElement('button');
  trigger.className = 'pr-trigger'; trigger.type = 'button'; trigger.textContent = 'Audience research · automatic'; trigger.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.className = 'pr-dialog pr-readonly'; dialog.setAttribute('aria-labelledby', 'pr-title');
  dialog.innerHTML = `<header class="pr-head"><div><span class="pr-kicker">Simtra · audience research</span><h2 id="pr-title">Your audience research.</h2></div><button type="button" data-pr-action="close" aria-label="Close audience research">×</button></header>
    <p class="pr-intro">Hover or tap a persona to explore its research-backed traits.</p>
    <p id="pr-auto-status" class="pr-notice" role="status">Ask your question in the main city input. No research form to fill out.</p>
    <details class="pr-context-note"><summary>About this research</summary><p class="pr-muted">Research profiles are context only. The current simulation still evaluates Census residents; these profiles do not replace them. Discovery powered by <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer">Brave Search</a>.</p></details>
    <p id="pr-error" role="alert" hidden></p>
    <section id="pr-result" aria-label="Research panel"><p class="pr-empty">Your audience, citations and missing information will appear here after you ask a question.</p></section>
    <details class="pr-history"><summary>Saved research</summary><p id="pr-history-status" class="pr-muted"></p><div id="pr-history"></div></details>`;
  const activity = document.createElement('details');
  activity.className = 'pr-activity'; activity.hidden = true; activity.open = true;
  activity.innerHTML = '<summary>Research activity</summary><div class="pr-activity-body" role="status" aria-live="polite"></div>';
  document.body.append(trigger, activity, dialog);
  let activityEntries = [];
  const addActivity = (id, message, terminal = false, stopped = false) => {
    activityEntries = activityEntries.map(e => e.status === 'active' ? { ...e, status: stopped ? 'stopped' : 'done' } : e);
    activityEntries.push({ id, message, status: terminal ? (stopped ? 'stopped' : 'done') : 'active' });
    activity.querySelector('.pr-activity-body').innerHTML = renderResearchActivity(activityEntries);
    activity.hidden = false;
  };
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
            q('#pr-auto-status').textContent = 'Saved audience';
            q('.pr-history').open = false;
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
  function updateAutomatic({ stage, question, panel, reused, message, step }) {
    if (['checking', 'skipped', 'demo'].includes(stage)) {
      activityEntries = []; activity.hidden = true; activity.open = true;
    }
    if (stage === 'checking') addActivity('saved', 'Checking saved research for this question');
    if (stage === 'researching') addActivity('start', 'Starting audience research');
    if (stage === 'activity') {
      addActivity(step, message);
      q('#pr-auto-status').textContent = message;
      return;
    }
    if (stage === 'ready') addActivity('ready', `${reused ? 'Reused saved research' : 'Research saved'} · ${panel?.sources?.length || 0} sources · ${panel?.personas?.length || 0} profiles`, true);
    if (stage === 'needs_evidence') addActivity('limited', 'Research saved with gaps · continuing without profiles', true);
    if (['unavailable', 'failed', 'cancelled'].includes(stage)) addActivity(stage, stage === 'cancelled' ? 'Research cancelled' : 'Research unavailable · continuing without profiles', true, true);
    const count = panel?.personas?.length || 0;
    const label = `${count} ${count === 1 ? 'profile' : 'profiles'}`;
    const labels = {
      demo: 'Offline demo: automatic audience research is not run.',
      checking: 'Checking saved audience research…',
      researching: 'Identifying business, topic and audience → discovering evidence → saving profiles…',
      ready: `${reused ? 'Reusing' : 'Saved'} audience · ${label} · version ${panel?.version || ''}`,
      needs_evidence: 'Research saved · insufficient evidence for profiles. Simulation continues without research profiles; gaps remain available below.',
      skipped: 'Customer research is not needed for this question. Continuing with the city simulation.',
      unavailable: `Research unavailable. Simulation continues without research profiles. ${message || ''}`,
      failed: message || 'Audience research could not finish.',
      cancelled: 'Audience research cancelled. No simulation started from this request.',
    };
    q('#pr-auto-status').textContent = labels[stage] || '';
    trigger.textContent = stage === 'skipped' ? 'Audience · city residents' : stage === 'unavailable' ? 'Audience · research unavailable' : stage === 'needs_evidence' ? 'Audience · limited evidence' : stage === 'demo' ? 'Audience · offline demo' : stage === 'ready' ? `Audience · ${label}` : stage === 'researching' || stage === 'checking' ? 'Audience · researching…' : stage === 'cancelled' ? 'Audience · cancelled' : 'Audience · needs attention';
    trigger.title = question || ''; trigger.setAttribute('aria-live', 'polite');
    if (['checking', 'demo', 'skipped', 'unavailable'].includes(stage)) {
      error(''); selected = null;
      q('#pr-result').innerHTML = `<p class="pr-empty">${stage === 'skipped' ? 'Using the city residents for this question; no customer research was requested.' : stage === 'unavailable' ? 'No research profiles are attached to this simulation.' : stage === 'demo' ? 'Offline fixture demonstration. No audience research was performed.' : 'Preparing research for your current question…'}</p>`;
    }
    if (panel) showPanel(panel);
  }
  const controller = { dialog, trigger, updateAutomatic };
  return controller;
}
export const personaResearchUI = typeof document !== 'undefined' ? mountPersonaResearch() : null;
