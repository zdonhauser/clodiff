import { html } from "https://esm.sh/htm/preact"
import { useState } from "https://esm.sh/preact/hooks"
import { ReplyInput } from "./ReplyInput.js"

const SEVERITY_COLORS = {
  error: "var(--color-severity-error)",
  warning: "var(--color-severity-warning)",
  suggestion: "var(--color-severity-suggestion)",
  note: "var(--color-severity-note)",
}

const SEVERITY_BG = {
  error: "#cf222e1a",
  warning: "#9a67001a",
  suggestion: "#0969da1a",
  note: "#6e77811a",
}

function Avatar({ label }) {
  const initial = label ? label[0].toUpperCase() : "?"
  return html`
    <div style=${{
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      background: "var(--color-canvas-subtle)",
      border: "1px solid var(--color-border-default)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "12px",
      fontWeight: "600",
      color: "var(--color-fg-muted)",
      flexShrink: 0,
    }}>${initial}</div>
  `
}

function SeverityBadge({ severity }) {
  if (!severity) return null
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.note
  const bg = SEVERITY_BG[severity] || SEVERITY_BG.note

  return html`
    <span style=${{
      display: "inline-flex",
      alignItems: "center",
      padding: "1px 6px",
      borderRadius: "var(--radius-sm)",
      fontSize: "11px",
      fontWeight: "600",
      color,
      background: bg,
      border: `1px solid ${color}33`,
      textTransform: "uppercase",
      letterSpacing: "0.4px",
    }}>${severity}</span>
  `
}

function OutdatedBadge() {
  return html`
    <span style=${{
      display: "inline-flex",
      alignItems: "center",
      padding: "1px 6px",
      borderRadius: "var(--radius-sm)",
      fontSize: "11px",
      fontWeight: "600",
      color: "#ffffff",
      background: "var(--color-outdated-bg)",
      letterSpacing: "0.4px",
    }}>Outdated</span>
  `
}

function SourceLabel({ source }) {
  const labels = {
    "claude-code": "Claude Code",
    "user": "You",
  }
  return html`
    <span style=${{
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--color-fg-default)",
    }}>${labels[source] || source || "Unknown"}</span>
  `
}

/**
 * CommentCard — individual comment card.
 *
 * Props:
 *   comment  — ReviewComment
 *   onReply  — (commentId) => void
 *   onResolve — (commentId) => void
 */
export function CommentCard({ comment, onReply, onResolve }) {
  const [showReply, setShowReply] = useState(false)

  const handleResolve = async () => {
    onResolve?.(comment.id)
  }

  const handleReply = () => {
    setShowReply(true)
    onReply?.(comment.id)
  }

  const handleReplyClose = () => {
    setShowReply(false)
  }

  const createdAt = comment.created_at
    ? new Date(comment.created_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : ""

  return html`
    <div style=${{
      background: "var(--color-bg)",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      opacity: comment.resolved ? 0.6 : 1,
    }}>
      <!-- Header -->
      <div style=${{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-muted)",
        background: "var(--color-canvas-subtle)",
      }}>
        <${Avatar} label=${comment.source} />
        <div style=${{ display: "flex", alignItems: "center", gap: "6px", flex: 1, flexWrap: "wrap" }}>
          <${SourceLabel} source=${comment.source} />
          ${comment.severity && html`<${SeverityBadge} severity=${comment.severity} />`}
          ${comment.is_outdated && html`<${OutdatedBadge} />`}
          ${comment.resolved && html`
            <span style=${{
              fontSize: "11px",
              color: "var(--color-success-fg)",
              fontWeight: "500",
            }}>✓ Resolved</span>
          `}
        </div>
        ${createdAt && html`
          <span style=${{
            fontSize: "12px",
            color: "var(--color-fg-subtle)",
            whiteSpace: "nowrap",
          }}>${createdAt}</span>
        `}
      </div>

      <!-- Outdated context -->
      ${comment.is_outdated && comment.line_content && html`
        <div style=${{
          padding: "6px 12px",
          background: "var(--color-attention-fg)10",
          borderBottom: "1px solid var(--color-border-muted)",
        }}>
          <span style=${{
            fontSize: "12px",
            color: "var(--color-fg-muted)",
            fontFamily: "var(--font-mono)",
          }}>
            Original context: <code style=${{ background: "var(--color-canvas-subtle)", padding: "1px 4px", borderRadius: "var(--radius-sm)" }}>${comment.line_content}</code>
            ${comment.original_line != null && html` (line ${comment.original_line})`}
          </span>
        </div>
      `}

      <!-- Body -->
      <div style=${{
        padding: "12px",
        fontSize: "var(--font-code-size)",
        lineHeight: "1.6",
        color: "var(--color-fg-default)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>${comment.body}</div>

      <!-- Replies -->
      ${comment.replies && comment.replies.length > 0 && html`
        <div style=${{
          borderTop: "1px solid var(--color-border-muted)",
          padding: "0 12px",
        }}>
          ${comment.replies.map((reply, i) => html`
            <div key=${reply.id || i} style=${{
              padding: "8px 0",
              borderBottom: i < comment.replies.length - 1 ? "1px solid var(--color-border-muted)" : "none",
            }}>
              <div style=${{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <${Avatar} label=${reply.source || "user"} />
                <div style=${{ flex: 1 }}>
                  <div style=${{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
                    <${SourceLabel} source=${reply.source || "user"} />
                    ${reply.created_at && html`
                      <span style=${{
                        fontSize: "12px",
                        color: "var(--color-fg-subtle)",
                      }}>${new Date(reply.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    `}
                  </div>
                  <div style=${{
                    fontSize: "var(--font-code-size)",
                    lineHeight: "1.5",
                    color: "var(--color-fg-default)",
                    whiteSpace: "pre-wrap",
                  }}>${reply.body}</div>
                </div>
              </div>
            </div>
          `)}
        </div>
      `}

      <!-- Reply input -->
      ${showReply && html`
        <div style=${{ padding: "0 12px 12px" }}>
          <${ReplyInput}
            commentId=${comment.id}
            onClose=${handleReplyClose}
          />
        </div>
      `}

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
        </div>
      `}
    </div>
  `
}
