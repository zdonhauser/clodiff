import { html } from "https://esm.sh/htm/preact"
import { useState, useCallback } from "https://esm.sh/preact/hooks"

/**
 * ReplyInput — inline reply text box.
 *
 * Props:
 *   commentId — string
 *   onClose   — () => void
 *   onReply   — (body: string) => void (optional optimistic callback)
 */
export function ReplyInput({ commentId, onClose, onReply }) {
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch("/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: commentId, body: trimmed }),
      })

      if (!res.ok) {
        throw new Error(`Failed to submit reply: ${res.statusText}`)
      }

      onReply?.(trimmed)
      setBody("")
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }, [body, commentId, submitting, onClose, onReply])

  const handleKeyDown = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      submit()
    }
    if (e.key === "Escape") {
      onClose?.()
    }
  }, [submit, onClose])

  return html`
    <div style=${{
      background: "var(--color-canvas-subtle)",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-md)",
      padding: "8px",
      marginTop: "4px",
    }}>
      <textarea
        value=${body}
        onInput=${(e) => setBody(e.target.value)}
        onKeyDown=${handleKeyDown}
        placeholder="Reply..."
        disabled=${submitting}
        style=${{
          width: "100%",
          minHeight: "72px",
          padding: "8px",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-ui)",
          fontSize: "13px",
          color: "var(--color-fg-default)",
          resize: "vertical",
          outline: "none",
          lineHeight: "1.5",
        }}
      />
      ${error && html`
        <div style=${{
          color: "var(--color-danger-fg)",
          fontSize: "12px",
          marginTop: "4px",
        }}>${error}</div>
      `}
      <div style=${{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: "8px",
        gap: "8px",
      }}>
        <span style=${{
          fontSize: "12px",
          color: "var(--color-fg-subtle)",
        }}>⌘↵ to submit · Esc to cancel</span>
        <div style=${{ display: "flex", gap: "8px" }}>
          <button
            onClick=${onClose}
            disabled=${submitting}
            style=${{
              padding: "5px 12px", fontSize: "13px", fontWeight: "500",
              background: "transparent", border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-sm)", color: "var(--color-fg-default)", cursor: "pointer",
              fontFamily: "var(--font-ui)", lineHeight: "1.4",
            }}
          >Cancel</button>
          <button
            onClick=${submit}
            disabled=${submitting || !body.trim()}
            style=${{
              padding: "5px 12px", fontSize: "13px", fontWeight: "600",
              background: "var(--color-accent-emphasis)", border: "1px solid transparent",
              borderRadius: "var(--radius-sm)", color: "#ffffff", cursor: "pointer",
              fontFamily: "var(--font-ui)", lineHeight: "1.4",
            }}
          >${submitting ? "Sending…" : "Reply"}</button>
        </div>
      </div>
    </div>
  `
}
