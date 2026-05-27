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
 */
export function DiffHunk({ hunk, comments = [], viewMode, path, onReply, onResolve }) {
  if (!hunk) return null

  // Build a map from line number to comments
  // For each line, gather comments anchored at that line
  function getCommentsForLine(lineNumber, side) {
    if (lineNumber == null) return []
    return comments.filter((c) => {
      if (c.line !== lineNumber) return false
      if (viewMode === "side-by-side") {
        // Match side to comment side
        if (side === "left" && c.side !== "LEFT") return false
        if (side === "right" && c.side !== "RIGHT") return false
      }
      return true
    })
  }

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

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-code-size)",
    tableLayout: "fixed",
  }

  if (viewMode === "unified") {
    return html`
      <div data-hunk data-file-path=${path}>
        <!-- Hunk header -->
        <div style=${hunkHeaderStyle}>${hunk.header}</div>

        <!-- Lines table -->
        <div style=${{ display: "table", width: "100%", borderCollapse: "collapse" }}>
          ${hunk.lines.map((line, i) => {
            const relevantLineNum =
              line.type === "removed" ? line.oldLineNumber : line.newLineNumber

            const lineThreadComments = comments.filter((c) => c.line === relevantLineNum && c.path === path)

            return html`
              <${LineRow}
                key=${i}
                line=${line}
                viewMode="unified"
                path=${path}
              />
              ${lineThreadComments.length > 0 && html`
                <div style=${{ display: "table-row-group" }}>
                  <div style=${{ display: "table-row" }}>
                    <div style=${{ display: "table-cell", padding: 0 }} colspan="10">
                      <${CommentThread}
                        comments=${lineThreadComments}
                        path=${path}
                        line=${relevantLineNum}
                        onReply=${onReply}
                        onResolve=${onResolve}
                      />
                    </div>
                  </div>
                </div>
              `}
            `
          })}
        </div>
      </div>
    `
  }

  // Side-by-side mode: pair up lines
  // Strategy: group lines as pairs of (left, right).
  // Removed lines → left panel only
  // Added lines → right panel only
  // Context lines → both panels
  const leftLines = hunk.lines.filter((l) => l.type === "removed" || l.type === "context")
  const rightLines = hunk.lines.filter((l) => l.type === "added" || l.type === "context")

  // We need to align removed/added lines that are adjacent
  // Simple approach: create pairs by walking through and matching context anchors
  const pairs = buildSideBySidePairs(hunk.lines)

  return html`
    <div data-hunk data-file-path=${path}>
      <div style=${hunkHeaderStyle}>${hunk.header}</div>
      <div style=${{ display: "flex", width: "100%" }}>
        <!-- Left panel (old) -->
        <div style=${{ flex: 1, overflow: "hidden", borderRight: "1px solid var(--color-border-default)" }}>
          <div style=${{ display: "table", width: "100%", borderCollapse: "collapse" }}>
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
                  />
                `}
              `
            })}
          </div>
        </div>
        <!-- Right panel (new) -->
        <div style=${{ flex: 1, overflow: "hidden" }}>
          <div style=${{ display: "table", width: "100%", borderCollapse: "collapse" }}>
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
      // Collect consecutive removed lines
      const removed = []
      while (i < lines.length && lines[i].type === "removed") {
        removed.push(lines[i])
        i++
      }
      // Collect consecutive added lines
      const added = []
      while (i < lines.length && lines[i].type === "added") {
        added.push(lines[i])
        i++
      }
      // Pair them up
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
