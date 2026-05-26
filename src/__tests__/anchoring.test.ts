import { describe, it, expect } from "bun:test"
import { reanchorComments } from "../anchoring"
import type { ReviewComment } from "../session"
import type { DiffFile } from "../diff-parser"

function makeComment(overrides: Partial<ReviewComment> & Pick<ReviewComment, "body" | "path" | "commit_id" | "line" | "side">): ReviewComment {
  return {
    id: "comment-1",
    created_at: "2026-01-01T00:00:00.000Z",
    source: "claude-code",
    ...overrides,
  }
}

function makeRightSideDiff(path: string, lines: string[]): DiffFile {
  return {
    path,
    oldPath: path,
    status: "modified",
    hunks: [
      {
        header: "@@ -1,5 +1,5 @@",
        oldStart: 1,
        newStart: 1,
        lines: lines.map((content, i) => ({
          type: "added" as const,
          content,
          oldLineNumber: null,
          newLineNumber: i + 1,
        })),
      },
    ],
  }
}

describe("reanchorComments", () => {
  it("returns comment unchanged when line_content matches at same line", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "const x = 1", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "const y = 2", oldLineNumber: null, newLineNumber: 2 },
              { type: "added", content: "const z = 3", oldLineNumber: null, newLineNumber: 3 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "check this",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 2,
      side: "RIGHT",
      line_content: "const y = 2",
    })

    const result = reanchorComments([comment], diff)
    expect(result).toHaveLength(1)
    expect(result[0].line).toBe(2)
    expect(result[0].is_outdated).toBeUndefined()
    expect(result[0].original_line).toBeUndefined()
  })

  it("updates line number when line_content found at new position", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,4 +1,4 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "// new comment added", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "const x = 1", oldLineNumber: null, newLineNumber: 2 },
              { type: "added", content: "const y = 2", oldLineNumber: null, newLineNumber: 3 },
              { type: "added", content: "const z = 3", oldLineNumber: null, newLineNumber: 4 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "check this",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 2,
      side: "RIGHT",
      line_content: "const y = 2",
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].line).toBe(3)
  })

  it("sets original_line on first re-anchor", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "inserted line", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "const y = 2", oldLineNumber: null, newLineNumber: 2 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "look here",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 1,
      side: "RIGHT",
      line_content: "const y = 2",
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].original_line).toBe(1)
    expect(result[0].line).toBe(2)
  })

  it("does not overwrite original_line on subsequent re-anchors", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "const y = 2", oldLineNumber: null, newLineNumber: 5 },
            ],
          },
        ],
      },
    ]

    // Comment already has original_line set from a previous re-anchor
    const comment = makeComment({
      body: "look here",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 3,
      side: "RIGHT",
      line_content: "const y = 2",
      original_line: 1, // already set
    })

    const result = reanchorComments([comment], diff)
    // original_line should stay as 1 (not overwritten with 3)
    expect(result[0].original_line).toBe(1)
    expect(result[0].line).toBe(5)
  })

  it("sets is_outdated true when line_content not found anywhere in file", () => {
    const diff: DiffFile[] = [makeRightSideDiff("src/app.ts", ["new line A", "new line B"])]

    const comment = makeComment({
      body: "old comment",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 3,
      side: "RIGHT",
      line_content: "this line was deleted",
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].is_outdated).toBe(true)
    expect(result[0].line).toBe(3) // line unchanged
  })

  it("handles comment whose path does not appear in the new diff", () => {
    const diff: DiffFile[] = [makeRightSideDiff("src/other.ts", ["const x = 1"])]

    const comment = makeComment({
      body: "comment on missing file",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 5,
      side: "RIGHT",
      line_content: "const y = 2",
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].is_outdated).toBe(true)
  })

  it("handles multiple comments on the same file", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,4 +1,4 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "preamble", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "const a = 1", oldLineNumber: null, newLineNumber: 2 },
              { type: "added", content: "const b = 2", oldLineNumber: null, newLineNumber: 3 },
            ],
          },
        ],
      },
    ]

    const commentA = makeComment({
      id: "c-a",
      body: "on a",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 1,
      side: "RIGHT",
      line_content: "const a = 1",
    })
    const commentB = makeComment({
      id: "c-b",
      body: "on b",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 2,
      side: "RIGHT",
      line_content: "const b = 2",
    })

    const result = reanchorComments([commentA, commentB], diff)
    expect(result).toHaveLength(2)
    expect(result.find(c => c.id === "c-a")!.line).toBe(2)
    expect(result.find(c => c.id === "c-b")!.line).toBe(3)
    expect(result.find(c => c.id === "c-a")!.original_line).toBe(1)
    expect(result.find(c => c.id === "c-b")!.original_line).toBe(2)
  })

  it("handles comments across multiple files", () => {
    const diff: DiffFile[] = [
      makeRightSideDiff("src/a.ts", ["line one", "const alpha = 1"]),
      makeRightSideDiff("src/b.ts", ["line one", "const beta = 2"]),
    ]

    const commentA = makeComment({
      id: "c-a",
      body: "on alpha",
      path: "src/a.ts",
      commit_id: "abc123",
      line: 1,
      side: "RIGHT",
      line_content: "const alpha = 1",
    })
    const commentB = makeComment({
      id: "c-b",
      body: "on beta",
      path: "src/b.ts",
      commit_id: "abc123",
      line: 1,
      side: "RIGHT",
      line_content: "const beta = 2",
    })

    const result = reanchorComments([commentA, commentB], diff)
    expect(result.find(c => c.id === "c-a")!.line).toBe(2)
    expect(result.find(c => c.id === "c-b")!.line).toBe(2)
  })

  it("matches on trimmed content, ignoring leading/trailing whitespace", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,2 +1,2 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "  const x = 1  ", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "  const y = 2  ", oldLineNumber: null, newLineNumber: 2 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "whitespace test",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 5,
      side: "RIGHT",
      line_content: "const x = 1", // no surrounding whitespace
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].line).toBe(1)
    expect(result[0].is_outdated).toBeUndefined()
  })

  it("does not re-anchor comments that are already marked is_outdated", () => {
    const diff: DiffFile[] = [
      makeRightSideDiff("src/app.ts", ["const x = 1", "const y = 2"]),
    ]

    const comment = makeComment({
      body: "already outdated",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 99,
      side: "RIGHT",
      line_content: "const x = 1", // this content IS in the diff, but comment is_outdated
      is_outdated: true,
    })

    const result = reanchorComments([comment], diff)
    // Should leave the comment unchanged
    expect(result[0].line).toBe(99)
    expect(result[0].is_outdated).toBe(true)
  })

  it("picks closest match when line_content appears multiple times in file", () => {
    // "return null" appears at lines 3, 10, and 20; comment originally at line 11
    // should re-anchor to line 10, not line 3
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,20 +1,20 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "added", content: "line 1", oldLineNumber: null, newLineNumber: 1 },
              { type: "added", content: "line 2", oldLineNumber: null, newLineNumber: 2 },
              { type: "added", content: "return null", oldLineNumber: null, newLineNumber: 3 },
              { type: "added", content: "line 4", oldLineNumber: null, newLineNumber: 4 },
              { type: "added", content: "line 5", oldLineNumber: null, newLineNumber: 5 },
              { type: "added", content: "line 6", oldLineNumber: null, newLineNumber: 6 },
              { type: "added", content: "line 7", oldLineNumber: null, newLineNumber: 7 },
              { type: "added", content: "line 8", oldLineNumber: null, newLineNumber: 8 },
              { type: "added", content: "line 9", oldLineNumber: null, newLineNumber: 9 },
              { type: "added", content: "return null", oldLineNumber: null, newLineNumber: 10 },
              { type: "added", content: "line 11", oldLineNumber: null, newLineNumber: 11 },
              { type: "added", content: "line 12", oldLineNumber: null, newLineNumber: 12 },
              { type: "added", content: "line 13", oldLineNumber: null, newLineNumber: 13 },
              { type: "added", content: "line 14", oldLineNumber: null, newLineNumber: 14 },
              { type: "added", content: "line 15", oldLineNumber: null, newLineNumber: 15 },
              { type: "added", content: "line 16", oldLineNumber: null, newLineNumber: 16 },
              { type: "added", content: "line 17", oldLineNumber: null, newLineNumber: 17 },
              { type: "added", content: "line 18", oldLineNumber: null, newLineNumber: 18 },
              { type: "added", content: "line 19", oldLineNumber: null, newLineNumber: 19 },
              { type: "added", content: "return null", oldLineNumber: null, newLineNumber: 20 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "check return",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 11,
      side: "RIGHT",
      line_content: "return null",
    })

    const result = reanchorComments([comment], diff)
    // Closest to original line 11 is line 10 (distance 1), not line 3 (distance 8) or 20 (distance 9)
    expect(result[0].line).toBe(10)
  })

  it("handles LEFT side comments by matching removed and context lines", () => {
    const diff: DiffFile[] = [
      {
        path: "src/app.ts",
        oldPath: "src/app.ts",
        status: "modified",
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            newStart: 1,
            lines: [
              { type: "context", content: "line one", oldLineNumber: 1, newLineNumber: 1 },
              { type: "removed", content: "old line two", oldLineNumber: 2, newLineNumber: null },
              { type: "context", content: "line three", oldLineNumber: 3, newLineNumber: 2 },
            ],
          },
        ],
      },
    ]

    const comment = makeComment({
      body: "on removed line",
      path: "src/app.ts",
      commit_id: "abc123",
      line: 5,
      side: "LEFT",
      line_content: "old line two",
    })

    const result = reanchorComments([comment], diff)
    expect(result[0].line).toBe(2)
    expect(result[0].original_line).toBe(5)
  })
})
