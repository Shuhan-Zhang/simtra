import test from 'node:test';
import assert from 'node:assert/strict';
const { stimulusText, attributesLine } = await import('../src/stimulus.js');

const st = { kind: 'storefront', summary: 'A corner shop with a green awning.',
  attributes: { signage: 'VINTAGE & CO', listed_prices: '$12, $15' }, unknowns: ['hours', 'location'], source: 'image' };

test('stimulus text mirrors the backend rendering', () => {
  assert.equal(stimulusText(st),
    '[storefront] A corner shop with a green awning.\n- signage: VINTAGE & CO\n- listed prices: $12, $15\nNot shown: hours; location');
  assert.equal(stimulusText(null), '');
});

test('attributes render as one compact line', () => {
  assert.equal(attributesLine(st), 'signage: VINTAGE & CO · listed prices: $12, $15');
  assert.equal(attributesLine(null), '');
});
