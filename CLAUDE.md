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
