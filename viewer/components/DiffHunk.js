import { html } from "https://esm.sh/htm/preact"
import { LineRow } from "./LineRow.js"
import { CommentThread } from "./CommentThread.js"

/**
 * DiffHunk — renders one hunk's lines.
 *
 * Props:
 *   hunk      — { header, oldStart, newStart, lines: DiffLine[] }
 *   comments  — ReviewComment[] (all for this file; filtered internally by line)
 *   viewMode  — "unified" | "side-by-side"
 *   path      — file path
 *   onReply   — (commentId) => void
 *   onResolve — (commentId) => void
 *   onAction  — (commentId, action) => void
 */
export function DiffHunk({ hunk, comments = [], viewMode, path, onReply, onResolve, onAction, getNavInfo, onNavigate }) {
  if (!hunk) return null

  const hunkHeaderStyle = {
    display: "flex",
    alignItems: "center",
    padding: "4px 16px",
    background: "#ddf4ff",
    color: "#0969da",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-code-size)",
    borderTop: "1px solid #b6e3ff",
    borderBottom: "1px solid #b6e3ff",
    userSelect: "none",
  }

  if (viewMode === "unified") {
    return html`
      <div data-hunk data-file-path=${path}>
        <div style=${hunkHeaderStyle}>${hunk.header}</div>
        <div>
          ${hunk.lines.map((line, i) => {
            const relevantLineNum =
              line.type === "removed" ? line.oldLineNumber : line.newLineNumber
            const lineThreadComments = comments.filter(
              (c) => c.line === relevantLineNum && c.path === path
            )
            return html`
              <${LineRow}
                key=${i}
                line=${line}
                viewMode="unified"
                path=${path}
              />
              ${lineThreadComments.length > 0 && html`
                <${CommentThread}
                  comments=${lineThreadComments}
                  path=${path}
                  line=${relevantLineNum}
                  onReply=${onReply}
                  onResolve=${onResolve}
                  onAction=${onAction}
                  getNavInfo=${getNavInfo}
                  onNavigate=${onNavigate}
                />
              `}
            `
          })}
        </div>
      </div>
    `
  }

  // Side-by-side mode
  const pairs = buildSideBySidePairs(hunk.lines)

  return html`
    <div data-hunk data-file-path=${path}>
      <div style=${hunkHeaderStyle}>${hunk.header}</div>
      <div style=${{ display: "flex", width: "100%" }}>
        <!-- Left panel (old) -->
        <div style=${{ flex: 1, overflow: "hidden", borderRight: "1px solid var(--color-border-default)" }}>
          <div>
            ${pairs.map((pair, i) => {
              const leftLine = pair.left
              const leftLineNum = leftLine?.oldLineNumber
              const leftComments = leftLineNum != null
                ? comments.filter((c) => c.line === leftLineNum && c.path === path && c.side === "LEFT")
                : []
              return html`
                <${LineRow}
                  key=${"l" + i}
                  line=${pair.left}
                  viewMode="side-by-side"
                  side="left"
                  path=${path}
                />
                ${leftComments.length > 0 && html`
                  <${CommentThread}
                    comments=${leftComments}
                    path=${path}
                    line=${leftLineNum}
                    onReply=${onReply}
                    onResolve=${onResolve}
                    onAction=${onAction}
                    getNavInfo=${getNavInfo}
                    onNavigate=${onNavigate}
                  />
                `}
              `
            })}
          </div>
        </div>
        <!-- Right panel (new) -->
        <div style=${{ flex: 1, overflow: "hidden" }}>
          <div>
            ${pairs.map((pair, i) => {
              const rightLine = pair.right
              const rightLineNum = rightLine?.newLineNumber
              const rightComments = rightLineNum != null
                ? comments.filter((c) => c.line === rightLineNum && c.path === path && c.side === "RIGHT")
                : []
              return html`
                <${LineRow}
                  key=${"r" + i}
                  line=${pair.right}
                  viewMode="side-by-side"
                  side="right"
                  path=${path}
                />
                ${rightComments.length > 0 && html`
                  <${CommentThread}
                    comments=${rightComments}
                    path=${path}
                    line=${rightLineNum}
                    onReply=${onReply}
                    onResolve=${onResolve}
                    onAction=${onAction}
                    getNavInfo=${getNavInfo}
                    onNavigate=${onNavigate}
                  />
                `}
              `
            })}
          </div>
        </div>
      </div>
    </div>
  `
}

/**
 * Build side-by-side pairs from unified diff lines.
 * Groups consecutive removed/added lines as pairs, context lines go to both sides.
 */
function buildSideBySidePairs(lines) {
  const pairs = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.type === "context") {
      pairs.push({ left: line, right: line })
      i++
    } else if (line.type === "removed") {
      const removed = []
      while (i < lines.length && lines[i].type === "removed") {
        removed.push(lines[i])
        i++
      }
      const added = []
      while (i < lines.length && lines[i].type === "added") {
        added.push(lines[i])
        i++
      }
      const maxLen = Math.max(removed.length, added.length)
      for (let j = 0; j < maxLen; j++) {
        pairs.push({
          left: removed[j] || null,
          right: added[j] || null,
        })
      }
    } else if (line.type === "added") {
      pairs.push({ left: null, right: line })
      i++
    } else {
      i++
    }
  }

  return pairs
}
