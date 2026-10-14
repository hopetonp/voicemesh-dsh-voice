import assert from 'node:assert/strict'
import test from 'node:test'
import { registerVoiceRpc } from '../src/voice-rpc.ts'

function registry() {
  const routes = new Map<string, { methods: string[]; fetch(request: Request): Promise<Response> }>()
  const connection = { fetch: { register(route: { path: string; methods: string[]; fetch(request: Request): Promise<Response> }) {
    assert(!routes.has(route.path))
    routes.set(route.path, route)
    return () => { routes.delete(route.path) }
  } } }
  return { routes, connection: connection as unknown as Parameters<typeof registerVoiceRpc>[0] }
}

test('voice routes use the existing API and are removed with their plugin', async () => {
  const { routes, connection } = registry()
  let stored = ''
  const dispose = registerVoiceRpc(connection, '/voice-credentials', async (endpoint, payload) => {
    if (endpoint === 'save') stored = (payload as { value: string }).value
    return { ok: true, value: { configured: stored !== '' } }
  })
  assert.deepEqual([...routes.keys()], ['/api/voice-credentials/status', '/api/voice-credentials/save'])
  for (const endpoint of ['save', 'status']) {
    const method = `voice-credentials/${endpoint}`
    const response = await routes.get(`/api/${method}`)!.fetch(new Request(`http://localhost/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method, payload: { value: 'dummy-test-key' } }),
    }))
    assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'test-id', result: { ok: true, value: { configured: true } } })
  }
  await dispose()
  assert.equal(routes.size, 0)
})

test('invalid credential envelopes never reach the save handler', async () => {
  const { routes, connection } = registry()
  let calls = 0
  registerVoiceRpc(connection, '/voice-credentials', async () => { calls++; return { ok: true } })
  const route = routes.get('/api/voice-credentials/save')!
  const inputs = [null, [], {}, { type: 'client-request', rpcId: 'x', method: 'voice-credentials/status', payload: {} }]
  for (const input of inputs) {
    const response = await route.fetch(new Request('http://localhost/api/voice-credentials/save', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }))
    assert.equal((await response.json()).result.ok, false)
  }
  const wrongType = await route.fetch(new Request('http://localhost/api/voice-credentials/save', { method: 'POST', body: '{}' }))
  assert.equal(wrongType.status, 415)
  assert.equal(calls, 0)
})

test('binary responses retain the Connection multipart wire format', async () => {
  const { routes, connection } = registry()
  registerVoiceRpc(connection, '/voice-sts', async () => ({ ok: true, value: { audio: true },
    attachments: [{ kind: 'audio', bytes: new Uint8Array([1, 2, 3]) }] }))
  const response = await routes.get('/api/voice-sts/voice-preview')!.fetch(new Request('http://localhost/api/voice-sts/voice-preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'binary-test', method: 'voice-sts/voice-preview', payload: {} }),
  }))
  const form = await response.formData()
  assert.deepEqual(JSON.parse(form.get('metadata') as string), { type: 'server-response', rpcId: 'binary-test',
    result: { ok: true, value: { audio: true } }, attachments: [{ kind: 'audio', codec: 'bytes', part: 'bytes-0' }] })
  assert.deepEqual(new Uint8Array(await (form.get('bytes-0') as Blob).arrayBuffer()), new Uint8Array([1, 2, 3]))
})
