import { COLORS } from './config.js';
import { factorText } from './model-display.js';
import { SEGMENT_DIMENSIONS } from './segment-selection.js';

const PALETTE = ['#1676D2', '#A34EBC', '#D68B00', '#008B8B', '#D44F84', '#7364B9', '#8C643B', '#457B45'];
export const MAP_COLOR_MODES = Object.freeze([
  { key: 'response', label: 'Response' }, { key: 'factor', label: 'Main factor' },
  ...SEGMENT_DIMENSIONS.map(key => ({ key, label: key.replaceAll('_x_', ' × ').replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()) })),
]);
function categoryColor(index) {
  if (PALETTE[index]) return PALETTE[index];
  const hue = (index * 137.508) % 360;
  const channel = offset => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (.42 - .252 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [channel(0), channel(8), channel(4)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function mapSegmentLabel(dimension, key) {
  if (dimension.includes('_x_')) return dimension.split('_x_').map((axis, index) => mapSegmentLabel(axis, key.split('|')[index] || 'Unknown')).join(' · ');
  if (dimension === 'age') return key === 'u18' ? 'Under 18' : key;
  if (dimension === 'income' && /^q[0-4]$/.test(key)) {
    const quintile = Number(key[1]) + 1;
    return `Income Q${quintile}${quintile === 1 ? ' (lowest)' : quintile === 5 ? ' (highest)' : ''}`;
  }
  const labels = { lt_hs: 'Less than high school', hs: 'High school', bachelors: 'Bachelor’s degree', graduate: 'Graduate degree', other_multi: 'Other / multiracial', own: 'Homeowners', rent: 'Renters', us_born: 'US-born', foreign_born: 'Foreign-born', noncitizen: 'Non-citizens' };
  if (dimension === 'geography') return `PUMA ${key}`;
  return labels[key] || key.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
}
const validId = value => value !== null && value !== '' && Number.isFinite(Number(value));
export function validResponseGroup(group, options) {
  const p = group?.probabilities;
  return Array.isArray(p) && p.length > 0 && p.length === options?.length
    && p.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && Math.abs(p.reduce((sum, value) => sum + value, 0) - 1) <= .02;
}

// All mappings use source resident IDs and canonical segment keys. A dot describes
// a group's strongest modeled response, never a separately sampled individual vote.
export function researchMapColors(groups, options, residents = [], colorBy = 'response') {
  const modes = MAP_COLOR_MODES.filter(mode => !SEGMENT_DIMENSIONS.includes(mode.key)
    || residents.some(resident => typeof resident.segments?.[mode.key] === 'string'));
  const mode = modes.some(item => item.key === colorBy) ? colorBy : 'response';
  const membership = new Map();
  const verdicts = new Map();
  for (const group of groups || []) {
    if (!validResponseGroup(group, options)) continue;
    const max = Math.max(...group.probabilities);
    const winners = group.probabilities.map((p, i) => p === max ? i : -1).filter(i => i >= 0);
    const winner = winners.length === 1 ? winners[0] : null;
    const key = mode === 'factor' ? factorText(group.factor).trim() || null
      : winner === null ? null : `option-${winner}`;
    for (const id of group.agent_ids || []) {
      if (!validId(id)) continue;
      membership.set(Number(id), key);
      verdicts.set(Number(id), options.length === 2 && winner !== null ? winner === 0 ? 'yes' : 'no' : null);
    }
  }
  if (SEGMENT_DIMENSIONS.includes(mode)) {
    membership.clear();
    for (const resident of residents) {
      const id = resident.seed ?? resident.id;
      const key = resident.segments?.[mode];
      if (validId(id) && typeof key === 'string' && key.trim()) membership.set(Number(id), key);
    }
  }
  const keys = mode === 'response' ? (options || []).map((_, i) => `option-${i}`)
    : [...new Set([...membership.values()].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const legend = keys.map((key, i) => ({ key,
    label: mode === 'response' ? options[i] : mode === 'factor' ? key : mapSegmentLabel(mode, key),
    color: mode === 'response' && options.length === 2 ? i === 0 ? COLORS.yes : COLORS.no
      : categoryColor(i),
  }));
  const palette = new Map(legend.map(item => [item.key, item.color]));
  const colors = new Map([...membership].map(([id, key]) => [id, palette.get(key) || null]));
  return { mode, modes, legend, colors, verdicts };
}
