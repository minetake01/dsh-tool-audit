/**
 * Durable state and the audit stream.
 *
 * The state file is the plugin's own record store; the audit stream is an
 * append-only JSONL file beside it. Both live under the plugin directory, never
 * in the profile patch, and every write is an atomic replace so a crash leaves
 * either the previous or the next document.
 *
 * @module dsh-tool-audit/src/store
 */

import { existsSync } from 'node:fs'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'

/** Current state schema version. */
export const STATE_VERSION = 2

/**
 * A fresh state document.
 * @returns {object} empty state.
 */
export function emptyState() {
  return {
    version: STATE_VERSION,
    settings: {},
    rules: [],
    binaries: {},
    packages: [],
    diffs: [],
    signatures: {},
  }
}

/**
 * Atomically replace one JSON file: write beside it, then rename.
 * @param {string} file - destination path.
 * @param {unknown} value - JSON-serializable payload.
 */
export async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Load the state file, upgrading the earlier schema in place.
 * @param {string} file - absolute state path.
 * @returns {Promise<object>} the parsed state.
 */
export async function loadState(file) {
  if (!existsSync(file)) return emptyState()
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (parsed === null || typeof parsed !== 'object') throw new Error(`unsupported state file ${file}`)
  if (parsed.version !== 1 && parsed.version !== STATE_VERSION) {
    throw new Error(`unsupported state file ${file} (version ${String(parsed.version)})`)
  }
  return { ...emptyState(), ...parsed, version: STATE_VERSION }
}

/**
 * Append one audit line.
 * @param {string} file - absolute audit log path.
 * @param {object} line - JSON-serializable record.
 */
export async function appendAudit(file, line) {
  await appendFile(file, `${JSON.stringify(line)}\n`, 'utf8')
}

/**
 * Keep the audit stream bounded by rewriting it once it outgrows the cap.
 * @param {string} file - absolute audit log path.
 * @param {number} maxLines - retained line budget.
 */
export async function trimAuditLog(file, maxLines) {
  if (!existsSync(file)) return
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  if (lines.length <= maxLines) return
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${lines.slice(-maxLines).join('\n')}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Read the tail of the audit stream.
 * @param {string} file - absolute audit log path.
 * @param {number} limit - retained line count.
 * @returns {Promise<Array<object>>} parsed lines, oldest first.
 */
export async function readAuditTail(file, limit) {
  if (!existsSync(file)) return []
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  return lines.slice(-limit).map(line => {
    try {
      return JSON.parse(line)
    } catch {
      return { ts: null, unparsable: true }
    }
  })
}
