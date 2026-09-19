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
  const panel = await call('/automatic', { body });
  onProgress({ stage: usableResearchPanel(panel) ? 'ready' : 'needs_evidence', question: body.question, panel, reused: false });
  if (!usableResearchPanel(panel)) throw new Error('Research was saved, but it does not support an audience yet. Open Audience research to see the gaps, then refine your question in the main input.');
  return panel;
}

export const researchReference = panel => panel ? ({
  id: panel.id, version: panel.version, content_hash: panel.content_hash,
  role: 'research_context_only',
}) : null;
