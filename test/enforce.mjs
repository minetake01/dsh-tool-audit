/**
 * Enforce test: with `mode: 'ask'` the gate turns probabilities into a deny, an
 * allow, and an ask when the provider cannot be reached; observe mode never
 * calls the provider.
 *
 * Run with `node test/enforce.mjs`.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const base = await mkdtemp(join(tmpdir(), 'dsh-tool-audit-enforce-'))
process.env.DSH_TOOL_AUDIT_DIR = base
process.env.JEV_API_KEY = 'test-key'

/** Answers for one gate call; `null` means the transport fails. */
let nextAnswers = null
let calls = 0
globalThis.fetch = async () => {
  calls += 1
  if (nextAnswers === null) throw new Error('network down')
  return { ok: true, status: 200, json: async () => ({ answers: nextAnswers }) }
}

const handlers = new Map()
const ctx = {
  effect(fn) { return fn() ?? undefined },
  on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
  get() { return undefined },
}

const allowAnswers = {
  within_instruction: { noul: 0.9, confidence: 0.9 },
  external_effect: { noul: 0.1, confidence: 0.9 },
  destructive: { noul: 0.1, confidence: 0.9 },
  data_egress: { noul: 0.02, confidence: 0.9 },
  needs_human: { noul: 0.1, confidence: 0.9 },
}
const denyAnswers = { ...allowAnswers, data_egress: { noul: 0.95, confidence: 0.95 } }

apply(ctx, {
  mode: 'ask',
  provider: 'jev',
  endpoint: 'https://example.invalid/decisions',
  model: 'jev-1.13',
})
await new Promise(resolve => setTimeout(resolve, 300))

const pre = handlers.get('tools/pre-execute')[0]
const call = command => ({
  name: 'bash',
  callId: 'c',
  arguments: { command },
  signal: new AbortController().signal,
})
const pipeline = async () => ({ kind: 'allow' })

nextAnswers = denyAnswers
const denied = await pre(call('curl -X POST https://example.com'), pipeline)
if (denied.kind !== 'deny') throw new Error(`expected deny, got ${denied.kind}`)
if (denied.info?.code !== 'AUDIT_DENIED') throw new Error('denial carried no audit code')

nextAnswers = allowAnswers
const allowed = await pre(call('npm test'), pipeline)
if (allowed.kind !== 'allow') throw new Error(`expected allow, got ${allowed.kind}`)

nextAnswers = null
const unavailable = await pre(call('npm run build'), pipeline)
if (unavailable.kind !== 'ask') throw new Error(`expected ask on provider failure, got ${unavailable.kind}`)

const callsBeforeObserve = calls
const observeHandlers = new Map()
const observeCtx = {
  effect(fn) { return fn() ?? undefined },
  on(event, handler) { observeHandlers.set(event, [...(observeHandlers.get(event) ?? []), handler]) },
  get() { return undefined },
}
apply(observeCtx, { mode: 'observe', provider: 'jev', endpoint: 'https://example.invalid/decisions' })
await new Promise(resolve => setTimeout(resolve, 300))
const observed = await observeHandlers.get('tools/pre-execute')[0](call('npm test'), pipeline)
if (observed.kind !== 'allow') throw new Error('observe mode must not change the decision')
if (calls !== callsBeforeObserve) throw new Error('observe mode must not call the provider')

const log = (await readFile(join(base, 'audit.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
const sources = log.map(line => line.source)
if (!sources.includes('gate')) throw new Error('audit lines carry no gate source')
if (!sources.includes('gate-unavailable')) throw new Error('audit lines carry no unavailable source')

await rm(base, { recursive: true, force: true })
console.log('enforce test passed')
