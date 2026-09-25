# @amiticia/baileys-client

Shared WhatsApp client library wrapping [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys). Handles connection, reconnection, message sending, and JID utilities with a pluggable event-hook pattern.

## Install

The package is installed straight from GitHub. `dist/` is not committed — a `prepack`
script builds it during a git install, and pnpm 10 only runs a git dependency's build
script when the consuming project allows it. Add the allowlist first:

```jsonc
// your package.json
"pnpm": {
  "onlyBuiltDependencies": ["@amiticia/baileys-client"]
}
```

```bash
pnpm add github:AmiticIA-AutoSys/baileys-client
```

To develop against a local checkout instead (how
[whatsapp-mcp](https://github.com/AmiticIA-AutoSys/whatsapp-mcp) consumes it), clone the
two repos side by side, depend on `"@amiticia/baileys-client": "link:../baileys-client"`,
and run `pnpm install && pnpm build` in this repo.

## Usage

```typescript
import { startConnection, sendTextMessage, phoneToJid } from "@amiticia/baileys-client";
import pino from "pino";

const logger = pino({ level: "info" });

const { socket, connectionState, socketState } = await startConnection({
  authDir: "./auth_info",
  logger,
  hooks: {
    onQrCode: (qr, ascii) => console.log(ascii),
    onConnected: (user) => console.log(`Connected as ${user.name}`),
    onMessageUpsert: (messages, type) => {
      for (const msg of messages) {
        // store in your DB, process, etc.
      }
    },
  },
});

// Send a message
const jid = phoneToJid("5511999887766");
const result = await sendTextMessage(socket, jid, "Hello!", logger);
```

## API

### Connection

- `startConnection(config)` — creates socket, wires Baileys events to hooks, handles auto-reconnect. Returns `{ socket, connectionState, socketState }`.

### Sending

- `sendTextMessage(socket, jid, text, logger)` — returns `{ success, messageId?, error?, errorKind? }`; never throws. `errorKind` is `transient` / `permanent` / `unknown` (see `classifySenderError`)
- `sendMediaMessage(socket, jid, { buffer, type, caption?, fileName?, mimetype? }, logger)` — same return shape

### Utilities

- `phoneToJid(phone)` — `"5511999..."` to `"5511999...@s.whatsapp.net"`
- `normalizeJid(jid)` — strips device suffix
- `isGroupJid(jid)` — checks `@g.us`
- `parseMessage(msg)` — extracts text/media content into a flat `ParsedMessage`
- `extractMediaInfo(message)` — pulls media metadata from a WAMessage
- `generateAsciiQR(data)` — renders QR as ASCII string

### Types

`BaileysClientConfig`, `BaileysClientHooks`, `ConnectionState`, `WhatsAppSocket`, `ParsedMessage`, `MediaInfo`, plus re-exported Baileys types (`WAMessage`, `WAMessageUpdate`, `Contact`, `Chat`).

## Development

```bash
pnpm install
pnpm build     # tsup -> dist/
pnpm test      # vitest
pnpm check     # biome lint + format
pnpm format    # biome auto-fix
```
