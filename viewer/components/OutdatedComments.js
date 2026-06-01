import { html } from "https://esm.sh/htm/preact"
import { useState } from "https://esm.sh/preact/hooks"
import { MarkdownBody, Avatar } from "./CommentCard.js"

// Render a unified-diff hunk (GitHub's `diff_hunk`) with +/-/@@ coloring so an
// outdated comment shows the context it was originally made on.
function DiffHunk({ hunk }) {
  const lines = (hunk || "").split("\n")
  return html`
    <pre style=${{
      margin: "0 0 8px", padding: "8px 10px", overflowX: "auto",
      background: "var(--color-canvas-inset)", border: "1px solid var(--color-border-muted)",
      borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)",
      fontSize: "var(--font-code-size)", lineHeight: "1.5",
    }}>${lines.map((ln, i) => {
      const bg = ln.startsWith("+") ? "var(--color-added-bg)"
        : ln.startsWith("-") ? "var(--color-removed-bg)"
        : ln.startsWith("@@") ? "var(--color-hunk-bg)" : "transparent"
      const fg = ln.startsWith("@@") ? "var(--color-hunk-fg)" : "var(--color-fg-default)"
      return html`<div key=${i} style=${{ background: bg, color: fg, whiteSpace: "pre" }}>${ln || " "}</div>`
    })}</pre>
  `
}

/**
 * OutdatedComments — imported review comments whose line no longer maps onto the
 * current diff (GitHub flags them outdated). They can't be pinned to a diff line,
 * so we surface them here with the original diff hunk for context — otherwise
 * they'd render nowhere.
 *
 * Props: comments — flat ReviewComment[] (we filter is_outdated)
 */
export function OutdatedComments({ comments }) {
  const items = (comments || []).filter((c) => c.is_outdated && !c.resolved)
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null

  return html`
    <div style=${{
      margin: "12px 16px 0",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-lg)",
      background: "var(--color-bg)",
      boxShadow: "var(--shadow-sm)",
    }}>
      <button
        onClick=${() => setOpen((o) => !o)}
        style=${{
          width: "100%", display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px", background: "transparent", border: "none",
          cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "13px",
          fontWeight: "600", color: "var(--color-fg-default)",
        }}
      >
        <span style=${{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-fg-muted)" }}>▸</span>
        Outdated comments
        <span style=${{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.4px", color: "#ffffff", background: "var(--color-outdated-bg)", borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>${items.length}</span>
      </button>
      ${open && html`
        <div style=${{ padding: "0 14px 12px" }}>
          ${items.map((c) => html`
            <div key=${c.id} style=${{
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: "8px",
            }}>
              <div style=${{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "var(--color-canvas-subtle)", borderBottom: "1px solid var(--color-border-muted)" }}>
                <${Avatar} label=${c.author || "user"} />
                <span style=${{ fontSize: "13px", fontWeight: "600", color: "var(--color-fg-default)" }}>@${c.author || "user"}</span>
                <span style=${{ fontSize: "12px", color: "var(--color-fg-subtle)", fontFamily: "var(--font-mono)" }}>${c.path}${c.original_line ? `:${c.original_line}` : ""}</span>
              </div>
              <div style=${{ padding: "10px 12px" }}>
                ${c.diff_hunk && html`<${DiffHunk} hunk=${c.diff_hunk} />`}
                <${MarkdownBody} text=${c.body} style=${{ fontSize: "var(--font-code-size)", lineHeight: "1.6", color: "var(--color-fg-default)" }} />
                ${(c.replies || []).map((r) => html`
                  <div key=${r.id} style=${{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--color-border-muted)" }}>
                    <div style=${{ fontSize: "12px", fontWeight: "600", color: "var(--color-fg-default)", marginBottom: "2px" }}>@${r.author || "user"}</div>
                    <${MarkdownBody} text=${r.body} style=${{ fontSize: "var(--font-code-size)", lineHeight: "1.6", color: "var(--color-fg-default)" }} />
                  </div>
                `)}
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `
}
