import { describe, it, expect } from "bun:test"
import { parseDiff } from "../diff-parser"

// ─── Sample diff strings ────────────────────────────────────────────────────

const ADDED_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/foo.ts
@@ -0,0 +1,3 @@
+export const foo = 1
+export const bar = 2
+export const baz = 3`

const DELETED_FILE_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1
-export const y = 2`

const MODIFIED_FILE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 import { foo } from './foo'
-const x = 1
+const x = 2
+const z = 3
 export function run() {
   return x
 }`

const MODIFIED_MULTI_HUNK_DIFF = `diff --git a/src/big.ts b/src/big.ts
index abc1234..def5678 100644
--- a/src/big.ts
+++ b/src/big.ts
@@ -1,4 +1,4 @@
 line one
-line two
+line TWO
 line three
 line four
@@ -10,4 +10,4 @@
 line ten
-line eleven
+line ELEVEN
 line twelve
 line thirteen`

const RENAMED_FILE_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts`

const BINARY_FILE_DIFF = `diff --git a/assets/image.png b/assets/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/assets/image.png differ`

const NO_NEWLINE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-old line
\\ No newline at end of file
+new line
\\ No newline at end of file`

const MULTIPLE_FILES_DIFF = `diff --git a/src/a.ts b/src/a.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/a.ts
@@ -0,0 +1,1 @@
+export const a = 1
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
index 0000000..def5678
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,1 @@
+export const b = 2`

const CONTEXT_ONLY_HUNK_DIFF = `diff --git a/src/stable.ts b/src/stable.ts
index abc1234..abc1234 100644
--- a/src/stable.ts
+++ b/src/stable.ts
@@ -1,3 +1,3 @@
 line one
 line two
 line three`

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("parseDiff", () => {
  describe("added file", () => {
    it("detects status as added", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      expect(files[0].status).toBe("added")
    })

    it("parses all lines as type added", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines).toHaveLength(3)
      expect(lines[0].type).toBe("added")
      expect(lines[1].type).toBe("added")
      expect(lines[2].type).toBe("added")
    })

    it("old line numbers are null", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].oldLineNumber).toBeNull()
      expect(lines[1].oldLineNumber).toBeNull()
      expect(lines[2].oldLineNumber).toBeNull()
    })

    it("new line numbers increment from hunk start", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].newLineNumber).toBe(1)
      expect(lines[1].newLineNumber).toBe(2)
      expect(lines[2].newLineNumber).toBe(3)
    })

    it("strips leading + from content", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].content).toBe("export const foo = 1")
      expect(lines[1].content).toBe("export const bar = 2")
      expect(lines[2].content).toBe("export const baz = 3")
    })

    it("sets path correctly", () => {
      const files = parseDiff(ADDED_FILE_DIFF)
      expect(files[0].path).toBe("src/foo.ts")
    })
  })

  describe("deleted file", () => {
    it("detects status as removed", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      expect(files[0].status).toBe("removed")
    })

    it("parses all lines as type removed", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines).toHaveLength(2)
      expect(lines[0].type).toBe("removed")
      expect(lines[1].type).toBe("removed")
    })

    it("new line numbers are null", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].newLineNumber).toBeNull()
      expect(lines[1].newLineNumber).toBeNull()
    })

    it("old line numbers increment from hunk start", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].oldLineNumber).toBe(1)
      expect(lines[1].oldLineNumber).toBe(2)
    })

    it("strips leading - from content", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      expect(lines[0].content).toBe("export const x = 1")
      expect(lines[1].content).toBe("export const y = 2")
    })

    it("uses old path when file is deleted", () => {
      const files = parseDiff(DELETED_FILE_DIFF)
      expect(files[0].path).toBe("src/old.ts")
    })
  })

  describe("modified file", () => {
    it("detects status as modified", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      expect(files[0].status).toBe("modified")
    })

    it("parses added lines correctly", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      const added = lines.filter(l => l.type === "added")
      expect(added).toHaveLength(2)
      expect(added[0].content).toBe("const x = 2")
      expect(added[1].content).toBe("const z = 3")
    })

    it("parses removed lines correctly", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      const removed = lines.filter(l => l.type === "removed")
      expect(removed).toHaveLength(1)
      expect(removed[0].content).toBe("const x = 1")
    })

    it("parses context lines correctly", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      const context = lines.filter(l => l.type === "context")
      expect(context).toHaveLength(4)
      expect(context[0].content).toBe("import { foo } from './foo'")
      expect(context[1].content).toBe("export function run() {")
      expect(context[2].content).toBe("  return x")
      expect(context[3].content).toBe("}")
    })

    it("assigns correct old and new line numbers", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      const lines = files[0].hunks[0].lines
      // Line 0: context " import..." → old=1, new=1
      expect(lines[0].type).toBe("context")
      expect(lines[0].oldLineNumber).toBe(1)
      expect(lines[0].newLineNumber).toBe(1)
      // Line 1: removed "-const x = 1" → old=2, new=null
      expect(lines[1].type).toBe("removed")
      expect(lines[1].oldLineNumber).toBe(2)
      expect(lines[1].newLineNumber).toBeNull()
      // Line 2: added "+const x = 2" → old=null, new=2
      expect(lines[2].type).toBe("added")
      expect(lines[2].oldLineNumber).toBeNull()
      expect(lines[2].newLineNumber).toBe(2)
      // Line 3: added "+const z = 3" → old=null, new=3
      expect(lines[3].type).toBe("added")
      expect(lines[3].oldLineNumber).toBeNull()
      expect(lines[3].newLineNumber).toBe(3)
    })

    it("handles multiple hunks in one file", () => {
      const files = parseDiff(MODIFIED_MULTI_HUNK_DIFF)
      expect(files[0].hunks).toHaveLength(2)
      // First hunk
      const hunk1 = files[0].hunks[0]
      expect(hunk1.oldStart).toBe(1)
      expect(hunk1.newStart).toBe(1)
      expect(hunk1.lines).toHaveLength(5) // 1 removed + 1 added + 3 context
      // Second hunk
      const hunk2 = files[0].hunks[1]
      expect(hunk2.oldStart).toBe(10)
      expect(hunk2.newStart).toBe(10)
      expect(hunk2.lines).toHaveLength(5) // 1 removed + 1 added + 3 context
    })

    it("parses hunk header correctly", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      expect(files[0].hunks[0].header).toBe("@@ -1,5 +1,6 @@")
    })

    it("tracks line numbers across multiple hunks", () => {
      const files = parseDiff(MODIFIED_MULTI_HUNK_DIFF)
      const hunk2Lines = files[0].hunks[1].lines
      // hunk2 starts at old=10, new=10
      expect(hunk2Lines[0].type).toBe("context")
      expect(hunk2Lines[0].oldLineNumber).toBe(10)
      expect(hunk2Lines[0].newLineNumber).toBe(10)
      expect(hunk2Lines[1].type).toBe("removed")
      expect(hunk2Lines[1].oldLineNumber).toBe(11)
      expect(hunk2Lines[1].newLineNumber).toBeNull()
      expect(hunk2Lines[2].type).toBe("added")
      expect(hunk2Lines[2].oldLineNumber).toBeNull()
      expect(hunk2Lines[2].newLineNumber).toBe(11)
    })
  })

  describe("renamed file", () => {
    it("detects status as renamed", () => {
      const files = parseDiff(RENAMED_FILE_DIFF)
      expect(files[0].status).toBe("renamed")
    })

    it("sets oldPath and path correctly", () => {
      const files = parseDiff(RENAMED_FILE_DIFF)
      expect(files[0].oldPath).toBe("src/old-name.ts")
      expect(files[0].path).toBe("src/new-name.ts")
    })

    it("has no hunks when file is only renamed", () => {
      const files = parseDiff(RENAMED_FILE_DIFF)
      expect(files[0].hunks).toHaveLength(0)
    })
  })

  describe("multiple files", () => {
    it("returns one entry per file", () => {
      const files = parseDiff(MULTIPLE_FILES_DIFF)
      expect(files).toHaveLength(2)
    })

    it("files are in diff order", () => {
      const files = parseDiff(MULTIPLE_FILES_DIFF)
      expect(files[0].path).toBe("src/a.ts")
      expect(files[1].path).toBe("src/b.ts")
    })

    it("each file has correct status", () => {
      const files = parseDiff(MULTIPLE_FILES_DIFF)
      expect(files[0].status).toBe("added")
      expect(files[1].status).toBe("added")
    })
  })

  describe("edge cases", () => {
    it("handles empty diff string", () => {
      const files = parseDiff("")
      expect(files).toHaveLength(0)
    })

    it("handles diff with no newline at end of file", () => {
      const files = parseDiff(NO_NEWLINE_DIFF)
      expect(files).toHaveLength(1)
      const lines = files[0].hunks[0].lines
      // Should have exactly 2 lines (the removed and the added), NOT the "\ No newline" markers
      expect(lines).toHaveLength(2)
      expect(lines[0].type).toBe("removed")
      expect(lines[0].content).toBe("old line")
      expect(lines[1].type).toBe("added")
      expect(lines[1].content).toBe("new line")
    })

    it("handles binary file markers", () => {
      const files = parseDiff(BINARY_FILE_DIFF)
      expect(files).toHaveLength(1)
      expect(files[0].path).toBe("assets/image.png")
      expect(files[0].hunks).toHaveLength(0)
    })

    it("handles files with only context lines in a hunk", () => {
      const files = parseDiff(CONTEXT_ONLY_HUNK_DIFF)
      expect(files).toHaveLength(1)
      const lines = files[0].hunks[0].lines
      expect(lines).toHaveLength(3)
      expect(lines[0].type).toBe("context")
      expect(lines[1].type).toBe("context")
      expect(lines[2].type).toBe("context")
    })

    it("oldPath equals path for non-renamed files", () => {
      const files = parseDiff(MODIFIED_FILE_DIFF)
      expect(files[0].oldPath).toBe("src/app.ts")
      expect(files[0].path).toBe("src/app.ts")
    })
  })
})
