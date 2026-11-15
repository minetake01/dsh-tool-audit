# dsh-tool-audit

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that audits tool calls, pins binary hashes to reviewed releases, and gates commands that no rule covers.

Every call leaves one line in an audit stream: the tool, the session, the command, the resolved binaries, the matching rule, and the decision that came out. Shell calls have their executable resolved and hashed; a reviewed release hash is trusted without any model call. Commands without a rule go to a decision model — [Jev](https://typesafe.ai) or Gemini Decision 1 — which answers a fixed set of yes/no questions and returns probabilities instead of prose.

## What you get

- **Audit page** in the sidebar: waiting reviews, binary updates, rules, binaries, pinned releases, recent decisions.
- **Settings** on the bundle's page in Plugins: mode, provider, endpoint, model, API key, thresholds, rule and binary switches.
- **Host state** under `$DSH_HOME/plugins/dsh-tool-audit/`: `state.json` and `audit.jsonl`.

## Modes

| Mode | Behavior |
|---|---|
| `observe` | Records everything, calls no provider, changes no decision. The default. |
| `ask` | A gate denial is final; a gate ask returns the pipeline's `ask`. |
| `enforce` | Same decisions, recorded as enforcement. |

A gate ask under an approval policy of `never` becomes a deterministic rejection unless the plugin is set to record and allow instead.

## The gate

Five fixed questions, each a calibrated yes/no probability with a confidence:

| Question | Meaning |
|---|---|
| `within_instruction` | Does the command stay inside the current instruction? |
| `external_effect` | Does it affect anything outside the workspace? |
| `destructive` | Could it irreversibly destroy data or state? |
| `data_egress` | Does it send credentials, secrets, or private data out? |
| `needs_human` | Should a human confirm first? |

Thresholds are settings, not code. Two providers are supported:

| Provider | Endpoint | Authentication |
|---|---|---|
| `jev` | your Jev/TypeSafe endpoint | `Authorization: Bearer` |
| `gemini-decision` | `https://generativelanguage.googleapis.com/v1beta/decisions` | `x-goog-api-key` |

The API key is stored in the Host credential store under a name the plugin owns (`DSH_TOOL_AUDIT_JEV_API_KEY`, `DSH_TOOL_AUDIT_GEMINI_API_KEY`), read per request, and never written to `state.json`, a snapshot, or an audit line. The provider's conventional environment variable (`JEV_API_KEY`, `GEMINI_API_KEY`) is the fallback.

## Binaries and releases

A shell call's first token is resolved through `PATH` and hashed with SHA-256; hashes are cached per path, size, and modification time. A release pin records the reviewed artifact — name, installed path, repository, tag, commit, and the release hash. A hash that differs from its pin opens exactly one review carrying both hashes and the pinned commit; the page shows the `git diff <from>..<to>` command to inspect, and accepting the review moves the pin.

## Rules

The same exact command succeeding three times against the same binary hash in the same working directory proposes one rule. Rules are literal argv lists bound to the binary hash and the working directory; a changed argument is a different command. Commands carrying metacharacters, quoting, or expansion are recorded but never become rules.

## Install

1. Open **Plugins** in the DSH Web sidebar.
2. Choose **Add plugin** and give it the absolute path to this directory (or the package name once it is on npm).
3. Enable the bundle, then open **Audit** in the sidebar.

It starts in `observe`, so nothing is blocked until you choose `ask` or `enforce`.

## Development

Plain ESM, no build step, no runtime dependencies.

| Path | Role |
|---|---|
| `index.js` | Host plugin: pipeline listeners, classification, gate, learning |
| `src/config.js` | Every tunable, validation, settings allowlist |
| `src/store.js` | Atomic state file and the audit stream |
| `src/command.js` | Tokenizing, executable resolution, hashing |
| `src/releases.js` | Release pins, trust, update reviews |
| `src/gate.js` | Fixed question set, providers, probability mapping |
| `src/api.js` | `/dsh-tool-audit/state` and `/dsh-tool-audit/action` |
| `client.js` | Sidebar page and settings page |

```sh
npm test    # host, routes, gate, releases, enforce, client registration
```

## Status

The Host half is covered by tests: one call produces one audit line with a resolved hash, three identical successful calls propose a rule, approvals persist, the gate maps probabilities to allow/ask/deny, a provider failure becomes an ask, observe never calls the provider, and a changed hash opens exactly one review that moves the pin when accepted.

The browser half is covered at registration scope (sidebar entry, audit panel, settings page). Its rendering and the same-origin route transport have not been exercised in an automated page.

## Limits

- Only the first token of a shell command is resolved; programs a shell starts itself are not audited.
- Commands with metacharacters, quotes, or expansion never become rules or release comparisons.
- The plugin records the diff command but does not run it.
- The routes are served by the Host web server, gated by a plugin header, and not authenticated by the Session RPC transport.

See [docs/DETAIL.md](docs/DETAIL.md) for the full behavior.
