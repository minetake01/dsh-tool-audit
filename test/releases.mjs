/**
 * Release test: a pinned path that changes hash opens one diff review, a second
 * call does not duplicate it, and accepting the review moves the pin.
 *
 * Run with `node test/releases.mjs`.
 */

import { classifyBinary, rememberBinaries, recordRelease, settleDiff, diffCommand, pinForPath } from '../src/releases.js'
import { emptyState } from '../src/store.js'

const OLD = 'a'.repeat(64)
const NEW = 'b'.repeat(64)
const PATH = 'C:\\tools\\demo.exe'

let state = recordRelease(emptyState(), {
  name: 'demo',
  installedPath: PATH,
  repo: 'https://github.com/example/demo',
  tag: 'v1.2.0',
  commit: '1234567',
  assetSha256: OLD,
})

const pin = pinForPath(state.packages, PATH)
if (pin === undefined) throw new Error('pin was not recorded')

const matching = classifyBinary(state, { path: PATH, sha256: OLD })
if (matching.trust !== 'pinned') throw new Error(`expected pinned, got ${matching.trust}`)

const changed = classifyBinary(state, { path: PATH, sha256: NEW })
if (changed.trust !== 'mismatch') throw new Error(`expected mismatch, got ${changed.trust}`)
if (changed.state.diffs.length !== 1) throw new Error('expected one diff review')
state = changed.state

const again = classifyBinary(state, { path: PATH, sha256: NEW })
if (again.state.diffs.length !== 1) throw new Error('a repeated mismatch must not duplicate the review')
state = again.state

const diff = state.diffs[0]
if (diff.fromSha256 !== OLD || diff.toSha256 !== NEW) throw new Error('review carries the wrong hashes')
if (diff.status !== 'pending') throw new Error('review should be pending')

const command = diffCommand({ ...diff, toCommit: '89abcde' }, pin)
if (!command.includes('1234567..89abcde')) throw new Error(`unexpected diff command: ${command}`)

state = settleDiff(state, diff.id, 'confirmed', '89abcde')
const updated = pinForPath(state.packages, PATH)
if (updated.assetSha256 !== NEW) throw new Error('accepted hash did not move the pin')
if (updated.commit !== '89abcde') throw new Error('accepted commit did not move the pin')
if (state.diffs[0].status !== 'confirmed') throw new Error('review was not settled')

const remembered = rememberBinaries(state, [{ path: PATH, sha256: NEW, size: 10, mtimeMs: 20, trust: 'pinned' }])
const entry = Object.values(remembered.binaries)[0]
if (entry.trust !== 'pinned') throw new Error('binary trust was not recorded')

// Pinning a release settles an already-recorded binary without waiting for the next call.
const unknown = rememberBinaries(emptyState(), [{ path: PATH, sha256: NEW, size: 10, mtimeMs: 20, trust: 'unknown' }])
if (Object.values(unknown.binaries)[0].trust !== 'unknown') throw new Error('expected an unknown binary')
const pinnedLater = recordRelease(unknown, {
  name: 'demo',
  installedPath: PATH,
  repo: 'https://github.com/example/demo',
  tag: 'v1.3.0',
  commit: 'abcdef0',
  assetSha256: NEW,
})
if (Object.values(pinnedLater.binaries)[0].trust !== 'pinned') throw new Error('pinning did not reclassify the binary')

console.log('releases test passed')
