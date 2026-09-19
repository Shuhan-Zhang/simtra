// Automatic data preparation only: scenario evaluation remains in app.js.
import { researchRequest } from './persona-research.js';

export function automaticResearchInput(question, location = '') {
  question = String(question || '').trim();
  if (question.length < 8 || question.length > 2000) throw new Error('Ask a question between 8 and 2,000 characters so audience research has enough context.');
  return { question, market: String(location || '').trim() };
}

export function usableResearchPanel(panel) {
  return panel?.status === 'draft' && panel.personas?.length > 0 && panel.sources?.length > 0;
}

export async function prepareAutomaticAudience(question, { location = '', signal, onProgress = () => {}, request = researchRequest } = {}) {
  const body = automaticResearchInput(question, location);
  const check = () => { if (signal?.aborted) throw new DOMException('Audience research cancelled', 'AbortError'); };
  const call = async (path, options = {}) => {
    check();
    const result = await request(path, { ...options, signal });
    check();
    return result;
  };
  onProgress({ stage: 'checking', question: body.question });
  const { panels = [] } = await call('/panels');
  // Pin an exact saved version; changed question or market cannot reuse it.
  const saved = panels.find(p => p.question === body.question && p.question_context?.requested_market === body.market && usableResearchPanel(p));
  if (saved) {
    const panel = await call(`/panels/${encodeURIComponent(saved.id)}?version=${saved.version}`);
    if (!usableResearchPanel(panel)) throw new Error('Saved audience needs more evidence. Open Audience research to inspect it.');
    onProgress({ stage: 'ready', question: body.question, panel, reused: true });
    return panel;
  }
  const config = await call('/config');
  if (!config.search_configured || !config.jev_configured) {
    throw new Error('Automatic audience research needs Brave Search and Jev configured on the server. No audience was invented.');
  }
  onProgress({ stage: 'researching', question: body.question });
  const panel = await call(config.progress_stream ? '/automatic/stream' : '/automatic', { body,
    onActivity: event => { check(); onProgress({ stage: 'activity', question: body.question, step: event.step, message: event.message }); },
  });
  onProgress({ stage: usableResearchPanel(panel) ? 'ready' : 'needs_evidence', question: body.question, panel, reused: false });
  if (!usableResearchPanel(panel)) throw new Error('Research was saved, but it does not support an audience yet. Open Audience research to see the gaps, then refine your question in the main input.');
  return panel;
}

export const researchReference = panel => panel ? ({
  id: panel.id, version: panel.version, content_hash: panel.content_hash,
  role: 'research_context_only',
}) : null;

// A conservative, local relevance check avoids research calls for general opinions.
// Dedicated marketing and A/B flows supply their explicit commercial context.
export function audienceResearchHelpful(question, { commercial = false } = {}) {
  return commercial || /\b(customers?|consumers?|buyers?|buy(?:ing)?|purchase[sd]?|purchasing|shop(?:ping|pers)?|prices?|pricing|cheaper|expensive|afford(?:able)?|discounts?|products?|brands?|business|marketing|advertis(?:ing|ements?)|ads?|subscriptions?|sales|competitors?|switching|willing to pay)\b/i.test(question || '');
}

export async function prepareHelpfulAudience(question, options = {}) {
  const { signal, onProgress = () => {} } = options;
  const check = () => { if (signal?.aborted) throw new DOMException('Audience research cancelled', 'AbortError'); };
  check();
  if (!audienceResearchHelpful(question, options)) {
    onProgress({ stage: 'skipped', question });
    return null;
  }
  let incomplete = false;
  try {
    return await prepareAutomaticAudience(question, { ...options, onProgress: progress => {
      incomplete = progress.stage === 'needs_evidence';
      onProgress(progress);
    } });
  } catch (error) {
    check();
    if (error.name === 'AbortError') throw error;
    if (!incomplete) onProgress({ stage: 'unavailable', question, message: error.message });
    return null; // Research context is optional; the Census evaluator can continue.
  }
}
