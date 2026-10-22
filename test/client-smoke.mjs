/**
 * Smoke test for the browser half: loads the bundle the way the host's module
 * loader does, runs `apply` against a stub plugin context, and checks that the
 * settings section and the three brand slots land with the shapes the host
 * expects. No DOM is involved — the plugin's own occupants are plain elements
 * built through `react.createElement`, and the hero rewrite is exercised
 * separately against a hand-built tree.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'package.json'))

/** Resolve `react` from the profile that actually runs the plugin. */
const react = createRequire('C:/Users/Lenovo/.dsh/profiles/desktop/package.json')('react')

//#region host stubs
/** Records one registration so the assertions can read it back. */
const registrations = []

/** A stand-in for the host's slot service. */
const slots = {
  injected: [],
  inject(name, body) {
    slots.injected.push(name)
    return body({ slots })
  },
  register(options, component) {
    const entry = { options, component, disposed: false }
    registrations.push(entry)
    return () => {
      entry.disposed = true
    }
  },
}

/** A stand-in for the host's locale service. */
const locale = {
  namespaces: [],
  register(namespace, dictionaries) {
    if (locale.namespaces.includes(namespace)) throw new Error(`duplicate namespace ${namespace}`)
    for (const [id, dict] of Object.entries(dictionaries)) {
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(id)) throw new Error(`bad locale id ${id}`)
      if (Object.keys(dict).length === 0) throw new Error(`empty dictionary ${id}`)
    }
    locale.namespaces.push(namespace)
    return () => {
      locale.namespaces = locale.namespaces.filter(entry => entry !== namespace)
    }
  },
  bind(namespace) {
    return key => `${namespace}:${key}`
  },
  getSnapshot: () => ({ revision: 0, active: 'zh' }),
}

/** Effects the plugin asked for, in order. */
const effects = []

const ctx = {
  slots,
  locale,
  effect(body, label) {
    const dispose = body()
    effects.push({ label, dispose })
    return dispose
  },
  inject(services, body) {
    body(ctx)
  },
}

/** A document with no hero and no body wiring: the rewrite stays inert here. */
const document = {
  querySelector: () => null,
  getElementById: () => null,
  body: { nodeType: 1 },
}

const window = {
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, text: {}, images: {} }),
  }),
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: handle => clearTimeout(handle),
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
}

let loaded
window.__ModuleLoader__ = {
  load({ id, factory }) {
    loaded = { id, exports: factory(specifier => {
      if (specifier === 'react') return react
      throw new Error(`unexpected require("${specifier}")`)
    }) }
  },
}
//#endregion

const source = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')
new Function('window', 'document', 'globalThis', source)(window, document, { window, document })

console.log('module id:', loaded.id)
console.log('exports:', Object.keys(loaded.exports).join(', '))
console.log('inject:', JSON.stringify(loaded.exports.inject))

// The host calls apply with its plugin context and reads nothing back.
loaded.exports.apply(ctx)

console.log('locale namespaces:', locale.namespaces.join(', '))
console.log('slots injected:', slots.injected.join(', '))
console.log('registrations:', registrations.map(entry => `${entry.options.name}#${entry.options.id ?? '-'}@${entry.options.priority ?? 0}`).join(' '))
console.log('effects:', effects.map(effect => effect.label).join(' | '))

// The settings section must carry the id/order/label the navigation reads.
const section = registrations.find(entry => entry.options.name === 'settings.section')
if (section === undefined) throw new Error('no settings.section registration')
console.log('section id:', section.options.id, 'order:', section.options.order, 'label:', section.options.label())

// With nothing stored, no brand slot may be occupied yet: the official brand stays.
const brandSlots = registrations.filter(entry => entry.options.priority === -1)
console.log('shadowing registrations at this point:', brandSlots.length)

// Render the settings section for real: collapse the hooks to their initial
// values, which is what catches a broken element builder.
const realHook = react.useSyncExternalStore
const realState = react.useState
react.useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot()
react.useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]
const injected = section.options.inject()
const tree = section.component({ t: injected.t, store: injected.store })
react.useSyncExternalStore = realHook
react.useState = realState
console.log('section root:', tree.type, 'children:', tree.props.children.length)
console.log('section data attr:', JSON.stringify(tree.props['data-brand-custom-settings']))

// Every card must carry its title and its four rows.
for (const child of tree.props.children) {
  if (child === null || typeof child !== 'object') continue
  const group = child.props?.['data-brand-custom-group']
  if (group !== undefined) console.log(`card ${group}:`, child.props.children.length, 'children')
}

for (const { dispose } of effects) if (typeof dispose === 'function') dispose()
console.log('after dispose, live shadowing slots:', registrations.filter(e => e.options.priority === -1 && !e.disposed).length)
