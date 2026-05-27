import { html } from "https://esm.sh/htm/preact"
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact/hooks"

/**
 * RefPicker — searchable branch/ref dropdown.
 *
 * Props:
 *   value      — current ref string (shown as trigger label)
 *   label      — "base" | "compare"
 *   onSelect   — (ref: string) => void
 */
export function RefPicker({ value, label, onSelect }) {
  const [open, setOpen] = useState(false)
  const [refs, setRefs] = useState([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const fetchRefs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/refs")
      if (res.ok) setRefs(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  const handleOpen = useCallback(() => {
    setOpen(true)
    setQuery("")
    fetchRefs()
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [fetchRefs])

  const handleSelect = useCallback((ref) => {
    setOpen(false)
    onSelect?.(ref)
  }, [onSelect])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const t = setTimeout(() => document.addEventListener("click", handler), 0)
    return () => { clearTimeout(t); document.removeEventListener("click", handler) }
  }, [open])

  const filtered = query.trim()
    ? refs.filter((r) =>
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        r.subject?.toLowerCase().includes(query.toLowerCase())
      )
    : refs

  // Add HEAD as first option for "compare" pickers
  const allOptions = label === "compare"
    ? [{ name: "HEAD", sha: "", subject: "Current working tree", date: "" }, ...filtered]
    : filtered

  const isBase = label === "base"

  return html`
    <div ref=${containerRef} style=${{ position: "relative", display: "inline-block" }}>
      <button
        onClick=${open ? () => setOpen(false) : handleOpen}
        title=${"Change " + label + " ref"}
        style=${{
          padding: "1px 8px",
          background: isBase ? "var(--color-canvas-subtle)" : "#ddf4ff",
          border: isBase ? "1px solid var(--color-border-default)" : "1px solid #b6e3ff",
          borderRadius: "var(--radius-sm)",
          color: isBase ? "var(--color-fg-muted)" : "#0969da",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        ${value}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style=${{ opacity: 0.6 }}>
          <path d="M0 2l4 4 4-4H0z"/>
        </svg>
      </button>

      ${open && html`
        <div style=${{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: isBase ? "0" : "auto",
          right: isBase ? "auto" : "0",
          zIndex: 200,
          background: "var(--color-bg)",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          width: "320px",
          overflow: "hidden",
        }}>
          <!-- Search -->
          <div style=${{ padding: "8px", borderBottom: "1px solid var(--color-border-muted)" }}>
            <input
              ref=${inputRef}
              type="text"
              placeholder="Search branches…"
              value=${query}
              onInput=${(e) => setQuery(e.target.value)}
              style=${{
                width: "100%",
                padding: "5px 8px",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-fg-default)",
                fontSize: "12px",
                fontFamily: "var(--font-ui)",
                outline: "none",
              }}
            />
          </div>

          <!-- Branch list -->
          <div style=${{ maxHeight: "280px", overflowY: "auto" }}>
            ${loading && html`
              <div style=${{ padding: "12px", color: "var(--color-fg-muted)", fontSize: "12px", textAlign: "center" }}>
                Loading…
              </div>
            `}
            ${!loading && allOptions.length === 0 && html`
              <div style=${{ padding: "12px", color: "var(--color-fg-muted)", fontSize: "12px", textAlign: "center" }}>
                No branches found
              </div>
            `}
            ${!loading && allOptions.map((ref) => html`
              <button
                key=${ref.name}
                onClick=${() => handleSelect(ref.name)}
                style=${{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  width: "100%",
                  background: ref.name === value ? "var(--color-canvas-subtle)" : "none",
                  border: "none",
                  borderBottom: "1px solid var(--color-border-muted)",
                  cursor: "pointer",
                  padding: "8px 12px",
                  textAlign: "left",
                }}
                onMouseEnter=${(e) => { if (ref.name !== value) e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
                onMouseLeave=${(e) => { if (ref.name !== value) e.currentTarget.style.background = "none" }}
              >
                <div style=${{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-fg-muted)" style=${{ flexShrink: 0 }}>
                    <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
                  </svg>
                  <span style=${{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    fontWeight: ref.name === value ? "600" : "400",
                    color: "var(--color-fg-default)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>${ref.name}</span>
                  ${ref.sha && html`
                    <span style=${{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      color: "var(--color-fg-muted)",
                      flexShrink: 0,
                    }}>${ref.sha}</span>
                  `}
                  ${ref.name === value && html`
                    <span style=${{ marginLeft: "auto", color: "var(--color-accent-fg)", fontSize: "12px", flexShrink: 0 }}>✓</span>
                  `}
                </div>
                ${ref.subject && html`
                  <div style=${{
                    fontSize: "11px",
                    color: "var(--color-fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    paddingLeft: "18px",
                  }}>${ref.subject}${ref.date ? html` · <span style=${{ color: "var(--color-fg-subtle)" }}>${ref.date}</span>` : ""}</div>
                `}
              </button>
            `)}
          </div>
        </div>
      `}
    </div>
  `
}
