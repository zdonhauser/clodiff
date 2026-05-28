import { html } from "https://esm.sh/htm/preact"
import { useCallback } from "https://esm.sh/preact/hooks"
import { FileSection } from "./FileSection.js"

/**
 * FileList — renders the list of file sections.
 *
 * Uses file-level virtualization: each FileSection is one item.
 * Collapsed files are tiny headers; only expanded files render hunks.
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
}) {
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

  return html`
    <div style=${{ padding: "16px" }}>
      ${diff.map((file) => {
        const fileComments = comments.filter((c) => c.path === file.path)
        const expanded = expandedFiles[file.path] !== false // default expanded

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
          />
        `
      })}
    </div>
  `
}
