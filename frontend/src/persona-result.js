import { responseFor, metricShare } from './research.js';
import { priceSeries, priceLabel } from './experiment-plan.js';
import { factorText } from './model-display.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = value => value == null ? 'Not recorded' : `${(value * 100).toFixed(1)}%`;

export function personaResultHtml(run, id, selected = 0) {
  const resident = run.residents.find(r => Number(r.id) === Number(id));
  const experiment = run.experiment;
  const scenario = experiment.scenarios[selected];
  if (!resident || !scenario) return '';
  const share = index => metricShare(responseFor(run.scenarios[index], id)?.probabilities, experiment.indices);
  const value = share(selected);
  const metric = experiment.metric || 'Response';
  const hasPrice = Number.isFinite(scenario.change ?? scenario.price);
  const series = hasPrice ? priceSeries(run, selected) : [];
  const shownSeries = series.length <= 8 ? series : series.filter((row,i)=>i % Math.ceil((series.length-1)/5) === 0 || i === series.length-1 || row.index === selected);
  const baseline = series.find(row => row.scenario.change === 0) || series[0];
  const baselineValue = baseline ? share(baseline.index) : null;
  const delta = value == null || baselineValue == null ? null : (value - baselineValue) * 100;
  const price = s => priceLabel(s.change ?? s.price, experiment.priceMode);
  const driver = factorText(responseFor(run.scenarios[selected], id)?.factor);
  const chips = hasPrice ? [scenario.location, price(scenario), scenario.format] : [scenario.label];
  const comparison = baseline && baseline.index !== selected && delta != null
    ? `<div class="pr-comparison"><span>${pct(baselineValue)}<small>${baseline.scenario.change === 0 ? 'At current price' : `At ${esc(price(baseline.scenario))}`}</small></span><span aria-hidden="true">→</span><span>${pct(value)}<small>Selected scenario</small></span><strong>${delta > 0 ? '+' : ''}${delta.toFixed(1)}<small>percentage points</small></strong></div>` : '';
  const chart = series.length > 1 ? `<section class="pr-price-compare" aria-label="Profile response by price"><h4>How price changes this group's response</h4><p class="pr-context">${esc(scenario.location)} · ${esc(scenario.format)} held fixed</p><div class="pr-price-bars">${shownSeries.map(row => {
    const v = share(row.index);
    return `<button type="button" class="pr-price-point" data-scenario="${row.index}" aria-pressed="${row.index === selected}" aria-label="${esc(price(row.scenario))}: ${esc(pct(v))}"><span>${esc(price(row.scenario))}</span><span class="pr-bar-track" aria-hidden="true"><span style="width:${v == null ? 0 : Math.max(0, Math.min(100, v * 100))}%"></span></span><strong>${esc(pct(v))}</strong></button>`;
  }).join('')}</div></section>` : '';
  return `<div class="ex-person-head"><canvas width="40" height="40"></canvas><div><strong>${esc(resident.name)}</strong><small>${esc([resident.age, resident.occupation, resident.neighborhood].filter(v => v != null && v !== '').join(' · '))}</small></div><button class="ex-close" data-action="close-person" aria-label="Close persona">×</button></div>
    <p class="ex-person-story">Synthetic persona · ${esc((resident.educ || 'education not recorded').replaceAll('_', ' '))}</p>
    <div class="pr-scenario-chips" aria-label="Selected scenario">${chips.filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('')}</div>
    <div class="pr-person-metric"><strong>${pct(value)}</strong><span>Estimated ${esc(metric.toLowerCase())}<br>for people with this profile</span></div>
    <p class="pr-group-note">A demographic-group estimate, not this person's individual answer.</p>
    ${comparison}${driver ? `<div class="pr-driver"><span>Modeled driver</span><strong>${esc(driver)}</strong></div>` : ''}${chart}`;
}
