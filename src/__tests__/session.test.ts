import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync } from "fs"
import { loadSession, saveSession, loadReplies, clearReplies } from "../session"
import type { SessionFile, ReplyEntry } from "../session"

function makeSession(overrides?: Partial<SessionFile>): SessionFile {
  return {
    version: 1,
    repo: "owner/repo",
    base_branch: "main",
    head_commit: "abc123",
    current_commit: "abc123",
    reviews: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("session", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clodiff-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("loadSession", () => {
    it("returns null when session.json does not exist", async () => {
      const result = await loadSession(tmpDir)
      expect(result).toBeNull()
    })

    it("returns parsed session when file exists", async () => {
      const session = makeSession()
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      await writeFile(join(reviewDir, "session.json"), JSON.stringify(session))

      const result = await loadSession(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.repo).toBe("owner/repo")
      expect(result!.version).toBe(1)
      expect(result!.base_branch).toBe("main")
    })

    it("throws on malformed JSON", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      await writeFile(join(reviewDir, "session.json"), "{ not valid json }")

      await expect(loadSession(tmpDir)).rejects.toThrow()
    })

    it("throws when version is not 1", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      const session = makeSession({ version: 2 as unknown as 1 })
      await writeFile(join(reviewDir, "session.json"), JSON.stringify(session))

      await expect(loadSession(tmpDir)).rejects.toThrow(/Unsupported/)
    })
  })

  describe("saveSession", () => {
    it("creates .review/ directory if it does not exist", async () => {
      const session = makeSession()
      await saveSession(tmpDir, session)
      expect(existsSync(join(tmpDir, ".review"))).toBe(true)
    })

    it("writes valid JSON", async () => {
      const session = makeSession({ repo: "test/repo" })
      await saveSession(tmpDir, session)
      const raw = await readFile(join(tmpDir, ".review", "session.json"), "utf-8")
      const parsed = JSON.parse(raw)
      expect(parsed.repo).toBe("test/repo")
      expect(parsed.version).toBe(1)
    })

    it("overwrites existing session file", async () => {
      const session1 = makeSession({ repo: "first/repo" })
      await saveSession(tmpDir, session1)

      const session2 = makeSession({ repo: "second/repo", updated_at: "2026-01-01T00:00:00.000Z" })
      await saveSession(tmpDir, session2)

      const raw = await readFile(join(tmpDir, ".review", "session.json"), "utf-8")
      const parsed = JSON.parse(raw)
      expect(parsed.repo).toBe("second/repo")
      expect(parsed.updated_at).not.toBe("2026-01-01T00:00:00.000Z")
    })

    it("adds .review/ to .gitignore if not already present", async () => {
      const session = makeSession()
      await saveSession(tmpDir, session)

      const gitignorePath = join(tmpDir, ".gitignore")
      expect(existsSync(gitignorePath)).toBe(true)
      const content = await readFile(gitignorePath, "utf-8")
      expect(content).toContain(".review/")
    })

    it("does not duplicate .review/ in .gitignore if already present", async () => {
      // Create .gitignore with .review/ already present
      await writeFile(join(tmpDir, ".gitignore"), ".review/\n")

      const session = makeSession()
      await saveSession(tmpDir, session)
      await saveSession(tmpDir, session) // second save to ensure no duplication

      const content = await readFile(join(tmpDir, ".gitignore"), "utf-8")
      const occurrences = (content.match(/\.review\//g) || []).length
      expect(occurrences).toBe(1)
    })
  })

  describe("loadReplies", () => {
    it("returns empty array when replies.json does not exist", async () => {
      const result = await loadReplies(tmpDir)
      expect(result).toEqual([])
    })

    it("throws when replies.json is not an array", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      await writeFile(join(reviewDir, "replies.json"), JSON.stringify({}))

      await expect(loadReplies(tmpDir)).rejects.toThrow(/Invalid/)
    })

    it("returns parsed array when file exists", async () => {
      const replies: ReplyEntry[] = [
        {
          id: "r1",
          comment_id: "c1",
          body: "LGTM",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "r2",
          comment_id: "c2",
          body: "Needs work",
          created_at: "2026-01-02T00:00:00.000Z",
        },
      ]
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      await writeFile(join(reviewDir, "replies.json"), JSON.stringify(replies))

      const result = await loadReplies(tmpDir)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe("r1")
      expect(result[1].body).toBe("Needs work")
    })
  })

  describe("clearReplies", () => {
    it("removes replies.json", async () => {
      const reviewDir = join(tmpDir, ".review")
      await mkdir(reviewDir, { recursive: true })
      await writeFile(join(reviewDir, "replies.json"), "[]")

      await clearReplies(tmpDir)
      expect(existsSync(join(reviewDir, "replies.json"))).toBe(false)
    })

    it("does not throw if replies.json does not exist", async () => {
      await expect(clearReplies(tmpDir)).resolves.toBeUndefined()
    })
  })
})
