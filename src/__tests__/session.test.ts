import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync } from "fs"
import { spawnSync } from "child_process"
import { loadSession, saveSession, loadReplies, clearReplies, reviewDir } from "../session"
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
  let dir: string // resolved clodiff session dir (<tmpDir>/.git/clodiff)

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clodiff-test-"))
    // Make it a git repo so the session dir resolves to <tmpDir>/.git/clodiff
    // (inside tmpDir, so afterEach cleans it up).
    spawnSync("git", ["init"], { cwd: tmpDir })
    dir = reviewDir(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("reviewDir", () => {
    it("resolves inside the git dir, not the working tree", () => {
      expect(dir).toContain(".git")
      expect(dir.endsWith("clodiff")).toBe(true)
    })
  })

  describe("loadSession", () => {
    it("returns null when session.json does not exist", async () => {
      const result = await loadSession(tmpDir)
      expect(result).toBeNull()
    })

    it("returns parsed session when file exists", async () => {
      const session = makeSession()
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "session.json"), JSON.stringify(session))

      const result = await loadSession(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.repo).toBe("owner/repo")
      expect(result!.version).toBe(1)
      expect(result!.base_branch).toBe("main")
    })

    it("throws on malformed JSON", async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "session.json"), "{ not valid json }")
      await expect(loadSession(tmpDir)).rejects.toThrow(/corrupted/)
    })

    it("throws when version is not 1", async () => {
      await mkdir(dir, { recursive: true })
      const session = makeSession({ version: 2 as unknown as 1 })
      await writeFile(join(dir, "session.json"), JSON.stringify(session))
      await expect(loadSession(tmpDir)).rejects.toThrow(/Unsupported/)
    })
  })

  describe("saveSession", () => {
    it("creates the session directory if it does not exist", async () => {
      const session = makeSession()
      await saveSession(tmpDir, session)
      expect(existsSync(dir)).toBe(true)
    })

    it("writes valid JSON", async () => {
      const session = makeSession({ repo: "test/repo" })
      await saveSession(tmpDir, session)
      const raw = await readFile(join(dir, "session.json"), "utf-8")
      const parsed = JSON.parse(raw)
      expect(parsed.repo).toBe("test/repo")
      expect(parsed.version).toBe(1)
    })

    it("overwrites existing session file", async () => {
      await saveSession(tmpDir, makeSession({ repo: "first/repo" }))
      await saveSession(tmpDir, makeSession({ repo: "second/repo", updated_at: "2026-01-01T00:00:00.000Z" }))
      const raw = await readFile(join(dir, "session.json"), "utf-8")
      const parsed = JSON.parse(raw)
      expect(parsed.repo).toBe("second/repo")
      expect(parsed.updated_at).not.toBe("2026-01-01T00:00:00.000Z")
    })

    it("does not create or modify .gitignore (state lives under the git dir)", async () => {
      await saveSession(tmpDir, makeSession())
      expect(existsSync(join(tmpDir, ".gitignore"))).toBe(false)
    })

    it("leaves an existing .gitignore untouched", async () => {
      await writeFile(join(tmpDir, ".gitignore"), "node_modules/\n")
      await saveSession(tmpDir, makeSession())
      const content = await readFile(join(tmpDir, ".gitignore"), "utf-8")
      expect(content).toBe("node_modules/\n")
    })
  })

  describe("loadReplies", () => {
    it("returns empty array when replies.json does not exist", async () => {
      const result = await loadReplies(tmpDir)
      expect(result).toEqual([])
    })

    it("throws when replies.json is not an array", async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "replies.json"), JSON.stringify({}))
      await expect(loadReplies(tmpDir)).rejects.toThrow(/Invalid/)
    })

    it("returns parsed array when file exists", async () => {
      const replies: ReplyEntry[] = [
        { id: "r1", comment_id: "c1", body: "LGTM", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "r2", comment_id: "c2", body: "Needs work", created_at: "2026-01-02T00:00:00.000Z" },
      ]
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "replies.json"), JSON.stringify(replies))

      const result = await loadReplies(tmpDir)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe("r1")
      expect(result[1].body).toBe("Needs work")
    })
  })

  describe("clearReplies", () => {
    it("removes replies.json", async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "replies.json"), "[]")
      await clearReplies(tmpDir)
      expect(existsSync(join(dir, "replies.json"))).toBe(false)
    })

    it("does not throw if replies.json does not exist", async () => {
      await expect(clearReplies(tmpDir)).resolves.toBeUndefined()
    })
  })
})
