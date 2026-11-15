/**
 * The decision gate.
 *
 * One request carries the whole situation as `state` and a fixed map of typed
 * questions. Decision models answer with calibrated probabilities, never prose,
 * so the question set is stable and every threshold is a configuration value.
 *
 * @module dsh-tool-audit/src/gate
 */

/** The fixed question set; each answer is a yes/no probability. */
export const QUESTIONS = Object.freeze({
  within_instruction: 'Does this command stay within what the current user instruction asks for?',
  external_effect: 'Does this command write to, send data to, or otherwise affect anything outside the workspace?',
  destructive: 'Could this command irreversibly destroy or rewrite existing data or state?',
  data_egress: 'Does this command send credentials, secrets, or private data to an external destination?',
  needs_human: 'Should a human confirm this command before it runs?',
})

/**
 * Build the bounded state a decision model sees for one call.
 * @param {object} input - call facts.
 * @returns {object} lossless state payload.
 */
export function buildState({ tool, command, cwd, binaries, ruleId }) {
  return {
    tool,
    command: command.slice(0, 2000),
    cwd,
    binary: binaries
      .filter(binary => typeof binary.sha256 === 'string')
      .map(binary => ({ path: binary.path, sha256: binary.sha256, trust: binary.trust })),
    rule: ruleId,
  }
}

/**
 * Build the provider request body for one state.
 *
 * Jev carries the call as structured `state`; Gemini Decision 1 takes the same
 * facts as its `input` text and authenticates with a different header.
 *
 * @param {'jev' | 'gemini-decision'} provider - selected provider.
 * @param {string} model - model id.
 * @param {object} state - call state.
 * @returns {object} request body.
 */
export function requestBody(provider, model, state) {
  const questions = Object.fromEntries(
    Object.entries(QUESTIONS).map(([name, instructions]) => [name, { type: 'noul', instructions }]),
  )
  if (provider === 'gemini-decision') {
    return { model, input: typeof state === 'string' ? state : JSON.stringify(state), questions }
  }
  return { model, state, questions }
}

/**
 * Provider-specific authentication headers.
 * @param {'jev' | 'gemini-decision'} provider - selected provider.
 * @param {string} key - API key.
 * @returns {Record<string, string>} request headers.
 */
export function requestHeaders(provider, key) {
  if (provider === 'gemini-decision') {
    return { 'content-type': 'application/json', 'x-goog-api-key': key }
  }
  return { 'content-type': 'application/json', authorization: `Bearer ${key}` }
}

/**
 * Read one answer's probability and confidence from a provider response.
 * @param {unknown} answer - one answer object.
 * @returns {{ probability: number, confidence: number } | undefined} parsed answer.
 */
function parseAnswer(answer) {
  if (typeof answer === 'number') return { probability: answer, confidence: 1 }
  if (answer === null || typeof answer !== 'object') return undefined
  const raw = answer.noul ?? answer.probability ?? answer.value ?? answer.yes
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 1
  return { probability: raw, confidence }
}

/**
 * Normalize a provider response into the question map this gate reads.
 * @param {unknown} body - decoded response.
 * @returns {Record<string, { probability: number, confidence: number }>} answers.
 */
export function parseAnswers(body) {
  const answers = body?.answers ?? body?.result?.answers ?? body
  if (answers === null || typeof answers !== 'object') throw new Error('decision response carried no answers')
  /** @type {Record<string, { probability: number, confidence: number }>} */
  const parsed = {}
  for (const name of Object.keys(QUESTIONS)) {
    const answer = parseAnswer(answers[name])
    if (answer === undefined) throw new Error(`decision response is missing "${name}"`)
    parsed[name] = answer
  }
  return parsed
}

/**
 * Turn probabilities into a pipeline decision.
 * @param {ReturnType<import('./config.js').resolveConfig>} config - thresholds.
 * @param {Record<string, { probability: number, confidence: number }>} answers - gate answers.
 * @returns {{ kind: 'allow' | 'ask' | 'deny', reason: string, detail: object }} decision.
 */
export function decide(config, answers) {
  const detail = Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, {
    probability: Number(answer.probability.toFixed(3)),
    confidence: Number(answer.confidence.toFixed(3)),
  }]))
  if (answers.data_egress.probability >= config.denyAboveDataEgress) {
    return { kind: 'deny', reason: 'the audit classifies this command as sending private data out of the workspace', detail }
  }
  if (answers.within_instruction.probability <= config.denyBelowInScope) {
    return { kind: 'deny', reason: 'the audit finds this command outside what the current instruction asks for', detail }
  }
  const uncertain = Object.values(answers).some(answer => answer.confidence < config.lowConfidence)
  if (uncertain
    || answers.destructive.probability >= config.askAboveDestructive
    || answers.external_effect.probability >= config.askAboveExternal
    || answers.needs_human.probability >= 0.5) {
    return { kind: 'ask', reason: 'the audit asks for confirmation before this command runs', detail }
  }
  return { kind: 'allow', reason: 'the audit finds this command within the current instruction', detail }
}

/**
 * Call the configured decision endpoint.
 * @param {object} input - request facts.
 * @param {ReturnType<import('./config.js').resolveConfig>} input.config - configuration.
 * @param {object} input.state - call state.
 * @param {string} input.apiKey - resolved key; the caller owns credential lookup.
 * @param {typeof fetch} [input.fetchImpl] - fetch override for tests.
 * @returns {Promise<{ answers: Record<string, { probability: number, confidence: number }> }>} answers.
 */
export async function requestDecision({ config, state, apiKey, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || apiKey === '') throw new Error('no API key is configured for the audit provider')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: requestHeaders(config.provider, apiKey),
      body: JSON.stringify(requestBody(config.provider, config.model, state)),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`decision endpoint answered ${response.status}`)
    return { answers: parseAnswers(await response.json()) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Verify the configured endpoint with one harmless decision.
 * @param {ReturnType<import('./config.js').resolveConfig>} config - configuration.
 * @param {string} apiKey - resolved key.
 * @param {typeof fetch} [fetchImpl] - fetch override for tests.
 * @returns {Promise<{ answers: Record<string, { probability: number, confidence: number }> }>} answers.
 */
export async function probeProvider(config, apiKey, fetchImpl = fetch) {
  return requestDecision({
    config,
    state: { tool: 'none', command: 'true', cwd: process.cwd(), binary: [], rule: null },
    apiKey,
    fetchImpl,
  })
}
