import test from 'node:test';
import assert from 'node:assert/strict';
import { readResearchStream, renderResearchActivity } from '../src/persona-research.js';
const stream = chunks => new ReadableStream({ start(c) { for (const text of chunks) c.enqueue(new TextEncoder().encode(text)); c.close(); } });
test('research stream handles split messages and only returns a confirmed saved result', async () => {
  const events = [];
  const panel = await readResearchStream(stream(['{"type":"pro', 'gress","step":"sources","message":"Reading sources"}\n', '{"type":"result","panel":{"id":"saved"}}\n']), e => events.push(e));
  assert.equal(panel.id, 'saved'); assert.equal(events[0].step, 'sources');
});
test('research stream rejects errors and incomplete results', async () => {
  await assert.rejects(readResearchStream(stream(['{"type":"error","message":"Service unavailable"}\n'])), /Service unavailable/);
  await assert.rejects(readResearchStream(stream(['{"type":"progress","step":"saving"}\n'])), /before a saved result/);
});
test('activity display distinguishes real running, complete and stopped steps and escapes text', () => {
  const html = renderResearchActivity([{ status:'done',message:'Checked saved research' },{ status:'active',message:'Jev <script>unsafe</script>' },{ status:'stopped',message:'Cancelled' }]);
  for (const label of ['Complete','In progress','Stopped','&lt;script&gt;']) assert.ok(html.includes(label));
  assert.ok(!html.includes('<script>'));
});
