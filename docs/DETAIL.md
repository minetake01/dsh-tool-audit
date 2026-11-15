# Tool audit

Tool audit watches the tool pipeline, pins binary hashes to reviewed releases, and gates commands that no rule covers. Every call leaves one line in an audit stream whether it was allowed, denied, or merely observed.

## What it does

- **Audit line per call.** The `tools/pre-execute` listener records the tool, the session, a truncated command, the resolved binaries, the matching rule, the mode, the decision source, the gate probabilities, and the time the audit itself took.
- **Binary hashing.** For `bash` and `pwsh` calls the first command token is resolved through `PATH` (or the call's working directory) and hashed with SHA-256. Hashes are cached per path, size, and modification time.
- **Release pins.** A pin records the reviewed artifact: name, installed path, repository, tag, commit, and the release SHA-256. An installed binary whose hash equals the pin is trusted without any model call.
- **Update reviews.** A hash that differs from the pin opens exactly one review carrying both hashes and the pinned commit. The page shows the command that produces the source diff (`git diff <from>..<to>`); accepting records the new commit and moves the pin, dismissing keeps the old pin and stops asking for that hash.
- **Rules.** The same exact command succeeding `minRunsBeforeProposal` times against the same binary hash in the same working directory proposes one rule. A rule is a literal argv list bound to the binary hash and the working directory. Approving it lets that exact command skip the gate.
- **Gate.** Commands without a rule, in `ask` or `enforce` mode, go to the decision model.

## The decision gate

One request carries the call state (tool, command, working directory, binary hashes, rule) and five fixed yes/no questions:

| Question | Meaning |
|---|---|
| `within_instruction` | Does the command stay inside the current instruction? |
| `external_effect` | Does it affect anything outside the workspace? |
| `destructive` | Could it irreversibly destroy data or state? |
| `data_egress` | Does it send credentials, secrets, or private data out? |
| `needs_human` | Should a human confirm first? |

The answers are probabilities plus confidence. The mapping is configuration, not code: deny above `denyAboveDataEgress`, deny below `denyBelowInScope`, ask above `askAboveDestructive` / `askAboveExternal` / `needs_human`, ask when any confidence is below `lowConfidence`, otherwise allow.

Providers: `jev` (TypeSafe System One shape: `model`, `state`, typed `questions`) and `gemini-decision` (Gemini Decision 1 shape: `model`, `input` text, typed `questions`). The plugin owns the credential name per provider (`DSH_TOOL_AUDIT_JEV_API_KEY`, `DSH_TOOL_AUDIT_GEMINI_API_KEY`); the settings page asks only for the key, stores it in the Host credential store, and reads it per request, so a rotated key applies without a restart. When no stored value exists the provider's conventional variable (`JEV_API_KEY`, `GEMINI_API_KEY`) is read from the process environment. The key value never enters `state.json`, the snapshot, or an audit line, and the page only reports whether it is configured, where it comes from, and whether it is writable. `Check provider` sends one harmless decision to verify the endpoint and key.

| Provider | Request | Authentication |
|---|---|---|
| `jev` | `POST <endpoint>` with `{ model, state, questions }` | `Authorization: Bearer <key>` |
| `gemini-decision` | `POST https://generativelanguage.googleapis.com/v1beta/decisions` with `{ model, input, questions }`, where `input` is the call state as text | `x-goog-api-key: <key>` |

Each question is `{ "type": "noul", "instructions": "…" }`; a `noul` answer carries `noul` (the probability of yes) and `confidence`.

## Modes

| Mode | Behavior |
|---|---|
| `observe` | Records everything, calls no provider, changes no decision |
| `ask` | A gate denial is final; a gate ask returns the pipeline's `ask` |
| `enforce` | Same decisions, recorded as enforcement |

`onApprovalNever` decides what a gate ask means when the session's approval policy rejects prompts: `deny` returns `ask`, which a `never` policy rejects deterministically; `observe` records the recommendation and allows the call.

## Where state lives

`$DSH_HOME/plugins/dsh-tool-audit/` (or `DSH_TOOL_AUDIT_DIR`):

| File | Contents |
|---|---|
| `state.json` | Settings, rules, binary hashes, release pins, update reviews, command signatures |
| `audit.jsonl` | One JSON object per tool call, newest last |

Writes are atomic. Binary bookkeeping persists on a quiet window; rule and review changes persist immediately. The audit stream is trimmed to `auditMaxLines` on start.

## The two surfaces

- **Audit** in the sidebar: waiting reviews, binary updates, rules, binaries, pinned releases, recent decisions.
- **Audit settings** on this bundle's page in Plugins: mode, provider, endpoint, model, the API key, timeout, thresholds, rule and binary switches.

The sidebar icon carries no count. A filled dot means a rule, binary, or update waits for review.

## Limits

- Only the first token of a shell command is resolved; programs a shell starts itself are not audited.
- Commands with metacharacters, quotes, or expansion are recorded but never resolved into rules or release comparisons.
- Rules are literal argv lists, so a changed argument is a different command.
- The plugin records the diff command but does not run it; fetching a release diff is a manual step.
- The client reads `/dsh-tool-audit/state` and posts to `/dsh-tool-audit/action` on the same origin. Those routes are served by the Host web server, gated by the plugin header, and not authenticated by the Session RPC transport.
