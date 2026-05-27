import { html } from "https://esm.sh/htm/preact"
import { useState } from "https://esm.sh/preact/hooks"
import { CommentCard } from "./CommentCard.js"

/**
 * CommentThread — all comments anchored to a specific line.
 *
 * Props:
 *   comments  — ReviewComment[]
 *   path      — string
 *   line      — number
 *   onReply   — (commentId) => void
 *   onResolve — (commentId) => void
 */
export function CommentThread({ comments, path, line, onReply, onResolve }) {
  if (!comments || comments.length === 0) return null

  const resolved = comments.filter((c) => c.resolved)
  const unresolved = comments.filter((c) => !c.resolved)

  const [showResolved, setShowResolved] = useState(false)

  return html`
    <div style=${{
      padding: "8px 16px 8px 60px",
      background: "var(--color-canvas-subtle)",
      borderBottom: "1px solid var(--color-border-default)",
    }}>
      <!-- Active (unresolved) comments -->
      ${unresolved.length > 0 && html`
        <div style=${{ display: "flex", flexDirection: "column", gap: "8px" }}>
          ${unresolved.map((comment) => html`
            <${CommentCard}
              key=${comment.id}
              comment=${comment}
              onReply=${onReply}
              onResolve=${onResolve}
            />
          `)}
        </div>
      `}

      <!-- Resolved comments toggle -->
      ${resolved.length > 0 && html`
        <div style=${{ marginTop: unresolved.length > 0 ? "8px" : "0" }}>
          <button
            onClick=${() => setShowResolved((v) => !v)}
            style=${{
              background: "none",
              border: "none",
              color: "var(--color-fg-muted)",
              fontSize: "12px",
              cursor: "pointer",
              padding: "4px 0",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>${showResolved ? "▾" : "▸"}</span>
            <span>${resolved.length} resolved conversation${resolved.length !== 1 ? "s" : ""}</span>
          </button>
          ${showResolved && html`
            <div style=${{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
              ${resolved.map((comment) => html`
                <${CommentCard}
                  key=${comment.id}
                  comment=${comment}
                  onReply=${onReply}
                  onResolve=${onResolve}
                />
              `)}
            </div>
          `}
        </div>
      `}
    </div>
  `
}
