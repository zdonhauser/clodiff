import { html } from "https://esm.sh/htm/preact"
import { useCallback, useRef, useState, useEffect } from "https://esm.sh/preact/hooks"
import { FileSection } from "./FileSection.js"

const STATUS_COLORS = {
  added: "var(--color-added-gutter)",
  removed: "var(--color-removed-gutter)",
  modified: "var(--color-accent-fg)",
  renamed: "var(--color-attention-fg)",
}

const STATUS_LABELS = { added: "A", removed: "D", modified: "M", renamed: "R" }

function findScrollParent(el) {
  let p = el.parentElement
  while (p && p !== document.documentElement) {
    const s = getComputedStyle(p)
    if (s.overflow === "auto" || s.overflow === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") return p
    p = p.parentElement
  }
  return document.documentElement
}

/**
 * FileList — renders the list of file sections with a sticky file-name label.
 *
 * Props:
 *   diff          — DiffFile[]
 *   comments      — ReviewComment[] (flat list)
 *   expandedFiles — { [path]: boolean }
 *   onToggle      — (path) => void
 *   viewMode      — "unified" | "side-by-side"
 *   onReply       — (commentId) => void
 *   onResolve     — (commentId) => void
 *   onFileRef     — (path, el) => void — callback for anchoring
 *   onAction      — (commentId, action) => void
 */
export function FileList({
  diff = [],
  comments = [],
  expandedFiles = {},
  onToggle,
  viewMode,
  onReply,
  onResolve,
  onFileRef,
  onAction,
  onEdit,
  getNavInfo,
  onNavigate,
}) {
  const containerRef = useRef(null)
  const [stickyFile, setStickyFile] = useState(null)

  // Track which file section we're currently scrolled into
  useEffect(() => {
    const container = containerRef.current
    if (!container || diff.length === 0) return

    const scrollEl = findScrollParent(container)

    const onScroll = () => {
      const sections = container.querySelectorAll("[data-file-path]")
      const scrollRect = scrollEl.getBoundingClientRect()
      const threshold = scrollRect.top

      let found = null
      for (const section of sections) {
        const rect = section.getBoundingClientRect()
        // Section header has scrolled above the viewport but body is still in view
        if (rect.top < threshold + 1 && rect.bottom > threshold + 40) {
          found = section.getAttribute("data-file-path")
          break
        }
      }
      setStickyFile(found)
    }

    scrollEl.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => scrollEl.removeEventListener("scroll", onScroll)
  }, [diff])

  if (diff.length === 0) {
    return html`
      <div style=${{
        textAlign: "center",
        padding: "64px 16px",
        color: "var(--color-fg-muted)",
        fontSize: "14px",
      }}>
        <div style=${{ fontSize: "12px", marginTop: "4px" }}>Select a file from the sidebar, or choose a diff range in the header.</div>
      </div>
    `
  }

  const stickyFileMeta = stickyFile ? diff.find((f) => f.path === stickyFile) : null

  return html`
    <div ref=${containerRef}>
      <!-- Sticky file name label — appears when the file header scrolls out of view -->
      <div style=${{
        position: "sticky",
        top: 0,
        zIndex: 20,
        height: stickyFile ? "auto" : "0",
        overflow: "hidden",
        transition: "height 0.12s ease",
      }}>
        ${stickyFile && html`
          <div style=${{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "5px 16px",
            background: "var(--color-canvas-subtle)",
            borderBottom: "1px solid var(--color-border-default)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}>
            <!-- Status dot -->
            <span style=${{
              fontSize: "11px",
              fontWeight: "700",
              color: STATUS_COLORS[stickyFileMeta?.status] || "var(--color-fg-muted)",
              width: "14px",
              textAlign: "center",
              flexShrink: 0,
            }}>${STATUS_LABELS[stickyFileMeta?.status] || "M"}</span>

            <!-- File path -->
            <span style=${{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-code-size)",
              color: "var(--color-fg-default)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}>${stickyFile}</span>

            <!-- Scroll-to-top hint -->
            <button
              onClick=${() => {
                const section = containerRef.current?.querySelector(`[data-file-path="${CSS.escape(stickyFile)}"]`)
                section?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
              title="Scroll back to file header"
              style=${{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-fg-muted)",
                fontSize: "14px",
                padding: "0 2px",
                flexShrink: 0,
                lineHeight: 1,
              }}
            >↑</button>
          </div>
        `}
      </div>

      <!-- File sections -->
      <div style=${{ padding: "16px" }}>
        ${diff.map((file) => {
          const fileComments = comments.filter((c) => c.path === file.path)
          const expanded = expandedFiles[file.path] !== false

          const handleRef = onFileRef
            ? (el) => onFileRef(file.path, el)
            : undefined

          return html`
            <${FileSection}
              key=${file.path}
              file=${file}
              comments=${fileComments}
              expanded=${expanded}
              onToggle=${() => onToggle?.(file.path)}
              viewMode=${viewMode}
              onReply=${onReply}
              onResolve=${onResolve}
              onRef=${handleRef}
              onAction=${onAction}
              onEdit=${onEdit}
              getNavInfo=${getNavInfo}
              onNavigate=${onNavigate}
            />
          `
        })}
      </div>
    </div>
  `
}
