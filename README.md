# clodiff

clodiff is a local diff viewer built as a companion for Claude Code. It gives Claude a structured way to write inline code review comments on your diffs, displays them in a browser-based viewer alongside the diff, and lets you push the completed review directly to GitHub as a pull request review — all without leaving your terminal.

---

## Installation

Run directly with Bun (no install needed):

```bash
bunx clodiff
```

Or with npm:

```bash
npx clodiff
```

Or install globally:

```bash
bun add -g clodiff
# then:
clodiff
```

---

## Usage

```
clodiff [options]
```

| Flag | Default | Description |
|---|---|---|
| `--base <branch>` | `main` | Base branch for `git diff` |
| `--port <number>` | `7777` | Port to listen on (auto-increments if taken) |
| `--resume` | false | Resume an existing session without warning |
| `--stdin` | false | Read diff from stdin |
| `--patch <path>` | — | Read diff from a patch file |
| `--from <ref>` | — | Start ref for `git diff <from> <to>` |
| `--to <ref>` | — | End ref for `git diff <from> <to>` |
| `--install-hooks` | — | Install Claude Code hooks into `.claude/settings.json` |

### Examples

```bash
# Review changes against main
clodiff

# Review against a different base branch
clodiff --base develop

# Review a specific range of commits
clodiff --from HEAD~3 --to HEAD

# Review from a saved patch file
clodiff --patch my-changes.patch

# Pipe a diff from another command
git diff HEAD~1 | clodiff --stdin

# Start on a different port
clodiff --port 8888
```

---

## Claude Code integration

### Quickstart

1. Install the hooks into your repo:

```bash
bunx clodiff --install-hooks
```

This writes two hook entries into `.claude/settings.json`:
- `SessionStart` — loads the existing session as context when Claude starts
- `UserPromptSubmit` — injects any pending replies into each prompt

2. Start a review session:

```bash
clodiff
```

The browser opens to the diff viewer automatically.

3. Ask Claude to review your changes:

> "Review the diff in the clodiff viewer and add inline comments for any issues you find."

Claude will write `ReviewComment` objects directly to `.review/session.json`. The viewer updates in real time. You can reply to comments in the viewer, and Claude will see your replies in the next prompt.

See `CLAUDE.md` in this repo for the full Claude Code integration protocol (comment schema, emit steps, reply handling, etc.).

---

## Session file

The session lives at `.review/session.json` in your repo root. It contains:

- `base_branch` — the branch being diffed against
- `head_commit` / `current_commit` — for re-anchoring comments after new commits
- `reviews[]` — array of review objects, each with `comments[]`
- `port` — the port the clodiff server is running on
- `pr_number` — populated when pushing to GitHub

The `.review/` directory is automatically added to `.gitignore` when the session is created.

---

## Review-team integration

clodiff is designed to grow into a multi-participant review workflow. The `source` field on every comment and review distinguishes between `"claude-code"`, `"user"`, and `"review-team"` contributions. A review team member can POST comments directly to the session file (or via a webhook) and they will appear in the same viewer alongside Claude's comments.

The session file format is versioned (`"version": 1`) and designed to be stable. Future versions of clodiff will support fetching existing GitHub PR review comments back into the session so that the full review conversation is visible in one place, and syncing resolved/unresolved state between the viewer and GitHub.

---

## GitHub push

Once you are satisfied with the review, set the review outcome (Approve / Comment / Request Changes) in the viewer and click **Push to GitHub**. This calls `/push` on the local server, which uses `gh` (the GitHub CLI) to create a pull request review from the latest `Review` object in the session.

Requirements:
- `gh` must be installed and authenticated (`gh auth login`)
- The repo must have an open pull request for the current branch

---

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start the viewer in dev mode
cd viewer && bun dev
```
