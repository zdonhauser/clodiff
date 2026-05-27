import { html } from "https://esm.sh/htm/preact"
import { useState, useEffect } from "https://esm.sh/preact/hooks"

/**
 * FileViewer — read-only view of a non-diff file.
 *
 * Props:
 *   path    — file path relative to repo root
 *   onClose — () => void
 */
export function FileViewer({ path, onClose }) {
  const [content, setContent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setContent(null)
    setError(null)
    fetch(`/file?path=${encodeURIComponent(path)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText)
        return r.text()
      })
      .then(setContent)
      .catch((e) => setError(e.message))
  }, [path])

  const lines = content != null ? content.split("\n") : []

  return html`
    <div style=${{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--font-code-size)",
    }}>
      <!-- File header -->
      <div style=${{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 16px",
        background: "var(--color-canvas-subtle)",
        borderBottom: "1px solid var(--color-border-default)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <span style=${{
          flex: 1,
          color: "var(--color-fg-default)",
          fontWeight: "500",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>${path}</span>
        <span style=${{
          fontSize: "11px",
          color: "var(--color-fg-muted)",
          padding: "1px 6px",
          background: "var(--color-canvas-subtle)",
          border: "1px solid var(--color-border-muted)",
          borderRadius: "var(--radius-sm)",
        }}>read-only</span>
        <button
          onClick=${onClose}
          title="Back to diff"
          style=${{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-fg-muted)",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px 4px",
            borderRadius: "var(--radius-sm)",
          }}
          onMouseEnter=${(e) => { e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
          onMouseLeave=${(e) => { e.currentTarget.style.background = "none" }}
        >×</button>
      </div>

      <!-- Content -->
      ${error && html`
        <div style=${{ padding: "32px", color: "var(--color-danger-fg)", fontSize: "13px" }}>
          Failed to load: ${error}
        </div>
      `}
      ${content === null && !error && html`
        <div style=${{ padding: "32px", color: "var(--color-fg-muted)", fontSize: "13px" }}>
          Loading…
        </div>
      `}
      ${content !== null && html`
        <div style=${{ overflow: "auto", flex: 1 }}>
          <table style=${{
            borderCollapse: "collapse",
            width: "100%",
            tabSize: 2,
          }}>
            <tbody>
              ${lines.map((line, i) => html`
                <tr key=${i} style=${{ verticalAlign: "top" }}>
                  <td style=${{
                    padding: "0 12px 0 16px",
                    color: "var(--color-fg-muted)",
                    textAlign: "right",
                    userSelect: "none",
                    minWidth: "48px",
                    whiteSpace: "nowrap",
                    fontSize: "11px",
                    opacity: 0.5,
                  }}>${i + 1}</td>
                  <td style=${{
                    padding: "0 16px 0 4px",
                    color: "var(--color-fg-default)",
                    whiteSpace: "pre",
                    lineHeight: "1.7",
                    width: "100%",
                  }}>${line || " "}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `
}
