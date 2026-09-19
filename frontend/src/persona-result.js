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
  const baseline = series.find(row => row.scenario.change === 0) || series[0];
  const baselineValue = baseline ? share(baseline.index) : null;
  const delta = value == null || baselineValue == null ? null : (value - baselineValue) * 100;
  const price = s => priceLabel(s.change ?? s.price, experiment.priceMode);
  const driver = factorText(responseFor(run.scenarios[selected], id)?.factor);
  const chips = hasPrice ? [scenario.location, price(scenario), scenario.format] : [scenario.label];
  const comparison = baseline && baseline.index !== selected && delta != null
    ? `<div class="pr-comparison"><span>${pct(baselineValue)}<small>${baseline.scenario.change === 0 ? 'At current price' : `At ${esc(price(baseline.scenario))}`}</small></span><span aria-hidden="true">→</span><span>${pct(value)}<small>Selected scenario</small></span><strong>${delta > 0 ? '+' : ''}${delta.toFixed(1)}<small>percentage points</small></strong></div>` : '';
  const points = series.map(row => ({...row,value:share(row.index)}));
  const min = Math.min(...series.map(row=>row.scenario.change ?? row.scenario.price));
  const max = Math.max(...series.map(row=>row.scenario.change ?? row.scenario.price));
  const x = row => 48 + ((row.scenario.change ?? row.scenario.price)-min)/(max-min || 1)*310;
  const y = row => 164-Math.max(0,Math.min(1,row.value))*130;
  let path = '', connected = false;
  points.forEach(row=>{if(row.value==null){connected=false;return;}path+=`${connected?'L':'M'}${x(row)},${y(row)} `;connected=true;});
  const chart = series.length > 1 ? `<section class="pr-price-compare" aria-label="Profile response by price"><h4>Response by price</h4><p class="pr-context">${esc(scenario.location)} · ${esc(scenario.format)}</p><div class="pr-line-axis">${esc(metric)} (%)</div><svg class="pr-price-line" viewBox="0 0 390 210" aria-label="${esc(metric)} by price" role="group">${[0,.5,1].map(v=>`<line x1="48" x2="358" y1="${164-v*130}" y2="${164-v*130}" stroke="#d8dee8" stroke-dasharray="3 4"/><text x="40" y="${169-v*130}" text-anchor="end">${v*100}%</text>`).join('')}<path d="${path}" fill="none" stroke="#087fff" stroke-width="3"/>${points.map((row,i)=>`<g class="pr-price-point" data-scenario="${row.index}" aria-pressed="${row.index===selected}" role="button" tabindex="0" aria-label="${esc(price(row.scenario))}: ${esc(pct(row.value))}"><title>${esc(price(row.scenario))}: ${esc(pct(row.value))}</title>${row.value==null?'':`<circle cx="${x(row)}" cy="${y(row)}" r="9" fill="transparent"/><circle cx="${x(row)}" cy="${y(row)}" r="${row.index===selected?5:3}" fill="${row.index===selected?'#087fff':'white'}" stroke="#087fff" stroke-width="2"/>`}${i===0||i===points.length-1||i===Math.floor(points.length/2)?`<text x="${x(row)}" y="186" text-anchor="middle">${esc(price(row.scenario))}</text>`:''}</g>`).join('')}<text x="203" y="207" text-anchor="middle">${experiment.priceMode==='absolute'?'Price':'Price change'}</text></svg></section>` : '';
  return `<div class="ex-person-head"><canvas width="40" height="40"></canvas><div><strong>${esc(resident.name)}</strong><small>${esc([resident.age, resident.occupation, resident.neighborhood].filter(v => v != null && v !== '').join(' · '))}</small></div><button class="ex-close" data-action="close-person" aria-label="Close persona">×</button></div>
    <p class="ex-person-story">Synthetic persona · ${esc((resident.educ || 'education not recorded').replaceAll('_', ' '))}</p>
    <div class="pr-scenario-chips" aria-label="Selected scenario">${chips.filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('')}</div>
    <div class="pr-person-metric"><strong>${pct(value)}</strong><span>Estimated ${esc(metric.toLowerCase())}<br>for people with this profile</span></div>
    <p class="pr-group-note">A demographic-group estimate, not this person's individual answer.</p>
    ${comparison}${driver ? `<div class="pr-driver"><span>Modeled driver</span><strong>${esc(driver)}</strong></div>` : ''}${chart}`;
}
