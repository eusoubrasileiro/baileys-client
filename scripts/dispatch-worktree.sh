#!/usr/bin/env bash
# dispatch-worktree.sh — baileys-client (library) variant
#
# Adapted from standards/templates/scripts/dispatch-worktree.sh.
# This is a pure ESM TypeScript library — no Postgres, no .env files, no
# servers/ports. So the harness is stripped to the essentials:
#
#   1. Create an isolated git worktree at .claude/worktrees/<slug> on branch
#      agent/<slug> (off main by default).
#   2. Require a pre-written plan at .claude/plans/<slug>.md; copy into the
#      worktree as .claude/PLAN.md (frozen contract).
#   3. Stamp .claude/AGENT.md from scripts/agent-prompt.md.
#   4. Run pnpm install inside the worktree (frozen lockfile).
#
# Usage:  pnpm dispatch <slug> [--from <base-branch>] [--no-install]

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: pnpm dispatch <slug> [--from <base-branch>] [--no-install]

Materialises an agent-ready worktree at .claude/worktrees/<slug> on branch
agent/<slug>. Requires a non-empty .claude/plans/<slug>.md in the parent
worktree (the plan becomes the agent's task contract).

Slug must match [a-z0-9-]{1,40}.
EOF
  exit 2
}

SLUG=""
BASE_BRANCH="main"
DO_INSTALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --from)       [ $# -ge 2 ] || usage; BASE_BRANCH="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    -h|--help)    usage ;;
    --*)          echo "Unknown flag: $1" >&2; usage ;;
    *)            [ -z "$SLUG" ] || { echo "Multiple slugs: $SLUG and $1" >&2; usage; }
                  SLUG="$1"; shift ;;
  esac
done

[ -n "$SLUG" ] || usage

if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9-]{1,40}$'; then
  echo "Error: slug must match [a-z0-9-]{1,40} (got: $SLUG)" >&2
  exit 1
fi

# Resolve parent (main-worktree) root.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)"
case "$COMMON_DIR" in
  /*) COMMON_DIR_ABS="$COMMON_DIR" ;;
  *)  COMMON_DIR_ABS="$(cd "$SCRIPT_DIR" && cd "$COMMON_DIR" && pwd)" ;;
esac
PARENT_ROOT="$(cd "$COMMON_DIR_ABS/.." && pwd)"
cd "$PARENT_ROOT"

# Plan-file gate: required.
PLAN_SRC="$PARENT_ROOT/.claude/plans/$SLUG.md"
if [ ! -s "$PLAN_SRC" ]; then
  echo "Error: no plan at .claude/plans/$SLUG.md (or empty)." >&2
  echo "       Write the agent's task plan first, then re-run dispatch." >&2
  exit 1
fi

# Parent tree clean enough (ignore regenerable artefacts).
DIRTY="$(git -C "$PARENT_ROOT" status --porcelain |
  grep -Ev '(\.log$|^\?\? \.claude/worktrees/|^\?\? \.claude/plans/)' || true)"
if [ -n "$DIRTY" ]; then
  echo "Error: parent worktree has uncommitted non-artefact changes." >&2
  echo "       Dispatch refuses to drag WIP into the agent worktree." >&2
  git -C "$PARENT_ROOT" status >&2
  exit 1
fi

WORKTREES_DIR="$PARENT_ROOT/.claude/worktrees"
WORKTREE_ROOT="$WORKTREES_DIR/$SLUG"
BRANCH="agent/$SLUG"

mkdir -p "$WORKTREES_DIR"

EXISTING_WT="$(git -C "$PARENT_ROOT" worktree list --porcelain |
  awk -v p="$WORKTREE_ROOT" '$1=="worktree" && $2==p {found=1} END{print (found?"yes":"")}')"

if [ -n "$EXISTING_WT" ]; then
  echo "[dispatch] reusing existing worktree at $WORKTREE_ROOT"
  CUR_BRANCH="$(git -C "$WORKTREE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
  if [ "$CUR_BRANCH" != "$BRANCH" ]; then
    echo "Error: worktree at $WORKTREE_ROOT is on '$CUR_BRANCH', expected '$BRANCH'." >&2
    echo "       Pick a different slug or run pnpm dispatch:cleanup --slug $SLUG." >&2
    exit 1
  fi
else
  if git -C "$PARENT_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "[dispatch] branch $BRANCH exists; checking out into $WORKTREE_ROOT"
    git -C "$PARENT_ROOT" worktree add "$WORKTREE_ROOT" "$BRANCH"
  else
    echo "[dispatch] creating worktree $WORKTREE_ROOT on new branch $BRANCH (off $BASE_BRANCH)"
    git -C "$PARENT_ROOT" worktree add -b "$BRANCH" "$WORKTREE_ROOT" "$BASE_BRANCH"
  fi
fi

# Stamp AGENT.md
mkdir -p "$WORKTREE_ROOT/.claude"
PROMPT_SRC="$PARENT_ROOT/scripts/agent-prompt.md"
if [ -f "$PROMPT_SRC" ]; then
  sed -e "s|\${WORKTREE_ROOT}|$WORKTREE_ROOT|g" \
      -e "s|\${AGENT_SLUG}|$SLUG|g" \
      "$PROMPT_SRC" > "$WORKTREE_ROOT/.claude/AGENT.md"
else
  echo "[dispatch] WARNING: $PROMPT_SRC missing — AGENT.md not stamped." >&2
fi

# Copy plan into the worktree as PLAN.md (frozen contract).
cp "$PLAN_SRC" "$WORKTREE_ROOT/.claude/PLAN.md"

if [ "$DO_INSTALL" = "1" ]; then
  echo "[dispatch] pnpm install --frozen-lockfile in $WORKTREE_ROOT ..."
  (cd "$WORKTREE_ROOT" && pnpm install --frozen-lockfile)
else
  echo "[dispatch] --no-install: skipping pnpm install"
fi

cat <<EOF

# ── dispatch complete ───────────────────────────────────────────────────────
WORKTREE_ROOT=$WORKTREE_ROOT
AGENT_BRANCH=$BRANCH
AGENT_SLUG=$SLUG
EOF
