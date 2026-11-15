/**
 * Release pins, binary trust classification, and the update review queue.
 *
 * A release pin records the safe artifact: where it came from, which tag, which
 * commit, and the SHA-256 the publisher shipped. An installed binary is
 * trusted when its hash equals the pin's; a different hash under the same
 * installed path opens one diff review carrying both commits, so the changed
 * files can be inspected before the new hash is accepted.
 *
 * @module dsh-tool-audit/src/releases
 */

/** Trust states a probed binary can carry. */
export const TRUST = Object.freeze(['pinned', 'unknown', 'mismatch', 'unresolved', 'unreadable'])

/**
 * Compare two filesystem paths the way the platform does.
 * @param {string} left - path.
 * @param {string} right - path.
 * @returns {boolean} whether they name the same file.
 */
export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Find the release pin that owns one installed path.
 * @param {Array<object>} packages - release pins.
 * @param {string} path - installed executable path.
 * @returns {object | undefined} the pin.
 */
export function pinForPath(packages, path) {
  return packages.find(pin => samePath(pin.installedPath, path))
}

/**
 * One review entry for an updated binary, identified by its path and new hash.
 * @param {object} input - pin and binary facts.
 * @returns {object} the diff review.
 */
function newDiff({ pin, binary }) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    packageId: pin.id,
    name: pin.name,
    path: binary.path,
    fromSha256: pin.assetSha256,
    toSha256: binary.sha256,
    fromCommit: pin.commit ?? null,
    toCommit: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
  }
}

/**
 * Classify one probed binary and open a diff review when a pinned path changed.
 * @param {object} state - current state.
 * @param {object} binary - probed binary facts.
 * @returns {{ trust: string, pin: object | undefined, state: object }} classification,
 * plus the next state when the classification opened a review.
 */
export function classifyBinary(state, binary) {
  if (typeof binary.sha256 !== 'string' || binary.sha256 === '') {
    return { trust: binary.trust ?? 'unreadable', pin: undefined, state }
  }
  const pin = pinForPath(state.packages, binary.path)
  if (pin === undefined) return { trust: 'unknown', pin: undefined, state }
  if (pin.assetSha256 === binary.sha256) return { trust: 'pinned', pin, state }
  const existing = state.diffs.find(diff => samePath(diff.path, binary.path) && diff.toSha256 === binary.sha256)
  if (existing !== undefined) return { trust: 'mismatch', pin, state }
  return { trust: 'mismatch', pin, state: { ...state, diffs: [newDiff({ pin, binary }), ...state.diffs] } }
}

/**
 * Hash the binary trust into the persisted table, refreshing the last-seen time.
 * @param {object} state - current state.
 * @param {Array<object>} binaries - probed binary facts with `trust` filled in.
 * @returns {object} next state.
 */
export function rememberBinaries(state, binaries) {
  const known = binaries.filter(binary => typeof binary.sha256 === 'string' && binary.sha256 !== '')
  if (known.length === 0) return state
  const next = { ...state.binaries }
  const now = new Date().toISOString()
  for (const binary of known) {
    const previous = next[binary.sha256]
    next[binary.sha256] = {
      sha256: binary.sha256,
      path: binary.path,
      size: binary.size ?? previous?.size ?? null,
      mtimeMs: binary.mtimeMs ?? previous?.mtimeMs ?? null,
      trust: binary.trust ?? previous?.trust ?? 'unknown',
      firstSeen: previous?.firstSeen ?? now,
      lastSeen: now,
    }
  }
  return { ...state, binaries: next }
}

/**
 * Re-run trust classification over every recorded binary, so a new or removed
 * pin immediately settles the pending list instead of waiting for the next call.
 * @param {object} state - current state.
 * @returns {object} next state.
 */
export function reclassifyAll(state) {
  const binaries = { ...state.binaries }
  for (const [sha256, binary] of Object.entries(binaries)) {
    const pin = pinForPath(state.packages, binary.path)
    const trust = pin === undefined ? 'unknown' : pin.assetSha256 === sha256 ? 'pinned' : 'mismatch'
    if (trust !== binary.trust) binaries[sha256] = { ...binary, trust }
  }
  return { ...state, binaries }
}

/**
 * Record one release pin from reviewed facts.
 * @param {object} state - current state.
 * @param {Record<string, unknown>} payload - pin fields from the review UI.
 * @returns {object} next state.
 */
export function recordRelease(state, payload) {
  const name = String(payload?.name ?? '').trim()
  const installedPath = String(payload?.installedPath ?? '').trim()
  const assetSha256 = String(payload?.assetSha256 ?? '').trim().toLowerCase()
  const repo = String(payload?.repo ?? '').trim()
  const tag = String(payload?.tag ?? '').trim()
  const commit = String(payload?.commit ?? '').trim()
  if (name === '') throw new Error('name is required')
  if (installedPath === '') throw new Error('installedPath is required')
  if (!/^[0-9a-f]{64}$/.test(assetSha256)) throw new Error('assetSha256 must be a 64-character hex digest')
  const pin = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    repo,
    tag,
    commit,
    assetSha256,
    installedPath,
    createdAt: new Date().toISOString(),
  }
  const packages = state.packages.filter(existing => !samePath(existing.installedPath, installedPath))
  const diffs = state.diffs.filter(diff => !(samePath(diff.path, installedPath) && diff.toSha256 === assetSha256))
  return reclassifyAll({ ...state, packages: [pin, ...packages], diffs })
}

/**
 * Delete one release pin.
 * @param {object} state - current state.
 * @param {string} id - pin id.
 * @returns {object} next state.
 */
export function removeRelease(state, id) {
  return reclassifyAll({ ...state, packages: state.packages.filter(pin => pin.id !== id) })
}

/**
 * Settle one diff review.
 * @param {object} state - current state.
 * @param {string} id - review id.
 * @param {'confirmed' | 'dismissed'} status - settlement.
 * @param {string} [toCommit] - the commit the new binary was built from.
 * @returns {object} next state.
 */
export function settleDiff(state, id, status, toCommit) {
  const diff = state.diffs.find(entry => entry.id === id)
  if (diff === undefined) throw new Error(`unknown diff ${id}`)
  const reviewedAt = new Date().toISOString()
  const nextCommit = toCommit !== undefined && toCommit !== '' ? toCommit : diff.toCommit ?? null
  const settled = { ...diff, status, reviewedAt, toCommit: nextCommit }
  const diffs = state.diffs.map(entry => entry.id === id ? settled : entry)
  if (status !== 'confirmed') return reclassifyAll({ ...state, diffs })
  const pin = state.packages.find(entry => entry.id === diff.packageId)
  if (pin === undefined) return reclassifyAll({ ...state, diffs })
  const updated = {
    ...pin,
    assetSha256: diff.toSha256,
    commit: nextCommit ?? pin.commit,
    updatedAt: reviewedAt,
  }
  const packages = state.packages.map(entry => entry.id === pin.id ? updated : entry)
  return reclassifyAll({ ...state, diffs, packages })
}

/**
 * The command a reviewer runs to see what changed between the two commits.
 * @param {object} diff - the review entry.
 * @param {object | undefined} pin - its release pin.
 * @returns {string} a copyable git command.
 */
export function diffCommand(diff, pin) {
  if (diff.fromCommit === null || diff.toCommit === null) return ''
  const where = pin?.repo ? `${pin.repo} (${pin.installedPath})` : diff.path
  return `git -C "${where}" diff ${diff.fromCommit}..${diff.toCommit}`
}
