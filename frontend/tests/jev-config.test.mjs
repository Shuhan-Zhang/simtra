import test from 'node:test';
import assert from 'node:assert/strict';
let sequence = 0;
async function config(url, configured = '') {
  globalThis.location = new URL(url);
  globalThis.SIMTRA_BACKEND = configured;
  return import(`../src/config.js?test=${++sequence}`);
}
test('local frontend defaults to local Jev and today', async () => {
  const c = await config('http://localhost:5173');
  assert.equal(c.BASE,'http://localhost:8080');
  assert.equal(c.PREDICT.model,'jev-1.13.0');
  assert.equal(c.PREDICT.as_of_date,c.today());
});
test('explicit local port and historical date remain available', async () => {
  const c = await config('http://127.0.0.1:5173/?backend=local&port=18473&as_of=2026-09-01&model=jev-preview');
  assert.equal(c.BASE,'http://localhost:18473');
  assert.equal(c.PREDICT.model,'jev-preview');
  assert.equal(c.PREDICT.as_of_date,'2026-09-01');
});
test('shared frontend cannot call visitor localhost or the legacy public server', async () => {
  const c = await config('https://example.github.io/simtra/?backend=local&port=18473');
  assert.equal(c.BASE,'');
  assert.match(c.BACKEND_SETUP_MESSAGE,/Jev/);
});
test('hosted configuration and explicit HTTPS query select Jev backend origins', async () => {
  assert.equal((await config('https://simtra.example','https://jev.example/')).BASE,'https://jev.example');
  assert.equal((await config('https://simtra.example/?backend=https://other.example','https://jev.example')).BASE,'https://other.example');
});
test('stale model links never select a removed provider', async () => {
  assert.equal((await config('http://localhost:5173/?model=gemini-3.5-flash-lite')).PREDICT.model,'jev-1.13.0');
  assert.equal((await config('http://localhost:5173/?model=claude-sonnet-4-6')).PREDICT.model,'jev-1.13.0');
});
test('backend configuration rejects credentials and non-origin URLs', async () => {
  for (const value of ['https://user:secret@host.example','http://host.example','https://host.example/path','https://host.example?key=x']) {
    assert.equal((await config('https://simtra.example',value)).BASE,'');
  }
});
