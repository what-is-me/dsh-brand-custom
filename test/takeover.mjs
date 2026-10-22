/**
 * Behaviour test for the slot takeover: with nothing stored no brand slot is
 * occupied (the official brand keeps painting), and the moment a value arrives
 * each affected slot gains a shadowing registration at priority -1 — which is
 * what makes the host's own occupant stop rendering. Clearing it again puts the
 * slot back.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const react = createRequire('C:/Users/Lenovo/.dsh/profiles/desktop/package.json')('react')

/** Call a component as a plain function: the hook collapses to the live snapshot. */
react.useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot()

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
const locale = { register: () => () => {}, bind: p => k => `${p}:${k}`, getSnapshot: () => ({ revision: 0, active: 'zh' }) }

/** The node half's answer, swapped per phase. */
let answer = { ok: true, text: {}, images: {} }
const window = {
  fetch: async () => ({ ok: true, status: 200, json: async () => answer }),
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: handle => clearTimeout(handle),
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
}
const document = { querySelector: () => null, getElementById: () => null, body: { children: [], contains: () => false } }

const effects = []
const ctx = { slots, locale, effect: (body, name) => {
  const dispose = body()
  effects.push({ name, dispose })
  return dispose
}, inject: (services, body) => body(ctx) }

let loaded
window.__ModuleLoader__ = { load({ factory, id }) {
  loaded = { id, exports: factory(s => (s === 'react' ? react : (() => { throw new Error(s) })())) }
} }
new Function('window', 'document', readFileSync(join(here, '..', 'client', 'client.js'), 'utf8'))(window, document)
loaded.exports.apply(ctx)

const settle = () => new Promise(resolve => setTimeout(resolve, 25))
const live = () => registrations.filter(entry => !entry.disposed)

await settle()
console.log('phase 1 (nothing stored) — live slots:', live().map(entry => entry.options.name).join(', '))

const shared = registrations.find(entry => entry.options.name === 'settings.section').options.inject().store

// Phase 2: the reader supplies a sidebar label and a hero mark.
answer = {
  ok: true,
  text: { sidebarPrimary: 'acme' },
  images: { 'hero-mark': { type: 'image/png', version: '1-100' } },
}
await shared.setText('sidebarPrimary', 'acme')
await settle()
console.log('phase 2 (label + hero mark) — live slots:', live().map(entry => `${entry.options.name}@${entry.options.priority}`).join(', '))

// The occupants must render the reader's values, not the host's.
const nameEntry = live().find(entry => entry.options.name === 'sidebar.brand.name')
const HeroMark = live().find(entry => entry.options.name === 'conversation.hero.brand.mark').component
const hero = HeroMark({ size: 34, className: 'hostClass' })
console.log('hero mark element:', hero.type, hero.props.src, hero.props.width, hero.props.className)

// Phase 3: clearing everything hands every slot back.
answer = { ok: true, text: {}, images: {} }
await shared.setText('sidebarPrimary', null)
await settle()
console.log('phase 3 (cleared) — live slots:', live().map(entry => entry.options.name).join(', '))

// Phase 4: an uploaded sidebar mark occupies only its own slot.
answer = { ok: true, text: {}, images: { 'sidebar-mark': { type: 'image/svg+xml', version: '2-200' } } }
await shared.uploadImage('sidebar-mark', { type: 'image/svg+xml' })
await settle()
const markOnly = live().filter(entry => entry.options.priority === -1)
console.log('phase 4 (sidebar mark only) —', markOnly.map(entry => entry.options.name).join(', '))
const SidebarMark = markOnly[0].component
const mark = SidebarMark({ size: 24 })
console.log('sidebar mark element:', mark.type, mark.props.src)

for (const { dispose } of effects) if (typeof dispose === 'function') dispose()
console.log('after dispose — live slots:', live().map(entry => entry.options.name).join(', '))
