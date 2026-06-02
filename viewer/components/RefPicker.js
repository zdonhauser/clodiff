import { html } from "https://esm.sh/htm/preact"
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact/hooks"

const prettyName = (n) => (n === "WORKING" ? "working tree" : n)

// Small inline icons per kind.
const ICONS = {
  special: html`<svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-fg-muted)" style=${{ flexShrink: 0 }}><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Zm6.25-2.75a.75.75 0 0 0-1.5 0v3a.75.75 0 0 0 .4.664l2 1a.75.75 0 1 0 .7-1.328L8.75 7.84V5.25Z"/></svg>`,
  commit: html`<svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-fg-muted)" style=${{ flexShrink: 0 }}><path d="M10.5 7.75a2.5 2.5 0 0 1-4.9 0H1.75a.75.75 0 0 1 0-1.5h3.85a2.5 2.5 0 0 1 4.9 0h3.85a.75.75 0 0 1 0 1.5H10.5ZM8 8.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>`,
  local: html`<svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-fg-muted)" style=${{ flexShrink: 0 }}><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/></svg>`,
  remote: html`<svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-accent-fg)" style=${{ flexShrink: 0 }}><path d="M4.5 11a3.5 3.5 0 0 1-.59-6.95 4.5 4.5 0 0 1 8.82.95H13a2.5 2.5 0 0 1 0 5H4.5Z"/></svg>`,
}

/**
 * RefPicker — searchable ref dropdown grouped into recent commits, local
 * branches, and remote branches (plus working-tree/HEAD shortcuts).
 *
 * Props: value (current ref) · label ("base" | "compare") · onSelect(ref)
 */
export function RefPicker({ value, label, onSelect }) {
  const [open, setOpen] = useState(false)
  const [refs, setRefs] = useState([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const inputRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const isBase = label === "base"

  const fetchRefs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/refs")
      if (res.ok) setRefs(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  const handleOpen = useCallback(() => {
    // Position the (fixed) dropdown under the trigger so it escapes the header's
    // overflow:hidden clipping.
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) {
      const width = 340
      let left = r.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      setPos({ top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, left)) })
    }
    setOpen(true); setQuery(""); fetchRefs()
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [fetchRefs])

  const handleSelect = useCallback((ref) => { setOpen(false); onSelect?.(ref) }, [onSelect])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false) }
    const t = setTimeout(() => document.addEventListener("click", handler), 0)
    return () => { clearTimeout(t); document.removeEventListener("click", handler) }
  }, [open])

  const q = query.trim().toLowerCase()
  const match = (r) => !q || r.name.toLowerCase().includes(q) || (r.subject || "").toLowerCase().includes(q)
  const filtered = refs.filter(match)

  // working-tree only makes sense as the compare ("to") endpoint.
  const specials = (isBase
    ? [{ name: "HEAD", subject: "Last commit", kind: "special" }]
    : [
        { name: "WORKING", subject: "Uncommitted changes (working tree)", kind: "special" },
        { name: "HEAD", subject: "Last commit", kind: "special" },
      ]
  ).filter(match)

  const sections = [
    { title: null, items: specials },
    { title: "Recent commits", items: filtered.filter((r) => r.kind === "commit") },
    { title: "Local branches", items: filtered.filter((r) => r.kind === "local") },
    { title: "Remote branches", items: filtered.filter((r) => r.kind === "remote") },
  ].filter((s) => s.items.length)
  const total = sections.reduce((n, s) => n + s.items.length, 0)

  const option = (ref) => html`
    <button
      key=${(ref.kind || "") + ":" + ref.name}
      onClick=${() => handleSelect(ref.name)}
      style=${{
        display: "flex", flexDirection: "column", gap: "2px", width: "100%",
        background: ref.name === value ? "var(--color-canvas-subtle)" : "none",
        border: "none", borderBottom: "1px solid var(--color-border-muted)",
        cursor: "pointer", padding: "7px 12px", textAlign: "left",
      }}
      onMouseEnter=${(e) => { if (ref.name !== value) e.currentTarget.style.background = "var(--color-canvas-subtle)" }}
      onMouseLeave=${(e) => { if (ref.name !== value) e.currentTarget.style.background = "none" }}
    >
      <div style=${{ display: "flex", alignItems: "center", gap: "6px" }}>
        ${ICONS[ref.kind] || ICONS.local}
        <span style=${{
          fontFamily: "var(--font-mono)", fontSize: "12px",
          fontWeight: ref.name === value ? "600" : "400", color: "var(--color-fg-default)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>${prettyName(ref.name)}</span>
        ${ref.sha && html`<span style=${{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-fg-muted)", flexShrink: 0 }}>${ref.sha}</span>`}
        ${ref.name === value && html`<span style=${{ marginLeft: "auto", color: "var(--color-accent-fg)", fontSize: "12px", flexShrink: 0 }}>✓</span>`}
      </div>
      ${ref.subject && html`
        <div style=${{ fontSize: "11px", color: "var(--color-fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "18px" }}>
          ${ref.subject}${ref.date ? html` · <span style=${{ color: "var(--color-fg-subtle)" }}>${ref.date}</span>` : ""}
        </div>
      `}
    </button>
  `

  return html`
    <div ref=${containerRef} style=${{ position: "relative", display: "inline-block" }}>
      <button
        ref=${triggerRef}
        onClick=${open ? () => setOpen(false) : handleOpen}
        title=${"Change " + label + " ref"}
        style=${{
          padding: "1px 8px",
          background: isBase ? "var(--color-canvas-subtle)" : "var(--color-accent-subtle)",
          border: isBase ? "1px solid var(--color-border-default)" : "1px solid var(--color-accent-emphasis)44",
          borderRadius: "var(--radius-sm)",
          color: isBase ? "var(--color-fg-muted)" : "var(--color-accent-emphasis)",
          fontFamily: "var(--font-mono)", fontSize: "12px", cursor: "pointer",
          whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px",
        }}
      >
        ${prettyName(value)}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style=${{ opacity: 0.6 }}><path d="M0 2l4 4 4-4H0z"/></svg>
      </button>

      ${open && html`
        <div style=${{
          position: "fixed", top: pos.top + "px", left: pos.left + "px",
          zIndex: 500, background: "var(--color-bg)",
          border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-md)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)", width: "340px", overflow: "hidden",
        }}>
          <div style=${{ padding: "8px", borderBottom: "1px solid var(--color-border-muted)" }}>
            <input
              ref=${inputRef} type="text" placeholder="Search commits & branches…"
              value=${query} onInput=${(e) => setQuery(e.target.value)}
              style=${{
                width: "100%", padding: "5px 8px", background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-sm)",
                color: "var(--color-fg-default)", fontSize: "12px", fontFamily: "var(--font-ui)", outline: "none",
              }}
            />
          </div>
          <div style=${{ maxHeight: "320px", overflowY: "auto" }}>
            ${loading && html`<div style=${{ padding: "12px", color: "var(--color-fg-muted)", fontSize: "12px", textAlign: "center" }}>Loading…</div>`}
            ${!loading && total === 0 && html`<div style=${{ padding: "12px", color: "var(--color-fg-muted)", fontSize: "12px", textAlign: "center" }}>No matches</div>`}
            ${!loading && sections.map((s) => html`
              ${s.title && html`
                <div style=${{
                  padding: "6px 12px 4px", fontSize: "10px", fontWeight: "600",
                  textTransform: "uppercase", letterSpacing: "0.5px",
                  color: "var(--color-fg-subtle)", background: "var(--color-canvas-inset)",
                  position: "sticky", top: 0,
                }}>${s.title}</div>
              `}
              ${s.items.map(option)}
            `)}
          </div>
        </div>
      `}
    </div>
  `
}
