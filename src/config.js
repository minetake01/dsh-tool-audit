/**
 * Configuration vocabulary and validation for dsh-tool-audit.
 *
 * Every tunable is declared here once: the Loader row `config`, the persisted
 * user settings, and the settings page all resolve through {@link resolveConfig}.
 *
 * @module dsh-tool-audit/src/config
 */

/** Pipeline behaviors the Host can take. */
export const MODES = Object.freeze(['observe', 'ask', 'enforce'])

/** What to do with an `ask` when the session's approval policy is `never`. */
export const NEVER_POLICIES = Object.freeze(['deny', 'observe'])

/** Decision-model providers this plugin can call. */
export const PROVIDERS = Object.freeze(['off', 'jev', 'gemini-decision'])

/**
 * Defaults for every tunable. `state.settings` and the row `config` layer over
 * these values in that order.
 */
export const DEFAULTS = Object.freeze({
  mode: 'observe',
  onApprovalNever: 'deny',
  provider: 'off',
  endpoint: '',
  model: 'jev-1.13',
  timeoutMs: 900,
  analyzeBinaries: true,
  proposeRules: true,
  minRunsBeforeProposal: 3,
  auditMaxLines: 20000,
  commandPreviewChars: 400,
  lowConfidence: 0.6,
  denyAboveDataEgress: 0.5,
  denyBelowInScope: 0.5,
  askAboveDestructive: 0.5,
  askAboveExternal: 0.5,
})

/** Fields the settings page may change. */
export const SETTING_KEYS = Object.freeze([
  'mode',
  'onApprovalNever',
  'provider',
  'endpoint',
  'model',
  'timeoutMs',
  'analyzeBinaries',
  'proposeRules',
  'minRunsBeforeProposal',
  'auditMaxLines',
  'lowConfidence',
  'denyAboveDataEgress',
  'denyBelowInScope',
  'askAboveDestructive',
  'askAboveExternal',
])

/**
 * The credential each provider owns. The plugin names it, so the settings page
 * asks only for the key and the environment variable stays a fallback.
 *
 * @param {'jev' | 'gemini-decision' | 'off'} provider - selected provider.
 * @returns {{ ref: string, env: string } | undefined} credential name and fallback variable.
 */
export function credentialNameFor(provider) {
  if (provider === 'jev') return { ref: 'DSH_TOOL_AUDIT_JEV_API_KEY', env: 'JEV_API_KEY' }
  if (provider === 'gemini-decision') return { ref: 'DSH_TOOL_AUDIT_GEMINI_API_KEY', env: 'GEMINI_API_KEY' }
  return undefined
}

/**
 * Require one numeric field inside its range.
 * @param {Record<string, unknown>} config - candidate values.
 * @param {string} key - field name.
 * @param {number} min - inclusive minimum.
 * @param {number} max - inclusive maximum.
 */
function requireNumber(config, key, min, max) {
  const value = config[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}`)
  }
}

/**
 * Validate candidate configuration and fill defaults.
 * @param {Record<string, unknown>} raw - values from the row or the settings file.
 * @returns {typeof DEFAULTS} effective configuration.
 */
export function resolveConfig(raw = {}) {
  const config = { ...DEFAULTS, ...raw }
  if (!MODES.includes(config.mode)) throw new Error(`unknown mode "${String(config.mode)}"`)
  if (!NEVER_POLICIES.includes(config.onApprovalNever)) {
    throw new Error(`unknown onApprovalNever "${String(config.onApprovalNever)}"`)
  }
  if (!PROVIDERS.includes(config.provider)) throw new Error(`unknown provider "${String(config.provider)}"`)
  if (typeof config.endpoint !== 'string') throw new Error('endpoint must be a string')
  if (typeof config.model !== 'string' || config.model === '') throw new Error('model must be a non-empty string')
  requireNumber(config, 'timeoutMs', 100, 30000)
  requireNumber(config, 'lowConfidence', 0, 1)
  requireNumber(config, 'denyAboveDataEgress', 0, 1)
  requireNumber(config, 'denyBelowInScope', 0, 1)
  requireNumber(config, 'askAboveDestructive', 0, 1)
  requireNumber(config, 'askAboveExternal', 0, 1)
  if (!Number.isInteger(config.auditMaxLines) || config.auditMaxLines < 100) {
    throw new Error('auditMaxLines must be an integer of at least 100')
  }
  if (!Number.isInteger(config.minRunsBeforeProposal) || config.minRunsBeforeProposal < 1) {
    throw new Error('minRunsBeforeProposal must be a positive integer')
  }
  if (config.provider !== 'off' && config.endpoint === '') {
    throw new Error(`endpoint is required when provider is "${config.provider}"`)
  }
  return config
}

/**
 * Pick only the fields the settings page may write.
 * @param {Record<string, unknown>} payload - submitted values.
 * @returns {Record<string, unknown>} the writable subset.
 */
export function pickSettings(payload = {}) {
  /** @type {Record<string, unknown>} */
  const picked = {}
  for (const key of SETTING_KEYS) {
    if (Object.hasOwn(payload, key)) picked[key] = payload[key]
  }
  return picked
}
