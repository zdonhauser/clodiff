import { html } from "https://esm.sh/htm/preact"
import { useState, useCallback, useEffect } from "https://esm.sh/preact/hooks"

const EVENTS = [
  { value: "COMMENT", label: "Comment", description: "Submit general feedback without approving or requesting changes" },
  { value: "APPROVE", label: "Approve", description: "Approve these changes" },
  { value: "REQUEST_CHANGES", label: "Request Changes", description: "Request changes before this can be merged" },
]

const EVENT_COLORS = {
  COMMENT: "var(--color-fg-muted)",
  APPROVE: "var(--color-success-fg)",
  REQUEST_CHANGES: "var(--color-danger-fg)",
}

const SEVERITY_LABELS = { error: "error", warning: "warning", suggestion: "suggestion", note: "note" }
const SEVERITY_COLORS = {
  error: "var(--color-severity-error, #cf222e)",
  warning: "var(--color-severity-warning, #9a6700)",
  suggestion: "var(--color-severity-suggestion, #0969da)",
  note: "var(--color-severity-note, #57606a)",
}

/**
 * SubmitReviewModal — modal for staging and submitting a GitHub PR review.
 *
 * Props:
 *   comments     — ReviewComment[] (all comments, will filter unresolved)
 *   session      — SessionFile | null
 *   onClose      — () => void
 *   onSubmit     — (event, body) => Promise<void>
 */
export function SubmitReviewModal({ comments = [], session, onClose, onSubmit }) {
  const existing = session?.reviews?.[session.reviews.length - 1]
  // Can't APPROVE your own PR — GitHub returns 422
  const isOwnPR = session?.pr_meta?.author === session?.pr_meta?._currentUser
  const [event, setEvent] = useState(existing?.event === "APPROVE" && isOwnPR ? "COMMENT" : existing?.event || "COMMENT")
  const [body, setBody] = useState(existing?.body || "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const unresolved = comments.filter((c) => !c.resolved && !c.is_outdated)
  const counts = unresolved.reduce((acc, c) => {
    const sev = c.severity || "note"
    acc[sev] = (acc[sev] || 0) + 1
    return acc
  }, {})

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose?.() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit?.(event, body)
    } catch (err) {
      // Surface GitHub's error messages clearly (e.g. "can't approve own PR")
      const msg = err.message || "Submit failed"
      const friendlyMsg = msg.includes("approve your own") || msg.includes("Can not approve")
        ? "GitHub doesn't allow approving your own PR. Switch to Comment or Request Changes."
        : msg.includes("Unprocessable")
        ? "GitHub rejected the review — check that the commit SHA is current and comments reference valid diff lines."
        : msg
      setError(friendlyMsg)
      setSubmitting(false)
    }
  }, [event, body, submitting, onSubmit])

  return html`
    <!-- Backdrop -->
    <div
      onClick=${onClose}
      style=${{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 500,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      <!-- Modal panel — stop propagation so clicks inside don't close -->
      <div
        onClick=${(e) => e.stopPropagation()}
        style=${{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-lg, 8px)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <!-- Header -->
        <div style=${{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-border-default)",
          flexShrink: 0,
        }}>
          <h2 style=${{ margin: 0, fontSize: "16px", fontWeight: "600", color: "var(--color-fg-default)" }}>
            Submit Review
          </h2>
          <button
            onClick=${onClose}
            style=${{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--color-fg-muted)", fontSize: "18px", lineHeight: 1,
              padding: "2px 4px",
            }}
          >✕</button>
        </div>

        <!-- Body -->
        <div style=${{ padding: "20px", flex: 1, overflow: "auto" }}>

          <!-- Staged comments summary -->
          ${unresolved.length > 0 ? html`
            <div style=${{
              padding: "10px 14px",
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-md)",
              marginBottom: "20px",
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
              alignItems: "center",
            }}>
              <span style=${{ fontSize: "13px", color: "var(--color-fg-muted)", fontWeight: "500" }}>
                ${unresolved.length} staged comment${unresolved.length !== 1 ? "s" : ""}
              </span>
              ${Object.entries(counts).map(([sev, count]) => html`
                <span key=${sev} style=${{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  fontSize: "12px", color: SEVERITY_COLORS[sev],
                  fontWeight: "500",
                }}>
                  <span style=${{ width: "6px", height: "6px", borderRadius: "50%", background: SEVERITY_COLORS[sev], flexShrink: 0 }} />
                  ${count} ${SEVERITY_LABELS[sev]}
                </span>
              `)}
            </div>
          ` : html`
            <div style=${{
              padding: "10px 14px",
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border-muted)",
              borderRadius: "var(--radius-md)",
              marginBottom: "20px",
              fontSize: "13px",
              color: "var(--color-fg-muted)",
            }}>
              No staged comments — submitting a review-level comment only.
            </div>
          `}

          <!-- Review body -->
          <div style=${{ marginBottom: "20px" }}>
            <label style=${{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--color-fg-default)", marginBottom: "6px" }}>
              Review summary <span style=${{ fontWeight: "400", color: "var(--color-fg-muted)" }}>(optional)</span>
            </label>
            <textarea
              value=${body}
              onInput=${(e) => setBody(e.target.value)}
              placeholder="Leave an overall review comment…"
              rows="4"
              style=${{
                width: "100%",
                padding: "8px 10px",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-ui)",
                fontSize: "13px",
                color: "var(--color-fg-default)",
                resize: "vertical",
                outline: "none",
                lineHeight: "1.5",
                boxSizing: "border-box",
              }}
            />
          </div>

          <!-- Review event -->
          <div>
            <label style=${{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--color-fg-default)", marginBottom: "10px" }}>
              Review decision
            </label>
            <div style=${{ display: "flex", flexDirection: "column", gap: "8px" }}>
              ${EVENTS.map(({ value, label, description }) => {
                const disabled = value === "APPROVE" && isOwnPR
                const disabledNote = disabled ? " — can't approve your own PR" : ""
                return html`
                  <label
                    key=${value}
                    style=${{
                      display: "flex", alignItems: "flex-start", gap: "10px",
                      padding: "10px 12px",
                      border: `1px solid ${event === value ? EVENT_COLORS[value] : "var(--color-border-default)"}`,
                      borderRadius: "var(--radius-sm)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                      background: event === value ? `${EVENT_COLORS[value]}10` : "var(--color-bg)",
                      transition: "border-color 0.1s, background 0.1s",
                    }}
                  >
                    <input
                      type="radio"
                      name="review-event"
                      value=${value}
                      checked=${event === value}
                      disabled=${disabled}
                      onChange=${() => !disabled && setEvent(value)}
                      style=${{ marginTop: "2px", flexShrink: 0, accentColor: EVENT_COLORS[value] }}
                    />
                    <div>
                      <div style=${{ fontSize: "13px", fontWeight: "600", color: EVENT_COLORS[value] }}>${label}</div>
                      <div style=${{ fontSize: "12px", color: "var(--color-fg-muted)", marginTop: "2px" }}>${description}${disabledNote}</div>
                    </div>
                  </label>
                `
              })}
            </div>
          </div>

          ${error && html`
            <div style=${{
              marginTop: "12px", padding: "8px 12px",
              background: "#cf222e1a", border: "1px solid var(--color-danger-fg)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px", color: "var(--color-danger-fg)",
            }}>${error}</div>
          `}
        </div>

        <!-- Footer -->
        <div style=${{
          display: "flex", gap: "8px", justifyContent: "flex-end",
          padding: "12px 20px",
          borderTop: "1px solid var(--color-border-default)",
          flexShrink: 0,
        }}>
          <button
            onClick=${onClose}
            disabled=${submitting}
            style=${{
              padding: "6px 16px", background: "var(--color-bg)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-fg-default)", fontSize: "13px",
              cursor: "pointer", fontWeight: "500",
            }}
          >Cancel</button>
          <button
            onClick=${handleSubmit}
            disabled=${submitting}
            style=${{
              padding: "6px 16px",
              background: submitting ? "var(--color-canvas-subtle)" : EVENT_COLORS[event] || "var(--color-accent-emphasis)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: submitting ? "var(--color-fg-muted)" : "#ffffff",
              fontSize: "13px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: "600",
            }}
          >${submitting ? "Submitting…" : "Submit Review"}</button>
        </div>
      </div>
    </div>
  `
}
