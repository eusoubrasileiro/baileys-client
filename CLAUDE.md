# @amiticia/baileys-client

Shared Baileys WhatsApp client library. Consumed by `whatsapp-mcp` and `bulk-messages`.

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
| `src/connection.ts` | `startConnection()` — socket creation, event wiring, reconnection |
| `src/connection-handler.ts` | `handleConnectionClose()` — retry/logout logic (DI pattern) |
| `src/sender.ts` | `sendTextMessage()`, `sendMediaMessage()` — take socket as param |
| `src/utils.ts` | JID helpers, QR generation, media extraction, message parsing |
| `src/index.ts` | Barrel export |

## Conventions

- TypeScript strict mode, ESM only (`"type": "module"`)
- Biome for linting and formatting (double quotes, trailing commas, 100-char line width)
- No default exports — always named exports
- Functions take dependencies as parameters, not from module-level singletons
- Sender functions return `{ success, messageId?, error? }` — never throw
