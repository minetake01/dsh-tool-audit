/**
 * Command inspection: the argv a shell call names, the executable it resolves
 * to, and that executable's SHA-256.
 *
 * The audit only speaks about shapes it can reason about. A command carrying
 * metacharacters, quoting, or expansion is recorded as-is and never resolved
 * into a rule or a release comparison.
 *
 * @module dsh-tool-audit/src/command
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Command characters that make literal token matching unsafe. */
export const UNSAFE_COMMAND = /[;&|<>`$(){}\n\r"'\\]/

/** Tools whose `command` argument names an executable worth resolving. */
export const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/**
 * Split a shell command into the argv a shell would build.
 * @param {string} command - the model-authored command string.
 * @returns {{ clean: boolean, argv: string[] }} `clean` is false for shapes the
 * audit refuses to reason about; `argv` then holds only the leading token.
 */
export function tokenize(command) {
  const text = command.trim()
  if (text === '' || UNSAFE_COMMAND.test(text)) {
    const first = text.split(/\s+/)[0] ?? ''
    return { clean: false, argv: first === '' ? [] : [first] }
  }
  return { clean: true, argv: text.split(/\s+/).filter(Boolean) }
}

/**
 * Resolve a bare command name through PATH, honoring PATHEXT on Windows.
 * @param {string} command - bare name or a path containing a separator.
 * @param {string} cwd - the call's working directory.
 * @returns {string | undefined} absolute executable path when one exists.
 */
export function resolveExecutable(command, cwd) {
  if (command === '') return undefined
  if (command.includes('/') || command.includes('\\')) {
    const candidate = resolve(cwd, command)
    return existsSync(candidate) ? candidate : undefined
  }
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const directory of pathValue.split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, command + (process.platform === 'win32' ? extension.toLowerCase() : extension))
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * SHA-256 of one file, streamed so large binaries do not load into memory.
 * @param {string} file - absolute path.
 * @returns {Promise<string>} lowercase hex digest.
 */
export async function hashFile(file) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', rejectPromise)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

/**
 * Resolve and hash the executables a shell call names, caching by path, size,
 * and modification time so a warm path costs one `stat`.
 */
export class BinaryProbe {
  constructor() {
    /** Absolute path → { sha256, size, mtimeMs }. */
    this.cache = new Map()
  }

  /** Drop every cached hash; used when the release table changes. */
  clear() {
    this.cache.clear()
  }

  /**
   * Inspect one path.
   * @param {string} executable - absolute path.
   * @returns {Promise<{ path: string, sha256: string, size: number, mtimeMs: number }>} facts.
   */
  async inspect(executable) {
    const stats = await stat(executable)
    const cached = this.cache.get(executable)
    if (cached !== undefined && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) return { path: executable, ...cached }
    const sha256 = await hashFile(executable)
    const facts = { sha256, size: stats.size, mtimeMs: stats.mtimeMs }
    this.cache.set(executable, facts)
    return { path: executable, ...facts }
  }

  /**
   * Inspect every executable a tool call names.
   * @param {{ name: string, arguments?: unknown, workdir?: string }} exec - the pending call.
   * @param {{ analyzeBinaries: boolean }} config - effective configuration.
   * @returns {Promise<Array<object>>} binary facts, empty when the call has no command.
   */
  async forCall(exec, config) {
    if (!config.analyzeBinaries || !SHELL_TOOLS.has(exec.name)) return []
    const args = exec.arguments ?? {}
    const command = typeof args.command === 'string' ? args.command : ''
    if (command === '') return []
    const cwd = typeof args.workdir === 'string' && args.workdir !== '' ? args.workdir : process.cwd()
    const executable = resolveExecutable(tokenize(command).argv[0] ?? '', cwd)
    if (executable === undefined) return [{ path: null, sha256: null, trust: 'unresolved' }]
    try {
      return [await this.inspect(executable)]
    } catch (error) {
      return [{ path: executable, sha256: null, trust: 'unreadable', error: error.message }]
    }
  }
}
