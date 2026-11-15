/**
 * Smoke test for the Host half: apply the plugin to a stub context, feed one
 * bash call through the waterfall, and assert the audit line and binary pin.
 *
 * Run with `node test/smoke.mjs`.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const base = await mkdtemp(join(tmpdir(), 'dsh-tool-audit-'))
process.env.DSH_TOOL_AUDIT_DIR = base

const handlers = new Map()
const disposers = []
const ctx = {
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  on(event, handler) {
    handlers.set(event, [...(handlers.get(event) ?? []), handler])
  },
  get() {
    return undefined
  },
}

apply(ctx, { mode: 'observe' })
await new Promise(resolve => setTimeout(resolve, 300))

const pre = handlers.get('tools/pre-execute')?.[0]
if (pre === undefined) throw new Error('pre-execute listener was not registered')

const exec = {
  name: 'bash',
  callId: 'call-1',
  arguments: { command: 'node --version' },
  agent: { session: { id: 'session-1' } },
  signal: new AbortController().signal,
}

const decision = await pre(exec, async () => ({ kind: 'allow' }))
if (decision.kind !== 'allow') throw new Error(`expected allow, got ${decision.kind}`)
// The state file is written on a quiet window rather than per call.
await new Promise(resolve => setTimeout(resolve, 900))

const auditFile = join(base, 'audit.jsonl')
if (!existsSync(auditFile)) throw new Error('audit.jsonl was not written')
const lines = (await readFile(auditFile, 'utf8')).split('\n').filter(Boolean)
if (lines.length !== 1) throw new Error(`expected one audit line, got ${lines.length}`)
const line = JSON.parse(lines[0])
if (line.tool !== 'bash') throw new Error(`unexpected tool ${line.tool}`)
if (line.binaries.length !== 1) throw new Error('expected one probed binary')
if (typeof line.binaries[0].sha256 !== 'string') throw new Error('expected a binary hash')
if (line.decision !== 'allow') throw new Error(`unexpected decision ${line.decision}`)

const stateFile = join(base, 'state.json')
if (!existsSync(stateFile)) throw new Error('state.json was not written')
const state = JSON.parse(await readFile(stateFile, 'utf8'))
const pinned = Object.values(state.binaries)
if (pinned.length !== 1) throw new Error(`expected one binary pin, got ${pinned.length}`)
if (pinned[0].trust !== 'unknown') throw new Error(`unexpected trust ${pinned[0].trust}`)

for (const dispose of disposers) dispose()
await rm(base, { recursive: true, force: true })
console.log('smoke test passed')
