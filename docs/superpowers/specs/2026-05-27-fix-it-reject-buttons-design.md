# Fix It / Reject Buttons — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Summary

Add "Fix It" and "Reject" action buttons to Claude's annotation cards in the clodiff viewer. Clicking either button sends a canned reply to Claude via `replies.json`, resolves the comment, and scrolls the viewer to the next unresolved annotation — all without requiring the user to type anything.

---

## Architecture

No new data formats or protocols. The feature reuses three existing mechanisms:

- **`/reply` endpoint** — receives the canned reply body, appends to `replies.json`, waking Claude's Monitor
- **`/_ws_broadcast` endpoint** — fans out `{ type: "scroll_to", path, line }` to all WebSocket clients, triggering the viewer's existing scroll handler
- **Optimistic resolve** — existing `handleResolve` in `app.js` marks the comment resolved in local state

The one gap closed: add `POST /resolve` to persist the resolved flag to `session.json`, replacing the current "optimistic only / no server endpoint" TODO in `handleResolve`.

---

## Components

### `CommentCard.js`

New prop: `onAction(commentId, action: "fix" | "reject")`

Add two buttons to the footer, shown only when `comment.source === "claude-code"` and `!comment.resolved`:

- **Fix It** — accent color (indigo), calls `onAction(comment.id, "fix")`
- **Reject** — muted style, calls `onAction(comment.id, "reject")`

Existing "Reply" and "Resolve" buttons remain unchanged.

### `CommentThread.js`, `FileSection.js`, `FileList.js`

Pass `onAction` through the prop chain — same pattern as existing `onReply` / `onResolve`.

### `app.js` — `handleAction(commentId, action)`

1. POST `/reply` with `{ comment_id: commentId, body: action === "fix" ? "Fix It" : "Rejected" }`
2. POST `/resolve` with `{ comment_id: commentId }` (persists to session.json)
3. Compute next unresolved comment:
   - Sort comments by diff file order (using the `diff` array as the canonical file sequence), then by line number within each file
   - Find the comment matching `commentId`, take the next unresolved entry in sorted order
   - No-op if no next unresolved comment exists (all done)
4. POST `/_ws_broadcast` with `{ type: "scroll_to", path: next.path, line: next.line }`

### `server.ts` — `POST /resolve`

Reads `session.json`, finds the comment by id across all reviews, sets `resolved: true`, writes back, broadcasts `session_update` via WebSocket.

Returns 200 on success, 404 if comment not found.

---

## Data Flow

```
User clicks "Fix It"
  → CommentCard.onAction("fix")
  → App.handleAction(commentId, "fix")
      → POST /reply  { body: "Fix It" }         → replies.json updated
      → POST /resolve { comment_id }             → session.json updated, ws broadcast session_update
      → compute next unresolved comment
      → POST /_ws_broadcast { scroll_to, ... }  → viewer scrolls to next comment
      → optimistic resolve in local state        → comment fades/moves to resolved section
  → Monitor (watching replies.json) fires        → Claude wakes up, reads annotation + "Fix It" reply, starts fixing
```

---

## Error Handling

- If `/reply` or `/resolve` fails, log to console; do not scroll (avoids advancing past a comment that wasn't recorded)
- If no next unresolved comment exists, skip the `/_ws_broadcast` call silently
- Buttons show a brief disabled state while the requests are in-flight

---

## Testing

- Unit: no new pure functions; existing `server.ts` test patterns cover `POST /resolve`
- E2E: add a test to `e2e/review-flow.spec.ts`:
  - Inject two annotations, click "Fix It" on the first, assert it resolves and viewer scrolls to the second
  - Click "Reject" on the second, assert it resolves and no further scroll (none remaining)
- "Fix It" / "Reject" buttons must not appear on `source: "user"` comments or already-resolved comments
