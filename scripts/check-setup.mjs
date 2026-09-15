import assert from 'node:assert/strict';
const launch = new URL(process.argv[2]);
if (!['127.0.0.1', 'localhost'].includes(launch.hostname)) throw new Error('Use an isolated local Harness installation.');
const authentication = await fetch(launch, { redirect: 'manual' });
const cookies = authentication.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert.ok(cookies, 'Launch URL must establish browser authentication');
const base = launch.origin;
async function call(channel, method, payload, authenticated = true) {
  return fetch(`${base}${channel}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(authenticated ? { cookie: cookies } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'setup-smoke', method, payload }),
  });
}
for (const slot of ['deepgram', 'xai', 'fish', 'xai-sts', 'gemini-sts', 'openai-sts']) {
  const response = await call('/voice-credentials', 'status', { slot });
  assert.equal(response.status, 200, `${slot} setup HTTP status`);
  const envelope = await response.json();
  assert.equal(envelope.result.ok, true, `${slot} credential status`);
  assert.equal(typeof envelope.result.value.configured, 'boolean');
}
const models = await call('/voice-local', 'models', {});
assert.equal(models.status, 200);
assert.equal((await models.json()).result.ok, true);
const unauthenticated = await call('/voice-credentials', 'status', { slot: 'deepgram' }, false);
assert.equal(unauthenticated.status, 401);
console.log('Six provider setup statuses, local model discovery, and unauthenticated rejection passed. No credentials were changed.');
