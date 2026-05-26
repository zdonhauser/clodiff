export interface DiffLine {
  type: "added" | "removed" | "context"
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffHunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string
  status: "added" | "removed" | "modified" | "renamed"
  hunks: DiffHunk[]
}

// Matches: @@ -<oldStart>[,<oldCount>] +<newStart>[,<newCount>] @@
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseDiff(input: string): DiffFile[] {
  if (!input.trim()) return []

  const lines = input.split("\n")
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLineNo = 0
  let newLineNo = 0

  const pushHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk)
      currentHunk = null
    }
  }

  const pushFile = () => {
    pushHunk()
    if (current) {
      files.push(current)
      current = null
    }
  }

  for (const line of lines) {
    // New file block
    if (line.startsWith("diff --git ")) {
      pushFile()

      // Parse paths from "diff --git a/<old> b/<new>"
      const gitDiffRe = /^diff --git a\/(.+) b\/(.+)$/
      const m = gitDiffRe.exec(line)
      const oldPath = m ? m[1] : ""
      const newPath = m ? m[2] : ""

      current = {
        path: newPath,
        oldPath: oldPath,
        status: "modified",
        hunks: [],
      }
      continue
    }

    if (!current) continue

    // Status markers
    if (line.startsWith("new file mode")) {
      current.status = "added"
      continue
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "removed"
      continue
    }

    // Rename markers
    if (line.startsWith("rename from ")) {
      current.status = "renamed"
      current.oldPath = line.slice("rename from ".length)
      continue
    }
    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length)
      continue
    }

    // Binary file marker — no hunks will follow
    if (line.startsWith("Binary files ")) {
      // status stays as-is (could be "added" already set, or "modified")
      continue
    }

    // --- and +++ headers (skip, we already have paths)
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      // For deleted files: path comes from --- line; for added files, from +++ line
      // We already set path/oldPath from "diff --git" line so nothing to do here
      continue
    }

    // Hunk header
    const hunkMatch = HUNK_HEADER_RE.exec(line)
    if (hunkMatch) {
      pushHunk()
      oldLineNo = parseInt(hunkMatch[1], 10)
      newLineNo = parseInt(hunkMatch[2], 10)
      currentHunk = {
        header: line.replace(/\s*@@\s*.*$/, " @@").replace(/ @@$/, " @@").trimEnd(),
        oldStart: oldLineNo,
        newStart: newLineNo,
        lines: [],
      }
      // Fix: header should be everything up to and including the closing @@
      // e.g. "@@ -1,5 +1,6 @@"  (trailing function name is optional, we exclude it)
      const headerEnd = line.indexOf(" @@", 3) + 3
      currentHunk.header = line.slice(0, headerEnd)
      continue
    }

    // No-newline marker — skip
    if (line.startsWith("\\ ")) {
      continue
    }

    // Diff content lines (only inside a hunk)
    if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "added",
          content: line.slice(1),
          oldLineNumber: null,
          newLineNumber: newLineNo++,
        })
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "removed",
          content: line.slice(1),
          oldLineNumber: oldLineNo++,
          newLineNumber: null,
        })
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldLineNumber: oldLineNo++,
          newLineNumber: newLineNo++,
        })
      }
      // other lines (index, similarity, etc.) are ignored
    }
  }

  pushFile()

  return files
}
