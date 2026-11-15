/**
 * Route test for the Host half: the state resource answers with the audit
 * snapshot, three successful identical calls propose a rule, and the action
 * handler approves it.
 *
 * Run with `node test/routes.mjs`.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFile as readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const base = await mkdtemp(join(tmpdir(), 'dsh-tool-audit-routes-'))
process.env.DSH_TOOL_AUDIT_DIR = base

const handlers = new Map()
const routes = new Map()
const stored = new Map()
const credentials = {
  async resolve(ref) {
    const value = stored.get(ref)
    if (value !== undefined) return { value, source: 'store' }
    const fromEnv = process.env[ref]
    return fromEnv === undefined ? undefined : { value: fromEnv, source: 'environment' }
  },
  async describe(ref) {
    const value = stored.get(ref)
    if (value !== undefined) return { configured: true, source: 'store', writable: true }
    const fromEnv = process.env[ref]
    return { configured: fromEnv !== undefined, source: fromEnv === undefined ? undefined : 'environment', writable: true }
  },
  async set(ref, value) { stored.set(ref, value) },
  async unset(ref) { stored.delete(ref) },
}
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : undefined
  },
  on(event, handler) {
    handlers.set(event, [...(handlers.get(event) ?? []), handler])
  },
  get(name) {
    if (name === 'credentials') return credentials
    if (name !== 'webServer') return undefined
    return {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    }
  },
}

apply(ctx, { mode: 'observe', provider: 'jev', endpoint: 'https://example.invalid/decisions' })
await new Promise(resolve => setTimeout(resolve, 300))

const stateRoute = routes.get('/dsh-tool-audit/state')
if (stateRoute === undefined) throw new Error('state route was not registered')
const actionRoute = routes.get('/dsh-tool-audit/action')
if (actionRoute === undefined) throw new Error('action route was not registered')

const stateRequest = headers => new Request('http://127.0.0.1/dsh-tool-audit/state', { headers })
const readState = async () => (await stateRoute.resource(stateRequest({ 'x-dsh-tool-audit': '1' }))).json()

const forbidden = await stateRoute.resource(stateRequest({}))
if (forbidden.status !== 403) throw new Error(`expected 403 without the plugin header, got ${forbidden.status}`)

const initial = await readState()
if (initial.config.mode !== 'observe') throw new Error(`unexpected mode ${initial.config.mode}`)
if (initial.pendingTotal !== 0) throw new Error('expected no pending work')

const pre = handlers.get('tools/pre-execute')[0]
const result = handlers.get('tools/result')[0]
if (pre === undefined || result === undefined) throw new Error('pipeline listeners were not registered')

const exec = {
  name: 'bash',
  callId: 'call-1',
  arguments: { command: 'node --version' },
  agent: { session: { id: 'session-1' } },
  signal: new AbortController().signal,
}

for (let index = 0; index < 3; index += 1) {
  await pre({ ...exec, callId: `call-${index}` }, async () => ({ kind: 'allow' }))
  result({ ...exec, callId: `call-${index}` }, { isError: false })
  await new Promise(resolve => setTimeout(resolve, 250))
}

const proposed = await readState()
if (proposed.rules.length !== 1) throw new Error(`expected one proposed rule, got ${proposed.rules.length}`)
if (proposed.rules[0].status !== 'proposed') throw new Error('rule should be proposed')
// One proposed rule plus the binary the calls resolved; both wait for review.
if (proposed.pendingTotal !== 2) throw new Error(`expected two pending items, got ${proposed.pendingTotal}`)

/** POST one action through the route handler. */
async function post(action, payload) {
  const body = JSON.stringify({ action, payload })
  const request = {
    method: 'POST',
    headers: { 'x-dsh-tool-audit': '1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body, 'utf8')
    },
  }
  let status = 0
  let text = ''
  const response = {
    writeHead(code) { status = code },
    end(value) { text = value ?? '' },
  }
  await actionRoute.handler(request, response)
  if (status !== 200) throw new Error(`action ${action} returned ${status}: ${text}`)
  return JSON.parse(text)
}

const after = await post('approve-rule', { id: proposed.rules[0].id })
if (after.rules[0].status !== 'approved') throw new Error('rule was not approved')
if (after.pendingTotal !== 1) throw new Error('only the unverified binary should remain pending')

const keyed = await post('set-api-key', { value: 'stored-key' })
if (keyed.key.configured !== true) throw new Error('stored key was not reported as configured')
if (keyed.key.source !== 'store') throw new Error(`unexpected key source ${keyed.key.source}`)
if (keyed.key.name !== 'DSH_TOOL_AUDIT_JEV_API_KEY') throw new Error(`unexpected credential name ${keyed.key.name}`)
if (JSON.stringify(keyed).includes('stored-key')) throw new Error('the key value must never reach the client')

const cleared = await post('clear-api-key', {})
if (cleared.key.configured !== false) throw new Error('cleared key still reports configured')

const persisted = JSON.parse(await readFile(join(base, 'state.json'), 'utf8'))
if (persisted.rules[0].status !== 'approved') throw new Error('approval was not persisted')

void readFileSync
await rm(base, { recursive: true, force: true })
console.log('routes test passed')
