/**
 * Smoke test for the node half: mounts it on a stub context and exercises the
 * exact routes the browser half calls, against a throwaway storage directory.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(join(tmpdir(), 'brand-custom-'))
const routes = new Map()
const effects = []

const stub = {
  get: key => (key === 'dshHomePath' ? (...segments) => join(home, ...segments) : undefined),
  inject: (services, body) => {
    if (!services.includes('webServer')) throw new Error(`unexpected inject ${services}`)
    body({ webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } }, effect: run => { const dispose = run(); effects.push(dispose); return dispose }, get: stub.get, logger: console })
  },
  logger: { warn: () => {} },
}

const { apply } = await import('../lib/index.js')
apply(stub)

console.log('routes:', [...routes.keys()].sort().join(', '))

/** Build a loopback request the fence accepts. */
function request(method, path, { body, headers = {} } = {}) {
  const stream = Readable.from(body === undefined ? [] : [body])
  stream.method = method
  stream.url = path
  stream.headers = { host: '127.0.0.1:63177', 'sec-fetch-site': 'same-origin', ...headers }
  stream.socket = { remoteAddress: '127.0.0.1' }
  const chunks = []
  const answer = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, headers) {
      answer.status = status
      answer.headers = headers ?? {}
      return this
    },
    end(payload) {
      if (payload !== undefined) chunks.push(Buffer.from(payload))
      answer.body = Buffer.concat(chunks).toString('utf8')
    },
    once() {},
  }
  return { stream, answer, res }
}

async function call(method, path, options) {
  const { stream, answer, res } = request(method, path, options)
  const route = routes.get(path.split('?')[0])
  if (route === undefined) throw new Error(`no route for ${path}`)
  await route.handler(stream, res)
  return answer
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pretend-png-bytes'),
])

let answer = await call('GET', '/brand-custom-api/config')
console.log('GET config:', answer.status, answer.body)

answer = await call('PUT', '/brand-custom-api/config', {
  body: Buffer.from(JSON.stringify({ text: { sidebarPrimary: '  acme  ', heroTitle: '自定义标题' } })),
  headers: { 'content-type': 'application/json' },
})
console.log('PUT config:', answer.status, answer.body)

answer = await call('PUT', '/brand-custom-api/image/sidebar-mark', { body: png, headers: { 'content-type': 'image/png' } })
console.log('PUT image:', answer.status, answer.body)

answer = await call('GET', '/brand-custom-api/image/sidebar-mark')
console.log('GET image:', answer.status, answer.headers['content-type'], answer.body.length > 0 ? '<bytes>' : '<empty>')

answer = await call('PUT', '/brand-custom-api/image/hero-mark', { body: Buffer.from('not a png'), headers: { 'content-type': 'image/png' } })
console.log('PUT bad image:', answer.status, answer.body)

answer = await call('PUT', '/brand-custom-api/image/hero-mark', { body: png, headers: { 'content-type': 'text/html' } })
console.log('PUT wrong type:', answer.status, answer.body)

answer = await call('DELETE', '/brand-custom-api/image/sidebar-mark')
console.log('DELETE image:', answer.status, answer.body)

answer = await call('GET', '/brand-custom-api/image/sidebar-mark')
console.log('GET missing image:', answer.status)

// One request from off the loopback address must be refused.
{
  const { stream, answer: refused, res } = request('GET', '/brand-custom-api/config')
  stream.socket = { remoteAddress: '10.0.0.5' }
  await routes.get('/brand-custom-api/config').handler(stream, res)
  console.log('off-loopback:', refused.status, refused.body)
}
// A foreign Origin must be refused too.
{
  const { stream, answer: refused, res } = request('GET', '/brand-custom-api/config', { headers: { origin: 'https://evil.example' } })
  await routes.get('/brand-custom-api/config').handler(stream, res)
  console.log('foreign origin:', refused.status, refused.body)
}

console.log('stored files:', readdirSync(join(home, 'plugins', 'dsh-brand-custom')).sort().join(', '))

for (const dispose of effects) if (typeof dispose === 'function') dispose()
rmSync(home, { recursive: true, force: true })
