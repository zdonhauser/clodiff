# Fix It / Reject Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Fix It" and "Reject" action buttons to Claude's annotation cards, posting a canned reply to Claude via `replies.json`, persisting the resolve to `session.json`, and scrolling the viewer to the next unresolved comment.

**Architecture:** Three existing mechanisms compose cleanly: POST `/reply` wakes Claude's Monitor with a canned body; the new POST `/resolve` persists the resolved flag to `session.json` and broadcasts `session_update`; POST `/_ws_broadcast` with `scroll_to` advances the viewer to the next comment. The `onAction` prop threads through `FileList → FileSection → DiffHunk → CommentThread → CommentCard` following the existing `onReply`/`onResolve` pattern.

**Tech Stack:** Bun, Preact (via esm.sh HTM), Playwright for E2E tests, `bun test` for unit/API tests.

---

## File Map

| File | Change |
|------|--------|
| `src/server.ts` | Add `POST /resolve` endpoint (after line 127, before `/review/event`) |
| `e2e/viewer.spec.ts` | Add two API tests for `/resolve` |
| `viewer/components/CommentCard.js` | Add `onAction` prop; add Fix It + Reject buttons for `claude-code` source |
| `viewer/components/CommentThread.js` | Add `onAction` prop; pass through to `CommentCard` (×2) |
| `viewer/components/DiffHunk.js` | Add `onAction` prop; pass through to `CommentThread` (×3) |
| `viewer/components/FileSection.js` | Add `onAction` prop; pass through to `DiffHunk` |
| `viewer/components/FileList.js` | Add `onAction` prop; pass through to `FileSection` |
| `viewer/app.js` | Add `handleAction`; update `handleResolve` to call `/resolve`; pass `onAction` to `FileList` |
| `e2e/review-flow.spec.ts` | Add 3 E2E tests (Fix It, Reject, user comment no buttons) |

---

## Task 1: POST /resolve server endpoint

**Files:**
- Modify: `src/server.ts` (after line 127)
- Modify: `e2e/viewer.spec.ts`

- [ ] **Step 1: Write two failing API tests in `e2e/viewer.spec.ts`**

Add these tests at the end of the file. They need `readFileSync` and `writeFileSync` — add the import at the top of the file if not present:

```typescript
// Add at top if not already imported:
import { readFileSync, writeFileSync } from "fs"
```

```typescript
test("POST /resolve marks a comment resolved in session.json", async ({ server }) => {
  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const commentId = "resolve-test-" + Date.now()
  session.reviews[session.reviews.length - 1].comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "test",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 1,
    side: "RIGHT",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  const res = await fetch(`http://localhost:${server.port}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment_id: commentId }),
  })
  expect(res.status).toBe(200)

  const updated = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const found = updated.reviews
    .flatMap((r: { comments: Array<{ id: string; resolved?: boolean }> }) => r.comments)
    .find((c: { id: string }) => c.id === commentId)
  expect(found?.resolved).toBe(true)
})

test("POST /resolve returns 404 for unknown comment id", async ({ server }) => {
  const res = await fetch(`http://localhost:${server.port}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment_id: "does-not-exist" }),
  })
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/zHause/Code/clodiff
bunx playwright test e2e/viewer.spec.ts --reporter=line
```

Expected: 2 new tests fail with `404` / connection errors (endpoint doesn't exist yet).

- [ ] **Step 3: Add POST /resolve to `src/server.ts`**

Insert this block immediately after the `/reply` handler block (after line 127, before the comment `// POST /review/event`):

```typescript
          // POST /resolve — mark a comment as resolved in session.json
          if (url.pathname === "/resolve" && req.method === "POST") {
            return req.json().then((body: { comment_id: string }) => {
              try {
                const sessionPath = join(repoDir, ".review", "session.json")
                if (!existsSync(sessionPath)) return new Response("Not Found", { status: 404 })
                const raw = readFileSync(sessionPath, "utf-8")
                const session = JSON.parse(raw) as SessionFile
                let found = false
                for (const review of session.reviews || []) {
                  for (const comment of review.comments || []) {
                    if (comment.id === body.comment_id) {
                      comment.resolved = true
                      found = true
                    }
                  }
                }
                if (!found) return new Response("Comment not found", { status: 404 })
                session.updated_at = new Date().toISOString()
                writeFileSync(sessionPath, JSON.stringify(session, null, 2))
                for (const client of wsClients) {
                  client.send(JSON.stringify({ type: "session_update" }))
                }
                return new Response("OK", { status: 200 })
              } catch {
                return new Response("Internal Server Error", { status: 500 })
              }
            }).catch(() => new Response("Invalid JSON", { status: 400 }))
          }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx playwright test e2e/viewer.spec.ts --reporter=line
```

Expected: all tests pass including the two new `/resolve` tests.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts e2e/viewer.spec.ts
git commit -m "feat: add POST /resolve endpoint to persist comment resolved state"
```

---

## Task 2: CommentCard — Fix It / Reject buttons

**Files:**
- Modify: `viewer/components/CommentCard.js`

- [ ] **Step 1: Update the function signature to accept `onAction`**

Change line 99:
```js
export function CommentCard({ comment, onReply, onResolve }) {
```
to:
```js
export function CommentCard({ comment, onReply, onResolve, onAction }) {
```

- [ ] **Step 2: Add Fix It and Reject buttons to the footer**

The footer actions block starts at line 238. Replace the entire footer block (lines 238–271) with:

```js
      <!-- Footer actions -->
      ${!comment.resolved && html`
        <div style=${{
          display: "flex",
          gap: "8px",
          padding: "6px 12px",
          borderTop: "1px solid var(--color-border-muted)",
          background: "var(--color-canvas-subtle)",
        }}>
          <button
            onClick=${handleReply}
            style=${{
              padding: "3px 10px",
              background: "transparent",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-fg-default)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >Reply</button>
          <button
            onClick=${handleResolve}
            style=${{
              padding: "3px 10px",
              background: "transparent",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-fg-muted)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >Resolve</button>
          ${comment.source === "claude-code" && html`
            <button
              onClick=${() => onAction?.(comment.id, "fix")}
              style=${{
                padding: "3px 10px",
                background: "var(--color-accent-emphasis)",
                border: "1px solid transparent",
                borderRadius: "var(--radius-sm)",
                color: "#ffffff",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >Fix It</button>
            <button
              onClick=${() => onAction?.(comment.id, "reject")}
              style=${{
                padding: "3px 10px",
                background: "transparent",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-fg-muted)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >Reject</button>
          `}
        </div>
      `}
```

- [ ] **Step 3: Commit**

```bash
git add viewer/components/CommentCard.js
git commit -m "feat: add Fix It and Reject buttons to CommentCard (no-op until wired)"
```

---

## Task 3: Prop threading — CommentThread, DiffHunk, FileSection, FileList

**Files:**
- Modify: `viewer/components/CommentThread.js`
- Modify: `viewer/components/DiffHunk.js`
- Modify: `viewer/components/FileSection.js`
- Modify: `viewer/components/FileList.js`

- [ ] **Step 1: Update CommentThread.js**

Change line 15 (function signature):
```js
export function CommentThread({ comments, path, line, onReply, onResolve }) {
```
to:
```js
export function CommentThread({ comments, path, line, onReply, onResolve, onAction }) {
```

In the `unresolved.map` block (around line 32–38), add `onAction`:
```js
            <${CommentCard}
              key=${comment.id}
              comment=${comment}
              onReply=${onReply}
              onResolve=${onResolve}
              onAction=${onAction}
            />
```

In the resolved `map` block (around line 65–71), add `onAction`:
```js
                <${CommentCard}
                  key=${comment.id}
                  comment=${comment}
                  onReply=${onReply}
                  onResolve=${onResolve}
                  onAction=${onAction}
                />
```

- [ ] **Step 2: Update DiffHunk.js**

Change line 16 (function signature):
```js
export function DiffHunk({ hunk, comments = [], viewMode, path, onReply, onResolve }) {
```
to:
```js
export function DiffHunk({ hunk, comments = [], viewMode, path, onReply, onResolve, onAction }) {
```

Three `CommentThread` usages in the file (unified at line ~80, left panel at line ~133, right panel at line ~162) — add `onAction=${onAction}` to each:

Unified mode (lines ~80–85):
```js
                      <${CommentThread}
                        comments=${lineThreadComments}
                        path=${path}
                        line=${relevantLineNum}
                        onReply=${onReply}
                        onResolve=${onResolve}
                        onAction=${onAction}
                      />
```

Left panel side-by-side (lines ~133–138):
```js
                  <${CommentThread}
                    comments=${leftComments}
                    path=${path}
                    line=${leftLineNum}
                    onReply=${onReply}
                    onResolve=${onResolve}
                    onAction=${onAction}
                  />
```

Right panel side-by-side (lines ~162–167):
```js
                  <${CommentThread}
                    comments=${rightComments}
                    path=${path}
                    line=${rightLineNum}
                    onReply=${onReply}
                    onResolve=${onResolve}
                    onAction=${onAction}
                  />
```

- [ ] **Step 3: Update FileSection.js**

Change line 32 (function signature):
```js
export function FileSection({ file, comments = [], expanded, onToggle, viewMode, onReply, onResolve, onRef }) {
```
to:
```js
export function FileSection({ file, comments = [], expanded, onToggle, viewMode, onReply, onResolve, onRef, onAction }) {
```

In the `hunks.map` block (lines ~188–196), add `onAction`:
```js
            <${DiffHunk}
              key=${i}
              hunk=${hunk}
              comments=${comments}
              viewMode=${viewMode}
              path=${file.path}
              onReply=${onReply}
              onResolve=${onResolve}
              onAction=${onAction}
            />
```

- [ ] **Step 4: Update FileList.js**

Change the destructured props (lines 21–29):
```js
export function FileList({
  diff = [],
  comments = [],
  expandedFiles = {},
  onToggle,
  viewMode,
  onReply,
  onResolve,
  onFileRef,
  onAction,
}) {
```

In the `FileSection` usage (lines ~55–65), add `onAction`:
```js
          <${FileSection}
            key=${file.path}
            file=${file}
            comments=${fileComments}
            expanded=${expanded}
            onToggle=${() => onToggle?.(file.path)}
            viewMode=${viewMode}
            onReply=${onReply}
            onResolve=${onResolve}
            onRef=${handleRef}
            onAction=${onAction}
          />
```

- [ ] **Step 5: Commit**

```bash
git add viewer/components/CommentThread.js viewer/components/DiffHunk.js viewer/components/FileSection.js viewer/components/FileList.js
git commit -m "feat: thread onAction prop through comment component chain"
```

---

## Task 4: App — handleAction, update handleResolve, wire onAction

**Files:**
- Modify: `viewer/app.js`

- [ ] **Step 1: Update handleResolve to persist via POST /resolve**

Find `handleResolve` (around line 272). Replace it with:

```js
  const handleResolve = useCallback(async (commentId) => {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    )
    fetch("/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    }).catch(() => {})
  }, [])
```

- [ ] **Step 2: Add handleAction after handleResolve**

Insert this immediately after `handleResolve` (after its closing `}, [])` line):

```js
  const handleAction = useCallback(async (commentId, action) => {
    const replyRes = await fetch("/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, body: action === "fix" ? "Fix It" : "Rejected" }),
    })
    if (!replyRes.ok) return

    const resolveRes = await fetch("/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    })
    if (!resolveRes.ok) return

    setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c))

    // Find next unresolved comment in file/line order and scroll to it
    const sorted = [...comments].sort((a, b) => {
      const aFile = diff.findIndex((f) => f.path === a.path)
      const bFile = diff.findIndex((f) => f.path === b.path)
      if (aFile !== bFile) return aFile - bFile
      return a.line - b.line
    })
    const idx = sorted.findIndex((c) => c.id === commentId)
    const next = sorted.slice(idx + 1).find((c) => !c.resolved)
    if (next) {
      fetch("/_ws_broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "scroll_to", path: next.path, line: next.line }),
      }).catch(() => {})
    }
  }, [comments, diff])
```

- [ ] **Step 3: Pass onAction to FileList**

Find the `<${FileList}` JSX (around line 325). Add `onAction` after `onResolve`:

```js
              <${FileList}
                diff=${diff}
                comments=${comments}
                expandedFiles=${expandedFiles}
                onToggle=${handleToggle}
                viewMode=${viewMode}
                onReply=${handleReply}
                onResolve=${handleResolve}
                onAction=${handleAction}
                onFileRef=${handleFileRef}
              />
```

- [ ] **Step 4: Commit**

```bash
git add viewer/app.js
git commit -m "feat: wire handleAction — Fix It/Reject posts reply, resolves, scrolls next"
```

---

## Task 5: E2E tests for Fix It / Reject

**Files:**
- Modify: `e2e/review-flow.spec.ts`

- [ ] **Step 1: Run existing E2E tests to confirm baseline**

```bash
bunx playwright test e2e/review-flow.spec.ts --reporter=line
```

Expected: all 5 existing tests pass.

- [ ] **Step 2: Write 3 failing E2E tests**

Append to `e2e/review-flow.spec.ts`:

```typescript
test("Fix It button posts 'Fix It' reply and resolves the comment", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "fix-it-test-" + Date.now()
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "this code needs fixing",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "error",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("this code needs fixing")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Fix It" })).toBeVisible()

  await page.getByRole("button", { name: "Fix It" }).click()

  // Button disappears once comment is resolved
  await expect(page.getByRole("button", { name: "Fix It" })).not.toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(500)
  const replies = JSON.parse(readFileSync(server.repliesPath, "utf-8"))
  const reply = replies.find((r: { comment_id: string }) => r.comment_id === commentId)
  expect(reply?.body).toBe("Fix It")

  const updated = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const comment = updated.reviews
    .flatMap((r: { comments: Array<{ id: string; resolved?: boolean }> }) => r.comments)
    .find((c: { id: string }) => c.id === commentId)
  expect(comment?.resolved).toBe(true)
})

test("Reject button posts 'Rejected' reply and resolves the comment", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  const commentId = "reject-test-" + Date.now()
  review.comments.push({
    id: commentId,
    created_at: new Date().toISOString(),
    source: "claude-code",
    body: "this suggestion should be rejected",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
    line_content: "export function farewell",
    severity: "suggestion",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("this suggestion should be rejected")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible()

  await page.getByRole("button", { name: "Reject" }).click()

  await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(500)
  const replies = JSON.parse(readFileSync(server.repliesPath, "utf-8"))
  const reply = replies.find((r: { comment_id: string }) => r.comment_id === commentId)
  expect(reply?.body).toBe("Rejected")

  const updated = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const comment = updated.reviews
    .flatMap((r: { comments: Array<{ id: string; resolved?: boolean }> }) => r.comments)
    .find((c: { id: string }) => c.id === commentId)
  expect(comment?.resolved).toBe(true)
})

test("Fix It and Reject buttons do not appear on user-authored comments", async ({ page, server }) => {
  await page.goto(server.baseURL)
  await page.waitForSelector("[data-file-path]", { timeout: 15000 })

  const session = JSON.parse(readFileSync(server.sessionPath, "utf-8"))
  const review = session.reviews[session.reviews.length - 1]
  review.comments.push({
    id: "user-comment-no-actions",
    created_at: new Date().toISOString(),
    source: "user",
    body: "user authored note",
    path: "app.ts",
    commit_id: session.head_commit,
    line: 2,
    side: "RIGHT",
  })
  writeFileSync(server.sessionPath, JSON.stringify(session, null, 2))

  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/_ws_broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_update" }),
    })
  }, server.port)

  await expect(page.getByText("user authored note")).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("button", { name: "Fix It" })).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible()
})
```

- [ ] **Step 3: Run new tests to verify they fail**

```bash
bunx playwright test e2e/review-flow.spec.ts --reporter=line
```

Expected: the 3 new tests fail (Fix It / Reject buttons not found yet).

- [ ] **Step 4: Run the full E2E suite to verify all tests pass after Tasks 1–4**

```bash
bunx playwright test --reporter=line
```

Expected: all tests pass including the 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add e2e/review-flow.spec.ts
git commit -m "test(e2e): add Fix It / Reject button flow tests"
```

---

## Self-Review Checklist

- [x] `POST /resolve` endpoint → Task 1
- [x] Fix It + Reject buttons in CommentCard → Task 2
- [x] Buttons only for `claude-code` source → Task 2 (conditional render)
- [x] `onAction` threads through all 4 intermediate components → Task 3
- [x] `handleAction` posts reply + resolve + scrolls next → Task 4
- [x] `handleResolve` updated to persist via `/resolve` → Task 4
- [x] E2E: Fix It resolves + writes reply → Task 5
- [x] E2E: Reject resolves + writes reply → Task 5
- [x] E2E: user comments don't show buttons → Task 5
- [x] No placeholders — all code blocks are complete
- [x] Type names consistent: `onAction(commentId, action)` used throughout
