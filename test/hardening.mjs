/**
 * Failure-containment test: a plugin that cannot do one of its jobs must cost
 * the reader that job and nothing else.
 *
 * The host turns a throwing `apply` into a failed entry, and the web boot treats
 * any failed entry as fatal for the whole page, so both halves fence every step
 * whose failure is survivable. This test attacks those fences.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const here = dirname(fileURLToPath(import.meta.url))
const react = createRequire('C:/Users/Lenovo/.dsh/profiles/desktop/package.json')('react')

//#region node half: routes never reject, mounting never throws
{
  const home = mkdtempSync(join(tmpdir(), 'brand-custom-harden-'))
  const routes = new Map()
  const warnings = []
  const logger = { warn: message => warnings.push(message) }

  const stub = {
    get: key => (key === 'dshHomePath' ? (...segments) => join(home, ...segments) : undefined),
    inject: (services, body) => {
      body({
        webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } },
        effect: run => run(),
        get: stub.get,
        logger,
      })
    },
    logger,
  }

  const { apply } = await import('../lib/index.js')
  apply(stub)

  // A web server that refuses to register must leave `apply` a no-op, not a throw.
  apply({
    get: () => undefined,
    inject: (services, body) => {
      body({
        webServer: { register: () => { throw new Error('route table is frozen') } },
        effect: run => run(),
        logger,
      })
    },
    logger,
  })
  console.log('refused registration warned:', warnings.some(line => line.includes('route table is frozen')))

  /** A response recorder that also records a hard destroy. */
  const sink = () => {
    const chunks = []
    const answer = { status: 0, headers: {}, destroyed: false }
    return {
      answer,
      res: {
        headersSent: false,
        writeHead(status, headers) {
          this.headersSent = true
          answer.status = status
          answer.headers = headers ?? {}
          return this
        },
        end(payload) {
          if (payload !== undefined) chunks.push(Buffer.from(payload))
          answer.body = Buffer.concat(chunks).toString('utf8')
        },
        destroy() {
          answer.destroyed = true
        },
        once() {},
      },
    }
  }

  const call = async (method, path, { body, headers = {} } = {}) => {
    const stream = Readable.from(body === undefined ? [] : [body])
    stream.method = method
    stream.url = path
    stream.headers = { host: '127.0.0.1:63177', 'sec-fetch-site': 'same-origin', ...headers }
    stream.socket = { remoteAddress: '127.0.0.1' }
    const { answer, res } = sink()
    await routes.get(path).handler(stream, res)
    return answer
  }

  // A body that never ends and never errors: the route must not stay pending.
  {
    const stream = new Readable({ read() {} })
    stream.method = 'PUT'
    stream.url = '/brand-custom-api/config'
    stream.headers = { host: '127.0.0.1:63177', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
    stream.socket = { remoteAddress: '127.0.0.1' }
    const { answer, res } = sink()
    const pending = routes.get('/brand-custom-api/config').handler(stream, res)
    stream.destroy()                    // no 'end', no 'error' — only 'close'
    await pending
    console.log('disconnected upload answered:', answer.status)
  }

  // A malformed JSON body is a 400, and a non-object `text` is a 400.
  console.log('broken json:', JSON.stringify(await call('PUT', '/brand-custom-api/config', { body: '{', headers: { 'content-type': 'application/json' } })))
  console.log('text not an object:', JSON.stringify(await call('PUT', '/brand-custom-api/config', { body: '{"text":"x"}', headers: { 'content-type': 'application/json' } })))

  rmSync(home, { recursive: true, force: true })
}
//#endregion

//#region browser half: one broken service costs one feature
{
  const registrations = []
  const slots = {
    inject(name, body) { return body({ slots }) },
    register(options, component) {
      const entry = { options, component, disposed: false }
      registrations.push(entry)
      return () => { entry.disposed = true }
    },
  }

  /** A locale service whose namespace is already taken by another plugin. */
  const takenLocale = {
    register() { throw new Error('locale namespace "dsh-brand-custom" already has locale "zh"') },
    bind() { return key => key },
  }

  /** A settings shell that does not declare the slot this plugin wants. */
  const closedSlots = {
    inject(name, body) {
      if (name === 'settings.section') throw new Error('slot "settings.section" is not declared')
      return body({ slots: closedSlots })
    },
    register(options) {
      if (options.name === 'settings.section') throw new Error('slot "settings.section" is not declared')
      registrations.push({ options, disposed: false })
      return () => {}
    },
  }

  const effects = []
  const warns = []
  const originalWarn = console.warn
  console.warn = message => warns.push(String(message))

  const document = { querySelector: () => null, body: null }
  const window = {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, text: {}, images: {} }) }),
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: handle => clearTimeout(handle),
  }

  let loaded
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      loaded = { id, exports: factory(specifier => (specifier === 'react' ? react : undefined)) }
    },
  }
  const source = (await import('node:fs')).readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
  new Function('window', 'document', 'globalThis', source)(window, document, { window, document })

  // Every service this plugin touches is broken in a different way.
  const hostile = {
    slots: closedSlots,
    locale: takenLocale,
    effect(body) { const dispose = body(); effects.push(dispose); return dispose },
    inject(services, body) { body(hostile) },
  }

  let threw = null
  try {
    loaded.exports.apply(hostile)
  } catch (error) {
    threw = error
  }
  console.warn = originalWarn

  console.log('apply threw:', threw === null ? 'no' : String(threw.message))
  console.log('warnings:', warns.length)
  for (const line of warns) console.log('  ', line)
  console.log('registrations:', registrations.length)
  console.log('effects registered:', effects.length)
}
//#endregion

//#region browser half: a healthy host still gets everything
{
  const registrations = []
  const slots = {
    inject(name, body) { return body({ slots }) },
    register(options, component) {
      registrations.push({ options, component, disposed: false })
      return () => {}
    },
  }
  const namespaces = []
  const locale = {
    register(namespace) { namespaces.push(namespace); return () => {} },
    bind(namespace) { return key => `${namespace}:${key}` },
  }

  const effects = []
  const ctx = {
    slots,
    locale,
    effect(body, label) { const dispose = body(); effects.push({ label, dispose }); return dispose },
    inject(services, body) { body(ctx) },
  }

  const document = { querySelector: () => null, body: null }
  const window = {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, text: {}, images: {} }) }),
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: handle => clearTimeout(handle),
  }
  let loaded
  window.__ModuleLoader__ = {
    load({ id, factory }) { loaded = { id, exports: factory(specifier => (specifier === 'react' ? react : undefined)) } },
  }
  const source = (await import('node:fs')).readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
  new Function('window', 'document', 'globalThis', source)(window, document, { window, document })

  loaded.exports.apply(ctx)
  console.log('healthy — namespaces:', namespaces.join(', '))
  console.log('healthy — registrations:', registrations.map(entry => entry.options.name).join(', '))
  console.log('healthy — effects:', effects.map(entry => entry.label).join(' | '))
}
//#endregion
