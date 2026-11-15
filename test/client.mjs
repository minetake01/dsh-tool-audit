/**
 * Client smoke test: load the browser half through a stub module loader and
 * assert that it registers the sidebar entry, the audit panel, and the bundle
 * settings page into the expected slots.
 *
 * Run with `node test/client.mjs`.
 */

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: fn => fn,
  useRef: value => ({ current: value }),
}

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded.push(module)
    },
  },
}

await import('../client.js')

if (loaded.length !== 1) throw new Error(`expected one module, got ${loaded.length}`)
const module = loaded[0]
if (module.id !== 'dsh-tool-audit') throw new Error(`unexpected module id ${module.id}`)
const body = module.factory(name => {
  if (name !== 'react') throw new Error(`unexpected module request ${name}`)
  return React
})
if (typeof body.apply !== 'function') throw new Error('client half has no apply')

const registrations = []
const ctx = {
  effect(fn) {
    return fn()
  },
  locale: {
    register: () => () => {},
    bind: () => key => key,
  },
  slots: {
    inject(name, register) {
      registrations.push({ slot: name, register })
      return () => {}
    },
    register(options) {
      return { options }
    },
  },
}

body.apply(ctx)

const slots = registrations.map(entry => entry.slot).sort()
const expected = ['main', 'plugins.bundle.config', 'sidebar.panellist']
if (JSON.stringify(slots) !== JSON.stringify(expected)) {
  throw new Error(`unexpected slots: ${slots.join(', ')}`)
}
for (const entry of registrations) entry.register()
console.log('client test passed')
