import { html } from "https://esm.sh/htm/preact"

const SEVERITY_COLORS = {
  error: "var(--color-severity-error)",
  warning: "var(--color-severity-warning)",
  suggestion: "var(--color-severity-suggestion)",
  note: "var(--color-severity-note)",
}

/**
 * CommentNavigator — fixed floating pill to jump through severity-sorted comments.
 *
 * Props:
 *   sortedUnresolved — ReviewComment[] sorted by severity then file/line
 *   navIdx           — current index (-1 = not yet started)
 *   onNavigate       — (commentId) => void
 */
export function CommentNavigator({ sortedUnresolved, navIdx, onNavigate }) {
  if (!sortedUnresolved || sortedUnresolved.length === 0) return null

  const current = navIdx >= 0 && navIdx < sortedUnresolved.length
    ? sortedUnresolved[navIdx]
    : null

  const canPrev = navIdx > 0
  const canNext = navIdx < sortedUnresolved.length - 1  // also true when navIdx === -1

  const handlePrev = () => {
    if (!canPrev) return
    onNavigate?.(sortedUnresolved[navIdx - 1].id)
  }

  const handleNext = () => {
    if (!canNext) return
    const nextIdx = navIdx < 0 ? 0 : navIdx + 1
    onNavigate?.(sortedUnresolved[nextIdx].id)
  }

  const severityColor = current
    ? (SEVERITY_COLORS[current.severity] || "var(--color-fg-muted)")
    : "var(--color-fg-muted)"

  const btnStyle = (enabled) => ({
    background: "none",
    border: "none",
    cursor: enabled ? "pointer" : "default",
    color: enabled ? "var(--color-fg-default)" : "var(--color-fg-subtle)",
    padding: "4px 6px",
    fontSize: "13px",
    lineHeight: 1,
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
  })

  return html`
    <div style=${{
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: 200,
      display: "flex",
      alignItems: "center",
      gap: "2px",
      background: "var(--color-canvas-subtle)",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-full)",
      boxShadow: "var(--shadow-md)",
      padding: "3px 6px",
      fontSize: "12px",
      fontFamily: "var(--font-ui)",
      userSelect: "none",
    }}>

      <!-- Prev arrow -->
      <button
        onClick=${handlePrev}
        disabled=${!canPrev}
        title="Previous comment"
        style=${btnStyle(canPrev)}
      >↑</button>

      <!-- Severity dot + label + position -->
      <div style=${{ display: "flex", alignItems: "center", gap: "5px", padding: "0 4px" }}>
        <span style=${{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: severityColor,
          flexShrink: 0,
        }} />

        ${current ? html`
          <span style=${{
            color: severityColor,
            fontWeight: "600",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>${current.severity}</span>
        ` : html`
          <span style=${{ color: "var(--color-fg-muted)", fontSize: "11px" }}>comments</span>
        `}

        <span style=${{
          color: "var(--color-fg-muted)",
          fontSize: "11px",
          minWidth: "32px",
          textAlign: "center",
        }}>
          ${navIdx >= 0
            ? `${navIdx + 1} / ${sortedUnresolved.length}`
            : sortedUnresolved.length
          }
        </span>
      </div>

      <!-- Next arrow -->
      <button
        onClick=${handleNext}
        disabled=${!canNext}
        title="Next comment"
        style=${btnStyle(canNext)}
      >↓</button>
    </div>
  `
}
