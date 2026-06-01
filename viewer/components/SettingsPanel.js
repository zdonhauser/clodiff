import { html } from "https://esm.sh/htm/preact"
import { useState, useEffect, useRef } from "https://esm.sh/preact/hooks"

const TEXT_SIZES = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
]

/**
 * SettingsPanel — gear button + popover at the bottom of the sidebar.
 *
 * Props:
 *   allFilesMode      — boolean
 *   onAllFilesChange  — (v: boolean) => void
 *   textSize          — "sm" | "md" | "lg"
 *   onTextSizeChange  — (s: string) => void
 */
export function SettingsPanel({ allFilesMode, onAllFilesChange, textSize, onTextSizeChange, wrap, onWrapChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    // Use setTimeout so the click that opened the panel doesn't immediately close it
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const t = setTimeout(() => document.addEventListener("click", handler), 0)
    return () => { clearTimeout(t); document.removeEventListener("click", handler) }
  }, [open])

  const row = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
  }

  const label = {
    fontSize: "12px",
    color: "var(--color-fg-default)",
    userSelect: "none",
  }

  const muted = {
    fontSize: "11px",
    color: "var(--color-fg-muted)",
    marginTop: "1px",
  }

  return html`
    <div ref=${ref} style=${{ position: "relative" }}>
      ${open && html`
        <div style=${{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "0",
          width: "220px",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.2)",
          padding: "12px 14px 8px",
          zIndex: 200,
        }}>
          <div style=${{ fontSize: "11px", fontWeight: "600", color: "var(--color-fg-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
            Settings
          </div>

          <!-- All files -->
          <label style=${{ ...row, cursor: "pointer", gap: "8px" }}>
            <div>
              <div style=${label}>All files</div>
              <div style=${muted}>Show entire repo in sidebar</div>
            </div>
            <input
              type="checkbox"
              checked=${allFilesMode}
              onChange=${(e) => onAllFilesChange?.(e.target.checked)}
              style=${{ cursor: "pointer", flexShrink: 0, accentColor: "var(--color-accent-emphasis)" }}
            />
          </label>

          <!-- Wrap long lines -->
          <label style=${{ ...row, cursor: "pointer", gap: "8px" }}>
            <div>
              <div style=${label}>Wrap long lines</div>
              <div style=${muted}>Wrap instead of scrolling horizontally</div>
            </div>
            <input
              type="checkbox"
              checked=${wrap}
              onChange=${(e) => onWrapChange?.(e.target.checked)}
              style=${{ cursor: "pointer", flexShrink: 0, accentColor: "var(--color-accent-emphasis)" }}
            />
          </label>

          <div style=${{ borderTop: "1px solid var(--color-border-muted)", margin: "4px 0" }} />

          <!-- Text size -->
          <div style=${{ ...row, flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
            <div style=${label}>Text size</div>
            <div style=${{ display: "flex", gap: "4px", width: "100%" }}>
              ${TEXT_SIZES.map(({ id, label: lbl }) => html`
                <button
                  key=${id}
                  onClick=${() => onTextSizeChange?.(id)}
                  style=${{
                    flex: 1,
                    padding: "3px 0",
                    fontSize: "11px",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    background: textSize === id ? "var(--color-accent-emphasis)" : "var(--color-canvas-subtle)",
                    color: textSize === id ? "#fff" : "var(--color-fg-default)",
                    fontWeight: textSize === id ? "600" : "400",
                  }}
                >${lbl}</button>
              `)}
            </div>
          </div>
        </div>
      `}

      <!-- Gear button -->
      <button
        onClick=${() => setOpen((v) => !v)}
        title="Settings"
        style=${{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px 10px",
          width: "100%",
          color: open ? "var(--color-fg-default)" : "var(--color-fg-muted)",
          fontSize: "11px",
          borderTop: "1px solid var(--color-border-muted)",
        }}
        onMouseEnter=${(e) => { e.currentTarget.style.color = "var(--color-fg-default)" }}
        onMouseLeave=${(e) => { if (!open) e.currentTarget.style.color = "var(--color-fg-muted)" }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>
          <path d="M8 5a3 3 0 1 1 0 6A3 3 0 0 1 8 5Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>
        </svg>
        Settings
      </button>
    </div>
  `
}
