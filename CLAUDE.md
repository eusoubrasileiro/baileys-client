# @amiticia/baileys-client

Shared Baileys WhatsApp client library. Consumed by [`whatsapp-mcp`](https://github.com/AmiticIA-AutoSys/whatsapp-mcp).

## Commands

```bash
pnpm build     # tsup — ESM bundle + .d.ts to dist/
pnpm test      # vitest run
pnpm check     # biome check (lint + format)
pnpm format    # biome check --write (auto-fix)
```

Always run `pnpm check` before committing.

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

## Multi-agent dispatch harness

See `scripts/dispatch-worktree.sh` (`pnpm dispatch <slug>`). Library-only
variant of the standards harness — no Postgres, no ports. Pre-write a plan
at `.claude/plans/<slug>.md`; dispatch materialises an isolated worktree at
`.claude/worktrees/<slug>` on branch `agent/<slug>` and stamps the agent
contract as `.claude/AGENT.md`. Cleanup: `pnpm dispatch:cleanup --slug <slug>`.

## The gate

| Stage | Runs |
|---|---|
| pre-commit | `pnpm check` (biome) · `tsc --noEmit` · `pnpm test` (vitest, 211) · `pnpm test:harness` (~5s total) |
| commit-msg | commitlint, conventional types |
| pre-push | the same, plus the review log for the pushed range and `scripts/security-review.mjs` |

`scripts/**/*.test.mjs` are `node:test` files copied from
`standards/templates/`, which vitest cannot run — hence the `test:harness`
split and the explicit `include` in `vitest.config.ts`. Do not fork them to
suit a runner; the template is the source of truth.

> **Conformance:** `qgat` — n/a: TODO-RATIFY: a ratchet needs a coverage baseline this library has never had; adding one is work, not config.

## Behavioral probes

The 211 unit tests drive the reconnect state machine against fakes. They cannot
tell you the real socket reconnects after WhatsApp drops it — and getting that
wrong logs the account out, which needs the physical handset to undo.

| Probe | Tool | Allowed target |
|---|---|---|
| A dropped connection re-pairs and resumes without a logout | this library's own `startConnection`, driven from a scratch script | a throwaway auth dir and the coexistence test number — **never** a paired production session dir |
| The upstream baileys API still matches what the contract tests pin, after a dependency bump | `pnpm test` plus reading the diff | offline |

Run at the merge/done boundary. The first probe touches WhatsApp's live network
and stays **attended**.

⚠️ This library has no service of its own: `whatsapp-mcp` and `bulk-messages`
both consume it, so a regression here reaches both at once. A change to
`connection.ts`, `connection-handler.ts` or `reconnection-strategy.ts` is worth
probing before it lands, not after.
