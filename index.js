/**
 * Host half of dsh-tool-audit.
 *
 * Every call passes through the audit before its body runs:
 *
 * 1. the executables a shell call names are resolved and hashed;
 * 2. a release pin classifies each hash as pinned, unknown, or a mismatch that
 *    opens one diff review;
 * 3. an approved command rule may allow the call without a model decision;
 * 4. otherwise the decision gate asks the configured decision model, and the
 *    probabilities become allow, ask, or deny.
 *
 * `observe` records all of that and changes nothing. `ask` and `enforce` apply
 * the decision. State lives in `$DSH_HOME/plugins/dsh-tool-audit/`; the Web
 * client reads it through the routes in `src/api.js`.
 *
 * @module dsh-tool-audit
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { appendAudit, emptyState, loadState, trimAuditLog, writeJsonAtomic } from './src/store.js'
import { BinaryProbe, tokenize } from './src/command.js'
import { classifyBinary, rememberBinaries } from './src/releases.js'
import { buildState, decide, requestDecision } from './src/gate.js'
import { createApi, registerRoutes } from './src/api.js'
import { credentialNameFor, pickSettings, resolveConfig } from './src/config.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-tool-audit'

/** The tool service owns the pipeline this plugin audits. */
export const inject = ['tools']

/**
 * Plugin-scope warning channel; the Host log carries plugin diagnostics.
 * @param {string} message - diagnostic text.
 */
function warn(message) {
  console.warn(`[dsh-tool-audit] ${message}`)
}

/**
 * Harness home directory; DSH_HOME wins over the conventional `~/.dsh`.
 * @returns {string} absolute directory.
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Install the audit plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown> | undefined} rawConfig - Loader row config.
 */
export function apply(ctx, rawConfig) {
  const rowConfig = resolveConfig(rawConfig ?? {})
  const baseDir = process.env.DSH_TOOL_AUDIT_DIR ?? join(dshHome(), 'plugins', 'dsh-tool-audit')
  const stateFile = join(baseDir, 'state.json')
  const auditFile = join(baseDir, 'audit.jsonl')

  /** In-memory mirror of the state file. */
  let state = emptyState()
  /** Effective configuration: defaults, row config, then user settings. */
  let config = rowConfig
  const probe = new BinaryProbe()
  let ready = false
  let writeChain = Promise.resolve()
  let pendingTimer = null

  /** Persist the current state now, serialized with earlier writes. */
  function persist() {
    writeChain = writeChain
      .catch(() => {})
      .then(() => writeJsonAtomic(stateFile, state))
      .catch(error => { warn(`state write failed: ${error.message}`) })
    return writeChain
  }

  /** Persist after a quiet window; frequent tool calls must not rewrite the file each time. */
  function schedulePersist() {
    if (pendingTimer !== null) return
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      void persist()
    }, 500)
    pendingTimer.unref?.()
  }

  /** Apply one state mutation and persist it in write order. */
  function mutate(change) {
    state = change(state)
    return persist()
  }

  /** Apply one state mutation without waiting for the quiet window. */
  function mutateLater(change) {
    state = change(state)
    schedulePersist()
    return writeChain
  }

  const api = createApi({
    getState: () => state,
    mutate,
    getConfig: () => config,
    setConfig: next => { config = next },
    clearBinaryCache: () => probe.clear(),
    auditFile,
    baseDir,
    resolveApiKey: () => resolveApiKey(),
    describeApiKey: () => describeApiKey(),
    setApiKey: value => setApiKey(value),
    clearApiKey: () => clearApiKey(),
  })

  /** The credential store, when this profile composes one. */
  function credentialsService() {
    return ctx.get('credentials')
  }

  /**
   * Resolve the provider key: the stored credential first, then the provider's
   * conventional environment variable.
   * @returns {Promise<string>} the key, or an empty string when none is set.
   */
  async function resolveApiKey() {
    const name = credentialNameFor(config.provider)
    if (name === undefined) return ''
    const credentials = credentialsService()
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(name.ref)
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return hit.value
      } catch (error) {
        warn(`credential lookup failed: ${error.message}`)
      }
    }
    return process.env[name.env] ?? ''
  }

  /**
   * Describe the provider key without exposing it.
   * @returns {Promise<{ configured: boolean, source?: string, writable: boolean, name?: string }>} key status.
   */
  async function describeApiKey() {
    const name = credentialNameFor(config.provider)
    if (name === undefined) return { configured: false, writable: false }
    const credentials = credentialsService()
    if (credentials === undefined) {
      const configured = (process.env[name.env] ?? '') !== ''
      return { configured, source: configured ? 'environment' : undefined, writable: false, name: name.ref }
    }
    try {
      return { ...(await credentials.describe(name.ref)), name: name.ref }
    } catch (error) {
      warn(`credential describe failed: ${error.message}`)
      return { configured: false, writable: false, name: name.ref }
    }
  }

  /**
   * Store the provider key in the credential store, never in state or config.
   * @param {string} value - the key.
   */
  async function setApiKey(value) {
    const name = credentialNameFor(config.provider)
    if (name === undefined) throw new Error('select a decision provider before storing a key')
    const credentials = credentialsService()
    if (credentials === undefined) throw new Error('this profile has no credential store')
    const key = String(value ?? '').trim()
    if (key === '') throw new Error('the API key is empty')
    await credentials.set(name.ref, key)
  }

  /** Remove the stored provider key; an environment value applies again. */
  async function clearApiKey() {
    const name = credentialNameFor(config.provider)
    if (name === undefined) return
    const credentials = credentialsService()
    if (credentials === undefined) return
    await credentials.unset(name.ref)
  }

  /**
   * Probe the call's binaries and fold their trust into the state.
   * @param {object} exec - pending call.
   * @returns {Promise<Array<object>>} binary facts with trust.
   */
  async function inspectCall(exec) {
    const probed = await probe.forCall(exec, config)
    if (probed.length === 0) return probed
    const classified = []
    let next = state
    for (const binary of probed) {
      const result = classifyBinary(next, binary)
      next = result.state
      classified.push({ ...binary, trust: result.trust })
    }
    if (next !== state) state = next
    await mutateLater(current => rememberBinaries(current, classified))
    return classified
  }

  /**
   * Find an approved rule matching this call's binary hash, cwd, and argv.
   * @param {object} exec - pending call.
   * @param {Array<object>} binaries - probed binary facts.
   * @param {string} command - raw command text.
   * @returns {object | null} the matching rule.
   */
  function matchRule(exec, binaries, command) {
    const binary = binaries.find(item => typeof item.sha256 === 'string' && item.sha256 !== '')
    if (binary === undefined) return null
    const { clean, argv } = tokenize(command)
    if (!clean || argv.length === 0) return null
    const cwd = typeof exec.arguments?.workdir === 'string' && exec.arguments.workdir !== ''
      ? exec.arguments.workdir
      : process.cwd()
    return state.rules.find(rule => rule.status === 'approved'
      && rule.binarySha256 === binary.sha256
      && rule.cwd === cwd
      && rule.tokens.length === argv.length
      && rule.tokens.every((token, index) => token === argv[index])) ?? null
  }

  /**
   * Record one successful exact command and propose a rule after enough repeats.
   * @param {object} exec - the settled call.
   * @param {Array<object>} binaries - probed binary facts.
   * @param {string} command - raw command text.
   */
  async function learn(exec, binaries, command) {
    if (!config.proposeRules || command === '') return
    const { clean, argv } = tokenize(command)
    if (!clean || argv.length === 0) return
    const binary = binaries.find(item => typeof item.sha256 === 'string' && item.sha256 !== '')
    if (binary === undefined) return
    const cwd = typeof exec.arguments?.workdir === 'string' && exec.arguments.workdir !== ''
      ? exec.arguments.workdir
      : process.cwd()
    const signature = `${exec.name}\u0000${binary.sha256}\u0000${cwd}\u0000${argv.join('\u0000')}`
    await mutate(current => {
      const previous = current.signatures[signature] ?? { count: 0, lastSeen: null }
      const count = previous.count + 1
      const signatures = { ...current.signatures, [signature]: { count, lastSeen: new Date().toISOString() } }
      const proposed = current.rules.some(rule => rule.signature === signature)
      if (proposed || count < config.minRunsBeforeProposal) return { ...current, signatures }
      return {
        ...current,
        signatures,
        rules: [...current.rules, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          signature,
          tool: exec.name,
          binarySha256: binary.sha256,
          cwd,
          tokens: argv,
          status: 'proposed',
          createdAt: new Date().toISOString(),
          reviewedAt: null,
          expiresAt: null,
          hits: 0,
        }],
      }
    })
  }

  /**
   * Ask the decision gate about one call.
   * @param {object} exec - pending call.
   * @param {Array<object>} binaries - probed binary facts.
   * @param {string} command - raw command text.
   * @param {object | null} rule - matched rule, when one exists.
   * @returns {Promise<{ kind: 'allow' | 'ask' | 'deny', reason: string, source: string, detail?: object }>} decision.
   */
  async function gateDecision(exec, binaries, command, rule) {
    if (config.provider === 'off') {
      return { kind: 'ask', reason: 'no decision provider is configured for the audit', source: 'gate-unavailable' }
    }
    const cwd = typeof exec.arguments?.workdir === 'string' && exec.arguments.workdir !== ''
      ? exec.arguments.workdir
      : process.cwd()
    try {
      const { answers } = await requestDecision({
        config,
        state: buildState({ tool: exec.name, command, cwd, binaries, ruleId: rule?.id ?? null }),
        apiKey: await resolveApiKey(),
      })
      const decision = decide(config, answers)
      return { ...decision, source: 'gate' }
    } catch (error) {
      warn(`decision gate unavailable: ${error.message}`)
      return { kind: 'ask', reason: `the audit could not reach its decision provider: ${error.message}`, source: 'gate-unavailable' }
    }
  }

  ctx.effect(() => {
    const server = ctx.get('webServer')
    return server === undefined ? () => {} : registerRoutes(server, api)
  }, 'dsh-tool-audit: audit API routes')

  ctx.effect(() => {
    void (async () => {
      await mkdir(baseDir, { recursive: true })
      state = await loadState(stateFile)
      config = resolveConfig({ ...rowConfig, ...pickSettings(state.settings) })
      await trimAuditLog(auditFile, config.auditMaxLines)
      ready = true
    })().catch(error => { warn(`initialization failed: ${error.message}`) })

    ctx.on('tools/pre-execute', async (exec, next) => {
      // Before the state is loaded the audit knows nothing; leave the call alone.
      if (!ready) return next()
      const started = Date.now()
      const command = typeof exec.arguments?.command === 'string' ? exec.arguments.command : ''
      let binaries = []
      try {
        binaries = await inspectCall(exec)
      } catch (error) {
        warn(`binary inspection failed: ${error.message}`)
      }
      const rule = matchRule(exec, binaries, command)

      let decision = await next()
      let source = 'pipeline'
      let detail

      if (ready && config.mode !== 'observe' && decision.kind === 'allow' && rule === null) {
        const verdict = await gateDecision(exec, binaries, command, rule)
        source = verdict.source
        detail = verdict.detail
        if (verdict.kind === 'deny') {
          decision = {
            kind: 'deny',
            reason: `Audit: ${verdict.reason}`,
            info: { name: 'AuditDeniedError', code: 'AUDIT_DENIED', reason: verdict.reason },
          }
        } else if (verdict.kind === 'ask' && config.onApprovalNever === 'deny') {
          decision = { kind: 'ask', reason: `Audit: ${verdict.reason}` }
        } else if (verdict.kind === 'ask') {
          decision = { kind: 'allow' }
        }
      } else if (rule !== null) {
        source = 'rule'
        void mutateLater(current => ({
          ...current,
          rules: current.rules.map(entry => entry.id === rule.id ? { ...entry, hits: (entry.hits ?? 0) + 1 } : entry),
        }))
      } else if (config.mode === 'observe') {
        source = 'observe'
      }

      const line = {
        ts: new Date().toISOString(),
        tool: exec.name,
        callId: String(exec.callId ?? ''),
        session: exec.agent?.session?.id ?? null,
        command: command === '' ? null : command.slice(0, config.commandPreviewChars),
        binaries,
        rule: rule?.id ?? null,
        mode: config.mode,
        source,
        decision: decision.kind,
        detail,
        durationMs: Date.now() - started,
      }
      void appendAudit(auditFile, line).catch(error => { warn(`audit append failed: ${error.message}`) })
      return decision
    })

    ctx.on('tools/result', (exec, result) => {
      if (!ready || result?.isError === true) return
      const command = typeof exec.arguments?.command === 'string' ? exec.arguments.command : ''
      void (async () => {
        const binaries = await probe.forCall(exec, config)
        await learn(exec, binaries, command)
      })().catch(error => { warn(`learning failed: ${error.message}`) })
    })

    return () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer)
        pendingTimer = null
        void persist()
      }
    }
  }, 'dsh-tool-audit: audit pipeline')
}
