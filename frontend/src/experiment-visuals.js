import { metricShare, responseFor, scenarioShare } from './research.js';
import { priceLabel } from './experiment-plan.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = value => value == null ? 'Not recorded' : `${(value * 100).toFixed(1)}%`;
const amount = scenario => scenario.change ?? scenario.price;

/** Each cell keeps the original scenario index; no ranking or estimates are inferred. */
export function scenarioMatrixHtml(run, selected, { personId } = {}) {
  const exp = run.experiment, scenarios = exp.scenarios || [], indices = exp.indices || [];
  const mode = exp.priceMode || (scenarios.some(s => s.change != null) ? 'relative' : 'absolute');
  const shareAt = index => personId == null
    ? scenarioShare(run.scenarios?.[index], indices)
    : metricShare(responseFor(run.scenarios?.[index], personId)?.probabilities, indices);
  const cell = index => {
    const value = shareAt(index), scenario = scenarios[index];
    const shade = value == null ? '' : ` style="--cell-light:${97 - Math.min(1, Math.max(0, value)) * 24}%"`;
    return `<button type="button" class="ex-matrix-cell${value == null ? ' is-missing' : ''}" data-scenario="${index}" aria-pressed="${index === selected}" aria-label="${esc(scenario.label)}: ${pct(value)}"${shade}><strong>${pct(value)}</strong></button>`;
  };
  const prices = [...new Set(scenarios.map(amount))].sort((a,b) => a-b);
  const rows = [...new Map(scenarios.map(s => [JSON.stringify([s.location ?? '',s.format ?? '']), { location:s.location, format:s.format }])).values()];
  // Historical arbitrary alternatives cannot be placed on an invented price axis.
  const isMatrix = scenarios.length > 1 && prices.every(Number.isFinite) && rows.every(row => prices.every(price => scenarios.filter(s => s.location === row.location && s.format === row.format && amount(s) === price).length <= 1));
  const selectedScenario = scenarios[selected];
  const selectedProbabilities = personId == null ? run.scenarios?.[selected]?.result?.p_distribution : (responseFor(run.scenarios?.[selected],personId)?.probabilities || []).map((p,i)=>[exp.options?.[i] || `Option ${i+1}`,p]);
  const details = selectedScenario ? `<div class="ex-matrix-selection"><span>Selected combination</span><h4>${esc(selectedScenario.label)}</h4><p>${esc(selectedScenario.description)}</p><div class="ex-selection-distribution">${(selectedProbabilities || []).map(([label,value])=>`<div><span>${esc(label)}</span><strong>${pct(Number.isFinite(value)?value:null)}</strong><i aria-hidden="true" style="--share:${Number.isFinite(value)?Math.max(0,Math.min(1,value))*100:0}%"></i></div>`).join('')}</div></div>` : '';
  const note = personId == null ? 'Color and percentage show modeled interest. Select a cell to explore that combination.' : 'These estimates belong to this resident’s modeled group. Select a cell to compare a different offer.';
  if (!isMatrix) return `<section class="ex-comparison" aria-label="Scenario comparison"><h3>Compare the options</h3><div class="ex-scenario-cards">${scenarios.map((s,i) => `<article><h4>${esc(s.label)}</h4><p>${esc(s.description)}</p>${cell(i)}</article>`).join('')}</div><p class="ex-visual-note">${note}</p>${details}</section>`;
  return `<section class="ex-comparison" aria-label="Scenario comparison"><h3>${personId == null ? 'Every combination, at a glance' : 'How this group responds'}</h3><p class="ex-visual-note">${esc(exp.metric || 'Modeled interest')} · ${personId == null ? 'same audience across every cell' : 'group estimate, not an individual answer'}</p><div class="ex-matrix-scroll" tabindex="0" role="region" aria-label="${esc(exp.metric || 'Modeled interest')} comparison table"><table class="ex-matrix" style="min-width:${Math.max(480,prices.length*60+90)}px"><caption>${esc(exp.priceAxis || "Price change")} →</caption><thead><tr><th scope="col">${scenarios.some(s=>s.location) ? 'Format' : 'Option'}</th>${prices.map(p=>`<th scope="col">${esc(priceLabel(p,mode))}</th>`).join('')}</tr></thead><tbody>${rows.map((row,rowIndex)=>`${rowIndex===0 || rows[rowIndex-1].location!==row.location ? `<tr class="ex-matrix-location"><th colspan="${prices.length+1}" scope="rowgroup">${esc(row.location || 'All locations')}</th></tr>` : ''}<tr><th scope="row"><span>${esc(row.format || 'All formats')}</span></th>${prices.map(price=>{const index=scenarios.findIndex(s=>s.location===row.location && s.format===row.format && amount(s)===price);return `<td>${index<0 ? '<span class="ex-matrix-empty">Not tested</span>' : cell(index)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><div class="ex-matrix-key"><span>Lower interest</span><i aria-hidden="true"></i><span>Higher interest</span></div><p class="ex-visual-note">${note}</p>${details}</section>`;
}

export function experimentDesignHtml(run) {
  const exp=run.experiment, factors=exp.factors || [], count=exp.scenarios?.length || 0;
  const dense = factors.filter(f => (f.levels?.length || 0) > 8);
  const levelsHtml = factor => {
    const levels = factor.levels || [];
    return levels.length > 8
      ? `<span class="ex-design-range">${esc(levels[0])}<span aria-hidden="true">→</span>${esc(levels.at(-1))}</span><small class="ex-design-step-count">${levels.length} tested levels</small>`
      : levels.map(v=>`<span class="ex-design-level">${esc(v)}</span>`).join('');
  };
  return `<section class="ex-design" aria-label="Experiment design"><h3>What was tested</h3><div class="ex-design-scroll" tabindex="0" role="region" aria-label="Factors combined in this experiment"><div class="ex-design-flow" style="min-width:${Math.max(470,factors.length*124+90)}px">${factors.map((f,i)=>`${i ? '<span class="ex-design-join" aria-label="combined with">×</span>' : ''}<div class="ex-design-node"><span class="ex-design-count">${f.levels?.length || 0} ${esc(f.label)}</span><div>${levelsHtml(f)}</div></div>`).join('')}<span class="ex-design-join" aria-hidden="true">→</span><div class="ex-design-total"><strong>${count}</strong><span>combinations tested</span></div></div></div><div class="ex-design-question"><span>Asked in every combination</span><p>${esc(exp.question)}</p></div><details class="ex-details ex-design-details"><summary>Assumptions and model details</summary>${dense.map(f=>`<div class="ex-design-full-levels"><strong>All ${esc(f.label)} levels</strong><div>${(f.levels||[]).map(v=>`<span class="ex-design-level">${esc(v)}</span>`).join('')}</div></div>`).join('')}<p>${esc(exp.assumptions)}</p><p>${esc([run.model,run.asOf].filter(Boolean).join(' · '))}</p><p>Model estimates, not observed demand or profit. The same audience is used in each combination.</p></details></section>`;
}
