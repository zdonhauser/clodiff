# clodiff

A local code review viewer for Claude Code. Run it in any repo and Claude can navigate the diff, highlight lines, leave inline annotations, and submit full GitHub PR reviews — all from a shared browser window.

![clodiff reviewing a pull request — PR meta bar, file tree, and inline Claude annotations](docs/screenshots/pr-review.png)

<details>
<summary>Prefer light mode? It follows your system theme.</summary>

![clodiff in light mode](docs/screenshots/pr-review-light.png)

</details>

---

## Installation

Requires [Node.js](https://nodejs.org) **≥ 20.11**. The published package ships
compiled JavaScript — no extra runtime or build step on your end.

```bash
npm install -g clodiff
clodiff
```

Or run without installing:

```bash
npx clodiff
```

---

## Usage

### Uncommitted changes (the default)

```bash
clodiff                      # uncommitted changes vs the last commit
                             # (tracked + untracked files) — unless the branch
                             # has an open PR, in which case PR review wins
clodiff --working            # force uncommitted-vs-HEAD even on a PR branch
clodiff --working --base main   # uncommitted changes vs another branch
```

### Local branch review

```bash
clodiff --base main          # working tree (incl. uncommitted) vs a branch
clodiff --from HEAD~3 --to HEAD   # specific commit range
git diff HEAD~1 | clodiff --stdin # pipe a diff from any source
clodiff --patch my.patch     # load a patch file
```

### PR review

```bash
clodiff                      # on a PR branch — auto-detects the open PR,
                             # fetches the diff, imports existing review threads,
                             # and loads PR metadata (title, author, CI status)

clodiff --pr 42              # explicit PR number (when not on the branch)
```

You don't have to relaunch to change what's being diffed. From the header, the
**base ← compare** pickers open a searchable dropdown grouped into *recent
commits* (with messages and dates), *local branches*, and *remote branches*
(so e.g. `main` and `origin/main` are both selectable), plus working-tree and
HEAD shortcuts. The **Settings** (gear) panel also has a one-click **Diff mode**
toggle: uncommitted changes, vs the base branch, vs the remote base, last commit,
or PR review. Both drive `POST /mode` / `POST /rediff` under the hood — see
[Server API](#server-api).

The `--pr` flag (or auto-detection) enables the full PR review workflow:
existing GitHub review comments are imported into the session so you can see
what others have already said, and resolving threads is staged for GitHub sync
on submit.

### All flags

```
--working          Uncommitted changes vs HEAD (or --base <ref>); tracked + untracked
--uncommitted      Alias for --working
--base <branch>    Working tree vs a branch (local mode)
--from <ref>       Start of range (requires --to)
--to <ref>         End of range (requires --from)
--pr <number>      Set PR number for GitHub submit/import
--stdin            Read diff from stdin
--patch <path>     Read diff from a patch file
--port <number>    Port to listen on (default: 7777, auto-increments if taken)
--resume           Resume existing session without warning
--stop             Stop the clodiff server running for this repo
--status           Show whether a server is running for this repo (port/pid)
-h, --help         Show usage and exit
-v, --version      Print the version and exit
```

Gitignored files are never shown — the working-tree diff includes *untracked*
files but honors `.gitignore` (via `git ls-files --exclude-standard`), and the
file tree lists tracked files only.

---

## Features

### Inline annotations

Claude (or any code review tool) writes findings directly into the session.
Annotations appear as comment cards alongside the relevant diff lines with:

- **Severity levels** — error, warning, suggestion, note
- **Markdown rendering** — full GitHub-flavored markdown in comment bodies
  (headings, code fences, tables, task lists, links)
- **Reply threading** — reply to any annotation inline; Claude can respond
  in-thread without needing a new chat message
- **Edit before submit** — click Edit on any annotation to refine the wording
  before it goes to GitHub

![An inline annotation card with severity badge, rendered markdown, and Reply / Edit / Resolve / Fix It / Reject actions](docs/screenshots/annotation-card.png)

### Comment navigation

A floating pill in the bottom-right corner shows the current comment's severity
and position (e.g. "3/7"). ↑/↓ navigate in severity order (errors first).
The same arrows appear on each comment card. Fix It and Reject automatically
advance to the next comment.

### Submit Review (PR mode)

The **Submit Review** button opens a modal where you:

1. Choose the review decision — Approve, Request Changes, or Comment
2. Write an optional review summary body
3. See staged comment counts by severity
4. Submit — which sets the event, posts the body, pushes all annotations
   to GitHub as a PR review, and resolves any threads you marked resolved

GitHub's restriction that you cannot approve your own PR is detected and
the Approve option is disabled with an explanation.

![The Submit Review modal showing staged comment counts by severity, a review summary field, and the Comment / Approve / Request Changes decision](docs/screenshots/submit-review.png)

### Sticky file headers

A sticky bar shows the current file name as you scroll through a multi-file
diff so you always know which file you're looking at.

### File tree & expansion

The sidebar lists changed files (grouped by directory) with per-file comment
counts. Every file is **expanded by default** so the whole diff is visible at a
glance, and an **expand/collapse-all** toggle sits in the "Files changed" header.
Your manual collapse/expand choices are preserved across hot-reloads — editing
code won't re-expand a file you collapsed. The Settings **All files** option
swaps the changed-files list for the full repo tree.

### Settings

A gear panel at the bottom of the sidebar holds: the **Diff mode** toggle
(uncommitted / vs base / vs remote base / last commit / PR review), **All files**,
**Wrap long lines**, and **Text size**. Preferences persist across sessions.

### Live reload & single window

The viewer hot-reloads as the working tree, index, or `HEAD` change, so the diff
stays current without relaunching. Re-running `clodiff` on a repo that already
has a live session reuses that window instead of opening a duplicate.

---

## Session

State lives under the repo's git dir at `<git-dir>/clodiff/session.json` (e.g.
`.git/clodiff/session.json`) — invisible to git, so there's nothing to
`.gitignore`, and it's per-worktree friendly. When you're not in a git repo it
falls back to a temp dir keyed by the working directory. The file stores the
diff metadata, all annotations, reply threads, pending GitHub thread resolves,
PR metadata, and the server port.

Re-running `clodiff` in a repo that already has a live session **reuses the
running window** instead of opening a second one, and the viewer **hot-reloads**:
edit code, commit, or switch branches and the diff updates itself — no need to
relaunch. `--resume` forces resumption of an existing session without the prompt.

### Background daemon

`clodiff` **self-daemonizes**: the command returns immediately and the server runs
detached in its own session (via `setsid`), so it **survives the terminal or Claude
session that launched it** — you won't come back to a dead localhost tab. Stop a
server with `clodiff --stop` from the repo (the review state is kept, so you can
resume later), and check `clodiff --status` to see whether one is running and on
which port. The daemon logs to `<git-dir>/clodiff/clodiff.log`.

Identity is **per git worktree**: clodiff keys its session/port off
`git rev-parse --absolute-git-dir`, so each worktree (and each separate repo) gets
its own independent daemon, port, and diff — run as many at once as you like, with
no cross-talk. Only the *same directory* opened twice shares a daemon.

---

## Server API

The viewer communicates with the server over HTTP and WebSocket. Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/init` | Full diff + session payload (WebSocket sends this on connect) |
| `GET` | `/session` | Current session.json |
| `POST` | `/reply` | Add a reply to a comment thread. `source: "claude-code"` skips the monitor queue and renders a styled inline response card |
| `POST` | `/action` | Record Fix It / Reject decision — resolves the comment and notifies the monitor via `replies.json` without creating a visible reply bubble |
| `POST` | `/resolve` | Resolve a comment; stages its GitHub thread ID for sync on submit |
| `POST` | `/edit-comment` | Update a comment body |
| `POST` | `/review/body` | Set the overall review summary text |
| `POST` | `/review/event` | Set the review decision (APPROVE / REQUEST_CHANGES / COMMENT) |
| `POST` | `/push` | Submit the review to GitHub, then resolve any pending threads |
| `POST` | `/rediff` | Re-run the diff with explicit from/to refs |
| `POST` | `/mode` | Switch diff mode (`working`, `base`, `base-remote`, `last-commit`, `pr`) |
| `POST` | `/_ws_broadcast` | Broadcast a WebSocket message to all connected viewers |
| `GET` | `/file?path=` | Read a file from the repo (for full-file context) |
| `GET` | `/refs` | Recent commits + local & remote branches (grouped, with subjects/dates) |
| `GET` | `/tree` | List tracked files |

WebSocket message types: `init`, `session_update`, `scroll_to`, `highlight`.

### Monitor / reply flow

User replies are written to `<git-dir>/clodiff/replies.json`. A monitor polls
this file and notifies Claude of new replies; Claude responds via `POST /reply`
with `source: "claude-code"`, which writes the response directly into the
session's comment thread and broadcasts a `session_update` — no separate chat
message needed. The monitor is started automatically by the `nudge-review` hook
whenever a clodiff session is live (or on demand with `/clodiff-watch`), so this
works under any review flow, not just the clodiff-review skill.

---

## Claude Code integration

Install the **clodiff plugin** from [clogins](https://github.com/zdonhauser/clogins):

```
/plugin marketplace add github:zdonhauser/clogins
/plugin install clodiff@clogins
```

This installs two skills, three hooks, and a command:

- **`clodiff` skill** — teaches Claude to start clodiff, navigate the viewer,
  highlight lines, and leave inline annotations during any code discussion
- **`clodiff-review` skill** — the viewer/UI layer for code review: reviews a
  PR or local changes when no other engine is named, or displays findings that
  already exist, as inline annotations staged for a GitHub PR review
- **`inject-replies` hook** — injects pending viewer replies into every prompt
  so you can reply to annotations without leaving the viewer
- **`nudge-review` hook** — does two things while a clodiff session is live:
  (1) on the first prompt after clodiff starts, it tells Claude to start the
  replies watcher (so viewer replies surface proactively under *any* review
  flow); and (2) when your prompt looks like a review — including ones that name
  another engine like a security review, `ultrareview`, or `review-team` — it
  directs Claude to funnel that engine's findings into the viewer as inline
  annotations, without overriding the engine you asked for
- **`load-session` hook** — loads clodiff session state at startup so Claude
  is always aware of an active session
- **`/clodiff-watch` command** — manually start the replies watcher if you want
  proactive reply pickup and the hook hasn't already armed it

---

## Development

```bash
npm install
npm test            # unit tests (vitest)
npm run test:e2e    # Playwright end-to-end tests
npm run build       # bundle src/ -> dist/cli.js (what gets published)
npm run smoke       # pack, install, and run the bin as a user would
```

In development the source runs directly: `node src/cli.ts` works on Node ≥ 22.18
via built-in type stripping, and the test harness launches the CLI through `tsx`
so it runs on older Node too. Publishing bundles `src/` to `dist/cli.js` with
esbuild (`prepublishOnly`), because Node won't type-strip files under
`node_modules` — so the installed package must ship plain JavaScript.
