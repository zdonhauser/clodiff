import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync } from "fs"

const INJECT_REPLIES_PATH = join(import.meta.dir, "../../hooks/inject-replies.js")
const LOAD_SESSION_PATH = join(import.meta.dir, "../../hooks/load-session.js")

async function runScript(scriptPath: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["node", scriptPath], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

describe("inject-replies.js", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clodiff-hooks-test-"))
    await mkdir(join(tmpDir, ".review"), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("outputs nothing and exits 0 when replies.json does not exist", async () => {
    const { stdout, exitCode } = await runScript(INJECT_REPLIES_PATH, tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe("")
  })

  it("outputs formatted reply context when replies.json has entries", async () => {
    const replies = [
      {
        id: "reply-1",
        comment_id: "comment-abc",
        body: "This looks good to me",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    await writeFile(join(tmpDir, ".review", "replies.json"), JSON.stringify(replies))

    const { stdout, exitCode } = await runScript(INJECT_REPLIES_PATH, tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("[clodiff replies]")
    expect(stdout).toContain('id="reply-1"')
    expect(stdout).toContain('comment_id="comment-abc"')
    expect(stdout).toContain('created_at="2026-01-01T00:00:00.000Z"')
    expect(stdout).toContain("This looks good to me")
  })

  it("clears replies.json after reading", async () => {
    const replies = [
      {
        id: "reply-1",
        comment_id: "comment-abc",
        body: "A reply",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    await writeFile(join(tmpDir, ".review", "replies.json"), JSON.stringify(replies))

    await runScript(INJECT_REPLIES_PATH, tmpDir)

    // File should exist but be empty array
    const raw = await Bun.file(join(tmpDir, ".review", "replies.json")).text()
    expect(JSON.parse(raw)).toEqual([])
  })

  it("outputs nothing when replies.json is empty array", async () => {
    await writeFile(join(tmpDir, ".review", "replies.json"), "[]")

    const { stdout, exitCode } = await runScript(INJECT_REPLIES_PATH, tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe("")
  })

  it("formats multiple replies correctly", async () => {
    const replies = [
      {
        id: "r1",
        comment_id: "c1",
        body: "First reply",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        comment_id: "c2",
        body: "Second reply",
        created_at: "2026-01-02T00:00:00.000Z",
      },
    ]
    await writeFile(join(tmpDir, ".review", "replies.json"), JSON.stringify(replies))

    const { stdout } = await runScript(INJECT_REPLIES_PATH, tmpDir)
    expect(stdout).toContain('id="r1"')
    expect(stdout).toContain('id="r2"')
    expect(stdout).toContain("First reply")
    expect(stdout).toContain("Second reply")
  })
})

describe("load-session.js", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clodiff-hooks-test-"))
    await mkdir(join(tmpDir, ".review"), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("outputs nothing and exits 0 when session.json does not exist", async () => {
    const { stdout, exitCode } = await runScript(LOAD_SESSION_PATH, tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe("")
  })

  it("outputs session summary when session.json exists", async () => {
    const session = {
      version: 1,
      repo: "owner/repo",
      base_branch: "main",
      head_commit: "abc123",
      current_commit: "abc123",
      reviews: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }
    await writeFile(join(tmpDir, ".review", "session.json"), JSON.stringify(session))

    const { stdout, exitCode } = await runScript(LOAD_SESSION_PATH, tmpDir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("[clodiff session]")
    expect(stdout).toContain("base: main")
  })

  it("summary includes base branch, open comment count, resolved count", async () => {
    const session = {
      version: 1,
      repo: "owner/repo",
      base_branch: "develop",
      head_commit: "abc123",
      current_commit: "abc123",
      reviews: [
        {
          id: "rev1",
          commit_id: "abc123",
          event: "COMMENT",
          comments: [
            { id: "c1", body: "needs fix", path: "a.ts", commit_id: "abc123", line: 1, side: "RIGHT", resolved: false, source: "claude-code", created_at: "2026-01-01T00:00:00.000Z" },
            { id: "c2", body: "looks ok", path: "b.ts", commit_id: "abc123", line: 2, side: "RIGHT", resolved: true, source: "claude-code", created_at: "2026-01-01T00:00:00.000Z" },
            { id: "c3", body: "another issue", path: "c.ts", commit_id: "abc123", line: 3, side: "RIGHT", resolved: false, source: "claude-code", created_at: "2026-01-01T00:00:00.000Z" },
          ],
          created_at: "2026-01-01T00:00:00.000Z",
          source: "claude-code",
        },
      ],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }
    await writeFile(join(tmpDir, ".review", "session.json"), JSON.stringify(session))

    const { stdout } = await runScript(LOAD_SESSION_PATH, tmpDir)
    expect(stdout).toContain("base: develop")
    expect(stdout).toContain("open comments: 2")
    expect(stdout).toContain("resolved: 1")
  })

  it("counts 0 comments when no reviews exist", async () => {
    const session = {
      version: 1,
      repo: "owner/repo",
      base_branch: "main",
      head_commit: "abc123",
      current_commit: "abc123",
      reviews: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }
    await writeFile(join(tmpDir, ".review", "session.json"), JSON.stringify(session))

    const { stdout } = await runScript(LOAD_SESSION_PATH, tmpDir)
    expect(stdout).toContain("open comments: 0")
    expect(stdout).toContain("resolved: 0")
  })
})
