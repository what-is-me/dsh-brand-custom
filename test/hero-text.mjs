/**
 * DOM-level test for the hero label rewrite: builds the two spans the host
 * renders, mounts the plugin, and checks that a cleared field hands the host's
 * own copy back rather than leaving the reader's text in place.
 *
 * A hand-built tree stands in for jsdom: the rewrite only reaches for
 * `querySelector`, `parentElement`, `children`, `contains` and `textContent`.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const react = createRequire('C:/Users/Lenovo/.dsh/profiles/desktop/package.json')('react')

//#region a hand-built hero
function node(tag, text = '') {
  return {
    tag,
    textContent: text,
    children: [],
    contains(other) {
      if (this === other) return true
      return this.children.some(child => child.contains?.(other) === true)
    },
    /** Append a child and keep returning the parent, so chains read inner-to-outer. */
    append(child) {
      this.children.push(child)
      child.parentElement = this
      return this
    },
  }
}

const label = node('span', '探索未至之境')
const tag = node('span', '预览版')
/** The title group: the label first, the preview tag second. */
const titleGroup = node('span').append(label).append(tag)
/** The mark hitbox whose only child is the slot outlet the plugin looks for. */
const outlet = node('div')
const hitbox = node('span').append(outlet)
/** The headline: the hitbox first, the title group second. */
const headline = node('div').append(hitbox).append(titleGroup)

const document = {
  querySelector: selector => (selector === '[data-slot="conversation.hero.brand.mark"]' ? outlet : null),
  getElementById: () => null,
  body: node('body'),
}
//#endregion

//#region host stubs
const registrations = []
const slots = {
  inject: (name, body) => body({ slots }),
  register(options, component) {
    const entry = { options, component, disposed: false }
    registrations.push(entry)
    return () => {
      entry.disposed = true
    }
  },
}
const locale = {
  register() {
    return () => {}
  },
  bind: prefix => key => `${prefix}:${key}`,
  getSnapshot: () => ({ revision: 0, active: 'zh' }),
}

/** What the stub route answers; the test swaps this between phases. */
let answer = { ok: true, text: {}, images: {} }
const calls = []

const window = {
  fetch: async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    return { ok: true, status: 200, json: async () => answer }
  },
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: handle => clearTimeout(handle),
  MutationObserver: class {
    constructor(callback) {
      this.callback = callback
      this.observed = false
    }
    observe() {
      this.observed = true
    }
    disconnect() {
      this.observed = false
    }
  },
}

const effects = []
const ctx = {
  slots,
  locale,
  effect(body, name) {
    const dispose = body()
    effects.push({ name, dispose })
    return dispose
  },
  inject: (services, body) => body(ctx),
}

let loaded
window.__ModuleLoader__ = {
  load({ id, factory }) {
    loaded = { id, exports: factory(specifier => (specifier === 'react' ? react : (() => { throw new Error(specifier) })())) }
  },
}
//#endregion

new Function('window', 'document', readFileSync(join(here, '..', 'client', 'client.js'), 'utf8'))(window, document)
loaded.exports.apply(ctx)

/** Let the queued loads and animation frames settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

await settle()
console.log('after mount — label:', JSON.stringify(label.textContent), 'tag:', JSON.stringify(tag.textContent))
console.log('initial read:', calls.map(call => `${call.method} ${call.url}`).join(', '))

// Phase 2: the reader types a headline and a badge, and the store picks them up.
answer = { ok: true, text: { heroTitle: '我的标题', heroBadge: '内测' }, images: {} }
calls.length = 0
const section = registrations.find(entry => entry.options.name === 'settings.section')
const shared = section.options.inject().store
console.log('setText:', await shared.setText('heroTitle', '我的标题'))
await settle()
await settle()
console.log('after save — label:', JSON.stringify(label.textContent), 'tag:', JSON.stringify(tag.textContent))

// Phase 3: clearing the field must restore the host's own copy.
answer = { ok: true, text: { heroTitle: null, heroBadge: null }, images: {} }
console.log('clear:', await shared.setText('heroTitle', null))
await settle()
await settle()
console.log('after clear — label:', JSON.stringify(label.textContent), 'tag:', JSON.stringify(tag.textContent))

for (const { dispose } of effects) if (typeof dispose === 'function') dispose()
