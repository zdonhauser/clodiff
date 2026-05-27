# clodiff — Claude integration

clodiff is a local code viewer that lives alongside your conversations. It gives you and the human a shared visual context — you can point to specific lines, annotate code, and navigate the repo while discussing it in chat.

---

## Detecting clodiff

Check for `.review/session.json` in the repo root. If it exists, clodiff is active.

```javascript
import { existsSync } from "fs"
const active = existsSync(".review/session.json")
```

Read the session file to get `port`:

```javascript
import { readFileSync } from "fs"
const session = JSON.parse(readFileSync(".review/session.json", "utf-8"))
const port = session.port // e.g. 7777
```

---

## Pointing to code

Send a `scroll_to` message to jump the viewer to a specific line:

```javascript
await fetch(`http://localhost:${port}/_ws_broadcast`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "scroll_to", path: "src/server.ts", line: 42 })
})
```

Send a `highlight` message to visually call out a line with a fading glow — useful when drawing attention to specific code in conversation:

```javascript
await fetch(`http://localhost:${port}/_ws_broadcast`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "highlight",
    path: "src/server.ts",
    line: 42,
    duration: 4000,  // ms before fading (default: 4000)
    scroll: true     // also scroll to the line (default: true)
  })
})
```

---

## Annotating code

You can leave persistent inline annotations on specific lines. Annotations appear as comment cards in the viewer next to the relevant code.

```typescript
interface Annotation {
  id: string              // crypto.randomUUID()
  created_at: string      // ISO 8601
  source: "claude-code" | "user"
  body: string            // the annotation text
  path: string            // file path relative to repo root
  commit_id: string       // git rev-parse HEAD
  line: number            // absolute line number
  side: "LEFT" | "RIGHT" // LEFT = old file; RIGHT = new file / current file
  line_content: string    // trimmed text of the target line
  severity?: "error" | "warning" | "suggestion" | "note"
  resolved?: boolean
  replies?: Annotation[]
}
```

To emit an annotation:

1. Get the current HEAD: `git rev-parse HEAD`
2. Build the object with all fields above
3. Read `.review/session.json`, append to `reviews[reviews.length - 1].comments`, write back
4. Broadcast `scroll_to` so the viewer jumps to the annotation

```javascript
const session = JSON.parse(fs.readFileSync(".review/session.json", "utf-8"))
session.reviews[session.reviews.length - 1].comments.push(annotation)
fs.writeFileSync(".review/session.json", JSON.stringify(session, null, 2))
```

---

## Handling replies

When the human replies to an annotation in the viewer, the reply lands in `.review/replies.json`. The `UserPromptSubmit` hook (installed via `clodiff --install-hooks`) injects pending replies into each prompt:

```
[clodiff replies]
<reply id="uuid" comment_id="COMMENT_ID" created_at="...">
Reply text here.
</reply>
```

Treat each `<reply>` as the human's response to the annotation with that `comment_id`.

---

## Server endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Viewer UI |
| `/init` | GET | Current diff, annotations, session |
| `/session` | GET | Session file contents |
| `/reply` | POST | `{ comment_id, body }` — append a reply |
| `/_ws_broadcast` | POST | Broadcast any JSON message to all viewer clients |
| `/refs` | GET | List of git refs (branches/tags) |
| `/rediff` | POST | `{ from, to }` — recompute diff and push new init to all clients |
| `/file` | GET | `?path=...` — raw file contents |
| `/tree` | GET | All tracked files in the repo |
| `/review/event` | POST | `{ event }` — set APPROVE / REQUEST_CHANGES / COMMENT on the current review |
| `/push` | POST | Push current annotations to GitHub as a PR review |
| `/ws` | WS | WebSocket — receives `init` on connect, live updates after |
