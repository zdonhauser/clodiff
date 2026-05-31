# clodiff

A local code viewer for Claude. Run it in any repo and Claude can navigate it, highlight lines, and leave inline annotations while talking with you — a shared visual context for code discussions.

![Inline annotations from Claude Code](docs/annotations.png)

![Line highlight](docs/highlight.png)

---

## Installation

Requires [Bun](https://bun.sh). Run without installing:

```bash
bunx clodiff
```

Or install globally:

```bash
bun add -g clodiff
clodiff
```

---

## Usage

```bash
# Browse the repo (no diff)
clodiff

# Show changes against a branch
clodiff --base main

# Show a specific commit range
clodiff --from HEAD~3 --to HEAD

# Pipe a diff from stdin
git diff HEAD~1 | clodiff --stdin

# Load a patch file
clodiff --patch my.patch
```

```
Options:
  --base <branch>    Diff against a branch
  --from <ref>       Start of range (requires --to)
  --to <ref>         End of range (requires --from)
  --stdin            Read diff from stdin
  --patch <path>     Read diff from a patch file
  --port <number>    Port to listen on (default: 7777)
  --resume           Resume existing session without warning
```

---

## Claude Code integration

Install the **clodiff plugin** from [clogins](https://github.com/zdonhauser/clogins) — it teaches Claude how to start clodiff, navigate the viewer, highlight lines, leave inline annotations, and run full code reviews.

```
/plugin marketplace add github:zdonhauser/clogins
/plugin install clodiff@clogins
```

Once installed, Claude will detect an active clodiff session automatically and use the viewer during code discussions. It will also bootstrap clodiff for you (including checking for bun) if the server isn't running yet. The plugin also installs two hooks: one that injects viewer replies into each prompt so you can reply to annotations inline, and one that loads session state at startup.

---

## Session

State is stored in `.review/session.json`. The `.review/` directory is added to `.gitignore` automatically.

---

## Development

```bash
bun install
bun test
```

## Recent Improvements

- In-thread reply threading: user and Claude replies appear inline in comment cards
- Submit Review modal: stage comments, write a review summary, choose APPROVE/REQUEST_CHANGES/COMMENT
- Inline comment editing: Edit button lets you refine annotations before submitting
