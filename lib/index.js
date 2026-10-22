/**
 * dsh-brand-custom — node half.
 *
 * Owns the persisted brand configuration (four text slots and two uploaded
 * marks) and serves it to the browser half over the host's web server:
 *
 *   GET    /brand-custom-api/config          → { text, images }
 *   PUT    /brand-custom-api/config          → merge { text }, answers the new state
 *   GET    /brand-custom-api/image/<kind>    → the stored bytes (404 when absent)
 *   HEAD   /brand-custom-api/image/<kind>    → the same headers, no body
 *   PUT    /brand-custom-api/image/<kind>    → replace the bytes (content-type names the format)
 *   DELETE /brand-custom-api/image/<kind>    → remove the bytes
 *
 * `kind` is one of `sidebar-mark` / `hero-mark`. Everything lives under
 * `$DSH_HOME/plugins/dsh-brand-custom/`, so a hand-dropped file shows up on the
 * next status read and a profile wipe takes the images with it.
 *
 * The browser half is presentation only; it never writes files itself.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable Cordis plugin name (must match the bundle patch row). */
export const name = 'dsh-brand-custom'

/** Route prefix this plugin owns. The browser half addresses the same names. */
const API = '/brand-custom-api'

/** Image kinds, in the order the settings page lists them. */
const IMAGE_KINDS = ['sidebar-mark', 'hero-mark']

/** Content types accepted for an upload, mapped to the stored extension. */
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** Largest upload accepted, in bytes. */
const IMAGE_MAX_BYTES = 4 * 1024 * 1024

/**
 * The text slots, with the value each one falls back to when the reader clears
 * it. `null` means "leave the host's own copy alone"; a string the reader typed
 * always wins.
 */
const TEXT_SLOTS = ['sidebarPrimary', 'sidebarBadge', 'heroTitle', 'heroBadge']

/** Text length ceilings: the fields are labels, not documents. */
const TEXT_MAX = 120

/** Response headers for the stored images (an SVG is a document that can carry script). */
const IMAGE_HEADERS = {
  'cache-control': 'no-cache',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
}

/** Bytes a raster format opens with at a fixed offset; an SVG is text and carries none. */
const SIGNATURES = {
  'image/png': [{ offset: 0, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
  'image/webp': [
    { offset: 0, bytes: Buffer.from('RIFF', 'latin1') },
    { offset: 8, bytes: Buffer.from('WEBP', 'latin1') },
  ],
}

/**
 * The plugin's storage directory inside the harness home.
 * @param ctx - host plugin context (its `dshHomePath` service resolves the home).
 * @returns absolute directory path.
 */
function storageDirectory(ctx) {
  const resolve = ctx?.get?.('dshHomePath')
  const home = typeof resolve === 'function'
    ? resolve('plugins', name)
    : join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'plugins', name)
  return home
}

/** Answer one JSON payload; never cached by the browser. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

/** Answer 405 with the allowed methods. */
function methodRefused(req, res, methods) {
  if (methods.includes(req.method)) return false
  res.writeHead(405, { 'cache-control': 'no-store', allow: methods.join(', ') })
  res.end()
  return true
}

/**
 * Whether the request comes from this machine and this origin.
 *
 * A plugin route is reachable by anything the host's port is reachable from, so
 * every request is fenced: the peer must be on the loopback interface, the Host
 * header must name a loopback address, and a browser must report the request as
 * same-origin. No host service is consulted, so the fence keeps working on hosts
 * that do not expose one.
 */
function fenceRefused(req, res) {
  const refuse = (status, error) => {
    sendJson(res, status, { ok: false, error })
    return true
  }
  const peer = req.socket?.remoteAddress ?? ''
  const loopback = peer === '::1' || peer.startsWith('127.') || peer.startsWith('::ffff:127.')
  if (!loopback) return refuse(403, 'loopback clients only')

  const host = String(req.headers.host ?? '').toLowerCase()
  const hostName = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const hostOk = allowedHosts.has(hostName) || /^127\.\d+\.\d+\.\d+$/.test(hostName)
  if (!hostOk) return refuse(403, 'unexpected host')

  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return refuse(403, 'cross-origin request refused')

  const origin = req.headers.origin
  if (origin !== undefined) {
    let originHost = ''
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      return refuse(403, 'malformed origin')
    }
    if (originHost !== host) return refuse(403, 'origin does not match host')
  }
  return false
}

/** Read a request body up to `limit` bytes; `null` when it overflows. */
function readBody(req, limit) {
  return new Promise(resolve => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', chunk => {
      if (over) return
      size += chunk.length
      if (size > limit) {
        over = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

/** Whether the bytes open the way their declared raster format requires. */
function matchesSignature(type, bytes) {
  const marks = SIGNATURES[type]
  if (marks === undefined) return true
  return marks.every(({ offset, bytes: expected }) => bytes.subarray(offset, offset + expected.length).equals(expected))
}

/**
 * Reads and writes on the plugin's storage directory.
 * @param ctx - host plugin context.
 */
function createStore(ctx) {
  const dir = storageDirectory(ctx)
  const configPath = join(dir, 'config.json')

  /** Normalize one text value: trimmed, capped, or `null` when empty. */
  const text = value => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim().slice(0, TEXT_MAX)
    return trimmed === '' ? null : trimmed
  }

  /** The stored text slots, with anything unusable dropped to `null`. */
  const readText = () => {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      parsed = undefined
    }
    const source = parsed !== null && typeof parsed === 'object' && parsed.text !== null && typeof parsed.text === 'object'
      ? parsed.text
      : {}
    const answer = {}
    for (const slot of TEXT_SLOTS) answer[slot] = text(source[slot])
    return answer
  }

  const writeText = value => {
    const next = { ...readText(), ...value }
    mkdirSync(dir, { recursive: true })
    const temporary = `${configPath}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, text: next }, null, 2))
    renameSync(temporary, configPath)
    return next
  }

  /** The file holding one image, in the type table's order, or `null`. */
  const find = kind => {
    for (const [type, extension] of Object.entries(IMAGE_TYPES)) {
      const path = join(dir, `${kind}.${extension}`)
      const stat = statSync(path, { throwIfNoEntry: false })
      if (stat?.isFile() !== true) continue
      return { path, type, state: { type, version: `${Math.round(stat.mtimeMs)}-${stat.size}` } }
    }
    return null
  }

  const answer = () => {
    const images = {}
    for (const kind of IMAGE_KINDS) images[kind] = find(kind)?.state ?? null
    return { ok: true, text: readText(), images }
  }

  /**
   * Replace one image atomically: the bytes land through a temporary file and a
   * rename, and the same image under another extension goes afterwards, so a
   * status read always finds exactly one file.
   */
  const write = (kind, type, bytes) => {
    const extension = IMAGE_TYPES[type]
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `${kind}.${extension}`)
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, bytes)
    renameSync(temporary, target)
    for (const other of Object.values(IMAGE_TYPES)) {
      if (other !== extension) rmSync(join(dir, `${kind}.${other}`), { force: true })
    }
  }

  const remove = kind => {
    for (const extension of Object.values(IMAGE_TYPES)) rmSync(join(dir, `${kind}.${extension}`), { force: true })
  }

  return { find, answer, write, remove, readText, writeText, text }
}

/**
 * Register the plugin's routes on the host web server.
 * @param ctx - host plugin context.
 * @param store - the storage above.
 * @returns disposer.
 */
function registerRoutes(ctx, store) {
  const disposers = []
  const register = (route, label) => {
    try {
      disposers.push(ctx.webServer.register(route))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-brand-custom: route "${label}" was refused: ${String(error?.message ?? error)}`)
    }
  }

  register({
    kind: 'exact',
    path: `${API}/config`,
    handler: async (req, res) => {
      if (methodRefused(req, res, ['GET', 'PUT'])) return
      if (fenceRefused(req, res)) return
      if (req.method === 'GET') {
        sendJson(res, 200, store.answer())
        return
      }
      const bytes = await readBody(req, 64 * 1024)
      if (bytes === null) {
        sendJson(res, 413, { ok: false, error: 'config body too large' })
        return
      }
      let payload
      try {
        payload = JSON.parse(bytes.toString('utf8'))
      } catch {
        sendJson(res, 400, { ok: false, error: 'config body is not JSON' })
        return
      }
      const incoming = payload !== null && typeof payload === 'object' ? payload.text : undefined
      if (incoming !== undefined && (incoming === null || typeof incoming !== 'object')) {
        sendJson(res, 400, { ok: false, error: 'config.text must be an object' })
        return
      }
      const patch = {}
      for (const slot of TEXT_SLOTS) {
        if (incoming === undefined || !(slot in incoming)) continue
        patch[slot] = incoming[slot] === null ? null : store.text(incoming[slot])
      }
      try {
        store.writeText(patch)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, store.answer())
    },
  }, 'config')

  for (const kind of IMAGE_KINDS) {
    register({
      kind: 'exact',
      path: `${API}/image/${kind}`,
      handler: async (req, res) => {
        if (methodRefused(req, res, ['GET', 'HEAD', 'PUT', 'DELETE'])) return
        if (fenceRefused(req, res)) return

        if (req.method === 'PUT') {
          const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
          if (IMAGE_TYPES[type] === undefined) {
            sendJson(res, 415, { ok: false, error: 'unsupported image type' })
            return
          }
          const bytes = await readBody(req, IMAGE_MAX_BYTES)
          if (bytes === null) {
            res.once('finish', () => req.destroy())
            sendJson(res, 413, { ok: false, error: 'image too large' })
            return
          }
          if (bytes.length === 0 || !matchesSignature(type, bytes)) {
            sendJson(res, 400, { ok: false, error: 'not an image of the declared type' })
            return
          }
          try {
            store.write(kind, type, bytes)
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            return
          }
          sendJson(res, 200, store.answer())
          return
        }

        if (req.method === 'DELETE') {
          try {
            store.remove(kind)
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            return
          }
          sendJson(res, 200, store.answer())
          return
        }

        const found = store.find(kind)
        if (found === null) {
          res.writeHead(404, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        let body
        try {
          body = readFileSync(found.path)
        } catch {
          res.writeHead(404, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        res.writeHead(200, { ...IMAGE_HEADERS, 'content-type': found.type, 'content-length': String(body.byteLength) })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    }, `image ${kind}`)
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {}
    }
    disposers.length = 0
  }
}

/**
 * Plugin body: hand the settings page to the host, then mount the routes once the
 * web server is available.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const store = createStore(ctx)
  ctx.inject(['webServer'], scope => {
    const dispose = registerRoutes(scope, store)
    scope.effect(() => dispose, 'dsh-brand-custom: routes')
  })
}
