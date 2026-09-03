import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Explicit include: scripts/ holds node:test harness files copied from
    // standards/templates/, which vitest cannot run. They have their own
    // runner -- `pnpm test:harness`. See whatsapp-mcp for the same split.
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
});
