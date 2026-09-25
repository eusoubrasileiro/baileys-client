# Agent contract — read before any tool call

You are a dispatched sub-agent inside an isolated git worktree.

## Task contract — `.claude/PLAN.md`

**First action — always:** read `.claude/PLAN.md`. If missing or empty, abort
immediately and report "no plan in worktree — dispatch bypassed the gate". Do
not improvise scope from external context. The plan file is your contract; if
it doesn't cover something, stop and report rather than guessing.

## Rules

1. **STAY HERE.** Every command runs from `${WORKTREE_ROOT}`. If
   `git rev-parse --show-toplevel` does NOT return `${WORKTREE_ROOT}`, STOP and
   report — you're about to corrupt the main worktree.

2. **Never bypass hooks or signing.** No `--no-verify`. If a hook fails, fix
   the root cause.

3. **Branch is `agent/${AGENT_SLUG}`.** Don't switch, don't pull from main
   mid-task. Commit and push to `origin/agent/${AGENT_SLUG}` when finished.

4. **TDD discipline (mandatory).** For every behaviour change:
   - Write the test FIRST (Red).
   - Make it pass (Green).
   - Refactor only with tests green.
   Existing tests must remain green throughout.

5. **Allowed-files contract.** PLAN.md declares `files-allowed` and
   `files-forbidden` lists. Do not edit anything outside the allowed list.
   `src/types.ts` is shared — you may APPEND new types but NEVER modify or
   delete existing exports (those are merge hazards for sibling agents).

6. **Gates before commit:**
   ```bash
   pnpm test          # must be green
   pnpm exec tsc --noEmit
   pnpm check         # biome
   pnpm test:harness  # node:test suites for scripts/
   pnpm build         # tsup — must succeed
   ```
   All five must pass. If any fail, fix the root cause; do not skip.

7. **No premature abstraction.** Build the deepening described in PLAN.md.
   Don't bolt on extra features, error handlers, or hypothetical seams.

## When you finish

```bash
git add <files>
git commit -m "refactor(<scope>): <one-line summary>"
git push -u origin agent/${AGENT_SLUG}
```

Report back with:
- The commit SHA on `agent/${AGENT_SLUG}`.
- One paragraph describing what changed and how the deepening was achieved.
- The diff stat: `git diff --stat main...HEAD`.
- Confirmation that all five gates (test / tsc / check / harness / build) are green.

The leader takes it from there — you do NOT merge into main, and you do NOT
open the PR yourself.
