import { html } from "https://esm.sh/htm/preact"
import { useState, useCallback, useRef, useEffect } from "https://esm.sh/preact/hooks"
import { ReplyInput } from "./ReplyInput.js"
import { marked } from "https://esm.sh/marked@13"
import DOMPurify from "https://esm.sh/dompurify@3"

// GitHub-flavored markdown, XSS-safe via DOMPurify
marked.setOptions({ gfm: true, breaks: true })

export function MarkdownBody({ text, style = {} }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) {
      const raw = marked.parse(text || "")
      ref.current.innerHTML = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
    }
  }, [text])
  return html`<div ref=${ref} class="md-body" style=${style} />`
}

// Shared button styles — keeps all card buttons consistent
const BTN_BASE = {
  padding: "4px 10px",
  fontSize: "12px",
  fontWeight: "500",
  lineHeight: "1.4",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  border: "1px solid var(--color-border-default)",
  background: "transparent",
  color: "var(--color-fg-muted)",
  fontFamily: "var(--font-ui)",
  display: "inline-flex",
  alignItems: "center",
  whiteSpace: "nowrap",
}
const BTN_DEFAULT = { ...BTN_BASE, color: "var(--color-fg-default)" }
const BTN_PRIMARY = {
  ...BTN_BASE,
  background: "var(--color-accent-emphasis)",
  color: "#fff",
  border: "1px solid transparent",
  fontWeight: "600",
}
const BTN_DANGER = {
  ...BTN_BASE,
  color: "var(--color-fg-muted)",
}
const BTN_ICON = {
  padding: "3px 7px",
  fontSize: "12px",
  lineHeight: "1.4",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  border: "1px solid var(--color-border-default)",
  background: "transparent",
  color: "var(--color-fg-default)",
  fontFamily: "var(--font-ui)",
  display: "inline-flex",
  alignItems: "center",
}

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

export function Avatar({ label }) {
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

function SourceLabel({ source, author }) {
  // Imported GitHub comments carry the real commenter's login — show it instead
  // of the generic "You", which only applies to comments you write locally.
  const labels = {
    "claude-code": "Claude Code",
    "user": "You",
  }
  const text = author ? `@${author}` : (labels[source] || source || "Unknown")
  return html`
    <span style=${{
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--color-fg-default)",
    }}>${text}</span>
  `
}

/**
 * CommentCard — individual comment card.
 *
 * Props:
 *   comment     — ReviewComment
 *   onReply     — (commentId) => void
 *   onResolve   — (commentId) => void
 *   onAction    — (commentId, action: "fix" | "reject") => void
 *   getNavInfo  — (commentId) => { index, total, prevId, nextId, severity } | null
 *   onNavigate  — (commentId) => void
 *   onEdit      — (commentId, newBody) => void
 */
export function CommentCard({ comment, onReply, onResolve, onAction, getNavInfo, onNavigate, onEdit }) {
  const [showReply, setShowReply] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState("")

  const handleEditStart = useCallback(() => {
    setEditBody(comment.body)
    setEditing(true)
  }, [comment.body])

  const handleEditSave = useCallback(async () => {
    const trimmed = editBody.trim()
    if (!trimmed) return
    onEdit?.(comment.id, trimmed)
    setEditing(false)
  }, [editBody, comment.id, onEdit])

  const handleEditCancel = useCallback(() => {
    setEditing(false)
  }, [])

  const navInfo = !comment.resolved ? getNavInfo?.(comment.id) : null
  const navColor = navInfo ? (SEVERITY_COLORS[navInfo.severity] || "var(--color-fg-muted)") : null

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
        <${Avatar} label=${comment.author || comment.source} />
        <div style=${{ display: "flex", alignItems: "center", gap: "6px", flex: 1, flexWrap: "wrap" }}>
          <${SourceLabel} source=${comment.source} author=${comment.author} />
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

      <!-- Body (or inline editor) -->
      ${editing ? html`
        <div style=${{ padding: "10px 12px" }}>
          <textarea
            value=${editBody}
            onInput=${(e) => setEditBody(e.target.value)}
            onKeyDown=${(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleEditSave() }
              if (e.key === "Escape") handleEditCancel()
            }}
            autoFocus
            style=${{
              width: "100%",
              minHeight: "80px",
              padding: "8px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-accent-emphasis)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-code-size)",
              color: "var(--color-fg-default)",
              resize: "vertical",
              outline: "none",
              lineHeight: "1.5",
              boxSizing: "border-box",
            }}
          />
          <div style=${{ display: "flex", gap: "6px", marginTop: "6px", justifyContent: "flex-end" }}>
            <span style=${{ fontSize: "11px", color: "var(--color-fg-subtle)", alignSelf: "center", marginRight: "auto" }}>⌘↵ save · Esc cancel</span>
            <button onClick=${handleEditCancel} style=${BTN_BASE}>Cancel</button>
            <button onClick=${handleEditSave} style=${BTN_PRIMARY}>Save</button>
          </div>
        </div>
      ` : html`
        <${MarkdownBody}
          text=${comment.body}
          style=${{
            padding: "12px",
            fontSize: "var(--font-code-size)",
            lineHeight: "1.6",
            color: "var(--color-fg-default)",
          }}
        />
      `}

      <!-- Replies -->
      ${comment.replies && comment.replies.length > 0 && html`
        <div style=${{
          borderTop: "1px solid var(--color-border-muted)",
          padding: "0 12px",
        }}>
          ${comment.replies.map((reply, i) => reply.source === "claude-code"
            ? html`
              <!-- Claude reply — mini annotation card with Fix It -->
              <div key=${reply.id || i} style=${{
                margin: "8px 0",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                borderBottom: i < comment.replies.length - 1 ? undefined : "none",
              }}>
                <div style=${{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 10px",
                  background: "var(--color-canvas-subtle)",
                  borderBottom: "1px solid var(--color-border-muted)",
                }}>
                  <${Avatar} label="claude-code" />
                  <div style=${{ display: "flex", alignItems: "center", gap: "6px", flex: 1, flexWrap: "wrap" }}>
                    <${SourceLabel} source="claude-code" />
                    ${reply.severity && html`<${SeverityBadge} severity=${reply.severity} />`}
                  </div>
                  ${reply.created_at && html`
                    <span style=${{ fontSize: "12px", color: "var(--color-fg-subtle)", whiteSpace: "nowrap" }}>
                      ${new Date(reply.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  `}
                </div>
                <${MarkdownBody}
                  text=${reply.body}
                  style=${{
                    padding: "10px 12px",
                    fontSize: "var(--font-code-size)",
                    lineHeight: "1.6",
                    color: "var(--color-fg-default)",
                  }}
                />
                ${!comment.resolved && html`
                  <div style=${{
                    display: "flex",
                    gap: "8px",
                    padding: "5px 10px",
                    borderTop: "1px solid var(--color-border-muted)",
                    background: "var(--color-canvas-subtle)",
                  }}>
                    <button
                      onClick=${() => onAction?.(comment.id, "fix")}
                      style=${BTN_PRIMARY}
                    >Fix It</button>
                    <button
                      onClick=${() => onAction?.(comment.id, "reject")}
                      style=${BTN_DANGER}
                    >Reject</button>
                  </div>
                `}
              </div>
            `
            : html`
              <!-- User reply — simple bubble -->
              <div key=${reply.id || i} style=${{
                padding: "8px 0",
                borderBottom: i < comment.replies.length - 1 ? "1px solid var(--color-border-muted)" : "none",
              }}>
                <div style=${{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <${Avatar} label=${reply.author || reply.source || "user"} />
                  <div style=${{ flex: 1 }}>
                    <div style=${{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
                      <${SourceLabel} source=${reply.source || "user"} author=${reply.author} />
                      ${reply.created_at && html`
                        <span style=${{
                          fontSize: "12px",
                          color: "var(--color-fg-subtle)",
                        }}>${new Date(reply.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      `}
                    </div>
                    <${MarkdownBody}
                      text=${reply.body}
                      style=${{
                        fontSize: "var(--font-code-size)",
                        lineHeight: "1.5",
                        color: "var(--color-fg-default)",
                      }}
                    />
                  </div>
                </div>
              </div>
            `
          )}
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
          <button onClick=${handleReply} style=${BTN_DEFAULT}>Reply</button>
          <button onClick=${handleEditStart} title="Edit comment" style=${BTN_BASE}>Edit</button>
          <button onClick=${handleResolve} style=${BTN_BASE}>Resolve</button>

          <!-- Severity-ordered prev/next navigation -->
          ${navInfo && html`
            <div style=${{ display: "flex", alignItems: "center", gap: "2px", marginLeft: "auto" }}>
              <button
                onClick=${() => navInfo.prevId && onNavigate?.(navInfo.prevId)}
                disabled=${!navInfo.prevId}
                title="Previous comment"
                style=${BTN_ICON}
              >↑</button>
              <span style=${{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 7px",
                border: "1px solid var(--color-border-muted)",
                borderRadius: "var(--radius-sm)",
                fontSize: "11px",
                color: "var(--color-fg-muted)",
                userSelect: "none",
                lineHeight: "1.4",
              }}>
                <span style=${{ width: "6px", height: "6px", borderRadius: "50%", background: navColor, flexShrink: 0 }} />
                ${navInfo.index + 1}/${navInfo.total}
              </span>
              <button
                onClick=${() => navInfo.nextId && onNavigate?.(navInfo.nextId)}
                disabled=${!navInfo.nextId}
                title="Next comment"
                style=${BTN_ICON}
              >↓</button>
            </div>
          `}

          ${comment.source === "claude-code" && html`
            <button onClick=${() => onAction?.(comment.id, "fix")} style=${BTN_PRIMARY}>Fix It</button>
            <button onClick=${() => onAction?.(comment.id, "reject")} style=${BTN_DANGER}>Reject</button>
          `}
        </div>
      `}
    </div>
  `
}
