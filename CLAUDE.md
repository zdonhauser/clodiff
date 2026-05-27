# clodiff — Claude Code Integration Guide

clodiff is a local diff viewer and review companion for Claude Code. This document tells you everything you need to interact with it correctly.

---

## Detecting clodiff

Check for `.review/session.json` in the repo root. If it exists, clodiff is active.

```javascript
import { existsSync } from "fs"
const active = existsSync(".review/session.json")
```

Read the session file to get `port` — the port the clodiff HTTP server is currently listening on:

```javascript
import { readFileSync } from "fs"
const session = JSON.parse(readFileSync(".review/session.json", "utf-8"))
const port = session.port // e.g. 7777
```

---

## ReviewComment schema

All review comments are stored in `.review/session.json` under `reviews[N].comments`. Each comment is a `ReviewComment` object:

```typescript
interface ReviewComment {
  // Required fields
  id: string              // UUID — must be unique, generate with crypto.randomUUID()
  created_at: string      // ISO 8601 timestamp
  source: "claude-code" | "user" | "review-team"
  body: string            // Markdown comment text
  path: string            // File path relative to repo root
  commit_id: string       // Current HEAD commit SHA
  line: number            // Absolute line number in the file (not relative to hunk)
  side: "LEFT" | "RIGHT" // LEFT = old file / deleted lines; RIGHT = new file / added lines

  // Strongly recommended
  line_content: string    // Exact trimmed text of the commented line (used for re-anchoring)

  // Optional
  severity?: "error" | "warning" | "suggestion" | "note"
  resolved?: boolean
  replies?: ReviewComment[]
  original_line?: number  // Set automatically if line moves after re-anchoring
  is_outdated?: boolean   // Set automatically if line_content can no longer be found
  start_line?: number     // For multi-line comments
  start_side?: "LEFT" | "RIGHT"
  in_reply_to_id?: number
}
```

Worked example:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "created_at": "2025-01-15T10:30:00Z",
  "source": "claude-code",
  "severity": "suggestion",
  "body": "This should be wrapped in useCallback to avoid re-renders.",
  "path": "src/components/Button.tsx",
  "commit_id": "abc123def456",
  "line": 42,
  "side": "RIGHT",
  "line_content": "const handleClick = () => {",
  "resolved": false
}
```

---

## How to emit a comment

1. Run `git diff <base_branch>` (use `session.base_branch` from `session.json`) to get the current diff.
2. Identify the file path, the absolute line number, and the side:
   - `"RIGHT"` — new-file side (added lines, context in the new file)
   - `"LEFT"` — old-file side (removed lines, context in the old file)
3. Read the exact text of the target line and trim it — this becomes `line_content`.
4. Get the current HEAD commit: `git rev-parse HEAD`.
5. Generate a UUID: `crypto.randomUUID()`.
6. Build the `ReviewComment` object with all required fields.
7. Read `.review/session.json`, append the comment to `reviews[reviews.length - 1].comments`, and write the file back.
8. POST a `scroll_to` message to notify the viewer:

```javascript
const session = JSON.parse(fs.readFileSync(".review/session.json", "utf-8"))
const port = session.port // e.g. 7777

await fetch(`http://localhost:${port}/_ws_broadcast`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "scroll_to",
    path: "src/components/Button.tsx",
    line: 42
  })
})
```

The viewer will scroll to the commented line and highlight it.

---

## Handling replies from the UserPromptSubmit hook

When a user replies to a comment inside the clodiff viewer, the reply is saved to `.review/replies.json`. The `UserPromptSubmit` hook injects these replies into your context at the start of each prompt. Injected replies look like:

```
[clodiff replies]
<reply id="uuid-here" comment_id="COMMENT_ID" created_at="2025-01-15T11:00:00Z">
The user's reply text goes here.
</reply>
```

Treat each `<reply>` as the user's direct response to the comment whose `id` matches `comment_id`. You can use this to resolve the comment, refine it, or continue the discussion.

---

## Session resume

If `.review/session.json` exists when a session starts (via the `SessionStart` hook), load it and continue the existing review. Do not start a new session.

The `load-session.js` hook (installed by `clodiff --install-hooks`) injects the current session state as context at `SessionStart` automatically.

---

## What NOT to do

- **Do NOT narrate review comments in chat.** Write them to `session.json` directly and reference them briefly (e.g., "Added 3 comments to the diff viewer.").
- **Do NOT start a new session if `session.json` already exists.** Resume it.
- **Do NOT emit comments without `line_content`.** Without it, comments cannot be re-anchored after commits.
- **Do NOT emit a comment without a UUID `id` field.** The viewer and reply system depend on stable IDs.
- **Do NOT use relative line numbers.** Always use absolute line numbers (the actual line number in the file, as shown by the diff hunk offsets).
- **Do NOT guess the port.** Always read it from `session.json`.

---

## Server endpoints

All endpoints are served at `http://localhost:<port>`:

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves the diff viewer UI |
| `/init` | GET | Returns the full init payload: `{ type, diff, comments, session }` |
| `/session` | GET | Returns current `session.json` contents |
| `/reply` | POST | Append a reply: `{ comment_id, body }` |
| `/review/event` | POST | Set review event: `{ event: "COMMENT" \| "APPROVE" \| "REQUEST_CHANGES" }` |
| `/push` | POST | Push review to GitHub (requires `gh` auth) |
| `/_ws_broadcast` | POST | Broadcast a JSON message to all connected WebSocket clients |
| `/ws` | WS | WebSocket connection — receives `init` on connect and `session_update` on changes |

---

## GitHub push

Once the review is complete, clicking "Push to GitHub" in the viewer UI posts to `/push`. This requires `gh` to be authenticated (`gh auth login`). The push creates a GitHub pull request review from the comments in the latest `Review` object.

Set the review event in the viewer (Approve / Comment / Request Changes) before pushing.
