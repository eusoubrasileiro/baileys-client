# @amiticia/baileys-client

Storage-free WhatsApp client library over `@whiskeysockets/baileys` 7.0.0-rc14. Consumed by
[`whatsapp-mcp`](https://github.com/eusoubrasileiro/whatsapp-mcp) as a sibling checkout
(`link:../baileys-client`). Public API: `src/index.ts`; user docs: `README.md`.

## Commands

```bash
pnpm build     # tsup — ESM bundle + .d.ts to dist/
pnpm test      # vitest run
pnpm check     # biome check (lint + format)
pnpm format    # biome check --write (auto-fix)
pnpm typecheck # tsc --noEmit
pnpm test:harness  # node:test suites for scripts/
```

## Architecture

**Event-hook pattern**: `startConnection(config)` accepts a `BaileysClientHooks` object. Baileys events (`messages.upsert`, `contacts.upsert`, etc.) are forwarded to these hooks. The library has zero storage — consumers decide what to persist and how.

**DI in connection-handler**: `handleConnectionClose()` takes all dependencies as a `ConnectionCloseDeps` param (logger, fs functions, retry function, auth dir). This makes it fully testable without mocking modules.

**No singletons**: `startConnection()` returns `{ socket, connectionState, socketState }` per call. Consumers hold their own references.

## Module map

| File | Purpose |
|------|---------|
| `src/types.ts` | All types and the `BaileysClientHooks` / `BaileysClientConfig` interfaces |
| `src/connection.ts` | `startConnection()` — socket creation; wires `createEventDispatcher` to `sock.ev.process` |
| `src/event-dispatcher.ts` | `createEventDispatcher()` — per-event named handlers, sync-timer lifecycle, seam for unit tests |
| `src/connection-handler.ts` | `handleConnectionClose()` — retry/logout/giveup decision routed through `ReconnectionStrategy` |
| `src/reconnection-strategy.ts` | `defaultReconnectionStrategy()` + `ReconnectionStrategy` interface — retry policy seam |
| `src/media.ts` | `downloadMedia()` — media download; delegates CDN-refresh retry to `MediaRefreshAdapter` |
| `src/media-refresh.ts` | `defaultMediaRefreshAdapter()` + `MediaRefreshAdapter` interface — CDN-refresh seam |
| `src/sender.ts` | `sendTextMessage()`, `sendMediaMessage()` — populate `errorKind` via `classifySenderError` on failure |
| `src/sender-errors.ts` | `classifySenderError()` — maps thrown errors to `transient` / `permanent` / `unknown` |
| `src/message-content.ts` | `extractMessageContent()` — polymorphic Baileys envelope → preview-string registry |
| `src/utils.ts` | JID helpers, QR generation, media extraction, `parseMessage` (orchestrator) |
| `src/lid.ts` | `makeLidResolver()` — typed surface over Baileys LID mapping store |
| `src/index.ts` | Barrel export |

## Conventions

- TypeScript strict mode, ESM only (`"type": "module"`)
- Biome for linting and formatting (double quotes, trailing commas, 100-char line width)
- No default exports — always named exports
- Functions take dependencies as parameters, not from module-level singletons
- Sender functions return `{ success, messageId?, error?, errorKind? }` — never throw

## Gate

Husky runs it; never bypass with `--no-verify` — fix the root cause.

| Hook | Runs |
|---|---|
| pre-commit | `pnpm check` · `pnpm exec tsc --noEmit` · `pnpm test` (vitest) · `pnpm test:harness` |
| commit-msg | commitlint, Conventional Commits |
| pre-push | the same, plus `scripts/security-review.mjs` (an LLM review via the `claude` CLI — without an authenticated `claude` on PATH the push is refused; outside contributors can open a PR instead) |

`pnpm test:harness` runs the `node:test` files under `scripts/` (the review/dispatch
tooling); vitest cannot run them, hence the split and the explicit `include` in
`vitest.config.ts`.

## Parallel work

`pnpm dispatch <slug>` (`scripts/dispatch-worktree.sh`) needs a plan at
`.claude/plans/<slug>.md`, creates a worktree at `.claude/worktrees/<slug>` on branch
`agent/<slug>`, and stamps `scripts/agent-prompt.md` into it as `.claude/AGENT.md`.
Cleanup: `pnpm dispatch:cleanup --slug <slug>`.

## Reconnection is the risky path

Unit tests drive the reconnect state machine against fakes; they cannot prove a real
socket survives a WhatsApp drop, and getting it wrong logs the account out (only the
paired phone can undo that). Before landing changes to `connection.ts`,
`connection-handler.ts` or `reconnection-strategy.ts`, exercise `startConnection` from a
scratch script against a throwaway auth dir and a test number — never a paired
production session — with a human watching. After a Baileys bump, re-run `pnpm test`
and read the upstream diff: the contract tests pin its API.

Downstream consumers (e.g. `whatsapp-mcp`) pick up every regression here, so treat
exported signatures as a public API.
