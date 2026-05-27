import { html } from "https://esm.sh/htm/preact"
import { useRef, useEffect } from "https://esm.sh/preact/hooks"
import { DiffHunk } from "./DiffHunk.js"

const STATUS_LABELS = {
  added: "A",
  removed: "D",
  modified: "M",
  renamed: "R",
}

const STATUS_COLORS = {
  added: "var(--color-added-gutter)",
  removed: "var(--color-removed-gutter)",
  modified: "var(--color-accent-fg)",
  renamed: "var(--color-attention-fg)",
}

/**
 * FileSection — one file's header + hunks.
 *
 * Props:
 *   file        — DiffFile
 *   comments    — ReviewComment[] for this file
 *   expanded    — boolean
 *   onToggle    — () => void
 *   viewMode    — "unified" | "side-by-side"
 *   onReply     — (commentId) => void
 *   onResolve   — (commentId) => void
 *   onRef       — (el: HTMLElement | null) => void
 */
export function FileSection({ file, comments = [], expanded, onToggle, viewMode, onReply, onResolve, onRef }) {
  const containerRef = useRef(null)

  useEffect(() => {
    onRef?.(containerRef.current)
    return () => onRef?.(null)
  }, [onRef])

  const unresolvedComments = comments.filter((c) => !c.resolved)
  const hasComments = comments.length > 0
  const hasUnresolved = unresolvedComments.length > 0

  const addCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "added").length, 0
  )
  const removeCount = file.hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "removed").length, 0
  )

  // Render diff stat bars (like GitHub)
  function DiffStat({ added, removed }) {
    const total = added + removed
    if (total === 0) return null
    const maxBars = 5
    const addBars = total > 0 ? Math.max(1, Math.round((added / total) * maxBars)) : 0
    const removeBars = maxBars - addBars

    return html`
      <span style=${{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        marginLeft: "8px",
      }}>
        <span style=${{ color: "var(--color-added-gutter)", fontSize: "12px", fontWeight: "500" }}>+${added}</span>
        <span style=${{ color: "var(--color-removed-gutter)", fontSize: "12px", fontWeight: "500", marginLeft: "4px" }}>−${removed}</span>
        <span style=${{ display: "flex", gap: "1px", marginLeft: "6px" }}>
          ${Array.from({ length: addBars }).map((_, i) => html`
            <span key=${"a" + i} style=${{
              display: "inline-block",
              width: "8px",
              height: "8px",
              background: "var(--color-added-gutter)",
              borderRadius: "1px",
            }} />
          `)}
          ${Array.from({ length: removeBars }).map((_, i) => html`
            <span key=${"r" + i} style=${{
              display: "inline-block",
              width: "8px",
              height: "8px",
              background: "var(--color-removed-gutter)",
              borderRadius: "1px",
            }} />
          `)}
        </span>
      </span>
    `
  }

  return html`
    <div
      ref=${containerRef}
      data-file-path=${file.path}
      style=${{
        border: "1px solid var(--color-border-default)",
        borderRadius: "var(--radius-md)",
        marginBottom: "16px",
        overflow: "hidden",
      }}
    >
      <!-- File header -->
      <div
        onClick=${onToggle}
        style=${{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: "var(--color-canvas-subtle)",
          borderBottom: expanded ? "1px solid var(--color-border-default)" : "none",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <!-- Chevron -->
        <span style=${{
          fontSize: "12px",
          color: "var(--color-fg-muted)",
          width: "14px",
          textAlign: "center",
        }}>${expanded ? "▼" : "▶"}</span>

        <!-- Status badge -->
        <span style=${{
          fontSize: "11px",
          fontWeight: "700",
          color: STATUS_COLORS[file.status] || "var(--color-fg-muted)",
          width: "14px",
          textAlign: "center",
        }}>${STATUS_LABELS[file.status] || "M"}</span>

        <!-- File path -->
        <span style=${{
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          color: "var(--color-fg-default)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          ${file.status === "renamed" && file.oldPath !== file.path
            ? html`<span style=${{ color: "var(--color-fg-muted)" }}>${file.oldPath}</span> → ${file.path}`
            : file.path
          }
        </span>

        <!-- Diff stat -->
        <${DiffStat} added=${addCount} removed=${removeCount} />

        <!-- Comment count badge -->
        ${hasComments && html`
          <span style=${{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "18px",
            height: "18px",
            padding: "0 5px",
            borderRadius: "9px",
            background: "var(--color-accent-emphasis)",
            color: "#ffffff",
            fontSize: "11px",
            fontWeight: "600",
          }}>${comments.length}</span>
        `}

        <!-- Unresolved indicator -->
        ${hasUnresolved && html`
          <span
            title="${unresolvedComments.length} unresolved comment${unresolvedComments.length !== 1 ? "s" : ""}"
            style=${{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "var(--color-attention-fg)",
              flexShrink: 0,
            }}
          />
        `}
      </div>

      <!-- Hunks (when expanded) -->
      ${expanded && file.hunks.length > 0 && html`
        <div style=${{ overflow: "auto" }}>
          ${file.hunks.map((hunk, i) => html`
            <${DiffHunk}
              key=${i}
              hunk=${hunk}
              comments=${comments}
              viewMode=${viewMode}
              path=${file.path}
              onReply=${onReply}
              onResolve=${onResolve}
            />
          `)}
        </div>
      `}

      ${expanded && file.hunks.length === 0 && html`
        <div style=${{
          padding: "16px",
          color: "var(--color-fg-muted)",
          fontSize: "13px",
          textAlign: "center",
        }}>
          ${file.status === "added" ? "New file" : file.status === "removed" ? "Deleted file" : "Binary file or no changes"}
        </div>
      `}
    </div>
  `
}
