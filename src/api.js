/**
 * The audit API the Web client reads and mutates.
 *
 * Two routes: `state` is a GET resource with the whole snapshot, `action` is a
 * POST that validates one operation, applies it through the state store, and
 * answers with the refreshed snapshot. Both are same-origin only in practice;
 * the action route refuses requests without the plugin's header so a cross-site
 * form cannot reach it.
 *
 * @module dsh-tool-audit/src/api
 */

import { readAuditTail } from './store.js'
import { diffCommand, recordRelease, removeRelease, settleDiff } from './releases.js'
import { probeProvider } from './gate.js'
import { pickSettings } from './config.js'

/** Route prefix of the audit API served to the Web client. */
export const ROUTE_PREFIX = '/dsh-tool-audit'

/**
 * Build one JSON HTTP response.
 * @param {unknown} body - JSON-serializable payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} fetch response.
 */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Create the snapshot and action surface.
 * @param {object} deps - dependencies.
 * @param {() => object} deps.getState - current state.
 * @param {(change: (state: object) => object) => Promise<object>} deps.mutate - apply and persist.
 * @param {() => object} deps.getConfig - effective configuration.
 * @param {(next: object) => void} deps.setConfig - replace the in-memory configuration.
 * @param {() => void} deps.clearBinaryCache - drop cached hashes after a pin change.
 * @param {string} deps.auditFile - audit stream path.
 * @param {string} deps.baseDir - plugin state directory.
 * @param {typeof fetch} [deps.fetchImpl] - fetch override for tests.
 * @returns {{ snapshot: () => Promise<object>, runAction: (action: string, payload?: object) => Promise<object> }} API.
 */
export function createApi({ getState, mutate, getConfig, setConfig, clearBinaryCache, auditFile, baseDir, resolveApiKey, describeApiKey, setApiKey, clearApiKey, fetchImpl }) {
  /**
   * Whole snapshot for the audit page.
   * @returns {Promise<object>} page payload.
   */
  async function snapshot() {
    const state = getState()
    const config = getConfig()
    const pendingRules = state.rules.filter(rule => rule.status === 'proposed').length
    const pendingBinaries = Object.values(state.binaries).filter(binary => binary.trust === 'unknown').length
    const pendingDiffs = state.diffs.filter(diff => diff.status === 'pending').length
    return {
      config: { ...config, baseDir },
      key: await describeApiKey(),
      pending: { rules: pendingRules, binaries: pendingBinaries, diffs: pendingDiffs },
      pendingTotal: pendingRules + pendingBinaries + pendingDiffs,
      rules: state.rules,
      binaries: Object.values(state.binaries)
        .sort((left, right) => String(right.lastSeen ?? '').localeCompare(String(left.lastSeen ?? ''))),
      packages: state.packages.map(pin => ({
        ...pin,
        diff: diffCommand(
          state.diffs.find(diff => diff.packageId === pin.id && diff.status === 'pending')
            ?? { fromCommit: null, toCommit: null },
          pin,
        ),
      })),
      diffs: state.diffs,
      recent: await readAuditTail(auditFile, 200),
    }
  }

  /**
   * Apply one validated action.
   * @param {string} action - action name.
   * @param {Record<string, unknown>} [payload] - action payload.
   * @returns {Promise<object>} refreshed snapshot.
   */
  async function runAction(action, payload = {}) {
    if (action === 'approve-rule' || action === 'reject-rule') {
      const id = String(payload.id ?? '')
      await mutate(state => ({
        ...state,
        rules: state.rules.map(rule => rule.id !== id ? rule : {
          ...rule,
          status: action === 'approve-rule' ? 'approved' : 'rejected',
          reviewedAt: new Date().toISOString(),
        }),
      }))
      return snapshot()
    }
    if (action === 'forget-binary') {
      const sha256 = String(payload.sha256 ?? '')
      await mutate(state => {
        const binaries = { ...state.binaries }
        delete binaries[sha256]
        return { ...state, binaries }
      })
      clearBinaryCache()
      return snapshot()
    }
    if (action === 'trust-binary') {
      const sha256 = String(payload.sha256 ?? '')
      await mutate(state => {
        const binary = state.binaries[sha256]
        if (binary === undefined) throw new Error(`unknown binary ${sha256}`)
        return { ...state, binaries: { ...state.binaries, [sha256]: { ...binary, trust: 'pinned' } } }
      })
      return snapshot()
    }
    if (action === 'record-release') {
      await mutate(state => recordRelease(state, payload))
      clearBinaryCache()
      return snapshot()
    }
    if (action === 'remove-release') {
      await mutate(state => removeRelease(state, String(payload.id ?? '')))
      clearBinaryCache()
      return snapshot()
    }
    if (action === 'confirm-diff' || action === 'dismiss-diff') {
      const id = String(payload.id ?? '')
      const status = action === 'confirm-diff' ? 'confirmed' : 'dismissed'
      await mutate(state => settleDiff(state, id, status, typeof payload.toCommit === 'string' ? payload.toCommit : undefined))
      clearBinaryCache()
      return snapshot()
    }
    if (action === 'set-settings') {
      const settings = pickSettings(payload)
      const next = { ...getConfig(), ...settings }
      setConfig(next)
      await mutate(state => ({ ...state, settings: { ...state.settings, ...settings } }))
      return snapshot()
    }
    if (action === 'set-api-key') {
      await setApiKey(String(payload.value ?? ''))
      return snapshot()
    }
    if (action === 'clear-api-key') {
      await clearApiKey()
      return snapshot()
    }
    if (action === 'test-provider') {
      const result = await probeProvider(getConfig(), await resolveApiKey(), fetchImpl)
      return { ...(await snapshot()), probe: { ok: true, answers: result.answers } }
    }
    throw new Error(`unknown action "${String(action)}"`)
  }

  return { snapshot, runAction }
}

/**
 * Register both routes on the Host web server.
 * @param {object} server - the `webServer` service.
 * @param {{ snapshot: () => Promise<object>, runAction: (action: string, payload?: object) => Promise<object> }} api - API surface.
 * @returns {() => void} disposer removing both routes.
 */
export function registerRoutes(server, api) {
  const disposers = [
    server.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      async resource(request) {
        if (request.headers.get('x-dsh-tool-audit') !== '1') return jsonResponse({ error: 'forbidden' }, 403)
        return jsonResponse(await api.snapshot())
      },
    }),
    server.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/action`,
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        if (request.headers['x-dsh-tool-audit'] !== '1') {
          response.writeHead(403)
          response.end()
          return
        }
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const result = await api.runAction(String(body.action ?? ''), body.payload ?? {})
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(JSON.stringify(result))
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: error.message }))
        }
      },
    }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
