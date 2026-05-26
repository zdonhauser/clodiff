import type { DiffFile, DiffLine } from "./diff-parser"
import type { ReviewComment } from "./session"

// Re-anchor comments based on current diff output.
// For each comment, look up line_content in the new diff for the same path.
// - If found at same position: no change
// - If found at different position: update line, set original_line if not already set
// - If not found: set is_outdated = true
// - If already is_outdated: leave unchanged
// - Match on trimmed content (ignore leading/trailing whitespace)
// Returns new array of comments (do not mutate input)
export function reanchorComments(
  comments: ReviewComment[],
  newDiff: DiffFile[]
): ReviewComment[] {
  return comments.map(comment => {
    // If already outdated, leave unchanged
    if (comment.is_outdated) {
      return comment
    }

    // No line_content to match on — leave unchanged
    if (comment.line_content == null) {
      return comment
    }

    // Find the file in the new diff matching the comment's path
    const diffFile = newDiff.find(f => f.path === comment.path)
    if (!diffFile) {
      return { ...comment, is_outdated: true }
    }

    // Collect all lines across hunks, filtered by side
    const candidateLines: DiffLine[] = []
    for (const hunk of diffFile.hunks) {
      for (const line of hunk.lines) {
        if (comment.side === "RIGHT") {
          // RIGHT side: added and context lines
          if (line.type === "added" || line.type === "context") {
            candidateLines.push(line)
          }
        } else {
          // LEFT side: removed and context lines
          if (line.type === "removed" || line.type === "context") {
            candidateLines.push(line)
          }
        }
      }
    }

    const trimmedTarget = comment.line_content.trim()
    const matchedLine = candidateLines.find(
      line => line.content.trim() === trimmedTarget
    )

    if (!matchedLine) {
      return { ...comment, is_outdated: true }
    }

    // Determine the line number for this side
    const newLineNumber =
      comment.side === "RIGHT"
        ? matchedLine.newLineNumber
        : matchedLine.oldLineNumber

    if (newLineNumber === null) {
      return { ...comment, is_outdated: true }
    }

    // If line number hasn't changed, no update needed
    if (newLineNumber === comment.line) {
      return comment
    }

    // Line moved — update it, set original_line if not already set
    const updated: ReviewComment = {
      ...comment,
      line: newLineNumber,
    }

    if (updated.original_line == null) {
      updated.original_line = comment.line
    }

    return updated
  })
}
